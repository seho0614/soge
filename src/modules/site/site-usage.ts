import { createHash } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.508 (D274 · docs/646) 회원 화면 사용 통계 — 대표 11/20 「㊹ ④」 · 자체 수집(외부 분석 도구 없음)
 *   사용자 웹(UsageBeacon)이 화면이 바뀔 때 한 번 POST /site/usage/beat — 화면 주소 · 들어온 첫 화면 · 둘째 화면 여부 · 전환 목표만
 *   ★ 개인 식별 정보 없음: 계정(로그인해도 읽지 않음) · IP(요청 수 제한에만 잠깐 메모리 · 저장 안 함) · 브라우저 정보 · 방문자 쿠키 · 검색어(?q=) 모두 남기지 않음
 *   ★ 주소의 번호 · uuid · 긴 코드 · 한글 조각은 :id 로 바꿔 묶음(/community/:id · /health/p/:id) — 누가 무엇을 봤는지 알 수 없게
 *   저장: 하루(한국 날짜) × 주소 묶음 수만(site_usage_daily · site_usage_goals) · 보관 site.usage_keep_days(400일) 뒤 정기 작업이 지움
 *   표본: site.usage_sample(퍼센트) — 브라우저 탭마다 한 번 정함 · est_views 는 100 ÷ 표본 으로 보정
 *   끄기: site.usage_stats off(처음) · 브라우저 「추적 안 함」(DNT) · GPC 이면 보내지 않고 받지도 않음 · 로봇 브라우저 무시
 * ------------------------------------------------------------------- */

/** DB CHECK site_usage_daily.path 와 같은 정규식(규칙 2) */
export const USAGE_PATH = /^\/[A-Za-z0-9/_:.-]{0,119}$/;
export const USAGE_GOALS = ['SIGNUP', 'ORDER', 'POST', 'INQUIRY', 'LISTING', 'REQUEST'] as const;
const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|headless|curl\/|wget|python-requests|lighthouse/i;
const n = (v: unknown) => Number(v ?? 0);
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);

/** 주소 묶기 — 물음표 뒤 · # 뒤 버림 · 4단계까지 · 번호 · uuid · 긴 코드 · 영문 숫자 아닌 조각은 :id */
export function normPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.length > 400) return null;
  const p = raw.split(/[?#]/)[0] ?? '';
  if (/^\/(api|_next|admin)(\/|$)/.test(p)) return null;
  const segs = p.split('/').filter(Boolean).slice(0, 4).map((s) => {
    let d = s;
    try { d = decodeURIComponent(s); } catch { return ':id'; }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d)) return ':id';
    if (/^\d+$/.test(d) || d.length > 24 || !/^[A-Za-z0-9_.-]+$/.test(d)) return ':id';
    if (/\d/.test(d) && /^[A-Za-z0-9_-]{6,}$/.test(d) && /[A-Z]/.test(d)) return ':id';   // 상품 · 매물 코드처럼 대문자 + 숫자
    return d.toLowerCase();
  });
  const out = '/' + segs.join('/');
  return USAGE_PATH.test(out) ? out : null;
}

/* 요청 수 제한 — IP 지문(저장 안 함 · 메모리 1분) 1분 120번 */
const hits = new Map<string, { n: number; t: number }>();
function tooMany(ip: string) {
  const now = Date.now();
  if (hits.size > 50000) hits.clear();
  const k = createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const h = hits.get(k);
  if (!h || now - h.t > 60_000) { hits.set(k, { n: 1, t: now }); return false; }
  h.n += 1;
  return h.n > 120;
}

