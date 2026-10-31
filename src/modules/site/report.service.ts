import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 백오피스 — 경영 지표와 권한 관리.
 *
 * 운영이 매일 보는 숫자는 화면에 있어야 합니다.
 * SQL 을 짜야 알 수 있으면 아무도 안 봅니다.
 */
@Injectable()
export class ReportService {
  constructor(private readonly db: DatabaseService) {}

  /** 최근 30일 일자별. 0으로 떨어진 날이 있으면 그날 무언가 멈춘 것입니다. */
  daily() {
    return this.db.query(
      `SELECT day, signups, biz_verified AS "bizVerified", requests,
              listings, deals, revenue
         FROM v_daily_metrics`);
  }

  /**
   * 어긋남 신호.
   *
   * **시스템은 정상인데 사업이 새는 형태**를 봅니다.
   * 오류로는 안 잡히고 숫자로만 보입니다.
   */
  /**
   * 미동의 회원.
   *
   * 약관을 새로 발행하면 **기존 회원은 자동으로 동의한 상태가 되지
   * 않습니다.** 그대로 두면 동의 없이 쓰는 사람이 쌓이고, 분쟁이
   * 생겼을 때 "무엇에 동의했는가"를 답할 수 없습니다.
   *
   * 발행 직후 전원이 뜨는 것은 정상입니다 — 재동의를 받아야 줄어듭니다.
   */
  async notAgreed() {
    const [sum] = await this.db.query<any>(
      `SELECT count(DISTINCT account_id)::int AS accounts,
              count(*)::int AS items
         FROM v_term_not_agreed`);
    const byTerm = await this.db.query(
      `SELECT code, title, count(*)::int AS accounts
         FROM v_term_not_agreed GROUP BY code, title ORDER BY code`);
    return { ...sum, byTerm,
      note: '약관을 새로 발행하면 기존 회원은 자동 동의되지 않습니다. 재동의를 받으십시오.' };
  }

  signals() {
    return this.db.query(
      `SELECT signal, value, meaning FROM v_business_signals`);
  }

  /** 매출 요약. 구독료가 매출의 전부입니다. */
  async revenue() {
    const [sum] = await this.db.query<any>(
      `SELECT coalesce(sum(amount) FILTER (WHERE paid_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')),0) AS "thisMonth",
              coalesce(sum(amount) FILTER (WHERE paid_at >= (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul') - interval '1 month') AT TIME ZONE 'Asia/Seoul')
                                             AND paid_at <  (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')),0) AS "lastMonth",
              count(*) FILTER (WHERE paid_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')) AS "paidCount"
         FROM subscription_invoices WHERE paid_at IS NOT NULL`);
    const plans = await this.db.query(
      /* ★ 20260930 — 열 이름은 monthly_price 입니다(monthly_fee 없음).
       *   경영 지표 매출 화면이 늘 500 이었습니다(실측). 응답 키는 그대로 둡니다. */
      `SELECT p.code, p.name, p.monthly_price AS "monthlyFee",
              count(s.id) FILTER (WHERE s.status='ACTIVE') AS active
         FROM subscription_plans p
         LEFT JOIN subscriptions s ON s.plan_code = p.code
        GROUP BY p.code, p.name, p.monthly_price ORDER BY p.monthly_price`);
    return { ...sum, plans,
      note: '리드 이용료는 별도입니다. 소개비는 당사자 직접 지급이라 매출이 아닙니다.' };
  }

  /* ── 권한 ──────────────────────────────────────────────────────── */

  holders() {
    return this.db.query(
      `SELECT account_id AS "accountId", email, name, roles,
              last_change AS "lastChange"
         FROM v_role_holders ORDER BY email`);
  }

  changes() {
    return this.db.query(
      `SELECT c.id, a.email, c.role, c.action, c.reason,
              b.email AS "changedBy", c.changed_at AS "changedAt"
         FROM role_changes c
         JOIN accounts a ON a.id = c.account_id
         LEFT JOIN accounts b ON b.id = c.changed_by
        ORDER BY c.changed_at DESC LIMIT 100`);
  }

  /**
   * 권한 부여·회수.
   *
   * 관리자 역할을 주면 검수·정산·제재 권한이 함께 갑니다.
   * 사유를 남기게 하는 것은 나중에 "누가 왜 줬는가"를 답하기 위해서입니다.
   */
  async setRole(accountId: string, role: string, grant: boolean, reason: string) {
    const OK = ['REVIEWER', 'ADMIN', 'SUPER'];
    if (!OK.includes(role)) {
      throw new PolicyViolation('BAD_ROLE', '부여할 수 없는 역할입니다.');
    }
    if (!reason?.trim()) {
      throw new PolicyViolation('REASON_REQUIRED',
        '권한 변경에는 사유가 필요합니다. 사고가 나면 첫 질문이 "누가 왜 줬는가"입니다.');
    }
    if (accountId === RequestCtx.actorId()) {
      // 자기 권한을 스스로 올리면 승인 절차가 무의미해집니다.
      throw new PolicyViolation('SELF_GRANT', '자신의 권한은 바꿀 수 없습니다.');
    }

    return this.db.transaction(async () => {
      /* v10.163 (D153 · docs/252) — 사유 · 처리자를 먼저 거래 설정으로 넘김 → 트리거가 기록을 만들 때 함께 씀.
       *   전에는 기록을 만든 뒤 UPDATE 로 채웠는데, 권한 변경 기록은 수정 금지(trg_role_change_ro)라 늘 실패했음 */
      await this.db.query(`SELECT set_config('app.role_reason', $1, true), set_config('app.actor_id', $2, true)`,
        [reason.trim(), RequestCtx.actorId() ?? '']);
      if (grant) {
        await this.db.query(
          `INSERT INTO account_roles(account_id, role) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`, [accountId, role]);
      } else {
        const [gone] = await this.db.query<any>(
          `DELETE FROM account_roles WHERE account_id=$1 AND role=$2 RETURNING role`,
          [accountId, role]);
        if (!gone) throw new StateConflict('NO_SUCH_ROLE', '가지고 있지 않은 역할입니다.');
      }
      return { accountId, role, granted: grant };
    });
  }

  /**
   * 결정 대기 항목.
   *
   * **오픈을 막지는 않지만 그 위에 무엇을 쌓으면 안 되는지**를 알려 줍니다.
   * HIGH 는 회신 결과에 따라 작업이 통째로 버려질 수 있는 것입니다.
   *
   * 코드 주석에만 적어 두면 다음 사람이 못 봅니다.
   */
  pendingDecisions() {
    return this.db.query(
      `SELECT code, title, depends_on AS "dependsOn", risk, note
         FROM v_pending_decisions`);
  }
}
