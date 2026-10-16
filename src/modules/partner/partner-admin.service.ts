import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { FORM_KO } from './partner-center.service';

/**
 * 파트너 운영(운영 화면 · PartnerAdminController).
 *
 * v10.45 (2026-10-16 · 리팩토링) — partner.service.ts 에서 옮겼습니다. 동작은 그대로입니다.
 *   입점 목록 · 카드 · 서류 · 상세 · 승인 · 반려, 서비스 검수, 이용료 무효, 리드 반려 신청 인정 · 기각, 이용료 현황.
 *   운영 판정은 notifyPartner 로 신청자에게 알립니다.
 */
@Injectable()
export class PartnerAdminService {
  constructor(private readonly db: DatabaseService) {}

  /** 운영 판정을 신청자에게 알립니다 — 결과를 모르면 같은 것을 또 냅니다. */
  private async notifyPartner(partnerId: string, code: string, title: string, body: string, link: string) {
    await this.db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT b.account_id, $2, $3, $4, $5
         FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1`,
      [partnerId, code, title, body, link]);
  }


  admList() {
    return this.db.query(
      `SELECT p.id, b.company_name AS "company", b.biz_reg_no AS "bizRegNo",
              p.grade, p.status,
              (SELECT count(*) FROM partner_services s
                WHERE s.partner_id = p.id AND s.status='APPROVED') AS "services",
              coalesce((SELECT sum(f.amount) FROM lead_fees f
                 WHERE f.partner_id = p.id AND f.state='PENDING'),0) AS "unpaid",
              p.unpaid_cap AS "unpaidCap",
              p.applied_at AS "appliedAt",
              (b.verified_at IS NOT NULL) AS "bizVerified", (b.kind = 'PERSON') AS "personal", fn_actor_ok(b.id) AS "actorOk",
              CASE WHEN p.status = 'REJECTED' THEN p.suspended_reason END AS "rejectReason"
         FROM partners p JOIN businesses b ON b.id = p.business_id
        ORDER BY p.applied_at DESC`);
  }

  /**
   * v10.32 — SB-ADM-PTN-010 시안 「입점 파트너사」 카드 줄(읽기 전용 · GET /admin/partners/cards).
   * 목록(GET /admin/partners)에 없는 칸만 따로 냅니다 — 받은 리드 수 · 리드 이용료 잔액(선불 충전 잔액 + 보너스) ·
   * 대표 업종(승인 · 검수 중 서비스가 가장 많이 걸린 업종) · 그 업종의 등록 방식 · 걸린 자격 심사.
   */
  async admCards() {
    const rows = await this.db.query<any>(
      `SELECT p.id,
              (SELECT count(*)::int FROM lead_deliveries d WHERE d.partner_id = p.id) AS "leads",
              coalesce((SELECT w.paid_balance + w.bonus_balance FROM lead_cash_wallets w WHERE w.partner_id = p.id), 0)::bigint AS "cash",
              c.name AS "category", c.service_form AS "form",
              (SELECT q.state FROM qualification_reviews q WHERE q.business_id = p.business_id AND q.state = 'PENDING' LIMIT 1) AS "qualPending",
              (SELECT r.category_name FROM qualification_reviews q JOIN qualification_rules r ON r.category_code = q.category_code
                WHERE q.business_id = p.business_id AND q.state = 'PENDING' LIMIT 1) AS "qualName"
         FROM partners p
         LEFT JOIN LATERAL (
           SELECT c.name, c.service_form FROM partner_services s JOIN categories c ON c.id = s.category_id
            WHERE s.partner_id = p.id GROUP BY c.id, c.name, c.service_form ORDER BY count(*) DESC, c.name LIMIT 1) c ON true`);
    return rows.map((r) => ({ id: r.id, leads: r.leads, cash: Number(r.cash), category: r.category ?? null,
      form: r.form ?? null, formLabel: r.form ? FORM_KO[r.form] ?? r.form : null,
      qualPending: !!r.qualPending, qualName: r.qualName ?? null }));
  }

  /**
   * v10.32 — SB-ADM-PTN-011 시안 「계약 · 서류」 표(읽기 전용 · GET /admin/partners/:id/docs).
   *   파트너 이용약관(terms audience=PARTNER) 최근 동의 · 국세청 사업자 상태 조회 · 업종 자격 심사(qualification_reviews).
   */
  async admDocs(partnerId: string) {
    const [p] = await this.db.query<any>(
      `SELECT p.id, p.status, b.id AS "businessId", b.account_id AS "accountId", b.nts_status AS "ntsStatus",
              b.nts_checked_at AS "ntsCheckedAt", b.nts_env AS "ntsEnv", b.verified_at AS "verifiedAt"
         FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1`, [partnerId]);
    if (!p) throw new NotFound('파트너가 없습니다.');
    const [terms, quals] = await Promise.all([
      this.db.query<any>(
        `SELECT t.code, t.version, t.title,
                (SELECT a.agreed_at FROM term_agreements a
                  WHERE a.account_id = $1 AND a.term_code = t.code AND a.term_version = t.version AND a.agreed
                  ORDER BY a.agreed_at DESC LIMIT 1) AS "agreedAt"
           FROM terms t WHERE t.audience = 'PARTNER' AND t.status = 'PUBLISHED'
          ORDER BY t.display_order, t.code`, [p.accountId]),
      this.db.query<any>(
        `SELECT q.category_code AS "code", r.category_name AS "name", q.state, q.decided_at AS "decidedAt", q.created_at AS "createdAt"
           FROM qualification_reviews q JOIN qualification_rules r ON r.category_code = q.category_code
          WHERE q.business_id = $1 ORDER BY q.created_at DESC`, [p.businessId]),
    ]);
    return {
      partnerId: p.id, status: p.status,
      terms: terms.map((t) => ({ code: t.code, version: t.version, title: t.title, agreedAt: t.agreedAt ?? null })),
      nts: { status: p.ntsStatus ?? null, checkedAt: p.ntsCheckedAt ?? null, env: p.ntsEnv ?? null, verifiedAt: p.verifiedAt ?? null },
      qualifications: quals,
    };
  }

  /**
   * v10.27 (G-130) — 운영 파트너사 상세. 목록의 「상세」가 여는 화면입니다(전에는 목록만 있었음).
   * 사업자 · 등급 · 상태 · 승인 서비스 · 서비스 지역 · 리드 이용료(상태별 건수 · 합계) · 미납 한도.
   */
  async admDetail(partnerId: string) {
    const [p] = await this.db.query<any>(
      `SELECT p.id, b.company_name AS "company", b.biz_reg_no AS "bizRegNo", b.ceo_name AS "ceoName",
              b.nts_status AS "ntsStatus", (b.verified_at IS NOT NULL) AS "bizVerified",
              (b.kind = 'PERSON') AS "personal", fn_actor_ok(b.id) AS "actorOk",
              p.grade, p.status, p.unpaid_cap AS "unpaidCap",
              p.applied_at AS "appliedAt", p.approved_at AS "approvedAt",
              p.suspended_reason AS "suspendedReason",
              coalesce((SELECT sum(f.amount) FROM lead_fees f
                 WHERE f.partner_id = p.id AND f.state='PENDING'),0) AS "unpaid"
         FROM partners p JOIN businesses b ON b.id = p.business_id
        WHERE p.id = $1`, [partnerId]);
    if (!p) throw new NotFound('파트너가 없습니다.');
    const [services, regions, fees] = await Promise.all([
      this.db.query(
        `SELECT s.id, s.title, coalesce(c.name, '(업종 없음)') AS "category", c.gwan_code AS "gwanCode", s.status,
                s.reject_reason AS "rejectReason", s.created_at AS "createdAt"
           FROM partner_services s LEFT JOIN categories c ON c.id = s.category_id      -- 업종이 비거나 지워진 서비스도 보이게
          WHERE s.partner_id = $1 ORDER BY s.created_at DESC LIMIT 50`, [partnerId]),
      this.db.query(`SELECT sido, sigungu FROM partner_regions WHERE partner_id = $1 ORDER BY sido, sigungu`, [partnerId]),
      this.db.query(
        `SELECT state, count(*)::int AS "count", coalesce(sum(amount),0)::bigint AS "amount"
           FROM lead_fees WHERE partner_id = $1 GROUP BY state ORDER BY state`, [partnerId]),
    ]);
    return { ...p, unpaid: Number(p.unpaid), unpaidCap: Number(p.unpaidCap),
             stopped: Number(p.unpaid) >= Number(p.unpaidCap) || p.status !== 'ACTIVE',
             services, regions, fees: fees.map((f: any) => ({ ...f, amount: Number(f.amount) })) };
  }

  /** 입점 승인. 인증되지 않은 사업자는 DB 가 막습니다. */
  async admApprove(partnerId: string) {
    const [row] = await this.db.query<any>(
      `UPDATE partners SET status='ACTIVE', approved_at=now(), approved_by=$2
        WHERE id=$1 AND status='APPLIED' RETURNING id, status`,
      [partnerId, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_APPLIED', '심사 대기 중인 파트너가 아닙니다.');
    return row;
  }

  /**
   * 입점 반려. 사유는 신청자에게 그대로 보이고, 고쳐서 다시 신청할 수 있습니다.
   * 사유 없는 반려는 DB 가 막습니다(D003 trg_partner_reject_guard).
   */
  async admReject(partnerId: string, reason: string) {
    if (!reason?.trim()) {
      throw new PolicyViolation('REASON_REQUIRED',
        '반려에는 무엇을 갖춰야 다시 신청할 수 있는지까지 적어야 합니다.');
    }
    const [row] = await this.db.query<any>(
      `UPDATE partners SET status='REJECTED', suspended_reason=$2,
              approved_at=NULL, approved_by=NULL
        WHERE id=$1 AND status='APPLIED'
      RETURNING id, status, suspended_reason AS "rejectReason"`,
      [partnerId, reason.trim()]);
    if (!row) throw new StateConflict('NOT_APPLIED', '심사 대기 중인 파트너가 아닙니다.');
    await this.notifyPartner(partnerId, 'PARTNER_REJECTED', '입점 신청이 반려되었습니다',
      `사유: ${reason.trim()} — 고쳐서 다시 신청하실 수 있습니다.`, '/partner/apply');
    return { ...row, note: '반려했습니다. 사유가 신청자에게 보이고, 고쳐서 다시 신청할 수 있습니다.' };
  }

  /**
   * 검수 대기 서비스 (SB-ADM-PTN-030).
   *
   * 판단에 필요한 것을 함께 냅니다 — 파트너 상태, 분야의 제한업종 · 규제 자격,
   * 같은 파트너의 반려 이력. 서비스 번호를 받아 적어 처리하던 것을 대신합니다.
   */
  admPendingServices() {
    return this.db.query(
      `SELECT s.id, s.title, s.body, s.status, s.created_at AS "submittedAt",
              p.id AS "partnerId", p.status AS "partnerStatus", p.grade,
              b.company_name AS "company", b.biz_reg_no AS "bizRegNo",
              c.name AS "categoryName", c.gwan_code AS "gwanCode",
              c.restricted_code AS "restrictedCode", c.lead_fee AS "leadFee",
              qr.category_code AS "qualCode", qv.state AS "qualState",
              (SELECT count(*)::int FROM partner_services s2
                WHERE s2.partner_id = p.id AND s2.status = 'REJECTED') AS "rejectedBefore",
              (SELECT count(*)::int FROM partner_services s3
                WHERE s3.partner_id = p.id AND s3.status = 'APPROVED') AS "approvedBefore"
         FROM partner_services s
         JOIN partners p   ON p.id = s.partner_id
         JOIN businesses b ON b.id = p.business_id
         LEFT JOIN categories c ON c.id = s.category_id
         LEFT JOIN qualification_rules qr ON qr.category_code = c.code AND qr.is_active
         LEFT JOIN qualification_reviews qv
                ON qv.business_id = b.id AND qv.category_code = qr.category_code
        WHERE s.status = 'IN_REVIEW'
        ORDER BY s.created_at`);
  }

  async admReviewService(serviceId: string, approve: boolean, reason?: string) {
    if (!approve && !reason?.trim()) {
      // 반려 사유는 이용자에게 그대로 보입니다.
      // "부적절"만 쓰면 같은 것을 다시 내고 검수 큐가 그만큼 늘어납니다.
      throw new PolicyViolation('REASON_REQUIRED',
        '반려에는 무엇을 고쳐야 하는지까지 적어야 합니다.');
    }
    /* v10.31 — 처리 이력(partner_service_events)에 처리한 사람이 남게 같은 거래에서 표시합니다 */
    const row = await this.db.transaction(async () => {
      await this.db.query(`SELECT set_config('app.actor_id', $1, true)`, [RequestCtx.actorId() ?? '']);
      const [r] = await this.db.query<any>(
        `UPDATE partner_services
            SET status = $2, reject_reason = $3
          WHERE id = $1 AND status = 'IN_REVIEW'
        RETURNING id, status, partner_id AS "partnerId", title`,
        [serviceId, approve ? 'APPROVED' : 'REJECTED', approve ? null : reason]);
      return r;
    });
    if (!row) throw new StateConflict('NOT_IN_REVIEW', '검수 대기 중인 서비스가 아닙니다.');
    await this.notifyPartner(row.partnerId, approve ? 'PARTNER_SERVICE_APPROVED' : 'PARTNER_SERVICE_REJECTED',
      approve ? '서비스가 승인되었습니다' : '서비스가 반려되었습니다',
      approve ? `「${row.title}」 — 노출을 시작합니다.` : `「${row.title}」 — 사유: ${reason}`,
      `/partner/services/${row.id}`).catch(() => undefined);
    return { id: row.id, status: row.status };
  }

  /**
   * 이용료 무효.
   *
   * **위험감지 규칙 근거가 필요합니다.** 당사자 간 상담 결렬은 무효 사유가
   * 아닙니다 — 그것까지 판정하면 플랫폼이 거래 당사자가 됩니다.
   * 근거 없는 무효는 "봐주기"가 되고, 그러면 기준이 사라집니다.
   */
  async admVoidFee(feeId: string, ruleCode: string) {
    if (!ruleCode) {
      throw new PolicyViolation('RULE_REQUIRED',
        '무효에는 위험감지 규칙 근거가 필요합니다.');
    }
    const [row] = await this.db.query<any>(
      `UPDATE lead_fees SET state='VOIDED', void_rule=$2
        WHERE id=$1 AND state <> 'VOIDED'
      RETURNING id, state, amount, void_rule AS "voidRule"`, [feeId, ruleCode]);
    if (!row) throw new StateConflict('NOT_VOIDABLE', '무효로 바꿀 수 없는 건입니다.');
    /* 반려 신청이 걸려 있던 건이면 인정으로 닫습니다 — 안 닫으면 목록에 남아
     * 같은 건을 두 번 판정하게 됩니다. */
    await this.db.query(
      `UPDATE lead_fee_disputes SET state='ACCEPTED', rule_code=$2, decided_by=$3
        WHERE fee_id=$1 AND state='REQUESTED'`, [feeId, ruleCode, RequestCtx.actorId()]);
    return { ...row,
      note: '거래 자체가 없던 것이 됩니다. 선불로 차감한 건이면 잔액으로 환급되고(D070), 전환 전 후불 청구분이면 다음 청구에서 뺍니다.' };
  }

  /* ── 리드 반려 신청 (T-04) ──────────────────────────────────────
   * 파트너 신청 → 운영 인정(무효) · 기각. 자격(72시간 · 1회 · 월 15%)은
   * DB 트리거가 봅니다(D003) — 여기서 다시 판정하지 않습니다.
   * ─────────────────────────────────────────────────────────────── */

  /** 반려 신청 목록. state 가 없으면 대기(REQUESTED)만. */
  async admVoidRequests(state?: string) {
    const st = (state ?? 'REQUESTED').toUpperCase();
    if (!['REQUESTED', 'ACCEPTED', 'DISMISSED', 'ALL'].includes(st)) {
      throw new PolicyViolation('BAD_STATE', 'state 는 REQUESTED · ACCEPTED · DISMISSED · ALL 중 하나입니다.');
    }
    const items = await this.db.query(
      `SELECT x.id, x.fee_id AS "feeId", x.state, x.reason_code AS "reasonCode",
              x.reason, x.evidence, x.created_at AS "requestedAt",
              x.rule_code AS "ruleCode", x.decision_reason AS "decisionReason",
              x.decided_at AS "decidedAt", da.email AS "decidedBy",
              f.amount, f.state AS "feeState", f.incurred_at AS "incurredAt",
              d.delivered_at AS "deliveredAt", d.viewed_at AS "viewedAt",
              l.summary, l.sido, l.sigungu, c.name AS "categoryName",
              p.id AS "partnerId", b.company_name AS "company", p.grade,
              /* 월 한도 판단 근거: 당월 수신 · 당월 신청 */
              (SELECT count(*)::int FROM lead_deliveries d2
                WHERE d2.partner_id = p.id
                  AND d2.delivered_at >= date_trunc('month', x.created_at)
                  AND d2.delivered_at <  date_trunc('month', x.created_at) + interval '1 month') AS "monthReceived",
              (SELECT count(*)::int FROM lead_fee_disputes x2
                WHERE x2.partner_id = p.id
                  AND date_trunc('month', x2.created_at) = date_trunc('month', x.created_at)) AS "monthRequested"
         FROM lead_fee_disputes x
         JOIN lead_fees f       ON f.id = x.fee_id
         JOIN lead_deliveries d ON d.id = f.delivery_id
         JOIN leads l           ON l.id = d.lead_id
         LEFT JOIN categories c ON c.id = l.category_id
         JOIN partners p        ON p.id = x.partner_id
         JOIN businesses b      ON b.id = p.business_id
         LEFT JOIN accounts da  ON da.id = x.decided_by
        WHERE ($1 = 'ALL' OR x.state = $1)
        ORDER BY CASE WHEN x.state = 'REQUESTED' THEN 0 ELSE 1 END,
                 x.created_at ${st === 'REQUESTED' ? 'ASC' : 'DESC'}
        LIMIT 200`, [st]);
    const rules = await this.db.query(
      `SELECT code, name FROM risk_rules WHERE is_active ORDER BY sort_order, code`);
    return { items, rules };
  }

  /** 인정 — 이용료가 무효가 됩니다(트리거가 같이 맞춤). 규칙 근거가 필요합니다. */
  async admAcceptVoidRequest(id: string, ruleCode: string, note?: string) {
    if (!/^\d+$/.test(id)) throw new StateConflict('NOT_REQUESTED', '대기 중인 반려 신청이 아닙니다.');
    if (!ruleCode?.trim()) {
      throw new PolicyViolation('RULE_REQUIRED', '인정에는 위험감지 규칙 근거가 필요합니다.');
    }
    const [row] = await this.db.query<any>(
      `UPDATE lead_fee_disputes
          SET state='ACCEPTED', rule_code=$2, decision_reason=$3, decided_by=$4
        WHERE id=$1 AND state='REQUESTED'
      RETURNING id, fee_id AS "feeId", partner_id AS "partnerId", state, rule_code AS "ruleCode"`,
      [id, ruleCode.trim(), note?.trim() || null, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_REQUESTED', '대기 중인 반려 신청이 아닙니다.');
    await this.notifyPartner(row.partnerId, 'LEAD_REJECT_ACCEPTED', '리드 반려가 인정되었습니다',
      `이용료 ${row.feeId}번의 확인비용을 잔액으로 환급했습니다.`, '/partner/leads-rejects');
    return { ...row, note: '인정했습니다. 확인비용이 파트너 잔액으로 환급됩니다(전환 전 후불분이면 청구에서 뺍니다).' };
  }

  /** 기각 — 그대로 청구됩니다. 사유는 파트너에게 보입니다. */
  async admDismissVoidRequest(id: string, reason: string) {
    if (!/^\d+$/.test(id)) throw new StateConflict('NOT_REQUESTED', '대기 중인 반려 신청이 아닙니다.');
    if (!reason?.trim()) {
      throw new PolicyViolation('REASON_REQUIRED', '기각에는 사유가 필요합니다 — 파트너에게 그대로 보입니다.');
    }
    const [row] = await this.db.query<any>(
      `UPDATE lead_fee_disputes
          SET state='DISMISSED', decision_reason=$2, decided_by=$3
        WHERE id=$1 AND state='REQUESTED'
      RETURNING id, fee_id AS "feeId", partner_id AS "partnerId", state, decision_reason AS "decisionReason"`,
      [id, reason.trim(), RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_REQUESTED', '대기 중인 반려 신청이 아닙니다.');
    await this.notifyPartner(row.partnerId, 'LEAD_REJECT_DISMISSED', '리드 반려 신청이 기각되었습니다',
      `이용료 ${row.feeId}번 — 사유: ${reason.trim()}`, '/partner/leads-rejects');
    return { ...row, note: '기각했습니다. 확인비용은 환급되지 않고, 사유가 파트너에게 보입니다.' };
  }

  /** 이용료 현황. 미납이 한도를 넘은 파트너는 리드가 자동으로 멈춥니다. */
  admFees() {
    return this.db.query(
      `SELECT p.id AS "partnerId", b.company_name AS "company", p.grade,
              coalesce(sum(f.amount) FILTER (WHERE f.state='PENDING'),0) AS "unpaid",
              p.unpaid_cap AS "unpaidCap",
              count(f.id) FILTER (WHERE f.state='VOIDED') AS "voided"
         FROM partners p
         JOIN businesses b ON b.id = p.business_id
         LEFT JOIN lead_fees f ON f.partner_id = p.id
        GROUP BY p.id, b.company_name, p.grade, p.unpaid_cap
        ORDER BY 4 DESC`);
  }
}
