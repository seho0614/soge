import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { GeoService } from '../../common/geo/geo.service';
import { vsxSettings } from './vsx-settings';

/* ---------------------------------------------------------------------
 * v10.543 (D284 · docs/681) 지도 매물 묶음 — 대표 11/20 「(54) ② 지도 매물 묶음」
 *
 *   공개 API GET /listings/map/clusters?level=&gwan=&swLat=&swLng=&neLat=&neLng=  (로그인 없음 · check-acl 공개 구역 listings)
 *   돌려주는 것은 「묶음 가운데 좌표 · 매물 수」뿐 — 매물 id · 제목 · 주소 · 매물 좌표는 싣지 않음(결정 map-kakao #3 A안 그대로)
 *
 *   카카오 지도 단계(level 1 = 가장 가까움 ~ 14 = 가장 멂)
 *     10 ~ 14  SIDO  시 · 도 묶음 — 가운데 = 그 시 · 도에 매물이 있는 시 · 구 중심(geo_region)의 매물 수 무게 평균
 *      7 ~ 9   SGG   시 · 구 묶음 — 가운데 = 시 · 구 중심(geo_region · 공개 화면의 「둘레 원」과 같은 점)
 *      1 ~ 6   GRID  map.cluster_grid on 일 때만 — 정확 좌표(listing_geo)를 격자(2km 넘음 · 단계마다 0.02 ~ 0.08도)로 묶어 「격자 가운데」 · 수만
 *                    격자에 map.cluster_min(처음 3) 개 아래면 그 매물은 시 · 구 묶음으로 합침(한두 채 위치가 드러나지 않게)
 *                    off(처음)면 1 ~ 6 단계도 SGG
 *   LIST   지도 사용(map.enabled) off 이거나 카카오 JS 키가 없으면 좌표 없이 시 · 구별 수 목록만(화면은 목록으로)
 *   OFF    map.cluster_enabled off(처음) — 빈 목록 · enabled false
 *   게시 중(PUBLISHED) 매물만 · 같은 질문은 60초 기억(서버 메모리 · 500개까지)
 * ------------------------------------------------------------------- */

export const MAP_GWANS_RE = /^[A-Z][A-Z0-9_]{1,19}$/;
export const MAP_MIN_CELL = 0.02;   // 도 — 약 2.2km(A안 반경 2km 보다 넓게)
const CELL_BY_LEVEL: Record<number, number> = { 1: 0.02, 2: 0.02, 3: 0.02, 4: 0.03, 5: 0.05, 6: 0.08 };
const MAX_SPAN = 2.5;   // GRID 는 화면 범위가 이보다 넓으면 SGG 로

export interface MapCluster { key: string; label: string; lat: number | null; lng: number | null; n: number }
export interface MapClusterResult { enabled: boolean; mode: 'OFF' | 'LIST' | 'SIDO' | 'SGG' | 'GRID'; level: number; items: MapCluster[]; total: number; merged: number; note: string }
export interface MapQuery { level?: number; gwan?: string; swLat?: number; swLng?: number; neLat?: number; neLng?: number }

const cache = new Map<string, { at: number; v: MapClusterResult }>();
const r4 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 1e4) / 1e4);

function bboxOf(q: MapQuery): [number, number, number, number] | null {
  const vals = [q.swLat, q.swLng, q.neLat, q.neLng];
  if (vals.every((v) => v === undefined || v === null)) return null;
  if (vals.some((v) => v === undefined || v === null || !Number.isFinite(Number(v)))) throw new PolicyViolation('MAP_BBOX', '화면 범위는 swLat · swLng · neLat · neLng 넷을 함께 보냅니다.');
  const [a, b, c, d] = vals.map(Number) as [number, number, number, number];
  if (a > c || b > d || a < 32 || c > 40 || b < 123 || d > 133) throw new PolicyViolation('MAP_BBOX', '화면 범위가 맞지 않습니다(남서 → 북동 · 국내).');
  return [a, b, c, d];
}

