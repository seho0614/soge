import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AppError, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { PaymentLookup, PaymentResult, resolvePaymentProvider } from '../billing/payment.provider';
import { PAY_COLS } from './health-shop.shared';

/** 토스 결제 수단 원문 → 우리 코드(hlt_payments.method CHECK). 모르는 것은 준비 때 고른 수단을 그대로 둡니다 */
const TOSS_METHOD: Record<string, string> = {
  '카드': 'CARD', '간편결제': 'CARD', '계좌이체': 'TRANSFER', '가상계좌': 'VBANK',
};

/**
 * 건강몰 — 주문 결제(준비 · 승인 · 토스 웹훅 · 조회 반영).
 * v10.86 — health-shop.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class HealthPaymentService {
  constructor(private readonly db: DatabaseService) {}
  /**
   * v10.26 (G-183) — 취소 신청이 접수돼 처리를 기다리는 주문은 결제를 받지 않습니다.
   * 전에는 주문 상태(결제 대기)만 봐서, 취소를 신청한 뒤에도 결제가 됐습니다(그 뒤 운영이 승인하면 환불 — 낼 필요 없는 돈을 냈다 돌려받음).
   * 운영이 신청을 반려하면 다시 결제할 수 있습니다.
   */
  private async assertNoCancelRequest(orderId: string) {
    const [r] = await this.db.query<{ id: string }>(
      `SELECT id FROM hlt_returns WHERE order_id = $1 AND kind = 'CANCEL' AND state = 'REQUESTED' LIMIT 1`, [orderId]);
    if (r) {
      throw new StateConflict('CANCEL_REQUESTED',
        '취소 신청이 접수된 주문입니다. 취소가 처리될 때까지 결제하실 수 없습니다.');
    }
  }

  /**
   * 결제.
   *
   * **카드번호는 저희 쪽에 남지 않습니다** — PG 가 처리하고
   * 거래번호만 받습니다. 승인되면 트리거가 주문 상태를 바꿉니다.
   */
  async pay(no: string, method: string) {
    const me = RequestCtx.actorId()!;
    const [o] = await this.db.query<any>(
      `SELECT id, total, status FROM hlt_orders
        WHERE order_no = $1 AND account_id = $2`, [no, me]);
    if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');
    if (o.status !== 'PENDING') {
      throw new StateConflict('ALREADY', '이미 결제되었거나 취소된 주문입니다.');
    }
    await this.assertNoCancelRequest(o.id);
    const [{ n }] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hlt_order_items WHERE order_id = $1`, [o.id]);
    if (!n) throw new StateConflict('EMPTY_ORDER', '품목이 없는 주문은 결제할 수 없습니다.');
    if (!['CARD', 'TRANSFER', 'VBANK'].includes(method)) {
      throw new PolicyViolation('BAD_METHOD', '없는 결제 수단입니다.');
    }

    /* 20261002 — 같은 주문의 준비(READY) 결제가 있으면 그것을 돌려줍니다.
     * 전에는 누를 때마다 READY 행이 쌓였습니다. 수단을 바꾸면 이전 준비 건은 FAILED 로 닫습니다.
     * ★ CANCELED 로 두면 안 됩니다 — fn_hlt_pay_apply 가 결제 취소를 **주문 취소**로 옮깁니다(실측). */
    const [ready] = await this.db.query<any>(
      `SELECT ${PAY_COLS}, p.payment_key FROM hlt_payments p
        WHERE p.order_id = $1 AND p.state = 'READY' ORDER BY p.created_at DESC LIMIT 1`, [o.id]);
    /* D006 — 가상계좌가 이미 발급됐으면 그 계좌로 입금을 기다립니다. 수단을 바꾸면 발급된 계좌로
     * 늦게 들어온 돈이 갈 곳이 없어집니다. */
    if (ready?.payment_key && ready.method !== method) {
      throw new StateConflict('VBANK_WAITING',
        '가상계좌가 이미 발급되어 입금을 기다리고 있습니다. 다른 수단으로 결제하시려면 주문을 취소하고 새로 주문해 주십시오.');
    }
    if (ready && ready.method === method) {
      const { payment_key, ...view } = ready;
      return { ...view, orderNo: no, orderName: await this.orderName(o.id),
        note: payment_key ? '가상계좌 입금을 기다리고 있습니다.' : '이미 결제 준비 중입니다. 결제창을 다시 엽니다.' };
    }
    if (ready) {
      await this.db.query(`UPDATE hlt_payments SET state = 'FAILED' WHERE id = $1`, [ready.id]);
    }

    /* 결제 연동 전에는 준비 상태로만 둡니다 — 됐다고 속이지 않습니다. */
    const [pay] = await this.db.query<any>(
      `INSERT INTO hlt_payments (order_id, method, amount, state)
       VALUES ($1,$2,$3,'READY')
       RETURNING id, method, amount, state`, [o.id, method, o.total]);

    return { ...pay, orderNo: no, orderName: await this.orderName(o.id),
      note: method === 'VBANK'
        ? '입금하실 계좌를 안내해 드립니다. 입금 확인 후 보내 드립니다.'
        : '결제창으로 넘어갑니다.' };
  }

  /** 결제창에 보일 주문명 — "첫 상품 외 N건" (토스 orderName 100자 제한) */
  private async orderName(orderId: string) {
    const [r] = await this.db.query<any>(
      `SELECT min(p.name) AS first, count(*)::int AS n
         FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id WHERE i.order_id = $1`, [orderId]);
    const name = r?.n > 1 ? `${r.first} 외 ${r.n - 1}건` : (r?.first ?? '소개몰 주문');
    return name.slice(0, 100);
  }

  /* ── 결제 승인 (D006 — 토스 표준 결제창) ───────────────────────────
   *
   * 흐름: POST /pay (READY) → 결제창 → 성공 주소(paymentKey · orderId · amount) → 여기.
   *   1) 금액을 **주문 금액과** 대조합니다 — 성공 주소의 amount 는 브라우저가 고칠 수 있습니다.
   *   2) PG 에 승인을 요청합니다(토스 /v1/payments/confirm). PG 도 자기 금액과 대조합니다.
   *   3) 승인되면 결제 PAID → fn_hlt_pay_apply 가 주문을 PAID 로 바꿉니다.
   *      가상계좌는 WAITING_FOR_DEPOSIT — READY 로 두고 계좌만 안내합니다(입금은 웹훅).
   *
   * 멱등: 같은 paymentKey 로 다시 부르면 PG 를 다시 부르지 않고 같은 결과를 돌려줍니다.
   * 동시성: 주문 행을 잠근 채 PG 를 부릅니다 — 같은 주문의 승인이 둘 겹치지 않습니다.
   * 키(TOSS_SECRET_KEY)가 없으면 스텁이 승인하고 stub:true 가 남습니다 — 화면은 "시험 결제" 로 보입니다. */
  async confirmPay(no: string, paymentKey: string, amount: number) {
    const me = RequestCtx.actorId()!;
    const provider = resolvePaymentProvider();

    const out = await this.db.transaction(async () => {
      const [o] = await this.db.query<any>(
        `SELECT id, order_no, total, status FROM hlt_orders
          WHERE order_no = $1 AND account_id = $2 FOR UPDATE`, [no, me]);
      if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');

      /* 같은 paymentKey — 이미 처리한 결과를 그대로 */
      const [same] = await this.db.query<any>(
        `SELECT p.id, p.order_id FROM hlt_payments p WHERE p.payment_key = $1`, [paymentKey]);
      if (same) {
        if (same.order_id !== o.id) {
          throw new StateConflict('PAYMENT_KEY_MISMATCH', '다른 주문의 결제입니다.');
        }
        return { payId: same.id, again: true };
      }

      if (!Number.isInteger(Number(amount)) || Number(amount) !== Number(o.total)) {
        throw new PolicyViolation('AMOUNT_MISMATCH',
          `결제 금액이 주문 금액과 다릅니다 — 결제를 승인하지 않았습니다(주문 ${Number(o.total).toLocaleString()}원).`,
          { expected: Number(o.total), got: amount });
      }
      if (o.status !== 'PENDING') {
        throw new StateConflict('ALREADY', '이미 결제되었거나 취소된 주문입니다.');
      }
      await this.assertNoCancelRequest(o.id);
      const [ready] = await this.db.query<any>(
        `SELECT id, method, payment_key FROM hlt_payments
          WHERE order_id = $1 AND state = 'READY' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [o.id]);
      if (!ready) {
        throw new StateConflict('NO_READY_PAYMENT', '결제 준비 기록이 없습니다. 결제 화면에서 다시 시작해 주십시오.');
      }
      if (ready.payment_key) {
        throw new StateConflict('VBANK_WAITING', '가상계좌가 이미 발급되어 입금을 기다리고 있습니다.');
      }

      let r: PaymentResult = await provider.confirm({
        paymentKey, orderId: o.order_no, amount: Number(o.total),
        orderName: `소개몰 주문 ${o.order_no}`, method: ready.method,
      });
      /* 승인은 됐는데 우리 기록이 실패해 다시 온 경우 — PG 는 "이미 처리됨" 이라 답합니다.
       * 그때는 조회해서 이 주문 · 이 금액으로 승인된 것이 맞으면 승인으로 봅니다. */
      if (!r.approved && !r.pending && r.code === 'ALREADY_PROCESSED_PAYMENT') {
        const look = await provider.getPayment(paymentKey);
        if (look.found && look.status === 'DONE' && look.orderId === o.order_no
            && look.totalAmount === Number(o.total)) {
          r = { approved: true, stub: look.stub, amount: look.totalAmount, method: look.method,
            status: 'DONE', paymentKey, approvedAt: look.approvedAt, transactionKey: look.transactionKey };
        }
      }

      const method = TOSS_METHOD[r.method ?? ''] ?? ready.method;
      if (r.approved) {
        await this.db.query(
          `UPDATE hlt_payments
              SET state = 'PAID', payment_key = $2, approved_at = coalesce($3::timestamptz, now()),
                  pg_status = 'DONE', stub = $4, method = $5, pg_tid = $6, fail_reason = NULL
            WHERE id = $1`,
          [ready.id, paymentKey, r.approvedAt ?? null, r.stub, method, r.transactionKey ?? null]);
      } else if (r.pending) {
        await this.db.query(
          `UPDATE hlt_payments
              SET payment_key = $2, pg_status = $3, stub = $4, method = 'VBANK',
                  vbank = $5::jsonb, vbank_secret = $6, pg_tid = $7, fail_reason = NULL
            WHERE id = $1`,
          [ready.id, paymentKey, r.status ?? 'WAITING_FOR_DEPOSIT', r.stub,
           JSON.stringify(r.virtualAccount ?? {}), r.secret ?? null, r.transactionKey ?? null]);
      } else {
        /* 실패 — READY 로 둡니다(다시 결제할 수 있게). 사유만 남깁니다 */
        await this.db.query(
          `UPDATE hlt_payments SET fail_reason = $2 WHERE id = $1`,
          [ready.id, (r.detail ?? '결제 승인 실패').slice(0, 500)]);
        return { fail: r };
      }
      return { payId: ready.id, again: false };
    });

    if ('fail' in out) {
      throw new PolicyViolation('PAY_REJECTED', out.fail!.detail ?? '결제가 승인되지 않았습니다.',
        { pgCode: out.fail!.code ?? null });
    }
    const [row] = await this.db.query<any>(
      `SELECT ${PAY_COLS}, o.order_no AS "orderNo", o.status AS "orderStatus"
         FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id WHERE p.id = $1`, [out.payId]);
    return { ...row, again: out.again,
      note: row.state === 'PAID'
        ? (row.stub ? '시험 결제(스텁)로 승인했습니다 — 실제 돈은 오가지 않았습니다.' : '결제가 승인되었습니다.')
        : row.pgStatus === 'WAITING_FOR_DEPOSIT'
          ? '가상계좌를 발급했습니다. 입금이 확인되면 주문이 결제 완료로 바뀝니다.'
          : `결제 상태: ${row.state}` };
  }

  /* ── 토스 웹훅 (D006) ──────────────────────────────────────────────
   *
   * PAYMENT_STATUS_CHANGED { eventType, createdAt, data: Payment }
   * DEPOSIT_CALLBACK       { createdAt, secret, status, transactionKey, orderId } (가상계좌 입금)
   *
   * **본문을 믿지 않습니다.** 누구나 이 주소로 "입금됐다" 를 보낼 수 있습니다.
   * 본문에서는 어느 결제인지(paymentKey · orderId)만 읽고, 상태는 PG 에서 다시 조회한 값을 씁니다.
   * 조회가 실패하면 5xx 를 돌려줍니다 — 토스가 다시 보냅니다.
   * 이미 반영된 상태면 아무것도 하지 않습니다(재전송 안전). */
  async tossWebhook(body: any) {
    const data = body && typeof body.data === 'object' && body.data ? body.data : (body ?? {});
    const eventType = typeof body?.eventType === 'string' ? body.eventType
      : (typeof data.secret === 'string' ? 'DEPOSIT_CALLBACK' : 'UNKNOWN');
    const key = typeof data.paymentKey === 'string' ? data.paymentKey.slice(0, 200) : null;
    const orderId = typeof data.orderId === 'string' ? data.orderId.slice(0, 64) : null;
    if (!key && !orderId) return { ok: false, eventType, action: 'IGNORED', note: 'paymentKey · orderId 가 없습니다.' };

    const [row] = await this.db.query<any>(
      key
        ? `SELECT p.id, p.payment_key, p.vbank_secret, p.amount, o.order_no FROM hlt_payments p
             JOIN hlt_orders o ON o.id = p.order_id WHERE p.payment_key = $1`
        : `SELECT p.id, p.payment_key, p.vbank_secret, p.amount, o.order_no FROM hlt_payments p
             JOIN hlt_orders o ON o.id = p.order_id
            WHERE o.order_no = $1 AND p.payment_key IS NOT NULL
            ORDER BY p.created_at DESC LIMIT 1`, [key ?? orderId]);
    /* 우리 건강몰 결제가 아니면(구독 결제 등) 200 으로 받기만 합니다 — 재전송이 쌓이지 않게 */
    if (!row) return { ok: true, eventType, action: 'IGNORED', note: '소개몰 결제가 아닙니다.' };
    if (typeof data.secret === 'string' && row.vbank_secret && data.secret !== row.vbank_secret) {
      return { ok: false, eventType, action: 'REJECTED', note: '입금 알림 secret 이 맞지 않습니다.' };
    }

    const provider = resolvePaymentProvider();
    const look = await provider.getPayment(row.payment_key);
    if (!look.found) {
      if (look.stub) return { ok: false, eventType, action: 'IGNORED', note: look.detail };
      throw new AppError(502, { code: 'PG_LOOKUP_FAILED', message: `결제 조회 실패 — ${look.detail ?? ''}` });
    }
    return this.applyLookup(row.id, look, eventType);
  }

  /** PG 에서 조회한 상태를 우리 결제 · 주문에 반영합니다. 같은 상태면 아무것도 하지 않습니다 */
  private async applyLookup(payId: string, look: PaymentLookup, eventType: string) {
    return this.db.transaction(async () => {
      const [p] = await this.db.query<any>(
        `SELECT p.id, p.state, p.amount, p.method, p.pg_status, o.id AS order_id, o.order_no, o.status AS order_status
           FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
          WHERE p.id = $1 FOR UPDATE OF p, o`, [payId]);
      const res = (action: string, note: string) =>
        ({ ok: true, eventType, action, pgStatus: look.status, state: p.state, stub: look.stub, orderNo: p.order_no, note });

      if (look.orderId && look.orderId !== p.order_no) {
        return { ...res('MISMATCH', 'PG 결제의 주문번호가 다릅니다 — 반영하지 않았습니다.'), ok: false };
      }
      if (look.totalAmount != null && look.totalAmount !== Number(p.amount)) {
        await this.db.query(`UPDATE hlt_payments SET fail_reason = $2 WHERE id = $1`,
          [p.id, `PG 금액 ${look.totalAmount} ≠ 결제 금액 ${p.amount} — 운영 확인 필요`]);
        return { ...res('MISMATCH', 'PG 금액이 결제 금액과 다릅니다 — 반영하지 않았습니다.'), ok: false };
      }

      const st = look.status ?? '';
      if (st === 'DONE') {
        if (p.state === 'PAID') return res('ALREADY', '이미 반영된 결제입니다.');
        if (p.state === 'READY' && p.order_status === 'PENDING') {
          await this.db.query(
            `UPDATE hlt_payments SET state = 'PAID', pg_status = 'DONE',
                    approved_at = coalesce($2::timestamptz, now()), stub = stub OR $3,
                    method = coalesce($4, method), fail_reason = NULL
              WHERE id = $1`,
            [p.id, look.approvedAt ?? null, look.stub, TOSS_METHOD[look.method ?? ''] ?? null]);
          return { ...res('PAID', '입금이 확인되어 결제 완료로 바꿨습니다.'), state: 'PAID' };
        }
        /* 닫힌 주문(취소)에 늦게 들어온 돈 — 주문을 되살리지 않습니다. 운영이 환불해야 합니다 */
        await this.db.query(
          `UPDATE hlt_payments SET pg_status = 'DONE', fail_reason = $2 WHERE id = $1`,
          [p.id, `LATE_DEPOSIT: 주문(${p.order_status})이 닫힌 뒤 입금됨 — 환불 필요`]);
        return { ...res('NEEDS_OPERATOR', '닫힌 주문에 입금되었습니다 — 운영이 환불해야 합니다.'), ok: false };
      }
      if (st === 'WAITING_FOR_DEPOSIT' || st === 'IN_PROGRESS' || st === 'READY') {
        await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE id = $1`, [p.id, st]);
        return res('WAITING', '입금을 기다리고 있습니다.');
      }
      if (['CANCELED', 'PARTIAL_CANCELED', 'EXPIRED', 'ABORTED'].includes(st)) {
        if (p.state === 'CANCELED' || p.state === 'FAILED') {
          await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE id = $1`, [p.id, st]);
          return res('ALREADY', '이미 닫힌 결제입니다.');
        }
        if (p.state === 'READY') {
          /* ★ CANCELED 가 아니라 FAILED — CANCELED 는 fn_hlt_pay_apply 가 주문 취소로 옮깁니다.
           * 입금 전 만료·취소는 결제만 닫고 주문은 결제 대기로 둡니다(다른 수단으로 다시 결제). */
          await this.db.query(
            `UPDATE hlt_payments SET state = 'FAILED', pg_status = $2, fail_reason = $3 WHERE id = $1`,
            [p.id, st, `PG ${st}`]);
          return { ...res('FAILED', '결제가 만료·취소되어 닫았습니다. 주문은 결제 대기로 남습니다.'), state: 'FAILED' };
        }
        /* PAID 인데 PG 쪽에서 취소됨(PG 관리화면 등) — 발송 전 전액 취소면 주문 취소로 반영합니다.
         * 발송 뒤거나 부분 취소면 상태를 바꾸지 않고 운영에 넘깁니다(반품 · 재고 판단이 필요합니다). */
        if (st === 'CANCELED' && ['PAID', 'PREPARING'].includes(p.order_status)) {
          await this.db.query(
            `UPDATE hlt_payments SET state = 'CANCELED', pg_status = $2, canceled_at = now(),
                    canceled_amount = amount WHERE id = $1`, [p.id, st]);
          return { ...res('CANCELED', 'PG 에서 취소된 결제라 주문을 취소했습니다.'), state: 'CANCELED' };
        }
        await this.db.query(
          `UPDATE hlt_payments SET pg_status = $2, fail_reason = $3 WHERE id = $1`,
          [p.id, st, `PG ${st} — 주문(${p.order_status}) 운영 확인 필요`]);
        return { ...res('NEEDS_OPERATOR', 'PG 에서 취소되었지만 발송 뒤라 운영 확인이 필요합니다.'), ok: false };
      }
      await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE id = $1`, [p.id, st || null]);
      return res('RECORDED', `PG 상태 ${st || '알 수 없음'} 을(를) 기록했습니다.`);
    });
  }
}
