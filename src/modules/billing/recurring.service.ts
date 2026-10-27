import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolvePaymentProvider } from './payment.provider';
import { RecurringRefundService } from './recurring-refund.service';
import { I18nService } from '../i18n/i18n.service';

/**
 * 정기결제 · 구독 관리.
 *
 * v10.45 (2026-10-16 · 리팩토링) — 구독 환불은 recurring-refund.service.ts, 정산 계좌 · 1원 인증은 payout-account.service.ts 로 나눴습니다.
 * v10.86 (리팩토링) — 정기 청구 배치는 recurring-batch.service.ts, 운영 화면 조회 · 정책은 recurring-admin.service.ts 로 나눴습니다.
 *   이 파일에는 회원 본인의 결제 수단 · 구독 · 청구서만 남습니다.
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
  constructor(private readonly db: DatabaseService, private readonly refunds: RecurringRefundService, private readonly i18n: I18nService) {}
  private readonly log = new Logger(RecurringBillingService.name);
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
    const last = await this.refunds.lastRefund(this.me, row?.id ?? null);
    const refund = last ? this.refunds.refundView(last) : undefined;

    if (!row) return { subscribed: false, ...(refund ? { refund } : {}) };

    const refundOpen = !!last && ['REQUESTED', 'PROCESSING', 'UNKNOWN'].includes(last.state);
    /* G-189 — 예약이 있으면 다음 결제일의 청구는 예약 요금제 값입니다(예약이 무료면 청구 없음 · 무료로 바뀜) */
    const nextPrice = row.nextPlanCode ? Number(row.nextPlanPrice) : Number(row.monthlyPrice);
    const willCharge =
      !row.cancelAt && !refundOpen && Number(row.monthlyPrice) > 0 && nextPrice > 0 &&
      (!row.promoEndsAt || new Date(row.promoEndsAt) <= new Date(row.periodEnd));
    /* 20261007 (v10.20 · G-125) — 안내 글의 날짜는 한국 날짜로. 서버가 UTC(개발 Docker · AWS)면 한국 0 ~ 9시에 끝나는 기간이 하루 전으로 나왔습니다. */
    const until = new Date(row.periodEnd).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

    /* v10.124 — 안내는 코드(noticeCode)와 함께 — 다른 언어 화면이 코드 · 날짜 · 요금제로 글을 만듭니다(한국어 notice 는 전과 같은 글) */
    const noticeCode = refundOpen ? 'REFUND_OPEN'
      : row.chargeInFlight ? 'CHARGE_IN_FLIGHT'
        : row.cancelAt ? (row.status === 'PAST_DUE' ? 'CANCELLED_UNPAID' : 'CANCEL_RESERVED')
          : row.status === 'PAST_DUE' ? 'PAST_DUE'
            : willCharge && !row.hasBillingKey ? 'NO_METHOD'
              : row.nextPlanCode ? 'PLAN_CHANGE' : null;
    const NOTICE: Record<string, string> = {
      REFUND_OPEN: '환불 결과를 확인하는 중입니다. 결과가 나올 때까지 이 구독의 이용 · 갱신이 멈춥니다.',
      CHARGE_IN_FLIGHT: '정기결제 결과를 결제사에서 확인하는 중입니다. 확인되는 대로 반영됩니다 — 다시 결제하지 마십시오.',
      CANCELLED_UNPAID: '해지되었습니다. 더 청구하지 않습니다. 결제가 완료되지 않은 기간이라 지금은 유료 기능을 쓸 수 없습니다.',
      CANCEL_RESERVED: `해지 예약되었습니다. ${until}까지 이용할 수 있고 이후 청구되지 않습니다.`,
      PAST_DUE: '정기결제가 실패했습니다. 결제 수단을 확인해 주십시오 — 유예 기간 안에 결제되지 않으면 구독이 만료됩니다.',
      NO_METHOD: '자동 갱신 예정이지만 결제 수단이 없습니다. 등록하지 않으면 갱신에 실패합니다.',
      PLAN_CHANGE: `${until} 다음 결제일부터 ${row.nextPlanName}(월 ${nextPrice.toLocaleString('ko-KR')}원)으로 바뀝니다 — 예약을 거두면 지금 요금제로 이어집니다.`,
    };
    const notice = noticeCode ? NOTICE[noticeCode] : null;
    /* 요금제 이름 번역(PLAN · D126) — 한국어 안내 글을 만든 뒤에 얹습니다 */
    await this.i18n.overlay([row], 'PLAN', (r: any) => r.planCode, { planName: 'name' });
    if (row.nextPlanCode) await this.i18n.overlay([row], 'PLAN', (r: any) => r.nextPlanCode, { nextPlanName: 'name' });

    return {
      subscribed: true, ...row,
      autoRenew: !row.cancelAt,
      nextChargeAt: willCharge ? row.periodEnd : null,
      nextChargeAmount: willCharge ? nextPrice : null,
      ...(refund ? { refund } : {}),
      notice, noticeCode,
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
}
