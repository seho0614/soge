import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 정기결제 — 운영 화면 조회(청구 실패 · 오늘 시도 · 알림 누락 · 사람 확인) · 정책 값.
 * v10.86 — recurring.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class RecurringAdminService {
  constructor(private readonly db: DatabaseService) {}
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
}
