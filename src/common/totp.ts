/* ---------------------------------------------------------------------
 * v10.180 (docs/281) — 휴대폰 인증 앱 6자리 번호(TOTP · RFC 6238 · HMAC-SHA1 · 30초 · 6자리)
 *
 *   외부 서비스 · 새 패키지 없이 Node crypto 로만 계산합니다(구글 OTP · 마이크로소프트 인증 앱 등과 같은 방식).
 *   비밀값은 20바이트 무작위 → base32(앱에 직접 넣는 글자) · otpauth:// 주소(휴대폰에서 누르면 앱이 열림).
 * ------------------------------------------------------------------- */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SEC = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

/** 30초 칸 번호(step)의 6자리 번호 — RFC 4226 동적 자르기 */
export function totpAt(secretB32: string, step: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (nowMs = Date.now()): number => Math.floor(nowMs / 1000 / TOTP_STEP_SEC);

/** 앞뒤 한 칸(±30초)까지 맞춰 봄 — 맞으면 그 칸 번호, 아니면 null. afterStep 이하 칸은 받지 않음(같은 번호 다시 쓰기 막음) */
export function totpMatch(secretB32: string, code: string, afterStep: number, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  for (const s of [now, now - 1, now + 1]) {
    if (s <= afterStep) continue;
    const want = Buffer.from(totpAt(secretB32, s)); const got = Buffer.from(code);
    if (timingSafeEqual(want, got)) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'SoGaeBank'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
    + `?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SEC}`;
}

/** 예비 번호 — 10자리(xxxxx-xxxxx) · 저장은 sha256 만 */
export function newBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const d = Array.from({ length: 10 }, () => String(randomInt(10))).join('');
    return `${d.slice(0, 5)}-${d.slice(5)}`;
  });
}
export const backupHash = (code: string): string =>
  createHash('sha256').update(code.replace(/\D/g, '')).digest('hex');
