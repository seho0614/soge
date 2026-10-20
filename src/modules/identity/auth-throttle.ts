import { createHash, createHmac } from 'node:crypto';
import { AppError, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.48 (D102) — 로그인 잠금 · 요청 횟수 제한에 쓰는 작은 도구
 *
 *   이메일 · IP 원문은 DB 에 넣지 않습니다.
 *     이메일 → DB 함수 fn_auth_email_key 가 sha256(소문자)  (계정이 없는 이메일도 같은 방식 — 계정 유무가 드러나지 않게)
 *     IP     → 여기서 HMAC-SHA256(서버 비밀 · 한국 날짜 · IP)  — 날짜를 섞어 오래 남은 기록으로 사람을 쫓지 못하게
 *   판정(몇 번에 잠글지 · 몇 분 잠글지)은 DB 함수 fn_login_gate · fn_login_fail · fn_reset_request_allowed 한 곳입니다.
 * ------------------------------------------------------------------- */

/** 접속자 IP 의 HMAC(64자 hex). IP 를 알 수 없으면 null — 그때는 IP 제한 없이 이메일 잠금만 걸립니다 */
export function clientIpKey(): string | null {
  const ip = RequestCtx.get()?.clientIp ?? RequestCtx.get()?.ip;
  if (!ip) return null;
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const secret = process.env.JWT_SECRET ?? 'sgb-dev';
  return createHmac('sha256', secret).update(`ip:${day}:${ip}`).digest('hex');
}

/** 재설정 증표 → 저장용 해시(64자 hex) */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 가입 · 변경 · 재설정이 같은 규칙을 씁니다 — 영문 · 숫자 · 특수문자를 섞어 10자 이상(시안 가입 3단계) */
export function assertStrongPassword(pw: string): void {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 100 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)
      || !/[^A-Za-z0-9]/.test(pw)) {
    throw new PolicyViolation('WEAK_PASSWORD', '비밀번호는 영문 · 숫자 · 특수문자를 섞어 10자 이상이어야 합니다.');
  }
}

/** 남은 초 → 「N분」 (1분 미만은 1분) */
export function minutesText(sec: number): string {
  return `${Math.max(1, Math.ceil(sec / 60))}분`;
}

/** 423 — 이메일 잠금 */
export class AccountLocked extends AppError {
  constructor(retryAfterSec: number) {
    super(423, {
      code: 'ACCOUNT_LOCKED',
      message: `로그인을 여러 번 잘못하셔서 잠시 잠겼습니다. ${minutesText(retryAfterSec)} 뒤에 다시 시도하시거나 비밀번호를 재설정해 주십시오.`,
      details: { retryAfterSec },
    });
  }
}

/** 429 — 같은 IP 의 실패가 많음 · 재설정 요청이 많음 */
export class TooManyAttempts extends AppError {
  constructor(code: string, message: string, retryAfterSec?: number) {
    super(429, { code, message, ...(retryAfterSec ? { details: { retryAfterSec } } : {}) });
  }
}
