import { readFileSync } from 'fs';
import { join } from 'path';

/* ---------------------------------------------------------------------
 * v10.85 — 앱 판 번호는 켜질 때 한 번 읽습니다(앱 폴더의 VERSION · 운영 ~/sgb · 개발 도커 /app).
 * v10.244 (D202 · docs/383) — 운영 적용 기록(ops_release_log)용 · 헬스체크(health.controller)와 같은 방법으로 읽음.
 * ------------------------------------------------------------------- */
export const APP_VERSION = (() => {
  try { return readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim().slice(0, 20) || '?'; } catch { return '?'; }
})();

/** 이 API 프로세스가 뜬 시각 */
export const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000));

/** 판 번호 견주기 — 'v10.244' 의 숫자 묶음끼리(앞이 크면 1 · 같으면 0 · 작으면 -1) */
export function versionCmp(a: string, b: string): number {
  const na = (a.match(/\d+/g) ?? []).map(Number), nb = (b.match(/\d+/g) ?? []).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const x = na[i] ?? 0, y = nb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
