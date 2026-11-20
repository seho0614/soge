import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { BlockList, isIP } from 'net';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.521 (D278 · docs/659) 파트너 오픈 API — 키 · 웹훅 · 설정(운영 화면 › 파트너사 › 오픈 API · SB-ADM-OAPI-010)
 *
 *   키 = sgbp_<앞 8자 소문자 · 숫자>_<비밀 32자 base64url> · DB 에는 앞머리(sgbp_xxxxxxxx)와 sha256 지문만
 *     원문은 발급 응답에 한 번만 실음 — 그래서 발급 API 에는 @Audit 을 달지 않고(응답 전체가 감사 기록에 남음) 서비스가 키 없이 직접 남김
 *   범위 = 읽기만 3종(leads:read · services:read · cash:read) · 키마다 1분 사용 한도 · 기한 꼭(1 ~ 730일 · 처음 365)
 *   웹훅 = 파트너마다 https 주소 하나 · 비밀값 whsec_<32자> 는 암호문(pgp_sym_encrypt · fn_enc_key)으로 · 원문은 만들 때 · 바꿀 때 한 번만
 *     주소 검사(서버 · DB 같은 정규식) + 서버는 localhost · 사설 · 예약 IP 주소를 받지 않음(보낼 때도 DNS 를 다시 봄 — hooks.ts)
 *   papi.enabled 처음 off · papi.hook_enabled 처음 off · papi.hook_mode 처음 ASSUME — 켜기는 SUPER(보안 검토 docs/659 6절 뒤)
 * ------------------------------------------------------------------- */

export const PAPI_SCOPES = ['leads:read', 'services:read', 'cash:read'] as const;
export const PAPI_EVENTS = ['lead.delivered', 'lead.state_changed'] as const;
/** 키 모양 — sgbp_ + 8 + _ + 32 */
export const PAPI_KEY_RE = /^sgbp_([a-z0-9]{8})_([A-Za-z0-9_-]{32})$/;
/** 웹훅 주소 — DB ptn_api_hooks.url CHECK 와 같음 */
export const HOOK_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?(\/[!-~]*)?$/;
const PREFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export interface PapiSettings { enabled: boolean; hookEnabled: boolean; hookMode: 'ASSUME' | 'LIVE'; defaultRate: number; logKeepDays: number }

