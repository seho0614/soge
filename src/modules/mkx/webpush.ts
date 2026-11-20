import { createCipheriv, createECDH, createHash, createPrivateKey, hkdfSync, randomBytes, sign } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { maskName } from '../../common/mask';
import { AUTH_RE, P256DH_RE, PUSH_ENDPOINT_RE, VAPID_SUBJECT_RE, intIn, isOn, mkxAlert, mkxAudit, nightKst, readSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.538 (D283 · docs/676) ① 웹 푸시 알림 — D272 서비스 워커(site/public/sw.js) 위
 *
 *   어댑터  WebPushHttp — Web Push 표준(RFC 8030 보내기 · RFC 8291 aes128gcm 암호화 · RFC 8292 VAPID) · 새 npm 없이 node crypto 만
 *           키는 외부 연동 WEBPUSH(운영 화면 › 외부 연동 › 연동 키 — IntegrationSecretService 가 process.env 에 얹음)
 *             WEBPUSH_VAPID_PUBLIC(65바이트 base64url) · WEBPUSH_VAPID_PRIVATE(32바이트) · 보낸 곳 push.vapid_subject(mailto:)
 *           키 · 연락처가 없으면 NOT_READY · push.send_mode ASSUME(처음)이면 밖으로 부르지 않고 「간주」로만 기록(점검판)
 *   구독    회원이 브라우저마다(나의공간 › 웹 푸시) · 받는 주소는 알려진 푸시 서비스만(DB CHECK 와 같은 정규식 — 다른 서버로 요청을 보내게 하지 않음)
 *   보내기  정기 작업 mkx_push_send(1분 · push.send on) — 12시간 안 읽지 않은 회원 알림 · 기기마다 한 번 · 회원 하루 push.daily_max ·
 *           밤 21 ~ 8시(push.quiet on)에는 급한 알림(quiet_hours_exempt)만 · 404 · 410 이면 구독 GONE · 실패 5번이면 GONE
 *   글      제목 80자 · 내용 180자 · 주소(우리 사이트 안 경로만) — 회원 이름 · 연락처는 넣지 않음(알림 글 그대로)
 * ------------------------------------------------------------------- */

export type PushMode = 'ASSUME' | 'LIVE';
export type PushErrorKind = 'NOT_READY' | 'GONE' | 'TOO_BIG' | 'AUTH' | 'REJECTED' | 'TEMP' | 'TIMEOUT' | 'NETWORK';
export interface PushResult { ok: boolean; status?: number; kind?: PushErrorKind; error?: string }
export interface PushSubKey { endpoint: string; p256dh: string; auth: string }
export interface PushPayload { title: string; body: string; url: string; tag?: string }
export type PushFetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer; signal: AbortSignal }) => Promise<{ status: number; text: () => Promise<string> }>;

const MAX_FAILS = 5;
const TEST_DAY_MAX = 5;
const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');
export const endpointHash = (e: string) => createHash('sha256').update(e).digest('hex');
/** 구독을 만든 VAPID 공개 키 표시(끝 8자) — 키를 바꾸면 옛 구독은 GONE(KEY_CHANGED) */
export const keyTag = (pub: string) => pub.slice(-8);

/** VAPID 키 한 쌍(P-256) — 공개 키는 압축 안 한 점 65바이트 · 비밀 키 32바이트(앞 0 채움) */
export function makeVapidKeys(): { publicKey: string; privateKey: string } {
  const e = createECDH('prime256v1');
  e.generateKeys();
  let d = e.getPrivateKey();
  if (d.length < 32) d = Buffer.concat([Buffer.alloc(32 - d.length), d]);
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(d) };
}