/** settingsOverride — 운영 화면 미리보기(스위치를 꺼 둔 채 결과 모양 보기) */
export async function mapClusters(db: DatabaseService, geo: GeoService, q: MapQuery, preview = false): Promise<MapClusterResult> {
  const level = q.level === undefined || q.level === null ? 8 : Number(q.level);
  if (!Number.isInteger(level) || level < 1 || level > 14) throw new PolicyViolation('MAP_LEVEL', '지도 단계(level)는 1 ~ 14 입니다.');
  const gwan = q.gwan ? String(q.gwan) : null;
  if (gwan && !MAP_GWANS_RE.test(gwan)) throw new PolicyViolation('MAP_GWAN', '관 코드가 맞지 않습니다.');
  const bbox = bboxOf(q);
  const s = await vsxSettings(db);
  if (!s.mapOn && !preview) return { enabled: false, mode: 'OFF', level, items: [], total: 0, merged: 0, note: '지도 매물 묶음이 꺼져 있습니다.' };
  const cfg = await geo.publicConfig();
  const ck = JSON.stringify([preview, cfg.enabled, s.mapGrid, s.mapMin, level, gwan, bbox]);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;

  let out: MapClusterResult;
  if (!cfg.enabled) {
    const rows = await sggRows(db, gwan, null);
    out = { enabled: true, mode: 'LIST', level, items: rows.map((r) => ({ ...r, lat: null, lng: null })), total: sum(rows), merged: 0,
      note: '지도가 꺼져 있거나 카카오 키가 없어 시 · 구 목록만 보입니다.' };
  } else if (level >= 10) {
    const rows = await db.query<{ sido: string; n: number; lat: string | null; lng: string | null }>(
      `SELECT l.address->>'sido' AS sido, count(*)::int AS n,
              sum(g.lat) FILTER (WHERE g.lat IS NOT NULL) / nullif(count(g.lat), 0) AS lat, sum(g.lng) FILTER (WHERE g.lng IS NOT NULL) / nullif(count(g.lng), 0) AS lng
         FROM listings l LEFT JOIN geo_region g ON g.sido = l.address->>'sido' AND g.sigungu = l.address->>'sigungu'
        WHERE l.status = 'PUBLISHED' AND ($1::text IS NULL OR l.gwan_code = $1::text) AND coalesce(l.address->>'sido', '') <> ''
        GROUP BY 1 ORDER BY n DESC LIMIT 300`, [gwan]);
    const items = rows.map((r) => ({ key: `S:${r.sido}`, label: r.sido, lat: r4(r.lat), lng: r4(r.lng), n: Number(r.n) }));
    out = { enabled: true, mode: 'SIDO', level, items, total: sum(items), merged: 0, note: '시 · 도 묶음' };
  } else if (level >= 7 || !s.mapGrid || !bbox || bbox[2] - bbox[0] > MAX_SPAN || bbox[3] - bbox[1] > MAX_SPAN) {
    const items = await sggRows(db, gwan, bbox);
    out = { enabled: true, mode: 'SGG', level, items, total: sum(items), merged: 0, note: '시 · 구 묶음(가운데 = 시 · 구 중심)' };
  } else {
    out = await gridRows(db, gwan, bbox, Math.max(MAP_MIN_CELL, CELL_BY_LEVEL[level] ?? MAP_MIN_CELL), s.mapMin, level);
  }
  if (cache.size >= 500) cache.clear();
  cache.set(ck, { at: Date.now(), v: out });
  return out;
}

const sum = (xs: Array<{ n: number }>) => xs.reduce((a, x) => a + x.n, 0);