export async function papiSettings(db: DatabaseService): Promise<PapiSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('papi.enabled', 'papi.hook_enabled', 'papi.hook_mode', 'papi.default_rate', 'papi.log_keep_days')`);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  const rate = Number(v('papi.default_rate') || 60);
  const keep = Number(v('papi.log_keep_days') || 90);
  return {
    enabled: v('papi.enabled') === 'on', hookEnabled: v('papi.hook_enabled') === 'on', hookMode: v('papi.hook_mode') === 'LIVE' ? 'LIVE' : 'ASSUME',
    defaultRate: Number.isInteger(rate) && rate >= 1 && rate <= 600 ? rate : 60,
    logKeepDays: Number.isInteger(keep) && keep >= 30 && keep <= 365 ? keep : 90,
  };
}

export const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');
/** 지문 비교 — 길이가 같은 hex 둘을 고정 시간으로 */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
function randomPrefix(): string {
  const b = randomBytes(8);
  return Array.from(b, (x) => PREFIX_CHARS[x % PREFIX_CHARS.length]).join('');
}
/** 새 키 원문 · 앞머리 · 지문 */
export function newKey() {
  const prefix = 'sgbp_' + randomPrefix();
  const key = `${prefix}_${randomBytes(24).toString('base64url')}`;
  return { key, prefix, hash: keyHash(key) };
}
export const newHookSecret = () => 'whsec_' + randomBytes(24).toString('base64url');

/* 막을 주소 범위(v10.521 보안 검토 A-2 · docs/659 6절) — IPv4 사설 · 예약 · 문서용 · 여러 곳 보내기 · IPv6 고유 로컬 · 링크 로컬 · 옛 사이트 로컬 · NAT64 · 6to4 · Teredo */
const V4_BLOCK = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['192.0.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) V4_BLOCK.addSubnet(net, bits, 'ipv4');
const V6_BLOCK = new BlockList();
for (const [net, bits] of [['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16],
  ['2001::', 32], ['2001:db8::', 32], ['100::', 64], ['::ffff:0:0:0', 96]] as const) V6_BLOCK.addSubnet(net, bits, 'ipv6');

/** IPv6 글자 → 16비트 낱말 8개(끝이 점 네 개 IPv4 꼴이어도) · 틀리면 null */
function v6Words(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  const m = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) {
    if (isIP(m[2]!) !== 4) return null;
    const p = m[2]!.split('.').map(Number) as [number, number, number, number];
    s = `${m[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const h0 = halves[0] ?? '', h1 = halves[1] ?? '';
  const head = h0 ? h0.split(':') : [];
  const tail = halves.length === 2 && h1 ? h1.split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const words = [...head, ...Array<string>(fill).fill('0'), ...tail].map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return words.length === 8 && words.every((w) => Number.isInteger(w)) ? words : null;
}

/** 사설 · 예약 · 자기 자신 주소인가(IP 글자일 때) — SSRF 막기 · IPv4 를 품은 IPv6(::ffff:x.x.x.x · ::x.x.x.x)는 IPv4 범위로 다시 봄 */
export function privateIp(ip: string): boolean {
  const v = String(ip ?? '').trim().replace(/^\[|\]$/g, '');
  if (isIP(v) === 4) return V4_BLOCK.check(v, 'ipv4');
  if (isIP(v) === 6) {
    const w = v6Words(v);
    if (!w) return true;   // 풀 수 없는 꼴이면 막음
    const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return V4_BLOCK.check(v4of(w[6]!, w[7]!), 'ipv4');   // ::ffff:a.b.c.d · ::a.b.c.d(:: · ::1 도 0.0.0.x 로 막힘)
    return V6_BLOCK.check(w.map((x) => x.toString(16)).join(':'), 'ipv6');
  }
  return false;
}
/** 웹훅 주소 검사 — 모양(DB 와 같은 정규식) · 호스트가 localhost · 사설 IP 글자 · 점 없는 이름이 아님 */
export function checkHookUrl(raw: string): { url: string; host: string } {
  const url = String(raw ?? '').trim();
  if (!HOOK_URL_RE.test(url) || url.length > 300) throw new PolicyViolation('PAPI_HOOK_URL', '웹훅 주소는 https:// 로 시작하는 300자 안 주소입니다.');
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') || privateIp(host)) {
    throw new PolicyViolation('PAPI_HOOK_URL', '내부망 · 사설 주소로는 웹훅을 보내지 않습니다 — 인터넷에서 열리는 파트너 주소를 넣으십시오.');
  }
  return { url, host };
}

const reasonOf = (r: unknown, code: string) => {
  const s = String(r ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return s;
};
const idOf = (id: string) => {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 번호입니다.');
  return String(id);
};
const partnerIdOf = (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) throw new PolicyViolation('PAPI_PARTNER', '파트너를 고르십시오.');
  return String(id);
};
function scopesOf(list: unknown): string[] {
  const arr = Array.isArray(list) ? [...new Set(list.map(String))] : [];
  if (!arr.length || arr.some((x) => !(PAPI_SCOPES as readonly string[]).includes(x))) {
    throw new PolicyViolation('PAPI_SCOPE', '범위는 leads:read · services:read · cash:read 중에서 하나 이상입니다.');
  }
  return arr;
}
function eventsOf(list: unknown): string[] {
  const arr = Array.isArray(list) ? [...new Set(list.map(String))] : [];
  if (!arr.length || arr.some((x) => !(PAPI_EVENTS as readonly string[]).includes(x))) {
    throw new PolicyViolation('PAPI_HOOK_EVENTS', '받을 일은 lead.delivered · lead.state_changed 중에서 하나 이상입니다.');
  }
  return arr;
}

