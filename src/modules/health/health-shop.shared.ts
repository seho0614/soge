/** 교환 배송비 결제 상태 — NONE(0원) · UNPAID · PAID · REFUNDED. 신청 r 이 FROM 에 있어야 합니다 */
export const FEE_STATE_SQL = `CASE WHEN r.exchange_fee = 0 THEN
    CASE WHEN EXISTS (SELECT 1 FROM hlt_exchange_fees xf WHERE xf.return_id = r.id AND xf.state = 'REFUNDED') THEN 'REFUNDED' ELSE 'NONE' END
  ELSE coalesce((SELECT CASE xf.state WHEN 'PAID' THEN 'PAID' WHEN 'REFUNDED' THEN 'REFUNDED' END FROM hlt_exchange_fees xf
                  WHERE xf.return_id = r.id AND xf.state IN ('PAID','REFUNDED') LIMIT 1), 'UNPAID') END`;

/** 결제 행 → 화면. ★ vbank_secret 은 내보내지 않습니다 */
export const PAY_COLS = `p.id, p.method, p.amount, p.state, p.stub, p.pg_status AS "pgStatus",
  p.approved_at AS "approvedAt", p.canceled_at AS "canceledAt", p.canceled_amount AS "canceledAmount",
  p.vbank, p.fail_reason AS "failReason"`;
