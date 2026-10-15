import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { CancelResult, PaymentLookup, PaymentProvider, PaymentResult, StubPaymentProvider, resolvePaymentProvider } from './payment.provider';
import { resolveBankVerifyProvider } from './bank-verify.provider';

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

/** 다른 곳에서 방금 잡은 환불 요청은 이 시간 동안 건드리지 않습니다 */
const REFUND_BUSY_SEC = 30;

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
 * 정기결제 · 구독 관리.
 *
 * ── 규칙 ───────────────────────────────────────────────────────────
 *   해지하면 청구하지 않는다        cancel_at 이 찍히면 그 기간까지만
 *   해지하지 않으면 자동 청구한다   만료일에 배치가 청구
 *   같은 기간을 두 번 청구하지 않는다
 *
 * 마지막 규칙은 DB의 유일 제약이 지킵니다. 배치가 두 번 돌아도,
 * 사람이 수기로 눌러도 막힙니다.
 *
 * ── D022 (v10.18) ──────────────────────────────────────────────────
 *   결제사의 실제 결과와 DB 가 같아야 한다   승인 확인 뒤에만 결제 완료, 취소 확인 뒤에만 환불 완료
 *   결과를 모르면 모른다고 적는다            실패로 적지도, 다시 보내지도 않고 결제사에 물어 닫는다
 *   다시 시도해도 한 번만 반영된다           청구 · 환불 모두
 *
 * ── 실패했을 때 ────────────────────────────────────────────────────
 * 청구가 실패하면 구독을 즉시 끊지 않고 PAST_DUE 로 둡니다.
 * 카드 한도 초과나 일시적 장애로 서비스가 끊기면 이용자가 잃는 것이
 * 우리가 잃는 것보다 큽니다. 유예 기간을 두고 재시도합니다.
 */
@Injectable()
export class RecurringBillingService {
  private readonly log = new Logger(RecurringBillingService.name);
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

  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  /* ── 결제 수단 ─────────────────────────────────────────────────── */

  /**
   * 결제 수단 등록.
   *
   * 카드번호를 받지 않습니다. 결제창이 직접 받고 우리는 authKey 만 받습니다.
   * 카드 정보가 우리 서버를 지나가면 PCI-DSS 범위에 들어갑니다.
   */
  async registerBillingKey(authKey: string) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    if (!authKey) throw new PolicyViolation('NO_AUTH_KEY', '결제창 인증값이 없습니다.');

    const res = await resolvePaymentProvider().issueBillingKey({
      authKey, customerKey: this.me,
    });
    if (!res.approved) {
      throw new PolicyViolation('BILLING_KEY_FAILED', res.detail ?? '결제 수단 등록에 실패했습니다.');
    }