/** 감사 기록 — 서비스가 직접(키 · 비밀값 원문을 남기지 않으려고) */
export function papiAudit(db: DatabaseService, action: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, after_data, ip, user_agent) VALUES ($1, $2, $3, 'PARTNER', $4::jsonb, $5, $6)`,
    [c?.actorId ?? null, c?.actorRole ?? null, action, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}

/* ── 운영 화면 한눈에 ─────────────────────────────────────────────── */
export async function papiOverview(db: DatabaseService) {
  const settings = await papiSettings(db);
  const keys = await db.query(
    `SELECT k.id::text AS id, k.partner_id AS "partnerId", b.company_name AS company, k.name, k.key_prefix AS prefix, k.scopes, k.rate_per_min AS "ratePerMin",
            k.status, k.expires_at AS "expiresAt", (k.status = 'ACTIVE' AND k.expires_at <= now()) AS expired, k.last_used_at AS "lastUsedAt",
            k.created_at AS "createdAt", k.revoked_at AS "revokedAt", k.revoke_reason AS "revokeReason",
            (SELECT count(*)::int FROM ptn_api_requests r WHERE r.key_id = k.id AND r.at > now() - interval '24 hours') AS "calls24h",
            (SELECT count(*)::int FROM ptn_api_requests r WHERE r.key_id = k.id AND r.at > now() - interval '24 hours' AND r.status >= 400) AS "errors24h"
       FROM ptn_api_keys k JOIN partners p ON p.id = k.partner_id JOIN businesses b ON b.id = p.business_id
      ORDER BY (k.status = 'ACTIVE') DESC, k.created_at DESC LIMIT 200`);
  const hooks = await db.query(
    `SELECT h.id::text AS id, h.partner_id AS "partnerId", b.company_name AS company, h.url, h.events, h.secret_last4 AS "secretLast4", h.status,
            h.fail_streak AS "failStreak", h.created_at AS "createdAt", h.rotated_at AS "rotatedAt", h.disabled_at AS "disabledAt", h.disabled_reason AS "disabledReason",
            (SELECT count(*)::int FROM ptn_api_hook_events e WHERE e.hook_id = h.id AND e.state IN ('PENDING', 'FAILED')) AS waiting,
            (SELECT count(*)::int FROM ptn_api_hook_events e WHERE e.hook_id = h.id AND e.state = 'GIVEUP') AS giveup
       FROM ptn_api_hooks h JOIN partners p ON p.id = h.partner_id JOIN businesses b ON b.id = p.business_id
      ORDER BY (h.status = 'ACTIVE') DESC, h.created_at DESC LIMIT 100`);
  const partners = await db.query(
    `SELECT p.id, b.company_name AS company, p.grade FROM partners p JOIN businesses b ON b.id = p.business_id
      WHERE p.status = 'ACTIVE' ORDER BY b.company_name LIMIT 500`);
  const [day] = await db.query<{ calls: number; denied: number; invalid: number }>(
    `SELECT count(*)::int AS calls, count(*) FILTER (WHERE status IN (401, 403, 429))::int AS denied, count(*) FILTER (WHERE reason = 'PAPI_KEY_INVALID')::int AS invalid
       FROM ptn_api_requests WHERE at > now() - interval '24 hours'`);
  return {
    settings, keys, hooks, partners, day,
    canIssue: RequestCtx.get()?.actorRole === 'SUPER',
    scopes: PAPI_SCOPES, events: PAPI_EVENTS,
    note: settings.enabled ? null : '오픈 API 가 꺼져 있습니다(처음) — 키를 발급해도 파트너 호출은 503 PAPI_OFF 입니다. 보안 검토(docs/659 6절) 뒤 최고 관리자가 켭니다.',
  };
}

/* ── 키 ───────────────────────────────────────────────────────────── */
export async function issueKey(db: DatabaseService, d: { partnerId: string; name: string; scopes: string[]; ratePerMin?: number; days?: number }, actor: string | null) {
  const partnerId = partnerIdOf(d.partnerId);
  const name = String(d.name ?? '').trim();
  if (name.length < 2 || name.length > 60) throw new PolicyViolation('PAPI_NAME', '키 이름은 2 ~ 60자입니다(예: 상담 연동 서버).');
  const scopes = scopesOf(d.scopes);
  const s = await papiSettings(db);
  const rate = d.ratePerMin ?? s.defaultRate;
  if (!Number.isInteger(rate) || rate < 1 || rate > 600) throw new PolicyViolation('PAPI_RATE', '1분 사용 한도는 1 ~ 600 입니다.');
  const days = d.days ?? 365;
  if (!Number.isInteger(days) || days < 1 || days > 730) throw new PolicyViolation('PAPI_DAYS', '키 기한은 1 ~ 730일입니다.');
  const [p] = await db.query<{ status: string; company: string }>(
    `SELECT p.status, b.company_name AS company FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1`, [partnerId]);
  if (!p) throw new NotFound('없는 파트너입니다.');
  if (p.status !== 'ACTIVE') throw new StateConflict('PAPI_PARTNER_INACTIVE', '활동 중(ACTIVE)인 파트너에게만 API 키를 발급합니다.');
  const k = newKey();
  const [row] = await db.query<{ id: string; expiresAt: string }>(
    `INSERT INTO ptn_api_keys (partner_id, name, key_prefix, key_hash, scopes, rate_per_min, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5::text[], $6::int, now() + make_interval(days => $7::int), $8)
     RETURNING id::text AS id, expires_at AS "expiresAt"`, [partnerId, name, k.prefix, k.hash, scopes, rate, days, actor]);
  await papiAudit(db, 'PAPI_KEY_ISSUE', { keyId: row.id, partnerId, company: p.company, prefix: k.prefix, scopes, ratePerMin: rate, days });
  return {
    ok: true, id: row.id, prefix: k.prefix, key: k.key, expiresAt: row.expiresAt, scopes, ratePerMin: rate,
    note: '키를 발급했습니다 — 원문은 지금 한 번만 보입니다. 파트너 담당자에게 안전한 길(대면 · 암호 걸린 파일)로 전하십시오.',
  };
}

export async function updateKey(db: DatabaseService, id: string, d: { name?: string; scopes?: string[]; ratePerMin?: number }) {
  const kid = idOf(id);
  const [cur] = await db.query<{ status: string }>(`SELECT status FROM ptn_api_keys WHERE id = $1::bigint`, [kid]);
  if (!cur) throw new NotFound('없는 키입니다.');
  if (cur.status !== 'ACTIVE') throw new StateConflict('PAPI_KEY_STATE', '거둔 키는 고칠 수 없습니다 — 새 키를 발급하십시오.');
  const name = d.name === undefined ? null : String(d.name).trim();
  if (name !== null && (name.length < 2 || name.length > 60)) throw new PolicyViolation('PAPI_NAME', '키 이름은 2 ~ 60자입니다(예: 상담 연동 서버).');
  const scopes = d.scopes === undefined ? null : scopesOf(d.scopes);
  const rate = d.ratePerMin === undefined ? null : d.ratePerMin;
  if (rate !== null && (!Number.isInteger(rate) || rate < 1 || rate > 600)) throw new PolicyViolation('PAPI_RATE', '1분 사용 한도는 1 ~ 600 입니다.');
  if (name === null && scopes === null && rate === null) throw new PolicyViolation('PAPI_NOTHING', '바꿀 것이 없습니다.');
  await db.query(
    `UPDATE ptn_api_keys SET name = coalesce($2, name), scopes = coalesce($3::text[], scopes), rate_per_min = coalesce($4::int, rate_per_min), updated_at = now()
      WHERE id = $1::bigint`, [kid, name, scopes, rate]);
  await papiAudit(db, 'PAPI_KEY_EDIT', { keyId: kid, name, scopes, ratePerMin: rate });
  return { ok: true, id: kid, note: '키를 고쳤습니다 — 1분 안에 호출에 반영됩니다.' };
}

export async function revokeKey(db: DatabaseService, id: string, reason: string, actor: string | null) {
  const kid = idOf(id);
  const why = reasonOf(reason, 'PAPI_REASON');
  const rows = await db.query<{ prefix: string }>(
    `UPDATE ptn_api_keys SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoke_reason = $3, updated_at = now()
      WHERE id = $1::bigint AND status = 'ACTIVE' RETURNING key_prefix AS prefix`, [kid, actor, why]);
  if (!rows.length) {
    const [x] = await db.query(`SELECT 1 FROM ptn_api_keys WHERE id = $1::bigint`, [kid]);
    if (!x) throw new NotFound('없는 키입니다.');
    throw new StateConflict('PAPI_KEY_STATE', '이미 거둔 키입니다.');
  }
  await papiAudit(db, 'PAPI_KEY_REVOKE', { keyId: kid, prefix: rows[0].prefix, reason: why });
  return { ok: true, id: kid, note: '키를 거뒀습니다 — 1분 안에 그 키의 호출이 401 PAPI_KEY_REVOKED 로 막힙니다.' };
}

export async function papiRequests(db: DatabaseService, q: { keyId?: string; failed?: boolean }) {
  const kid = q.keyId ? idOf(q.keyId) : null;
  return db.query(
    `SELECT r.id::text AS id, r.key_id::text AS "keyId", k.key_prefix AS prefix, r.method, r.path, r.status, r.ms, r.reason, r.ip_key AS "ipKey", r.at
       FROM ptn_api_requests r LEFT JOIN ptn_api_keys k ON k.id = r.key_id
      WHERE ($1::bigint IS NULL OR r.key_id = $1::bigint) AND (NOT $2::boolean OR r.status >= 400)
      ORDER BY r.id DESC LIMIT 200`, [kid, !!q.failed]);
}

/* ── 웹훅 ─────────────────────────────────────────────────────────── */
export async function createHook(db: DatabaseService, d: { partnerId: string; url: string; events: string[] }, actor: string | null) {
  const partnerId = partnerIdOf(d.partnerId);
  const { url, host } = checkHookUrl(d.url);
  const events = eventsOf(d.events);
  const [p] = await db.query<{ status: string }>(`SELECT status FROM partners WHERE id = $1`, [partnerId]);
  if (!p) throw new NotFound('없는 파트너입니다.');
  if (p.status !== 'ACTIVE') throw new StateConflict('PAPI_PARTNER_INACTIVE', '활동 중(ACTIVE)인 파트너만 웹훅을 받습니다.');
  const [dup] = await db.query(`SELECT 1 FROM ptn_api_hooks WHERE partner_id = $1 AND status = 'ACTIVE'`, [partnerId]);
  if (dup) throw new StateConflict('PAPI_HOOK_EXISTS', '이 파트너에는 살아 있는 웹훅이 있습니다 — 먼저 끄고 새로 만드십시오.');
  const secret = newHookSecret();
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO ptn_api_hooks (partner_id, url, events, secret_enc, secret_last4, created_by)
     VALUES ($1, $2, $3::text[], pgp_sym_encrypt($4, public.fn_enc_key()), right($4, 4), $5) RETURNING id::text AS id`,
    [partnerId, url, events, secret, actor]);
  await papiAudit(db, 'PAPI_HOOK_CREATE', { hookId: row.id, partnerId, host, events });
  return { ok: true, id: row.id, secret, note: '웹훅을 만들었습니다 — 서명 비밀값은 지금 한 번만 보입니다. 파트너가 X-Sgb-Signature 를 이 값으로 확인합니다.' };
}

