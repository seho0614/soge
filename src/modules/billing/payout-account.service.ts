import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolveBankVerifyProvider } from './bank-verify.provider';

/**
 * 정산 계좌 · 1원 인증.
 *
 * v10.45 (2026-10-16 · 리팩토링) — recurring.service.ts 에서 옮겼습니다. 동작은 그대로입니다.
 */
@Injectable()
export class PayoutAccountService {
  constructor(private readonly db: DatabaseService) {}


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
