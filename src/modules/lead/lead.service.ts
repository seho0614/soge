import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { LEAD_QUEUE_STATES } from './lead.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 상담 신청(리드) 접수 · 배정 (D008 · 2026-10-02).
 *
 * ── 왜 여기 있는가 ─────────────────────────────────────────────────
 * 전에는 리드를 만드는 API 도, 파트너에게 보내는 API 도 없었습니다.
 * 시험은 SQL 로 넣었고 운영에서는 파트너센터 「상담 신청」이 늘 비어 있게 됩니다.
 *
 * ── 접수는 여기 없습니다 (D018 · 2026-10-02) ──────────────────────
 * 상담 신청은 로그인 없이 휴대폰 확인으로 받습니다(partner/consult.service.ts → fn_consult_deliver).
 * 확인된 신청만 리드가 되고 1곳에 갑니다. 여기는 배정 이후(운영 대기열 · 수동 배정 · 재배정 · 종료)와
 * 회원의 「내 상담 신청」을 맡습니다.
 *
 * ── 판정은 DB 가 합니다 ────────────────────────────────────────────
 * 후보 조건(fn_lead_candidates) · 배정(fn_lead_assign) · 배치(fn_lead_assign_tick) ·
 * 배정 규칙(trg_lead_delivery_guard)이 모두 DB 에 있습니다. 여기서 같은 조건을
 * 다시 쓰지 않습니다 — 두 곳에 있으면 규칙을 고칠 때 한쪽이 뒤처집니다.
 *
 * ── 이용료는 그대로입니다 ──────────────────────────────────────────
 * 배정은 요약만 보냅니다. 이용료는 파트너가 **열람할 때** 생기고(partner.service viewLead),
 * 연락처는 열람한 업체에만 pii.fn_read_lead_contact 로 풀립니다.
 */
@Injectable()
export class LeadService {
  private readonly log = new Logger(LeadService.name);
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  private async settingInt(key: string, dflt: number) {
    const [r] = await this.db.query<{ v: number }>('SELECT fn_lead_setting_int($1,$2) AS v', [key, dflt]);
    return Number(r?.v ?? dflt);
  }

  /* ── 신청자 ─────────────────────────────────────────────────────── */

  /**
   * 내 상담 신청. 연락처가 **어느 업체에 넘어갔는지**(열람한 업체)를 보여 줍니다 —
   * 제3자 제공 받은 곳을 알려 주는 것이 동의의 전제입니다.
   */
  async mine() {
    const me = this.me;
    if (!me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const leads = await this.db.query<any>(
      `SELECT l.id, c.name AS "categoryName", l.summary, l.sido, l.sigungu,
              l.created_at AS "createdAt", l.assign_state AS "assignState",
              l.target_partners AS "target", l.close_reason AS "closeReason",
              (SELECT count(*)::int FROM lead_deliveries d
                WHERE d.lead_id = l.id AND d.state IN ('DELIVERED','VIEWED')) AS "sentTo",
              coalesce((SELECT json_agg(json_build_object('company', b.company_name, 'viewedAt', d.viewed_at)
                                         ORDER BY d.viewed_at)
                          FROM lead_deliveries d
                          JOIN partners p ON p.id = d.partner_id
                          JOIN businesses b ON b.id = p.business_id
                         WHERE d.lead_id = l.id AND d.viewed_at IS NOT NULL), '[]'::json) AS "providedTo",
              (pc.purged_at IS NOT NULL) AS "contactPurged"
         FROM leads l
         JOIN categories c ON c.id = l.category_id
         LEFT JOIN pii.lead_contacts pc ON pc.lead_id = l.id
        WHERE l.requester_account_id = $1
        ORDER BY l.created_at DESC LIMIT 50`, [me]);
    /* 휴대폰 확인은 마쳤지만 받을 업체가 없어 전달되지 않은 신청(D018) — 연락처는 어디에도 넘어가지 않았습니다 */
    const pending = await this.db.query<any>(
      `SELECT cr.id, c.name AS "categoryName", coalesce(nullif(btrim(cr.memo), ''), c.name || ' 상담 신청') AS summary,
              cr.sido, cr.sigungu, cr.created_at AS "createdAt", 'NO_PARTNER' AS "assignState",
              0 AS "target", NULL AS "closeReason", 0 AS "sentTo", '[]'::json AS "providedTo",
              (cr.contact_enc IS NULL) AS "contactPurged"
         FROM consult_requests cr
         JOIN categories c ON c.id = cr.category_id
        WHERE cr.requester_account_id = $1 AND cr.state = 'NO_PARTNER'
        ORDER BY cr.created_at DESC LIMIT 50`, [me]);
    return [...leads, ...pending]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50);
  }

