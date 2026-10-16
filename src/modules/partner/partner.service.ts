import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolveBrokerLookupProvider } from './broker-lookup.provider';
import { normSido } from '../../common/region';
import { LeadCashService } from './lead-cash.service';
import { PartnerActorService } from './partner-actor.service';
import { assumeOn } from '../../common/integration/switches';

/**
 * 파트너센터.
 *
 * v10.45 (2026-10-16 · 리팩토링) — 운영 화면용(adm*: 입점 심사 · 서비스 검수 · 이용료 무효 · 반려 신청 처리)은 partner-admin.service.ts 로 나눴습니다.
 *
 * ── 리드 이용료는 정보 이용료입니다 ────────────────────────────────
 * "요청 목록을 볼 권한"의 값입니다. **열람 시점에 발생하고 성사와 무관합니다.**
 *
 * 성사와 연동하면 소개비의 일부를 플랫폼이 가져가는 모양이 되고,
 * 지금까지 지켜온 INV-9R(소개비 무공제)이 무너집니다.
 * 그래서 이 서비스 어디에도 deal 이나 소개비를 참조하는 경로가 없습니다.
 *
 * ── 무효는 위험감지가 잡은 것만입니다 ──────────────────────────────
 * 당사자 간 상담 결렬은 플랫폼이 관여하지 않습니다 —
 * 그것까지 판정하면 통신판매중개자가 아니라 거래 당사자가 됩니다.
 */
@Injectable()
export class PartnerService {
  private readonly log = new Logger(PartnerService.name);
  constructor(private readonly db: DatabaseService, private readonly cash: LeadCashService,
              private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }

