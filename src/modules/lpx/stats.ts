import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { LPX_GWAN_RE, LPX_YM_RE, UUID_RE, lpxSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.552 (D286 · docs/690) 지역별 시세 통계 — 대표 11/21 「(56) ④ 지역별 시세 통계」
 *
 *   매일 04:50 정기 작업 lpx_stats_daily(lpx.stats on 일 때만) — DB 함수 fn_lpx_stats_refresh(달)가 그 달을 다시 셈
 *     · 이번 달 · 지난달은 매일 다시 · lpx.stats_months(처음 12) 안에 빠진 달은 채움(처음 켤 때 한 번에)
 *     · 셈 대상 = 그 달(한국)에 게시된(published_at) 매물 중 지금 PUBLISHED · ARCHIVED · 거래 금액 > 0 · 시 · 도가 있는 것
 *     · 칸 = 관 × 업종(상위 분류 · 'ALL' = 모든 업종) × 시 · 도('' = 전국) × 시 · 구('' = 시 · 도 전체) — GROUPING SETS 6벌
 *     · 가운데값 · 아래 4분의 1 · 위 4분의 1 — **매물 5개 미만 칸은 DB 가 값을 비움**(CHECK · 표에도 남지 않음)
 *   공개 GET /site/lpx/price-stats?gwan=&category=&sido=&sigungu= — 집계만(매물 id · 제목 · 주소 없음)
 *     · lpx.stats_min(처음 5 · 5 아래로 못 내림) 개 미만 칸은 숨김(hidden 수만) · 꺼져 있으면 enabled false
 * ------------------------------------------------------------------- */

export interface LpxStatRow { ym: string; n: number; median: string | null; p25: string | null; p75: string | null }

const kstYm = (offsetMonths = 0) => {
  const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return d.toISOString().slice(0, 7);
};

/** 매물 상세 한 칸 — 그 관 · 업종 · 시 · 구 최근 달(없으면 시 · 도 · 그것도 없으면 null) */
export async function cellStat(db: DatabaseService, gwan: string, categoryId: string, sido: string, sigungu: string, min: number) {
  const [r] = await db.query<{ ym: string; n: number; median: string; sigungu: string; category: string }>(
    `SELECT s.ym, s.n, s.median_amount::text AS median, s.sigungu, s.category_key AS category
       FROM lpx_price_stats s
      WHERE s.gwan_code = $1 AND s.sido = $3 AND s.n >= $5::int AND s.median_amount IS NOT NULL
        AND s.category_key IN ((SELECT fn_lpx_category_root($2::uuid))::text, 'ALL')
        AND s.sigungu IN ($4, '')
      ORDER BY s.ym DESC, (s.sigungu <> '') DESC, (s.category_key <> 'ALL') DESC LIMIT 1`, [gwan, categoryId, sido, sigungu, min]);
  if (!r) return null;
  return { ym: r.ym, n: Number(r.n), median: r.median, area: r.sigungu ? `${sido} ${r.sigungu}` : sido, allCategories: r.category === 'ALL' };
}

/** 공개 — 한 칸의 달별 추이 · 아래 칸(시 · 도 → 시 · 구) 최근 달 · 고를 것(관의 업종 · 시 · 도) */
export async function publicStats(db: DatabaseService, q: { gwan?: string; category?: string; sido?: string; sigungu?: string }) {
  const s = await lpxSettings(db);
  if (!s.statsOn) return { enabled: false, months: [], children: [], hidden: 0, options: { categories: [], sidos: [] }, min: s.statsMin, note: '지역별 시세 통계가 꺼져 있습니다.' };
  const gwan = String(q.gwan ?? '').trim();
  if (!LPX_GWAN_RE.test(gwan)) throw new PolicyViolation('LPX_STATS_GWAN', '관 코드(gwan)를 고르십시오.');
  const cat = String(q.category ?? 'ALL').trim() || 'ALL';
  if (cat !== 'ALL' && !UUID_RE.test(cat)) throw new PolicyViolation('LPX_STATS_CATEGORY', '업종이 맞지 않습니다.');
  const sido = String(q.sido ?? '').trim().slice(0, 30);
  const sigungu = sido ? String(q.sigungu ?? '').trim().slice(0, 30) : '';
  const from = kstYm(-(s.statsMonths - 1));
  const months = await db.query<LpxStatRow>(
    `SELECT ym, n, median_amount::text AS median, p25_amount::text AS p25, p75_amount::text AS p75
       FROM lpx_price_stats
      WHERE gwan_code = $1 AND category_key = $2 AND sido = $3 AND sigungu = $4 AND ym >= $5 AND n >= $6::int AND median_amount IS NOT NULL
      ORDER BY ym`, [gwan, cat, sido, sigungu, from, s.statsMin]);
  /* 아래 칸 — 전국이면 시 · 도별 · 시 · 도면 시 · 구별 · 시 · 구면 없음(최근 달 하나) */
  const [last] = await db.query<{ ym: string }>(`SELECT max(ym) AS ym FROM lpx_price_stats WHERE gwan_code = $1`, [gwan]);
  let children: Array<{ key: string; n: number; median: string }> = [];
  let hidden = 0;
  if (!sigungu && last?.ym) {
    const rows = await db.query<{ key: string; n: number; median: string | null }>(
      `SELECT CASE WHEN $3 = '' THEN sido ELSE sigungu END AS key, n, median_amount::text AS median
         FROM lpx_price_stats
        WHERE gwan_code = $1 AND category_key = $2 AND ym = $4
          AND ((($3)::text = '' AND sido <> '' AND sigungu = '') OR (($3)::text <> '' AND sido = $3 AND sigungu <> ''))
        ORDER BY n DESC, 1 LIMIT 300`, [gwan, cat, sido, last.ym]);
    children = rows.filter((r) => r.n >= s.statsMin && r.median != null).map((r) => ({ key: r.key, n: Number(r.n), median: r.median! }));
    hidden = rows.length - children.length;
  }
  const categories = await db.query<{ id: string; name: string }>(
    `SELECT DISTINCT c.id::text AS id, c.name FROM lpx_price_stats s JOIN categories c ON c.id::text = s.category_key
      WHERE s.gwan_code = $1 AND s.n >= $2::int AND s.median_amount IS NOT NULL ORDER BY c.name LIMIT 200`, [gwan, s.statsMin]);
  const sidos = await db.query<{ sido: string }>(
    `SELECT DISTINCT sido FROM lpx_price_stats WHERE gwan_code = $1 AND sido <> '' AND n >= $2::int AND median_amount IS NOT NULL ORDER BY sido LIMIT 50`, [gwan, s.statsMin]);
  return { enabled: true, gwan, category: cat, sido, sigungu, lastYm: last?.ym ?? null, min: s.statsMin, months: months.map((m) => ({ ...m, n: Number(m.n) })), children, hidden,
    options: { categories, sidos: sidos.map((x) => x.sido) },
    note: `게시된 매물의 거래(희망) 금액 가운데값입니다 — 실제 거래 가격이 아니며, 매물 ${s.statsMin}개 미만 칸은 숨깁니다.` };
}

/** 정기 작업(매일 04:50) — 켜져 있을 때만 · 이번 달 · 지난달 다시 · 빠진 달 채움 */
export async function statsDailyJob(db: DatabaseService, force = false) {
  const s = await lpxSettings(db);
  if (!s.statsOn && !force) return { on: false, months: 0, rows: 0 };
  const want = Array.from({ length: s.statsMonths }, (_, i) => kstYm(-i));
  const have = new Set((await db.query<{ ym: string }>(`SELECT DISTINCT ym FROM lpx_price_stats WHERE ym >= $1`, [want[want.length - 1]])).map((r) => r.ym));
  const todo = want.filter((ym, i) => i < 2 || !have.has(ym));
  let rows = 0;
  for (const ym of todo) {
    const [r] = await db.query<{ n: number }>(`SELECT fn_lpx_stats_refresh($1::text) AS n`, [ym]);
    rows += Number(r?.n ?? 0);
  }
  return { on: s.statsOn, months: todo.length, rows, ym: todo };
}

/** 운영 — 지금 한 달 다시 셈(SUPER · 스위치와 상관없이 미리 보기용) */
export async function statsRunNow(db: DatabaseService, ymIn?: string) {
  if (ymIn === undefined || ymIn === null || ymIn === '') return statsDailyJob(db, true);
  if (!LPX_YM_RE.test(String(ymIn))) throw new PolicyViolation('LPX_STATS_YM', '달은 YYYY-MM 입니다.');
  const [r] = await db.query<{ n: number }>(`SELECT fn_lpx_stats_refresh($1::text) AS n`, [ymIn]);
  return { on: (await lpxSettings(db)).statsOn, months: 1, rows: Number(r?.n ?? 0), ym: [ymIn] };
}

/* ── 운영 화면 › 검수 › 지역별 시세 통계 ── */
export async function adminStats(db: DatabaseService, ymIn?: string) {
  const settings = await lpxSettings(db);
  const ym = ymIn && LPX_YM_RE.test(ymIn) ? ymIn : kstYm(0);
  if (ymIn && !LPX_YM_RE.test(ymIn)) throw new PolicyViolation('LPX_STATS_YM', '달은 YYYY-MM 입니다.');
  const months = await db.query(
    `SELECT ym, count(*)::int AS cells, count(*) FILTER (WHERE median_amount IS NULL)::int AS "smallCells", max(computed_at) AS "computedAt"
       FROM lpx_price_stats GROUP BY ym ORDER BY ym DESC LIMIT 24`);
  const top = await db.query(
    `SELECT s.gwan_code AS "gwanCode", s.category_key AS category, coalesce(c.name, '모든 업종') AS "categoryName", s.sido, s.sigungu, s.n, s.median_amount::text AS median
       FROM lpx_price_stats s LEFT JOIN categories c ON c.id::text = s.category_key
      WHERE s.ym = $1 AND s.median_amount IS NOT NULL ORDER BY s.n DESC LIMIT 100`, [ym]);
  return { settings, ym, months, top, note: '공개 API 는 집계만 돌려주고 매물 5개 미만 칸은 값이 비어 있습니다(DB) · 공개 기준 수는 lpx.stats_min.' };
}
