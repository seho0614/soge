import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { PartnerActorService } from './partner-actor.service';

/**
 * 파트너센터 — 리드 이용료 · 이의 신청 · 정산 · 가격 · 보상.
 * 무효는 위험감지가 잡은 것만입니다(partner.service.ts 머리 주석).
 * v10.86 — partner.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class PartnerMoneyService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }
  /** 내 파트너 계정. 없으면 신청 안내를 냅니다.
   *  v10.31 (W5 · CTR-610 계정) — 대표 계정 또는 합류한 직원 계정(business_members · 빠지지 않은).
   *  v10.87 — 세 서비스(핵심 · 리드 · 이용료)에 같은 본문. 매트릭스 생성기(gen-matrix)가 this.actors.forMember 의 SQL 까지 따라가게 함수로 빼지 않음 */
  private async mine() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const p = await this.actors.forMember(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!p) return null;
    const { canMoney: _money, ...mine } = p;           // 이 자리가 내보내던 칸 그대로(대시보드 응답에 펼쳐 넣음)
    return mine;
  }

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
}