  /** 내 파트너 계정. 없으면 신청 안내를 냅니다.
   *  v10.31 (W5 · CTR-610 계정) — 대표 계정 또는 합류한 직원 계정(business_members · 빠지지 않은). */
  private async mine() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const p = await this.actors.forMember(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!p) return null;
    const { canMoney: _money, ...mine } = p;           // 이 자리가 내보내던 칸 그대로(대시보드 응답에 펼쳐 넣음)
    return mine;
  }

  /* ── 입점 ──────────────────────────────────────────────────────── */

  async apply() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    /* v10.38 (D096 · P2P) — 계정 기준. 사업자 정보가 없어도 본인인증 개인이면 「개인 활동 정보」로 신청합니다 */
    const a = await this.actors.actor(this.me, true);
    const biz = a ? { id: a.id, verified: a.ok } : null;
    if (!biz) {
      throw new PolicyViolation('IDENTITY_REQUIRED',
        '본인인증이 먼저입니다. 본인인증을 하면 개인으로 바로 입점 신청을 하실 수 있습니다(사업자 인증은 선택).');
    }

    /* 반려된 신청은 다시 낼 수 있습니다 — 사유를 고쳐 다시 오라는 것이 반려입니다.
     * 그 밖의 상태(심사 중 · 활동 · 정지 · 탈퇴)는 그대로 둡니다. */
    const [row] = await this.db.query<any>(
      `INSERT INTO partners(business_id) VALUES ($1)
       ON CONFLICT (business_id) DO UPDATE
          SET status = 'APPLIED', applied_at = now(), suspended_reason = NULL
        WHERE partners.status = 'REJECTED'
       RETURNING id, status, applied_at AS "appliedAt"`, [biz.id]);
    if (!row) throw new StateConflict('ALREADY_APPLIED', '이미 신청하셨습니다.');

    return { ...row,
      note: biz.verified
        ? '심사 후 승인됩니다. 서비스 등록과 지역 설정을 미리 해두시면 승인 즉시 리드를 받으실 수 있습니다.'
        : '사업자 인증(또는 본인인증)이 확인되면 심사가 진행됩니다.' };
  }

  /** 파트너 홈. 막힌 업무를 먼저 냅니다 — 처리 안 하면 리드가 오지 않습니다. */
  async dashboard() {
    const p = await this.mine();
    if (!p) return { applied: false, note: '파트너 신청을 먼저 해주십시오.' };

    const [svc] = await this.db.query<any>(
      `SELECT count(*) FILTER (WHERE status='APPROVED')  AS approved,
              count(*) FILTER (WHERE status='IN_REVIEW') AS in_review
         FROM partner_services WHERE partner_id = $1`, [p.id]);
    const [reg] = await this.db.query<{ n: string }>(
      'SELECT count(*) AS n FROM partner_regions WHERE partner_id = $1', [p.id]);
    const [fee] = await this.db.query<any>(
      `SELECT coalesce(sum(amount) FILTER (WHERE state='PENDING'),0) AS unpaid,
              count(*) FILTER (WHERE state='PENDING')                AS items
         FROM lead_fees WHERE partner_id = $1`, [p.id]);
    const [elig] = await this.db.query<any>(
      'SELECT can_receive FROM v_partner_eligible WHERE partner_id = $1', [p.id]);

    // 막힌 것을 이유와 함께 냅니다. "왜 리드가 안 오나"를 묻지 않게.
    const blocked: any[] = [];
    if (p.status !== 'ACTIVE') {
      blocked.push({ what: '입점 심사', why: '승인 전에는 리드가 오지 않습니다.' });
    }
    if (Number(svc?.approved ?? 0) === 0) {
      blocked.push({ what: '승인된 서비스 없음',
        why: '승인된 서비스에만 리드가 옵니다. 검수 중인 건은 노출되지 않습니다.' });
    }
    if (Number(reg?.n ?? 0) === 0) {
      blocked.push({ what: '활동 지역 없음',
        why: '켠 지역에서만 리드를 받습니다. 최소 한 곳은 켜셔야 합니다.' });
    }
    if (Number(fee?.unpaid ?? 0) >= Number(p.unpaidCap)) {
      blocked.push({ what: '이전 후불 미납 한도 초과',
        why: '전환 전 미청구분이 결제되면 리드 수신이 바로 재개됩니다.' });
    }
    /* v10.31 (W5 · D070) — 선불 잔액이 0이면 상담을 받지 못합니다(시안 「잔액이 0이면 상담을 못 받습니다」) */
    const [w] = await this.db.query<any>(
      `SELECT coalesce(paid_balance,0) + coalesce(bonus_balance,0) AS total, coalesce(bonus_balance,0) AS bonus
         FROM lead_cash_wallets WHERE partner_id = $1`, [p.id]);
    const balance = Number(w?.total ?? 0);
    if (balance <= 0) {
      blocked.push({ what: '리드 이용료 잔액 없음', why: '충전하시면 바로 상담이 배정됩니다 — 「리드 이용료」에서 충전합니다.' });
    }

    /* v10.31 — 시안 숫자 4칸 · 업체 카드(담당 · 입점일 · 카테고리 · 등록 방식 · 영업지역)의 실제 값 */
    const [today] = await this.db.query<any>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE viewed_at IS NULL AND state = 'DELIVERED')::int AS unviewed
         FROM lead_deliveries
        WHERE partner_id = $1 AND state <> 'REVOKED'
          AND delivered_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`, [p.id]);
    const [month] = await this.db.query<any>(
      `SELECT coalesce(sum(l.amount) FILTER (WHERE l.account IN ('PARTNER_PAID','PARTNER_BONUS')),0)::bigint AS used,
              coalesce(sum(l.amount) FILTER (WHERE l.account = 'PARTNER_BONUS'),0)::bigint AS bonus
         FROM lead_cash_entries e JOIN lead_cash_lines l ON l.entry_id = e.id
        WHERE e.partner_id = $1 AND e.kind IN ('USE','RESTORE')
          AND e.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`, [p.id]);
    const [stl] = await this.db.query<any>(
      `SELECT coalesce(sum(net_amount) FILTER (WHERE state IN ('DRAFT','CONFIRMED')),0)::bigint AS due,
              count(*) FILTER (WHERE state IN ('DRAFT','CONFIRMED'))::int AS n
         FROM partner_settlements WHERE partner_id = $1`, [p.id]);
    const [pd] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'affiliate.payout_day'`);
    const [card] = await this.db.query<any>(
      `SELECT a.name AS manager,
              (SELECT c.name FROM partner_services s JOIN categories c ON c.id = s.category_id
                WHERE s.partner_id = $1 AND s.status = 'APPROVED'
                GROUP BY c.name ORDER BY count(*) DESC, c.name LIMIT 1) AS "mainCategory",
              (SELECT c.service_form FROM partner_services s JOIN categories c ON c.id = s.category_id
                WHERE s.partner_id = $1 AND s.status = 'APPROVED'
                GROUP BY c.service_form ORDER BY count(*) DESC LIMIT 1) AS "mainForm",
              (SELECT count(DISTINCT s.category_id)::int FROM partner_services s WHERE s.partner_id = $1 AND s.status = 'APPROVED') AS "categoryCount"
         FROM accounts a WHERE a.id = $2`, [p.id, p.ownerId]);
    const regionNames = await this.db.query<{ sido: string; n: number; all: boolean }>(
      `SELECT sido, count(*)::int AS n, bool_or(sigungu IN ('전체','*')) AS all
         FROM partner_regions WHERE partner_id = $1 GROUP BY sido ORDER BY count(*) DESC, sido LIMIT 6`, [p.id]);
    const day = Number(pd?.value ?? 10);

    const { ownerId, businessId, isOwner, ...pub } = p;
    void ownerId; void businessId;
    return {
      applied: true, ...pub, isOwner,
      services: svc, regions: Number(reg?.n ?? 0),
      unpaid: Number(fee?.unpaid ?? 0), unpaidItems: Number(fee?.items ?? 0),
      canReceive: (elig?.can_receive ?? false) && balance > 0,
      blocked,
      balance, bonus: Number(w?.bonus ?? 0),
      today: { leads: today?.n ?? 0, unviewed: today?.unviewed ?? 0 },
      month: { fee: Number(month?.used ?? 0), bonus: Number(month?.bonus ?? 0) },
      settlement: { due: Number(stl?.due ?? 0), count: stl?.n ?? 0, payoutDay: day },
      card: {
        manager: card?.manager ?? null,
        mainCategory: card?.mainCategory ?? null,
        categoryCount: card?.categoryCount ?? 0,
        form: card?.mainForm ?? null,
        regionNames: regionNames.map((r) => (r.all ? `${r.sido} 전역` : r.n > 1 ? `${r.sido} ${r.n}곳` : r.sido)),
      },
    };
  }

  /* ── 서비스 · 지역 ─────────────────────────────────────────────── */

  async services() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    /* v10.31 (W5 · CTR-200) — 시안 표 「등록 방식 · 받은 리드 · 성사율 · 수정일」: 받은 리드 = 이 서비스 업종으로 받은 배정,
     * 성사율 = 소비자가 확인한 이행 보고 ÷ 연락처를 연 배정(이 업종) */
    return this.db.query(
      `SELECT s.id, s.title, s.status, s.reject_reason AS "rejectReason", s.created_at AS "createdAt",
              s.updated_at AS "updatedAt", s.form_type AS "formType", s.suspended_by AS "suspendedBy",
              c.name AS "categoryName", c.id AS "categoryId",
              x.received::int AS "leadCount", x.viewed::int AS "viewedCount", x.done::int AS "doneCount",
              CASE WHEN x.viewed > 0 THEN round(x.done * 100.0 / x.viewed, 1) END AS "convRate"
         FROM partner_services s
         LEFT JOIN categories c ON c.id = s.category_id
         LEFT JOIN LATERAL (
           SELECT count(*) AS received, count(*) FILTER (WHERE d.viewed_at IS NOT NULL) AS viewed,
                  count(f.id) FILTER (WHERE f.consumer_state = 'CONFIRMED') AS done
             FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id
             LEFT JOIN partner_fulfillment_reports f ON f.delivery_id = d.id
            WHERE d.partner_id = s.partner_id AND d.state <> 'REVOKED'
              AND s.category_id IS NOT NULL AND l.category_id = s.category_id) x ON true
        WHERE s.partner_id = $1 ORDER BY s.created_at DESC`, [p.id]);
  }

  async addService(title: string, body: string, categoryId?: string, extra?: {
    target?: string; receiveMode?: string; topFee?: number; referralRate?: number; rebateBonus?: number;
    matrix?: Array<{ row: string; col: string; amount: number }>;
    blocks?: Array<{ kind: string; body?: string; fileId?: string }>;
  }) {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');

    /* 금칙어·제한업종은 DB 가 봅니다. 여기서 다시 판정하지 않습니다 —
     * 두 곳에 있으면 규칙을 고칠 때 한쪽이 뒤처집니다.
     * v10.31 (W5 · CTR-210 위자드) — 업종을 고르면 등록 방식이 정해집니다(categories.service_form · 트리거가 맞춰 봄). */
    return this.db.transaction(async () => {
      await this.db.query(`SELECT set_config('app.actor_id', $1, true)`, [this.me ?? '']);
      let form: string | null = null;
      if (categoryId) {
        const [c] = await this.db.query<any>(`SELECT service_form, name FROM categories WHERE id = $1`, [categoryId]);
        if (!c) throw new PolicyViolation('NO_CATEGORY', '없는 업종입니다.');
        if (extra && !c.service_form) {
          throw new PolicyViolation('NO_FORM', `「${c.name}」 업종은 등록 방식(폼 유형)이 정해지지 않아 아직 등록할 수 없습니다 — 운영이 정하면 열립니다.`);
        }
        form = c.service_form ?? null;
      }
      const [row] = await this.db.query<any>(
        `INSERT INTO partner_services(partner_id, category_id, title, body, form_type, target, receive_mode, top_fee, referral_rate, rebate_bonus)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, status, form_type AS "formType"`,
        [p.id, categoryId ?? null, title, body, extra ? form : null, extra?.target?.trim() || null, extra?.receiveMode ?? null,
         extra?.topFee ?? null, extra?.referralRate ?? null, extra?.rebateBonus ?? null]);
      for (const m of extra?.matrix ?? []) {
        await this.db.query(
          `INSERT INTO partner_service_matrix(service_id, row_key, col_key, amount) VALUES ($1,$2,$3,$4)`,
          [row.id, m.row, m.col, m.amount]);
      }
      for (const b of extra?.blocks ?? []) {
        if (!b.body?.trim() && !b.fileId) continue;
        await this.db.query(
          `INSERT INTO partner_service_blocks(service_id, kind, body, file_id) VALUES ($1,$2,$3,$4)`,
          [row.id, b.kind, b.body?.trim() || null, b.fileId ?? null]);
      }
      return { ...row,
        note: '검수를 거쳐 승인됩니다. 승인 전에는 리드가 오지 않습니다.' };
    });
  }

  async regions() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    return this.db.query(
      'SELECT sido, sigungu FROM partner_regions WHERE partner_id = $1 ORDER BY sido, sigungu',
      [p.id]);
  }

  /**
   * 활동 지역 설정.
   *
   * 시·군·구까지만 씁니다. 상세주소는 그 자체로 특정 개인을 가리킬 수 있어
   * 매칭에 넣지 않습니다.
   */
  async setRegions(list: Array<{ sido: string; sigungu: string }>) {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    if (!Array.isArray(list) || !list.length) {
      throw new PolicyViolation('NO_REGION',
        '최소 한 곳은 켜셔야 합니다. 켜진 지역이 없으면 리드가 오지 않습니다.');
    }
    return this.db.transaction(async () => {
      await this.db.query('DELETE FROM partner_regions WHERE partner_id = $1', [p.id]);
      for (const r of list) {
        await this.db.query(
          `INSERT INTO partner_regions(partner_id, sido, sigungu) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`, [p.id, normSido(r.sido), r.sigungu]);   // D018 — 상담 신청 지역과 같은 이름으로
      }
      return { regions: list.length };
    });
  }

  /* ── 리드 ──────────────────────────────────────────────────────── */

  /**
   * 받은 리드.
   *
   * **열람 전에는 요약만 보입니다.** 지역·분야·시기까지는 무료이고,
   * 연락처를 여는 순간 이용료가 발생합니다.
   */
  async leads() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    /* D008 — 배정 상태 · 열람 기한 · 업종을 함께 냅니다. 회수(REVOKED)된 건은 뺍니다 —
     * 운영이 거둬 간 건을 계속 보여 주면 "왜 못 여나" 를 묻게 됩니다. */
    const rows = await this.db.query<any>(
      `SELECT d.id AS "deliveryId", l.id AS "leadId", l.summary, l.sido, l.sigungu,
              l.is_urgent AS "urgent", d.delivered_at AS "deliveredAt",
              d.viewed_at AS "viewedAt", d.state, d.expires_at AS "expiresAt",
              c.name AS "categoryName",
              (pc.lead_id IS NOT NULL AND pc.purged_at IS NULL) AS "hasContact",
              f.amount AS "fee", f.state AS "feeState", f.id AS "feeId",
              /* v10.31 (W5 · CTR-300) — 등급 · 알림톡 · 예상 확인비용 · 메모 · 반려 신청 상태 */
              l.grade, fn_lead_grade_label(l.grade) AS "gradeLabel", l.alim_state AS "alimState",
              fn_lead_fee_quote(l.id, d.partner_id) AS "feeQuote",
              (SELECT m.body FROM lead_delivery_memos m WHERE m.delivery_id = d.id ORDER BY m.created_at DESC LIMIT 1) AS memo,
              (SELECT count(*)::int FROM lead_delivery_memos m WHERE m.delivery_id = d.id) AS "memoCount",
              x.state AS "disputeState", x.id AS "disputeId",
              (f.id IS NOT NULL AND f.state <> 'VOIDED' AND x.id IS NULL
                AND d.delivered_at >= now() - interval '72 hours') AS "disputable"
         FROM lead_deliveries d
         JOIN leads l ON l.id = d.lead_id
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN pii.lead_contacts pc ON pc.lead_id = l.id
         LEFT JOIN lead_fees f ON f.delivery_id = d.id
         LEFT JOIN lead_fee_disputes x ON x.fee_id = f.id
        WHERE d.partner_id = $1 AND d.state <> 'REVOKED'
        ORDER BY (d.state = 'DELIVERED') DESC, d.delivered_at DESC LIMIT 100`, [p.id]);

    return rows.map(r => ({
      ...r,
      // 열람 전에는 연락처 자리를 아예 내려보내지 않습니다. 열람 뒤에도 목록에는 싣지 않습니다 —
      // 연락처는 GET /partner/leads/{id}/contact 로만 풀리고, 풀 때마다 기록이 남습니다.
      contact: r.viewedAt ? '(열람됨 — 연락처 보기로 확인)' : null,
      note: r.state === 'EXPIRED' ? '열람 기한이 지나 다른 업체로 넘어갔습니다.'
        : r.viewedAt ? null : '연락처를 열면 확인비용이 리드 이용료 잔액에서 빠집니다.',
    }));
  }

  /**
   * 열람한 리드의 연락처 (D008).
   *
   * 열람(과금)과 나눕니다 — 열람 응답은 감사 로그(audit_logs.after_data)에 통째로 남아,
   * 거기에 연락처를 실으면 평문 개인정보가 감사 로그에 쌓입니다. 여기서는
   * pii.fn_read_lead_contact 만 거치고, 그 함수가 열람 기록(pii_access_logs)을 남깁니다.
   */
  async leadContact(deliveryId: string) {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new StateConflict('NO_SUCH_LEAD', '받은 리드가 아닙니다.');
    const [d] = await this.db.query<any>(
      `SELECT d.id, d.lead_id, d.viewed_at, d.state,
              pc.lead_id IS NOT NULL AS has_contact, pc.purged_at
         FROM lead_deliveries d
         LEFT JOIN pii.lead_contacts pc ON pc.lead_id = d.lead_id
        WHERE d.id = $1 AND d.partner_id = $2`, [deliveryId, p.id]);
    if (!d) throw new StateConflict('NO_SUCH_LEAD', '받은 리드가 아닙니다.');
    if (!d.viewed_at) {
      throw new PolicyViolation('NOT_VIEWED', '먼저 「연락처 열기」로 열람하셔야 합니다. 열람할 때 이용료가 발생합니다.');
    }
    if (!d.has_contact) {
      return { deliveryId, contact: null, note: '연락처가 따로 저장되지 않은 옛 형식 리드입니다.' };
    }
    if (d.purged_at) {
      return { deliveryId, contact: null, purgedAt: d.purged_at,
        note: '보관 기한이 지나 연락처를 파기했습니다(개인정보 보호법).' };
    }
    const [c] = await this.db.query<any>(
      `SELECT name, phone, address, email FROM pii.fn_read_lead_contact($1, $2, $3)`,      /* v10.28 — 이메일(상담 신청에서 받은 것 · 옛 신청은 null) */
      [d.lead_id, this.me, `파트너 리드 열람 — 배정 ${deliveryId}`]);
    return { deliveryId, contact: c ?? null,
      note: '상담 목적 외에 쓰거나 남에게 넘기면 개인정보 보호법 위반입니다. 이 조회는 기록됩니다.' };
  }

  /**
   * 리드 열람 = 과금.
   *
   * 이 시점 하나뿐입니다. 성사되면 더 내지 않고, 안 되면 돌려받지도 않습니다 —
   * 정보 이용료이기 때문입니다.
   */
  async viewLead(deliveryId: string) {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');

    const [elig] = await this.db.query<{ can_receive: boolean; balance: string }>(
      'SELECT can_receive, balance FROM v_partner_eligible WHERE partner_id = $1', [p.id]);
    if (!elig?.can_receive) {
      /* v10.31 (W5 · D070) — 선불 잔액이 없으면 그 이유를 먼저 말합니다 */
      if (elig && Number(elig.balance) <= 0) {
        throw new PolicyViolation('LEADCASH', '리드 이용료 잔액이 없습니다 — 「리드 이용료」에서 충전하신 뒤 여십시오.');
      }
      throw new PolicyViolation('NOT_ELIGIBLE',
        '이전 후불 미납 한도를 넘었거나 승인된 서비스·활동 지역이 없습니다.');
    }

    return this.db.transaction(async () => {
      const [d] = await this.db.query<any>(
        `UPDATE lead_deliveries SET viewed_at = coalesce(viewed_at, now())
          WHERE id = $1 AND partner_id = $2
        RETURNING id, lead_id, viewed_at`, [deliveryId, p.id]);
      if (!d) throw new StateConflict('NO_SUCH_LEAD', '받은 리드가 아닙니다.');

      // 이미 과금된 건이면 다시 붙이지 않습니다(UNIQUE 가 막지만 메시지가 낫습니다).
      const [exist] = await this.db.query<{ amount: string }>(
        'SELECT amount FROM lead_fees WHERE delivery_id = $1', [d.id]);

      let fee = exist?.amount;
      let parts: { bonus: number; paid: number } | null = null;
      if (!exist) {
        /* v10.31 (W5 · D077) — 확인비용은 DB 한 곳(fn_lead_fee_quote)에서 정합니다:
         *   파트너가 이 업종에 정한 최고 확인비용 → 업종 기준 단가 → 기본 단가(lead.default_fee), × 리드 등급 비율.
         * ★ 코드에 기본값을 박지 않습니다(전에는 8,000 이 박혀 단가를 낮춰도 그대로 매겨졌습니다). */
        const [price] = await this.db.query<{ fee: string | null }>(
          `SELECT fn_lead_fee_quote($1, $2) AS fee`, [d.lead_id, p.id]);
        /* 선불(D070) — 이 INSERT 의 트리거가 잔액에서 뺍니다(보너스 먼저). 모자라면 LEADCASH 로 막히고 열람도 함께 되돌아갑니다 */
        const [f] = await this.db.query<{ amount: string; bonus_part: string | null; paid_part: string | null }>(
          `INSERT INTO lead_fees(delivery_id, partner_id, amount)
           VALUES ($1,$2,$3) RETURNING amount, bonus_part, paid_part`,
          /* 설정도 없으면 과금하지 않습니다 — 모르는 값으로 청구하느니
           *  안 받는 편이 낫습니다. 감시 뷰가 이 상태를 잡습니다. */
          [d.id, p.id, Number(price?.fee ?? 0)]);
        fee = f.amount;
        parts = { bonus: Number(f.bonus_part ?? 0), paid: Number(f.paid_part ?? 0) };
      }

      const [lead] = await this.db.query<any>(
        `SELECT summary, sido, sigungu FROM leads WHERE id = $1`, [d.lead_id]);
      return { ...lead, fee: Number(fee), viewedAt: d.viewed_at, parts,
        contactUrl: `/partner/leads/${d.id}/contact`,
        note: parts
          ? `확인비용 ${Number(fee).toLocaleString('ko-KR')}원이 잔액에서 빠졌습니다${parts.bonus ? `(보너스 ${parts.bonus.toLocaleString('ko-KR')}원 · 유상 ${parts.paid.toLocaleString('ko-KR')}원)` : ''}. 성사 여부와 무관합니다.`
          : '이미 연 리드입니다 — 확인비용은 한 번만 냅니다.' };
    }).then((out) => {
      /* 자동 청구 — 잔액이 기준 아래로 내려갔으면 뒤에서 한 번 충전합니다(실패해도 열람은 그대로) */
      void this.cash.runAuto(p.id).catch((e) => this.log.warn(`lead cash auto: ${e?.message ?? e}`));
      return out;
    });
  }

  /* ── 이용료 ────────────────────────────────────────────────────── */

  /** v10.31 (W5 · D070 · 10/10 시안 기준) — 선불 충전 잔액에서 차감한 내역(전환 전 후불분은 settleMode=POSTPAID). 잔액 · 충전은 GET /partner/cash */
  async fees() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');

    const rows = await this.db.query(
      `SELECT f.id, f.amount, f.state, f.incurred_at AS "incurredAt",
              f.billed_at AS "billedAt", f.void_rule AS "voidRule",
              f.settle_mode AS "settleMode", f.bonus_part AS "bonusPart", f.paid_part AS "paidPart",
              l.summary, d.delivered_at AS "deliveredAt",
              (f.state <> 'VOIDED' AND x.id IS NULL
                AND d.delivered_at >= now() - interval '72 hours') AS "disputable",
              x.id AS "disputeId", x.state AS "disputeState",
              x.decision_reason AS "disputeDecision"
         FROM lead_fees f
         JOIN lead_deliveries d ON d.id = f.delivery_id
         JOIN leads l ON l.id = d.lead_id
         LEFT JOIN lead_fee_disputes x ON x.fee_id = f.id
        WHERE f.partner_id = $1
        ORDER BY f.incurred_at DESC LIMIT 100`, [p.id]);

    const [sum] = await this.db.query<any>(
      `SELECT coalesce(sum(amount) FILTER (WHERE state='PENDING'),0) AS pending,
              coalesce(sum(amount) FILTER (WHERE state='BILLED'),0)  AS billed,
              coalesce(sum(amount) FILTER (WHERE state='VOIDED'),0)  AS voided
         FROM lead_fees WHERE partner_id = $1`, [p.id]);

    return { summary: sum, rows, unpaidCap: Number(p.unpaidCap),
      note: '리드를 열 때 확인비용이 선불 충전 잔액에서 빠집니다(보너스 먼저). 반려가 인정되면 잔액으로 환급됩니다.' };
  }

  /* ── 리드 반려 신청 (T-04) — 파트너 쪽. 운영의 인정 · 기각은 partner-admin.service.ts ── */

  /** 파트너: 반려 신청. 자격은 DB 가 봅니다. */
  async disputeFee(feeId: string, dto: { reasonCode: string; reason: string; evidence?: string }) {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    if (!/^\d+$/.test(feeId)) throw new PolicyViolation('BAD_ID', '이용료 번호가 올바르지 않습니다.');
    /* 20261006 (v10.20 · G-118) — 「이미 신청했는지」는 **내 신청**만 봅니다.
     *   전에는 이용료 번호만으로 찾아, 남의 이용료에 반려 신청이 있으면 409(이미 신청)로,
     *   없으면 422(내 이용료가 아닙니다)로 답했습니다 — 남의 이용료에 신청이 있는지를 응답으로 알 수 있었습니다.
     *   이제 남의 이용료 · 없는 번호는 신청 유무와 관계없이 DB 트리거(fn_lead_fee_dispute_guard)의
     *   같은 거절 「내 이용료가 아닙니다」로 끝납니다(트리거는 fee_id 유일 제약보다 먼저 돕니다). */
    const [dup] = await this.db.query<any>(
      'SELECT state FROM lead_fee_disputes WHERE fee_id = $1 AND partner_id = $2', [feeId, p.id]);
    if (dup) throw new StateConflict('ALREADY_REQUESTED', '이미 반려를 신청한 이용료입니다. 한 건에 한 번만 신청할 수 있습니다.');
    const [row] = await this.db.query<any>(
      `INSERT INTO lead_fee_disputes(fee_id, partner_id, reason_code, reason, evidence)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, fee_id AS "feeId", state, created_at AS "requestedAt"`,
      [feeId, p.id, dto.reasonCode, dto.reason.trim(), dto.evidence?.trim() || null]);
    return { ...row, note: '접수했습니다. 운영이 확인해 인정하면 확인비용이 잔액으로 환급됩니다.' };
  }

  /** 파트너: 내 반려 신청. */
  async myDisputes() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    return this.db.query(
      `SELECT x.id, x.fee_id AS "feeId", x.state, x.reason_code AS "reasonCode",
              x.reason, x.evidence, x.created_at AS "requestedAt",
              x.rule_code AS "ruleCode", x.decision_reason AS "decisionReason",
              x.decided_at AS "decidedAt", f.amount, l.summary
         FROM lead_fee_disputes x
         JOIN lead_fees f ON f.id = x.fee_id
         JOIN lead_deliveries d ON d.id = f.delivery_id
         JOIN leads l ON l.id = d.lead_id
        WHERE x.partner_id = $1
        ORDER BY x.created_at DESC LIMIT 100`, [p.id]);
  }

  /* ── 파트너센터 조회 ──────────────────────────────────────────────
   * 전부 `this.mine()` 로 자기 파트너를 잡고 시작합니다 —
   * 남의 실적·단가가 보이면 담합의 재료가 됩니다.
   * ─────────────────────────────────────────────────────────────── */

  /** 승인·반려 이력. 사유 없는 반려는 없습니다. */
  async myReviews() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    return this.db.query(
      `SELECT s.id, s.title, s.status,
              s.reject_reason AS "rejectReason",
              s.created_at AS "createdAt",
              c.name AS "categoryName"
         FROM partner_services s
         LEFT JOIN categories c ON c.id = s.category_id
        WHERE s.partner_id = $1
        ORDER BY s.created_at DESC LIMIT 100`, [p.id]);
  }

  /**
   * 정산 (SB-PTC-CTR-410) — v10.31 (W5 · 10/10 시안 기준) 「성사된 소개의 정산 내역과 수령 계좌 · 세금계산서」
   *
   *   정산 내역  회사가 이 파트너에게 **실제로 지급하는** 정산(partner_settlements — 지급 데스크 · 두 사람 확인)과 그 기간의 성사(확정 주문) 건수.
   *   수령 계좌  partner_settlement_accounts(1원 인증 — 제휴 정산과 같은 계좌 · 같은 API)
   *   세금계산서 지급 정산의 세금계산서(partner_invoices) + 리드 이용료 세금계산서 발행 요청(lead_cash_invoices)
   *              + v10.33 법률 · 세무 정액 노출료 세금계산서(consult_directory_invoices · kind DIRECTORY)
   * 소개비는 여기 없습니다 — 당사자끼리 직접(INV-9R). 리드 이용료(충전 · 차감)는 「리드 이용료」 화면입니다.
   * 전에 이 화면에 있던 리드 이용료 합계(unpaid · billed · voided · months)는 그대로 함께 냅니다(옛 화면 호환).
   */
  async mySettlement() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const [sum] = await this.db.query<any>(
      `SELECT coalesce(sum(amount) FILTER (WHERE state='PENDING'),0)::bigint AS unpaid,
              coalesce(sum(amount) FILTER (WHERE state='BILLED'),0)::bigint  AS billed,
              coalesce(sum(amount) FILTER (WHERE state='VOIDED'),0)::bigint  AS voided,
              count(*) FILTER (WHERE state='PENDING')                        AS "unpaidCount"
         FROM lead_fees WHERE partner_id = $1`, [p.id]);
    const months = await this.db.query(
      `SELECT to_char(incurred_at AT TIME ZONE 'Asia/Seoul','YYYY-MM') AS month,
              count(*)                        AS leads,
              coalesce(sum(amount),0)::bigint AS amount
         FROM lead_fees
        WHERE partner_id = $1 AND state <> 'VOIDED'
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, [p.id]);
    const payouts = await this.db.query<any>(
      `SELECT s.id, s.track, s.period_from::text AS "from", s.period_to::text AS "to",
              to_char(s.period_to, 'YYYY-MM') AS month,
              s.gross_amount AS gross, s.withholding, s.net_amount AS net, s.state, s.paid_at AS "paidAt",
              (SELECT count(*)::int FROM partner_orders o
                WHERE o.partner_id = s.partner_id AND o.attributed AND o.state IN ('CONFIRMED','SETTLED')
                  AND o.ordered_at::date BETWEEN s.period_from AND s.period_to) AS deals
         FROM partner_settlements s
        WHERE s.partner_id = $1
        ORDER BY s.period_to DESC, s.period_from DESC LIMIT 24`, [p.id]);
    const [acc] = await this.db.query<any>(
      `SELECT bank_name AS "bankName", account_last4 AS "last4", holder_name AS "holderName",
              verified_at AS "verifiedAt", verify_stub AS "verifyStub"
         FROM partner_settlement_accounts WHERE partner_id = $1`, [p.id]);
    const invoices = await this.db.query<any>(
      `SELECT 'SETTLEMENT' AS kind, i.invoice_no AS "invoiceNo", i.issued_on AS "issuedOn", i.amount AS total,
              NULL::bigint AS supply, NULL::bigint AS vat, 'ISSUED' AS state,
              to_char(s.period_to, 'YYYY-MM') AS month, NULL::text AS "etaxStatus", NULL::text AS "approvalNo"
         FROM partner_invoices i JOIN partner_settlements s ON s.id = i.settlement_id
        WHERE s.partner_id = $1
       UNION ALL
       /* v10.34 (D093) — 운영 법인이 발행하는 두 가지는 국세청 전송 상태 · 승인번호를 함께. 번호 칸 = 승인번호(있으면) · 손으로 넣은 번호.
          간주 발행은 내부 번호를 싣지 않음(「전송 대기 — 연동 전」) */
       SELECT 'LEAD_CASH', CASE WHEN etax_approval_no IS NOT NULL THEN substr(etax_approval_no,1,8)||'-'||substr(etax_approval_no,9,8)||'-'||substr(etax_approval_no,17,8)
                                WHEN etax_mode = 'ASSUMED' THEN NULL ELSE invoice_no END, issued_on, total, supply, vat, state, ym,
              etax_status, etax_approval_no
         FROM lead_cash_invoices WHERE partner_id = $1
       UNION ALL
       /* v10.33 (D092) — 법률 · 세무 정액 노출료(입금 확인마다 1건 · 공급자 = 운영 법인) */
       SELECT 'DIRECTORY', CASE WHEN etax_approval_no IS NOT NULL THEN substr(etax_approval_no,1,8)||'-'||substr(etax_approval_no,9,8)||'-'||substr(etax_approval_no,17,8)
                                WHEN etax_mode = 'ASSUMED' THEN NULL ELSE invoice_no END, issued_on, total, supply, vat, state,
              to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM'), etax_status, etax_approval_no
         FROM consult_directory_invoices WHERE partner_id = $1
        ORDER BY 8 DESC, 1 LIMIT 48`, [p.id]);
    const [pd] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'affiliate.payout_day'`);
    return { ...sum, unpaidCap: p.unpaidCap, months,
      payouts: payouts.map((r) => ({ ...r, gross: Number(r.gross), withholding: Number(r.withholding), net: Number(r.net) })),
      account: acc ?? null,
      invoices: invoices.map((r) => ({ ...r, total: Number(r.total), supply: r.supply != null ? Number(r.supply) : null, vat: r.vat != null ? Number(r.vat) : null,
        approvalNo: r.approvalNo ? `${r.approvalNo.slice(0, 8)}-${r.approvalNo.slice(8, 16)}-${r.approvalNo.slice(16)}` : null })),
      payoutDay: Number(pd?.value ?? 10),
      note: '회사가 지급하는 정산입니다. 확정되면 익월 지급일에 인증된 수령 계좌로 보냅니다(원천징수 3.3%). 소개비는 당사자끼리 직접 주고받아 여기 없습니다.' };
  }

  /** 실적과 등급. 등급이 오르면 같은 리드를 더 싸게 받습니다. */
  async myStats() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const [n] = await this.db.query<any>(
      /* 성사 여부는 lead_deliveries 에 없습니다 — 이용료가 확정된 것을
         "열람해서 값을 치른 건" 으로 셉니다. 실제 계약 성사는 deals 쪽이라
         파트너 단위로는 여기까지가 확실한 숫자입니다. */
      `SELECT count(*)                                      AS received,
              count(*) FILTER (WHERE d.viewed_at IS NOT NULL) AS viewed,
              count(*) FILTER (WHERE f.state = 'BILLED')      AS billed
         FROM lead_deliveries d
         LEFT JOIN lead_fees f ON f.delivery_id = d.id
        WHERE d.partner_id = $1`, [p.id]);
    const rates = await this.db.query(
      `SELECT grade, rate, label, alim_band AS "alimBand", note FROM lead_grade_rates
        WHERE gwan_code IS NULL ORDER BY rank`);
    /* v10.31 (W5 · CTR-500) — 8등급 분포: 등급별 받은 건수 · 확인비용 합계(무효 뺌). 등급이 없는 리드(알림톡 연동 전)는 「미판정」 */
    const dist = await this.db.query<any>(
      `SELECT r.grade, r.label, r.rank, count(d.id)::int AS count, coalesce(sum(f.amount) FILTER (WHERE f.state <> 'VOIDED'),0)::bigint AS fee
         FROM lead_grade_rates r
         LEFT JOIN leads l ON l.grade = r.grade
         LEFT JOIN lead_deliveries d ON d.lead_id = l.id AND d.partner_id = $1 AND d.state <> 'REVOKED'
         LEFT JOIN lead_fees f ON f.delivery_id = d.id
        WHERE r.gwan_code IS NULL
        GROUP BY r.grade, r.label, r.rank
       UNION ALL
       SELECT NULL, '미판정', 99, count(d.id)::int, coalesce(sum(f.amount) FILTER (WHERE f.state <> 'VOIDED'),0)::bigint
         FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id
         LEFT JOIN lead_fees f ON f.delivery_id = d.id
        WHERE d.partner_id = $1 AND d.state <> 'REVOKED' AND l.grade IS NULL
        ORDER BY 3`, [p.id]);
    const [done] = await this.db.query<any>(
      `SELECT count(*) FILTER (WHERE consumer_state = 'CONFIRMED')::int AS confirmed,
              count(*)::int AS reported
         FROM partner_fulfillment_reports WHERE partner_id = $1`, [p.id]);
    const viewed = Number(n?.viewed ?? 0);
    return { grade: p.grade, ...n, rates,
      dist: dist.map((x: any) => ({ ...x, fee: Number(x.fee) })),
      confirmed: done?.confirmed ?? 0, reported: done?.reported ?? 0,
      convRate: viewed ? Math.round(((done?.confirmed ?? 0) / viewed) * 1000) / 10 : null };
  }

  /** 신뢰지표. 낮으면 리드가 덜 옵니다. */
  async myTrust() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const [t] = await this.db.query<any>(
      `SELECT count(*)                                      AS total,
              count(*) FILTER (WHERE viewed_at IS NOT NULL) AS viewed,
              /* 받고 나서 얼마나 빨리 여는가 — 요청자는 그동안 기다립니다 */
              round(avg(EXTRACT(epoch FROM (viewed_at - delivered_at)) / 60)
                    FILTER (WHERE viewed_at IS NOT NULL))::int AS "avgViewMin"
         FROM lead_deliveries WHERE partner_id = $1`, [p.id]);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    /* v10.31 (W5 · CTR-600) — 조건이 만드는 신뢰 배지(조회할 때 실제 자료로 셈 — 조건이 사라지면 바로 내려감) */
    const badges = await this.db.query<any>(
      `SELECT code, name, state, detail FROM fn_partner_badges($1) ORDER BY sort_order`, [p.id]);
    return { ...t, viewRate: pct(t?.viewed ?? 0, t?.total ?? 0), badges };
  }

  /**
   * 내 단가표 (SB-PTC-CTR-900) — v10.31 (W5 · 시안 「카테고리 · 단가 폼 · 구간 · 상태」 + 「소개비 보상표」)
   *   단가 폼 = 업종의 등록 방식(categories.service_form) · 구간 = 매트릭스 축 수 / 건당 / 월 요금 …
   *   기준가 = 업종 기준 단가(없으면 기본 단가) · 내 단가 = 내가 정한 최고 확인비용(S 등급) — 없으면 기준가
   *   ★ 남의 단가는 보이지 않습니다(담합의 재료). 도입가인 동안은 바뀔 수 있습니다.
   */
  async myPricing() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const rows = await this.db.query<any>(
      `WITH d AS (SELECT (SELECT value::numeric FROM site_settings WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$') AS dfee)
       SELECT c.id AS "categoryId", c.name AS "categoryName", c.gwan_code AS "gwanCode", c.service_form AS "formType",
              (SELECT count(*) FROM category_matrix_axes a WHERE a.category_id = c.id AND a.axis_type = 'ROW' AND a.is_active)::int AS "rows",
              (SELECT count(*) FROM category_matrix_axes a WHERE a.category_id = c.id AND a.axis_type = 'COL' AND a.is_active)::int AS "cols",
              coalesce(c.lead_fee, d.dfee) AS "baseFee", (c.lead_fee IS NULL) AS "baseIsDefault",
              max(s.top_fee) AS "topFee",
              coalesce(max(s.top_fee), c.lead_fee, d.dfee) AS "myFee",
              (SELECT count(*) FROM partner_service_matrix m JOIN partner_services s2 ON s2.id = m.service_id
                WHERE s2.partner_id = $1 AND s2.category_id = c.id)::int AS "matrixCells",
              c.lead_fee_provisional AS provisional
         FROM partner_services s
         JOIN categories c ON c.id = s.category_id
         CROSS JOIN d
        WHERE s.partner_id = $1 AND s.status = 'APPROVED'
        GROUP BY c.id, d.dfee
        ORDER BY c.gwan_code, c.name`, [p.id]);
    const FORM: Record<string, string> = { MATRIX: '매트릭스 견적', CONTRACT: '계약 성사형', CONSULT: '상담형',
      RENTAL: '약정 월요금형', PAYMENT: '결제형(레거시)', MEDICAL: '의료 심의 트랙' };
    return rows.map((r) => {
      const form = r.formType as string | null;
      const range = !form ? '—'
        : form === 'MATRIX' ? (r.rows && r.cols ? `${r.rows}×${r.cols} 구간` : '구간 미정')
        : form === 'RENTAL' ? '월 요금' : form === 'MEDICAL' ? '시술별' : '건당';
      const state = !form ? 'NO_FORM'
        : form === 'MATRIX' && !(r.rows && r.cols) ? 'NO_AXES'
        : form === 'MATRIX' && r.matrixCells === 0 ? 'EMPTY'
        : r.provisional ? 'PROVISIONAL' : 'SET';
      return { ...r, formLabel: form ? FORM[form] ?? form : '미정', range, state,
        baseFee: r.baseFee != null ? Number(r.baseFee) : null, myFee: r.myFee != null ? Number(r.myFee) : null,
        topFee: r.topFee != null ? Number(r.topFee) : null };
    });
  }

  /** v10.31 (W5 · CTR-900) — 소개비 보상표 · 등급별 확인비용(최고 확인비용 × 비율) */
  async myRewards() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const rows = await this.db.query<any>(
      `SELECT s.id, s.title, c.name AS "categoryName", s.status,
              coalesce(s.top_fee, c.lead_fee, (SELECT value::numeric FROM site_settings WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$')) AS "topFee",
              (s.top_fee IS NOT NULL) AS "topFeeSet",
              s.referral_rate AS "referralRate", s.rebate_bonus AS "rebateBonus"
         FROM partner_services s LEFT JOIN categories c ON c.id = s.category_id
        WHERE s.partner_id = $1 AND s.status IN ('APPROVED','IN_REVIEW','SUSPENDED')
        ORDER BY s.created_at DESC`, [p.id]);
    const rates = await this.db.query<any>(
      `SELECT grade, label, rate FROM lead_grade_rates WHERE gwan_code IS NULL ORDER BY rank`);
    return { items: rows.map((r) => ({ ...r, topFee: r.topFee != null ? Number(r.topFee) : null,
        referralRate: r.referralRate != null ? Number(r.referralRate) : null,
        rebateBonus: r.rebateBonus != null ? Number(r.rebateBonus) : null })),
      rates: rates.map((r) => ({ ...r, rate: Number(r.rate) })),
      note: '성사 소개비 · 재소개 보너스는 파트너가 소개자에게 약속하는 조건입니다 — 소개비는 당사자끼리 직접 주고받고 회사를 거치지 않습니다(INV-9).' };
  }

  /** 공지·알림. v10.31 (W5 · CTR-700) — 분류(리드 · 검수 · 리드 이용료 · 정산 · 공지)와 「보기」가 갈 화면을 함께 냅니다 */
  async myNotices() {
    const me = RequestCtx.actorId()!;
    const rows = await this.db.query<any>(
      `SELECT id, title, body, event_code AS "eventCode",
              link_url AS "linkUrl",      -- v10.27 (G-130) — 알림의 「보기」가 가는 화면(넣을 때 이미 저장하던 값)
              created_at AS "createdAt", read_at AS "readAt"
         FROM notifications
        WHERE account_id = $1
        ORDER BY created_at DESC LIMIT 50`, [me]);
    return rows.map((r) => {
      const code = String(r.eventCode ?? '');
      const kind = /LEAD_FEE|LEADCASH|CASH|REJECT/.test(code) ? '리드 이용료'
        : /LEAD/.test(code) ? '리드'
        : /SERVICE|REVIEW|QUAL|BROKER|PARTNER_(APPROVED|REJECTED)/.test(code) ? '검수'
        : /SETTLE|PAYOUT|INVOICE/.test(code) ? '정산' : '공지';
      const fallback: Record<string, string> = { '리드 이용료': '/partner/cash', '리드': '/partner/leads', '검수': '/partner/services', '정산': '/partner/settlement', '공지': '/partner/notices' };
      return { ...r, kind, goUrl: r.linkUrl || fallback[kind] };
    });
  }

  /** v10.31 (W5 · CTR-700) — 모두 읽음 · 한 건 읽음 (내 알림만) */
  async readNotices(id?: string) {
    const me = RequestCtx.actorId()!;
    if (id !== undefined && !/^\d+$/.test(id)) throw new NotFound('알림이 없습니다.');
    const rows = await this.db.query<{ id: string }>(
      `UPDATE notifications SET read_at = now()
        WHERE account_id = $1 AND read_at IS NULL AND ($2::bigint IS NULL OR id = $2::bigint)
       RETURNING id`, [me, id ?? null]);
    return { ok: true, read: rows.length };
  }

  /** 내 중개사 인증 상태. */
  async myBroker() {
    const me = RequestCtx.actorId()!;
    const assumed = await assumeOn(this.db, 'broker', false);
    const [r] = await this.db.query<any>(
      `SELECT v.license_no AS "licenseNo", v.office_name AS "officeName",
              v.ceo_name AS "ceoName", v.state, v.lookup_result AS "lookupResult",
              v.lookup_source AS "lookupSource", v.lookup_detail AS "lookupDetail",
              v.lookup_at AS "lookupAt", v.recheck_due AS "recheckDue",
              v.reject_reason AS "rejectReason", v.created_at AS "createdAt",
              v.decided_at AS "decidedAt",
              fn_is_verified_broker(b.account_id) AS "canPublish"
         FROM broker_verifications v
         JOIN businesses b ON b.id = v.business_id
        WHERE b.account_id = $1
        ORDER BY v.created_at DESC LIMIT 1`, [me]);
    return { applied: !!r, assumed,
      lookupConfigured: resolveBrokerLookupProvider().configured, ...(r ?? {}) };
  }

  /**
   * 중개사 인증 신청.
   *
   * D008 — 국토부 조회가 설정돼 있으면(BROKER_LOOKUP_URL · KEY) **실제로 대조**하고 결과를
   * lookup_result · lookup_detail 에 남깁니다(lookup_source='API'). 설정이 없으면 예전처럼
   * `assume.broker` 로 대조를 건너뛰고(lookup_source='ASSUMED'), 건너뛴 사실이 남아
   * **나중에 진짜 대조가 안 된 건을 찾을 수 있습니다**(v_broker_verified_assumed).
   * 조회 실패(지연 · 장애)는 결격이 아닙니다 — 미조회로 두고 운영이 다시 조회합니다.
   */
  async applyBroker(dto: { licenseNo: string; officeName: string; ceoName: string }) {
    const me = RequestCtx.actorId()!;
    /* v10.38 (D096 · P2P) — 공인중개사 인증은 개인(본인인증)도 신청합니다. 인증 대상은 개설등록번호입니다 */
    const actor = await this.actors.actor(me, true);
    const biz = actor?.ok ? { id: actor.id } : null;
    if (!biz) throw new StateConflict('IDENTITY_REQUIRED', '본인인증(또는 사업자 인증)이 먼저 필요합니다.');

    const [cur] = await this.db.query<any>(
      `SELECT state FROM broker_verifications WHERE business_id = $1`, [biz.id]);
    if (cur && !['REJECTED', 'EXPIRED'].includes(cur.state)) {
      throw new StateConflict('ALREADY_APPLIED',
        '이미 신청하셨습니다. 심사 중이거나 인증이 끝난 건은 다시 내지 않습니다.');
    }

    const assumeBroker = await assumeOn(this.db, 'broker', false);
    const input = { licenseNo: dto.licenseNo.trim(), officeName: dto.officeName.trim(), ceoName: dto.ceoName.trim() };

    /* 외부 조회는 트랜잭션 밖에서 합니다 — 기관이 느려도 DB 잠금을 쥐고 기다리지 않게 */
    const provider = resolveBrokerLookupProvider();
    let lookup: string | null = null, source: string | null = null, detail: string, stub = false;
    if (provider.configured) {
      const r = await provider.lookup(input);
      lookup = r.result; source = r.result ? 'API' : null; detail = r.detail;
    } else if (assumeBroker) {
      /* 간주 모드에서는 대조를 MATCH 로 두되, 승인은 여전히 사람이 합니다.
         자동 승인까지 하면 연동 뒤에도 아무도 안 봅니다. */
      stub = true; lookup = 'MATCH'; source = 'ASSUMED';
      detail = '연동 전 간주(assume.broker) — 국토부 대조를 하지 않았습니다.';
    } else {
      stub = true;
      detail = (await provider.lookup(input)).detail + ' 운영이 직접 확인합니다.';
    }

    /* 사업자당 한 건입니다(UNIQUE). 반려 · 만료된 건은 고쳐서 다시 낼 수 있게
     * 같은 행을 새 신청으로 되돌립니다 — 전에는 INSERT 가 UNIQUE 에 걸려
     * "다시 신청하기" 가 500 이었습니다. 심사 중 · 인증 완료면 그대로 둡니다. */
    const [row] = await this.db.query<any>(
      `INSERT INTO broker_verifications
         (business_id, license_no, office_name, ceo_name, state, lookup_result, lookup_at,
          lookup_source, lookup_detail)
       VALUES ($1,$2,$3,$4,'PENDING',$5, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $6, $7)
       ON CONFLICT (business_id) DO UPDATE
          SET license_no = EXCLUDED.license_no, office_name = EXCLUDED.office_name,
              ceo_name = EXCLUDED.ceo_name, state = 'PENDING',
              lookup_result = EXCLUDED.lookup_result, lookup_at = EXCLUDED.lookup_at,
              lookup_source = EXCLUDED.lookup_source, lookup_detail = EXCLUDED.lookup_detail,
              reject_reason = NULL, decided_by = NULL, decided_at = NULL,
              recheck_due = NULL, created_at = now()
        WHERE broker_verifications.state IN ('REJECTED','EXPIRED')
       RETURNING id, state`,
      [biz.id, input.licenseNo, input.officeName, input.ceoName, lookup, source, detail]);
    if (!row) {
      throw new StateConflict('ALREADY_APPLIED',
        '이미 신청하셨습니다. 심사 중이거나 인증이 끝난 건은 다시 내지 않습니다.');
    }

    return { ok: true, id: row.id, state: row.state, assumed: source === 'ASSUMED', stub,
      lookupResult: lookup, lookupSource: source, lookupDetail: detail,
      note: source === 'ASSUMED'
        ? '연동 전이라 국토부 대조를 건너뛰었습니다. 운영 확인 후 승인됩니다.'
        : lookup === 'MATCH' ? '국토부 등록 정보와 일치합니다. 운영 확인 후 승인됩니다.'
        : lookup ? `국토부 대조 결과가 맞지 않습니다 — ${detail} 고쳐서 다시 신청하시거나 운영 판정을 기다려 주십시오.`
        : `국토부 대조를 하지 못했습니다 — ${detail}` };
  }
}
