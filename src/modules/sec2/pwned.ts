/* ---------------------------------------------------------------------
 * v10.591 (docs/733) ⑦ 유출 비밀번호 막기 — 어댑터(k-익명 범위 조회) + 스위치(처음 off) + 간주(ASSUME)
 *
 *   비밀번호 원문 · 전체 해시는 밖으로 보내지 않습니다.
 *     1) 서버 안에서 SHA-1(비밀번호) → 40글자(대문자 16진)
 *     2) LIVE: 앞 5글자만 범위 조회 서비스(Have I Been Pwned · Pwned Passwords range API)에 보냄
 *        → 같은 앞 5글자를 가진 수백 개 「뒤 35글자:번수」 목록을 받아 서버 안에서 견줌(서비스는 어느 것을 찾는지 모름)
 *        · Add-Padding 머리글(답 크기로도 짐작 못 하게) · 3초 안 · 키 없음(무료 · 공개)
 *     3) ASSUME(간주): 밖으로 보내지 않고 서버 안 짧은 목록(흔히 쓰는 비밀번호의 SHA-1)만 견줌 — 점검판 · 시험용
 *   off(처음) 는 아무것도 하지 않음. LIVE 는 법무 확인 스위치(sec2.pwned_legal_ok) on 이어야 저장됨.
 *   조회 실패(시간 넘김 · 업체 오류)는 막지 않음(가입 · 재설정을 멈추지 않게) — 건수에 ERROR 로만.
 *   기록(sec2_pwned_log)은 어디서 · 방식 · 결과만(비밀번호 · 해시 · 계정 · IP 없음).
 *   점검판 · 시험은 LIVE 를 부르지 않습니다(계약 규칙 5 — 실제 호출 코드는 있음).
 * ------------------------------------------------------------------- */
import { createHash } from 'crypto';
import { PolicyViolation } from '../../core/errors';
import { Sec2Db, sec2Settings } from './common';

export const SEC2_PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
export type Sec2PwnedPlace = 'SIGNUP' | 'RESET' | 'CHANGE' | 'SOCIAL_PW' | 'TEST';

/** 간주 목록 — 강도 규칙(영문 · 숫자 · 특수 10자 이상)을 통과하지만 흔한 비밀번호들의 SHA-1(원문은 코드에 두지 않음 · 문서 docs/733 4절에 원문) */
const ASSUME_LIST = new Set([
  sha1('Password123!'), sha1('P@ssw0rd123'), sha1('Qwerty123!@#'), sha1('Admin1234!@'), sha1('1q2w3e4r!@#$'),
  sha1('Passw0rd!23'), sha1('Welcome123!'), sha1('Sogaebank1!'), sha1('Abcd1234!@#$'), sha1('Iloveyou123!'),
]);

export function sha1(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();
}

/** 범위 조회 답(「뒤 35글자:번수」 줄)에서 내 뒤 35글자의 번수 — 없으면 0 · 덧댄 줄(번수 0)은 0 */
export function sec2RangeCount(body: string, suffix: string): number {
  const want = suffix.toUpperCase();
  for (const line of body.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i !== 35) continue;
    if (line.slice(0, 35).toUpperCase() === want) return Math.max(0, parseInt(line.slice(36).trim(), 10) || 0);
  }
  return 0;
}

/** LIVE — 앞 5글자만 보냄 · 3초 · 실패면 null */
export async function sec2RangeLookup(hash40: string, timeoutMs = 3000): Promise<number | null> {
  const prefix = hash40.slice(0, 5), suffix = hash40.slice(5);
  try {
    const res = await fetch(SEC2_PWNED_RANGE_URL + prefix, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'sogaebank-password-check' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return sec2RangeCount(await res.text(), suffix);
  } catch {
    return null;
  }
}

async function log(db: Sec2Db, place: Sec2PwnedPlace, mode: 'ASSUME' | 'LIVE', result: 'PASS' | 'BLOCK' | 'ERROR') {
  await db.query(`INSERT INTO sec2_pwned_log (place, mode, result) VALUES ($1, $2, $3)`, [place, mode, result]).catch(() => undefined);
}

/** 판정만(막지 않음) — 시험 단추 · 아래 assert 가 씀 */
export async function sec2PwnedJudge(db: Sec2Db, password: string, place: Sec2PwnedPlace) {
  const s = await sec2Settings(db);
  if (s.pwnedMode === 'off' || typeof password !== 'string' || !password) return { mode: 'off' as const, count: 0, blocked: false, error: false };
  /* LIVE 인데 법무 확인이 꺼졌으면(설정을 직접 바꾼 경우) 간주로 — 밖으로 보내지 않는 쪽 */
  const mode: 'ASSUME' | 'LIVE' = s.pwnedMode === 'LIVE' && s.pwnedLegalOk ? 'LIVE' : 'ASSUME';
  const h = sha1(password);
  const count = mode === 'LIVE' ? await sec2RangeLookup(h) : (ASSUME_LIST.has(h) ? 1000 : 0);
  if (count === null) { await log(db, place, mode, 'ERROR'); return { mode, count: 0, blocked: false, error: true }; }
  const blocked = count >= s.pwnedMin;
  await log(db, place, mode, blocked ? 'BLOCK' : 'PASS');
  return { mode, count, blocked, error: false };
}

/** 가입 · 재설정 · 변경 · 간편 가입 첫 비밀번호 — 강도 검사(assertStrongPassword) 바로 뒤에 부름 · 막히면 422 PWNED_PASSWORD */
export async function sec2AssertNotPwned(db: Sec2Db, password: string, place: Sec2PwnedPlace): Promise<void> {
  const r = await sec2PwnedJudge(db, password, place);
  if (r.blocked) {
    throw new PolicyViolation('PWNED_PASSWORD',
      '이 비밀번호는 다른 곳에서 새어 나간 비밀번호 목록에 있습니다. 다른 비밀번호를 써 주십시오.', { count: r.count, mode: r.mode });
  }
}
