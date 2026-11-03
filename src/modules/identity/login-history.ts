import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.181 (D170 · docs/283) — 회원 로그인 기록(SB-MYP-SEC-010)
 *
 *   원래 IP · 브라우저 글자는 남기지 않습니다 — IP 는 앞 두 마디(121.168.*.*), 브라우저는 종류만(Chrome · Windows).
 *   기록을 남기지 못해도 로그인은 그대로 이어 갑니다.
 * ------------------------------------------------------------------- */

/** 121.168.92.13 → 121.168.*.* · IPv6 는 앞 두 묶음 */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/, '');
  const v4 = v.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  if (v.includes(':')) return `${v.split(':').slice(0, 2).join(':')}:*`;
  return null;
}

/** 브라우저 · OS 종류만 — 판 번호 · 기기 이름은 남기지 않음 */
export function uaKind(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const b = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Whale\//.test(ua) ? 'Whale'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari'
    : /curl|python|node|axios/i.test(ua) ? '프로그램' : '기타';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}

export async function recordLogin(db: DatabaseService, accountId: string, ok: boolean): Promise<void> {
  const c = RequestCtx.get();
  await db.query(
    `INSERT INTO login_history (account_id, ok, ip_masked, ua_kind) VALUES ($1, $2, $3, $4)`,
    [accountId, ok, maskIp(c?.clientIp ?? c?.ip), uaKind(c?.userAgent)]).catch(() => undefined);
}
