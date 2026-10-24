import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';


/**
 * 마이페이지 — 정산 · 정산 예정 · 세금계산서 표시 (v10.96 · me.service.ts 에서 함수 본문을 그대로 옮김).
 */
@Injectable()
export class MeMoneyService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }
  /** 정산 · 지급 내역.
   *  v10.31 (시안 mypay · mystl) — 소개 건 이름 · 소개코드 · 거래금액(계약 조건의 금액) · 부가세(사업자 수령만 · 소개비의 10% 별도 청구 — 표시 계산) ·
   *  세금계산서 발행 표시를 함께 냅니다. 소개비에서 떼는 금액은 없습니다(INV-9). */
  settlements(onlyHistory = false) {
    return this.db.query(
      `SELECT s.id, s.deal_id AS "dealId", s.amount, s.status,
              coalesce(sl.label, s.status) AS "statusLabel",
              s.requested_at AS "requestedAt", s.paid_at AS "paidAt",
              (s.held_by_dispute_id IS NOT NULL) AS "heldByDispute",
              CASE WHEN s.payee_business_id IS NULL THEN 'PERSON' ELSE 'BUSINESS' END AS payee,
              coalesce(l.title, rq.title, '소개 건') AS title, d.attributed_code AS "attributedCode", d.tier,
              (ct.terms->>'amount')::numeric AS "dealAmount",
              CASE WHEN s.payee_business_id IS NULL THEN NULL ELSE round(s.amount * 0.1) END AS vat,
              s.tax_invoice_issued_at AS "taxInvoiceIssuedAt", s.tax_invoice_no AS "taxInvoiceNo"
         FROM settlements s
         JOIN deals d ON d.id = s.deal_id
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN LATERAL (SELECT terms FROM deal_contracts c WHERE c.deal_id = d.id AND c.cancelled_at IS NULL
                             ORDER BY c.issued_at DESC LIMIT 1) ct ON true
         LEFT JOIN code_labels sl ON sl.domain='settlement.status' AND sl.code=s.status
        WHERE s.payee_account_id = $1
          AND ($2 = false OR s.status IN ('PAID','REJECTED'))
        ORDER BY s.requested_at DESC LIMIT 50`,
      [this.me, onlyHistory]);
  }

  /** v10.28 — 내가 소개자인 성사 확정 거래 중 정산 줄이 없는 것(소개비 약정이 있는 것만).
   *  v10.31 (시안 mystl 계산표) — 거래금액 · 소개코드 · tier · 상대(상호만) · 부가세(사업자 수령일 때만 · 표시 계산) · 받는 방식(payeeAs)을 함께.
   *  받는 방식: 사업자 인증이 그 거래의 성사보다 먼저면 BUSINESS, 아니면 PERSON(소급 안 함 · D060 ⑦). */
  settlementsDue() {
    return this.db.query(
      `SELECT d.id AS "dealId", d.agreed_fee AS amount, d.confirmed_at AS "confirmedAt",
              coalesce(l.title, rq.title, '소개 건') AS title, d.attributed_code AS "attributedCode", d.tier,
              (ct.terms->>'amount')::numeric AS "dealAmount",
              coalesce(cb.company_name, '상대방') AS counterpart,
              CASE WHEN b.verified_at IS NOT NULL AND b.verified_at <= d.confirmed_at THEN 'BUSINESS' ELSE 'PERSON' END AS "payeeAs",
              CASE WHEN b.verified_at IS NOT NULL AND b.verified_at <= d.confirmed_at THEN round(d.agreed_fee * 0.1) END AS vat
         FROM deals d
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN businesses b ON b.account_id = d.introducer_account_id AND b.kind = 'BUSINESS'
         LEFT JOIN businesses cb ON cb.account_id = d.buyer_account_id AND cb.verified_at IS NOT NULL
         LEFT JOIN LATERAL (SELECT terms FROM deal_contracts c WHERE c.deal_id = d.id AND c.cancelled_at IS NULL
                             ORDER BY c.issued_at DESC LIMIT 1) ct ON true
        WHERE d.introducer_account_id = $1 AND d.status = 'CONFIRMED' AND d.agreed_fee IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM settlements s WHERE s.deal_id = d.id)
        ORDER BY d.confirmed_at DESC NULLS LAST LIMIT 50`, [this.me]);
  }

  /** v10.31 (시안 mypay 「미발행」) — 세금계산서 발행 표시. 세금계산서는 소개자가 직접 발행합니다(회사가 대신 발행하지 않음).
   *  사업자로 받은 · 지급 완료된 · 내 정산만. 한 번 표시하면 고치지 않습니다(번호를 잘못 적었으면 고객센터). */
  async markTaxInvoice(id: string, no?: string) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id)) throw new PolicyViolation('BAD_ID', '정산 번호가 올바르지 않습니다.');
    const n = no?.trim() || null;
    if (n && n.length > 40) throw new PolicyViolation('BAD_NO', '승인번호는 40자 안으로 적어 주십시오.');
    const [s] = await this.db.query<{ status: string; biz: string | null; issued: string | null }>(
      `SELECT status, payee_business_id AS biz, tax_invoice_issued_at AS issued
         FROM settlements WHERE id = $1 AND payee_account_id = $2`, [id, this.me]);
    if (!s) throw new NotFound('정산을 찾을 수 없습니다.');
    if (!s.biz) throw new StateConflict('NOT_BUSINESS', '개인으로 받은 소개비는 세금계산서를 발행하지 않습니다.');
    if (s.status !== 'PAID') throw new StateConflict('NOT_PAID', '지급이 끝난 정산만 발행을 표시할 수 있습니다.');
    if (s.issued) throw new StateConflict('ALREADY_ISSUED', '이미 발행으로 표시했습니다.');
    const [row] = await this.db.query(
      `UPDATE settlements SET tax_invoice_issued_at = now(), tax_invoice_no = $3
        WHERE id = $1 AND payee_account_id = $2 AND tax_invoice_issued_at IS NULL
      RETURNING id, tax_invoice_issued_at AS "taxInvoiceIssuedAt", tax_invoice_no AS "taxInvoiceNo"`, [id, this.me, n]);
    return { ...row, note: '세금계산서 발행으로 표시했습니다. 세금계산서는 소개자가 직접 발행합니다.' };
  }
}