async function sggRows(db: DatabaseService, gwan: string | null, bbox: [number, number, number, number] | null): Promise<MapCluster[]> {
  const rows = await db.query<{ sido: string; sigungu: string; n: number; lat: string | null; lng: string | null }>(
    `SELECT l.address->>'sido' AS sido, l.address->>'sigungu' AS sigungu, count(*)::int AS n, min(g.lat) AS lat, min(g.lng) AS lng
       FROM listings l LEFT JOIN geo_region g ON g.sido = l.address->>'sido' AND g.sigungu = l.address->>'sigungu'
      WHERE l.status = 'PUBLISHED' AND ($1::text IS NULL OR l.gwan_code = $1::text) AND coalesce(l.address->>'sido', '') <> '' AND coalesce(l.address->>'sigungu', '') <> ''
        AND ($2::numeric IS NULL OR (g.lat BETWEEN $2::numeric AND $4::numeric AND g.lng BETWEEN $3::numeric AND $5::numeric))
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 500`, [gwan, bbox?.[0] ?? null, bbox?.[1] ?? null, bbox?.[2] ?? null, bbox?.[3] ?? null]);
  return rows.map((r) => ({ key: `G:${r.sido} ${r.sigungu}`, label: `${r.sido} ${r.sigungu}`, lat: r4(r.lat), lng: r4(r.lng), n: Number(r.n) }));
}

/** 격자 — 정확 좌표는 DB 안에서만 쓰고 격자 번호 · 수 · 그 격자에 가장 많은 시 · 구만 꺼냄 */
async function gridRows(db: DatabaseService, gwan: string | null, bbox: [number, number, number, number], cell: number, minN: number, level: number): Promise<MapClusterResult> {
  const rows = await db.query<{ gy: string; gx: string; n: number; sido: string | null; sigungu: string | null }>(
    `WITH c AS (
       SELECT floor(g.lat / $6::numeric) AS gy, floor(g.lng / $6::numeric) AS gx, l.address->>'sido' AS sido, l.address->>'sigungu' AS sigungu
         FROM listings l JOIN listing_geo g ON g.listing_id = l.id AND g.status = 'OK'
        WHERE l.status = 'PUBLISHED' AND ($1::text IS NULL OR l.gwan_code = $1::text)
          AND g.lat BETWEEN $2::numeric AND $4::numeric AND g.lng BETWEEN $3::numeric AND $5::numeric)
     SELECT gy::text AS gy, gx::text AS gx, count(*)::int AS n, mode() WITHIN GROUP (ORDER BY sido) AS sido, mode() WITHIN GROUP (ORDER BY sigungu) AS sigungu
       FROM c GROUP BY gy, gx ORDER BY n DESC LIMIT 2000`, [gwan, bbox[0], bbox[1], bbox[2], bbox[3], cell]);
  const items: MapCluster[] = [];
  const small = new Map<string, { sido: string; sigungu: string; n: number }>();
  let merged = 0;
  for (const r of rows) {
    if (Number(r.n) >= minN) {
      const gy = Number(r.gy), gx = Number(r.gx);
      items.push({ key: `C:${cell}:${gy}:${gx}`, label: r.sigungu ? `${r.sido ?? ''} ${r.sigungu}`.trim() : '', lat: r4((gy + 0.5) * cell), lng: r4((gx + 0.5) * cell), n: Number(r.n) });
    } else if (r.sido && r.sigungu) {
      const k = `${r.sido} ${r.sigungu}`;
      const cur = small.get(k) ?? { sido: r.sido, sigungu: r.sigungu, n: 0 };
      cur.n += Number(r.n); small.set(k, cur); merged += Number(r.n);
    }
  }
  if (small.size) {
    const keys = [...small.values()];
    const centers = await db.query<{ sido: string; sigungu: string; lat: string; lng: string }>(
      `SELECT sido, sigungu, lat, lng FROM geo_region WHERE (sido, sigungu) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [keys.map((k) => k.sido), keys.map((k) => k.sigungu)]);
    for (const k of keys) {
      const c = centers.find((x) => x.sido === k.sido && x.sigungu === k.sigungu);
      items.push({ key: `G:${k.sido} ${k.sigungu}`, label: `${k.sido} ${k.sigungu}`, lat: c ? r4(c.lat) : null, lng: c ? r4(c.lng) : null, n: k.n });
    }
  }
  return { enabled: true, mode: 'GRID', level, items, total: sum(items), merged,
    note: `격자 ${cell}도 묶음 · ${minN}개 아래 격자는 시 · 구 묶음으로 합침(${merged}개)` };
}
