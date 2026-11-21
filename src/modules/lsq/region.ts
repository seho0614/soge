import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.605 (docs/747) ㉑ 지역별 소개 페이지 — 사용자 웹 /area · /area/{시도} · /area/{시도}/{시군구} · 사이트 지도
 *   지역은 기존 보기 v_listing_region(매물에 넣은 시 · 도가 먼저 · 없으면 인증 사업장 주소 · v10.31)을 그대로 씀 — 새 표 없음
 *   대상: 게시(PUBLISHED) · 우선 노출(광고 자리) 아님 · 켜진 관 중 허브 아님 · 소개몰(HLT) 제외(사이트 지도 v10.174 와 같은 범위)
 *   매물 lsq.region_min(3)개 미만 지역은 목록 · 페이지 · 사이트 지도에 넣지 않음(얇은 페이지 · 한두 명이 드러나지 않게)
 *   보이는 것: 매물 제목 · 한줄 소개 · 업종 · 관 · 거래(희망) 금액 · 희망 소개비 · 게시일 — 등록자 이름 · 연락처 · 상세 주소 없음
 *   스위치 lsq.region_pages(처음 off) — 꺼져 있으면 enabled false(화면은 「준비 중」 · 사이트 지도에 지역 주소 없음)
 * ------------------------------------------------------------------- */

/* 대상 범위(아래 SQL 마다 같은 글자 — 조립하지 않음 · check-sql 이 PREPARE 로 봄): 게시 · 우선 노출 아님 · 켜진 관 · 허브 아님 · HLT 제외 · 지역 있음 */
const SIDO_RE = /^[가-힣]{2,10}$/;
const SIGUNGU_RE = /^[가-힣0-9]{1,15}$/;

/** GET /site/lsq/regions — 시 · 도와 그 아래 시 · 군 · 구(매물 수 lsq.region_min 이상만) */
export async function publicRegions(db: DatabaseService) {
  const s = await lsqSettings(db);
  if (!s.regionOn) return { enabled: false, min: s.regionMin, sidos: [] };
  const rows = await db.query<{ code: string; sido: string; sigungu: string | null; n: number; at: Date }>(
    `SELECT vr.sido_code AS code, vr.sido, nullif(btrim(vr.sigungu), '') AS sigungu, count(*)::int AS n, max(l.updated_at) AS at
       FROM listings l JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND l.gwan_code <> 'HLT'
        AND l.gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) AND vr.sido IS NOT NULL GROUP BY 1, 2, 3`);
  const by = new Map<string, { code: string; sido: string; n: number; at: Date; sigungus: Array<{ name: string; n: number; at: Date }> }>();
  for (const r of rows) {
    const x = by.get(r.sido) ?? { code: r.code, sido: r.sido, n: 0, at: r.at, sigungus: [] };
    x.n += r.n; if (r.at > x.at) x.at = r.at;
    if (r.sigungu && SIGUNGU_RE.test(r.sigungu) && r.n >= s.regionMin) x.sigungus.push({ name: r.sigungu, n: r.n, at: r.at });
    by.set(r.sido, x);
  }
  const sidos = [...by.values()].filter((x) => x.n >= s.regionMin)
    .map((x) => ({ ...x, sigungus: x.sigungus.sort((a, b) => b.n - a.n).slice(0, 60) }))
    .sort((a, b) => b.n - a.n);
  return { enabled: true, min: s.regionMin, sidos };
}

