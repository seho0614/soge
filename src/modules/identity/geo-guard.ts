import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { envInt, FetchLike, getPath, httpJson } from '../../common/http-json';
import { maskMail } from '../../common/mail/mail-admin.service';
import { clientIpRaw, isInternalIp } from './abuse-guard';
import { maskIp } from './login-history';

/* ---------------------------------------------------------------------
 * v10.485 (D268 · docs/623) 운영자 해외 접속 경고 — 대표 11/20 「㊳ ③」
 *
 *   운영 역할 계정이 비밀번호로 로그인할 때(AuthService.login · 비밀번호가 맞은 뒤) 접속 IP 의 나라를 봄
 *     허용 나라(security.geo_allow · 처음 KR) 밖  → 운영 알림 STAFF_LOGIN_ABROAD(CRITICAL — 급한 알림 메일 · 텔레그램 대상)
 *     + security.geo_block on                 → 그 로그인을 막음(403 GEO_BLOCKED) · STAFF_LOGIN_ABROAD_BLOCKED(WARN)
 *     판별 못 함(키 없음 · 업체 오류 · 사설 IP) → 막지 않음(UNKNOWN 으로 기록만 — 운영 화면이 「판별 못 함」 수를 보임)
 *   판별 어댑터(외부 연동 GEOIP)
 *     ASSUME(처음)  묻지 않고 security.geo_assume_country 로 봄(점검판 · 시험 — 사설 IP 도 그 나라로)
 *     LIVE          GEOIP_API_BASE 주소 틀({ip} · {key} · 처음 ipinfo 모양 https://ipinfo.io/{ip}?token={key}) · 나라 칸 GEOIP_COUNTRY_PATH(처음 country)
 *                   키 GEOIP_API_KEY(운영 화면 › 외부 연동 › 연동 키) 없으면 NOT_READY · 결과는 IP 지문(sha256)으로 7일 캐시
 *   security.geo_watch 처음 off · 기록은 IP 앞 두 마디 · 나라 · 판정만(원래 IP 는 DB · 로그에 남기지 않음)
 *   ★ 업체에 IP 를 보내는 것 = 개인정보 처리 위탁 · (해외 업체면) 국외 이전 — 법무 확인 뒤 LIVE(docs/623 6절)
 * ------------------------------------------------------------------- */

export const COUNTRY_RE = /^[A-Z]{2}$/;                        // DB CHECK sec_geo_events.country 와 같음
export const ALLOW_RE = /^[A-Z]{2}(,[A-Z]{2}){0,29}$/;         // DB value_pattern security.geo_allow 와 같음
const DEFAULT_BASE = 'https://ipinfo.io/{ip}?token={key}';
/* 운영 역할 — mfa.service 의 OPS_ROLES 와 같은 목록. 여기서 mfa.service 를 import 하지 않음(auth.service → geo-guard → mfa.service → auth.service 순환이면 Nest 주입이 깨짐) */
const STAFF_ROLES = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];
const CACHE_DAYS = 7;
const SETTING_MS = 30_000;

export type Source = 'ASSUME' | 'LIVE' | 'CACHE' | 'PRIVATE' | 'NOT_READY' | 'ERROR';
export interface GeoResult { country: string | null; source: Source; error?: string }
export interface GeoSettings { watch: boolean; mode: 'ASSUME' | 'LIVE'; assume: string; allow: string[]; block: boolean }

let cache: { at: number; s: GeoSettings } | null = null;
/** 시험 · 설정 저장 뒤 — 바로 다시 읽게 */
export function resetGeoCache() { cache = null; }

