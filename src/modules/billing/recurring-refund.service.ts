import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { CancelResult, PaymentLookup, PaymentProvider, StubPaymentProvider, resolvePaymentProvider } from './payment.provider';
import type { BatchResult } from './recurring.service';

/** 다른 곳에서 방금 잡은 환불 요청은 이 시간 동안 건드리지 않습니다 */
const REFUND_BUSY_SEC = 30;

/**
 * 구독 환불 (D022 · v10.18).
 *
 * v10.45 (2026-10-16 · 리팩토링) — recurring.service.ts 에서 옮겼습니다. 동작은 그대로입니다.
 *   회원 요청(refundEligible · refund)과 정기결제 배치의 환불 대조(reconcileRefunds)가 같은 처리(processRefund)를 씁니다.
 *   구독 화면(mySubscription)이 환불 상태를 보이려고 refundView · lastRefund 를 부릅니다.
 */
@Injectable()
export class RecurringRefundService {
  private readonly log = new Logger(RecurringRefundService.name);
  constructor(private readonly db: DatabaseService) {}

  /** 환불 요청 한 건을 화면이 쓰는 모양으로. 세 가지 말만 씁니다 — 환불 완료 · 환불 결과 확인 중 · 환불 실패 */
  refundView(r: any) {
    const label = r.state === 'SUCCEEDED' ? '환불 완료' : r.state === 'FAILED' ? '환불 실패' : '환불 결과 확인 중';
    return {
      refundId: r.id, state: r.state, label, amount: Number(r.amount),
      requestedAt: r.requested_at, refundedAt: r.state === 'SUCCEEDED' ? r.completed_at : null,
      ...(r.state === 'FAILED' ? { failureReason: r.failure_reason ?? null } : {}),
      ...(r.is_stub ? { stub: true } : {}),
      note:
        r.state === 'SUCCEEDED'
          ? (r.is_stub
              ? '연동 전(스텁)이라 실제 환불이 아닙니다.'
              : '결제사에서 결제 취소를 확인했습니다. 카드사에 따라 영업일 기준 3~5일 안에 반영됩니다.')
          : r.state === 'FAILED'
            ? '결제사가 결제 취소를 받아들이지 않았습니다. 구독과 결제는 그대로입니다 — 다시 신청하시거나 고객센터로 문의해 주십시오.'
            : '결제사에서 결과를 확인하는 중입니다. 다시 결제하거나 다른 조치를 하지 않으셔도 됩니다 — 확인되는 대로 반영됩니다.',
    };
  }

  /** 그 구독의 가장 최근 환불 요청. subId 가 없으면 이 계정의 가장 최근 구독의 것 */
  async lastRefund(accountId: string, subId: string | null) {
    const [r] = await this.db.query<any>(
      `SELECT r.* FROM subscription_refunds r
        WHERE r.account_id = $1
          AND r.subscription_id = coalesce($2::uuid,
                (SELECT s.id FROM subscriptions s WHERE s.account_id = $1 ORDER BY s.created_at DESC LIMIT 1))
        ORDER BY r.requested_at DESC LIMIT 1`, [accountId, subId]);
    return r as any | undefined;
  }

  /**
   * 환불 가능 여부.
   *
   * 판정은 `fn_refund_eligible()` 하나가 합니다 — 화면·API·배치가
   * 각자 계산하면 세 곳이 갈리고, 어느 쪽이 맞는지 모르게 됩니다.
   * 결제일 · 이용 수도 같은 근거(fn_refund_basis — 실제 결제한 날의 한국 날짜 · 열람 + 받은 소개코드)에서 냅니다.
   */
  async refundEligible() {
    const me = RequestCtx.actorId()!;
    const [s] = await this.db.query<any>(
      `SELECT id FROM subscriptions WHERE account_id = $1 AND status IN ('ACTIVE','PAST_DUE')`, [me]);
    if (!s) return { eligible: false, reason: '구독이 없습니다.' };

    const last = await this.lastRefund(me, s.id);
    if (last && ['REQUESTED', 'PROCESSING', 'UNKNOWN'].includes(last.state)) {
      return { eligible: false, reason: '환불 결과를 확인하는 중입니다.', refund: this.refundView(last) };
    }
    const [r] = await this.db.query<any>(
      `SELECT eligible, reason FROM fn_refund_eligible($1)`, [s.id]);
    const [b] = await this.db.query<any>(
      `SELECT to_char(paid_on, 'YYYY-MM-DD') AS "paidOn", used FROM fn_refund_basis($1)`, [s.id]);
    return { ...r, paidOn: b?.paidOn ?? null, used: Number(b?.used ?? 0) };
  }

