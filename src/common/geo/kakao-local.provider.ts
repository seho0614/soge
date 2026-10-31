import { envInt, FetchLike, getPath, httpJson } from '../http-json';
import { IntegrationErrorKind } from '../integration/errors';

/* ---------------------------------------------------------------------
 * v10.46 (docs/96) — 카카오 로컬 「주소 검색」 · 「키워드로 장소 검색」 (외부 연동 MAP)
 *
 *   주소 → 좌표       GET {base}/v2/local/search/address.json?query=…        (매물 소재지 · 시 · 구 중심)
 *   키워드 → 장소     GET {base}/v2/local/search/keyword.json?query=…        (v10.47 맛집 「가게 찾기」)
 *   인증              Authorization: KakaoAK {REST API 키}
 *
 * 키는 부르는 쪽(geo.service)이 넘겨 줍니다 — 운영 화면에 넣은 값(암호화 저장)이 먼저, 없으면 .env KAKAO_REST_KEY.
 * 이 파일은 키를 읽지도 남기지도 않습니다. 로그 · 오류 글에 주소 원문 · 키를 담지 않습니다.
 *
 * 오류 종류는 연동 공통 한 벌(common/integration/errors.ts) + 이 연동만의 둘
 *   NOT_FOUND   주소 · 장소를 찾지 못함(업체는 정상)
 *   QUOTA       쿼터 초과 — HTTP 429 또는 본문 code -10(데브톡 FAQ 기준 · 확인 필요)
 * ------------------------------------------------------------------- */

export type GeoFailKind = IntegrationErrorKind | 'NOT_FOUND' | 'QUOTA';

/** 실패 쪽. ★ 개발 서버(ts-node)는 strict 를 끄고 돌아 `if (r.ok)` 로 갈라도 실패 쪽이 좁혀지지 않습니다 —
 *  실패 칸(kind)은 `r as GeoFail` 로 꺼내 쓰십시오(v10.47 realcheck TS2339). */
export type GeoFail = { ok: false; kind: GeoFailKind; detail?: string };
export type GeoPoint = { ok: true; lat: number; lng: number } | GeoFail;

export interface KakaoPlace {
  kakaoId: string; name: string; category: string | null; group: string | null; phone: string | null;
  road: string | null; jibun: string | null; lat: number; lng: number; url: string | null;
}

const base = () => (process.env.KAKAO_LOCAL_BASE?.trim() || 'https://dapi.kakao.com').replace(/\/+$/, '');
const timeout = () => envInt('KAKAO_LOCAL_TIMEOUT_MS', 3000);

/** 한국 안쪽 좌표만 받습니다(DB ck_listing_geo_kr 와 같은 범위) */
const inKorea = (lat: number, lng: number) => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

type CallOut = { fail: { ok: false; kind: GeoFailKind; detail?: string }; body: null } | { fail: null; body: unknown };

async function call(key: string | null | undefined, path: string, query: Record<string, string>, fetchFn?: FetchLike): Promise<CallOut> {
  if (!key) return { fail: { ok: false, kind: 'NOT_CONFIGURED' }, body: null };
  const qs = new URLSearchParams(query).toString();
  const r = await httpJson({ url: `${base()}${path}?${qs}`, method: 'GET', headers: { Authorization: `KakaoAK ${key}` },
    timeoutMs: timeout(), fetchFn });
  if (!r.ok) {
    const quota = r.status === 429 || Number(getPath(r.body, 'code')) === -10;
    return { fail: { ok: false, kind: quota ? 'QUOTA' : r.errorKind ?? 'UPSTREAM', detail: r.error }, body: null };
  }
  return { fail: null, body: r.body };
}

