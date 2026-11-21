import { createHash } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { normPath } from '../site/site-usage';

/* ---------------------------------------------------------------------
 * v10.588 (docs/730) 14차 운영 ④ 사용자 웹 느린 화면 측정(웹 바이탈) — 「회원 화면 사용 통계」(D274 · site-usage.ts) 방식 그대로
 *
 *   사용자 웹(WebVitalsBeacon · next/web-vitals)이 화면에서 잰 값 하나를 POST /site/vitals — 화면 주소(p) · 지표(n) · 값(v)만.
 *   ★ 개인 식별 정보 없음: 계정 · IP(요청 수 제한에만 잠깐 메모리 · 저장 안 함) · 브라우저 정보 · 방문자 키 · 쿠키 · 물음표 뒤 모두 남기지 않음
 *   ★ 주소는 site-usage normPath 로 묶음(/community/:id) · 등급(GOOD · NI · POOR)은 서버가 값으로 정함(화면 값 믿지 않음)
 *   스위치 ops2.web_vitals(처음 off · 켜기 SUPER) · 표본 ops2.web_vitals_sample(화면이 탭마다 한 번) · DNT · GPC · 로봇 무시
 *   보관 ops2.web_vitals_keep_days(30) — 받는 길에서 한 시간에 한 번 지움(정기 작업을 고치지 않으려고)
 * ------------------------------------------------------------------- */

export const OPS2_METRICS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
/** 등급 기준(web.dev 2024 · 좋음 이하 / 나쁨 초과) — CLS 는 단위 없음 · 나머지 ms */
export const OPS2_THRESH: Record<string, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|headless|curl\/|wget|python-requests|lighthouse/i;
const n = (v: unknown) => Number(v ?? 0);
const kst = () => new Date(Date.now() + 9 * 3600e3);

export function ops2Rating(metric: string, value: number): 'GOOD' | 'NI' | 'POOR' {
  const t = OPS2_THRESH[metric];
  if (!t) return 'POOR';
  return value <= t[0] ? 'GOOD' : value <= t[1] ? 'NI' : 'POOR';
}

/* 요청 수 제한 — IP 지문(저장 안 함 · 메모리 1분) 1분 60번(한 화면에 지표 5개 · 화면 여러 번) */
const hits = new Map<string, { n: number; t: number }>();
function tooMany(ip: string) {
  const now = Date.now();
  if (hits.size > 50000) hits.clear();
  const k = createHash('sha256').update('ops2v|' + ip).digest('hex').slice(0, 16);
  const h = hits.get(k);
  if (!h || now - h.t > 60_000) { hits.set(k, { n: 1, t: now }); return false; }
  h.n += 1;
  return h.n > 60;
}

/* 스위치(캐시 없음 — 끄면 바로 멈춤 · site-usage conf 와 같음) */
async function on(db: DatabaseService): Promise<boolean> {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'ops2.web_vitals'`);
  return r?.v === 'on';
}
let purgedAt = 0;
/** 시험용 — 요청 수 제한 · 지우기 시각 비우기 */
export function ops2VitalsReset() { hits.clear(); purgedAt = 0; }

async function purgeHourly(db: DatabaseService) {
  if (Date.now() - purgedAt < 3600_000) return;
  purgedAt = Date.now();
  const [k] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'ops2.web_vitals_keep_days'`);
  const keep = Math.min(180, Math.max(7, n(k?.v ?? 30)));
  await db.query(`DELETE FROM ops2_vitals WHERE day < (now() AT TIME ZONE 'Asia/Seoul')::date - $1::int`, [keep]).catch(() => undefined);
}

export interface Ops2VitalIn { p: string; n: string; v: number }

/** POST /site/vitals — 받으면 한 줄 넣음 · 받지 않은 까닭만 돌려줌(화면은 결과를 보지 않음) */
export async function ops2VitalBeat(db: DatabaseService, b: Ops2VitalIn, h: { ua?: string; dnt?: string; gpc?: string; ip?: string }) {
  if (!(await on(db))) return { ok: false, reason: 'OFF' };
  if (h.dnt === '1' || h.gpc === '1') return { ok: false, reason: 'DNT' };
  if (!h.ua || BOT_UA.test(h.ua)) return { ok: false, reason: 'BOT' };
  if (h.ip && tooMany(h.ip)) return { ok: false, reason: 'RATE' };
  if (!(OPS2_METRICS as readonly string[]).includes(b.n)) return { ok: false, reason: 'METRIC' };
  const v = Number(b.v);
  if (!Number.isFinite(v) || v < 0 || v >= 600000) return { ok: false, reason: 'VALUE' };
  const path = normPath(b.p);
  if (!path) return { ok: false, reason: 'PATH' };
  const t = kst();
  await db.query(`INSERT INTO ops2_vitals (day, hour, path, metric, value, rating) VALUES ($1::date, $2::int, $3, $4, round($5::numeric, 4), $6)`,
    [t.toISOString().slice(0, 10), t.getUTCHours(), path, b.n, v, ops2Rating(b.n, v)]);
  void purgeHourly(db).catch(() => undefined);
  return { ok: true };
}

/** GET /admin/ops2/web-vitals?days=1|7|30 — 지표마다 75번째 값 · 좋음 · 나쁨 비율 / 화면 주소 묶음 50(표본 수 순) / 날마다 LCP · INP 75번째 값 */
export async function ops2VitalsView(db: DatabaseService, daysIn?: string) {
  const days = [1, 7, 30].includes(n(daysIn)) ? n(daysIn) : 7;
  const from = new Date(Date.now() + 9 * 3600e3 - (days - 1) * 86400e3).toISOString().slice(0, 10);
  const sets = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'ops2.web_vitals%' ORDER BY key`);
  const metrics = await db.query(
    `SELECT metric, count(*)::int AS n, round(percentile_cont(0.75) WITHIN GROUP (ORDER BY value)::numeric, 3) AS p75,
            round(100.0 * count(*) FILTER (WHERE rating = 'GOOD') / count(*), 1) AS "goodPct",
            round(100.0 * count(*) FILTER (WHERE rating = 'POOR') / count(*), 1) AS "poorPct"
       FROM ops2_vitals WHERE day >= $1::date GROUP BY metric ORDER BY metric`, [from]);
  const paths = await db.query(
    `SELECT path, count(*)::int AS n,
            round((percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'LCP'))::numeric, 0) AS lcp,
            round((percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'INP'))::numeric, 0) AS inp,
            round((percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'CLS'))::numeric, 3) AS cls,
            round((percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'TTFB'))::numeric, 0) AS ttfb,
            round(100.0 * count(*) FILTER (WHERE rating = 'POOR') / count(*), 1) AS "poorPct"
       FROM ops2_vitals WHERE day >= $1::date GROUP BY path ORDER BY count(*) DESC LIMIT 50`, [from]);
  const daily = await db.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*)::int AS n,
            round((percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'LCP'))::numeric, 0) AS lcp,
            round((percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'INP'))::numeric, 0) AS inp
       FROM ops2_vitals WHERE day >= $1::date GROUP BY day ORDER BY day`, [from]);
  const s = Object.fromEntries(sets.map((r) => [r.key, r.value]));
  return {
    on: s['ops2.web_vitals'] === 'on', days, from, settings: s, thresholds: OPS2_THRESH, metrics, paths, daily,
    note: '화면 주소 묶음 · 지표 · 값만 있습니다(누가 · IP · 브라우저 정보 · 방문자 키는 없습니다). 75번째 값 = 100번 중 75번째로 느린 값(구글 기준과 같은 셈). 켜기는 SUPER · 처리방침 1.2 게시 뒤.',
  };
}
