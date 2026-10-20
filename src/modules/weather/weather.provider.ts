import { envInt, FetchLike, getPath, httpJson } from '../../common/http-json';
import { IntegrationErrorKind } from '../../common/integration/errors';

/* ---------------------------------------------------------------------
 * v10.49 (D103 · docs/101) — 기상청 단기예보 조회서비스(공공데이터포털) · 외부 연동 WEATHER
 *
 *   초단기실황  GET {base}/getUltraSrtNcst   지금 기온(T1H) · 습도(REH) · 강수 형태(PTY) · 1시간 강수량(RN1)
 *               매시 정시 자료 · 40분 뒤부터 부릅니다(그 전이면 한 시간 전 자료)
 *   단기예보    GET {base}/getVilageFcst     하늘(SKY) · 강수확률(POP) · 최저(TMN) · 최고(TMX)
 *               하루 8번 발표(02 · 05 · 08 · 11 · 14 · 17 · 20 · 23시) · 10분 뒤부터 부릅니다
 *   인증        serviceKey 쿼리 — 일반 인증키(Decoding). Encoding 키(%2B …)를 넣었으면 한 번 풀어서 씁니다(두 번 인코딩 방지)
 *
 *   응답 머리 resultCode (공공데이터포털 공통 · 활용 신청 화면의 문서로 확인 필요)
 *     00 정상 · 03 자료 없음 · 22 하루 한도 초과 · 30 등록되지 않은 키 · 31 기한 만료 · 32 등록되지 않은 IP
 *
 * 키는 부르는 쪽(weather.service)이 넘깁니다 — 운영 화면에 넣은 값(암호화 저장)이 먼저, 없으면 .env KMA_SERVICE_KEY.
 * 이 파일은 키를 남기지 않습니다. 오류 글에 주소(키가 든 URL)를 담지 않습니다.
 * ------------------------------------------------------------------- */

export type WxFailKind = IntegrationErrorKind | 'NO_DATA' | 'QUOTA';
/** 실패 쪽. ★ 개발 서버(ts-node)는 strict 를 끄고 돌아 `if (r.ok)` 로 갈라도 좁혀지지 않습니다 — `r as WxFail` 로 꺼내 쓰십시오 */
export type WxFail = { ok: false; kind: WxFailKind; detail?: string };
export type WxItem = { category: string; value: string; fcstDate?: string; fcstTime?: string };
export type WxItems = { ok: true; items: WxItem[] } | WxFail;

const base = () => (process.env.KMA_API_BASE?.trim() || 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0').replace(/\/+$/, '');
const timeout = () => envInt('KMA_TIMEOUT_MS', 3000);

/* ── 지역 — 시 · 도 17곳(시청 · 도청 자리). 격자는 아래 toGrid 로 구한 값입니다(시험이 같은지 봅니다) ── */
export interface WxRegion { code: string; name: string; lat: number; lng: number; nx: number; ny: number }
export const WX_REGIONS: WxRegion[] = [
  { code: 'SEOUL', name: '서울', lat: 37.5665, lng: 126.9780, nx: 60, ny: 127 },
  { code: 'BUSAN', name: '부산', lat: 35.1796, lng: 129.0756, nx: 98, ny: 76 },
  { code: 'DAEGU', name: '대구', lat: 35.8714, lng: 128.6014, nx: 89, ny: 91 },
  { code: 'INCHEON', name: '인천', lat: 37.4563, lng: 126.7052, nx: 55, ny: 124 },
  { code: 'GWANGJU', name: '광주', lat: 35.1595, lng: 126.8526, nx: 58, ny: 74 },
  { code: 'DAEJEON', name: '대전', lat: 36.3504, lng: 127.3845, nx: 67, ny: 100 },
  { code: 'ULSAN', name: '울산', lat: 35.5384, lng: 129.3114, nx: 102, ny: 84 },
  { code: 'SEJONG', name: '세종', lat: 36.4800, lng: 127.2890, nx: 66, ny: 103 },
  { code: 'GYEONGGI', name: '경기 수원', lat: 37.2893, lng: 127.0535, nx: 61, ny: 121 },
  { code: 'GANGWON', name: '강원 춘천', lat: 37.8853, lng: 127.7298, nx: 73, ny: 134 },
  { code: 'CHUNGBUK', name: '충북 청주', lat: 36.6357, lng: 127.4917, nx: 69, ny: 107 },
  { code: 'CHUNGNAM', name: '충남 홍성', lat: 36.6588, lng: 126.6728, nx: 55, ny: 107 },
  { code: 'JEONBUK', name: '전북 전주', lat: 35.8203, lng: 127.1088, nx: 63, ny: 89 },
  { code: 'JEONNAM', name: '전남 무안', lat: 34.8161, lng: 126.4629, nx: 51, ny: 67 },
  { code: 'GYEONGBUK', name: '경북 안동', lat: 36.5760, lng: 128.5056, nx: 87, ny: 106 },
  { code: 'GYEONGNAM', name: '경남 창원', lat: 35.2383, lng: 128.6924, nx: 91, ny: 77 },
  { code: 'JEJU', name: '제주', lat: 33.4890, lng: 126.4983, nx: 52, ny: 38 },
];
export const WX_REGION_CODES = WX_REGIONS.map((r) => r.code);

/** 위도 · 경도 → 기상청 격자(5km · 람베르트 정각원추). 기상청 「단기예보 조회서비스」 활용 문서의 변환식과 같은 상수입니다 */
export function toGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180, re = RE / GRID, s1 = SLAT1 * D, s2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let th = lng * D - olon;
  if (th > Math.PI) th -= 2 * Math.PI;
  if (th < -Math.PI) th += 2 * Math.PI;
  th *= sn;
  return { nx: Math.floor(ra * Math.sin(th) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(th) + YO + 0.5) };
}