/** VAPID 머리글(RFC 8292) — ES256 JWT(aud = 받는 주소의 origin · 12시간) */
export function vapidHeader(endpoint: string, pub: string, priv: string, subject: string, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const P = unb64u(pub);
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(P.subarray(1, 33)), y: b64u(P.subarray(33, 65)) }, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${pub}`;
}

/** 글 암호화(RFC 8291 · aes128gcm · 레코드 하나) — 머리(salt 16 · rs 4 · idlen 1 · 보낸 쪽 공개 키 65) + 암호문 */
export function encryptPush(sub: { p256dh: string; auth: string }, plain: Buffer): Buffer {
  const uaPub = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const salt = randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\u0000', 'utf8'), uaPub, asPub]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\u0000', 'utf8'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\u0000', 'utf8'), 12));
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

/** 보낼 글 — 제목 80 · 내용 180자 · 주소는 우리 사이트 안 경로만(아니면 나의공간 › 알림) */
export function pushPayload(n: { title: string | null; body: string; linkUrl: string | null; tag?: string }): PushPayload {
  const url = n.linkUrl && n.linkUrl.startsWith('/') && !n.linkUrl.startsWith('//') ? n.linkUrl.slice(0, 300) : '/my/notifications';
  const one = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
  return { title: one(n.title ?? '', 80) || '소개뱅크 알림', body: one(n.body ?? '', 180), url, tag: n.tag };
}

export class WebPushHttp {
  constructor(private readonly fetchFn?: PushFetch) {}
  static missing(subject: string): string[] {
    return [...(process.env.WEBPUSH_VAPID_PUBLIC?.trim() ? [] : ['WEBPUSH_VAPID_PUBLIC']), ...(process.env.WEBPUSH_VAPID_PRIVATE?.trim() ? [] : ['WEBPUSH_VAPID_PRIVATE']),
      ...(VAPID_SUBJECT_RE.test(subject) ? [] : ['push.vapid_subject'])];
  }
  async send(sub: PushSubKey, payload: PushPayload, subject: string): Promise<PushResult> {
    const miss = WebPushHttp.missing(subject);
    if (miss.length) return { ok: false, kind: 'NOT_READY', error: `빠진 설정 ${miss.join(',')}` };
    if (!PUSH_ENDPOINT_RE.test(sub.endpoint)) return { ok: false, kind: 'REJECTED', error: '받는 주소가 알려진 푸시 서비스가 아님' };
    const pub = process.env.WEBPUSH_VAPID_PUBLIC!.trim(), priv = process.env.WEBPUSH_VAPID_PRIVATE!.trim();
    let body: Buffer, auth: string;
    try {
      body = encryptPush(sub, Buffer.from(JSON.stringify(payload), 'utf8'));
      auth = vapidHeader(sub.endpoint, pub, priv, subject);
    } catch (e) {
      return { ok: false, kind: 'AUTH', error: `키 · 구독 암호 오류 ${String((e as Error)?.message ?? e).slice(0, 80)}` };
    }
    const timeout = Math.min(Math.max(Number(process.env.WEBPUSH_TIMEOUT_MS) || 8000, 1000), 30000);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const f: PushFetch = this.fetchFn ?? (globalThis.fetch as unknown as PushFetch);
      const res = await f(sub.endpoint, {
        method: 'POST', signal: ac.signal, body,
        headers: { Authorization: auth, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
      });
      const st = res.status;
      if (st >= 200 && st < 300) return { ok: true, status: st };
      const text = (await res.text().catch(() => '')).slice(0, 100);
      if (st === 404 || st === 410) return { ok: false, status: st, kind: 'GONE', error: `${st} ${text}` };
      if (st === 413) return { ok: false, status: st, kind: 'TOO_BIG', error: `${st} ${text}` };
      if (st === 401 || st === 403) return { ok: false, status: st, kind: 'AUTH', error: `${st} ${text}` };
      if (st === 429 || st >= 500) return { ok: false, status: st, kind: 'TEMP', error: `${st} ${text}` };
      return { ok: false, status: st, kind: 'REJECTED', error: `${st} ${text}` };
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      return { ok: false, kind: aborted ? 'TIMEOUT' : 'NETWORK', error: aborted ? `${timeout}ms 안에 응답 없음` : String((e as Error)?.message ?? e).slice(0, 100) };
    } finally { clearTimeout(timer); }
  }
}

/* ── 설정 · 준비 ─────────────────────────────────────────────────── */
const PUSH_KEYS = ['push.enabled', 'push.send', 'push.send_mode', 'push.vapid_subject', 'push.daily_max', 'push.quiet', 'site.pwa'];
export interface PushSettings { enabled: boolean; send: boolean; mode: PushMode; subject: string; dailyMax: number; quiet: boolean; pwa: boolean }
export async function pushSettings(db: DatabaseService): Promise<PushSettings> {
  const s = await readSettings(db, PUSH_KEYS);
  return { enabled: isOn(s['push.enabled']), send: isOn(s['push.send']), mode: s['push.send_mode'] === 'LIVE' ? 'LIVE' : 'ASSUME', subject: s['push.vapid_subject'],
    dailyMax: intIn(s['push.daily_max'], 1, 100, 20), quiet: s['push.quiet'] !== 'off', pwa: isOn(s['site.pwa']) };
}
const publicKey = () => process.env.WEBPUSH_VAPID_PUBLIC?.trim() || '';

/** 한 통 — ASSUME 은 부르지 않음 */
async function deliver(mode: PushMode, sub: PushSubKey, payload: PushPayload, subject: string, http: WebPushHttp): Promise<PushResult> {
  if (mode === 'ASSUME') return { ok: true, status: 0 };
  return http.send(sub, payload, subject);
}

/** 결과 반영 — 보낸 기록 한 줄 · 구독 상태(GONE · 실패 수) */
async function record(db: DatabaseService, mode: PushMode, row: { subId: string; accountId: string; notificationId: string | null }, r: PushResult) {
  const state = r.ok ? (mode === 'LIVE' ? 'SENT' : 'ASSUMED') : r.kind === 'GONE' ? 'GONE' : 'FAILED';
  await db.query(
    `INSERT INTO mkx_push_sends (sub_id, account_id, notification_id, test, state, reason, http_status, error) VALUES ($1::bigint, $2, $3::bigint, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [row.subId, row.accountId, row.notificationId, row.notificationId == null, state, r.ok ? null : r.kind ?? 'ERROR', r.status ?? null, r.ok ? null : (r.error ?? '').slice(0, 200)]);
  if (r.ok) {
    if (mode === 'LIVE') await db.query(`UPDATE mkx_push_subs SET last_ok_at = now(), fail_count = 0 WHERE id = $1::bigint`, [row.subId]);
  } else if (r.kind === 'GONE') {
    await db.query(`UPDATE mkx_push_subs SET state = 'GONE', gone_reason = $2 WHERE id = $1::bigint AND state = 'ACTIVE'`, [row.subId, `HTTP_${r.status ?? 410}`]);
  } else if (r.kind !== 'NOT_READY') {
    await db.query(
      `UPDATE mkx_push_subs SET fail_count = least(fail_count + 1, 100), last_fail_at = now(),
              state = CASE WHEN fail_count + 1 >= $2::int THEN 'GONE' ELSE state END,
              gone_reason = CASE WHEN fail_count + 1 >= $2::int THEN 'FAILS' ELSE gone_reason END
        WHERE id = $1::bigint AND state = 'ACTIVE'`, [row.subId, MAX_FAILS]);
  }
  return state;
}