  /* ── 운영 ──────────────────────────────────────────────────────── */

  /**
   * 배정 대기열. 기본(QUEUE)은 손이 필요한 것 — 대기(OPEN) · 미배정(UNMATCHED).
   * 각 건에 지금 보낼 수 있는 업체 수(eligibleCount)와 배정 현황을 함께 냅니다.
   */
  async admList(state?: string) {
    const st = (state ?? 'QUEUE').toUpperCase();
    if (!(LEAD_QUEUE_STATES as readonly string[]).includes(st)) {
      throw new PolicyViolation('BAD_STATE', `state 는 ${LEAD_QUEUE_STATES.join(' · ')} 중 하나입니다.`);
    }
    const filter = st === 'QUEUE' ? ['OPEN', 'UNMATCHED'] : st === 'ALL' ? null : [st];
    const items = await this.db.query(
      `SELECT l.id, l.created_at AS "createdAt", l.summary, l.sido, l.sigungu, l.is_urgent AS "urgent",
              l.assign_state AS "assignState", l.target_partners AS "target",
              l.assign_deadline AS "deadline", l.assigned_at AS "assignedAt", l.source,
              l.close_reason AS "closeReason",
              c.code AS "categoryCode", c.name AS "categoryName", r.mode AS "restrictMode",
              ra.email AS "requester",
              (SELECT count(*)::int FROM lead_deliveries d WHERE d.lead_id = l.id AND d.state IN ('DELIVERED','VIEWED')) AS "active",
              (SELECT count(*)::int FROM lead_deliveries d WHERE d.lead_id = l.id AND d.state = 'VIEWED')  AS "viewed",
              (SELECT count(*)::int FROM lead_deliveries d WHERE d.lead_id = l.id AND d.state = 'EXPIRED') AS "expired",
              CASE WHEN l.category_id IS NOT NULL AND l.assign_state <> 'CLOSED'
                   THEN (SELECT count(*)::int FROM fn_lead_candidates(l.id) x WHERE x.eligible) END AS "eligibleCount",
              coalesce((SELECT json_agg(json_build_object(
                         'deliveryId', d.id, 'partnerId', d.partner_id, 'company', b.company_name,
                         'state', d.state, 'mode', d.assign_mode, 'deliveredAt', d.delivered_at,
                         'expiresAt', d.expires_at, 'viewedAt', d.viewed_at, 'endReason', d.end_reason)
                         ORDER BY d.delivered_at)
                          FROM lead_deliveries d
                          JOIN partners p ON p.id = d.partner_id
                          JOIN businesses b ON b.id = p.business_id
                         WHERE d.lead_id = l.id), '[]'::json) AS deliveries
         FROM leads l
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN restricted_industries r
           ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
         LEFT JOIN accounts ra ON ra.id = l.requester_account_id
        WHERE ($1::text[] IS NULL OR l.assign_state = ANY($1::text[]))
        ORDER BY CASE l.assign_state WHEN 'UNMATCHED' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END,
                 l.is_urgent DESC, l.created_at ${st === 'QUEUE' || st === 'OPEN' || st === 'UNMATCHED' ? 'ASC' : 'DESC'}
        LIMIT 200`, [filter]);
    const [counts] = await this.db.query<any>(
      `SELECT count(*) FILTER (WHERE assign_state = 'OPEN')::int      AS "open",
              count(*) FILTER (WHERE assign_state = 'ASSIGNED')::int  AS "assigned",
              count(*) FILTER (WHERE assign_state = 'UNMATCHED')::int AS "unmatched",
              count(*) FILTER (WHERE assign_state = 'CLOSED')::int    AS "closed",
              count(*) FILTER (WHERE assign_state = 'LEGACY')::int    AS "legacy"
         FROM leads`);
    return { items, counts, settings: await this.settings() };
  }