/* ── 발표 시각(한국 시간) ─────────────────────────────────────────── */
const kst = (ms: number) => new Date(ms + 9 * 3600_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const hh = (h: number) => `${String(h).padStart(2, '0')}00`;

/** 초단기실황의 기준 — 정시 자료를 40분 뒤부터 씁니다. back=1 이면 한 시간 더 앞(자료 없음일 때) */
export function ncstBase(nowMs: number, back = 0): { date: string; time: string } {
  const d = kst(nowMs - 40 * 60_000 - back * 3600_000);
  return { date: ymd(d), time: hh(d.getUTCHours()) };
}

const FCST_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
/** 단기예보의 가장 최근 발표 — 발표 10분 뒤부터. 02:10 전이면 전날 23시 */
export function fcstBase(nowMs: number): { date: string; time: string } {
  const d = kst(nowMs - 10 * 60_000);
  const h = d.getUTCHours();
  const last = [...FCST_HOURS].reverse().find((x) => x <= h);
  if (last === undefined) return { date: ymd(kst(nowMs - 10 * 60_000 - 24 * 3600_000)), time: '2300' };
  return { date: ymd(d), time: hh(last) };
}

/** 오늘 최저 · 최고(TMN 06시 · TMX 15시)가 모두 든 발표 — 오늘 02시(02:10 전이면 전날 23시) */
export function dayBase(nowMs: number): { date: string; time: string } {
  const d = kst(nowMs - 10 * 60_000);
  if (d.getUTCHours() < 2) return { date: ymd(kst(nowMs - 10 * 60_000 - 24 * 3600_000)), time: '2300' };
  return { date: ymd(d), time: '0200' };
}

/** 오늘 날짜(한국) YYYYMMDD */
export const todayKst = (nowMs: number) => ymd(kst(nowMs));

/** Encoding 키(%2B …)를 넣었으면 한 번 풉니다 — URLSearchParams 가 다시 인코딩합니다 */
export function normalizeKey(key: string): string {
  const k = key.trim();
  if (!/%[0-9A-Fa-f]{2}/.test(k)) return k;
  try { return decodeURIComponent(k); } catch { return k; }
}

async function call(key: string | null | undefined, op: 'getUltraSrtNcst' | 'getVilageFcst', b: { date: string; time: string },
                    g: { nx: number; ny: number }, rows: number, fetchFn?: FetchLike): Promise<WxItems> {
  if (!key) return { ok: false, kind: 'NOT_CONFIGURED' };
  const qs = new URLSearchParams({
    serviceKey: normalizeKey(key), pageNo: '1', numOfRows: String(rows), dataType: 'JSON',
    base_date: b.date, base_time: b.time, nx: String(g.nx), ny: String(g.ny),
  }).toString();
  const r = await httpJson({ url: `${base()}/${op}?${qs}`, method: 'GET', timeoutMs: timeout(), fetchFn });
  if (!r.ok) {
    /* 키가 틀리면 공공데이터포털은 JSON 대신 XML(OpenAPI_ServiceResponse) 이나 401 을 돌려줍니다 */
    return { ok: false, kind: r.errorKind === 'BAD_RESPONSE' ? 'AUTH' : r.errorKind ?? 'UPSTREAM', detail: r.error };
  }
  const code = String(getPath(r.body, 'response.header.resultCode') ?? '');
  if (code === '03') return { ok: false, kind: 'NO_DATA' };
  if (code === '22') return { ok: false, kind: 'QUOTA' };
  if (code === '30' || code === '31' || code === '32') return { ok: false, kind: 'AUTH', detail: `resultCode ${code}` };
  if (code !== '00') return { ok: false, kind: code ? 'REJECTED' : 'BAD_RESPONSE', detail: code ? `resultCode ${code}` : '머리 없음' };
  const raw = getPath(r.body, 'response.body.items.item');
  if (!Array.isArray(raw)) return { ok: false, kind: 'NO_DATA' };
  const items: WxItem[] = raw.map((x: Record<string, unknown>) => ({
    category: String(x.category ?? ''),
    value: String(x.obsrValue ?? x.fcstValue ?? ''),
    fcstDate: x.fcstDate != null ? String(x.fcstDate) : undefined,
    fcstTime: x.fcstTime != null ? String(x.fcstTime) : undefined,
  })).filter((x) => /^[A-Z0-9]{3}$/.test(x.category));
  return { ok: true, items };
}

/** 초단기실황 — 8종(T1H · RN1 · UUU · VVV · REH · PTY · VEC · WSD) */
export function getNcst(key: string | null | undefined, b: { date: string; time: string }, g: { nx: number; ny: number }, fetchFn?: FetchLike) {
  return call(key, 'getUltraSrtNcst', b, g, 10, fetchFn);
}

/** 단기예보 — 한 발표에 약 1,000줄(3일 × 시간 × 12종). 오늘 · 내일 몫이면 충분해 rows 로 줄여 받습니다 */
export function getFcst(key: string | null | undefined, b: { date: string; time: string }, g: { nx: number; ny: number }, rows = 400, fetchFn?: FetchLike) {
  return call(key, 'getVilageFcst', b, g, rows, fetchFn);
}