/** 주소 한 줄 → 좌표. 상세주소(동 · 호)는 넣지 마십시오 — 부르는 쪽이 도로명 · 지번만 넘깁니다 */
export async function searchAddress(key: string | null | undefined, address: string, fetchFn?: FetchLike): Promise<GeoPoint> {
  const q = address.trim();
  if (!q) return { ok: false, kind: 'NOT_FOUND' };
  const r = await call(key, '/v2/local/search/address.json', { query: q, size: '1' }, fetchFn);
  if (r.fail) return r.fail;
  const d = getPath(r.body, 'documents.0');
  if (!d) return { ok: false, kind: 'NOT_FOUND' };
  const lat = Number(d.y), lng = Number(d.x);          // 카카오는 x = 경도 · y = 위도
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) return { ok: false, kind: 'BAD_RESPONSE', detail: '좌표 범위 밖' };
  return { ok: true, lat, lng };
}

/** 키워드 → 장소 목록(최대 15곳). 음식점(FD6) · 카페(CE7)만 고를 때 categoryGroup 을 넘깁니다 */
export async function searchKeyword(key: string | null | undefined, keyword: string, opt: { categoryGroup?: string; lat?: number; lng?: number } = {},
                                    fetchFn?: FetchLike): Promise<{ ok: true; places: KakaoPlace[] } | GeoFail> {
  const q = keyword.trim();
  if (!q) return { ok: true, places: [] };
  const query: Record<string, string> = { query: q, size: '15' };
  if (opt.categoryGroup) query.category_group_code = opt.categoryGroup;
  if (opt.lat != null && opt.lng != null) { query.y = String(opt.lat); query.x = String(opt.lng); query.sort = 'distance'; }
  const r = await call(key, '/v2/local/search/keyword.json', query, fetchFn);
  if (r.fail) return r.fail;
  const docs = (getPath(r.body, 'documents') ?? []) as Record<string, string>[];
  const places = docs.map((d) => ({
    kakaoId: String(d.id ?? ''), name: String(d.place_name ?? '').slice(0, 80),
    category: d.category_name ? String(d.category_name).slice(0, 80) : null,
    group: d.category_group_code ? String(d.category_group_code).slice(0, 3) : null,
    phone: d.phone ? String(d.phone).slice(0, 20) : null,
    road: d.road_address_name ? String(d.road_address_name).slice(0, 120) : null,
    jibun: d.address_name ? String(d.address_name).slice(0, 120) : null,
    lat: Number(d.y), lng: Number(d.x),
    url: d.place_url && /^https:\/\/place\.map\.kakao\.com\//.test(String(d.place_url)) ? String(d.place_url) : null,
  })).filter((p) => /^\d{1,20}$/.test(p.kakaoId) && p.name && Number.isFinite(p.lat) && inKorea(p.lat, p.lng));
  return { ok: true, places };
}

/** v10.164 (D154 · docs/253) — 좌표 → 행정동(소개광장 동네 인증). GET {base}/v2/local/geo/coord2regioncode.json?x=경도&y=위도
 *  응답 documents 중 region_type 'H'(행정동)의 code(10자리) · address_name 만 돌려줌 — 좌표는 돌려주지 않고 어디에도 남기지 않음 */
export type GeoRegion = { ok: true; code: string; name: string } | GeoFail;
export async function coordToRegion(key: string | null | undefined, lat: number, lng: number, fetchFn?: FetchLike): Promise<GeoRegion> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) return { ok: false, kind: 'NOT_FOUND', detail: '한국 밖 좌표' };
  const r = await call(key, '/v2/local/geo/coord2regioncode.json', { x: String(lng), y: String(lat) }, fetchFn);
  if (r.fail) return r.fail;
  const docs = (getPath(r.body, 'documents') ?? []) as Record<string, string>[];
  const h = docs.find((d) => d.region_type === 'H');
  const code = h ? String(h.code ?? '') : '';
  const name = h ? String(h.address_name ?? '').trim().slice(0, 80) : '';
  if (!/^\d{10}$/.test(code) || name.length < 2) return { ok: false, kind: 'NOT_FOUND' };
  return { ok: true, code, name };
}