/* ── 회원(나의공간 › 웹 푸시) ─────────────────────────────────────── */
export async function myPush(db: DatabaseService, me: string) {
  const s = await pushSettings(db);
  const pub = publicKey();
  const subs = await db.query(
    `SELECT id::text AS id, ua_hint AS ua, state, created_at AS "createdAt", last_ok_at AS "lastOkAt", gone_reason AS "goneReason"
       FROM mkx_push_subs WHERE account_id = $1 AND state <> 'OFF' ORDER BY id DESC LIMIT 20`, [me]);
  return { enabled: s.enabled, pwa: s.pwa, sending: s.send, mode: s.mode, publicKey: s.enabled && pub ? pub : null, subs,
    note: !s.enabled ? '웹 푸시는 아직 준비 중입니다.' : !pub ? '웹 푸시 키가 아직 없습니다 — 준비되면 켤 수 있습니다.'
      : '이 브라우저에서 켜면 소개뱅크 알림이 화면 밖으로도 옵니다(알림 설정에서 끈 종류는 오지 않음 · 밤 21시 ~ 8시에는 급한 것만).' };
}

export async function pushSubscribe(db: DatabaseService, me: string, d: { endpoint: string; p256dh: string; auth: string; ua?: string }) {
  const s = await pushSettings(db);
  if (!s.enabled) throw new PolicyViolation('MKX_PUSH_OFF', '웹 푸시는 아직 켤 수 없습니다(push.enabled).');
  const pub = publicKey();
  if (!pub) throw new PolicyViolation('MKX_PUSH_NO_KEY', '웹 푸시 키가 아직 없습니다 — 준비되면 다시 켜 주십시오.');
  const endpoint = String(d.endpoint ?? '').trim();
  if (endpoint.length > 1000 || !PUSH_ENDPOINT_RE.test(endpoint)) throw new PolicyViolation('MKX_PUSH_ENDPOINT', '이 브라우저의 푸시 주소를 받을 수 없습니다 — 크롬 · 엣지 · 파이어폭스 · 사파리에서 켜 주십시오.');
  if (!P256DH_RE.test(d.p256dh ?? '') || !AUTH_RE.test(d.auth ?? '')) throw new PolicyViolation('MKX_PUSH_KEYS', '이 브라우저의 푸시 암호 키가 맞지 않습니다 — 다시 켜 주십시오.');
  const ua = String(d.ua ?? '').replace(/[^\p{L}\p{N} ._()/-]/gu, '').trim().slice(0, 40) || null;
  const h = endpointHash(endpoint);
  return db.transaction(async () => {
    const [old] = await db.query<{ id: string; accountId: string }>(`SELECT id::text AS id, account_id AS "accountId" FROM mkx_push_subs WHERE endpoint_hash = $1 FOR UPDATE`, [h]);
    if (old && old.accountId !== me) {
      /* 같은 브라우저에서 다른 회원이 켬 — 앞 회원 줄은 지우고(보낸 기록 함께) 새로 넣음: 앞 회원 알림이 이 회원 화면에 뜨지 않게 */
      await db.query(`DELETE FROM mkx_push_subs WHERE id = $1::bigint`, [old.id]);
    }
    const [r] = old && old.accountId === me
      ? await db.query<{ id: string }>(
          `UPDATE mkx_push_subs SET state = 'ACTIVE', fail_count = 0, p256dh = $2, auth = $3, key_tag = $4, ua_hint = coalesce($5, ua_hint), endpoint = $6
            WHERE id = $1::bigint RETURNING id::text AS id`, [old.id, d.p256dh, d.auth, keyTag(pub), ua, endpoint])
      : await db.query<{ id: string }>(
          `INSERT INTO mkx_push_subs (account_id, endpoint, endpoint_hash, p256dh, auth, key_tag, ua_hint) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
          [me, endpoint, h, d.p256dh, d.auth, keyTag(pub), ua]);
    return { ok: true, id: r.id, note: '이 브라우저에서 웹 푸시를 켰습니다.' };
  });
}

export async function pushUnsubscribe(db: DatabaseService, me: string, endpoint: string) {
  const h = endpointHash(String(endpoint ?? '').trim());
  const rows = await db.query(`UPDATE mkx_push_subs SET state = 'OFF' WHERE endpoint_hash = $1 AND account_id = $2 AND state <> 'OFF' RETURNING id`, [h, me]);
  return { ok: true, off: rows.length, note: rows.length ? '이 브라우저의 웹 푸시를 껐습니다.' : '이 브라우저는 켜져 있지 않습니다.' };
}

/** 내 기기로 시험 한 통(켠 기기 모두 · 하루 5번 · 지금 방식) */
export async function pushTestMine(db: DatabaseService, me: string, http = new WebPushHttp()) {
  const s = await pushSettings(db);
  if (!s.enabled) throw new PolicyViolation('MKX_PUSH_OFF', '웹 푸시는 아직 켤 수 없습니다(push.enabled).');
  const subs = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id::text AS id, endpoint, p256dh, auth FROM mkx_push_subs WHERE account_id = $1 AND state = 'ACTIVE' ORDER BY id`, [me]);
  if (!subs.length) throw new StateConflict('MKX_PUSH_NONE', '켜 둔 기기가 없습니다 — 먼저 이 브라우저에서 켜 주십시오.');
  const [c] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mkx_push_sends WHERE account_id = $1 AND test AND created_at > now() - interval '1 day'`, [me]);
  if ((c?.n ?? 0) >= TEST_DAY_MAX * subs.length) throw new PolicyViolation('MKX_PUSH_TEST_LIMIT', `시험 보내기는 하루 ${TEST_DAY_MAX}번까지입니다.`);
  const payload = pushPayload({ title: '소개뱅크 웹 푸시 시험', body: '이 알림이 보이면 웹 푸시가 잘 켜진 것입니다.', linkUrl: '/my/push', tag: 'test' });
  let ok = 0;
  for (const sub of subs) {
    const r = await deliver(s.mode, sub, payload, s.subject, http);
    await record(db, s.mode, { subId: sub.id, accountId: me, notificationId: null }, r);
    if (r.ok) ok++;
  }
  return { ok: ok > 0, sent: ok, devices: subs.length, mode: s.mode,
    note: s.mode === 'ASSUME' ? '간주(ASSUME) — 실제로 보내지 않고 기록만 남겼습니다.' : ok ? '켠 기기로 시험 알림을 보냈습니다.' : '보내지 못했습니다 — 잠시 뒤 다시 해 보십시오.' };
}

/* ── 정기 작업 mkx_push_send(1분) ─────────────────────────────────── */
export async function pushSendJob(db: DatabaseService, http = new WebPushHttp(), limit = 200) {
  const s = await pushSettings(db);
  const out = { on: s.send, mode: s.mode, night: nightKst(), picked: 0, sent: 0, assumed: 0, skipped: 0, failed: 0, gone: 0, notReady: false, keyChanged: 0 };
  if (!s.send) return out;
  if (s.mode === 'LIVE' && WebPushHttp.missing(s.subject).length) {
    out.notReady = true;
    await mkxAlert(db, 'MKX_PUSH_NOT_READY', 'WARN', `웹 푸시 LIVE 인데 준비 안 됨 — ${WebPushHttp.missing(s.subject).join(' · ')} — 회원 › 웹 푸시`, 'push-not-ready', { missing: WebPushHttp.missing(s.subject) });
    return out;
  }
  /* 키를 바꾼 뒤의 옛 구독은 GONE(KEY_CHANGED) — 그 암호 키로는 받는 쪽이 풀지 못함 */
  const pub = publicKey();
  if (pub) {
    const ch = await db.query(`UPDATE mkx_push_subs SET state = 'GONE', gone_reason = 'KEY_CHANGED' WHERE state = 'ACTIVE' AND key_tag <> $1 RETURNING id`, [keyTag(pub)]);
    out.keyChanged = ch.length;
  }
  const quietNow = s.quiet && out.night;
  const rows = await db.query<{ nid: string; accountId: string; title: string | null; body: string; linkUrl: string | null; subId: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT n.id::text AS nid, n.account_id AS "accountId", n.title, n.body, n.link_url AS "linkUrl",
            s.id::text AS "subId", s.endpoint, s.p256dh, s.auth
       FROM notifications n
       JOIN mkx_push_subs s ON s.account_id = n.account_id AND s.state = 'ACTIVE' AND n.created_at >= s.created_at
       JOIN accounts a ON a.id = n.account_id AND a.status = 'ACTIVE'
       LEFT JOIN notification_event_policies pol ON pol.event_code = n.event_code
      WHERE n.created_at > now() - interval '12 hours' AND n.read_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM mkx_push_sends x WHERE x.sub_id = s.id AND x.notification_id = n.id)
        AND (NOT $1::boolean OR coalesce(pol.quiet_hours_exempt, false))
      ORDER BY n.id, s.id LIMIT $2::int`, [quietNow, limit]);
  out.picked = rows.length;
  if (!rows.length) return out;
  const accs = [...new Set(rows.map((r) => r.accountId))];
  const counts = new Map((await db.query<{ a: string; n: number }>(
    `SELECT account_id AS a, count(*)::int AS n FROM mkx_push_sends
      WHERE account_id = ANY($1::uuid[]) AND NOT test AND state IN ('SENT', 'ASSUMED')
        AND created_at >= ((now() AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul'
      GROUP BY account_id`, [accs])).map((r) => [r.a, r.n]));
  for (const r of rows) {
    const used = counts.get(r.accountId) ?? 0;
    if (used >= s.dailyMax) {
      await db.query(`INSERT INTO mkx_push_sends (sub_id, account_id, notification_id, test, state, reason) VALUES ($1::bigint, $2, $3::bigint, false, 'SKIPPED', 'DAILY_MAX') ON CONFLICT DO NOTHING`,
        [r.subId, r.accountId, r.nid]).catch(() => undefined);
      out.skipped++; continue;
    }
    const res = await deliver(s.mode, r, pushPayload({ title: r.title, body: r.body, linkUrl: r.linkUrl, tag: `n${r.nid}` }), s.subject, http);
    const st = await record(db, s.mode, { subId: r.subId, accountId: r.accountId, notificationId: r.nid }, res).catch(() => 'FAILED');
    if (st === 'SENT') out.sent++; else if (st === 'ASSUMED') out.assumed++; else if (st === 'GONE') out.gone++; else out.failed++;
    if (res.ok) counts.set(r.accountId, used + 1);
    if (res.kind === 'AUTH') {
      await mkxAlert(db, 'MKX_PUSH_AUTH', 'WARN', `웹 푸시 인증 거절(${res.status ?? ''}) — VAPID 키 · push.vapid_subject 확인 — 회원 › 웹 푸시`, 'push-auth', { status: res.status ?? null });
      break;
    }
  }
  return out;
}

/* ── 운영 화면 ─────────────────────────────────────────────────── */
export async function pushAdminView(db: DatabaseService) {
  const s = await pushSettings(db);
  const pub = publicKey();
  const [c] = await db.query<{ active: number; members: number; gone: number; off: number }>(
    `SELECT count(*) FILTER (WHERE state = 'ACTIVE')::int AS active, count(DISTINCT account_id) FILTER (WHERE state = 'ACTIVE')::int AS members,
            count(*) FILTER (WHERE state = 'GONE')::int AS gone, count(*) FILTER (WHERE state = 'OFF')::int AS off FROM mkx_push_subs`);
  const week = await db.query<{ state: string; n: number }>(
    `SELECT state, count(*)::int AS n FROM mkx_push_sends WHERE created_at > now() - interval '7 days' AND NOT test GROUP BY state ORDER BY state`);
  const reasons = await db.query<{ reason: string; n: number }>(
    `SELECT coalesce(reason, state) AS reason, count(*)::int AS n FROM mkx_push_sends WHERE created_at > now() - interval '7 days' AND state NOT IN ('SENT', 'ASSUMED')
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
  const recent = (await db.query<{ id: string; at: string; state: string; reason: string | null; status: number | null; test: boolean; name: string | null; event: string | null; ua: string | null }>(
    `SELECT x.id::text AS id, x.created_at AS at, x.state, x.reason, x.http_status AS status, x.test, a.name, n.event_code AS event, s.ua_hint AS ua
       FROM mkx_push_sends x JOIN accounts a ON a.id = x.account_id JOIN mkx_push_subs s ON s.id = x.sub_id
       LEFT JOIN notifications n ON n.id = x.notification_id
      ORDER BY x.id DESC LIMIT 50`)).map((r) => ({ ...r, name: maskName(r.name) }));
  const missing = WebPushHttp.missing(s.subject);
  return { settings: s, keys: { publicSet: !!pub, privateSet: !!process.env.WEBPUSH_VAPID_PRIVATE?.trim(), publicKey: pub || null, tag: pub ? keyTag(pub) : null },
    ready: !missing.length, missing, counts: c, week, reasons, recent, canKeys: RequestCtx.get()?.actorRole === 'SUPER',
    note: 'push.enabled(구독 받기) · push.send(보내기)는 처음 꺼져 있고 방식은 ASSUME(밖으로 부르지 않음)입니다. 서비스 워커는 앱처럼 설치(site.pwa)가 켜져야 등록됩니다.' };
}

/** VAPID 키 만들기(SUPER) — 이미 있으면 force 일 때만 바꿈(그때 모든 구독 GONE · 회원이 다시 켜야 함) · 저장은 외부 연동 키와 같은 함수 */
export async function pushMakeKeys(db: DatabaseService, setSecret: (code: string, name: string, value: string) => Promise<unknown>, force: boolean) {
  const has = !!process.env.WEBPUSH_VAPID_PUBLIC?.trim() || !!process.env.WEBPUSH_VAPID_PRIVATE?.trim();
  if (has && !force) throw new StateConflict('MKX_PUSH_KEY_EXISTS', '웹 푸시 키가 이미 있습니다 — 바꾸면 모든 기기가 다시 켜야 합니다(바꾸려면 「새로 만들기」).');
  const k = makeVapidKeys();
  await setSecret('WEBPUSH', 'WEBPUSH_VAPID_PRIVATE', k.privateKey);
  await setSecret('WEBPUSH', 'WEBPUSH_VAPID_PUBLIC', k.publicKey);
  const gone = has ? await db.query(`UPDATE mkx_push_subs SET state = 'GONE', gone_reason = 'KEY_CHANGED' WHERE state = 'ACTIVE' RETURNING id`) : [];
  await mkxAudit(db, 'MKX_PUSH_KEYS', 'INTEGRATION', { replaced: has, gone: gone.length, tag: keyTag(k.publicKey) });
  return { ok: true, replaced: has, gone: gone.length, publicKey: k.publicKey, tag: keyTag(k.publicKey),
    note: has ? `키를 바꿨습니다 — 켜져 있던 기기 ${gone.length}개는 회원이 다시 켜야 합니다.` : '웹 푸시 키를 만들었습니다(외부 연동 › 연동 키에 저장 · 비밀 키는 다시 보이지 않음).' };
}

/** 운영 「지금 한 번 보내기」 */
export async function pushRunNow(db: DatabaseService) {
  const r = await pushSendJob(db);
  if (!r.on) throw new PolicyViolation('MKX_PUSH_SEND_OFF', '웹 푸시 보내기가 꺼져 있습니다(push.send).');
  return { ok: true, ...r, note: `보냄 ${r.sent} · 간주 ${r.assumed} · 건너뜀 ${r.skipped} · 실패 ${r.failed} · 없어진 기기 ${r.gone}` };
}
