import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import {
  NICE_WINDOW_URL, NiceSession, decrypt, deriveKeys, encrypt, mockCryptoToken, newReqNo, niceCryptoToken, parseResult, reqDtim, requestData,
} from './nice-identity.adapter';

/* ---------------------------------------------------------------------
 * v10.141 (D137 · docs/214 · 설계 docs/213) — 본인인증 표준창 흐름
 *
 *   identity.provider  STUB(처음 · 지금처럼 바로 통과 · 시험용 표시) · MOCK(점검판 가짜 표준창 · 운영 서버에서는 STUB 로 읽음) · NICE
 *   start     요청 번호(1회용 · 10분) · 표준창에 넘길 값 — 세션 열쇠는 암호화해 identity_verifications.session_enc 에
 *   complete  무결성 → 복호화 → 요청 번호 · 시간 · 결과 코드 · CI · 나이 → CI 는 HMAC 해시만 저장 → identity_verified_at
 *   mockSign  MOCK 일 때만 — 가짜 표준창이 NICE 와 같은 암호로 결과를 만들어 돌려보냄
 *
 * 오류 처리(대표 「오류처리」 10/28) — 실패는 **트랜잭션 밖에서 먼저 기록**(result FAIL · fail_code)하고 세션 열쇠를 비운 뒤 오류를 돌려줌.
 *   원문 CI · 이름 · 생년월일은 기록 · 로그 어디에도 남기지 않음. 바깥 오류 문장도 회원에게 그대로 보이지 않음(코드만 로그).
 * ------------------------------------------------------------------- */

export type IdentityMode = 'STUB' | 'MOCK' | 'NICE';
export const NICE_KEY_NAMES = ['NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID'] as const;
const TTL_MIN = 10;
const START_PER_HOUR = 10;
const isProd = () => (process.env.NODE_ENV ?? 'development') === 'production';

interface Pending { id: string; account_id: string; req_no: string; expired: boolean; result: string; adapter: IdentityMode; s: string | null; next: string | null }

@Injectable()
export class IdentityVerifyService {
  private readonly log = new Logger(IdentityVerifyService.name);
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  private async setting(key: string, dflt: string) {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v?.trim() || dflt;
  }

  /** 지금 방식 — 운영 서버(production)에서 MOCK 은 STUB 로 읽음(설정 저장에서도 막지만 한 번 더) */
  async mode(): Promise<IdentityMode> {
    const v = (await this.setting('identity.provider', 'STUB')).toUpperCase();
    if (v === 'NICE') return 'NICE';
    if (v === 'MOCK') return isProd() ? 'STUB' : 'MOCK';
    return 'STUB';
  }

  static keysMissing(): string[] { return NICE_KEY_NAMES.filter((k) => !process.env[k]?.trim()); }