    return this.db.transaction(async () => {
      // 계정당 활성 결제수단은 하나입니다. 이전 것을 내리고 새로 답니다.
      await this.db.query(
        `UPDATE billing_keys SET status='REVOKED', revoked_at=now()
          WHERE account_id=$1 AND status='ACTIVE'`, [this.me]);

      const [row] = await this.db.query<any>(
        `INSERT INTO billing_keys(account_id, billing_key, card_company, card_last4)
         VALUES ($1,$2,$3,$4)
         RETURNING id, card_company AS "cardCompany", card_last4 AS "cardLast4",
                   registered_at AS "registeredAt"`,
        [this.me, res.billingKey, res.cardCompany ?? null, res.cardLast4 ?? null]);

      // 응답에 billingKey 를 담지 않습니다.
      return { ...row, stub: res.stub,
        note: res.stub ? '스텁 동작 — 실제 카드가 등록된 것이 아닙니다' : null };
    });
  }

  async myBillingKey() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const [row] = await this.db.query<any>(
      `SELECT id, card_company AS "cardCompany", card_last4 AS "cardLast4",
              registered_at AS "registeredAt", last_used_at AS "lastUsedAt"
         FROM billing_keys WHERE account_id=$1 AND status='ACTIVE'`, [this.me]);
    return row ?? { registered: false, note: '등록된 결제 수단이 없습니다. 자동 청구가 되지 않습니다.' };
  }

  async removeBillingKey() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');

    // 유료 구독이 살아 있는데 결제수단만 지우면 다음 청구가 실패합니다.
    // 막지는 않되 무슨 일이 생기는지 알려 줍니다.
    const [sub] = await this.db.query<any>(
      `SELECT s.id, p.monthly_price, s.current_period_end
         FROM subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
        WHERE s.account_id=$1 AND s.status IN ('ACTIVE','PAST_DUE')
          AND p.monthly_price > 0 AND s.cancel_at IS NULL`, [this.me]);

    const rows = await this.db.query(
      `UPDATE billing_keys SET status='REVOKED', revoked_at=now()
        WHERE account_id=$1 AND status='ACTIVE' RETURNING id`, [this.me]);

    return { removed: rows.length > 0,
      warning: sub
        ? `유료 구독이 유지 중입니다. ${new Date(sub.current_period_end).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 갱신 시 청구가 실패하며, 결제 수단을 다시 등록하지 않으면 구독이 만료됩니다.`
        : null };
  }

  /* ── 구독 관리 ─────────────────────────────────────────────────── */

  /** 환불 요청 한 건을 화면이 쓰는 모양으로. 세 가지 말만 씁니다 — 환불 완료 · 환불 결과 확인 중 · 환불 실패 */
  private refundView(r: any) {
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
  private async lastRefund(accountId: string, subId: string | null) {
    const [r] = await this.db.query<any>(
      `SELECT r.* FROM subscription_refunds r
        WHERE r.account_id = $1
          AND r.subscription_id = coalesce($2::uuid,
                (SELECT s.id FROM subscriptions s WHERE s.account_id = $1 ORDER BY s.created_at DESC LIMIT 1))
        ORDER BY r.requested_at DESC LIMIT 1`, [accountId, subId]);
    return r as any | undefined;
  }

  async mySubscription() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const [row] = await this.db.query<any>(
      `SELECT s.id, s.plan_code AS "planCode", p.name AS "planName",
              p.monthly_price AS "monthlyPrice", s.status,
              s.current_period_start AS "periodStart",
              s.current_period_end   AS "periodEnd",
              s.cancel_at            AS "cancelAt",
              s.is_promo AS "isPromo", s.promo_ends_at AS "promoEndsAt",
              s.next_plan_code AS "nextPlanCode", np.name AS "nextPlanName",
              np.monthly_price AS "nextPlanPrice", s.next_plan_at AS "nextPlanAt",
              (b.id IS NOT NULL) AS "hasBillingKey",
              EXISTS (SELECT 1 FROM subscription_invoices i
                       WHERE i.subscription_id = s.id AND i.status = 'PENDING') AS "chargeInFlight"
         FROM subscriptions s
         JOIN subscription_plans p ON p.code = s.plan_code
         LEFT JOIN subscription_plans np ON np.code = s.next_plan_code
         LEFT JOIN billing_keys b ON b.account_id = s.account_id AND b.status='ACTIVE'
        WHERE s.account_id=$1 AND s.status IN ('ACTIVE','PAST_DUE')`, [this.me]);

    /* 환불 상태 — 구독이 환불로 끝난 뒤에도 「환불 완료」가 보여야 합니다 */
    const last = await this.lastRefund(this.me, row?.id ?? null);
    const refund = last ? this.refundView(last) : undefined;

    if (!row) return { subscribed: false, ...(refund ? { refund } : {}) };

    const refundOpen = !!last && ['REQUESTED', 'PROCESSING', 'UNKNOWN'].includes(last.state);
    /* G-189 — 예약이 있으면 다음 결제일의 청구는 예약 요금제 값입니다(예약이 무료면 청구 없음 · 무료로 바뀜) */
    const nextPrice = row.nextPlanCode ? Number(row.nextPlanPrice) : Number(row.monthlyPrice);
    const willCharge =
      !row.cancelAt && !refundOpen && Number(row.monthlyPrice) > 0 && nextPrice > 0 &&
      (!row.promoEndsAt || new Date(row.promoEndsAt) <= new Date(row.periodEnd));
    /* 20261007 (v10.20 · G-125) — 안내 글의 날짜는 한국 날짜로. 서버가 UTC(개발 Docker · AWS)면 한국 0 ~ 9시에 끝나는 기간이 하루 전으로 나왔습니다. */
    const until = new Date(row.periodEnd).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

    return {
      subscribed: true, ...row,
      autoRenew: !row.cancelAt,
      nextChargeAt: willCharge ? row.periodEnd : null,
      nextChargeAmount: willCharge ? nextPrice : null,
      ...(refund ? { refund } : {}),
      notice: refundOpen
        ? '환불 결과를 확인하는 중입니다. 결과가 나올 때까지 이 구독의 이용 · 갱신이 멈춥니다.'
        : row.chargeInFlight
          ? '정기결제 결과를 결제사에서 확인하는 중입니다. 확인되는 대로 반영됩니다 — 다시 결제하지 마십시오.'
          : row.cancelAt
            ? (row.status === 'PAST_DUE'
                ? '해지되었습니다. 더 청구하지 않습니다. 결제가 완료되지 않은 기간이라 지금은 유료 기능을 쓸 수 없습니다.'
                : `해지 예약되었습니다. ${until}까지 이용할 수 있고 이후 청구되지 않습니다.`)
            : row.status === 'PAST_DUE'
              ? '정기결제가 실패했습니다. 결제 수단을 확인해 주십시오 — 유예 기간 안에 결제되지 않으면 구독이 만료됩니다.'
              : willCharge && !row.hasBillingKey
                ? '자동 갱신 예정이지만 결제 수단이 없습니다. 등록하지 않으면 갱신에 실패합니다.'
                : row.nextPlanCode
                  ? `${until} 다음 결제일부터 ${row.nextPlanName}(월 ${nextPrice.toLocaleString('ko-KR')}원)으로 바뀝니다 — 예약을 거두면 지금 요금제로 이어집니다.`
                  : null,
    };
  }

  /**
   * 구독 해지(자동 갱신 중지).
   *
   * 즉시 끊지 않습니다. 이미 낸 기간은 쓸 수 있어야 합니다.
   * cancel_at 을 찍으면 그 이후로 청구되지 않고, 기간이 끝나면 만료됩니다.
   *
   * ── D022 (v10.18) ──────────────────────────────────────────────
   *   · 결제 실패(PAST_DUE) 상태에서도 해지할 수 있습니다. 전에는 ACTIVE 만 받아, 카드가 막힌 회원이
   *     「더 청구하지 말라」고 할 방법이 없었습니다(실측 409 NOT_CANCELLABLE — 그 사이 재시도 청구는 계속 나감).
   *   · 이미 해지한 구독이면 오류가 아니라 그때의 결과를 돌려줍니다(버튼을 두 번 눌러도 같은 답).
   *   · 청구와의 순서는 구독 줄 잠금이 정합니다. 여기서 줄을 잠그고 해지 시각을 찍으므로,
   *     그 뒤에 「청구를 잡으려는」 배치는 해지된 것을 보고 멈춥니다(DB 트리거도 같은 것을 막습니다).
   *     해지보다 먼저 잡혀 이미 결제사로 나간 청구는 되돌릴 수 없습니다 — 그 사실을 응답에 밝힙니다(chargeInFlight).
   */
  async cancel(reason?: string) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');

    const out = await this.db.transaction(async () => {
      const [s] = await this.db.query<any>(
        `SELECT id, status, cancel_at, current_period_end FROM subscriptions
          WHERE account_id = $1 AND status IN ('ACTIVE','PAST_DUE') FOR UPDATE`, [this.me]);
      if (!s) throw new StateConflict('NOT_CANCELLABLE', '해지할 구독이 없습니다.');

      const already = s.cancel_at != null;
      let cancelAt = s.cancel_at;
      if (!already) {
        /* 실제 시각(clock_timestamp) — 잠금을 잡은 순서와 시각의 앞뒤가 같아야 「해지 뒤에 잡힌 청구」를 가려낼 수 있습니다 */
        const [u] = await this.db.query<any>(
          `UPDATE subscriptions SET cancel_at = clock_timestamp() WHERE id = $1 RETURNING cancel_at`, [s.id]);
        cancelAt = u.cancel_at;
      }
      const [inflight] = await this.db.query(
        `SELECT 1 FROM subscription_invoices WHERE subscription_id = $1 AND status = 'PENDING' LIMIT 1`, [s.id]);
      return { id: s.id, status: s.status, periodEnd: s.current_period_end, cancelAt, already, inflight: !!inflight };
    });

    if (!out.already) this.log.log(`구독 해지 예약 ${out.id}${reason ? ` — ${reason}` : ''}`);
    const until = new Date(out.periodEnd).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    const base = out.status === 'PAST_DUE'
      ? '해지되었습니다. 더 청구하지 않습니다(결제 재시도도 멈춥니다).'
      : `${until}까지 이용할 수 있습니다. 이후 자동 청구되지 않습니다.`;
    return {
      id: out.id, periodEnd: out.periodEnd, cancelAt: out.cancelAt,
      cancelled: true, alreadyCancelled: out.already, chargeInFlight: out.inflight,
      note: out.inflight
        ? `${out.already ? '이미 해지한 구독입니다. ' : ''}해지 전에 시작되어 결제사에서 진행 중인 청구가 1건 있습니다 — 그 청구가 승인되면 한 기간이 더 이어지고, 그 뒤로는 청구되지 않습니다. 원하지 않으시면 결제 당일 환불을 신청하실 수 있습니다.`
        : `${out.already ? '이미 해지한 구독입니다. ' : ''}${base}`,
    };
  }

  /** 해지 철회. 기간이 남아 있으면 자동 갱신으로 돌아갑니다. */
  async resume() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const [row] = await this.db.query<any>(
      `UPDATE subscriptions SET cancel_at = NULL
        WHERE account_id=$1 AND status='ACTIVE'
          AND cancel_at IS NOT NULL AND current_period_end > now()
      RETURNING id, current_period_end AS "periodEnd"`, [this.me]);
    if (!row) throw new StateConflict('NOT_RESUMABLE', '철회할 해지 예약이 없거나 이미 기간이 끝났습니다.');
    return { ...row, resumed: true, note: '자동 갱신으로 돌아갑니다.' };
  }

  async invoices() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    /* v10.31 (시안 「결제 내역」 — 구독료 · 초과 소개코드가 한 표에) — 초과 소개코드 발급비(referral_code_payments)를 함께 냅니다.
     *   kind: SUBSCRIPTION(구독료) · EXTRA_CODE(초과 소개코드 · 건당 정액). 결제 키는 내보내지 않습니다(주문번호만). */
    return this.db.query(
      `SELECT * FROM (
         SELECT i.id::text AS id, 'SUBSCRIPTION' AS kind, i.plan_code AS "planCode",
                i.period_start AS "periodStart", i.period_end AS "periodEnd",
                i.amount, i.status, i.attempt, i.failure_reason AS "failureReason",
                i.paid_at AS "paidAt", i.refunded_at AS "refundedAt", i.issued_at AS "issuedAt",
                NULL::int AS "codeCount", NULL::numeric AS "unitPrice", false AS stub,
                coalesce(i.paid_at, i.issued_at, i.period_start::timestamptz) AS sort_at
           FROM subscription_invoices i
           JOIN subscriptions s ON s.id = i.subscription_id
          WHERE s.account_id=$1
         UNION ALL
         SELECT p.order_id, 'EXTRA_CODE', s.plan_code,
                p.paid_at, NULL, p.amount, 'PAID', 1, NULL,
                p.paid_at, NULL, p.paid_at,
                p.code_count, p.unit_price, p.stub, p.paid_at
           FROM referral_code_payments p
           JOIN subscriptions s ON s.id = p.subscription_id
          WHERE p.account_id=$1
       ) x ORDER BY sort_at DESC LIMIT 50`, [this.me])
      .then((rows) => rows.map(({ sort_at, ...r }: any) => r));
  }

  /* ── 자동 청구 배치 ────────────────────────────────────────────── */

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

    await step('환불 대조', () => this.reconcileRefunds(provider, result));
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
    for (const [name, fn] of [['환불 대조', () => this.reconcileRefunds(provider, result)], ['청구 대조', () => this.reconcilePending(provider, result)]] as const) {
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

  /**
   * 청구 정책 조회.
   *
   * 저장된 값과 실제 동작에 쓰이는 값을 나란히 냅니다.
   * 둘이 다르면 설정이 먹지 않은 것입니다 — 그 사실을 화면이 알아야 합니다.
   */
  policy() {
    return this.db.query(
      `SELECT p.key, p.stored, p.effective, p.meaning,
              s.value_pattern AS "pattern", s.value_example AS "example",
              s.description
         FROM v_billing_policy p
         JOIN site_settings s ON s.key = p.key
        ORDER BY p.key`);
  }

  /**
   * 청구 정책 변경.
   *
   * 형식 검증은 DB 트리거가 합니다(fn_setting_validate).
   * 여기서 다시 판정하면 두 곳이 갈립니다 —
   * 범위를 바꿀 때 한 곳만 고치면 조용히 어긋납니다.
   */
  async updatePolicy(key: string, value: string) {
    if (!/^billing\.(grace_days|retry_per_day|terminal_retry_per_day)$/.test(key)) {
      throw new PolicyViolation('NOT_POLICY_KEY', '청구 정책 항목이 아닙니다.');
    }
    const [row] = await this.db.query<any>(
      `UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now()
        WHERE key = $1
      RETURNING key, value`, [key, value, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NO_SUCH_SETTING', '없는 설정입니다.');

    const [after] = await this.db.query<any>(
      'SELECT stored, effective FROM v_billing_policy WHERE key = $1', [key]);
    return { ...row, ...after,
      note: after.stored === String(after.effective)
        ? '즉시 반영됩니다. 배포가 필요 없습니다.'
        : '저장값과 동작값이 다릅니다 — 확인이 필요합니다.' };
  }

  /** 오늘 청구 시도 현황. 한도에 걸려 밀린 건이 보입니다. */
  attemptsToday() {
    return this.db.query(
      `SELECT t.*, s.plan_code, s.account_id,
              fn_setting_int('billing.retry_per_day', 10) AS cap
         FROM v_billing_attempts_today t
         JOIN subscriptions s ON s.id = t.subscription_id
        ORDER BY t.last_attempt DESC`);
  }

  /** 청구 실패했는데 안내가 나가지 않은 구독. 비어 있어야 정상입니다. */
  noticeMissing() {
    return this.db.query('SELECT * FROM v_billing_notice_missing ORDER BY due_at');
  }

  /** 운영 조회. 청구가 밀린 구독을 봅니다. */
  overdue() {
    return this.db.query(
      `SELECT s.id, s.account_id, s.plan_code, s.status,
              s.current_period_end AS "periodEnd",
              i.attempt, i.failure_reason AS "failureReason",
              (b.id IS NOT NULL) AS "hasBillingKey"
         FROM subscriptions s
         LEFT JOIN billing_keys b ON b.account_id=s.account_id AND b.status='ACTIVE'
         LEFT JOIN LATERAL (
           SELECT attempt, failure_reason FROM subscription_invoices
            WHERE subscription_id = s.id AND status='FAILED'
            ORDER BY period_start DESC LIMIT 1) i ON true
        WHERE s.status = 'PAST_DUE'
        ORDER BY s.current_period_end`);
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
  private async reconcileRefunds(provider: PaymentProvider, result: BatchResult) {
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

  /** 운영 조회 — 사람이 확인해야 할 수 있는 것: 결과가 확정되지 않은 청구 · 끝나지 않은 환불 · 끝나지 않은 요청. 비어 있어야 정상입니다 */
  async review() {
    const [pendingInvoices, openRefunds, openRequests] = await Promise.all([
      this.db.query(
        `SELECT invoice_id AS "invoiceId", subscription_id AS "subscriptionId", account_id AS "accountId",
                period_start AS "periodStart", amount, attempt, order_id AS "orderId", pg_status AS "pgStatus",
                claimed_at AS "claimedAt", checked_at AS "checkedAt",
                floor(extract(epoch FROM waiting) / 60)::int AS "waitingMinutes"
           FROM v_billing_pending ORDER BY claimed_at LIMIT 200`),
      this.db.query(
        `SELECT refund_id AS "refundId", subscription_id AS "subscriptionId", account_id AS "accountId",
                amount, state, pg_status AS "pgStatus", attempts, requested_at AS "requestedAt",
                checked_at AS "checkedAt", floor(extract(epoch FROM waiting) / 60)::int AS "waitingMinutes"
           FROM v_sub_refund_open ORDER BY requested_at LIMIT 200`),
      this.db.query(
        `SELECT route, state, attempts, account_id AS "accountId", started_at AS "startedAt",
                completed_at AS "completedAt", pay_ref AS "payRef",
                floor(extract(epoch FROM waiting) / 60)::int AS "waitingMinutes"
           FROM v_idempotency_open ORDER BY started_at LIMIT 200`),
    ]);
    return {
      pendingInvoices, openRefunds, openRequests,
      note: '비어 있어야 정상입니다. 청구 · 환불은 배치가 결제사에 조회해 닫습니다 — 하루 넘게 남아 있으면 결제사 관리자 화면과 대조해 주십시오.',
    };
  }
  /* ── 정산 계좌 · 1원 인증 ──────────────────────────────────────── */

  payoutAccounts() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      `SELECT id, bank_name AS "bankName",
              /* ★ 계좌번호는 뒤 4자리만 보여 줍니다 — 화면을 누가 볼지
                 모릅니다. 인증에 쓰는 것은 서버가 알고 있습니다. */
              '************' || coalesce(account_last4,'????') AS "accountNo",
              holder_name AS "holderName", verified, is_default AS "isDefault",
              is_stub AS "isStub", verify_tries AS "verifyTries",
              verified_at AS "verifiedAt"
         FROM payout_accounts WHERE account_id = $1
        ORDER BY is_default DESC, created_at DESC`, [me]);
  }

  /**
   * 정산 계좌 등록 · 1원 보내기.
   *
   * **인증 전에는 기본 계좌가 되지 않습니다**(트리거가 막습니다).
   */
  async addPayoutAccount(d: any) {
    const me = RequestCtx.actorId()!;
    const provider = resolveBankVerifyProvider();
    const sent = await provider.send({
      bankCode: d.bankCode, accountNo: d.accountNo, holderName: d.holderName });
    if (!sent.sent) {
      throw new PolicyViolation('BANK_SEND_FAILED',
        sent.detail ?? '1원을 보내지 못했습니다. 계좌를 다시 확인해 주십시오.');
    }

    /* ★ 평문 계좌번호를 담을 컬럼이 없습니다 — 함수로만 넣습니다.
     *   컬럼을 두면 비워 두어도 **백업에 남습니다**(D-04). */
    const [row] = await this.db.query<any>(
      `SELECT fn_payout_add($1,$2,$3,$4,$5,$6,$7) AS id`,
      [me, d.bankCode, d.bankName, d.accountNo, d.holderName,
       sent.code ?? null, sent.stub]);

    return { id: row.id, bankName: d.bankName, holderName: d.holderName,
      stub: sent.stub,
      note: sent.stub
        ? '연동 전이라 실제로 1원이 보내지지 않았습니다 — 코드는 SGB01 입니다.'
        : '1원을 보냈습니다. 입금자명에 찍힌 코드를 적어 주십시오.' };
  }

  /**
   * 1원 인증 확인.
   *
   * **다섯 번 틀리면 막힙니다** — 남의 계좌를 찍어 보는 것을 막습니다.
   */
  async verifyPayoutAccount(id: string, code: string) {
    const me = RequestCtx.actorId()!;
    const [acc] = await this.db.query<any>(
      `SELECT id, verify_code, verify_tries, verified, is_stub
         FROM payout_accounts WHERE id = $1 AND account_id = $2`, [id, me]);
    if (!acc) throw new StateConflict('NOT_FOUND', '없는 계좌입니다.');
    if (acc.verified) return { verified: true, note: '이미 인증된 계좌입니다.' };
    if (acc.verify_tries >= 5) {
      throw new PolicyViolation('TOO_MANY_TRIES',
        '다섯 번 틀려 막혔습니다 — 고객센터로 연락 주십시오.');
    }

    const provider = resolveBankVerifyProvider();
    /* 어댑터에는 **암호문을 넘기지 않습니다** — 실제 연동 때는
     * fn_payout_reveal 로 꺼내 쓰고, 꺼낸 기록이 남습니다. */
    const res = await provider.confirm({ bankCode: '', accountNo: '', code, expected: acc.verify_code });

    if (!res.verified) {
      const [after] = await this.db.query<any>(
        `UPDATE payout_accounts SET verify_tries = verify_tries + 1
          WHERE id = $1 RETURNING verify_tries AS "tries"`, [id]);
      throw new PolicyViolation('CODE_MISMATCH',
        `${res.detail ?? '코드가 맞지 않습니다.'} (${5 - after.tries}회 남았습니다)`);
    }

    /* 첫 계좌는 기본으로 둡니다 — 하나뿐인데 고르라 하면 번거롭습니다. */
    const [n] = await this.db.query<any>(
      `SELECT count(*)::int AS c FROM payout_accounts
        WHERE account_id = $1 AND verified AND id <> $2`, [me, id]);
    const [row] = await this.db.query<any>(
      `UPDATE payout_accounts
          SET verified = true, verified_at = now(), verify_tries = 0,
              is_default = $2
        WHERE id = $1
        RETURNING bank_name AS "bankName", holder_name AS "holderName",
                  is_default AS "isDefault"`, [id, n.c === 0]);

    return { verified: true, ...row, stub: res.stub,
      note: res.stub
        ? '연동 전이라 실제 예금주는 확인되지 않았습니다.'
        : '인증됐습니다. 이 계좌로 지급됩니다.' };
  }

}
