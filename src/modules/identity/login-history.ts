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

/**
 * v10.221 (D191 · docs/356) — 낯선 기기 로그인 알림 LOGIN_NEW_DEVICE
 *
 *   성공한 로그인을 남기기 **전에** 부릅니다. 지난 90일 성공 로그인 중 같은 (IP 앞 두 마디 + 브라우저 종류)가 없으면 낯선 기기로 봅니다.
 *   알리지 않음: 설정 account.login_alert off · 90일 안 성공 로그인이 없음(첫 로그인 · 오래 쉰 뒤 — 비교할 기기가 없음) ·
 *   IP · 브라우저를 모름 · 오늘(한국) 이미 3번 알림. 알림을 남기지 못해도 로그인은 그대로 이어 갑니다.
 *   원래 IP · 브라우저 글자는 쓰지 않습니다(로그인 기록과 같은 가린 값).
 */
export async function notifyNewDevice(db: DatabaseService, accountId: string): Promise<boolean> {
  const c = RequestCtx.get();
  const ip = maskIp(c?.clientIp ?? c?.ip), ua = uaKind(c?.userAgent);
  if (!ip || !ua) return false;
  try {
    const [r] = await db.query<{ go: boolean; at: string }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'account.login_alert'), 'on') = 'on'
              AND EXISTS (SELECT 1 FROM login_history WHERE account_id = $1 AND ok AND at > now() - interval '90 days')
              AND NOT EXISTS (SELECT 1 FROM login_history WHERE account_id = $1 AND ok AND at > now() - interval '90 days'
                                AND ip_masked = $2 AND ua_kind = $3)
              AND (SELECT count(*) FROM notifications WHERE account_id = $1 AND event_code = 'LOGIN_NEW_DEVICE'
                     AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date) < 3 AS go,
              to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at`,
      [accountId, ip, ua]);
    if (!r?.go) return false;
    await db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       VALUES ($1, 'LOGIN_NEW_DEVICE', '새 기기에서 로그인했습니다', $2, '/my/account/security')`,
      [accountId, `${r.at}(한국 시간) ${ua} · ${ip} 에서 로그인했습니다. 직접 하신 것이 아니라면 로그인 기록 화면에서 「모든 기기 로그아웃」을 누르고 비밀번호를 바꿔 주십시오.`]);
    return true;
  } catch {
    return false;
  }
}