export async function rotateHookSecret(db: DatabaseService, id: string) {
  const hid = idOf(id);
  const secret = newHookSecret();
  const rows = await db.query<{ id: string }>(
    `UPDATE ptn_api_hooks SET secret_enc = pgp_sym_encrypt($2, public.fn_enc_key()), secret_last4 = right($2, 4), rotated_at = now()
      WHERE id = $1::bigint AND status = 'ACTIVE' RETURNING id::text AS id`, [hid, secret]);
  if (!rows.length) throw new StateConflict('PAPI_HOOK_STATE', '살아 있는 웹훅이 아닙니다.');
  await papiAudit(db, 'PAPI_HOOK_ROTATE', { hookId: hid });
  return { ok: true, id: hid, secret, note: '서명 비밀값을 바꿨습니다 — 새 값은 지금 한 번만 보입니다. 이 뒤로 보내는 웹훅은 새 값으로 서명합니다.' };
}

export async function disableHook(db: DatabaseService, id: string, reason: string, actor: string | null) {
  const hid = idOf(id);
  const why = reasonOf(reason, 'PAPI_REASON');
  const rows = await db.query<{ id: string }>(
    `UPDATE ptn_api_hooks SET status = 'DISABLED', disabled_at = now(), disabled_by = $2, disabled_reason = $3
      WHERE id = $1::bigint AND status = 'ACTIVE' RETURNING id::text AS id`, [hid, actor, why]);
  if (!rows.length) throw new StateConflict('PAPI_HOOK_STATE', '살아 있는 웹훅이 아닙니다.');
  await db.query(`UPDATE ptn_api_hook_events SET state = 'CANCELED', last_error = '웹훅을 끔' WHERE hook_id = $1::bigint AND state IN ('PENDING', 'FAILED')`, [hid]);
  await papiAudit(db, 'PAPI_HOOK_DISABLE', { hookId: hid, reason: why });
  return { ok: true, id: hid, note: '웹훅을 껐습니다 — 보내지 않은 줄은 취소했습니다.' };
}

