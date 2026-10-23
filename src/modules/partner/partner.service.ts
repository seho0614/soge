import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolveBrokerLookupProvider } from './broker-lookup.provider';
import { normSido } from '../../common/region';
import { PartnerActorService } from './partner-actor.service';
import { assumeOn } from '../../common/integration/switches';
import { myPartner } from './partner-shared';

/**
 * 파트너센터.
 *
 * v10.45 (2026-10-16 · 리팩토링) — 운영 화면용(adm*: 입점 심사 · 서비스 검수 · 이용료 무효 · 반려 신청 처리)은 partner-admin.service.ts 로 나눴습니다.
 * v10.86 (리팩토링) — 리드(요청 열람)는 partner-lead.service.ts, 이용료 · 이의 · 정산 · 가격 · 보상은 partner-money.service.ts 로 나눴습니다.
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
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }
  /** 내 파트너 계정(없으면 null · 로그인 안 했으면 막음) — partner-shared.ts 한 곳 */
  private mine() { return myPartner(this.actors); }

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
