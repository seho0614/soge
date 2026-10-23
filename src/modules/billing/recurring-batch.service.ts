import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PaymentProvider, PaymentResult, StubPaymentProvider, resolvePaymentProvider } from './payment.provider';
import { RecurringRefundService } from './recurring-refund.service';

/* D022 — 결과가 불명확한 청구(PENDING)를 다루는 기준 시간.
 *   조회 시작: 잡은 지 이만큼 지난 것부터 배치가 결제사에 묻습니다(그 전에는 청구한 서버가 아직 통신 중일 수 있음).
 *   포기: 「그런 주문이 없다」는 답을 이만큼 지난 뒤에 받으면 실패로 닫고 새 주문번호로 다시 청구합니다.
 *         결제사 응답 제한(10초)보다 충분히 길어야 합니다 — 짧으면 늦게 승인된 결제와 새 청구가 겹칩니다. */
const PENDING_LOOKUP_AFTER_SEC = Number(process.env.BILLING_PENDING_LOOKUP_AFTER_SEC ?? 120);
const PENDING_GIVEUP_AFTER_MIN = Number(process.env.BILLING_PENDING_GIVEUP_AFTER_MIN ?? 30);
/**
 * 결제사 거절 코드(토스 「카드 자동결제 승인」 에러 코드)로 실패를 가릅니다 — 문구는 결제사가 바꿀 수 있고,
 * 실제 문구에는 「만료」 같은 낱말이 없기도 합니다(INVALID_CARD_EXPIRATION = 「카드 정보를 다시 확인해주세요. (유효기간)」).
 *   CARD_UNUSABLE   카드 · 결제 수단을 바꿔야 풀립니다. 몇 번을 두드려도 같은 답 → 하루 1회만(TERMINAL)
 *   INTEGRATION     우리 쪽 연동 설정이 틀렸습니다(열쇠 · 요청 형식). **회원의 결제 실패가 아닙니다** →
 *                   회원을 「결제 실패」로 만들지 않고, 그 배치를 멈추고, 운영에 알립니다
 */
const CARD_UNUSABLE = new Set(['INVALID_STOPPED_CARD', 'INVALID_CARD_LOST_OR_STOLEN', 'INVALID_CARD_EXPIRATION', 'INVALID_CARD_NUMBER',
  'INVALID_REJECT_CARD', 'INVALID_BILL_KEY_REQUEST', 'NOT_SUPPORTED_CARD_TYPE', 'NOT_REGISTERED_CARD_COMPANY',
  'NOT_MATCHES_CUSTOMER_KEY', 'EXCEED_MAX_AUTH_COUNT', 'KYC_BLOCKED']);
const INTEGRATION = new Set(['UNAUTHORIZED_KEY', 'INCORRECT_BASIC_AUTH_FORMAT', 'INVALID_API_KEY', 'FORBIDDEN_REQUEST',
  'INVALID_REQUEST', 'BELOW_MINIMUM_AMOUNT']);

/** 연동 설정 오류로 배치를 멈출 때 던집니다 — 같은 오류가 모든 구독에서 되풀이되므로 더 보내지 않습니다 */
class BillingHalt extends Error {}

/** 정기결제 배치 한 번의 결과 */
export interface BatchResult {
  /** 이번에 청구 대상이던 구독 수 */
  total: number;
  paid: number; failed: number; skipped: number; terminal: number;
  /** 결제사 결과를 아직 확정하지 못해 PENDING 으로 남은 청구 */
  pending: number;
  /** 조회로 결제 완료를 확인해 닫은 청구(paid 에 포함) */
  recovered: number;
  /** 사람이 봐야 하는 것 — 금액 불일치 · 하루 넘게 닫히지 않은 청구/환불 */
  review: number;
  /** 해지한 결제 실패 구독 중 유예가 지나 만료시킨 수 */
  expired: number;
  errors: number;
  refunds: { checked: number; succeeded: number; failed: number; unknown: number };
  details: any[];
}