export async function geoSettings(db: DatabaseService): Promise<GeoSettings> {
  if (cache && Date.now() - cache.at < SETTING_MS) return cache.s;
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('security.geo_watch', 'security.geo_mode', 'security.geo_assume_country', 'security.geo_allow', 'security.geo_block')`);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim().toUpperCase();
  const allow = ALLOW_RE.test(v('security.geo_allow')) ? v('security.geo_allow').split(',') : ['KR'];
  const s: GeoSettings = { watch: v('security.geo_watch') === 'ON', mode: v('security.geo_mode') === 'LIVE' ? 'LIVE' : 'ASSUME',
    assume: COUNTRY_RE.test(v('security.geo_assume_country')) ? v('security.geo_assume_country') : 'KR', allow, block: v('security.geo_block') === 'ON' };
  cache = { at: Date.now(), s };
  return s;
}

const ipHash = (ip: string) => createHash('sha256').update(`geo|${ip}`).digest('hex');

/** LIVE 어댑터 — 업체 주소 틀 · 나라 칸 · 점검판에서는 부르지 않음 */
export class GeoIpHttp {
  constructor(private readonly fetchFn?: FetchLike) {}
  static ready() { return !!process.env.GEOIP_API_KEY?.trim(); }
  async lookup(ip: string): Promise<GeoResult> {
    if (!GeoIpHttp.ready()) return { country: null, source: 'NOT_READY', error: 'GEOIP_API_KEY 없음' };
    const tpl = process.env.GEOIP_API_BASE?.trim() || DEFAULT_BASE;
    if (!/^https:\/\//.test(tpl) || !tpl.includes('{ip}')) return { country: null, source: 'ERROR', error: 'GEOIP_API_BASE 는 https 주소 · {ip} 자리가 있어야 합니다' };
    const url = tpl.replace('{ip}', encodeURIComponent(ip)).replace('{key}', encodeURIComponent(process.env.GEOIP_API_KEY!.trim()));
    const r = await httpJson({ url, method: 'GET', timeoutMs: envInt('GEOIP_TIMEOUT_MS', 2000), fetchFn: this.fetchFn });
    if (!r.ok) return { country: null, source: 'ERROR', error: `${r.errorKind ?? 'UPSTREAM'} ${r.error ?? ''}`.trim() };
    const c = String(getPath(r.body, process.env.GEOIP_COUNTRY_PATH?.trim() || 'country') ?? '').trim().toUpperCase();
    return COUNTRY_RE.test(c) ? { country: c, source: 'LIVE' } : { country: null, source: 'ERROR', error: '나라 칸이 없음' };
  }
}

/** IP → 나라(ASSUME · 캐시 · LIVE) */
export async function lookupCountry(db: DatabaseService, ip: string | null, s?: GeoSettings, fetchFn?: FetchLike): Promise<GeoResult> {
  const st = s ?? await geoSettings(db);
  if (st.mode === 'ASSUME') return { country: st.assume, source: 'ASSUME' };
  if (!ip || isInternalIp(ip)) return { country: null, source: 'PRIVATE' };
  if (!GeoIpHttp.ready()) return { country: null, source: 'NOT_READY' };
  const h = ipHash(ip.replace(/^::ffff:/, ''));
  const [c] = await db.query<{ country: string | null }>(
    `SELECT country FROM sec_geo_cache WHERE ip_hash = $1 AND looked_at > now() - make_interval(days => $2::int)`, [h, CACHE_DAYS]).catch(() => []);
  if (c?.country) return { country: c.country, source: 'CACHE' };
  const r = await new GeoIpHttp(fetchFn).lookup(ip.replace(/^::ffff:/, ''));
  if (r.country) {
    await db.query(`INSERT INTO sec_geo_cache (ip_hash, country, looked_at) VALUES ($1, $2, now()) ON CONFLICT (ip_hash) DO UPDATE SET country = EXCLUDED.country, looked_at = now()`, [h, r.country]).catch(() => undefined);
  }
  return r;
}

/**
 * AuthService.login — 비밀번호가 맞은 운영 역할 계정만. 켜져 있지 않으면 DB 한 번(설정 · 30초 캐시)만.
 *   막을 때만 던지고(403 GEO_BLOCKED), 판별 · 기록 · 알림이 실패해도 로그인은 그대로(알림은 남기지 못해도 됨).
 */
export async function assertGeoAllowed(db: DatabaseService, accountId: string): Promise<void> {
  let s: GeoSettings;
  try { s = await geoSettings(db); } catch { return; }
  if (!s.watch) return;
  const [st] = await db.query<{ roles: string | null; email: string | null }>(
    `SELECT (SELECT string_agg(role, '·' ORDER BY role) FROM account_roles WHERE account_id = $1 AND role = ANY($2::text[])) AS roles,
            (SELECT email::text FROM accounts WHERE id = $1) AS email`, [accountId, STAFF_ROLES]).catch(() => []);
  if (!st?.roles) return;
  const ip = clientIpRaw();
  const r = await lookupCountry(db, ip, s).catch((e) => ({ country: null, source: 'ERROR' as Source, error: String((e as Error)?.message ?? e).slice(0, 80) }));
  const abroad = !!r.country && !s.allow.includes(r.country);
  const result = !r.country ? 'UNKNOWN' : !abroad ? 'OK' : s.block ? 'BLOCKED' : 'ALERT';
  const masked = maskIp(ip);
  await db.query(`INSERT INTO sec_geo_events (account_id, ip_masked, country, source, result) VALUES ($1, $2, $3, $4, $5)`,
    [accountId, masked, r.country, r.source, result]).catch(() => undefined);
  if (!abroad) return;
  const who = maskMail(st.email) ?? '?';
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ($1, $2, $3, $4::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
    [s.block ? 'STAFF_LOGIN_ABROAD_BLOCKED' : 'STAFF_LOGIN_ABROAD', s.block ? 'WARN' : 'CRITICAL',
     `${s.block ? '해외 운영 로그인 막음' : '운영자 해외 로그인'} — ${who}(${st.roles}) · ${r.country} · ${masked ?? 'IP 모름'}${r.source === 'ASSUME' ? ' · 간주 판별' : ''} — 위험감지 › 해외 접속 경고`.slice(0, 300),
     JSON.stringify({ accountId, email: who, roles: st.roles, country: r.country, ip: masked, source: r.source, blocked: s.block })]).catch(() => undefined);
  if (s.block) throw new Forbidden('GEO_BLOCKED', '허용하지 않은 나라에서의 운영 계정 로그인은 막혀 있습니다 — 최고 관리자에게 문의해 주십시오.');
}

/* ── 운영 화면(위험감지 › 해외 접속 경고 · SB-ADM-SCU-030) ─────────────── */
export async function geoView(db: DatabaseService) {
  const s = await geoSettings(db);
  const recent = await db.query<{ email: string }>(
    `SELECT e.id::text AS id, a.email::text AS email, e.ip_masked AS ip, e.country, e.source, e.result, e.at
       FROM sec_geo_events e JOIN accounts a ON a.id = e.account_id ORDER BY e.id DESC LIMIT 50`);
  const [c] = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE result = 'ALERT')::int AS alert, count(*) FILTER (WHERE result = 'BLOCKED')::int AS blocked,
            count(*) FILTER (WHERE result = 'UNKNOWN')::int AS unknown
       FROM sec_geo_events WHERE at > now() - interval '30 days'`);
  return {
    settings: s, ready: { mode: s.mode, keySet: GeoIpHttp.ready(), notReady: s.mode === 'LIVE' && !GeoIpHttp.ready(), base: process.env.GEOIP_API_BASE?.trim() ? '설정됨' : '기본(ipinfo 모양)' },
    days30: c, recent: recent.map((x) => ({ ...x, email: maskMail(x.email) })), canEdit: RequestCtx.get()?.actorRole === 'SUPER',
  };
}

