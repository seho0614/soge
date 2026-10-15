import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolvePaymentProvider } from './payment.provider';
import { confirmOrRecover } from './payment-recover';

/**
 * 구독 · 소개코드 · 원장 (T7).
 *
 * 여기 흐르는 돈은 **구독료와 초과 코드 요금뿐**입니다.
 * 소개비는 이 원장에 들어오지 않습니다 — entry_type 에 REFERRAL_FEE 가 없고,
 * 그것이 INV-9·11 을 구조로 지키는 방식입니다.
 */
/** 지금 유효한 구독 + 요금제 */
interface ActiveSub {
  id: string | null; plan_code: string; plan_name: string; monthly_price: number;
  included_codes: number; extra_code_price: number; current_period_end: Date | null;
}

/** 무료 요금제 추가 소개코드 결제 (토스 결제창이 돌려준 값 · 시험 결제는 stub_…) */
export interface ExtraPayment { paymentKey?: string; orderId?: string; amount?: number }

@Injectable()
export class BillingService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  plans() {
    return this.db.query(
      `SELECT code, name, monthly_price AS "monthlyPrice",
              included_codes AS "includedCodes",
              request_views_per_month AS "requestViewsPerMonth",
              listing_slots AS "listingSlots",
              priority_slot_count AS "prioritySlotCount",
              extra_code_price AS "extraCodePrice",
              /* v10.31 — 시안 요금제 카드의 혜택 줄 · 소개 제안 월 한도(NULL = 무제한) */
              features, proposal_limit AS "proposalLimit"
         FROM subscription_plans WHERE is_active ORDER BY monthly_price`);
  }

  /**
   * 구독 시작·변경.
   *
   * 계정당 활성 구독은 1건입니다(부분 유니크 인덱스). 기존 구독이 있으면
   * 플랜만 바꿉니다 — 해지 후 재가입으로 처리하면 미성사 코드가 실효됩니다.
   */
  async subscribe(planCode: string, paymentKey?: string, orderId?: string) {
    return this.db.transaction(async () => {
      const [plan] = await this.db.query<{ monthly_price: number; name: string }>(
        `SELECT monthly_price, name FROM subscription_plans
          WHERE code = $1 AND is_active`, [planCode]);
      if (!plan) throw new StateConflict('NO_SUCH_PLAN', '없는 요금제입니다.');

      /* ★ v10.27 (G-189 · 10/8 답 ③) — 유료 구독 중에 다른 요금제를 고르면 **예약**입니다.
       *   올리기 · 내리기 모두 지금은 결제하지 않고, 다음 결제일에 새 요금제로 청구 · 적용합니다(지금 기간은 그대로).
       *   전에는 바꾸는 즉시 새 30일이 시작되고 새 요금을 받았습니다 — 남은 기간을 잃고 같은 달에 두 번 냈습니다.
       *   예약이 아닌 경우(아래로 내려감): 구독 없음 · 무료 · 프로모션 · 연체(PAST_DUE) · 같은 요금제 다시 결제(해지 예약 거두기 · D022). */
      const reserve = await this.reservePlan(planCode, plan);
      if (reserve) return reserve;

      // 유료 전환은 결제 승인이 먼저입니다. 결제 없이 권한만 올리지 않습니다
      if (plan.monthly_price > 0 && !paymentKey) {
        throw new PolicyViolation(
          'PAYMENT_REQUIRED',
          '유료 요금제는 결제 후 적용됩니다.');
      }

      /* 결제를 실제로 확인합니다.
       *
       * 이전에는 paymentKey 가 있기만 하면 통과시키고 그 값을 원장에 적었습니다.
       * 클라이언트가 아무 문자열이나 보내도 유료 구독이 열렸습니다.
       * 구독료가 유일한 매출원이므로 이 구멍은 곧 매출 구멍입니다.
       *
       * 금액 검증은 어댑터가 합니다 — 토스가 확인해 준 금액과
       * 우리가 청구하려던 금액이 다르면 승인하지 않습니다. */
      let paidByStub = false;      // 열쇠 없는 방식(스텁)의 승인인가 — 청구서에 표시해 둡니다(스텁 방식의 서버는 그 표시가 있는 것만 환불 · 대조)
      if (plan.monthly_price > 0) {
        /* ★ D022 (v10.18) — 결제를 받기 **전에** 막을 것을 먼저 봅니다. 결제 뒤에 막히면 돈만 나갑니다.
         *   ① 이미 쓴 결제 — 「이미 승인된 결제면 조회로 인정」(아래)을 결제 1건으로 두 번 여는 데 쓰지 못하게.
         *   ② 환불 처리 중인 구독 — DB 가 요금제 · 기간 변경을 막습니다(trg_refund_guard). */
        const [used] = await this.db.query(
          `SELECT 1 FROM subscription_invoices WHERE payment_key = $1
           UNION ALL SELECT 1 FROM referral_code_payments WHERE payment_key = $1 LIMIT 1`, [paymentKey]);
        if (used) {
          throw new StateConflict('PAYMENT_KEY_USED', '이미 사용한 결제입니다. 같은 결제로 다시 구독할 수 없습니다.');
        }
        const [refunding] = await this.db.query(
          `SELECT 1 FROM subscription_refunds r JOIN subscriptions s ON s.id = r.subscription_id
            WHERE s.account_id = $1 AND r.state IN ('REQUESTED','PROCESSING','UNKNOWN') LIMIT 1`, [this.me]);
        if (refunding) {
          throw new StateConflict('REFUND_IN_PROGRESS', '환불을 처리하고 있습니다. 환불 결과가 나온 뒤에 다시 결제해 주십시오.');
        }

        /*   ③ 정기결제 결과를 확인하는 중(PENDING) — 그 청구가 승인된 것으로 확인되면 이번 결제와 겹쳐 두 번 내게 됩니다. */
        const [inflight] = await this.db.query(
          `SELECT 1 FROM subscription_invoices i JOIN subscriptions s ON s.id = i.subscription_id
            WHERE s.account_id = $1 AND s.status IN ('ACTIVE','PAST_DUE') AND i.status = 'PENDING' LIMIT 1`, [this.me]);
        if (inflight) {
          throw new StateConflict('CHARGE_IN_PROGRESS',
            '정기결제 결과를 결제사에서 확인하는 중입니다. 확인이 끝난 뒤에 다시 결제해 주십시오 — 지금 결제하면 두 번 청구될 수 있습니다.');
        }

        /* 이미 승인된 결제(응답 유실 · 승인 뒤 저장 실패 뒤의 재시도)는 다시 받지 않고 결제사에 물어 확인합니다 */
        const pay = await confirmOrRecover(resolvePaymentProvider(), {
          paymentKey: paymentKey!,
          orderId: orderId ?? `sub_${this.me}_${Date.now()}`,
          amount: plan.monthly_price,
          orderName: `${plan.name} 구독료`,   // 소개비 문구가 들어오면 어댑터가 막습니다
        });
        if (!pay.approved) {
          if (pay.uncertain) {
            throw new PolicyViolation('PAYMENT_UNCERTAIN',
              '결제 결과를 확인하지 못했습니다. 잠시 뒤 같은 요청으로 다시 시도해 주십시오 — 이미 승인된 결제는 다시 청구되지 않습니다.');
          }
          throw new PolicyViolation('PAYMENT_FAILED', pay.detail ?? '결제 승인에 실패했습니다.');
        }
        if (pay.stub) {
          // 계약 전이라 실제 승인이 아닙니다. 로그로 남겨 시연과 실동작을 구분합니다.
          console.warn(`[billing] 결제 스텁 동작 — 실제 승인 아님 (plan=${planCode})`);
        }
        paidByStub = !!pay.stub;
      }

      const [existing] = await this.db.query<{ id: string }>(
        `SELECT id FROM subscriptions
          WHERE account_id = $1 AND status IN ('ACTIVE','PAST_DUE')`, [this.me]);

      const [sub] = existing
        ? await this.db.query(
            /* ★ D022 — 유료 결제로 다시 여는 것은 자동 갱신으로 돌아오는 것입니다(cancel_at 을 지움).
             *   전에는 해지 예약한 회원이 다시 결제하면 **결제는 승인됐는데** 청구서 저장이 「해지 예약된 구독」 규칙에 막혀
             *   전체가 되돌아갔습니다(실측 422 BILLING_RULE — 돈만 나감). */
            `UPDATE subscriptions
                SET plan_code = $2, status='ACTIVE',
                    current_period_start = now(),
                    current_period_end = now() + interval '30 days',
                    next_plan_code = NULL, next_plan_at = NULL,
                    cancel_at = CASE WHEN $3::boolean THEN NULL ELSE cancel_at END
              WHERE id = $1
            RETURNING id, plan_code AS "planCode", status,
                      current_period_start AS "currentPeriodStart",
                      current_period_end AS "currentPeriodEnd", is_promo AS "isPromo"`,
            [existing.id, planCode, plan.monthly_price > 0])
        : await this.db.query(
            `INSERT INTO subscriptions
               (account_id, plan_code, status, current_period_start, current_period_end)
             VALUES ($1,$2,'ACTIVE', now(), now() + interval '30 days')
             RETURNING id, plan_code AS "planCode", status,
                       current_period_start AS "currentPeriodStart",
                       current_period_end AS "currentPeriodEnd", is_promo AS "isPromo"`,
            [this.me, planCode]);

      /* ★ 20260930 — 결제 기록은 청구서(subscription_invoices)에 남깁니다.
       *   전에는 없는 표 ledger_entries 에 쓰다가 실패해 **결제는 승인됐는데
       *   구독이 롤백**되었습니다(실측 500). 정기결제(recurring)와 같은 표를
       *   써야 매출 집계(v_daily · 경영 지표)에 함께 잡힙니다. */
      if (plan.monthly_price > 0) {
        /* ★ D022 — 기간은 **구독 줄의 값 그대로** 넣습니다(SQL 안에서). 전에는 Node 를 한 번 거쳐 밀리초로 잘렸고,
         *   청구서의 기간 시작이 구독의 기간 시작과 달라 「이번 기간의 청구서」를 찾지 못했습니다(환불 · 중복 청구 방지).
         *   주문번호(order_id)도 남깁니다 — 결제 키와 따로. */
        await this.db.query(
          `INSERT INTO subscription_invoices
             (subscription_id, period_start, period_end, amount, status, payment_key, order_id, paid_at, is_stub, plan_code)
           SELECT s.id, s.current_period_start, s.current_period_end, $2, 'PAID', $3, $4, now(), $5, s.plan_code
             FROM subscriptions s WHERE s.id = $1
           ON CONFLICT (subscription_id, period_start) DO NOTHING`,
          [sub.id, plan.monthly_price, paymentKey, orderId ?? null, paidByStub]);
      }
      return { subscriptionId: sub.id, ...sub };
    });
  }

  /**
   * 요금제 예약(G-189 ③). 예약 대상이 아니면 null — 호출한 쪽이 지금 결제로 진행합니다.
   *
   *   대상: ACTIVE · 프로모션 아님 · 지금 요금제가 유료 · 기간이 남음 · 다른 요금제를 고름.
   *   올리기(새 요금제가 유료)는 다음 결제일에 카드로 청구하므로 **등록된 카드가 있어야** 합니다(10/8 확인 ①).
   *   내리기(무료 BASIC)는 카드가 없어도 됩니다 — 기간 끝에 무료로 바뀝니다.
   *   해지 예약 중이면 먼저 해지를 거두라고 답합니다(해지와 요금제 예약이 겹치면 다음 결제일에 무엇을 할지 모호).
   *   같은 요금제를 다시 예약하면 그대로(멱등) · 지금 요금제를 고르면 아래(지금 결제 — 해지 예약 거두기 D022)로 내려갑니다.
   */
  private async reservePlan(planCode: string, plan: { monthly_price: number; name: string }) {
    const [cur] = await this.db.query<{
      id: string; plan_code: string; price: number; status: string; is_promo: boolean;
      cancel_at: string | null; current_period_end: string; next_plan_code: string | null; live: boolean;
    }>(
      `SELECT s.id, s.plan_code, p.monthly_price AS price, s.status, s.is_promo, s.cancel_at,
              s.current_period_end, s.next_plan_code, (s.current_period_end > now()) AS live
         FROM subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
        WHERE s.account_id = $1 AND s.status IN ('ACTIVE','PAST_DUE') FOR UPDATE OF s`, [this.me]);
    if (!cur || cur.status !== 'ACTIVE' || cur.is_promo || Number(cur.price) <= 0 || !cur.live) return null;
    if (cur.plan_code === planCode) return null;
    if (cur.cancel_at) {
      throw new StateConflict('CANCEL_SCHEDULED',
        '해지를 예약해 두셨습니다. 요금제를 바꾸시려면 먼저 해지 예약을 거두어 주십시오.');
    }
    if (Number(plan.monthly_price) > 0) {
      const [key] = await this.db.query(
        `SELECT 1 FROM billing_keys WHERE account_id = $1 AND status = 'ACTIVE' LIMIT 1`, [this.me]);
      if (!key) {
        throw new PolicyViolation('BILLING_KEY_REQUIRED',
          '다음 결제일에 새 요금제로 결제할 카드가 필요합니다. 결제 수단을 먼저 등록해 주십시오.');
      }
    }
    const [r] = await this.db.query<any>(
      `UPDATE subscriptions
          SET next_plan_code = $2,
              next_plan_at = CASE WHEN next_plan_code = $2 THEN next_plan_at ELSE now() END
        WHERE id = $1
      RETURNING id, plan_code AS "planCode", status, next_plan_code AS "nextPlanCode",
                next_plan_at AS "nextPlanAt", current_period_start AS "currentPeriodStart",
                current_period_end AS "currentPeriodEnd", is_promo AS "isPromo"`, [cur.id, planCode]);
    const up = Number(plan.monthly_price) > Number(cur.price);
    return {
      subscriptionId: r.id, ...r, reserved: true, charged: 0,
      effectiveAt: r.currentPeriodEnd, nextPlanName: plan.name, nextPrice: Number(plan.monthly_price),
      note: `${up ? '올리기' : '내리기'}를 예약했습니다 — 지금은 결제하지 않습니다. ` +
            `다음 결제일부터 ${plan.name}(월 ${Number(plan.monthly_price).toLocaleString('ko-KR')}원)이 적용됩니다. 그때까지는 지금 요금제 그대로입니다.`,
    };
  }

  /** 요금제 예약 거두기(G-189). 예약이 없으면 그대로 ok. */
  async cancelReservation() {
    const [r] = await this.db.query<any>(
      `UPDATE subscriptions SET next_plan_code = NULL, next_plan_at = NULL
        WHERE account_id = $1 AND status IN ('ACTIVE','PAST_DUE')
      RETURNING id, plan_code AS "planCode", current_period_end AS "currentPeriodEnd"`, [this.me]);
    if (!r) throw new NotFound('구독이 없습니다.');
    return { ok: true, subscriptionId: r.id, planCode: r.planCode, note: '요금제 예약을 거두었습니다. 다음 결제일에도 지금 요금제로 이어집니다.' };
  }

  /* recordLedger 제거 (20260930) — 대상 표 ledger_entries 가 기준선에서 빠졌습니다.
   * 구독료는 subscription_invoices, 초과 코드는 referral_codes.is_extra 에 남깁니다. */


  /** ★ 20260930 — ledger_entries 는 없어졌습니다. 구독료 청구서 + 초과 코드로 같은 모양을 만듭니다. */
  ledger(limit = 50) {
    return this.db.query(
      `SELECT * FROM (
         SELECT i.id::text AS id, 'SUBSCRIPTION' AS "entryType", 'DEBIT' AS direction, i.amount,
                NULL::numeric AS "balanceAfter", p.name || ' 구독료 (' || i.status || ')' AS memo,
                coalesce(i.paid_at, i.issued_at) AS "createdAt"
           FROM subscription_invoices i
           JOIN subscriptions s ON s.id = i.subscription_id
           JOIN subscription_plans p ON p.code = s.plan_code
          WHERE s.account_id = $1
         UNION ALL
         SELECT rc.id::text, 'EXTRA_CODE', 'DEBIT', coalesce(rc.extra_amount, p.extra_code_price),
                NULL::numeric,
                /* D010 — 결제로 받은 추가 코드와 결제 없이 표시만 된 초과(유료 요금제, 청구처 미정)를 구분합니다 */
                CASE WHEN rc.extra_payment_key IS NOT NULL THEN '추가 소개코드 ' || rc.code || ' (결제)'
                     ELSE '초과 소개코드 ' || rc.code || ' (청구 전)' END,
                rc.issued_at
           FROM referral_codes rc
           JOIN subscriptions s ON s.id = rc.subscription_id
           JOIN subscription_plans p ON p.code = s.plan_code
          WHERE rc.owner_account_id = $1 AND rc.is_extra
       ) x ORDER BY "createdAt" DESC LIMIT $2`, [this.me, limit]);
  }

  /** 이번 달(한국 시각 1일 0시) 시작 — 포함 건수는 월 단위입니다(매월 1일 지급 · 이월 없음) */
  private static readonly MONTH =
    `date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`;

  /** 지금 유효한 구독 1건 (계정당 1건 — uq_subscription_active) */
  private async activeSub(): Promise<ActiveSub | null> {
    const [sub] = await this.db.query<ActiveSub>(
      `SELECT s.id, s.plan_code, p.name AS plan_name, p.monthly_price, p.included_codes,
              p.extra_code_price, s.current_period_end
         FROM subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
        WHERE s.account_id = $1 AND s.status IN ('ACTIVE','PAST_DUE')`, [this.me]);
    return sub ?? null;
  }

  /**
   * 이번 달 무료분을 얼마나 썼는가.
   *
   * ★ 20261001 — 포함 건수는 **월** 단위입니다(매월 1일 지급 · 이월 없음).
   *   초과 코드는 포함 건수를 쓰지 않으므로 무료분(NOT is_extra)만 셉니다.
   *
   * 무료(BASIC) 요금제는 **본인인증 1명당** 월 포함 건수입니다 — 같은 사람이 계정을 여럿 만들어도
   * 무료분은 한 번입니다. 같은 CI 를 가진 계정의 이번 달 무료분을 모두 셉니다.
   *   · 본인인증 전(계정 인증 표시 없음 또는 PASS 성공 기록 없음) → 무료분 0 (scope NONE)
   *   · PASS 연동 전 스텁 CI('stub-ci')는 모두 같아 계정끼리 묶이면 안 되므로 계정 단위 (scope ACCOUNT)
   *   · 실제 CI → 그 CI 의 모든 계정 합산 (scope CI)
   * 유료 요금제는 구독 단위입니다 (scope SUBSCRIPTION).
   *
   * lock=true 면 같은 계정 · 같은 CI 의 동시 발급을 줄 세웁니다(두 번 눌러 무료분이 두 번 나가지 않게).
   */
  private async freeUsage(sub: { id: string | null; monthly_price: number; included_codes: number }, lock = false):
    Promise<{ used: number; scope: 'CI' | 'ACCOUNT' | 'NONE' | 'SUBSCRIPTION'; identityVerified: boolean }> {
    const MONTH = BillingService.MONTH;
    if (Number(sub.monthly_price) > 0) {
      const [c] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM referral_codes
          WHERE subscription_id = $1 AND NOT is_extra AND revoked_at IS NULL
            AND issued_at >= ${MONTH}`, [sub.id]);
      return { used: c.n, scope: 'SUBSCRIPTION', identityVerified: true };
    }

    const [ci] = await this.db.query<{ ci_hash: string | null; verified: boolean }>(
      `SELECT (SELECT iv.ci_hash FROM identity_verifications iv
                WHERE iv.account_id = a.id AND iv.provider = 'PASS' AND iv.result = 'SUCCESS'
                  AND iv.ci_hash IS NOT NULL
                ORDER BY iv.completed_at DESC NULLS LAST LIMIT 1) AS ci_hash,
              (a.identity_verified_at IS NOT NULL) AS verified
         FROM accounts a WHERE a.id = $1`, [this.me]);
    if (!ci?.verified || !ci.ci_hash) {
      /* 본인인증 전에는 무료분을 주지 않습니다(결제한 추가분만). */
      return { used: sub.included_codes, scope: 'NONE', identityVerified: false };
    }
    if (ci.ci_hash === 'stub-ci') {
      const [c] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM referral_codes
          WHERE owner_account_id = $1 AND NOT is_extra AND revoked_at IS NULL
            AND issued_at >= ${MONTH}`, [this.me]);
      return { used: c.n, scope: 'ACCOUNT', identityVerified: true };
    }
    if (lock) {
      await this.db.query(`SELECT pg_advisory_xact_lock(hashtextextended('refcode-ci:' || $1, 0))`, [ci.ci_hash]);
    }
    const [c] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM referral_codes rc
        WHERE NOT rc.is_extra AND rc.revoked_at IS NULL AND rc.issued_at >= ${MONTH}
          AND rc.owner_account_id IN (
            SELECT iv.account_id FROM identity_verifications iv
             WHERE iv.provider = 'PASS' AND iv.result = 'SUCCESS' AND iv.ci_hash = $1)`,
      [ci.ci_hash]);
    return { used: c.n, scope: 'CI', identityVerified: true };
  }

  /** 소개코드 범위 — 운영 설정 refcode.scope (D012). listing = 매물마다 코드가 따로(기본) · all = 매물에 묶지 않음 */
  private async refScope(): Promise<'listing' | 'all'> {
    const [r] = await this.db.query<{ value: string | null }>(
      `SELECT value FROM site_settings WHERE key = 'refcode.scope'`);
    return r?.value === 'all' ? 'all' : 'listing';
  }

  /** 코드를 받을 매물 — 발급 가능 여부 판단에 필요한 것만 */
  private async listingForCode(listingId: string) {
    const [l] = await this.db.query<{
      id: string; title: string; status: string; gwan_code: string; owner: string; no_intro: boolean;
    }>(
      `SELECT l.id, l.title, l.status, l.gwan_code, l.owner_account_id AS owner,
              coalesce(fn_category_no_intro(l.category_id), false) AS no_intro
         FROM listings l WHERE l.id = $1`, [listingId]);
    return l ?? null;
  }

  /** 그 매물에 왜 코드를 받을 수 없는가 (없으면 null). DB 트리거 trg_refcode_listing_guard 가 같은 규칙으로 최종 방어합니다 */
  private listingBlock(l: { status: string; owner: string; no_intro: boolean }):
    'OWN_LISTING' | 'LISTING_NOT_PUBLISHED' | 'NO_INTRO_CATEGORY' | null {
    if (l.status !== 'PUBLISHED') return 'LISTING_NOT_PUBLISHED';
    if (l.owner === this.me) return 'OWN_LISTING';
    if (l.no_intro) return 'NO_INTRO_CATEGORY';
    return null;
  }

  /** 그 매물의 살아 있는 내 코드 (폐기 · 만료 아님). 달과 무관합니다 */
  private async liveCodeFor(listingId: string) {
    const [row] = await this.db.query(
      `SELECT code, listing_id AS "listingId", is_extra AS "isExtra", issued_at AS "issuedAt",
              extra_amount AS "extraAmount", (extra_payment_key IS NOT NULL) AS paid
         FROM referral_codes
        WHERE owner_account_id = $1 AND listing_id = $2 AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY issued_at DESC LIMIT 1`, [this.me, listingId]);
    return row ?? null;
  }

  /**
   * 이번 달 소개코드 현황 (D010 · SB-MAL-GIV-010 · SB-MAL-DTL-010 「소개코드 공유」).
   *
   * 화면은 이것을 먼저 보고 ① 이미 받은 코드(current)가 있으면 **그 코드를 다시 보여 주고**
   * (누를 때마다 새로 발급해 무료분을 날리지 않게) ② 무료분이 남았으면 발급하고
   * ③ 포함분을 다 썼으면(모든 요금제 — D011) 추가 결제를 안내합니다.
   * 구독이 없으면 발급할 때 열릴 무료 BASIC 기준으로 보여 줍니다(subscribed:false).
   *
   * ★ D012 — refcode.scope=listing(기본)이면 코드는 매물마다 따로입니다.
   *   · listingId 를 주면 current 는 **그 매물의 내 코드**(달과 무관하게 살아 있는 것)이고,
   *     그 매물에 코드를 받을 수 없으면 blocked 에 까닭이 옵니다.
   *   · listingId 없이 부르면 current 는 null 이고 남은 무료분만 봅니다.
   *   scope=all 이면 전처럼 current 는 이번 달 받은 코드 중 가장 최근입니다(listingId 는 무시).
   */
  async quota(listingId?: string) {
    const scope = await this.refScope();
    let sub: ActiveSub | null = await this.activeSub();
    const subscribed = !!sub;
    if (!sub) {
      const [b] = await this.db.query<ActiveSub>(
        `SELECT NULL::uuid AS id, code AS plan_code, name AS plan_name, monthly_price, included_codes,
                extra_code_price, NULL::timestamptz AS current_period_end
           FROM subscription_plans WHERE code = 'BASIC' AND is_active`);
      if (!b) throw new StateConflict('NO_SUCH_PLAN', '무료 요금제가 없습니다.');
      sub = b;
    }
    const u = await this.freeUsage(sub);
    const free = Number(sub.monthly_price) === 0;
    const freeRemaining = Math.max(0, sub.included_codes - u.used);

    let current: unknown = null;
    let listing: { id: string; title: string; gwanCode: string } | null = null;
    let blocked: string | null = null;
    if (scope === 'listing') {
      if (listingId) {
        const l = await this.listingForCode(listingId);
        if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
        blocked = this.listingBlock(l);
        // 게시 중이 아닌 매물(남의 임시 저장 등)의 제목은 내보내지 않습니다
        if (l.status === 'PUBLISHED') listing = { id: l.id, title: l.title, gwanCode: l.gwan_code };
        const live = await this.liveCodeFor(listingId);
        current = live ? { code: live.code, isExtra: live.isExtra, issuedAt: live.issuedAt, listingId } : null;
      }
    } else {
      const [c] = await this.db.query(
        `SELECT code, is_extra AS "isExtra", issued_at AS "issuedAt", listing_id AS "listingId"
           FROM referral_codes
          WHERE owner_account_id = $1 AND revoked_at IS NULL AND listing_id IS NULL
            AND (expires_at IS NULL OR expires_at > now())
            AND issued_at >= ${BillingService.MONTH}
          ORDER BY issued_at DESC LIMIT 1`, [this.me]);
      current = c ?? null;
    }
    return {
      scope,
      subscribed,
      planCode: sub.plan_code,
      planName: sub.plan_name,
      freePlan: free,
      includedCodes: sub.included_codes,
      usedThisMonth: u.scope === 'NONE' ? 0 : u.used,
      freeRemaining,
      extraCodePrice: Number(sub.extra_code_price),
      identityVerified: u.identityVerified,
      countScope: u.scope,
      current,
      listing,
      blocked,
      /* D011 — 모든 요금제: 포함 건수를 다 쓰면 추가는 결제가 필요합니다 */
      paymentRequired: freeRemaining === 0 && Number(sub.extra_code_price) > 0,
      paymentStub: !process.env.TOSS_SECRET_KEY,
    };
  }

  /**
   * 소개코드 발급. 구독 없이는 DB 가 막습니다 (INV-8).
   *
   * ★ D010 (10/2 「소개코드는 시안대로」)
   *   · 일반 회원(MEMBER)도 받습니다. 유효 구독이 없으면 **무료 BASIC 구독을 열고** 발급합니다
   *     (subscribe('BASIC') 그대로 — 월 0원, 결제 없음).
   *   · 무료 요금제는 무료분(본인인증 1명당 월 포함 건수)을 넘는 수만큼 **결제 후에만** 발급합니다.
   *     결제 정보가 없으면 422 EXTRA_PAYMENT_REQUIRED(details 에 건수 · 단가 · 금액).
   *     결제는 subscribe() 와 같은 어댑터(resolvePaymentProvider().confirm — 키 없으면 스텁)로 승인받고,
   *     결제키는 referral_code_payments 에 1번만 쓰입니다(재사용 409 PAYMENT_KEY_USED).
   *     DB 트리거 trg_refcode_extra_paid 가 「결제 없는 무료 요금제 초과 코드」를 막습니다.
   *   · D011 — 유료 요금제(STANDARD · PRO)도 포함 건수를 넘으면 결제 후에만 발급합니다.
   *
   * ★ D012 (10/2 「소개코드는 매물별로」 · 운영 설정 refcode.scope)
   *   scope=listing(기본)
   *     · listingId 필수(없으면 422 LISTING_REQUIRED) · 한 번에 1건(422 ONE_CODE_PER_LISTING).
   *     · 게시 중인 매물만(없는 매물 404 · 게시 중 아님 409 LISTING_NOT_PUBLISHED) · 본인 매물 422 OWN_LISTING ·
   *       소개 금지 업종(보험 · 의료) 422 NO_INTRO_CATEGORY. DB 트리거 trg_refcode_listing_guard 가 같은 규칙으로 막습니다.
   *     · 같은 회원 · 같은 매물의 살아 있는 코드는 1개입니다. 이미 있으면 **새로 만들지 않고 그 코드를** 돌려줍니다
   *       (reused:true — 무료분 · 결제를 쓰지 않습니다). 부분 유일 인덱스 uq_refcode_owner_listing_live 가 최종 보장합니다.
   *     · 월 무료분은 「이번 달 새로 받은 매물 코드」 수로 셉니다(계산은 그대로).
   *   scope=all — 전처럼 코드가 매물에 묶이지 않습니다(listingId 는 받기만 하고 저장하지 않음).
   */
  async issueCodes(listingId?: string, count = 1, pay?: ExtraPayment) {
    const provider = resolvePaymentProvider();
    let approvedKey: string | null = null;
    const scope = await this.refScope();
    if (scope === 'listing') {
      if (!listingId) {
        throw new PolicyViolation('LISTING_REQUIRED',
          '소개코드는 매물마다 따로 받습니다. 소개할 매물 상세에서 「소개코드 공유」를 눌러 주십시오.');
      }
      if (count !== 1) {
        throw new PolicyViolation('ONE_CODE_PER_LISTING', '소개코드는 매물마다 1건입니다. 한 번에 1건만 받을 수 있습니다.');
      }
    }
    try {
      return await this.db.transaction(async () => {
        // 같은 계정의 동시 발급을 줄 세웁니다 — 두 번 눌러도 무료분은 한 번 · 같은 매물 코드는 1개입니다
        await this.db.query(`SELECT pg_advisory_xact_lock(hashtextextended('refcode-acct:' || $1, 0))`, [this.me]);

        /* ── D012 매물별 ── 매물 확인 → 이미 받은 코드가 있으면 그대로 돌려줌(무료분 · 결제 소모 없음) */
        let boundListing: string | null = null;
        if (scope === 'listing') {
          const l = await this.listingForCode(listingId!);
          if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
          const live = await this.liveCodeFor(l.id);
          if (live) return [{ ...live, reused: true }];
          const block = this.listingBlock(l);
          if (block === 'LISTING_NOT_PUBLISHED') {
            throw new StateConflict('LISTING_NOT_PUBLISHED', '게시 중인 매물에만 소개코드를 받을 수 있습니다.');
          }
          if (block === 'OWN_LISTING') {
            throw new PolicyViolation('OWN_LISTING', '본인 매물에는 소개코드를 받을 수 없습니다.');
          }
          if (block === 'NO_INTRO_CATEGORY') {
            throw new PolicyViolation('NO_INTRO_CATEGORY',
              '보험·의료 매물에는 소개자를 둘 수 없어 소개코드를 받을 수 없습니다 (의료법 27조 · 보험업법).');
          }
          /* 만료됐는데 폐기 표시가 없는 옛 코드가 유일 인덱스를 잡고 있으면 새 코드를 넣을 수 없습니다 — 폐기 표시를 남깁니다 */
          await this.db.query(
            `UPDATE referral_codes SET revoked_at = now()
              WHERE owner_account_id = $1 AND listing_id = $2 AND revoked_at IS NULL AND expires_at <= now()`,
            [this.me, l.id]);
          boundListing = l.id;
        }

        let sub = await this.activeSub();
        if (!sub) {
          await this.subscribe('BASIC');            // 무료 BASIC — 월 0원, 결제 없음
          sub = await this.activeSub();
        }
        if (!sub) {
          throw new PolicyViolation('SUBSCRIPTION_REQUIRED', '유효한 구독이 필요합니다.');
        }
        const freePlan = Number(sub.monthly_price) === 0;
        const price = Number(sub.extra_code_price);

        /* 무료 BASIC 은 정기결제가 없어 기간이 밀리지 않습니다(v_billing_due 는 유료만).
         * 기간이 지나면 INV-8 트리거가 발급을 막으므로(500), 무료 요금제만 여기서 기간을 새로 엽니다. */
        if (freePlan && new Date(sub.current_period_end!).getTime() <= Date.now()) {
          await this.db.query(
            `UPDATE subscriptions SET current_period_start = now(), current_period_end = now() + interval '30 days'
              WHERE id = $1`, [sub.id]);
        }

        /* 유료 요금제의 기간이 지났으면(정기결제 실패 · 유예 등) 전처럼 구독이 필요하다고 알립니다.
         * 전에는 ACTIVE_SUBSCRIPTION 게이트가 403 으로 막았고, 이제 여기서 422 로 막습니다(INV-8 트리거가 최종 방어). */
        if (!freePlan && new Date(sub.current_period_end!).getTime() <= Date.now()) {
          throw new PolicyViolation('SUBSCRIPTION_REQUIRED', '구독 기간이 지났습니다. 결제 후 소개코드를 받을 수 있습니다.');
        }

        const u = await this.freeUsage(sub, true);
        const freeLeft = Math.max(0, sub.included_codes - u.used);
        // scope=all 이면 코드는 매물에 묶이지 않습니다(boundListing = null) — listingId 는 받기만 합니다

        /* ── 초과분은 결제 후에만 (D011 — 10/2 결정 「유료 요금제 추가 코드도 적용」) ──
         *   전에는 무료 요금제만 결제를 받고, STANDARD · PRO 의 초과분은 청구처 없이 is_extra 로 기록만 했습니다.
         *   이제 모든 요금제가 같습니다. 단가가 0원인 요금제는 초과 개념이 없습니다. */
        const freeN = price > 0 ? Math.min(count, freeLeft) : count;
        const extraN = count - freeN;
        let paymentKey: string | null = null;
        let stub = false;
        if (extraN > 0) {
          const amount = extraN * price;
          if (!pay?.paymentKey) {
            throw new PolicyViolation(
              'EXTRA_PAYMENT_REQUIRED',
              !freePlan
                ? `이번 달 요금제에 포함된 소개코드(${sub.included_codes}건)를 모두 받았습니다. 추가 ${extraN}건은 ${amount.toLocaleString('ko-KR')}원 결제 후 발급됩니다.`
                /* v10.31 (합침 · w3 D060) — 무료 요금제 포함 0건(시안): 「0건을 모두 받았습니다」가 아니라 건당 결제 안내 */
                : Number(sub.included_codes) <= 0
                ? `무료 요금제에는 무료 소개코드가 없습니다. 소개코드 ${extraN}건은 ${amount.toLocaleString('ko-KR')}원 결제 후 발급됩니다.`
                : u.identityVerified
                ? `이번 달 무료 소개코드(${sub.included_codes}건)를 모두 받았습니다. 추가 ${extraN}건은 ${amount.toLocaleString('ko-KR')}원 결제 후 발급됩니다.`
                : `본인인증 전에는 무료 소개코드가 없습니다. 본인인증을 하시거나 ${extraN}건 ${amount.toLocaleString('ko-KR')}원을 결제해 주십시오.`,
              { extraCount: extraN, unitPrice: price, amount, freeRemaining: freeLeft,
                includedCodes: sub.included_codes, identityVerified: u.identityVerified });
          }
          if (pay.amount != null && Number(pay.amount) !== amount) {
            throw new PolicyViolation('AMOUNT_MISMATCH',
              `결제 금액이 맞지 않습니다 — 추가 ${extraN}건은 ${amount.toLocaleString('ko-KR')}원입니다.`,
              { extraCount: extraN, unitPrice: price, amount });
          }
          const orderId = pay.orderId ?? `rcx-${randomUUID()}`;
          const [used] = await this.db.query(
            `SELECT 1 FROM referral_code_payments WHERE payment_key = $1 OR order_id = $2`,
            [pay.paymentKey, orderId]);
          if (used) {
            throw new StateConflict('PAYMENT_KEY_USED', '이미 소개코드 발급에 쓴 결제입니다. 같은 결제로 다시 받을 수 없습니다.');
          }

          /* D022 — 이미 승인된 결제(응답 유실 뒤의 재시도)는 다시 받지 않고 결제사에 물어 확인합니다 */
          const r = await confirmOrRecover(provider, {
            paymentKey: pay.paymentKey, orderId, amount,
            orderName: `소개코드 추가 ${extraN}건`,   // 소개비가 아닙니다 — 회원이 플랫폼에 내는 코드 요금
          });
          if (!r.approved) {
            if (r.uncertain) {
              throw new PolicyViolation('PAYMENT_UNCERTAIN',
                '결제 결과를 확인하지 못했습니다. 잠시 뒤 같은 요청으로 다시 시도해 주십시오 — 이미 승인된 결제는 다시 청구되지 않습니다.');
            }
            throw new PolicyViolation('PAYMENT_FAILED', r.detail ?? '결제 승인에 실패했습니다.');
          }
          approvedKey = pay.paymentKey;
          stub = !!r.stub;
          if (stub) console.warn(`[billing] 결제 스텁 동작 — 실제 승인 아님 (extra refcode x${extraN})`);

          await this.db.query(
            `INSERT INTO referral_code_payments
               (payment_key, order_id, account_id, subscription_id, unit_price, code_count, amount, stub)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [pay.paymentKey, orderId, this.me, sub.id, price, extraN, amount, stub]);
          paymentKey = pay.paymentKey;
        }

        const codes: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const extra = i >= freeN;
          codes.push(await this.insertCode(sub.id, extra,
            extra ? `추가 소개코드 · ${price}원 결제` : null,
            extra ? paymentKey : null, extra ? price : null, boundListing));
        }
        return codes;
      });
    } catch (e) {
      /* 결제는 승인됐는데 발급이 실패했으면 돈만 나간 것입니다 — 승인을 바로 취소합니다. */
      if (approvedKey) {
        /* D022 — 같은 취소를 다시 보내도 한 번만 되게 멱등 키를 붙이고, **취소가 확인되면** 「거절 확정」으로 표시합니다
         * (그래야 같은 키의 재시도가 결제 결과 대조로 가지 않고 새 결제를 받습니다). 취소가 안 됐으면 표시는 「승인」으로 남아
         * 중복 요청 기록이 「결과 불명확」이 되고, 다시 올 때 결제사 조회로 이어서 발급합니다. */
        const c = await provider.cancel({ paymentKey: approvedKey, cancelReason: '소개코드 발급 실패 — 자동 취소',
            idempotencyKey: `rcx-autocancel-${approvedKey}` })
          .catch((x) => { console.error(`[billing] 소개코드 결제 자동 취소 실패 (${approvedKey}): ${x?.message ?? x}`); return null; });
        if (c?.ok) RequestCtx.markPayment({ state: 'DECLINED', paymentKey: approvedKey });
        else console.error(`[billing] 소개코드 결제 자동 취소가 확인되지 않음 (${approvedKey}) — 결제 결과 대조 필요`);
      }
      throw e;
    }
  }

  private async insertCode(subscriptionId: string | null, extra: boolean, memo: string | null,
                           paymentKey: string | null, extraAmount: number | null, listingId: string | null = null) {
    const code = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    /* ★ 20260930 — 표에 맞춥니다. owner_account_id · is_extra 입니다.
     * ★ D012 — listing_id: 매물별 코드(scope=listing). scope=all 이면 NULL(모든 매물). */
    const [row] = await this.db.query(
      `INSERT INTO referral_codes
         (code, subscription_id, owner_account_id, is_extra, memo, extra_payment_key, extra_amount, listing_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING code, listing_id AS "listingId", is_extra AS "isExtra", issued_at AS "issuedAt",
                 extra_amount AS "extraAmount", (extra_payment_key IS NOT NULL) AS paid, false AS reused`,
      [code, subscriptionId, this.me, extra, memo, paymentKey, extraAmount, listingId]);
    return row;
  }

  /**
   * 내 성사 수수료 청구 내역.
   *
   * 소개비가 아닙니다. 회원이 플랫폼에 내는 자기 비용입니다.
   * 소개비는 당사자끼리 정하며 플랫폼이 관여하지 않습니다.
   */
  successFees() {
    return this.db.query(
      `SELECT f.id, f.deal_id AS "dealId", f.plan_code AS "planCode",
              f.amount, f.status, f.created_at AS "createdAt",
              f.settled_at AS "settledAt",
              coalesce(sl.label, f.status) AS "statusLabel"
         FROM success_fees f
         LEFT JOIN code_labels sl
                ON sl.domain = 'success_fee.status' AND sl.code = f.status
        WHERE f.payer_account_id = $1
        ORDER BY f.created_at DESC`, [this.me]);
  }

  /** 현재 켜져 있는 기능 스위치. 화면이 코드에 하드코딩하지 않도록 합니다. */
  features() {
    return this.db.query(
      `SELECT feature, enabled, description FROM v_feature_flags ORDER BY feature`);
  }

  codes() {
    return this.db.query(
      `SELECT rc.code, rc.listing_id AS "listingId", l.title AS "listingTitle", l.gwan_code AS "gwanCode",
              l.status AS "listingStatus", rc.is_extra AS "isExtra",
              rc.issued_at AS "issuedAt", rc.revoked_at AS "revokedAt",
              rc.extra_amount AS "extraAmount", (rc.extra_payment_key IS NOT NULL) AS paid,
              rp.stub AS "paymentStub",
              (rc.issued_at >= ${BillingService.MONTH}) AS "thisMonth",
              (SELECT count(*)::int FROM attribution_events ae WHERE ae.code = rc.code)
                AS touches
         FROM referral_codes rc
         LEFT JOIN referral_code_payments rp ON rp.payment_key = rc.extra_payment_key
         LEFT JOIN listings l ON l.id = rc.listing_id
        WHERE rc.owner_account_id = $1 ORDER BY rc.issued_at DESC`, [this.me]);   /* 20260930 열 이름 교정 · D010 결제 · 이번 달 · D012 매물 */
  }
}