/** 설정 두 줄(기본 키 찾기 · 캐시 없음 — 끄면 바로 멈추게) */
async function conf(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('site.usage_stats', 'site.usage_sample')`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { on: m['site.usage_stats'] === 'on', sample: Math.min(100, Math.max(1, n(m['site.usage_sample'] ?? 100))) };
}

export interface UsageBeat { p: string; e?: string; s?: boolean; g?: string }

/** POST /site/usage/beat — 받으면 하루 묶음에 더함 · 받지 않은 까닭만 돌려줌(화면은 결과를 보지 않음) */
export async function usageBeat(db: DatabaseService, b: UsageBeat, h: { ua?: string; dnt?: string; gpc?: string; ip?: string }) {
  const c = await conf(db);
  if (!c.on) return { ok: false, reason: 'OFF' };
  if (h.dnt === '1' || h.gpc === '1') return { ok: false, reason: 'DNT' };
  if (!h.ua || BOT_UA.test(h.ua)) return { ok: false, reason: 'BOT' };
  if (h.ip && tooMany(h.ip)) return { ok: false, reason: 'RATE' };
  const path = normPath(b.p);
  if (!path) return { ok: false, reason: 'PATH' };
  const entryPath = b.e ? normPath(b.e) : null;
  const isEntry = !b.e;
  const goal = b.g && (USAGE_GOALS as readonly string[]).includes(b.g) ? b.g : null;
  await db.query(`SELECT fn_site_usage_add($1::date, $2::text, $3::boolean, $4::text, $5::text, $6::text, $7::numeric)`,
    [kstDay(), path, isEntry, b.s && entryPath ? entryPath : null, goal, goal ? (entryPath ?? path) : null, Math.round((100 / c.sample) * 100) / 100]);
  return { ok: true };
}

/** GET /admin/site-usage — 최근 N일 합 · 날마다 · 주소 묶음 100 · 전환(목표 × 들어온 첫 화면) */
export async function usageView(db: DatabaseService, daysIn?: string) {
  const days = [1, 7, 30, 90].includes(n(daysIn)) ? n(daysIn) : 7;
  const from = kstDay(-(days - 1));
  const c = await conf(db);
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'site.usage_%' ORDER BY key`);
  const daily = await db.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(views)::int AS views, sum(entries)::int AS entries, sum(engaged)::int AS engaged, round(sum(est_views))::int AS "estViews"
       FROM site_usage_daily WHERE day >= $1::date GROUP BY day ORDER BY day`, [from]);
  const paths = await db.query(
    `SELECT path, sum(views)::int AS views, sum(entries)::int AS entries, sum(engaged)::int AS engaged, round(sum(est_views))::int AS "estViews",
            CASE WHEN sum(entries) > 0 THEN round(100.0 * greatest(sum(entries) - sum(engaged), 0) / sum(entries), 1) END AS "bouncePct"
       FROM site_usage_daily WHERE day >= $1::date GROUP BY path ORDER BY sum(views) DESC LIMIT 100`, [from]);
  const goals = await db.query(
    `SELECT g.goal, g.entry_path AS "entryPath", sum(g.n)::int AS n,
            CASE WHEN coalesce((SELECT sum(d.entries) FROM site_usage_daily d WHERE d.day >= $1::date AND d.path = g.entry_path), 0) > 0
                 THEN round(100.0 * sum(g.n) / (SELECT sum(d.entries) FROM site_usage_daily d WHERE d.day >= $1::date AND d.path = g.entry_path), 1) END AS "convPct"
       FROM site_usage_goals g WHERE g.day >= $1::date GROUP BY g.goal, g.entry_path ORDER BY sum(g.n) DESC LIMIT 60`, [from]);
  const tot = daily.reduce((a: { views: number; entries: number; engaged: number }, d: any) => ({ views: a.views + n(d.views), entries: a.entries + n(d.entries), engaged: a.engaged + n(d.engaged) }), { views: 0, entries: 0, engaged: 0 });
  return {
    on: c.on, sample: c.sample, days, from, settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    total: { ...tot, bouncePct: tot.entries ? Math.round((1000 * Math.max(tot.entries - tot.engaged, 0)) / tot.entries) / 10 : null },
    daily, paths, goals,
    note: '화면 주소 묶음별 하루 수만 있습니다(누가 봤는지 · IP · 브라우저 정보는 없습니다). 이탈 = 첫 화면에서 다른 화면으로 넘어가지 않은 비율.',
  };
}

/** 정기(mlx_daily_purge) — 보관 날 수 지난 줄 지움 */
export async function usagePurge(db: DatabaseService) {
  const [k] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'site.usage_keep_days'`);
  const keep = Math.min(1100, Math.max(30, n(k?.v ?? 400)));
  const a = await db.query(`DELETE FROM site_usage_daily WHERE day < (now() AT TIME ZONE 'Asia/Seoul')::date - $1::int RETURNING day`, [keep]);
  const b = await db.query(`DELETE FROM site_usage_goals WHERE day < (now() AT TIME ZONE 'Asia/Seoul')::date - $1::int RETURNING day`, [keep]);
  return { days: keep, daily: a.length, goals: b.length };
}