/**
 * 정기결제 배치 — 만기 구독 청구 · 결과 불명확 청구(PENDING) 조회 · 무료 예약 적용 · 해지 만료 · 실패 알림.
 * 규칙은 recurring.service.ts 머리 주석과 같습니다(D022). 스케줄러와 운영 화면 「지금 청구 · 지금 맞추기」가 부릅니다.
 * v10.86 — recurring.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class RecurringBatchService {
  private readonly log = new Logger(RecurringBatchService.name);
  constructor(private readonly db: DatabaseService, private readonly refunds: RecurringRefundService) {}
  /* 유예 일수와 재시도 횟수는 site_settings 에 있습니다.
   * 카드사 재승인 관행을 보고 조정할 값이라 배포 없이 바뀌어야 합니다. */
  private setting(key: string, fallback: number) {
    return this.db.query<{ v: number }>('SELECT fn_setting_int($1,$2) AS v', [key, fallback])
      .then(r => r[0]?.v ?? fallback);
  }

  /**
   * 실패를 두 갈래로 나눕니다.
   *
   * 모든 실패를 하루 10번 두드리면 안 됩니다.
   * 만료된 카드 하나에 7일 × 10회 = 70번 승인을 요청하면
   * 카드사 이상거래 탐지에 걸리고, 심하면 가맹점 쪽이 제재를 받습니다.
   *
   * 몇 시간 뒤 풀릴 수 있는 실패만 반복 시도합니다.
   */
  private classify(detail?: string, code?: string): 'RETRYABLE' | 'TERMINAL' {
    // 결제사 코드가 있으면 코드로 — 문구보다 믿을 수 있습니다(v10.18).
    if (code && CARD_UNUSABLE.has(code)) return 'TERMINAL';
    const t = (detail ?? '').toLowerCase();
    // 카드 자체가 못 쓰는 상태 — 몇 번을 두드려도 같은 답입니다.
    if (/만료|expired|분실|도난|정지|invalid_card|유효하지 않은|해지된 카드|탈회/.test(t)) {
      return 'TERMINAL';
    }
    // 금액 불일치·소개비 차단은 우리 쪽 문제입니다. 재시도해도 같습니다.
    if (/금액 불일치|inv-11|올바르지 않/.test(t)) return 'TERMINAL';
    // 한도 초과·잔액 부족·통신 장애는 풀릴 수 있습니다.
    return 'RETRYABLE';
  }

  /**
   * 만료일이 지난 구독을 청구합니다.
   *
   * 대상 판단은 v_billing_due 하나가 합니다 — 해지·무료·프로모션·
   * 결제수단 없음·중복·환불 처리 중이 전부 거기서 걸러집니다.
   * 여기서 다시 판단하면 두 곳이 갈립니다.
   *
   * ── D022 (v10.18) 결제사의 실제 결과와 DB 를 같게 ───────────────────
   *   한 기간 = 청구서 한 줄.   재시도가 성공하면 실패했던 그 줄을 결제 완료로 바꿉니다
   *                            (전에는 새 줄을 넣다가 유일 제약에 걸려, 결제는 됐는데 실패로 끝났습니다 — 실측 409).
   *   먼저 잡고(PENDING) 보냅니다.  구독 줄을 잠근 채 대상인지 다시 보고 청구서를 PENDING 으로 만든 뒤 커밋,
   *                            그다음 결제사에 보냅니다. 서버가 둘이어도 · 배치가 겹쳐도 한 번만 나갑니다.
   *   결과는 셋입니다.
   *     승인          청구서 PAID + 기간 연장을 한 트랜잭션으로(연장은 「그 기간이 아직 끝난 그대로일 때」 한 번만)
   *     거절(확정)    청구서 FAILED · 구독 PAST_DUE(유예) — 다음 시도는 **새 주문번호**
   *     불명확        응답 지연 · 연결 끊김 · 5xx. 실패로 적지 않고 PENDING 으로 둡니다. 새 결제도 보내지 않습니다.
   *                   주문번호로 결제사에 물어(곧바로 한 번 · 이후 배치마다) 승인됐으면 PAID,
   *                   「그런 주문이 없다」는 답을 충분히 지난 뒤에도 받으면 그때 실패로 닫고 다시 청구합니다.
   *   순서: ① 끝나지 않은 환불 → ② 결과 불명확 청구 → ③ 해지한 결제 실패 구독의 만료 → ④ 새 청구
   */
  async chargeDue() {
    const provider = resolvePaymentProvider();
    const result: BatchResult = {
      total: 0, paid: 0, failed: 0, skipped: 0, terminal: 0,
      pending: 0, recovered: 0, review: 0, expired: 0, errors: 0,
      refunds: { checked: 0, succeeded: 0, failed: 0, unknown: 0 },
      details: [],
    };
    const step = async (name: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (e: any) {
        result.errors++;
        result.details.push({ step: name, result: 'ERROR', reason: String(e?.message ?? e).slice(0, 200) });
        this.log.error(`정기결제 배치 — ${name} 단계 오류: ${e?.message ?? e}`);
      }
    };

    await step('환불 대조', () => this.refunds.reconcileRefunds(provider, result));
    await step('청구 대조', () => this.reconcilePending(provider, result));
    await step('해지 구독 만료', () => this.expireCancelled(result));
    await step('무료 요금제 예약 적용', () => this.applyFreeReservations(result));

    const due = await this.db.query<{ subscription_id: string }>('SELECT subscription_id FROM v_billing_due');
    result.total = due.length;
    for (const d of due) {
      try {
        await this.chargeOne(provider, d.subscription_id, result);
      } catch (e: any) {
        result.errors++;
        if (e instanceof BillingHalt) {
          /* 우리 쪽 연동 설정 오류 — 다음 구독도 같은 답을 받습니다. 여기서 멈춥니다(회원에게는 아무 일도 일어나지 않습니다) */
          result.details.push({ subscription: d.subscription_id, result: 'HALTED', reason: e.message });
          this.log.error(`정기결제 배치 중단 — ${e.message}`);
          break;
        }
        /* 한 구독의 오류가 나머지 청구를 멈추지 않게 합니다 */
        result.details.push({ subscription: d.subscription_id, result: 'ERROR', reason: String(e?.message ?? e).slice(0, 200) });
        this.log.error(`정기결제 — 구독 ${d.subscription_id} 처리 오류: ${e?.message ?? e}`);
      }
    }

    /* 사람이 봐야 하는 것 — 금액이 다르게 승인됨 · 결제사에서 취소된 결제 · 하루 넘게 닫히지 않은 청구/환불 */
    const [rv] = await this.db.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM subscription_invoices
                WHERE (status = 'PENDING' AND (pg_status IN ('AMOUNT_MISMATCH','CANCELED','PARTIAL_CANCELED')
                                               OR claimed_at < now() - interval '24 hours'))
                   OR pg_status = 'PAID_NOT_APPLIED')::int
            + (SELECT count(*) FROM subscription_refunds
                WHERE state IN ('REQUESTED','PROCESSING','UNKNOWN')
                  AND requested_at < now() - interval '24 hours')::int AS n`);
    result.review = rv?.n ?? 0;

    if (result.failed || result.skipped || result.pending || result.review || result.errors) {
      this.log.warn(
        `정기결제 — 성공 ${result.paid} · 실패 ${result.failed}` +
        `(카드 교체 필요 ${result.terminal}) · 수단없음 ${result.skipped}` +
        ` · 결과 확인 중 ${result.pending} · 사람 확인 필요 ${result.review} · 오류 ${result.errors}`);
    }
    return result;
  }

  /**
   * v10.31 (w6 · 시안 SB-ADM-BIL-010 「지금 대조」) — 새 청구 없이 대조만: 끝나지 않은 환불 · 결과 불명확 청구를 결제사에 물어 닫습니다.
   * 시안의 「(시연)」 단추를 실제 기능으로 둡니다(배치를 기다리지 않고 운영이 바로).
   */
  async reconcileNow() {
    const provider = resolvePaymentProvider();
    const result: BatchResult = {
      total: 0, paid: 0, failed: 0, skipped: 0, terminal: 0,
      pending: 0, recovered: 0, review: 0, expired: 0, errors: 0,
      refunds: { checked: 0, succeeded: 0, failed: 0, unknown: 0 },
      details: [],
    };
    for (const [name, fn] of [['환불 대조', () => this.refunds.reconcileRefunds(provider, result)], ['청구 대조', () => this.reconcilePending(provider, result)]] as const) {
      try { await fn(); } catch (e: any) {
        result.errors++; result.details.push({ step: name, result: 'ERROR', reason: String(e?.message ?? e).slice(0, 200) });
      }
    }
    return result;
  }

  /** 구독 한 건을 청구합니다 — 잡기(커밋) → 결제사 → 결과 반영 */
  private async chargeOne(provider: PaymentProvider, subId: string, result: BatchResult) {
    /* ① 잡기. 구독 줄을 잠그고 **지금도 대상인지** 다시 봅니다.
     *    목록을 읽은 뒤 해지 · 직접 결제 · 다른 서버의 청구가 끼어들었으면 여기서 빠집니다. */
    const claim = await this.db.transaction(async () => {
      const [locked] = await this.db.query('SELECT id FROM subscriptions WHERE id = $1 FOR UPDATE', [subId]);
      if (!locked) return null;
      const [d] = await this.db.query<any>('SELECT * FROM v_billing_due WHERE subscription_id = $1', [subId]);
      if (!d) return null;

      // 결제수단이 없으면 청구할 수단이 없습니다. 실패로 남겨 안내가 나가게 합니다(결제사에는 보내지 않습니다).
      if (!d.billing_key_id) {
        const reason = '등록된 결제 수단이 없습니다';
        const [inv] = await this.db.query<{ id: string }>(
          `INSERT INTO subscription_invoices (subscription_id, period_start, period_end, amount, status, failure_reason, plan_code)
           SELECT s.id, s.current_period_end, s.current_period_end + interval '30 days', $2, 'FAILED', $3, $4
             FROM subscriptions s WHERE s.id = $1
           ON CONFLICT (subscription_id, period_start) DO UPDATE
              SET attempt = subscription_invoices.attempt + 1, failure_reason = EXCLUDED.failure_reason
            WHERE subscription_invoices.status = 'FAILED'
           RETURNING id`, [subId, d.amount, reason, d.plan_code]);
        if (!inv) return null;
        await this.recordAttempt(inv.id, 'NO_METHOD', reason);
        await this.markUnpaid(inv.id);
        return { d, noMethod: true as const };
      }

      /* 청구서 — 그 기간의 줄이 없으면 만들고, 실패한 줄이 있으면 그 줄을 다시 잡습니다(시도 +1).
       * 기간 값은 구독 줄의 값 그대로(SQL 안에서) — Node 를 거치면 밀리초로 잘려 구독의 기간 끝과 달라집니다. */
      const [inv] = await this.db.query<{ id: string; attempt: number; ep: string }>(
        `INSERT INTO subscription_invoices
           (subscription_id, period_start, period_end, amount, status, billing_key_id, attempt, claimed_at, is_stub, plan_code)
         SELECT s.id, s.current_period_end, s.current_period_end + interval '30 days', $2, 'PENDING', $3, 1, clock_timestamp(), $4, $5
           FROM subscriptions s WHERE s.id = $1
         ON CONFLICT (subscription_id, period_start) DO UPDATE
            SET status = 'PENDING', attempt = subscription_invoices.attempt + 1,
                amount = EXCLUDED.amount, billing_key_id = EXCLUDED.billing_key_id, plan_code = EXCLUDED.plan_code,
                failure_reason = NULL, pg_status = NULL, checked_at = NULL,
                payment_key = NULL, order_id = NULL, claimed_at = clock_timestamp(), is_stub = EXCLUDED.is_stub
          WHERE subscription_invoices.status = 'FAILED'
         RETURNING id, attempt, floor(extract(epoch FROM period_start) * 1000)::bigint::text AS ep`,
        /* is_stub — 결제사 열쇠 없는 방식으로 잡은 청구라는 표시. 스텁 방식의 서버는 이 표시가 있는 것만 닫습니다(reconcileOne) */
        [subId, d.amount, d.billing_key_id, provider instanceof StubPaymentProvider, d.plan_code /* G-189 예약 요금제면 그 코드 */]);
      if (!inv) return null;      // 그 기간의 줄이 이미 PENDING · PAID — 다른 청구가 잡았습니다

      /* 주문번호는 시도마다 새로 만듭니다. 거절된 주문번호를 다시 쓰면 결제사가 「중복된 주문번호」로 거절합니다.
       * 구독 36 + 기간 13 + 시도 = 64자 이내(결제사 한도). */
      const orderId = `sub_${subId}_${inv.ep}_a${inv.attempt}`;
      await this.db.query('UPDATE subscription_invoices SET order_id = $2 WHERE id = $1', [inv.id, orderId]);

      const [key] = await this.db.query<{ billing_key: string }>(
        'SELECT billing_key FROM billing_keys WHERE id = $1', [d.billing_key_id]);
      return { d, inv, orderId, billingKey: key?.billing_key };
    });

    if (!claim) return;                       // 대상이 아님 — 그 사이 해지 · 결제 · 다른 서버가 잡음
    const d = claim.d;
    if ('noMethod' in claim) {
      await this.notifyFailure(d, 'NO_METHOD');
      result.skipped++;
      result.details.push({ subscription: subId, result: 'NO_BILLING_KEY' });
      return;
    }
    const { inv, orderId } = claim;

    /* ② 결제사 — DB 잠금 없이 부릅니다(해지 · 조회가 기다리지 않게). 같은 청구가 다시 가도 한 번만 처리되도록 멱등 키를 붙입니다. */
    let pay: PaymentResult;
    try {
      pay = await provider.chargeWithBillingKey({
        billingKey: claim.billingKey ?? '',
        customerKey: d.account_id,
        orderId,
        amount: Number(d.amount),
        orderName: `${d.plan_name} 구독료`,
        idempotencyKey: `sub-charge-${inv.id}-a${inv.attempt}`,
      });
    } catch (e: any) {
      pay = { approved: false, stub: false, uncertain: true, detail: `결제 요청 중 오류: ${String(e?.message ?? e).slice(0, 120)}` };
    }

    /* ③ 결과 */
    if (pay.approved) {
      const applied = await this.settlePaid(inv.id, pay.paymentKey ?? null);
      if (pay.stub) this.log.warn(`정기결제 스텁 — 실제 청구 아님 (${subId})`);
      result.paid++;
      result.details.push({ subscription: subId, result: 'PAID', stub: pay.stub, ...(applied === 'PAID_NOT_APPLIED' ? { review: applied } : {}) });
      return;
    }

    if (!pay.uncertain) {
      if (pay.code && INTEGRATION.has(pay.code)) {
        /* 결제사가 **우리 요청 자체**를 거절 — 돈은 움직이지 않았고 회원의 잘못도 아닙니다.
         * 청구서만 실패로 닫고(다음 배치가 다시 잡습니다) 구독 상태 · 유예 · 회원 안내는 건드리지 않습니다. */
        const why = `결제사 연동 설정 오류(${pay.code}${pay.detail ? ` · ${pay.detail}` : ''}) — 회원의 결제 실패가 아닙니다`;
        await this.settleFailed(inv.id, why, 'SYSTEM', pay.code);
        throw new BillingHalt(why);
      }
      const kind = this.classify(pay.detail, pay.code);
      const closed = await this.settleFailed(inv.id, pay.detail ?? '청구 실패', kind, pay.code);
      if (closed) await this.notifyFailure(d, kind, pay.detail);
      result.failed++;
      if (kind === 'TERMINAL') result.terminal++;
      result.details.push({
        subscription: subId, result: 'FAILED', kind, reason: pay.detail,
        triesToday: Number(d.tries_today) + 1, cap: Number(d.retry_cap),
      });
      return;
    }

    /* 불명확 — 실패로 적지 않습니다. 승인됐을 수 있습니다. */
    await this.db.query(
      `UPDATE subscription_invoices
          SET pg_status = $2, checked_at = now(), payment_key = coalesce(payment_key, $3)
        WHERE id = $1 AND status = 'PENDING'`,
      [inv.id, pay.code ?? 'UNKNOWN', pay.paymentKey ?? null]);
    await this.recordAttempt(inv.id, 'UNKNOWN', `${pay.detail ?? '결제 결과 불명확'} [주문 ${orderId}]`);
    this.log.warn(`정기결제 결과 불명확 — 주문번호로 확인합니다 (${subId} · ${orderId} · ${pay.detail ?? ''})`);

    /* 곧바로 한 번 물어봅니다 — 응답만 끊긴 경우 여기서 닫힙니다. 「없다」는 답은 아직 믿지 않습니다(처리 중일 수 있음). */
    const now = await this.reconcileOne(provider, inv.id, false);
    if (now === 'PAID') {
      result.paid++; result.recovered++;
      result.details.push({ subscription: subId, result: 'PAID', recovered: true });
    } else {
      result.pending++;
      result.details.push({ subscription: subId, result: 'PENDING', reason: pay.detail, orderId });
    }
  }

  /**
   * 결제 완료 반영 — 청구서 PAID + 기간 연장을 한 트랜잭션으로.
   *
   * 여러 곳(청구한 서버 · 대조하는 배치)이 동시에 불러도 한 번만 반영됩니다:
   *   청구서는 PENDING 일 때만 PAID 로, 기간은 「구독의 기간 끝 = 이 청구서의 기간 시작」일 때만 밉니다.
   */
  private async settlePaid(invoiceId: string, paymentKey: string | null): Promise<'PAID' | 'ALREADY' | 'PAID_NOT_APPLIED'> {
    return this.db.transaction(async () => {
      await this.db.query(
        `SELECT s.id FROM subscriptions s
          WHERE s.id = (SELECT subscription_id FROM subscription_invoices WHERE id = $1) FOR UPDATE`, [invoiceId]);
      const [inv] = await this.db.query<{ subscription_id: string; billing_key_id: string | null }>(
        `UPDATE subscription_invoices
            SET status = 'PAID', payment_key = coalesce($2, payment_key), paid_at = now(),
                pg_status = 'DONE', checked_at = now(), failure_reason = NULL
          WHERE id = $1 AND status = 'PENDING'
        RETURNING subscription_id, billing_key_id`, [invoiceId, paymentKey]);
      if (!inv) return 'ALREADY' as const;

      // 기간을 밀고 상태를 되돌립니다. PAST_DUE 였다면 여기서 회복됩니다.
      const moved = await this.db.query(
        `UPDATE subscriptions s
            SET current_period_start = i.period_start, current_period_end = i.period_end,
                status = 'ACTIVE', codes_used_this_period = 0, request_views_used = 0,
                /* G-189 — 예약 요금제로 청구한 것이 결제되면 그때 요금제를 바꿉니다(결제 실패면 그대로 · 10/8 확인 ②) */
                plan_code = coalesce(i.plan_code, s.plan_code),
                next_plan_code = CASE WHEN s.next_plan_code = i.plan_code THEN NULL ELSE s.next_plan_code END,
                next_plan_at   = CASE WHEN s.next_plan_code = i.plan_code THEN NULL ELSE s.next_plan_at END
           FROM subscription_invoices i
          WHERE i.id = $1 AND s.id = i.subscription_id
            AND s.current_period_end = i.period_start AND s.status IN ('ACTIVE','PAST_DUE')
        RETURNING s.id`, [invoiceId]);
      await this.recordAttempt(invoiceId, 'PAID', null);
      if (inv.billing_key_id) {
        await this.db.query('UPDATE billing_keys SET last_used_at = now() WHERE id = $1', [inv.billing_key_id]);
      }
      if (!moved.length) {
        /* 돈은 받았는데 기간을 밀 수 없습니다(그 사이 구독이 끝났거나 기간이 바뀜) — 사람이 봐야 합니다 */
        await this.db.query(`UPDATE subscription_invoices SET pg_status = 'PAID_NOT_APPLIED' WHERE id = $1`, [invoiceId]);
        this.log.error(`정기결제 승인됐으나 구독 기간에 반영하지 못함 — 확인 필요 (청구서 ${invoiceId})`);
        return 'PAID_NOT_APPLIED' as const;
      }
      return 'PAID' as const;
    });
  }

  /**
   * 청구 실패(확정) 반영.
   *
   * 즉시 끊지 않고 PAST_DUE 로 둡니다.
   * 유예 기간이 지나야 만료됩니다 — 카드 한도 초과 한 번으로
   * 서비스가 끊기면 이용자가 잃는 것이 우리가 잃는 것보다 큽니다.
   * 청구서는 그 줄을 FAILED 로 바꿉니다(새 줄을 만들지 않습니다).
   */
  private async settleFailed(invoiceId: string, reason: string, kind: 'RETRYABLE' | 'TERMINAL' | 'SYSTEM', pgCode?: string): Promise<boolean> {
    return this.db.transaction(async () => {
      await this.db.query(
        `SELECT s.id FROM subscriptions s
          WHERE s.id = (SELECT subscription_id FROM subscription_invoices WHERE id = $1) FOR UPDATE`, [invoiceId]);
      const [inv] = await this.db.query(
        `UPDATE subscription_invoices
            SET status = 'FAILED', failure_reason = $2, pg_status = $3, checked_at = now()
          WHERE id = $1 AND status = 'PENDING' RETURNING id`, [invoiceId, reason, pgCode ?? null]);
      if (!inv) return false;                 // 이미 닫힌 청구 — 다른 곳에서 반영했습니다
      await this.recordAttempt(invoiceId, kind, reason);
      /* SYSTEM — 회원 탓이 아닌 실패(연동 설정 오류 · 요청이 결제사에 닿지 않음). 청구서만 닫고(다음 배치가 다시 잡습니다)
       * 구독을 「결제 안 됨」으로 만들지 않습니다. 유예 기간도 세지 않습니다. */
      if (kind !== 'SYSTEM') await this.markUnpaid(invoiceId);
      return true;
    });
  }

  /**
   * 구독을 「결제 안 됨」으로 — PAST_DUE, 유예가 지났으면 EXPIRED.
   *
   * 유예는 **첫 실패 시점**부터 셉니다.
   * 만료일 기준으로 세면 안 됩니다. 어떤 이유로든 갱신이 늦어진 구독은
   * 첫 시도에서 곧바로 EXPIRED 가 됩니다 — 재시도할 기회 자체가 없습니다.
   * 이용자가 잘못한 것은 결제 실패 한 번이지 갱신이 늦은 것이 아닙니다.
   * 「결과 불명확」(UNKNOWN)과 「회원 탓이 아닌 실패」(SYSTEM)는 유예를 세지 않습니다.
   */
  private async markUnpaid(invoiceId: string) {
    const grace = await this.setting('billing.grace_days', 7);
    await this.db.query(
      `UPDATE subscriptions s
          SET status = CASE WHEN f.first_at < now() - ($2 || ' days')::interval THEN 'EXPIRED' ELSE 'PAST_DUE' END
         FROM subscription_invoices i
         LEFT JOIN LATERAL (
           SELECT min(a.attempted_at) AS first_at FROM billing_attempts a
            WHERE a.subscription_id = i.subscription_id
              AND (a.period_start = i.period_start OR a.period_start = date_trunc('milliseconds', i.period_start))
              AND a.result NOT IN ('PAID','UNKNOWN','SYSTEM')) f ON true
        WHERE i.id = $1 AND s.id = i.subscription_id
          AND s.status IN ('ACTIVE','PAST_DUE') AND s.current_period_end = i.period_start`,
      [invoiceId, grace]);
  }

  /**
   * 결과 불명확 청구(PENDING)를 결제사에 물어 닫습니다.
   *
   * allowGiveUp — 「그런 주문이 없다」는 답을 믿어도 되는가. 청구 직후에는 결제사가 아직 처리 중일 수 있어 믿지 않고,
   * 충분히 지난 뒤(BILLING_PENDING_GIVEUP_AFTER_MIN · 기본 30분)에만 실패로 닫습니다. 그래야 다음 시도가 이중 결제가 되지 않습니다.
   */
  private async reconcileOne(provider: PaymentProvider, invoiceId: string, allowGiveUp: boolean):
    Promise<'PAID' | 'FAILED' | 'REVIEW' | 'PENDING'> {
    const [inv] = await this.db.query<any>(
      `SELECT id, order_id, amount, status, is_stub FROM subscription_invoices WHERE id = $1`, [invoiceId]);
    if (!inv || inv.status !== 'PENDING') return inv?.status === 'PAID' ? 'PAID' : 'PENDING';

    /* ★ 결제사 열쇠 없는 방식(스텁)은 실제 결제사에서 일어난 일을 모릅니다 — 모든 주문을 「없음」이라고 답합니다.
     *   실제 결제사로 나간 청구를 스텁이 「없음」으로 닫으면, 승인된 결제를 실패로 적고 (스텁으로) 다시 청구해 가짜 결제 완료를 만듭니다
     *   (실측 — 운영 서버가 실수로 열쇠 없이 뜬 경우). 스텁 방식에서는 스텁으로 잡은 청구만 다룹니다. */
    if (provider instanceof StubPaymentProvider && !inv.is_stub) return 'PENDING';

    const note = (pgStatus: string, paymentKey?: string) => this.db.query(
      `UPDATE subscription_invoices
          SET pg_status = $2, checked_at = now(), payment_key = coalesce(payment_key, $3)
        WHERE id = $1 AND status = 'PENDING'`, [invoiceId, pgStatus, paymentKey ?? null]);

    if (!inv.order_id) {
      /* 주문번호가 없으면 결제사로 나간 적이 없습니다 */
      if (!allowGiveUp) return 'PENDING';
      await this.settleFailed(invoiceId, '청구 요청이 결제사로 나가지 않았습니다', 'SYSTEM', 'NOT_SENT');
      return 'FAILED';
    }

    const got = await provider.getPaymentByOrderId(inv.order_id);
    if (got.found) {
      if (got.status === 'DONE') {
        if (Number(got.totalAmount) === Number(inv.amount) && (!got.orderId || got.orderId === inv.order_id)) {
          await this.settlePaid(invoiceId, got.paymentKey ?? null);
          return 'PAID';
        }
        /* 승인은 됐는데 금액이 다릅니다 — 완료로 적지도, 다시 청구하지도 않습니다. 사람이 봅니다 */
        await note('AMOUNT_MISMATCH', got.paymentKey);
        return 'REVIEW';
      }
      if (got.status === 'ABORTED' || got.status === 'EXPIRED') {
        await this.settleFailed(invoiceId, `결제가 승인되지 않았습니다(결제사 상태 ${got.status})`, 'RETRYABLE', got.status);
        return 'FAILED';
      }
      /* CANCELED · PARTIAL_CANCELED(승인 뒤 누가 취소함) · 그 밖(처리 중) — 자동으로 다시 청구하지 않습니다 */
      await note(got.status ?? 'UNKNOWN', got.paymentKey);
      return got.status === 'CANCELED' || got.status === 'PARTIAL_CANCELED' ? 'REVIEW' : 'PENDING';
    }
    if (got.notFound) {
      if (!allowGiveUp) { await note('NOT_FOUND_YET'); return 'PENDING'; }
      await this.settleFailed(invoiceId,
        '결제사에 이 주문의 결제가 없습니다(요청이 닿지 않았습니다) — 새 주문번호로 다시 청구합니다', 'SYSTEM', 'NOT_FOUND_PAYMENT');
      return 'FAILED';
    }
    /* 조회가 안 됨(결제사 장애 · 통신) — 아무것도 확정하지 않습니다 */
    await this.db.query(`UPDATE subscription_invoices SET checked_at = now() WHERE id = $1 AND status = 'PENDING'`, [invoiceId]);
    return 'PENDING';
  }

  /** 결과 불명확으로 남은 청구들을 닫습니다(배치마다). 방금 잡힌 것은 건드리지 않습니다 — 다른 서버가 결제사와 통신 중일 수 있습니다 */
  private async reconcilePending(provider: PaymentProvider, result: BatchResult) {
    const rows = await this.db.query<{ id: string; subscription_id: string; old: boolean }>(
      `SELECT i.id, i.subscription_id,
              (coalesce(i.claimed_at, i.issued_at) < now() - ($2 || ' minutes')::interval) AS old
         FROM subscription_invoices i
        WHERE i.status = 'PENDING'
          AND coalesce(i.claimed_at, i.issued_at) < now() - ($1 || ' seconds')::interval
        ORDER BY i.checked_at NULLS FIRST, i.claimed_at
        LIMIT 200`, [PENDING_LOOKUP_AFTER_SEC, PENDING_GIVEUP_AFTER_MIN]);
    for (const r of rows) {
      try {
        const out = await this.reconcileOne(provider, r.id, r.old);
        if (out === 'PAID') { result.paid++; result.recovered++; }
        if (out === 'PENDING' || out === 'REVIEW') result.pending++;
        result.details.push({ subscription: r.subscription_id, result: out, reconciled: true });
      } catch (e: any) {
        result.errors++;
        this.log.error(`청구 대조 오류 (청구서 ${r.id}): ${e?.message ?? e}`);
      }
    }
  }

  /**
   * 해지한 결제 실패 구독의 만료.
   *
   * 해지하면 청구 대상에서 빠지므로, 결제 실패(PAST_DUE)인 채 해지한 구독은 「실패한 청구가 유예를 넘겨 만료」되는
   * 길을 타지 못합니다. 유예가 지나면 여기서 만료로 닫습니다(청구는 하지 않습니다).
   */
  /**
   * G-189 — 무료(BASIC)로 내리기를 예약한 구독은 기간이 끝나면 청구하지 않고 무료로 바꿉니다.
   * (v_billing_due 는 청구할 금액이 있는 것만 냅니다 — 예약이 무료면 거기에 나오지 않습니다.)
   * 새 30일 기간을 엽니다 — 무료 요금제의 월 포함 건수 기준(billing.service issueCodes 와 같은 방식).
   */
  private async applyFreeReservations(result: BatchResult) {
    const moved = await this.db.query<{ id: string }>(
      `UPDATE subscriptions s
          SET plan_code = s.next_plan_code, next_plan_code = NULL, next_plan_at = NULL,
              current_period_start = now(), current_period_end = now() + interval '30 days',
              codes_used_this_period = 0, request_views_used = 0, status = 'ACTIVE'
         FROM subscription_plans np
        WHERE np.code = s.next_plan_code AND np.monthly_price = 0
          AND s.status = 'ACTIVE' AND s.cancel_at IS NULL AND s.current_period_end <= now()
          AND NOT EXISTS (SELECT 1 FROM subscription_refunds r
                           WHERE r.subscription_id = s.id AND r.state IN ('REQUESTED','PROCESSING','UNKNOWN'))
      RETURNING s.id`);
    for (const m of moved) result.details.push({ subscription: m.id, result: 'DOWNGRADED_FREE' });
  }

  private async expireCancelled(result: BatchResult) {
    const grace = await this.setting('billing.grace_days', 7);
    const rows = await this.db.query(
      `UPDATE subscriptions s SET status = 'EXPIRED'
        WHERE s.status = 'PAST_DUE' AND s.cancel_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM subscription_invoices i WHERE i.subscription_id = s.id AND i.status = 'PENDING')
          AND NOT EXISTS (SELECT 1 FROM subscription_refunds r
                           WHERE r.subscription_id = s.id AND r.state IN ('REQUESTED','PROCESSING','UNKNOWN'))
          AND coalesce((SELECT min(a.attempted_at) FROM billing_attempts a
                         WHERE a.subscription_id = s.id
                           AND (a.period_start = s.current_period_end OR a.period_start = date_trunc('milliseconds', s.current_period_end))
                           AND a.result NOT IN ('PAID','UNKNOWN','SYSTEM')), s.current_period_end)
              < now() - ($1 || ' days')::interval
      RETURNING s.id`, [grace]);
    result.expired = rows.length;
  }

  /**
   * 청구 실패 안내.
   *
   * 재시도를 하루 10번 해도 안내는 하루 한 번입니다 —
   * 청구 실패마다 문자를 보내면 그 자체가 괴롭힘이 됩니다.
   *
   * 문구를 유형별로 나눕니다. 한도 초과와 카드 만료는 이용자가 할 일이
   * 다릅니다. 같은 문구를 보내면 카드 만료인 사람이 "기다리면 되겠지"
   * 하고 놓칩니다.
   */
  private async notifyFailure(
    d: any, kind: 'RETRYABLE' | 'TERMINAL' | 'NO_METHOD', reason?: string) {

    const code =
      kind === 'TERMINAL'  ? 'SUBSCRIPTION_CARD_UNUSABLE_INAPP' :
      kind === 'NO_METHOD' ? 'SUBSCRIPTION_NO_METHOD_INAPP' :
                             'SUBSCRIPTION_PAYMENT_FAILED_INAPP';

    // 같은 구독·같은 사유·같은 날이면 한 번만.
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);   // 한국 날짜 (10/2 — UTC 면 오전 9시에 날이 바뀜)
    const dedupe = `${d.subscription_id}:${code}:${day}`;

    const grace = await this.setting('billing.grace_days', 7);
    const [tpl] = await this.db.query<{ title: string; body: string }>(
      'SELECT title, body FROM notification_templates WHERE code = $1 AND is_active', [code]);
    if (!tpl) return;

    const fill = (t: string) => (t ?? '')
      .replace(/\{plan\}/g, d.plan_name ?? d.plan_code)
      .replace(/\{graceDays\}/g, String(grace))
      .replace(/\{reason\}/g, reason ?? '확인 필요');

    try {
      await this.db.query(
        `INSERT INTO notifications(account_id, event_code, template_code, title, body, link_url)
         SELECT $1,$2,$3,$4,$5,'/my/payment'
          WHERE NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.account_id = $1 AND n.template_code = $3
               AND n.created_at >= date_trunc('day', now()))`,
        [d.account_id, code.replace(/_INAPP$/, ''), code, fill(tpl.title), fill(tpl.body)]);
    } catch (e: any) {
      this.log.warn(`청구 실패 안내 기록 실패 (${d.subscription_id}): ${e.message}`);
    }

    /* 이메일·SMS 는 여기서 큐에 넣습니다.
     *
     * 다만 SPF/DKIM 이 준비되지 않았으면 보내도 스팸함으로 갑니다.
     * 발송은 성공으로 기록되고 이용자만 못 받습니다 —
     * 가장 발견하기 어려운 형태의 실패입니다.
     * 그래서 준비 여부를 설정으로 두고, 아니면 SKIPPED 로 남깁니다. */
    const [verified] = await this.db.query<{ v: string }>(
      "SELECT value AS v FROM site_settings WHERE key = 'notify.email_verified'");
    if (verified?.v !== 'on') {
      this.log.warn(
        `이메일 안내 미발송 — SPF/DKIM 미확인 (notify.email_verified=off). ` +
        `구독 ${d.subscription_id} 는 인앱 알림만 받았습니다.`);
    }
  }

  /** 시도를 남깁니다. "왜 청구되지 않았는가"를 나중에 설명할 수 있어야 합니다. 기간 · 금액은 청구서의 값 그대로 */
  private async recordAttempt(
    invoiceId: string, result: 'PAID' | 'RETRYABLE' | 'TERMINAL' | 'NO_METHOD' | 'UNKNOWN' | 'SYSTEM', detail: string | null) {
    await this.db.query(
      `INSERT INTO billing_attempts(subscription_id, period_start, amount, result, detail)
       SELECT i.subscription_id, i.period_start, i.amount, $2, $3 FROM subscription_invoices i WHERE i.id = $1`,
      [invoiceId, result, detail]);
  }
}