  async settings() {
    return {
      target: await this.settingInt('lead.assign.target', 1),
      maxPartners: await this.settingInt('lead.assign.max_partners', 1),
      viewTtlHours: await this.settingInt('lead.assign.view_ttl_hours', 24),
      maxAgeHours: await this.settingInt('lead.assign.max_age_hours', 72),
      weights: await this.db.query(`SELECT grade, weight FROM lead_assign_weights ORDER BY weight`),
    };
  }

  /** 한 건 상세 — 배정 현황과 후보 업체 전체(탈락 사유 포함) */
  async admGet(id: string) {
    if (!UUID.test(id)) throw new NotFound('상담 신청이 없습니다.');
    const { items } = await this.admListOne(id);
    if (!items.length) throw new NotFound('상담 신청이 없습니다.');
    const candidates = await this.db.query(
      `SELECT partner_id AS "partnerId", company, grade, partner_status AS "partnerStatus",
              eligible, reasons, service_ok AS "serviceOk", qual_ok AS "qualOk", region_ok AS "regionOk",
              cap_ok AS "capOk", unpaid, unpaid_cap AS "unpaidCap", reserved, fee,
              recent_30d AS "recent30d", last_assigned_at AS "lastAssignedAt", weight, score
         FROM fn_lead_candidates($1)`, [id]);
    return { ...items[0], candidates };
  }

  private async admListOne(id: string) {
    const items = await this.db.query(
      `SELECT l.id, l.created_at AS "createdAt", l.summary, l.sido, l.sigungu, l.is_urgent AS "urgent",
              l.assign_state AS "assignState", l.target_partners AS "target",
              l.assign_deadline AS "deadline", l.assigned_at AS "assignedAt", l.source,
              l.close_reason AS "closeReason", l.closed_at AS "closedAt",
              /* v10.31 (합침 · W5 D071) — 리드 등급 · 알림톡 결과(운영 입력 POST /admin/partner-center/leads/{id}/grade) */
              l.grade, fn_lead_grade_label(l.grade) AS "gradeLabel", l.alim_state AS "alimState", l.alim_at AS "alimAt",
              c.code AS "categoryCode", c.name AS "categoryName", r.mode AS "restrictMode",
              coalesce((SELECT json_agg(json_build_object(
                         'deliveryId', d.id, 'partnerId', d.partner_id, 'company', b.company_name,
                         'state', d.state, 'mode', d.assign_mode, 'deliveredAt', d.delivered_at,
                         'expiresAt', d.expires_at, 'viewedAt', d.viewed_at, 'endReason', d.end_reason,
                         'assignedBy', aa.email)
                         ORDER BY d.delivered_at)
                          FROM lead_deliveries d
                          JOIN partners p ON p.id = d.partner_id
                          JOIN businesses b ON b.id = p.business_id
                          LEFT JOIN accounts aa ON aa.id = d.assigned_by
                         WHERE d.lead_id = l.id), '[]'::json) AS deliveries
         FROM leads l
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN restricted_industries r
           ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
        WHERE l.id = $1`, [id]);
    return { items };
  }

