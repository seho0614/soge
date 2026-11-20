import { createHmac } from 'crypto';
import { lookup as dnsLookup } from 'dns';
import { request as httpsRequest } from 'https';
import { isIP } from 'net';
import { DatabaseService } from '../../db/database.service';
import { papiSettings, privateIp } from './keys';

/* ---------------------------------------------------------------------
 * v10.521 (D278 · docs/659) 파트너 웹훅 보내기 — 정기 작업 papi_hook_send(1분마다) · papi_daily(하루 정리)
 *
 *   보낼 줄 = ptn_api_hook_events PENDING · FAILED 중 next_at 이 된 것 50개(살아 있는 웹훅만)
 *   papi.hook_enabled off 면 아무것도 안 함 · papi.hook_mode ASSUME 이면 부르지 않고 ASSUMED(점검판)
 *   LIVE — 본문 = JSON 글자 하나(서명한 글자 그대로 보냄) · 머리글 X-Sgb-Event · X-Sgb-Delivery · X-Sgb-Signature: t=…,v1=HMAC-SHA256(비밀값, t.본문)
 *     보내기 전에 호스트를 DNS 로 다시 봐서 사설 · 예약 주소면 보내지 않음(등록 뒤 DNS 를 바꿔 내부망을 노리는 것 막기) · 넘겨주기(3xx)는 따라가지 않음
 *     보안 검토 A-1(DNS 다시 묶기): 확인한 주소와 실제로 붙는 주소가 같도록 https.request 의 lookup 에서 한 번만 풀고 그 자리에서 검사
 *       (풀린 주소 중 하나라도 사설 · 예약이면 연결하지 않음) · 응답 본문은 읽어 버림 · 8초 넘으면 끊음
 *     보안 검토 A-3: 서명 비밀값을 꺼내지 못하면(빈 값) 보내지 않고 FAILED(까닭 남김)
 *     2xx = SENT · 그 밖 = FAILED → 1분 · 5분 · 30분 · 2시간 · 6시간 · 12시간 뒤 다시 · 6번째 실패 = GIVEUP
 *     웹훅 연속 실패 20번이면 그 웹훅을 끄고 운영 알림 PAPI_HOOK_DISABLED
 *   비밀값 원문은 이 함수 안에서만 꺼냄(pgp_sym_decrypt) · 기록 · 오류 글에 남기지 않음
 * ------------------------------------------------------------------- */

const BACKOFF_MIN = [1, 5, 30, 120, 360, 720];
const MAX_TRY = 6;
const BATCH = 50;
const DISABLE_AFTER = 20;

/** 서명 머리글 값 — 파트너 확인 예시와 같은 식(docs/659 4-3) */
export function hookSignature(secret: string, t: number, raw: string): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}

/** 다음 시도까지(분) — attempts = 지금까지 실패한 횟수(1 부터) */
export const backoffMin = (attempts: number) => BACKOFF_MIN[Math.min(Math.max(attempts, 1), BACKOFF_MIN.length) - 1]!;

export interface HookSendResult { on: boolean; mode: string; picked: number; sent: number; assumed: number; failed: number; giveup: number; disabled: number }

const PRIVATE_ERR = 'EPRIVATEADDR';
const ERR_PRIVATE = '사설 · 예약 주소로 풀려 보내지 않음';
const ERR_NO_SECRET = '서명 비밀값을 꺼내지 못해 보내지 않음';

/** https.request 용 lookup — 한 번 풀어 모든 주소를 검사하고, 검사한 주소만 돌려줌(연결도 그 주소로) */
export function safeLookup(hostname: string, options: any, callback: (...args: any[]) => void): void {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) { callback(err); return; }
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) {
      callback(Object.assign(new Error(ERR_PRIVATE), { code: PRIVATE_ERR }));
      return;
    }
    if (options && options.all) { callback(null, addrs); return; }
    const fam = typeof options?.family === 'number' && options.family ? options.family : 0;
    const pick = addrs.find((a) => !fam || a.family === fam) ?? addrs[0]!;
    callback(null, pick.address, pick.family);
  });
}

