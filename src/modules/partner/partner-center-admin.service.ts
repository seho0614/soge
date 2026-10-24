import { maskBizNo } from '../../common/mask';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/**
 * 파트너센터 — 운영 화면(리드 등급 · 사업자 정보 변경 요청 · 이용료 청구서 · 보너스 · 등급 규칙)  /admin/partner-center
 *
 * v10.92 (리팩토링) — partner-center.service.ts 에서 함수 본문을 그대로 옮겼습니다(uuid() 는 두 곳에 원본 그대로).
 */
@Injectable()
export class PartnerCenterAdminService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }
  /** 리드 등급 · 알림톡 결과 — 알림톡 연동 전에는 운영이 넣습니다(연동되면 어댑터가 같은 칸을 채움) */
  async admSetLeadGrade(leadId: string, dto: { alimState: string; grade?: string | null }) {
    this.uuid(leadId, '리드');
    const ST = ['NONE', 'SENT', 'CONFIRMED', 'NO_RESPONSE', 'FAILED', 'CANCELED'];
    if (!ST.includes(dto.alimState)) throw new PolicyViolation('BAD_ALIM', `alimState 는 ${ST.join(' · ')} 중 하나입니다.`);
    const [r] = await this.db.query<any>(
      `UPDATE leads SET alim_state = $2, grade = $3, alim_at = now(), graded_by = $4 WHERE id = $1
       RETURNING id, grade, fn_lead_grade_label(grade) AS "gradeLabel", alim_state AS "alimState"`,
      [leadId, dto.alimState, dto.grade ?? null, this.me]);
    if (!r) throw new NotFound('리드가 없습니다.');
    return r;
  }

  async admChangeRequests(state?: string) {
    const st = (state ?? 'REQUESTED').toUpperCase();
    /* 합침(v10.31 · w6 요청) — 사업자등록번호는 서버에서도 가림(src/common/mask.ts — 운영 화면과 같은 모양) */
    return (await this.db.query<any>(
      `SELECT r.id, r.field, r.before_value AS "beforeValue", r.after_value AS "afterValue", r.reason, r.state,
              r.decision_reason AS "decisionReason", r.created_at AS "createdAt", r.decided_at AS "decidedAt",
              b.company_name AS company, b.biz_reg_no AS "bizRegNo", p.id AS "partnerId"
         FROM business_change_requests r JOIN businesses b ON b.id = r.business_id
         LEFT JOIN partners p ON p.business_id = b.id
        WHERE ($1 = 'ALL' OR r.state = $1) ORDER BY r.created_at ${st === 'REQUESTED' ? 'ASC' : 'DESC'} LIMIT 200`, [st]))
      .map((r: any) => ({ ...r, bizRegNo: maskBizNo(r.bizRegNo, 'mid') }));
  }
  async admDecideChange(id: string, dto: { approve: boolean; reason?: string }) {
    this.uuid(id, '변경 요청');
    if (!dto.approve && !dto.reason?.trim()) throw new PolicyViolation('REASON_REQUIRED', '반려에는 사유가 필요합니다 — 신청자에게 그대로 보입니다.');
    const [r] = await this.db.query<any>(
      `UPDATE business_change_requests SET state = $2, decision_reason = $3, decided_by = $4
        WHERE id = $1 AND state = 'REQUESTED' RETURNING id, state, business_id AS "businessId"`,
      [id, dto.approve ? 'APPROVED' : 'REJECTED', dto.reason?.trim() || null, this.me]);
    if (!r) throw new StateConflict('NOT_REQUESTED', '처리 대기 중인 변경 요청이 아닙니다.');
    await this.db.query(
      `INSERT INTO notifications(account_id, event_code, title, body, link_url)
       SELECT account_id, 'BIZ_CHANGE_DECIDED', $2, $3, '/partner/business' FROM businesses WHERE id = $1`,
      [r.businessId, dto.approve ? '사업자 정보 변경이 승인되었습니다' : '사업자 정보 변경 요청이 반려되었습니다',
       dto.approve ? '사업자 정보에 반영했습니다.' : `사유: ${dto.reason?.trim()}`]).catch(() => undefined);
    return r;
  }

  async admInvoices(ym?: string) {
    return (await this.db.query<any>(
      `SELECT i.id, i.ym, i.total, i.supply, i.vat, i.state, i.invoice_no AS "invoiceNo", i.issued_on::text AS "issuedOn" /* v10.34 날짜 글자로(UTC 하루 밀림 방지) */,
              b.company_name AS company, b.biz_reg_no AS "bizRegNo", i.partner_id AS "partnerId",
              /* v10.34 (D093) 국세청 전송 — 발행 방식 · 전송 상태 · 승인번호(8-8-8) · 실패 사유 · 시도 · 시각 */
              i.etax_mode AS "etaxMode", i.etax_status AS "etaxStatus", (i.etax_status = 'ASSUMED') AS assumed,
              CASE WHEN i.etax_approval_no IS NOT NULL THEN substr(i.etax_approval_no,1,8)||'-'||substr(i.etax_approval_no,9,8)||'-'||substr(i.etax_approval_no,17,8) END AS "approvalNo",
              i.etax_doc_key AS "docKey", i.etax_error AS "etaxError", i.etax_attempts AS attempts, i.etax_adapter AS adapter, i.etax_sent_at AS "sentAt", i.etax_result_at AS "resultAt"
         FROM lead_cash_invoices i JOIN partners p ON p.id = i.partner_id JOIN businesses b ON b.id = p.business_id
        WHERE ($1::text IS NULL OR i.ym = $1) ORDER BY i.ym DESC, b.company_name LIMIT 500`, [ym ?? null]))
      .map((r: any) => ({ ...r, bizRegNo: maskBizNo(r.bizRegNo, 'mid') }));
  }
  async admRunInvoices(ym: string) {
    const [r] = await this.db.query<{ n: number }>(`SELECT fn_lead_cash_invoice_month($1) AS n`, [ym]);
    return { ok: true, created: Number(r.n), note: `${ym} 발행 요청 ${r.n}건을 만들었습니다(이미 있는 파트너는 건너뜀).` };
  }
  async admIssueInvoice(id: string, dto: { invoiceNo: string; issuedOn: string }) {
    this.uuid(id, '세금계산서');
    if (!dto.invoiceNo?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dto.issuedOn ?? '')) {
      throw new PolicyViolation('BAD_INVOICE', '발행 번호와 발행일(YYYY-MM-DD)을 넣어 주십시오.');
    }
    /* v10.34 (D093) — 손으로 번호 넣기는 연동 전 임시 방식(etax_mode MANUAL). 국세청 전송을 시작한 줄은 막습니다(중복 발행) */
    const [r] = await this.db.query<any>(
      `UPDATE lead_cash_invoices SET state = 'ISSUED', invoice_no = $2, issued_on = $3::date, issued_by = $4, etax_mode = 'MANUAL'
        WHERE id = $1 AND state = 'REQUESTED' AND etax_status IS NULL RETURNING id, state, etax_mode AS "etaxMode"`, [id, dto.invoiceNo.trim(), dto.issuedOn, this.me]);
    if (!r) {
      const [e] = await this.db.query<{ etax_status: string | null }>(`SELECT etax_status FROM lead_cash_invoices WHERE id = $1 AND state = 'REQUESTED'`, [id]);
      if (e?.etax_status) throw new StateConflict('ETAX_IN_PROGRESS', '국세청 전송을 시작한 줄입니다 — 「다시 보내기」 · 「상태 조회」로 처리하십시오(손으로 번호를 넣으면 중복 발행).');
      throw new StateConflict('NOT_REQUESTED', '발행 요청 상태가 아닙니다.');
    }
    return r;
  }

  async admRules() {
    const [bonus, grades, badges] = await Promise.all([
      this.db.query(`SELECT grade, rate, note, updated_at AS "updatedAt" FROM lead_cash_bonus_rates ORDER BY rate, grade`),
      this.db.query(`SELECT grade, rank, min_month_earned AS "minMonthEarned", note FROM partner_grade_rules ORDER BY rank`),
      this.db.query(`SELECT code, kind, name_tpl AS "nameTpl", threshold, months, is_active AS "isActive", note FROM partner_badge_rules ORDER BY sort_order`),
    ]);
    return { bonusRates: bonus, gradeRules: grades, badgeRules: badges };
  }
  async admSetBonusRate(grade: string, rate: number) {
    if (!(rate >= 0 && rate <= 0.5)) throw new PolicyViolation('BAD_RATE', '등급 할인 비율은 0 ~ 0.5 입니다.');
    const rows = await this.db.query(`UPDATE lead_cash_bonus_rates SET rate = $2, updated_by = $3, updated_at = now() WHERE grade = $1 RETURNING grade`, [grade, rate, this.me]);
    if (!rows.length) throw new NotFound('등급이 없습니다.');
    return { ok: true, note: '다음 충전부터 적용됩니다(이미 받은 보너스는 그대로).' };
  }
  async admSetGradeRule(grade: string, minMonthEarned: number | null) {
    if (minMonthEarned != null && !(Number.isInteger(minMonthEarned) && minMonthEarned >= 0)) throw new PolicyViolation('BAD_AMOUNT', '기준 금액은 0 이상 정수입니다.');
    const rows = await this.db.query(`UPDATE partner_grade_rules SET min_month_earned = $2, updated_by = $3, updated_at = now() WHERE grade = $1 RETURNING grade`, [grade, minMonthEarned, this.me]);
    if (!rows.length) throw new NotFound('등급이 없습니다.');
    return { ok: true };
  }
  private uuid(id: string, what = '대상') {
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new NotFound(`${what}이(가) 없습니다.`);
  }
}