  /** 상태를 배정 현황에 맞춥니다(회수 · 종료 뒤) */
  private restate(id: string) {
    return this.db.query(
      `UPDATE leads l
          SET assign_state = CASE
                WHEN a.n >= l.target_partners THEN 'ASSIGNED'
                WHEN l.assign_deadline IS NOT NULL AND l.assign_deadline > now() THEN 'OPEN'
                WHEN a.n > 0 THEN 'ASSIGNED' ELSE 'UNMATCHED' END
         FROM (SELECT count(*)::int AS n FROM lead_deliveries
                WHERE lead_id = $1 AND state IN ('DELIVERED','VIEWED')) a
        WHERE l.id = $1 AND l.assign_state NOT IN ('CLOSED')`, [id]);
  }

  /**
   * 수동 배정. partnerIds 가 없으면 후보 순서대로 고릅니다.
   * 조건(활동 · 서비스 · 자격 · 지역 · 한도 · 중복)은 fn_lead_assign 이 보고, 하나라도 어긋나면 전부 거부합니다.
   */
  async admAssign(id: string, dto: { partnerIds?: string[]; count?: number }) {
    if (!UUID.test(id)) throw new NotFound('상담 신청이 없습니다.');
    const rows = await this.db.transaction(async () => {
      const [l] = await this.db.query<any>(`SELECT id FROM leads WHERE id = $1`, [id]);
      if (!l) throw new NotFound('상담 신청이 없습니다.');
      return this.db.query<any>(
        `SELECT delivery_id AS "deliveryId", partner_id AS "partnerId", company
           FROM fn_lead_assign($1, 'MANUAL', $2, $3::uuid[], $4)`,
        [id, this.me ?? null, dto.partnerIds ?? null, dto.count ?? null]);
    });
    if (!rows.length) {
      throw new PolicyViolation('NO_CANDIDATE',
        '지금 보낼 수 있는 업체가 없습니다 — 후보 목록의 탈락 사유(지역 · 서비스 · 자격 · 한도)를 확인하십시오.');
    }
    const [l] = await this.db.query<any>(`SELECT assign_state FROM leads WHERE id = $1`, [id]);
    return { id, assignState: l.assign_state, assigned: rows,
      note: `${rows.map((r: any) => r.company).join(' · ')} 에 보냈습니다. 열람 기한 안에 열지 않으면 다른 업체로 넘어갑니다.` };
  }