export async function testHook(db: DatabaseService, id: string) {
  const hid = idOf(id);
  const [h] = await db.query<{ partnerId: string }>(`SELECT partner_id AS "partnerId" FROM ptn_api_hooks WHERE id = $1::bigint AND status = 'ACTIVE'`, [hid]);
  if (!h) throw new StateConflict('PAPI_HOOK_STATE', '살아 있는 웹훅이 아닙니다.');
  const [row] = await db.query<{ id: string; uid: string }>(
    `INSERT INTO ptn_api_hook_events (hook_id, partner_id, event, payload)
     VALUES ($1::bigint, $2, 'ping', jsonb_build_object('ping', true, 'at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
     RETURNING id::text AS id, event_uid::text AS uid`, [hid, h.partnerId]);
  return { ok: true, id: row.id, eventUid: row.uid, note: '시험(ping) 줄을 만들었습니다 — 웹훅 보내기가 켜져 있으면 1분 안에 보냅니다.' };
}

export async function hookEvents(db: DatabaseService, id: string) {
  const hid = idOf(id);
  const [h] = await db.query(`SELECT 1 FROM ptn_api_hooks WHERE id = $1::bigint`, [hid]);
  if (!h) throw new NotFound('없는 웹훅입니다.');
  return db.query(
    `SELECT id::text AS id, event, event_uid::text AS "eventUid", payload, state, attempts, next_at AS "nextAt", last_status AS "lastStatus",
            last_error AS "lastError", sent_at AS "sentAt", created_at AS "createdAt"
       FROM ptn_api_hook_events WHERE hook_id = $1::bigint ORDER BY id DESC LIMIT 100`, [hid]);
}