export async function setGeoSettings(db: DatabaseService, d: { watch?: boolean; mode?: string; assumeCountry?: string; allow?: string; block?: boolean; reason: string }) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('GEO_REASON', '사유는 2 ~ 200자입니다.');
  const cur = await geoSettings(db);
  const set: Array<[string, string]> = [];
  const mode = d.mode !== undefined ? d.mode : cur.mode;
  if (d.mode !== undefined) {
    if (!['ASSUME', 'LIVE'].includes(d.mode)) throw new PolicyViolation('GEO_MODE', '방식은 ASSUME · LIVE 중 하나입니다.');
    if (d.mode === 'LIVE' && !GeoIpHttp.ready()) throw new PolicyViolation('GEO_NOT_READY', '나라 판별 키(GEOIP_API_KEY)가 없습니다 — 외부 연동 › 연동 키에 넣거나 간주(ASSUME)로 두십시오.');
    set.push(['security.geo_mode', d.mode]);
  }
  if (d.assumeCountry !== undefined) {
    const v = d.assumeCountry.trim().toUpperCase();
    if (!COUNTRY_RE.test(v)) throw new PolicyViolation('GEO_COUNTRY', '나라 코드는 영문 대문자 두 글자입니다(예 KR).');
    set.push(['security.geo_assume_country', v]);
  }
  if (d.allow !== undefined) {
    const v = [...new Set(d.allow.toUpperCase().split(/[\s,]+/).filter(Boolean))].join(',');
    if (!ALLOW_RE.test(v)) throw new PolicyViolation('GEO_ALLOW', '허용 나라는 쉼표로 나눈 두 글자 코드입니다(30개까지 · 예 KR,JP).');
    if (!v.split(',').includes('KR')) throw new PolicyViolation('GEO_ALLOW_KR', '허용 나라에 KR 은 꼭 들어가야 합니다(국내 로그인이 막히지 않게).');
    set.push(['security.geo_allow', v]);
  }
  const watch = d.watch !== undefined ? d.watch : cur.watch;
  if (d.watch !== undefined) set.push(['security.geo_watch', d.watch ? 'on' : 'off']);
  if (d.block !== undefined) {
    if (d.block && !watch) throw new PolicyViolation('GEO_BLOCK_NEEDS_WATCH', '막기는 해외 접속 경고를 켠 뒤에 켭니다.');
    set.push(['security.geo_block', d.block ? 'on' : 'off']);
  }
  if (!set.length) throw new PolicyViolation('GEO_NOTHING', '바꿀 것이 없습니다.');
  void mode;
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  resetGeoCache();
  return { ok: true, settings: await geoSettings(db), note: '해외 접속 경고 설정을 바꿨습니다(다른 서버 프로세스는 30초 안에 따라옴).' };
}

