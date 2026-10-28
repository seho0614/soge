import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AppError, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { PaymentResult, RefundReceiveAccount, resolvePaymentProvider } from '../billing/payment.provider';
import { HLT_EXCHANGE_WAIT_DAYS, exchangeFee, returnShipDeduction } from './health-policy';
import { FEE_STATE_SQL } from './health-shop.shared';
import { AgentDraftService } from '../agent/agent-draft.service';

/**
 * 건강몰 — 반품 · 교환 · 교환 배송비 · 환불.
 * v10.86 — health-shop.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class HealthReturnService {
  constructor(private readonly db: DatabaseService, private readonly drafts: AgentDraftService) {}
  /**
   * 취소 · 반품 신청.
   *
   * **7일 안이면 이유를 묻지 않습니다.** 다만 식품은 개봉하면
   * 어렵고, 그 판정은 운영이 합니다.
   */
  async requestReturn(d: any) {
    const me = RequestCtx.actorId()!;
    const [o] = await this.db.query<any>(
      `SELECT id, status FROM hlt_orders WHERE order_no = $1 AND account_id = $2`,
      [d.orderNo, me]);
    if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');
    if (o.status === 'CANCELED' || o.status === 'RETURNED') {
      throw new StateConflict('ALREADY', '이미 취소·반품된 주문입니다.');
    }

    /* D002 — 청약철회 판정은 서버가 합니다(fn_hlt_return_judge: 발송 전 취소 · 받은 날부터 N일 반품 ·
     * 하자는 3개월). 같은 함수를 INSERT 트리거도 부릅니다 — 앱을 거치지 않아도 같은 규칙입니다. */
    const [j] = await this.db.query<any>(
      `SELECT ok, code, message, deadline FROM fn_hlt_return_judge($1, $2, $3)`,
      [o.id, d.kind, d.reason]);
    if (!j.ok) throw new PolicyViolation(j.code, j.message, { deadline: j.deadline });

    /* 20261002 — 처리 중인 신청이 있으면 또 받지 않습니다(전: 같은 주문에 여러 번 접수) */
    const [open] = await this.db.query<any>(
      `SELECT id FROM hlt_returns WHERE order_id = $1 AND state IN ('REQUESTED','APPROVED') LIMIT 1`, [o.id]);
    if (open) throw new StateConflict('ALREADY_REQUESTED', '이미 접수된 취소·반품 신청이 있습니다. 처리 결과를 기다려 주십시오.');

    /* D006 — 고객이 적은 개봉 여부는 **참고**입니다. 판정은 운영이 승인할 때 합니다.
     * 발송 전 취소는 개봉일 수 없어 받지 않습니다. */
    const customerOpened = d.kind === 'CANCEL' ? null : (typeof d.opened === 'boolean' ? d.opened : null);
    /* v10.26 — 회원 사정 교환은 왕복 배송비(6,000원)를 신청 때 결제합니다(약관 제3조 · A-1 ①). 회사 사정 교환은 0원 */
    const fee = exchangeFee(d.kind, d.reason);
    const [r] = await this.db.query<any>(
      `INSERT INTO hlt_returns (order_id, kind, reason, detail, customer_opened, exchange_fee)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, kind, state, customer_opened AS "customerOpened", created_at AS "createdAt", exchange_fee AS "exchangeFee"`,
      [o.id, d.kind, d.reason, d.detail ?? null, customerOpened, fee]);
    await this.drafts.markSubmitted(d.agentDraftId, 'HLT_RETURN', String(r.id));   // v10.139 — AI 초안으로 낸 신청(숫자용 · 실패해도 접수는 그대로)
    if (d.kind === 'EXCHANGE') {
      return { ...r, feeState: fee > 0 ? 'UNPAID' : 'NONE', deadline: j.deadline,
        note: fee > 0
          ? `교환을 접수했습니다. 교환 배송비(왕복) ${fee.toLocaleString()}원을 결제하시면 확인 뒤 처리합니다 — 반려되거나 회사 사정으로 판정되면 돌려드립니다.`
          : '교환을 접수했습니다. 회사 사정이라 비용이 들지 않습니다. 3영업일 안에 알려 드립니다.' };
    }
    return { ...r, deadline: j.deadline, note: '접수했습니다. 3영업일 안에 알려 드립니다.' };
  }

  myReturns() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      `SELECT r.id, o.order_no AS "orderNo", r.kind, r.reason, r.state,
              r.decide_note AS "decideNote", r.refund_amount AS "refundAmount",
              r.ship_deduction AS "shipDeduction",
              r.created_at AS "createdAt", r.refunded_at AS "refundedAt",
              r.customer_opened AS "customerOpened",
              r.exchange_fee AS "exchangeFee", ${FEE_STATE_SQL} AS "feeState", r.converted_from AS "convertedFrom",
              /* v10.27 (G-184) — 결제 전에 들어온 취소(낸 돈이 없음): 환불 금액 「확정 전」 대신 「결제 전 취소」 */
              (r.kind = 'CANCEL' AND NOT EXISTS (SELECT 1 FROM hlt_payments hp WHERE hp.order_id = r.order_id AND hp.approved_at IS NOT NULL)) AS "beforePayment"
         FROM hlt_returns r
         JOIN hlt_orders o ON o.id = r.order_id
        WHERE o.account_id = $1
        ORDER BY r.created_at DESC LIMIT 50`, [me]);
  }
  /* ── 장바구니 ──────────────────────────────────────────────────── */

  /** 내 교환 신청 하나 — 결제 · 승인에 씀 */
  private async myExchange(id: string, lock = false) {
    const me = RequestCtx.actorId()!;
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
    const [r] = await this.db.query<any>(
      `SELECT r.id, r.kind, r.state, r.exchange_fee, o.order_no
         FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
        WHERE r.id = $1 AND o.account_id = $2 ${lock ? 'FOR UPDATE OF r' : ''}`, [id, me]);
    if (!r) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
    if (r.kind !== 'EXCHANGE' || Number(r.exchange_fee) <= 0) throw new StateConflict('NO_FEE', '교환 배송비를 낼 신청이 아닙니다.');
    if (r.state !== 'REQUESTED') throw new StateConflict('ALREADY_DECIDED', '이미 처리된 신청입니다.');
    return r;
  }

  /** 교환 배송비 결제 준비 — 결제창에 넘길 주문번호(toss) · 금액 · 이름 */
  async payExchangeFee(id: string, method: string) {
    if (!['CARD', 'TRANSFER'].includes(method)) throw new PolicyViolation('BAD_METHOD', '교환 배송비는 카드 · 계좌이체로 결제합니다.');
    return this.db.transaction(async () => {
      const r = await this.myExchange(id, true);
      const [paid] = await this.db.query<any>(`SELECT id FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'PAID'`, [r.id]);
      if (paid) throw new StateConflict('ALREADY_PAID', '교환 배송비를 이미 결제하셨습니다.');
      const [ready] = await this.db.query<any>(
        `SELECT id, amount, method, state, toss_order_id FROM hlt_exchange_fees
          WHERE return_id = $1 AND state = 'READY' ORDER BY created_at DESC LIMIT 1`, [r.id]);
      const name = `소개몰 교환 배송비 (${r.order_no})`;
      if (ready && ready.method === method && Number(ready.amount) === Number(r.exchange_fee)) {
        return { id: ready.id, amount: Number(ready.amount), method, state: 'READY', orderId: ready.toss_order_id, orderName: name,
          note: '이미 결제 준비 중입니다. 결제창을 다시 엽니다.' };
      }
      if (ready) await this.db.query(`UPDATE hlt_exchange_fees SET state = 'FAILED', fail_reason = '수단 변경', updated_at = now() WHERE id = $1`, [ready.id]);
      const [{ n }] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hlt_exchange_fees WHERE return_id = $1`, [r.id]);
      const [f] = await this.db.query<any>(
        `INSERT INTO hlt_exchange_fees (return_id, amount, method, toss_order_id)
         VALUES ($1,$2,$3,$4) RETURNING id, amount, method, state, toss_order_id AS "orderId"`,
        [r.id, Number(r.exchange_fee), method, `${r.order_no}-X${n + 1}`]);
      return { ...f, amount: Number(f.amount), orderName: name, note: '결제창으로 넘어갑니다.' };
    });
  }

  /**
   * 교환 배송비 결제 승인 — 주문 결제의 승인과 같은 방식(금액을 신청의 교환 배송비와 대조 · PG 승인 · 같은 paymentKey 는 같은 결과).
   * 키(TOSS_SECRET_KEY)가 없으면 스텁이 승인합니다(stub:true — 「시험 결제」).
   */
  async confirmExchangeFee(id: string, paymentKey: string, amount: number) {
    const provider = resolvePaymentProvider();
    const out = await this.db.transaction(async () => {
      const [same] = await this.db.query<any>(`SELECT id, return_id FROM hlt_exchange_fees WHERE payment_key = $1`, [paymentKey]);
      if (same) {
        if (same.return_id !== id) throw new StateConflict('PAYMENT_KEY_MISMATCH', '다른 신청의 결제입니다.');
        return { feeId: same.id };
      }
      const r = await this.myExchange(id, true);
      if (!Number.isInteger(Number(amount)) || Number(amount) !== Number(r.exchange_fee)) {
        throw new PolicyViolation('AMOUNT_MISMATCH',
          `결제 금액이 교환 배송비와 다릅니다 — 승인하지 않았습니다(교환 배송비 ${Number(r.exchange_fee).toLocaleString()}원).`,
          { expected: Number(r.exchange_fee), got: amount });
      }
      const [f] = await this.db.query<any>(
        `SELECT id, method, toss_order_id FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'READY'
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [r.id]);
      if (!f) throw new StateConflict('NO_READY_PAYMENT', '결제 준비 기록이 없습니다. 교환 배송비 결제를 다시 시작해 주십시오.');
      const res: PaymentResult = await provider.confirm({
        paymentKey, orderId: f.toss_order_id, amount: Number(r.exchange_fee),
        orderName: `소개몰 교환 배송비 (${r.order_no})`, method: f.method,
      });
      if (!res.approved) {
        await this.db.query(`UPDATE hlt_exchange_fees SET fail_reason = $2, updated_at = now() WHERE id = $1`,
          [f.id, (res.detail ?? (res.pending ? '입금 대기 결제는 받지 않습니다' : '결제 승인 실패')).slice(0, 500)]);
        return { fail: res };
      }
      await this.db.query(
        `UPDATE hlt_exchange_fees SET state = 'PAID', payment_key = $2, approved_at = coalesce($3::timestamptz, now()),
                stub = $4, pg_tid = $5, fail_reason = NULL, updated_at = now() WHERE id = $1`,
        [f.id, paymentKey, res.approvedAt ?? null, res.stub, res.transactionKey ?? null]);
      return { feeId: f.id };
    });
    if ('fail' in out) {
      throw new PolicyViolation('PAY_REJECTED', out.fail!.detail ?? '결제가 승인되지 않았습니다.', { pgCode: out.fail!.code ?? null });
    }
    const [row] = await this.db.query<any>(
      `SELECT id, amount, method, state, stub, approved_at AS "approvedAt" FROM hlt_exchange_fees WHERE id = $1`, [out.feeId]);
    return { ...row, amount: Number(row.amount), returnId: id,
      note: row.stub ? '시험 결제(스텁)로 승인했습니다 — 실제 돈은 오가지 않았습니다. 확인 뒤 교환을 처리합니다.' : '교환 배송비 결제가 승인되었습니다. 확인 뒤 교환을 처리합니다.' };
  }

  /** 낸 교환 배송비를 돌려드림(PG 취소). 실패하면 refund_error 를 남기고 PAID 로 둡니다 — 운영이 다시 시도합니다 */
  private async refundExchangeFee(returnId: string, why: string) {
    const [f] = await this.db.query<any>(
      `SELECT id, payment_key, amount, stub FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'PAID'`, [returnId]);
    if (!f) return { state: 'NONE' as const };
    const c = await resolvePaymentProvider().cancel({
      paymentKey: f.payment_key, cancelReason: `소개몰 교환 배송비 환불 — ${why}`.slice(0, 200), idempotencyKey: `hlt-xfee-${f.id}`,
    }).catch((e: any) => ({ ok: false, detail: e?.message ?? '연결 실패' } as any));
    if (!c.ok) {
      await this.db.query(`UPDATE hlt_exchange_fees SET refund_error = $2, updated_at = now() WHERE id = $1`, [f.id, String(c.detail ?? '환불 실패').slice(0, 500)]);
      return { state: 'FAILED' as const, amount: Number(f.amount), error: c.detail ?? '환불 실패' };
    }
    await this.db.query(
      `UPDATE hlt_exchange_fees SET state = 'REFUNDED', refunded_at = now(), refund_error = NULL, updated_at = now() WHERE id = $1`, [f.id]);
    return { state: 'REFUNDED' as const, amount: Number(f.amount), stub: !!(c.stub || f.stub) };
  }

  /** (운영) 교환 배송비 환불 다시 시도 */
  async retryExchangeFeeRefund(id: string) {
    const [r] = await this.db.query<any>(`SELECT id, kind, state, exchange_fee FROM hlt_returns WHERE id::text = $1`, [id]);
    if (!r || r.kind !== 'EXCHANGE') throw new StateConflict('NOT_FOUND', '없는 교환 신청입니다.');
    if (r.state === 'APPROVED' && Number(r.exchange_fee) > 0) throw new StateConflict('NOT_REFUNDABLE', '회원 사정으로 승인된 교환의 배송비는 돌려드리지 않습니다.');
    if (r.state === 'REQUESTED') throw new StateConflict('NOT_DECIDED', '아직 처리하지 않은 신청입니다.');
    return this.refundExchangeFee(r.id, '다시 시도');
  }

  /**
   * (운영) 교환할 상품이 없어 반품으로 바꿈 — 약관 제3조: 14일까지 입고를 기다리고 그 안에 들어오지 않으면(또는 회원이 원하면) 반품으로 처리 · 교환 배송비는 돌려드림.
   * 교환 신청은 반려로 닫히고(사유 「반품으로 바꿈 — …」) 같은 사유의 반품 신청이 생깁니다(converted_from). 청약철회 기간은 교환을 신청한 때로 봅니다.
   */
  async convertExchange(id: string, note?: string) {
    const me = RequestCtx.actorId()!;
    const why = (note ?? '').trim() || `교환할 상품이 ${HLT_EXCHANGE_WAIT_DAYS}일 안에 입고되지 않음`;
    const made = await this.db.transaction(async () => {
      const [r] = await this.db.query<any>(
        `SELECT r.id, r.kind, r.state, r.reason, r.detail, r.customer_opened, r.order_id, o.status
           FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id WHERE r.id::text = $1 FOR UPDATE OF r, o`, [id]);
      if (!r || r.kind !== 'EXCHANGE') throw new StateConflict('NOT_FOUND', '없는 교환 신청입니다.');
      if (!['REQUESTED', 'APPROVED'].includes(r.state)) throw new StateConflict('ALREADY_DECIDED', '이미 닫힌 신청입니다.');
      if (['CANCELED', 'RETURNED'].includes(r.status)) throw new StateConflict('ORDER_CLOSED', '이미 취소·반품된 주문입니다.');
      await this.db.query(
        `UPDATE hlt_returns SET state = 'REJECTED', decide_note = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
        [r.id, `반품으로 바꿈 — ${why}`.slice(0, 1000), me]);
      const [n] = await this.db.query<any>(
        `INSERT INTO hlt_returns (order_id, kind, reason, detail, customer_opened, converted_from)
         VALUES ($1, 'RETURN', $2, $3, $4, $5) RETURNING id, kind, state, created_at AS "createdAt"`,
        [r.order_id, r.reason, `(교환에서 바꿈) ${r.detail ?? ''}`.trim().slice(0, 1000), r.customer_opened, r.id]);
      return { exchangeId: r.id, ret: n };
    });
    const fee = await this.refundExchangeFee(made.exchangeId, '교환할 상품 없음 — 반품으로 바꿈');
    return { exchangeId: made.exchangeId, returnId: made.ret.id, feeRefund: fee,
      note: `반품으로 바꿨습니다(새 반품 신청 접수).${fee.state === 'REFUNDED' ? ` 교환 배송비 ${fee.amount.toLocaleString()}원을 돌려드렸습니다.` : fee.state === 'FAILED' ? ` 교환 배송비 환불이 실패했습니다 — 다시 시도해 주십시오.` : ''}` };
  }

  /* ── 결제 ──────────────────────────────────────────────────────── */

  /** 취소·반품 신청 목록. 기본은 접수(REQUESTED)만 */
  adminReturns(state?: string) {
    return this.db.query(
      `SELECT r.id, r.kind, r.reason, r.detail, r.state, r.decide_note AS "decideNote",
              r.created_at AS "createdAt", r.decided_at AS "decidedAt",
              o.order_no AS "orderNo", o.status AS "orderStatus", o.total,
              o.delivered_at AS "deliveredAt", o.restocked_at AS "restockedAt",
              o.restock_skipped AS "restockSkipped",
              r.customer_opened AS "customerOpened", r.opened,
              r.refund_amount AS "refundAmount", r.refunded_at AS "refundedAt",
              r.ship_deduction AS "shipDeduction",
              r.refund_error AS "refundError",
              r.exchange_fee AS "exchangeFee", ${FEE_STATE_SQL} AS "feeState", r.converted_from AS "convertedFrom",
              (SELECT xf.refund_error FROM hlt_exchange_fees xf WHERE xf.return_id = r.id AND xf.state = 'PAID' LIMIT 1) AS "feeRefundError",
              CASE WHEN r.kind = 'EXCHANGE' THEN (now()::date - (r.created_at AT TIME ZONE 'Asia/Seoul')::date) END AS "daysSince",
              pay.state AS "payState", pay.stub AS "payStub", pay.amount AS "payAmount", pay.method AS "payMethod",
              a.name AS "buyerName",
              (SELECT string_agg(p.name || coalesce(' (' || nullif(i.option_label, '단품') || ')', '') || ' × ' || i.qty, ', ')
                 FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id
                WHERE i.order_id = o.id) AS items,
              (SELECT string_agg(DISTINCT w.blocked_if, ' / ')
                 FROM hlt_order_items i JOIN withdrawal_rules w ON w.code = i.withdrawal_code
                WHERE i.order_id = o.id AND coalesce(w.blocked_if,'') <> '') AS "blockedIf"
         FROM hlt_returns r
         JOIN hlt_orders o ON o.id = r.order_id
         JOIN accounts a ON a.id = o.account_id
         LEFT JOIN LATERAL (
           SELECT state, stub, amount, method FROM hlt_payments x
            WHERE x.order_id = o.id AND x.state IN ('PAID','CANCELED') AND x.payment_key IS NOT NULL
            ORDER BY (x.state = 'PAID') DESC, x.created_at DESC LIMIT 1) pay ON true
        WHERE ($1::text = 'ALL' OR r.state = $1)
        ORDER BY r.created_at DESC LIMIT 100`, [state || 'REQUESTED']);
  }

  /**
   * 취소·반품 승인 · 반려.
   *
   * 승인하면 주문이 CANCELED(취소) 또는 RETURNED(반품)로 바뀌고, **재고는 트리거가
   * 한 번만 되돌립니다**(fn_hlt_order_restock). 교환 승인은 주문 상태를 바꾸지 않습니다.
   * 반려는 사유가 있어야 합니다(fn_hlt_return_guard). 결제 대기 건은 닫습니다.
   *
   * D006
   *  · 반품 승인은 **개봉 여부 판정(opened)** 이 필수입니다. 개봉이면 주문은 RETURNED 지만
   *    재고로 되돌리지 않습니다(restock_skipped='OPENED', 사장님 결정 2026-10-02).
   *    발송 전 취소는 개봉일 수 없습니다.
   *  · 결제된 주문이면 승인 뒤 **바로 환불**합니다(PG 결제 취소 → REFUNDED).
   *    환불이 실패하면 승인(APPROVED)에 머물고 사유가 남습니다 — /refund 로 다시 시도합니다.
   *    순서: 주문을 먼저 닫고(이 트랜잭션) → 결제를 CANCELED 로(환불 트랜잭션).
   *    닫힌 주문은 fn_hlt_pay_apply 가 건드리지 않아 반품이 취소로 바뀌지 않습니다.
   */
  async decideReturn(id: string, state: string, note?: string, opened?: boolean, sellerFault?: boolean) {
    const me = RequestCtx.actorId()!;
    const decided = await this.db.transaction(async () => {
      const [r] = await this.db.query<any>(
        `SELECT r.id, r.kind, r.state, r.exchange_fee, o.id AS order_id, o.order_no, o.status
           FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
          WHERE r.id::text = $1 FOR UPDATE OF r, o`, [id]);
      if (!r) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
      if (r.state !== 'REQUESTED') {
        throw new StateConflict('ALREADY_DECIDED', '이미 처리된 신청입니다.');
      }
      if (state === 'REJECTED' && !note?.trim()) {
        throw new PolicyViolation('NOTE_REQUIRED', '반려하시려면 이유를 적어야 합니다 — 청약철회는 법이 준 권리라 근거가 필요합니다.');
      }
      if (r.kind === 'CANCEL' && opened === true) {
        throw new PolicyViolation('CANCEL_NOT_OPENED', '발송 전 취소는 개봉일 수 없습니다 — 개봉 판정은 반품에만 합니다.');
      }
      if (state === 'APPROVED' && r.kind === 'RETURN' && typeof opened !== 'boolean') {
        throw new PolicyViolation('OPENED_REQUIRED',
          '반품을 승인하시려면 개봉 여부를 골라 주십시오 — 개봉이면 재판매할 수 없어 재고로 되돌리지 않습니다.');
      }
      /* v10.26 — 회원 사정 교환은 교환 배송비를 낸 뒤에 승인합니다. 운영이 회사 사정으로 판정하면(sellerFault) 비용을 0 으로 하고 낸 돈을 돌려드립니다 */
      let fee = Number(r.exchange_fee ?? 0);
      if (sellerFault === true && r.kind !== 'EXCHANGE') {
        throw new PolicyViolation('SELLER_FAULT_EXCHANGE_ONLY', '「회사 사정으로 판정」은 교환 신청에만 씁니다.');
      }
      if (state === 'APPROVED' && r.kind === 'EXCHANGE' && fee > 0) {
        if (sellerFault === true) fee = 0;
        else {
          const [paid] = await this.db.query<any>(
            `SELECT id FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'PAID' AND amount = $2`, [r.id, fee]);
          if (!paid) throw new StateConflict('FEE_UNPAID', '교환 배송비를 아직 결제하지 않은 신청입니다 — 결제 뒤에 승인하거나, 회사 사정이면 「회사 사정으로 판정」을 골라 주십시오.');
        }
      }

      let orderStatus = r.status;
      let vbankKeys: string[] = [];
      if (state === 'APPROVED') {
        if (r.status === 'CANCELED' || r.status === 'RETURNED') {
          throw new StateConflict('ORDER_CLOSED', '이미 취소·반품된 주문입니다.');
        }
        if (r.kind === 'CANCEL') {
          if (!['PENDING', 'PAID', 'PREPARING'].includes(r.status)) {
            throw new StateConflict('ALREADY_SHIPPED',
              '신청 뒤에 발송되었습니다. 취소가 아니라 반품으로 처리해야 합니다 — 반려하고 반품 신청을 안내해 주십시오.');
          }
          orderStatus = 'CANCELED';
        } else if (r.kind === 'RETURN') {
          if (!['SHIPPED', 'DELIVERED', 'CONFIRMED'].includes(r.status)) {      /* v10.28 — 구매확정 뒤에도 법정 기간 안의 반품은 받음 */
            throw new StateConflict('NOT_SHIPPED', '발송 전 주문은 반품이 아니라 취소입니다.');
          }
          orderStatus = 'RETURNED';
        }
        if (orderStatus !== r.status) {
          /* 개봉 반품은 재고로 되돌리지 않습니다 — 트리거가 restock_skipped 를 보고 건너뜁니다 */
          await this.db.query(
            `UPDATE hlt_orders SET status = $2, restock_skipped = $3 WHERE id = $1`,
            [r.order_id, orderStatus, orderStatus === 'RETURNED' && opened === true ? 'OPENED' : null]);
          /* 결제 준비 건은 닫습니다. ★ CANCELED 가 아니라 FAILED — CANCELED 는 fn_hlt_pay_apply 가 주문 취소로 옮깁니다.
           * 가상계좌가 발급된 준비 건은 PG 에서도 닫아야 늦은 입금이 생기지 않습니다(커밋 뒤). */
          const closed = await this.db.query<any>(
            `UPDATE hlt_payments SET state = 'FAILED', fail_reason = '주문 취소·반품'
              WHERE order_id = $1 AND state = 'READY' RETURNING payment_key`, [r.order_id]);
          vbankKeys = closed.map((x: any) => x.payment_key).filter(Boolean);
        }
      }

      await this.db.query(
        `UPDATE hlt_returns SET state = $2, decide_note = $3, decided_by = $4, decided_at = now(), opened = $5, exchange_fee = $6
          WHERE id = $1`,
        [r.id, state, note?.trim() || null, me, r.kind === 'CANCEL' ? false : (typeof opened === 'boolean' ? opened : null), fee]);
      return { r, vbankKeys, refundable: state === 'APPROVED' && orderStatus !== r.status,
        feeBack: r.kind === 'EXCHANGE' && (state === 'REJECTED' || (state === 'APPROVED' && fee === 0 && Number(r.exchange_fee) > 0)) };
    });

    const { r } = decided;
    /* 발급만 되고 입금 전인 가상계좌 닫기 — 실패해도 승인은 유지합니다(웹훅이 늦은 입금을 운영에 넘깁니다) */
    for (const k of decided.vbankKeys) {
      const c = await resolvePaymentProvider().cancel({
        paymentKey: k, cancelReason: `소개몰 주문 취소 (${r.order_no})`, idempotencyKey: `hlt-vbank-close-${k}`,
      }).catch(() => null);
      if (c?.ok) await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE payment_key = $1`, [k, c.status ?? 'CANCELED']);
    }

    let refund: any = { state: 'NONE' };
    if (decided.refundable) {
      const [paid] = await this.db.query<any>(
        `SELECT id FROM hlt_payments WHERE order_id = $1 AND state = 'PAID'`, [r.order_id]);
      if (paid) {
        try {
          const x = await this.refund(r.id);
          refund = { state: 'REFUNDED', amount: x.refundAmount, stub: x.stub, shipDeduction: x.shipDeduction };
        } catch (e: any) {
          refund = { state: 'FAILED', error: e?.getResponse?.()?.message ?? e?.message ?? '환불 실패' };
        }
      }
    }

    /* v10.26 — 교환 배송비 돌려드림(반려 · 회사 사정 판정). 실패해도 결정은 유지하고 다시 시도할 수 있게 둡니다 */
    const feeRefund = decided.feeBack ? await this.refundExchangeFee(r.id, state === 'REJECTED' ? '교환 반려' : '회사 사정으로 판정') : { state: 'NONE' as const };

    const [o] = await this.db.query<any>(
      `SELECT status, restocked_at AS "restockedAt", restock_skipped AS "restockSkipped"
         FROM hlt_orders WHERE id = $1`, [r.order_id]);
    const [cur] = await this.db.query<any>(`SELECT state, opened FROM hlt_returns WHERE id = $1`, [r.id]);
    const stock = o.restockedAt ? ' 재고를 되돌렸습니다.'
      : o.restockSkipped === 'OPENED' ? ' 개봉 반품이라 재고로 되돌리지 않았습니다.' : '';
    const base = { id: r.id, state: cur.state, orderNo: r.order_no, orderStatus: o.status,
      restockedAt: o.restockedAt, restockSkipped: o.restockSkipped, opened: cur.opened, refund, feeRefund };
    const feeNote = feeRefund.state === 'REFUNDED' ? ` 교환 배송비 ${feeRefund.amount.toLocaleString()}원을 돌려드렸습니다.`
      : feeRefund.state === 'FAILED' ? ' 교환 배송비 환불이 실패했습니다 — 「교환 배송비 환불 다시 시도」로 처리해 주십시오.' : '';
    if (state === 'REJECTED') return { ...base, note: `반려했습니다. 고객에게 사유가 보입니다.${feeNote}` };
    if (r.kind === 'EXCHANGE') return { ...base, note: `교환을 승인했습니다. 환불은 없습니다.${feeNote}` };
    if (refund.state === 'FAILED') {
      /* ok:false — 화면이 성공으로 보이지 않게 합니다(승인 자체는 됐습니다) */
      return { ...base, ok: false,
        note: `승인했지만 환불이 실패했습니다: ${refund.error} — 「환불 다시 시도」로 처리해 주십시오.${stock}` };
    }
    if (refund.state === 'REFUNDED') {
      const ded = Number(refund.shipDeduction ?? 0);
      return { ...base, note: `승인하고 ${ded > 0 ? `왕복 배송비 ${ded.toLocaleString()}원을 빼고 ` : ''}${Number(refund.amount).toLocaleString()}원을 환불했습니다${refund.stub ? '(시험 결제 — 실제 돈 없음)' : ''}.${stock}` };
    }
    return { ...base, note: `승인했습니다.${decided.refundable ? ' 결제 전 주문이라 환불할 것이 없습니다.' : ''}${stock}` };
  }

  /**
   * 반품 배송비 차감 (10/2 결정) — 고객 사정(단순 변심 · 잘못 주문)의 **반품**은 왕복 배송비를 뺍니다.
   * 금액 · 대상은 health-policy.ts 한 곳에서 정하고, 약관 초안(HLT_SALE §2)에 같은 값이 적힙니다.
   * DB 제약(ck_hlt_returns_ship_deduction)이 다른 사유 · 취소에서의 차감을 막습니다.
   */
  private refundDeduction(r: { kind: string; reason: string; converted_from?: string | null }, paid: number): number {
    /* v10.26 (10/8 답 「빼지 않음」 · 판매 약관 1.2 제3조 ③) — 재고가 없어 교환에서 바꾼 반품은 회사 사정이라 전액 환불합니다 */
    if (r.converted_from) return 0;
    return returnShipDeduction(r.kind, r.reason, paid);
  }

  /**
   * 환불 (D006) — 승인된 취소·반품의 결제를 PG 에서 취소하고 REFUNDED 로 닫습니다.
   * 이미 환불됐으면 같은 결과를 돌려줍니다(재시도 안전). PG 에는 Idempotency-Key(신청 id)를 붙입니다.
   * 실패하면 승인(APPROVED)에 머물고 refund_error 가 남습니다.
   */
  async refund(id: string, refundReceiveAccount?: RefundReceiveAccount) {
    const provider = resolvePaymentProvider();
    const out = await this.db.transaction(async () => {
      const [r] = await this.db.query<any>(
        `SELECT r.id, r.kind, r.reason, r.state, r.refund_amount, r.refunded_at, r.ship_deduction, r.converted_from,
                o.id AS order_id, o.order_no, o.status, o.ship_fee
           FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
          WHERE r.id::text = $1 FOR UPDATE OF r, o`, [id]);
      if (!r) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
      if (r.state === 'REFUNDED') {
        const [p] = await this.db.query<any>(
          `SELECT stub FROM hlt_payments WHERE order_id = $1 AND state = 'CANCELED' AND payment_key IS NOT NULL
            ORDER BY canceled_at DESC NULLS LAST LIMIT 1`, [r.order_id]);
        return { r, again: true, amount: Number(r.refund_amount), deduct: Number(r.ship_deduction ?? 0), stub: !!p?.stub };
      }
      if (r.state !== 'APPROVED') throw new StateConflict('NOT_APPROVED', '승인된 신청만 환불합니다.');
      if (!['CANCEL', 'RETURN'].includes(r.kind)) {
        throw new StateConflict('NOT_REFUNDABLE', '교환은 환불하지 않습니다.');
      }
      /* 순서 보장 — 주문이 닫혀 있어야 결제 CANCELED 가 주문을 바꾸지 않습니다 */
      if (!['CANCELED', 'RETURNED'].includes(r.status)) {
        throw new StateConflict('ORDER_OPEN', '주문이 아직 닫히지 않았습니다 — 승인부터 해 주십시오.');
      }
      const [pay] = await this.db.query<any>(
        `SELECT id, amount, payment_key, stub FROM hlt_payments
          WHERE order_id = $1 AND state = 'PAID' FOR UPDATE`, [r.order_id]);
      if (!pay) throw new StateConflict('NOT_PAID', '결제되지 않은 주문이라 환불할 것이 없습니다.');

      const deduct = this.refundDeduction(r, Number(pay.amount));
      const amount = Number(pay.amount) - deduct;
      if (amount <= 0) {
        throw new StateConflict('NOTHING_TO_REFUND', '왕복 배송비를 빼면 환불할 금액이 없습니다 — 운영 확인이 필요합니다.');
      }
      const c = await provider.cancel({
        paymentKey: pay.payment_key,
        cancelReason: `소개몰 ${r.kind === 'RETURN' ? '반품' : '주문 취소'} 승인 (${r.order_no})`,
        cancelAmount: deduct > 0 ? amount : undefined,
        idempotencyKey: `hlt-refund-${r.id}`,
        refundReceiveAccount,
      });
      if (!c.ok) {
        await this.db.query(
          `UPDATE hlt_returns SET refund_error = $2, refund_tried_at = now() WHERE id = $1`,
          [r.id, (c.detail ?? '환불 실패').slice(0, 500)]);
        return { r, fail: c };
      }
      const refunded = c.canceledAmount ?? amount;
      await this.db.query(
        `UPDATE hlt_payments SET state = 'CANCELED', pg_status = $2,
                canceled_at = coalesce($3::timestamptz, now()), canceled_amount = $4
          WHERE id = $1`, [pay.id, c.status ?? 'CANCELED', c.canceledAt ?? null, refunded]);
      await this.db.query(
        `UPDATE hlt_returns SET state = 'REFUNDED', refund_amount = $2, refunded_at = now(),
                refund_error = NULL, refund_tried_at = now(), ship_deduction = $3
          WHERE id = $1`, [r.id, refunded, Number(pay.amount) - refunded]);
      return { r, again: false, amount: refunded, deduct: Number(pay.amount) - refunded, stub: c.stub || pay.stub };
    });

    if ('fail' in out && out.fail) {
      throw new AppError(502, { code: 'REFUND_FAILED',
        message: `환불하지 못했습니다 — ${out.fail.detail ?? 'PG 응답 없음'}. 승인 상태로 남아 있으니 다시 시도해 주십시오.`,
        details: { pgCode: out.fail.code ?? null } });
    }
    const o = out as { r: any; again: boolean; amount: number; deduct: number; stub: boolean };
    return { id: o.r.id, state: 'REFUNDED', orderNo: o.r.order_no, refundAmount: o.amount,
      shipDeduction: o.deduct, stub: o.stub, again: o.again,
      note: o.again ? '이미 환불된 신청입니다.'
        : `${o.deduct > 0 ? `왕복 배송비 ${o.deduct.toLocaleString()}원을 빼고 ` : ''}${o.amount.toLocaleString()}원을 환불했습니다${o.stub ? '(시험 결제 — 실제 돈 없음)' : ''}.` };
  }
}