/** GET /site/lsq/regions/listings?sido=&sigungu=&gwan=&page= — 그 지역 게시 매물 30개씩 · 관별 수 · 많은 업종 10 */
export async function publicRegionListings(db: DatabaseService, q: { sido?: string; sigungu?: string; gwan?: string; page?: string }) {
  const s = await lsqSettings(db);
  const sido = String(q.sido ?? '').trim();
  const sigungu = String(q.sigungu ?? '').trim();
  if (!s.regionOn) return { enabled: false, sido, sigungu: sigungu || null, total: 0, items: [], gwans: [], categories: [], page: 1, pages: 0 };
  if (!SIDO_RE.test(sido)) throw new PolicyViolation('LSQ_REGION_SIDO', '시 · 도 이름이 맞지 않습니다.');
  if (sigungu && !SIGUNGU_RE.test(sigungu)) throw new PolicyViolation('LSQ_REGION_SIGUNGU', '시 · 군 · 구 이름이 맞지 않습니다.');
  const gwan = q.gwan && /^[A-Z]{3,4}$/.test(q.gwan) ? q.gwan : null;
  const page = Math.max(1, Math.min(50, Number(q.page) || 1));
  const [cnt] = await db.query<{ n: number }>(`SELECT count(*)::int AS n
      FROM listings l JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND l.gwan_code <> 'HLT'
        AND l.gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) AND vr.sido IS NOT NULL AND vr.sido = $1 AND ($2::text = '' OR btrim(vr.sigungu) = $2)`, [sido, sigungu]);
  if (!cnt || cnt.n < s.regionMin) throw new NotFound('이 지역에는 아직 소개할 매물이 적습니다.');
  const gwans = await db.query<{ code: string; name: string; n: number }>(
    `SELECT l.gwan_code AS code, g.name, count(*)::int AS n
      FROM listings l JOIN gwans g ON g.code = l.gwan_code JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND l.gwan_code <> 'HLT'
        AND l.gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) AND vr.sido IS NOT NULL AND vr.sido = $1 AND ($2::text = '' OR btrim(vr.sigungu) = $2) GROUP BY 1, 2 ORDER BY 3 DESC`, [sido, sigungu]);
  const categories = await db.query<{ name: string; n: number }>(
    `SELECT c.name, count(*)::int AS n
      FROM listings l JOIN categories c ON c.id = l.category_id JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND l.gwan_code <> 'HLT'
        AND l.gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) AND vr.sido IS NOT NULL AND vr.sido = $1 AND ($2::text = '' OR btrim(vr.sigungu) = $2) GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`, [sido, sigungu]);
  const [tot] = await db.query<{ n: number }>(`SELECT count(*)::int AS n
      FROM listings l JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND l.gwan_code <> 'HLT'
        AND l.gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) AND vr.sido IS NOT NULL AND vr.sido = $1 AND ($2::text = '' OR btrim(vr.sigungu) = $2) AND ($3::text IS NULL OR l.gwan_code = $3)`, [sido, sigungu, gwan]);
  const items = await db.query(
    `SELECT l.id::text AS id, l.gwan_code AS "gwanCode", l.title, l.summary, c.name AS "categoryName", btrim(vr.sigungu) AS sigungu,
            l.deal_amount::bigint AS "dealAmount", l.desired_fee::bigint AS "desiredFee", l.updated_at AS "updatedAt"
      FROM listings l LEFT JOIN categories c ON c.id = l.category_id JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND l.gwan_code <> 'HLT'
        AND l.gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) AND vr.sido IS NOT NULL AND vr.sido = $1 AND ($2::text = '' OR btrim(vr.sigungu) = $2) AND ($3::text IS NULL OR l.gwan_code = $3)
      ORDER BY l.updated_at DESC, l.id LIMIT 30 OFFSET $4::int`, [sido, sigungu, gwan, (page - 1) * 30]);
  return { enabled: true, sido, sigungu: sigungu || null, gwan, total: tot?.n ?? 0, page, pages: Math.ceil((tot?.n ?? 0) / 30), items, gwans, categories };
}

/** 운영 — 설정 · 공개될 지역 수 · 문턱 아래 지역 수 · 지역 표(매물 많은 순 100) */
export async function adminRegions(db: DatabaseService) {
  const settings = await lsqSettings(db);
  const rows = await db.query<{ sido: string; sigungu: string | null; n: number }>(
    `SELECT vr.sido, nullif(btrim(vr.sigungu), '') AS sigungu, count(*)::int AS n
      FROM listings l JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed AND l.gwan_code <> 'HLT'
        AND l.gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) AND vr.sido IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`);
  const sidoN = new Map<string, number>();
  for (const r of rows) sidoN.set(r.sido, (sidoN.get(r.sido) ?? 0) + r.n);
  const [noRegion] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM listings l JOIN v_listing_region vr ON vr.listing_id = l.id
      WHERE l.status = 'PUBLISHED' AND l.gwan_code <> 'HLT' AND vr.sido IS NULL`);
  return {
    settings,
    pages: {
      sidos: [...sidoN.values()].filter((n) => n >= settings.regionMin).length,
      sigungus: rows.filter((r) => r.sigungu && r.n >= settings.regionMin).length,
      below: rows.filter((r) => r.n < settings.regionMin).length,
      noRegion: noRegion?.n ?? 0,
    },
    rows: rows.slice(0, 100).map((r) => ({ ...r, open: r.n >= settings.regionMin, sidoTotal: sidoN.get(r.sido) ?? 0 })),
    note: '지역은 매물에 넣은 시 · 도(없으면 인증 사업장 주소)로 셉니다 · 문턱 아래 지역은 페이지 · 사이트 지도에 넣지 않습니다.',
  };
}