/** SUPER — IP 하나를 지금 방식으로 판별(기록 · 알림 없음 · LIVE 면 업체를 부름) */
export async function geoTest(db: DatabaseService, ip: string) {
  const v = String(ip ?? '').trim();
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(v)) throw new PolicyViolation('GEO_IP', 'IP 형식이 아닙니다.');
  const s = await geoSettings(db);
  const r = await lookupCountry(db, v, s);
  return { ip: maskIp(v), ...r, allowed: r.country ? s.allow.includes(r.country) : null, mode: s.mode };
}

/** 정기 작업 sec_daily_purge — 1년 지난 접속 나라 기록 · 30일 지난 캐시 · 하루 지난 패스키 확인 문제 */
export async function secDailyPurgeJob(db: DatabaseService) {
  const ev = await db.query(`DELETE FROM sec_geo_events WHERE at < now() - interval '366 days' RETURNING id`);
  const ca = await db.query(`DELETE FROM sec_geo_cache WHERE looked_at < now() - interval '30 days' RETURNING ip_hash`);
  const ch = await db.query(`DELETE FROM staff_passkey_challenges WHERE created_at < now() - interval '1 day' RETURNING id`);
  return { geoEvents: ev.length, geoCache: ca.length, passkeyChallenges: ch.length };
}