function post(url: string, raw: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { ok: boolean; status: number; error?: string }) => { if (!done) { done = true; resolve(r); } };
    let u: URL;
    try { u = new URL(url); } catch { finish({ ok: false, status: 0, error: '연결 실패' }); return; }
    if (u.protocol !== 'https:') { finish({ ok: false, status: 0, error: '연결 실패' }); return; }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    /* IP 글자 주소는 lookup 을 거치지 않으므로 여기서 봄 */
    if (isIP(host) && privateIp(host)) { finish({ ok: false, status: 0, error: ERR_PRIVATE }); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const req = httpsRequest({
      hostname: host, port: u.port ? Number(u.port) : 443, path: `${u.pathname}${u.search}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(raw)), ...headers },
      lookup: safeLookup as any, agent: false,
    }, (res) => {
      const status = res.statusCode ?? 0;
      res.resume();   // 본문은 읽어 버림(넘겨주기 3xx 도 따라가지 않음)
      res.on('end', () => clearTimeout(timer));
      res.on('close', () => clearTimeout(timer));
      const ok = status >= 200 && status < 300;
      finish({ ok, status, ...(ok ? {} : { error: `HTTP ${status}` }) });
    });
    timer = setTimeout(() => {
      finish({ ok: false, status: 0, error: '응답 지연(8초 넘음)' });
      req.destroy();
    }, 8000);
    req.on('error', (e: any) => {
      clearTimeout(timer);
      finish({ ok: false, status: 0, error: e?.code === PRIVATE_ERR ? ERR_PRIVATE : '연결 실패' });
    });
    req.end(raw);
  });
}

/** 1분마다 — 보낼 줄 50개 */
export async function papiHookSendJob(db: DatabaseService): Promise<HookSendResult> {
  const s = await papiSettings(db);
  const out: HookSendResult = { on: s.enabled && s.hookEnabled, mode: s.hookMode, picked: 0, sent: 0, assumed: 0, failed: 0, giveup: 0, disabled: 0 };
  if (!out.on) return out;
  const rows = await db.query<{ id: string; uid: string; event: string; payload: Record<string, unknown>; attempts: number; hookId: string; url: string; secret: string | null }>(
    `SELECT e.id::text AS id, e.event_uid::text AS uid, e.event, e.payload, e.attempts, h.id::text AS "hookId", h.url,
            CASE WHEN $1::text = 'LIVE' THEN pgp_sym_decrypt(h.secret_enc, public.fn_enc_key()) END AS secret
       FROM ptn_api_hook_events e JOIN ptn_api_hooks h ON h.id = e.hook_id
      WHERE e.state IN ('PENDING', 'FAILED') AND e.next_at <= now() AND h.status = 'ACTIVE'
      ORDER BY e.next_at, e.id LIMIT $2::int`, [s.hookMode, BATCH]);
  out.picked = rows.length;
  for (const e of rows) {
    if (s.hookMode === 'ASSUME') {
      await db.query(`UPDATE ptn_api_hook_events SET state = 'ASSUMED', sent_at = now(), attempts = attempts + 1, last_status = NULL, last_error = NULL WHERE id = $1::bigint`, [e.id]);
      out.assumed++;
      continue;
    }
    const raw = JSON.stringify({ event: e.event, eventUid: e.uid, ...e.payload });
    const t = Math.floor(Date.now() / 1000);
    /* 비밀값이 비면 빈 열쇠로 서명해 보내지 않음(A-3) — 실패로 남기고 다시 시도 · 6번이면 포기 */
    const r = !e.secret
      ? { ok: false, status: 0, error: ERR_NO_SECRET }
      : await post(e.url, raw, { 'X-Sgb-Event': e.event, 'X-Sgb-Delivery': e.uid, 'X-Sgb-Signature': hookSignature(e.secret, t, raw), 'User-Agent': 'SogaeBank-Webhook/1' });
    if (r.ok) {
      await db.query(`UPDATE ptn_api_hook_events SET state = 'SENT', sent_at = now(), attempts = attempts + 1, last_status = $2::int, last_error = NULL WHERE id = $1::bigint`, [e.id, r.status]);
      await db.query(`UPDATE ptn_api_hooks SET fail_streak = 0 WHERE id = $1::bigint AND fail_streak <> 0`, [e.hookId]);
      out.sent++;
      continue;
    }
    const tries = e.attempts + 1;
    const giveup = tries >= MAX_TRY;
    await db.query(
      `UPDATE ptn_api_hook_events SET state = $2, attempts = $3::int, last_status = $4::int, last_error = $5,
              next_at = now() + make_interval(mins => $6::int) WHERE id = $1::bigint`,
      [e.id, giveup ? 'GIVEUP' : 'FAILED', tries, r.status, String(r.error ?? '').slice(0, 200), giveup ? 0 : backoffMin(tries)]);
    if (giveup) out.giveup++; else out.failed++;
    const [h] = await db.query<{ streak: number; company: string }>(
      `UPDATE ptn_api_hooks h SET fail_streak = h.fail_streak + 1 FROM partners p JOIN businesses b ON b.id = p.business_id
        WHERE h.id = $1::bigint AND p.id = h.partner_id RETURNING h.fail_streak AS streak, b.company_name AS company`, [e.hookId]);
    if (h && h.streak >= DISABLE_AFTER) {
      const off = await db.query(
        `UPDATE ptn_api_hooks SET status = 'DISABLED', disabled_at = now(), disabled_reason = '연속 실패로 자동으로 끔' WHERE id = $1::bigint AND status = 'ACTIVE' RETURNING id`, [e.hookId]);
      if (off.length) {
        out.disabled++;
        await db.query(`UPDATE ptn_api_hook_events SET state = 'CANCELED', last_error = '웹훅을 끔' WHERE hook_id = $1::bigint AND state IN ('PENDING', 'FAILED')`, [e.hookId]);
        await db.query(
          `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PAPI_HOOK_DISABLED', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
          [`파트너 웹훅 자동으로 끔 — ${h.company} · 연속 실패 ${h.streak}번 — 파트너사 › 오픈 API`.slice(0, 300), JSON.stringify({ hookId: e.hookId, streak: h.streak })]);
      }
    }
  }
  return out;
}