  /**
   * 구독 환불.
   *
   * ── D022 (v10.18) 결제사가 취소한 것을 확인한 뒤에만 「환불 완료」 ─────────────
   * 전에는 결제사에 아무것도 보내지 않고 DB 에만 환불이라고 적었습니다(그마저 상태값 오타로 늘 실패 — 실측 422).
   * 돈은 돌아가지 않았는데 「접수되었습니다」가 나갔습니다.
   *
   *   1. 환불 요청을 만듭니다(subscription_refunds · REQUESTED). 자격(결제 당일 · 미이용)은 **이때** DB 가 판단하고,
   *      그때의 근거(결제한 날 · 이용 수)를 요청에 적어 둡니다. 완료가 자정을 넘겨도 접수 때의 자격으로 처리합니다.
   *      청구서 하나에 살아 있는 요청은 하나뿐입니다(유일 제약) — 같은 환불이 두 번 접수되지 않습니다.
   *   2. 결제사에 취소를 보냅니다. 저장해 둔 실제 결제 키(paymentKey) · 요청마다 고유한 멱등 키 · 금액 · 사유.
   *   3. 결과는 셋입니다.
   *        취소 확인      환불 요청 SUCCEEDED + 청구서 REFUNDED + 구독 종료(CANCELLED)를 한 트랜잭션으로 → 「환불 완료」
   *        거절(확정)     환불 요청 FAILED. 구독 · 청구서는 그대로 → 422 「환불 실패」 (다시 신청하면 새 요청)
   *        불명확         응답 지연 · 연결 끊김 · 취소는 됐는데 우리 기록이 실패. UNKNOWN 으로 두고 → 202 「환불 결과 확인 중」
   *                       다시 요청하거나 배치가 돌 때 결제사에 **먼저 조회**해 이미 취소됐으면 다시 보내지 않고 닫습니다.
   *   환불 처리 중에는 그 구독의 유료 이용 · 갱신 청구를 DB 가 막습니다.
   *
   * 같은 환불을 여러 번 눌러도 결제사 취소는 한 번입니다. 끝난 뒤 다시 누르면 그때의 결과(환불 완료)를 돌려줍니다.
   */
  async refund(reason?: string) {
    const me = RequestCtx.actorId();
    if (!me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const why = (reason ?? '').trim();

    const start = await this.db.transaction(async () => {
      const [s] = await this.db.query<{ id: string }>(
        `SELECT id FROM subscriptions WHERE account_id = $1 AND status IN ('ACTIVE','PAST_DUE') FOR UPDATE`, [me]);
      if (!s) {
        /* 이미 환불로 끝난 구독 — 그때의 결과를 그대로 */
        const last = await this.lastRefund(me, null);
        if (last?.state === 'SUCCEEDED') return { done: last };
        throw new StateConflict('NO_SUBSCRIPTION', '환불할 구독이 없습니다.');
      }
      const [open] = await this.db.query<{ id: string }>(
        `SELECT id FROM subscription_refunds
          WHERE subscription_id = $1 AND state IN ('REQUESTED','PROCESSING','UNKNOWN') LIMIT 1`, [s.id]);
      if (open) return { id: open.id };          // 진행 중인 요청이 있으면 그것을 이어서 처리합니다(사유는 접수 때의 것)

      /* 새 요청에는 사유가 있어야 합니다(DB 도 막습니다). 진행 중인 요청의 결과를 다시 확인할 때는 필요 없습니다. */
      if (!why) throw new PolicyViolation('REFUND_REASON_REQUIRED', '환불 사유를 적어 주십시오.');

      /* 조건은 DB 트리거가 집행합니다. 여기서 한 번 더 보는 것은 사람이 읽을 수 있는 이유를 돌려주기 위해서입니다. */
      const [chk] = await this.db.query<any>(`SELECT eligible, reason FROM fn_refund_eligible($1)`, [s.id]);
      if (!chk?.eligible) throw new PolicyViolation('REFUND_NOT_ELIGIBLE', chk?.reason ?? '환불할 수 없습니다.');
      const [b] = await this.db.query<any>(`SELECT invoice_id, amount FROM fn_refund_basis($1)`, [s.id]);
      const [r] = await this.db.query<{ id: string }>(
        `INSERT INTO subscription_refunds (subscription_id, invoice_id, account_id, amount, reason)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`, [s.id, b.invoice_id, me, b.amount, why]);
      return { id: r.id };
    });

    if ('done' in start) return this.refundView(start.done);

    const r = await this.processRefund(resolvePaymentProvider(), start.id);
    if (r.state === 'FAILED') {
      throw new PolicyViolation('REFUND_FAILED',
        `환불 실패 — ${r.failure_reason ?? '결제사가 결제 취소를 받아들이지 않았습니다'}. 구독과 결제는 그대로입니다.`,
        { refundId: r.id, state: 'FAILED', label: '환불 실패', pgCode: r.failure_code ?? null });
    }
    return this.refundView(r);
  }

  /**
   * 환불 요청 한 건을 끝까지 밀어 봅니다. 요청 처리와 배치가 같은 함수를 씁니다.
   * 돌려주는 것은 그 요청의 지금 상태(SUCCEEDED · FAILED · UNKNOWN · PROCESSING)입니다.
   */
  private async processRefund(provider: PaymentProvider, id: string): Promise<any> {
    /* ① 잡기 — 「처리 중」 표시를 먼저 커밋합니다. 여기서 서버가 죽어도 표시가 남아 배치가 이어받습니다.
     *    다른 곳에서 방금(30초 안) 잡은 요청은 건드리지 않습니다(같은 취소를 겹쳐 보내지 않게 — 보내도 결제사는 한 번만 처리합니다). */
    const [r] = await this.db.query<any>(
      `WITH old AS (SELECT id, state FROM subscription_refunds WHERE id = $1 FOR UPDATE)
       UPDATE subscription_refunds r
          SET state = 'PROCESSING', attempts = r.attempts + 1, processed_at = now()
         FROM old
        WHERE r.id = old.id AND old.state IN ('REQUESTED','PROCESSING','UNKNOWN')
          AND NOT (old.state = 'PROCESSING' AND r.processed_at > now() - ($2 || ' seconds')::interval)
      RETURNING r.*, old.state AS prev`, [id, REFUND_BUSY_SEC]);
    if (!r) {
      const [cur] = await this.db.query<any>(`SELECT * FROM subscription_refunds WHERE id = $1`, [id]);
      return cur;                               // 이미 끝났거나(SUCCEEDED · FAILED) 다른 곳에서 처리 중
    }
    const amount = Number(r.amount);
    const canceledFully = (g: PaymentLookup) =>
      g.found && g.status === 'CANCELED' && Number(g.totalAmount) - Number(g.balanceAmount ?? 0) === amount;

    /* ② 결제 키 — 청구서에 저장해 둔 결제사의 키. 고치기 전의 정기결제 줄은 주문번호만 있으므로 조회해 채웁니다 */
    const [inv] = await this.db.query<any>(
      `SELECT id, payment_key, order_id, is_stub FROM subscription_invoices WHERE id = $1`, [r.invoice_id]);
    /* ★ 스텁은 모든 취소를 「성공」이라고 답합니다. 실제 결제사로 받은 결제를 스텁 방식의 서버가 환불하면
     *   돈은 돌아가지 않았는데 「환불 완료」가 됩니다(실측). 확인 중으로 두고, 결제사와 연결된 서버가 이어받게 합니다. */
    if (provider instanceof StubPaymentProvider && !inv?.is_stub) {
      return this.refundUnknown(id, 'STUB_MODE', '결제사 열쇠가 없는 방식(스텁)의 서버라 실제 결제를 취소할 수 없습니다 — 결제사와 연결된 서버가 이어서 처리합니다');
    }
    let paymentKey: string | null = inv?.payment_key ?? null;
    if (!paymentKey && inv?.order_id) {
      const got = await provider.getPaymentByOrderId(inv.order_id);
      if (got.found && got.paymentKey) {
        paymentKey = got.paymentKey;
        await this.db.query(
          `UPDATE subscription_invoices SET payment_key = $2 WHERE id = $1 AND payment_key IS NULL`,
          [inv.id, paymentKey]).catch(() => undefined);
      } else if (got.stub) {
        paymentKey = inv.order_id;              // 스텁은 서버를 다시 띄우면 잊습니다 — 주문번호로 그대로 진행
      } else if (got.notFound) {
        return this.refundFail(id, 'NOT_FOUND_PAYMENT', '결제사에서 이 결제를 찾지 못했습니다');
      } else {
        return this.refundUnknown(id, 'LOOKUP_FAILED', got.detail ?? '결제 조회 실패');
      }
    }
    if (!paymentKey) {
      return this.refundFail(id, 'NO_PAYMENT_KEY', '결제 기록에 결제 키가 없어 자동으로 환불할 수 없습니다 — 고객센터로 문의해 주십시오');
    }

    /* ③ 전에 취소를 보낸 적이 있으면(응답을 못 받았을 수 있음) 먼저 조회 — 이미 취소됐으면 다시 보내지 않습니다 */
    if (r.prev !== 'REQUESTED') {
      const seen = await provider.getPayment(paymentKey);
      if (canceledFully(seen)) {
        return this.refundDone(id, { canceledAmount: amount, pgStatus: 'CANCELED', transactionKey: seen.transactionKey, stub: seen.stub });
      }
      if (seen.found && seen.status === 'PARTIAL_CANCELED') {
        return this.refundUnknown(id, 'PARTIAL_CANCELED', '결제사에 일부만 취소된 것으로 나옵니다 — 확인이 필요합니다');
      }
      if (!seen.found && !seen.notFound && !seen.stub) {
        return this.refundUnknown(id, 'LOOKUP_FAILED', seen.detail ?? '결제 조회 실패');   // 조회가 안 되면 취소도 보내지 않습니다
      }
    }

    /* ④ 취소 요청 — 같은 멱등 키(sub-refund-<요청 id>)라 다시 보내도 결제사는 한 번만 취소합니다 */
    let c: CancelResult;
    try {
      c = await provider.cancel({
        paymentKey, cancelReason: String(r.reason).slice(0, 200),
        cancelAmount: amount, idempotencyKey: r.pg_idem_key,
      });
    } catch (e: any) {
      c = { ok: false, stub: false, uncertain: true, detail: `취소 요청 중 오류: ${String(e?.message ?? e).slice(0, 120)}` };
    }
    if (c.ok) {
      return this.refundDone(id, { canceledAmount: c.canceledAmount ?? amount, pgStatus: c.status ?? 'CANCELED', transactionKey: c.transactionKey, stub: c.stub });
    }
    if (!c.uncertain) {
      return this.refundFail(id, c.code ?? 'CANCEL_REJECTED', c.detail ?? '결제사가 결제 취소를 받아들이지 않았습니다');
    }

    /* ⑤ 불명확 — 곧바로 한 번 조회합니다. 취소가 확인되면 완료, 아니면 「확인 중」으로 둡니다 */
    const got = await provider.getPayment(paymentKey);
    if (canceledFully(got)) {
      return this.refundDone(id, { canceledAmount: amount, pgStatus: 'CANCELED', transactionKey: got.transactionKey, stub: got.stub });
    }
    return this.refundUnknown(id, got.found ? (got.status ?? 'UNKNOWN') : (c.code ?? 'NO_RESPONSE'), c.detail ?? '결제사 응답을 받지 못했습니다');
  }

  /** 환불 완료 — 결제사 취소를 확인한 뒤에만 부릅니다. 환불 요청 · 청구서 · 구독을 한 트랜잭션으로 바꿉니다 */
  private async refundDone(id: string, pg: { canceledAmount: number; pgStatus: string; transactionKey?: string; stub?: boolean }): Promise<any> {
    try {
      let fresh = false;      // 이번에 완료로 바뀌었는가(이미 완료였던 것을 다시 본 것이 아닌가) — 알림은 한 번만
      const out = await this.db.transaction(async () => {
        await this.db.query(
          `SELECT s.id FROM subscriptions s
            WHERE s.id = (SELECT subscription_id FROM subscription_refunds WHERE id = $1) FOR UPDATE`, [id]);
        const [cur] = await this.db.query<any>(`SELECT * FROM subscription_refunds WHERE id = $1 FOR UPDATE`, [id]);
        if (!cur || cur.state === 'SUCCEEDED' || cur.state === 'FAILED') return cur;

        const [done] = await this.db.query<any>(
          `UPDATE subscription_refunds
              SET state = 'SUCCEEDED', canceled_amount = $2, pg_status = $3, pg_transaction_key = $4,
                  is_stub = $5, checked_at = now(), failure_code = NULL, failure_reason = NULL
            WHERE id = $1 RETURNING *`,
          [id, pg.canceledAmount, pg.pgStatus, pg.transactionKey ?? null, !!pg.stub]);
        await this.db.query(
          `UPDATE subscription_invoices SET status = 'REFUNDED', pg_status = $2 WHERE id = $1 AND status = 'PAID'`,
          [cur.invoice_id, pg.pgStatus]);
        /* 환불 = 그 구독의 종료. 상태값은 CANCELLED 입니다(전에는 CANCELED 로 써서 제약에 걸렸습니다) */
        await this.db.query(
          `UPDATE subscriptions SET refunded_at = now(), refund_reason = $2, status = 'CANCELLED'
            WHERE id = $1 AND refunded_at IS NULL`, [cur.subscription_id, cur.reason]);
        this.log.log(`구독 환불 완료 ${cur.subscription_id} (요청 ${id}${pg.stub ? ' · 스텁' : ''})`);
        fresh = true;
        return done;
      });
      if (fresh && out) await this.notifyRefund(out);
      return out;
    } catch (e: any) {
      /* 결제사는 취소했는데 우리 기록이 실패 — 「환불 완료」라고 답하지 않습니다. 확인 중으로 두면 다음에 조회로 닫힙니다 */
      this.log.error(`환불: 결제사 취소는 확인됐으나 완료 기록 실패 — 다음 대조에서 닫습니다 (요청 ${id}): ${e?.message ?? e}`);
      return this.refundUnknown(id, 'CANCELED_NOT_RECORDED', `완료 기록 실패: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  /**
   * 환불 결과 알림(완료 · 실패). 「환불 결과 확인 중」으로 답을 받은 회원은 화면을 다시 열기 전에는 결과를 모릅니다 —
   * 배치가 나중에 닫은 환불도 같은 길로 알립니다. 알림을 남기지 못해도 환불 처리는 되돌리지 않습니다.
   */
  private async notifyRefund(r: any) {
    const done = r.state === 'SUCCEEDED';
    const code = done ? 'SUBSCRIPTION_REFUND_DONE_INAPP' : 'SUBSCRIPTION_REFUND_FAILED_INAPP';
    try {
      const [tpl] = await this.db.query<{ title: string; body: string }>(
        'SELECT title, body FROM notification_templates WHERE code = $1 AND is_active', [code]);
      if (!tpl) return;
      const fill = (t: string) => (t ?? '')
        .replace(/\{amount\}/g, Number(r.amount).toLocaleString('ko-KR'))
        .replace(/\{reason\}/g, String(r.failure_reason ?? '사유 미상').replace(/[{}]/g, ''));
      const body = fill(tpl.body) + (done && r.is_stub ? ' (연동 전이라 실제 환불이 아닙니다.)' : '');
      await this.db.query(
        `INSERT INTO notifications(account_id, event_code, template_code, title, body, link_url)
         VALUES ($1,$2,$3,$4,$5,'/my/subscription')`,
        [r.account_id, code.replace(/_INAPP$/, ''), code, fill(tpl.title), body]);
    } catch (e: any) {
      this.log.warn(`환불 결과 알림 기록 실패 (요청 ${r.id}): ${e?.message ?? e}`);
    }
  }

  private async refundFail(id: string, code: string, reason: string): Promise<any> {
    const [r] = await this.db.query<any>(
      `UPDATE subscription_refunds
          SET state = 'FAILED', failure_code = $2, failure_reason = $3, checked_at = now()
        WHERE id = $1 AND state IN ('REQUESTED','PROCESSING','UNKNOWN') RETURNING *`, [id, code, reason]);
    if (r) {
      this.log.warn(`구독 환불 실패(결제사 거절) — 요청 ${id}: ${code} ${reason}`);
      await this.notifyRefund(r);
      return r;
    }
    const [cur] = await this.db.query<any>(`SELECT * FROM subscription_refunds WHERE id = $1`, [id]);
    return cur;
  }

  private async refundUnknown(id: string, pgStatus: string, detail: string): Promise<any> {
    const [r] = await this.db.query<any>(
      `UPDATE subscription_refunds
          SET state = 'UNKNOWN', pg_status = $2, failure_reason = $3, checked_at = now()
        WHERE id = $1 AND state IN ('REQUESTED','PROCESSING','UNKNOWN') RETURNING *`, [id, pgStatus, detail]);
    if (r) { this.log.warn(`구독 환불 결과 확인 중 — 요청 ${id}: ${pgStatus} ${detail}`); return r; }
    const [cur] = await this.db.query<any>(`SELECT * FROM subscription_refunds WHERE id = $1`, [id]);
    return cur;
  }

  /** 끝나지 않은 환불을 닫습니다(배치마다) — 요청을 처리하다 서버가 죽었거나 결제사 답을 못 받은 것 */
  async reconcileRefunds(provider: PaymentProvider, result: BatchResult) {
    const open = await this.db.query<{ refund_id: string }>(
      `SELECT refund_id FROM v_sub_refund_open ORDER BY requested_at LIMIT 100`);
    for (const o of open) {
      try {
        const r = await this.processRefund(provider, o.refund_id);
        result.refunds.checked++;
        if (r?.state === 'SUCCEEDED') result.refunds.succeeded++;
        else if (r?.state === 'FAILED') result.refunds.failed++;
        else result.refunds.unknown++;
      } catch (e: any) {
        result.errors++;
        this.log.error(`환불 대조 오류 (요청 ${o.refund_id}): ${e?.message ?? e}`);
      }
    }
  }
}