  /* ── 시작 ─────────────────────────────────────────────────────── */
  async start(next?: string | null) {
    const mode = await this.mode();
    if (mode === 'STUB') throw new StateConflict('USE_STUB', '지금은 시험용 본인인증입니다 — 「본인인증」 단추를 눌러 주십시오.');
    const [cnt] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity_verifications WHERE account_id = $1 AND req_no IS NOT NULL AND requested_at > now() - interval '1 hour'`, [this.me]);
    if (cnt.n >= START_PER_HOUR) throw new PolicyViolation('TOO_MANY_REQUESTS', '본인인증을 너무 여러 번 시작했습니다. 1시간 뒤 다시 시도해 주십시오.');

    const reqNo = newReqNo(); const dtim = reqDtim();
    let tok: { tokenVersionId: string; tokenVal: string; siteCode: string };
    try {
      tok = mode === 'MOCK' ? mockCryptoToken() : await niceCryptoToken(reqNo, dtim);
    } catch (e) {
      this.log.warn(`NICE 암호화 토큰 실패: ${(e as Error)?.message ?? e}`);
      await this.db.query(
        `INSERT INTO identity_verifications (account_id, provider, result, adapter, req_no, fail_code, completed_at) VALUES ($1, 'PASS', 'FAIL', $2, $3, 'UNAVAILABLE', now())`,
        [this.me, mode, reqNo]);
      throw new StateConflict('IDENTITY_UNAVAILABLE', '본인인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
    }
    const s: NiceSession = { tokenVersionId: tok.tokenVersionId, siteCode: tok.siteCode, ...deriveKeys(dtim, reqNo, tok.tokenVal) };
    const returnUrl = mode === 'MOCK' ? '/verify/return' : `${await this.baseUrl()}/verify/return`;
    const { encData, integrity } = encrypt(s, requestData(s, reqNo, returnUrl));
    await this.db.query(
      `INSERT INTO identity_verifications (account_id, provider, result, adapter, req_no, req_expires_at, session_enc, raw)
       VALUES ($1, 'PASS', 'PENDING', $2, $3, now() + make_interval(mins => $4), pgp_sym_encrypt($5, fn_enc_key()), $6::jsonb)`,
      [this.me, mode, reqNo, TTL_MIN, JSON.stringify(s), JSON.stringify({ tv: s.tokenVersionId, next: safeNext(next) })]);
    const fields = { m: 'service', token_version_id: s.tokenVersionId, enc_data: encData, integrity_value: integrity };
    return mode === 'MOCK'
      ? { mode, expiresInMinutes: TTL_MIN, window: { url: '/verify/mock-nice', method: 'GET' as const, fields } }
      : { mode, expiresInMinutes: TTL_MIN, window: { url: NICE_WINDOW_URL(), method: 'POST' as const, fields } };
  }

  /** 운영 주소(site.base_url) — https 가 아니면 NICE 가 돌려보낼 곳이 없어 시작하지 않음 */
  private async baseUrl() {
    const v = (await this.setting('site.base_url', '')).replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) {
      throw new StateConflict('IDENTITY_UNAVAILABLE', '본인인증 설정이 끝나지 않았습니다(사이트 주소). 운영팀에 알려 주십시오.');
    }
    return v;
  }

  /* ── 세션 찾기 ─────────────────────────────────────────────────── */
  private async pending(tv: string): Promise<Pending> {
    if (!/^[A-Za-z0-9_-]{4,100}$/.test(String(tv ?? ''))) throw new NotFound('본인인증 요청이 없습니다.');
    const [r] = await this.db.query<Pending>(
      `SELECT id, account_id, req_no, result, adapter, (req_expires_at < now()) AS expired, raw->>'next' AS next,
              CASE WHEN session_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(session_enc, fn_enc_key()) END AS s
         FROM identity_verifications WHERE raw->>'tv' = $1 AND req_no IS NOT NULL ORDER BY requested_at DESC LIMIT 1`, [tv]);
    if (!r || r.account_id !== this.me) throw new NotFound('본인인증 요청이 없습니다.');
    if (r.result !== 'PENDING' || !r.s) throw new StateConflict('IDENTITY_USED', '이미 처리된 본인인증입니다. 처음부터 다시 해 주십시오.');
    return r;
  }

  /** 실패 기록(트랜잭션 밖 · 세션 비움) → 오류 */
  private async fail(id: string, code: string, err: Error): Promise<never> {
    try {
      await this.db.query(
        `UPDATE identity_verifications SET result = 'FAIL', fail_code = $2, completed_at = now(), session_enc = NULL WHERE id = $1 AND result = 'PENDING'`, [id, code]);
    } catch (e) { this.log.error(`본인인증 실패 기록 못 함 ${id} ${code}: ${(e as Error)?.message}`); }
    throw err;
  }

  /* ── 완료 ─────────────────────────────────────────────────────── */
  async complete(dto: { token_version_id: string; enc_data: string; integrity_value: string }) {
    const p = await this.pending(dto.token_version_id);
    const integrityErr = () => new PolicyViolation('IDENTITY_INTEGRITY', '본인인증 결과를 확인하지 못했습니다. 처음부터 다시 해 주십시오.');
    if (p.expired) return this.fail(p.id, 'EXPIRED', new PolicyViolation('IDENTITY_EXPIRED', `본인인증 시간(${TTL_MIN}분)이 지났습니다. 처음부터 다시 해 주십시오.`));
    let s: NiceSession;
    try { s = JSON.parse(p.s!); } catch { return this.fail(p.id, 'INTEGRITY', integrityErr()); }
    const plain = decrypt(s, String(dto.enc_data ?? ''), String(dto.integrity_value ?? ''));
    if (!plain) return this.fail(p.id, 'INTEGRITY', integrityErr());
    const r = parseResult(plain);
    if (!r) return this.fail(p.id, 'INTEGRITY', integrityErr());
    if (r.requestNo !== p.req_no) return this.fail(p.id, 'REQ_MISMATCH', integrityErr());
    if (r.resultCode !== '0000') {
      const code = /^[A-Za-z0-9]{1,8}$/.test(r.resultCode) ? r.resultCode : 'X';
      return this.fail(p.id, `NICE_${code}`, new PolicyViolation('IDENTITY_FAILED', '본인인증이 완료되지 않았습니다(취소 또는 실패). 다시 시도해 주십시오.'));
    }
    if (!r.ci) return this.fail(p.id, 'NO_CI', new PolicyViolation('IDENTITY_FAILED', '본인인증이 완료되지 않았습니다. 다시 시도해 주십시오.'));
    const minAge = Number(await this.setting('identity.min_age', '14')) || 14;
    const age = r.birthdate ? ageOn(r.birthdate) : null;
    if (age == null || age < minAge) {
      return this.fail(p.id, 'UNDER_AGE', new PolicyViolation('UNDER_AGE', `만 ${minAge}세 이상만 본인인증을 할 수 있습니다.`));
    }

    const [h] = await this.db.query<{ h: string }>(`SELECT encode(hmac($1, fn_enc_key(), 'sha256'), 'hex') AS h`, [r.ci]);
    const [dup] = await this.db.query<{ n: number }>(
      `SELECT count(DISTINCT account_id)::int AS n FROM identity_verifications
        WHERE ci_hash = $1 AND result = 'SUCCESS' AND account_id <> $2`, [h.h, this.me]);
    const policy = await this.setting('identity.ci_duplicate', 'warn');
    if (dup.n > 0 && policy === 'block') {
      return this.fail(p.id, 'CI_DUPLICATE', new StateConflict('CI_DUPLICATE', '이미 다른 계정에서 본인인증을 한 분입니다. 그 계정으로 로그인해 주십시오.'));
    }
    const [acc] = await this.db.query<{ name: string }>(`SELECT name FROM accounts WHERE id = $1`, [this.me]);
    const nameMatch = !!r.name && norm(r.name) === norm(acc?.name ?? '');

    return this.db.transaction(async () => {
      const [u] = await this.db.query<{ id: string }>(
        `UPDATE identity_verifications
            SET result = 'SUCCESS', ci_hash = $2, completed_at = now(), name_match = $3, session_enc = NULL,
                raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('dupAccounts', $4::int)
          WHERE id = $1 AND result = 'PENDING' RETURNING id`, [p.id, h.h, nameMatch, dup.n]);
      if (!u) throw new StateConflict('IDENTITY_USED', '이미 처리된 본인인증입니다. 처음부터 다시 해 주십시오.');
      const [a] = await this.db.query<{ at: Date }>(`UPDATE accounts SET identity_verified_at = now() WHERE id = $1 RETURNING identity_verified_at AS at`, [this.me]);
      return { success: true, stub: false, mode: p.adapter, verifiedAt: a.at, nameMatch, duplicate: dup.n > 0, next: p.next };
    });
  }

  /* ── 가짜 표준창(MOCK) ───────────────────────────────────────── */
  async mockSign(dto: { token_version_id: string; enc_data: string; integrity_value: string; name: string; birthdate: string; cancel?: boolean }) {
    if ((await this.mode()) !== 'MOCK') throw new Forbidden('MOCK_ONLY', '가짜 표준창은 점검판(MOCK)에서만 씁니다.');
    const p = await this.pending(dto.token_version_id);
    let s: NiceSession;
    try { s = JSON.parse(p.s!); } catch { throw new PolicyViolation('IDENTITY_INTEGRITY', '요청 자료를 확인하지 못했습니다.'); }
    const plain = decrypt(s, String(dto.enc_data ?? ''), String(dto.integrity_value ?? ''));
    let req: any = null; try { req = plain ? JSON.parse(plain) : null; } catch { req = null; }
    if (!req?.requestno || !req?.returnurl) throw new PolicyViolation('IDENTITY_INTEGRITY', '요청 자료를 확인하지 못했습니다.');
    if (!dto.cancel && (!/^\d{8}$/.test(String(dto.birthdate ?? '')) || !String(dto.name ?? '').trim())) {
      throw new PolicyViolation('BAD_INPUT', '이름과 생년월일(8자리)을 넣어 주십시오.');
    }
    const name = String(dto.name ?? '').trim().slice(0, 40);
    const ci = createHash('sha512').update(`mock-ci:${name}:${dto.birthdate}`).digest('base64');
    const res = dto.cancel
      ? { resultcode: '0001', requestno: req.requestno }
      : { resultcode: '0000', requestno: req.requestno, responseno: 'MOCKRES' + Date.now(), authtype: 'M', utf8_name: encodeURIComponent(name),
          birthdate: dto.birthdate, gender: '1', nationalinfo: '0', mobileco: '1', ci, di: 'MOCKDI' };
    const { encData, integrity } = encrypt(s, JSON.stringify(res));
    return { returnUrl: String(req.returnurl), fields: { token_version_id: s.tokenVersionId, enc_data: encData, integrity_value: integrity } };
  }

  /* ── 옛 단추(STUB) ─────────────────────────────────────────────── */
  async stubVerify(provider = 'PASS') {
    if ((await this.mode()) !== 'STUB') {
      throw new StateConflict('USE_STANDARD_WINDOW', '휴대폰 본인확인 창으로 인증해 주십시오.');
    }
    /* v10.141 — 전에는 PASS_API_KEY 를 넣으면 stub=false · ci_hash 가 비어 저장돼 소개코드 무료분이 0 이 됐음 → STUB 은 늘 stub-ci */
    return this.db.transaction(async () => {
      await this.db.query(
        `INSERT INTO identity_verifications (account_id, provider, result, ci_hash, completed_at, raw, adapter)
         VALUES ($1, $2, 'SUCCESS', 'stub-ci', now(), '{"stub": true}'::jsonb, 'STUB')`, [this.me, provider]);
      const [row] = await this.db.query<{ identity_verified_at: Date }>(
        `UPDATE accounts SET identity_verified_at = now() WHERE id = $1 RETURNING identity_verified_at`, [this.me]);
      return { success: true, stub: true, verifiedAt: row.identity_verified_at };
    });
  }

  /* ── 운영 화면 ─────────────────────────────────────────────────── */
  async adminStatus() {
    const mode = await this.mode();
    const setVal = await this.setting('identity.provider', 'STUB');
    const admin = await this.db.query<{ name: string }>(`SELECT name FROM integration_secrets WHERE integration_code = 'PASS'`);
    const keys = NICE_KEY_NAMES.map((n) => ({ name: n, set: !!process.env[n]?.trim(), source: admin.some((r) => r.name === n) ? 'ADMIN' : process.env[n]?.trim() ? 'ENV' : 'NONE' }));
    const [c] = await this.db.query<{ ok: number; fail: number; stub: number; pending: number; dup: number }>(
      `SELECT count(*) FILTER (WHERE result = 'SUCCESS' AND coalesce(adapter, 'STUB') <> 'STUB')::int AS ok,
              count(*) FILTER (WHERE result = 'FAIL')::int AS fail,
              count(*) FILTER (WHERE result = 'SUCCESS' AND coalesce(adapter, 'STUB') = 'STUB')::int AS stub,
              count(*) FILTER (WHERE result = 'PENDING')::int AS pending,
              count(*) FILTER (WHERE result = 'SUCCESS' AND coalesce((raw->>'dupAccounts')::int, 0) > 0)::int AS dup
         FROM identity_verifications WHERE provider = 'PASS' AND requested_at > now() - interval '30 days'`);
    const reasons = await this.db.query<{ reason: string; n: number }>(
      `SELECT fail_code AS reason, count(*)::int AS n FROM identity_verifications
        WHERE provider = 'PASS' AND result = 'FAIL' AND requested_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 20`);
    return {
      provider: mode, setting: setVal, mockAllowed: !isProd(), keys, keysMissing: IdentityVerifyService.keysMissing(),
      ciDuplicate: await this.setting('identity.ci_duplicate', 'warn'), minAge: Number(await this.setting('identity.min_age', '14')) || 14,
      last30: { success: c.ok, fail: c.fail, stub: c.stub, pending: c.pending, duplicate: c.dup, reasons },
    };
  }
}

/** 우리 사이트 안 주소만(/로 시작 · // · \ 아님 · 300자) */
export function safeNext(v?: string | null) {
  return v && /^\/(?![\/\\])[^\s]*$/.test(v) && v.length <= 300 ? v : null;
}
/** 이름 비교 — 빈칸 · 가운뎃점 빼고 */
function norm(s: string) { return s.replace(/[\s·.]/g, '').toLowerCase(); }
/** 만 나이(서울 오늘) */
export function ageOn(ymd: string, now = new Date()) {
  const t = new Date(now.getTime() + 9 * 3600_000);
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(4, 6)), d = Number(ymd.slice(6, 8));
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  let a = t.getUTCFullYear() - y;
  if (t.getUTCMonth() + 1 < m || (t.getUTCMonth() + 1 === m && t.getUTCDate() < d)) a--;
  return a;
}
