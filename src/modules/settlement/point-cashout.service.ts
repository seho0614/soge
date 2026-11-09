import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation } from '../../core/errors';

/**
 * v10.219 (D190 · docs/352) — 포인트 출금(현금 지급).
 *
 * 회원이 현금화 가능 포인트를 확인된 본인 계좌로 출금 신청 → 운영 확정(ADMIN) → 지급 담당(PAYOUT · 다른 사람)이 이체 후 기록.
 * 회사가 자기 돈(마케팅비)으로 보내는 것이라 소개비가 아닙니다(INV-9 예외 · INV-11 계좌번호 없음).
 * 잔액 · 최소 금액 · 처리 중 신청 · 계좌 · 본인인증 · 원천징수율은 DB(fn_point_cashout_new)가 마지막으로 막습니다.
 */
@Injectable()
export class PointCashoutService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  async mine() {
    const [s] = await this.db.query<{ cashable: number; min: number; taxRate: string | null; verified: boolean }>(
      `SELECT fn_point_cashable($1) AS cashable,
              coalesce(nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_min'), '')::int, 10000) AS min,
              nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'), '') AS "taxRate",
              (SELECT identity_verified_at IS NOT NULL FROM accounts WHERE id = $1) AS verified`, [this.me]);
    const accounts = await this.db.query(
      `SELECT id, bank_name AS "bankName", account_last4 AS last4, holder_name AS "holderName", is_stub AS "isStub"
         FROM payout_accounts WHERE account_id = $1 AND verified
        ORDER BY is_default DESC, created_at DESC`, [this.me]);
    const requests = await this.db.query(
      `SELECT id, points, tax_rate::text AS "taxRate", withholding, net_amount AS "netAmount", status,
              bank_name AS "bankName", account_last4 AS last4, requested_at AS "requestedAt", paid_at AS "paidAt",
              closed_reason AS "closedReason"
         FROM point_cashouts WHERE account_id = $1 ORDER BY requested_at DESC LIMIT 20`, [this.me]);
    const open = (requests as Array<{ status: string }>).some((r) => r.status === 'REQUESTED' || r.status === 'CONFIRMED');
    const blocker = !s.taxRate ? 'TAX_UNSET' : !s.verified ? 'IDENTITY' : open ? 'OPEN' : !accounts.length ? 'ACCOUNT'
      : s.cashable < s.min ? 'BELOW_MIN' : null;
    return { cashable: s.cashable, min: s.min, taxRate: s.taxRate, identityVerified: s.verified, accounts, requests, open, blocker };
  }

  async request(points: number, payoutAccountId: string) {
    if (!Number.isInteger(points) || points < 1) throw new PolicyViolation('INVALID_POINTS', '출금할 포인트를 숫자로 적어 주십시오.');
    const [r] = await this.db.query<{ id: string; points: number; withholding: number; netAmount: number; taxRate: string }>(
      `INSERT INTO point_cashouts (account_id, points, payout_account_id, tax_rate, withholding, net_amount, bank_name, holder_name)
       VALUES ($1, $2, $3, 0, 0, $2, '-', '-')
       RETURNING id, points, withholding, net_amount AS "netAmount", tax_rate::text AS "taxRate"`,
      [this.me, points, payoutAccountId]);
    return { ok: true, ...r, status: 'REQUESTED',
      note: `출금을 신청했습니다. 원천징수 ${r.withholding.toLocaleString('ko-KR')}원을 뺀 ${r.netAmount.toLocaleString('ko-KR')}원이 운영 확인 뒤 계좌로 갑니다.` };
  }

  async cancel(id: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE point_cashouts SET status = 'CANCELED' WHERE id = $1 AND account_id = $2 AND status = 'REQUESTED' RETURNING id`,
      [id, this.me]);
    if (!rows.length) throw new PolicyViolation('NOT_CANCELABLE', '취소할 수 있는 신청이 아닙니다 — 운영이 확정한 뒤에는 고객센터로 문의해 주십시오.');
    return { ok: true, id, status: 'CANCELED', note: '출금 신청을 취소했습니다. 포인트는 그대로 남아 있습니다.' };
  }
}
