import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { TooManyAttempts } from './auth-throttle';

/* ---------------------------------------------------------------------
 * v10.173 (D162 · docs/266) — 가입 · 매물 등록 남용 막기
 *
 *   사용자 웹 전체 공개(11/1) 뒤 시험 본인인증 상태에서 자동 가입 · 광고 글을 막는 작은 상한들.
 *   상한 값은 사이트 설정(운영 전용) — abuse.signup_per_ip_day · abuse.new_member_listings_day (0 이면 끔).
 *   내부 IP(같은 서버 · 사설망)에서 온 요청은 세지 않습니다 — 운영 Nginx 가 X-Forwarded-For 를 접속자 IP 로 덮어쓰므로
 *   손님 요청은 늘 공인 IP 로 보이고, 설정이 어긋나 모두 내부 IP 로 보이더라도 가입이 통째로 막히지는 않게.
 * ------------------------------------------------------------------- */

/** 접속자 IP 원문(저장하지 않음 · 판정에만) */
export function clientIpRaw(): string | null {
  return RequestCtx.get()?.clientIp ?? RequestCtx.get()?.ip ?? null;
}

/** 127.* · ::1 · 10.* · 172.16 ~ 31.* · 192.168.* · fc/fd(IPv6 사설) · 알 수 없음 */
export function isInternalIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/, '');
  if (v === '::1' || /^(127|10)\./.test(v) || /^192\.168\./.test(v) || /^f[cd][0-9a-f]{2}:/i.test(v)) return true;
  const m = /^172\.(\d+)\./.exec(v);
  return !!m && +m[1] >= 16 && +m[1] <= 31;
}

/** 설정 숫자(없거나 숫자가 아니면 기본값) */
export async function settingInt(db: DatabaseService, key: string, dflt: number): Promise<number> {
  const [r] = await db.query<{ v: number | null }>(
    `SELECT CASE WHEN value ~ '^[0-9]+$' THEN value::int END AS v FROM site_settings WHERE key = $1`, [key]);
  return r?.v ?? dflt;
}

/**
 * 가입 24시간 안 회원의 24시간 매물 등록 수 상한(abuse.new_member_listings_day).
 *   소개광장 글은 DB 가 이미 막음(C810 — 하루 5개 · 가입 7일 안 링크 금지).
 *   운영자(ADMIN · SUPER · REVIEWER · PAYOUT)와 내부 IP 요청은 세지 않음. 넘으면 429 NEW_MEMBER_LIMIT.
 */
export async function assertNewMemberListingQuota(db: DatabaseService, accountId: string | null | undefined): Promise<void> {
  if (!accountId || isInternalIp(clientIpRaw())) return;
  const lim = await settingInt(db, 'abuse.new_member_listings_day', 20);
  if (lim <= 0) return;
  const [r] = await db.query<{ fresh: boolean; staff: boolean; used: number }>(
    `SELECT a.created_at > now() - interval '24 hours' AS fresh,
            EXISTS (SELECT 1 FROM account_roles x WHERE x.account_id = a.id AND x.role IN ('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT')) AS staff,
            (SELECT count(*)::int FROM listings l WHERE l.owner_account_id = a.id AND l.created_at > now() - interval '24 hours') AS used
       FROM accounts a WHERE a.id = $1`, [accountId]);
  if (!r || !r.fresh || r.staff || r.used < lim) return;
  throw new TooManyAttempts('NEW_MEMBER_LIMIT',
    `가입한 지 하루가 지나지 않은 회원은 하루 ${lim}개까지 매물을 등록할 수 있습니다. 내일 다시 시도해 주십시오.`);
}