  /**
   * 재배정 — 아직 열지 않은 배정을 거두고 다른 업체로.
   * 열람한 배정은 거둘 수 없습니다(연락처가 이미 넘어갔고 이용료가 생겼습니다 — DB 가 막습니다).
   */
  async admReassign(id: string, dto: { deliveryIds: string[]; reason: string; partnerIds?: string[] }) {
    if (!UUID.test(id)) throw new NotFound('상담 신청이 없습니다.');
    const reason = dto.reason.trim();
    if (!reason) throw new PolicyViolation('REASON_REQUIRED', '거두는 사유를 적어 주십시오 — 거둔 업체에 그대로 알립니다.');

    return this.db.transaction(async () => {
      const [l] = await this.db.query<any>(`SELECT id, assign_state FROM leads WHERE id = $1 FOR UPDATE`, [id]);
      if (!l) throw new NotFound('상담 신청이 없습니다.');
      if (l.assign_state === 'CLOSED') throw new StateConflict('CLOSED', '종료된 상담 신청입니다.');

      const revoked: any[] = [];
      for (const did of dto.deliveryIds) {
        const [cur] = await this.db.query<any>(
          `SELECT state FROM lead_deliveries WHERE id = $1 AND lead_id = $2`, [did, id]);
        if (!cur) throw new StateConflict('NO_SUCH_DELIVERY', '이 상담 신청의 배정이 아닙니다.');
        if (cur.state === 'VIEWED') {
          throw new StateConflict('ALREADY_VIEWED', '열람한 배정은 거둘 수 없습니다 — 연락처가 이미 넘어갔고 이용료가 생겼습니다.');
        }
        if (cur.state !== 'DELIVERED') throw new StateConflict('NOT_ACTIVE', '이미 끝난 배정입니다(만료 · 회수).');
        const [r] = await this.db.query<any>(
          `UPDATE lead_deliveries SET state = 'REVOKED', end_reason = $3
            WHERE id = $1 AND lead_id = $2 AND state = 'DELIVERED'
          RETURNING id AS "deliveryId", partner_id AS "partnerId"`, [did, id, `운영 회수 — ${reason}`]);
        revoked.push(r);
        await this.db.query(
          `INSERT INTO notifications (account_id, event_code, title, body, link_url)
           SELECT b.account_id, 'LEAD_REVOKED', '배정된 상담 신청을 거뒀습니다',
                  '사유: ' || $2 || ' — 열람 전이라 이용료는 없습니다.', '/partner/leads'
             FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1`,
          [r.partnerId, reason]);
      }

      const assigned = await this.db.query<any>(
        `SELECT delivery_id AS "deliveryId", partner_id AS "partnerId", company
           FROM fn_lead_assign($1, 'REASSIGN', $2, $3::uuid[], $4)`,
        [id, this.me ?? null, dto.partnerIds ?? null, dto.partnerIds ? null : revoked.length]);
      await this.restate(id);
      const [after] = await this.db.query<any>(`SELECT assign_state FROM leads WHERE id = $1`, [id]);
      return { id, assignState: after.assign_state, revoked, assigned,
        note: assigned.length
          ? `${revoked.length}곳에서 거두고 ${assigned.map((a: any) => a.company).join(' · ')} 에 보냈습니다.`
          : `${revoked.length}곳에서 거뒀습니다. 지금 보낼 업체가 없어 ${after.assign_state === 'OPEN' ? '대기로 두고 배치가 채웁니다' : '미배정으로 둡니다'}.` };
    });
  }

  /** 종료 — 장난 · 중복 신청 등. 아직 안 연 배정은 함께 거둡니다 */
  async admClose(id: string, reason: string) {
    if (!UUID.test(id)) throw new NotFound('상담 신청이 없습니다.');
    const why = reason.trim();
    if (!why) throw new PolicyViolation('REASON_REQUIRED', '종료 사유를 적어 주십시오.');
    return this.db.transaction(async () => {
      const [l] = await this.db.query<any>(`SELECT assign_state FROM leads WHERE id = $1 FOR UPDATE`, [id]);
      if (!l) throw new NotFound('상담 신청이 없습니다.');
      if (l.assign_state === 'CLOSED') throw new StateConflict('ALREADY_CLOSED', '이미 종료된 상담 신청입니다.');
      const revoked = await this.db.query(
        `UPDATE lead_deliveries SET state = 'REVOKED', end_reason = $2
          WHERE lead_id = $1 AND state = 'DELIVERED' RETURNING id`, [id, `운영 종료 — ${why}`]);
      await this.db.query(
        `UPDATE leads SET assign_state = 'CLOSED', closed_at = now(), closed_by = $2, close_reason = $3
          WHERE id = $1`, [id, this.me ?? null, why]);
      return { id, assignState: 'CLOSED', revoked: revoked.length,
        note: `종료했습니다. 아직 열지 않은 배정 ${revoked.length}건을 거뒀습니다. 이미 열람한 업체의 이용료는 그대로입니다.` };
    });
  }

  /** 지금 배정 돌리기 — 배치(lead_assign)와 같은 함수입니다 */
  async admRunNow() {
    const [r] = await this.db.query<any>(`SELECT * FROM fn_lead_assign_tick()`);
    return { ...r,
      note: `만료 ${r.expired} · 회수 ${r.revoked} · 새 배정 ${r.assigned}건(${r.touched}개 신청) · 미배정 전환 ${r.unmatched} · 실패 ${r.failed}` };
  }
}