export async function retryEvent(db: DatabaseService, id: string) {
  const eid = idOf(id);
  const rows = await db.query<{ id: string }>(
    `UPDATE ptn_api_hook_events e SET state = 'PENDING', attempts = 0, next_at = now(), last_error = NULL
       FROM ptn_api_hooks h WHERE e.id = $1::bigint AND h.id = e.hook_id AND h.status = 'ACTIVE' AND e.state IN ('FAILED', 'GIVEUP')
     RETURNING e.id::text AS id`, [eid]);
  if (!rows.length) throw new StateConflict('PAPI_EVENT_STATE', '다시 보낼 수 있는 줄이 아닙니다(실패 · 포기 줄 · 살아 있는 웹훅만).');
  return { ok: true, id: eid, note: '다시 보낼 줄에 넣었습니다.' };
}

export async function setPapiSettings(db: DatabaseService, d: { enabled?: boolean; hookEnabled?: boolean; hookMode?: string; defaultRate?: number; logKeepDays?: number; reason: string }) {
  const reason = reasonOf(d.reason, 'PAPI_REASON');
  const set: Array<[string, string]> = [];
  if (d.enabled !== undefined) set.push(['papi.enabled', d.enabled ? 'on' : 'off']);
  if (d.hookEnabled !== undefined) set.push(['papi.hook_enabled', d.hookEnabled ? 'on' : 'off']);
  if (d.hookMode !== undefined) {
    if (!['ASSUME', 'LIVE'].includes(d.hookMode)) throw new PolicyViolation('PAPI_MODE', '방식은 ASSUME · LIVE 중 하나입니다.');
    set.push(['papi.hook_mode', d.hookMode]);
  }
  if (d.defaultRate !== undefined) {
    if (!Number.isInteger(d.defaultRate) || d.defaultRate < 1 || d.defaultRate > 600) throw new PolicyViolation('PAPI_RATE', '1분 사용 한도는 1 ~ 600 입니다.');
    set.push(['papi.default_rate', String(d.defaultRate)]);
  }
  if (d.logKeepDays !== undefined) {
    if (!Number.isInteger(d.logKeepDays) || d.logKeepDays < 30 || d.logKeepDays > 365) throw new PolicyViolation('PAPI_KEEP', '요청 기록 보관은 30 ~ 365일입니다.');
    set.push(['papi.log_keep_days', String(d.logKeepDays)]);
  }
  if (!set.length) throw new PolicyViolation('PAPI_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await papiSettings(db), note: '오픈 API 설정을 바꿨습니다 — 1분 안에 반영됩니다.' };
}
