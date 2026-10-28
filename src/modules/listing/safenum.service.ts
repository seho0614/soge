import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { AppError, Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { envInt, getPath, httpJson } from '../../common/http-json';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';

/* ---------------------------------------------------------------------
 * v10.145 (D141 · docs/221 · 설계 docs/218) — 050 안심번호 틀
 *
 *   safenum.provider  NONE(처음 · 지금과 같음 — 「준비 중」 안내) · MOCK(점검판 — 가짜 050 번호 · 가짜 통화 · 운영 서버에서는 NONE 으로 읽음) · HTTP(업체)
 *   흐름  로그인 회원 매물 상세 「전화하기」 → 등록자 휴대폰에 묶인 050 번호(safenum.hours · 같은 회원 · 매물은 다시 씀 · 하루 safenum.daily)
 *         → 통화가 끝나면 업체 → POST /webhooks/safenum(HMAC · 같은 알림 한 번) → call_logs 1행(건 번호는 해시만)
 *         → 기존 트리거 fn_attribute_call 이 소개코드가 묶인 번호면 소개 기록(CALL · 90일)
 *   돌려주기  배치 safenum_release — 기한 지난 번호를 업체에 돌려줌
 *   HTTP 공통 모양(업체 미정 · 계약 뒤 맞춤)  POST {SAFENUM_URL}/numbers { target, ttlMinutes, externalId } → { id, virtualNumber }
 *                                              POST {SAFENUM_URL}/numbers/{id}/release
 *   웹훅  x-safenum-timestamp · x-safenum-signature = HMAC-SHA256(비밀값, "시각.본문") · 본문 { eventId, virtualNumber, callerNumber, durationSec, endedAt }
 * ------------------------------------------------------------------- */

export type SafenumMode = 'NONE' | 'MOCK' | 'HTTP';
const isProd = () => (process.env.NODE_ENV ?? 'development') === 'production';
export const MOCK_SAFENUM_SECRET = 'sgb-mock-safenum-webhook-secret';
const SIG_SKEW_SEC = 300;
const fmt050 = (n: string) => { const d = n.replace(/\D/g, ''); return d.length === 12 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d; };

interface SnRow { id: string; virtual_no: string; target_id: string; account_id: string | null; provider: string | null; vendor_id: string | null; expires_at: Date }

@Injectable()
export class SafenumService {
  private readonly log = new Logger(SafenumService.name);
  constructor(private readonly db: DatabaseService, private readonly attribution: AttributionEngine) {}

  private async setting(key: string, dflt: string) {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v?.trim() || dflt;
  }
  async mode(): Promise<SafenumMode> { return SafenumService.readMode(await this.setting('safenum.provider', 'NONE')); }
  static readMode(v: string): SafenumMode {
    const m = (v ?? '').trim().toUpperCase();
    return m === 'HTTP' ? 'HTTP' : m === 'MOCK' && !isProd() ? 'MOCK' : 'NONE';
  }
  static httpMissing(): string[] { return ['SAFENUM_KEY', 'SAFENUM_WEBHOOK_SECRET', 'SAFENUM_URL'].filter((k) => !process.env[k]?.trim()); }
  static configuredFor(mode: SafenumMode) { return mode === 'MOCK' || (mode === 'HTTP' && !SafenumService.httpMissing().length); }
  private static secret(mode: SafenumMode) { return mode === 'MOCK' ? MOCK_SAFENUM_SECRET : (process.env.SAFENUM_WEBHOOK_SECRET ?? '').trim(); }

  private http(path: string, body: unknown) {
    const env = process.env;
    return httpJson({ url: env.SAFENUM_URL!.trim().replace(/\/+$/, '') + path, method: 'POST', body, timeoutMs: Math.min(Math.max(envInt('SAFENUM_TIMEOUT_MS', 8000), 1000), 30000),
      headers: { [env.SAFENUM_AUTH_HEADER?.trim() || 'Authorization']: (env.SAFENUM_AUTH_PREFIX ?? 'Bearer ') + (env.SAFENUM_KEY ?? '').trim() } });
  }

  /* ── 회원: 번호 받기 ───────────────────────────────────────────── */
  async issue(listingId: string) {
    const me = RequestCtx.actorId();
    if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    const mode = await this.mode();
    if (mode === 'NONE') throw new StateConflict('SAFENUM_OFF', '전화 연결은 준비 중입니다. 지금은 1:1 문의로 시작해 주십시오 — 대화가 시작되면 소개가 기록됩니다.');
    if (!SafenumService.configuredFor(mode)) throw new StateConflict('SAFENUM_NOT_CONFIGURED', '전화 연결 설정이 끝나지 않았습니다 — 1:1 문의를 이용해 주십시오.');
    const [l] = await this.db.query<{ owner: string; phone: string | null; no_intro: boolean }>(
      `SELECT l.owner_account_id AS owner, a.phone, coalesce(fn_category_no_intro(l.category_id), false) AS no_intro
         FROM listings l JOIN accounts a ON a.id = l.owner_account_id WHERE l.id = $1 AND l.status = 'PUBLISHED'`, [listingId]);
    if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
    if (l.owner === me) throw new PolicyViolation('OWN_TARGET', '본인 매물에는 전화할 수 없습니다.');
    if (l.no_intro) throw new PolicyViolation('SAFENUM_NOT_ALLOWED', '이 업종은 전화 연결을 하지 않습니다 — 1:1 문의를 이용해 주십시오.');
    const phone = (l.phone ?? '').replace(/\D/g, '');
    if (!/^01[016789]\d{7,8}$/.test(phone)) throw new StateConflict('SAFENUM_NO_PHONE', '등록자의 휴대폰 번호가 없어 전화 연결을 할 수 없습니다 — 1:1 문의를 이용해 주십시오.');

    const [have] = await this.db.query<SnRow>(
      `SELECT id, virtual_no, target_id, account_id, provider, vendor_id, expires_at FROM safe_numbers
        WHERE target_type = 'LISTING' AND target_id = $1 AND account_id = $2 AND provider = $3 AND released_at IS NULL AND expires_at > now() + interval '10 minutes'
        ORDER BY issued_at DESC LIMIT 1`, [listingId, me, mode]);
    if (have) return { number: fmt050(have.virtual_no), expiresAt: have.expires_at, mode, reused: true };

    const daily = Number(await this.setting('safenum.daily', '10')) || 0;
    const [c] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM safe_numbers WHERE account_id = $1 AND (issued_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`, [me]);
    if (c.n >= daily) throw new PolicyViolation('SAFENUM_DAILY_LIMIT', `전화 연결 번호는 하루 ${daily}번까지 받을 수 있습니다. 1:1 문의를 이용해 주십시오.`);

    const hours = Math.min(Math.max(Number(await this.setting('safenum.hours', '24')) || 24, 1), 72);
    const code = (await this.attribution.resolveForListing(me, listingId).catch(() => null))?.code ?? null;
    let virtualNo: string, vendorId: string | null = null;
    if (mode === 'MOCK') {
      virtualNo = '0500000' + String(randomInt(0, 100000)).padStart(5, '0');
    } else {
      const r = await this.http(process.env.SAFENUM_ALLOC_PATH?.trim() || '/numbers', { target: phone, ttlMinutes: hours * 60, externalId: `${listingId}:${me}` });
      const num = String(getPath(r.body, process.env.SAFENUM_RESULT_NUMBER_PATH?.trim() || 'virtualNumber') ?? '').replace(/\D/g, '');
      if (!r.ok || !/^050\d{8,9}$/.test(num)) {
        this.log.warn(`안심번호 받기 실패 매물 ${listingId} ${r.errorKind ?? 'BAD_RESPONSE'} ${r.error ?? ''}`);
        throw new AppError(502, { code: 'SAFENUM_FAILED', message: '전화 연결 번호를 받지 못했습니다 — 잠시 뒤 다시 누르시거나 1:1 문의를 이용해 주십시오.', details: { kind: r.ok ? 'BAD_RESPONSE' : r.errorKind } });
      }
      virtualNo = num;
      vendorId = String(getPath(r.body, process.env.SAFENUM_RESULT_ID_PATH?.trim() || 'id') ?? '').slice(0, 200) || null;
    }
    const [row] = await this.db.query<{ expires_at: Date }>(
      `INSERT INTO safe_numbers (virtual_no, target_type, target_id, code, visitor_key, expires_at, account_id, provider, vendor_id)
       VALUES ($1, 'LISTING', $2, $3, $4, now() + make_interval(hours => $5::int), $6, $7, $8) RETURNING expires_at`,
      [virtualNo, listingId, code, `acct:${me}`, hours, me, mode, vendorId]);
    return { number: fmt050(virtualNo), expiresAt: row.expires_at, mode, reused: false };
  }

  /* ── 통화 기록(웹훅 · 가짜 통화) ──────────────────────────────────── */
  private async logCall(mode: SafenumMode, sn: { id: string }, caller: string, durationSec: number | null, endedAt: string | null, eventId: string | null) {
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO call_logs (safe_number_id, caller_hash, duration_sec, occurred_at, provider, event_id, ended_at)
       VALUES ($1, encode(hmac($2::text, fn_enc_key(), 'sha256'), 'hex'), $3, coalesce($4::timestamptz, now()), $5, $6, $4::timestamptz)
       ON CONFLICT (provider, event_id) WHERE event_id IS NOT NULL DO NOTHING RETURNING id`,
      [sn.id, caller || 'unknown', durationSec, endedAt, mode, eventId]);
    return r ? 'LOGGED' : 'DUPLICATE';
  }

  static verify(secret: string, raw: string, ts: string | undefined, sig: string | undefined, nowSec = Math.floor(Date.now() / 1000)) {
    if (!secret || !ts || !sig || !/^\d{9,12}$/.test(ts) || Math.abs(nowSec - Number(ts)) > SIG_SKEW_SEC) return false;
    const mac = createHmac('sha256', secret).update(`${ts}.${raw}`, 'utf8').digest();
    const got = sig.trim().replace(/^sha256=/i, '');
    const cand = /^[0-9a-f]{64}$/i.test(got) ? Buffer.from(got, 'hex') : Buffer.from(got, 'base64');
    return cand.length === mac.length && timingSafeEqual(cand, mac);
  }

  async webhook(raw: string, headers: Record<string, string | string[] | undefined>, body: any) {
    const mode = await this.mode();
    if (mode === 'NONE') return { ok: true, ignored: 'SAFENUM_OFF' };
    const h = (n: string) => { const v = headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
    const p = (k: string, d: string) => getPath(body, process.env[k]?.trim() || d);
    const eventId = String(p('SAFENUM_EVT_ID_PATH', 'eventId') ?? '').slice(0, 200) || null;
    if (!SafenumService.verify(SafenumService.secret(mode), raw, h(process.env.SAFENUM_TS_HEADER?.trim() || 'x-safenum-timestamp'), h(process.env.SAFENUM_SIG_HEADER?.trim() || 'x-safenum-signature'))) {
      await this.db.query(`INSERT INTO safenum_events (provider, event_id, sig_ok, result) VALUES ($1, $2, false, 'BAD_SIGNATURE')`, [mode, eventId]);
      throw new AppError(401, { code: 'SAFENUM_BAD_SIGNATURE', message: '서명 검사에 실패했습니다.' });
    }
    const vno = String(p('SAFENUM_EVT_NUMBER_PATH', 'virtualNumber') ?? '').replace(/\D/g, '');
    const dur = Number(p('SAFENUM_EVT_DURATION_PATH', 'durationSec'));
    const endedRaw = p('SAFENUM_EVT_ENDED_PATH', 'endedAt');
    const ended = endedRaw && !Number.isNaN(Date.parse(String(endedRaw))) ? new Date(String(endedRaw)).toISOString() : null;
    const caller = String(p('SAFENUM_EVT_CALLER_PATH', 'callerNumber') ?? '').replace(/\D/g, '');
    /* 통화가 그 번호를 쓰던 때 것인지 — 돌려준 뒤 다른 사람이 받은 같은 번호와 섞이지 않게(통화 시각 기준) */
    const [sn] = vno ? await this.db.query<{ id: string }>(
      `SELECT id FROM safe_numbers WHERE virtual_no = $1 AND provider = $2 AND issued_at <= coalesce($3::timestamptz, now())
          AND coalesce(released_at, expires_at) >= coalesce($3::timestamptz, now()) - interval '1 hour' ORDER BY issued_at DESC LIMIT 1`, [vno, mode, ended]) : [];
    const result = !sn ? 'UNKNOWN_NUMBER' : await this.logCall(mode, sn, caller, Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : null, ended, eventId);
    await this.db.query(`INSERT INTO safenum_events (provider, event_id, sig_ok, duplicate, result) VALUES ($1, $2, true, $3, $4)`,
      [mode, eventId, result === 'DUPLICATE', result]);
    return { ok: true, result, ...(result === 'DUPLICATE' ? { duplicate: true } : {}) };
  }

  /** 점검판 가짜 통화 — 내가 받은 번호로 통화가 끝난 것처럼 */
  async mockCall(listingId: string, durationSec = 42) {
    if ((await this.mode()) !== 'MOCK') throw new Forbidden('MOCK_ONLY', '가짜 통화는 시험 방식(MOCK)에서만 씁니다.');
    const me = RequestCtx.actorId();
    const [sn] = await this.db.query<{ id: string }>(
      `SELECT id FROM safe_numbers WHERE target_type = 'LISTING' AND target_id = $1 AND account_id = $2 AND provider = 'MOCK' AND released_at IS NULL
        ORDER BY issued_at DESC LIMIT 1`, [listingId, me]);
    if (!sn) throw new StateConflict('SAFENUM_NONE', '먼저 「전화하기」로 번호를 받아 주십시오.');
    const result = await this.logCall('MOCK', sn, `mock:${me}`, Math.max(0, Math.min(Math.round(durationSec), 36000)), new Date().toISOString(), null);
    return { ok: true, result };
  }

  /* ── 배치 safenum_release ─────────────────────────────────────── */
  async release(limit = 200) {
    const out = { released: 0, failed: 0 };
    const rows = await this.db.query<SnRow>(
      `SELECT id, virtual_no, target_id, account_id, provider, vendor_id, expires_at FROM safe_numbers
        WHERE released_at IS NULL AND expires_at < now() ORDER BY expires_at LIMIT $1`, [limit]);
    for (const r of rows) {
      let note = 'EXPIRED';
      if (r.provider === 'HTTP' && r.vendor_id && !SafenumService.httpMissing().length) {
        const path = (process.env.SAFENUM_RELEASE_PATH?.trim() || '/numbers/{id}/release').replace('{id}', encodeURIComponent(r.vendor_id));
        const x = await this.http(path, {});
        if (!x.ok) { out.failed++; note = `EXPIRED · 업체 돌려주기 실패 ${x.errorKind ?? ''}`.trim(); }
      }
      await this.db.query(`UPDATE safe_numbers SET released_at = now(), release_note = $2 WHERE id = $1 AND released_at IS NULL`, [r.id, note]);
      out.released++;
    }
    return out;
  }

  /* ── 운영 화면 ─────────────────────────────────────────────────── */
  async status() {
    const mode = await this.mode();
    const admin = await this.db.query<{ name: string }>(`SELECT name FROM integration_secrets WHERE integration_code = 'SAFENUM'`);
    const keys = ['SAFENUM_KEY', 'SAFENUM_WEBHOOK_SECRET'].map((n) => ({ name: n, set: !!process.env[n]?.trim(),
      source: admin.some((r) => r.name === n) ? 'ADMIN' : process.env[n]?.trim() ? 'ENV' : 'NONE' }));
    const [s] = await this.db.query<any>(
      `SELECT count(*)::int AS issued, count(*) FILTER (WHERE released_at IS NULL AND expires_at > now())::int AS active,
              count(*) FILTER (WHERE code IS NOT NULL)::int AS with_code
         FROM safe_numbers WHERE issued_at > now() - interval '30 days' AND provider IS NOT NULL`);
    const [c] = await this.db.query<any>(
      `SELECT count(*)::int AS calls, coalesce(sum(duration_sec), 0)::int AS seconds,
              count(*) FILTER (WHERE sn.code IS NOT NULL)::int AS attributed
         FROM call_logs cl JOIN safe_numbers sn ON sn.id = cl.safe_number_id WHERE cl.occurred_at > now() - interval '30 days'`);
    const [w] = await this.db.query<any>(
      `SELECT count(*)::int AS received, count(*) FILTER (WHERE NOT sig_ok)::int AS bad_signature, count(*) FILTER (WHERE duplicate)::int AS duplicate,
              count(*) FILTER (WHERE result = 'UNKNOWN_NUMBER')::int AS unknown
         FROM safenum_events WHERE received_at > now() - interval '30 days'`);
    const base = (await this.setting('site.base_url', '')).replace(/\/+$/, '');
    return {
      provider: mode, setting: await this.setting('safenum.provider', 'NONE'), mockAllowed: !isProd(), url: { set: !!process.env.SAFENUM_URL?.trim() }, keys,
      missing: mode === 'HTTP' ? SafenumService.httpMissing() : [], configured: SafenumService.configuredFor(mode),
      webhookUrl: base ? `${base}/api/v1/webhooks/safenum` : '/api/v1/webhooks/safenum',
      hours: Number(await this.setting('safenum.hours', '24')), daily: Number(await this.setting('safenum.daily', '10')),
      last30: { issued: s.issued, active: s.active, withCode: s.with_code, calls: c.calls, seconds: c.seconds, attributed: c.attributed },
      webhook: { received: w.received, badSignature: w.bad_signature, duplicate: w.duplicate, unknown: w.unknown },
    };
  }

  async calls(days = 7) {
    const d = [1, 7, 30].includes(days) ? days : 7;
    const rows = await this.db.query<any>(
      `SELECT cl.id::text, cl.occurred_at AS "at", cl.duration_sec AS "durationSec", right(sn.virtual_no, 4) AS "numberLast4",
              left(coalesce(l.title, ''), 40) AS "listingTitle", (sn.code IS NOT NULL) AS "attributed", cl.provider
         FROM call_logs cl JOIN safe_numbers sn ON sn.id = cl.safe_number_id LEFT JOIN listings l ON l.id = sn.target_id
        WHERE cl.occurred_at > now() - make_interval(days => $1::int) ORDER BY cl.occurred_at DESC LIMIT 50`, [d]);
    return { days: d, rows };
  }
}
