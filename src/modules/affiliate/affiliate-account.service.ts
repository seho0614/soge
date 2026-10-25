import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from '../partner/partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { resolveBankVerifyProvider } from '../billing/bank-verify.provider';
import { AffiliateService, VERIFY_MAX_TRIES, VERIFY_RESEND_SEC, VERIFY_TTL_MIN } from './affiliate.service';

/**
 * 제휴 파트너 — 정산 계좌 등록 · 1원 인증(요청 · 확인) (D001).
 *
 * v10.108 (리팩토링 4차 · docs/168) — affiliate.service.ts 에서 함수 본문을 그대로 옮겼습니다(partnerId() 는 두 곳에 원본 그대로 · 코드 해시는 AffiliateService.codeHash 그대로 부름).
 */
@Injectable()
export class AffiliateAccountService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId()!; }
  /** 로그인한 사람의 파트너 id. 없으면 null. */
  private async partnerId(): Promise<string | null> {
    return this.actors.ownedId(this.me!, true);   // v10.39 — 조회는 PartnerActorService 한 곳(대표 계정 · 활동 중)
  }

  async setAccount(dto: { bankCode: string; bankName: string; accountNo: string; holderName: string }) {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };

    /* ★ 번호는 그대로 두지 않습니다. 운영 화면에 전체가 보이면
     *   그 자체가 위험합니다 — 뒤 4자리만 보여 줍니다. */
    const last4 = dto.accountNo.replace(/\D/g, '').slice(-4);
    const [r] = await this.db.query(
      `INSERT INTO partner_settlement_accounts
         (partner_id, bank_code, bank_name, account_enc, account_last4, holder_name)
       VALUES ($1, $2, $3, pgp_sym_encrypt($4, current_setting('app.enc_key', true)), $5, $6)
       ON CONFLICT (partner_id) DO UPDATE SET
         bank_code = EXCLUDED.bank_code, bank_name = EXCLUDED.bank_name,
         account_enc = EXCLUDED.account_enc, account_last4 = EXCLUDED.account_last4,
         holder_name = EXCLUDED.holder_name, verified_at = NULL
       RETURNING id, account_last4 AS "last4"`,
      [pid, dto.bankCode, dto.bankName, dto.accountNo, last4, dto.holderName]);
    return {
      ok: true, ...r,
      note: '등록했습니다. 이어서 1원 인증을 하셔야 지급됩니다.',
    };
  }

  private async accountForVerify(pid: string) {
    const [a] = await this.db.query(
      `SELECT bank_code, holder_name, verified_at, verify_code_hash,
              verify_sent_at, verify_expires_at, verify_tries,
              (verify_sent_at > now() - make_interval(secs => $2)) AS too_soon,
              (verify_expires_at <= now()) AS expired
         FROM partner_settlement_accounts WHERE partner_id = $1`, [pid, VERIFY_RESEND_SEC]);
    if (!a) throw new StateConflict('NO_ACCOUNT', '정산 계좌를 먼저 등록하십시오.');
    return a;
  }

  async requestVerify() {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };
    const a = await this.accountForVerify(pid);
    if (a.verified_at) return { ok: true, verified: true, note: '이미 인증된 계좌입니다.' };
    if (a.verify_tries >= VERIFY_MAX_TRIES) {
      throw new PolicyViolation('TOO_MANY_TRIES',
        '인증 코드를 다섯 번 틀려 막혔습니다 — 계좌를 다시 등록하시거나 1:1 문의를 남겨 주십시오.');
    }
    if (a.too_soon) {
      throw new PolicyViolation('TOO_SOON', `1원을 방금 보냈습니다. ${VERIFY_RESEND_SEC}초 뒤에 다시 받으실 수 있습니다.`);
    }

    /* ★ 번호는 이 순간에만 풀어 어댑터에 넘깁니다 — 응답·로그에 싣지 않습니다. */
    const [plain] = await this.db.query(
      `SELECT pgp_sym_decrypt(account_enc::bytea, current_setting('app.enc_key', true)) AS no
         FROM partner_settlement_accounts WHERE partner_id = $1`, [pid]);
    const sent = await resolveBankVerifyProvider().send({
      bankCode: a.bank_code, accountNo: plain?.no ?? '', holderName: a.holder_name });
    if (!sent.sent || !sent.code) {
      throw new PolicyViolation('BANK_SEND_FAILED',
        sent.detail ?? '1원을 보내지 못했습니다. 계좌를 다시 확인해 주십시오.');
    }

    const [r] = await this.db.query(
      `UPDATE partner_settlement_accounts SET
          verify_code_hash = $2, verify_sent_at = now(),
          verify_expires_at = now() + make_interval(mins => $3), verify_stub = $4
        WHERE partner_id = $1 AND verified_at IS NULL
      RETURNING verify_expires_at AS "expiresAt", verify_tries AS "tries"`,
      [pid, AffiliateService.codeHash(sent.code), VERIFY_TTL_MIN, sent.stub]);
    if (!r) return { ok: true, verified: true, note: '이미 인증된 계좌입니다.' };

    return {
      ok: true, verified: false, stub: sent.stub, expiresAt: r.expiresAt,
      triesLeft: VERIFY_MAX_TRIES - r.tries,
      /* 스텁일 때만 코드를 알려 드립니다 — 실제로는 통장 입금자명에서 보셔야 합니다 */
      ...(sent.stub ? { devCode: sent.code } : {}),
      note: sent.stub
        ? `연동 전이라 실제로 1원이 가지 않았습니다 — 코드는 ${sent.code} 입니다. ${VERIFY_TTL_MIN}분 안에 입력하십시오.`
        : `1원을 보냈습니다. 통장 입금자명에 찍힌 코드를 ${VERIFY_TTL_MIN}분 안에 입력하십시오.`,
    };
  }

  async confirmVerify(code: string) {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };
    const a = await this.accountForVerify(pid);
    if (a.verified_at) return { ok: true, verified: true, note: '이미 인증된 계좌입니다.' };
    if (a.verify_tries >= VERIFY_MAX_TRIES) {
      throw new PolicyViolation('TOO_MANY_TRIES',
        '인증 코드를 다섯 번 틀려 막혔습니다 — 계좌를 다시 등록하시거나 1:1 문의를 남겨 주십시오.');
    }
    if (!a.verify_code_hash) {
      throw new StateConflict('NOT_REQUESTED', '먼저 「1원 받기」를 누르십시오.');
    }
    if (a.expired) {
      throw new PolicyViolation('CODE_EXPIRED', `코드는 ${VERIFY_TTL_MIN}분 동안만 쓸 수 있습니다 — 1원을 다시 받으십시오.`);
    }

    /* 저장해 둔 코드와 맞춰 보고, 어댑터에도 확인합니다(실연동 때 은행 쪽 확인). */
    const local = AffiliateService.codeHash(code) === a.verify_code_hash;
    const res = local
      ? await resolveBankVerifyProvider().confirm({ bankCode: a.bank_code, accountNo: '', code: code.trim().toUpperCase(), localMatched: true })
      : { verified: false, stub: true, detail: '코드가 맞지 않습니다.' };

    if (!res.verified) {
      const [after] = await this.db.query(
        `UPDATE partner_settlement_accounts
            SET verify_tries = least(verify_tries + 1, ${VERIFY_MAX_TRIES})
          WHERE partner_id = $1 RETURNING verify_tries AS "tries"`, [pid]);
      const left = VERIFY_MAX_TRIES - after.tries;
      throw new PolicyViolation(left > 0 ? 'CODE_MISMATCH' : 'TOO_MANY_TRIES',
        left > 0
          ? `${res.detail ?? '코드가 맞지 않습니다.'} (${left}회 남았습니다)`
          : '다섯 번 틀려 막혔습니다 — 계좌를 다시 등록하시거나 1:1 문의를 남겨 주십시오.',
        { triesLeft: left });
    }

    const [r] = await this.db.query(
      `UPDATE partner_settlement_accounts SET
          verified_at = now(), verify_code_hash = NULL, verify_tries = 0
        WHERE partner_id = $1 AND verified_at IS NULL
      RETURNING verified_at AS "verifiedAt", bank_name AS "bankName", account_last4 AS "last4"`, [pid]);
    return {
      ok: true, verified: true, ...(r ?? {}), stub: res.stub,
      note: res.stub
        ? '인증했습니다. 연동 전이라 실제 예금주는 확인되지 않았습니다.'
        : '인증했습니다. 이 계좌로 지급됩니다.',
    };
  }
}