export interface PapiDailyResult { purged: number; staleGiveup: number; expiring: number; abuse: boolean }

/** 하루 한 번 — 기록 정리 · 오래된 줄 포기 · 기한 임박 키 · 틀린 키 몰림 */
export async function papiDailyJob(db: DatabaseService): Promise<PapiDailyResult> {
  const s = await papiSettings(db);
  const [purged] = await db.query<{ n: number }>(
    `WITH x AS (DELETE FROM ptn_api_requests WHERE at < now() - make_interval(days => $1::int) RETURNING 1) SELECT count(*)::int AS n FROM x`, [s.logKeepDays]);
  const [stale] = await db.query<{ n: number }>(
    `WITH x AS (UPDATE ptn_api_hook_events SET state = 'GIVEUP', last_error = coalesce(last_error, '3일 넘게 보내지 못함')
                 WHERE state IN ('PENDING', 'FAILED') AND created_at < now() - interval '3 days' RETURNING 1) SELECT count(*)::int AS n FROM x`);
  const expiring = await db.query<{ id: string; prefix: string; company: string; expiresAt: string }>(
    `SELECT k.id::text AS id, k.key_prefix AS prefix, b.company_name AS company, k.expires_at AS "expiresAt"
       FROM ptn_api_keys k JOIN partners p ON p.id = k.partner_id JOIN businesses b ON b.id = p.business_id
      WHERE k.status = 'ACTIVE' AND k.expires_at > now() AND k.expires_at <= now() + interval '7 days'`);
  if (expiring.length) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PAPI_KEY_EXPIRING', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`파트너 API 키 ${expiring.length}개가 7일 안에 끝납니다 — 파트너사 › 오픈 API 에서 새 키를 발급해 전하십시오.`, JSON.stringify({ keys: expiring.slice(0, 20) })]);
  }
  const [bad] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ptn_api_requests WHERE reason = 'PAPI_KEY_INVALID' AND at > now() - interval '24 hours'`);
  const abuse = (bad?.n ?? 0) >= 500;
  if (abuse) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PAPI_KEY_ABUSE', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`파트너 API 에 틀린 키 요청이 하루 ${bad!.n}번 — 키를 맞혀 보는 시도일 수 있습니다. 요청 기록을 확인하십시오.`, JSON.stringify({ invalid24h: bad!.n })]);
  }
  return { purged: purged?.n ?? 0, staleGiveup: stale?.n ?? 0, expiring: expiring.length, abuse };
}
