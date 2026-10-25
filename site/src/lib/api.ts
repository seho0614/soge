/**
 * 서버 컴포넌트용 API.
 *
 * SSR 이므로 브라우저 저장소를 쓸 수 없습니다.
 * 소개코드는 쿠키에서 읽어 헤더로 전달합니다 (INV-2).
 */
import { cookies } from 'next/headers';

export interface ApiError { code: string; message: string; field?: string }

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ApiError) { super(body.message); }
  get isConflict() { return this.status === 409; }
  get isPolicy() { return this.status === 422; }
  get isGate() { return this.status === 403; }
}

const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';

export const REF_COOKIE = 'sgb_ref';
export const VISITOR_COOKIE = 'sgb_visitor';

/**
 * revalidate 를 짧게 잡습니다.
 * 자동검수를 통과한 매물이 즉시 노출되는 것이 이 서비스의 경험이므로,
 * 캐시가 길면 "올렸는데 안 보인다"가 됩니다.
 */
/* ── 캐시 함정 ────────────────────────────────────────────────────
 *
 * apiGet 은 Next 의 fetch 캐시를 씁니다. 그런데 **캐시 키에 쿠키가
 * 들어가지 않습니다.** 사람마다 달라지는 응답(성향 광고·내 정보)에
 * 그대로 쓰면 **먼저 요청한 사람의 응답이 다음 사람에게 갑니다.**
 *
 * 그래서 두 갈래로 나눕니다.
 *   apiGet          공개 응답 전용. 누가 봐도 같은 것만.
 *   apiGetPersonal  사람마다 다른 응답 전용. 캐시하지 않습니다.
 *
 * 새 API 를 붙일 때 "이 응답이 사람마다 다른가"를 먼저 물으십시오.
 * 다르면 apiGetPersonal 입니다.
 * ───────────────────────────────────────────────────────────────── */

async function buildHeaders(): Promise<Record<string, string>> {
  const jar = await cookies();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  /* 10/2 — 유입 기록은 미들웨어가 POST /attribution/touch 로 합니다(D010). 서버는 X-Ref-Code 헤더를 쓰지 않아 붙이지 않습니다.
   *   sgb_ref 쿠키(REF_COOKIE)는 미들웨어가 남겨 두기만 합니다(지금 읽는 곳 없음 — 기록의 근거는 attribution_events). */
  const token = jar.get('sgb_at')?.value;
  if (token) headers.Authorization = `Bearer ${token}`;
  /* v10.103 (다국어 3-1 · docs/161) — 화면 언어를 API 에 알립니다. 한국어 · 쿠키 없음이면 보내지 않아 캐시 · 응답이 전과 같습니다.
   *   API 가 다국어 켜짐 · 켜진 언어인지 보고, 승인된 번역만 원문 대신 내려 줍니다(꺼져 있으면 원문 그대로). */
  const lang = jar.get('sgb_lang')?.value;
  if (lang && lang !== 'ko' && /^[a-z]{2}$/.test(lang)) headers['X-Lang'] = lang;
  return headers;
}

/**
 * 사람마다 다른 응답 전용. **캐시하지 않습니다.**
 *
 * 성향 광고·내 정보·파트너 대시보드처럼 로그인 상태에 따라
 * 내용이 달라지는 것은 반드시 이쪽을 쓰십시오.
 */
export async function apiGetPersonal<T>(path: string): Promise<T> {
  const headers = await buildHeaders();
  const res = await fetch(BASE + path, { headers, cache: 'no-store' });
  const body = await res.json().catch(() => ({ code: 'PARSE_ERROR', message: '응답을 읽을 수 없습니다.' }));
  if (!res.ok) throw new ApiFailure(res.status, body as ApiError);
  return body as T;
}

/**
 * 방문자(기기)마다 다른 응답 전용 — 「이건 어때?」 투표처럼 **비로그인도 본인 것이 있는** API (D021).
 * 로그인 토큰에 더해 방문자 쿠키(sgb_visitor)를 X-Visitor-Key 로 넘깁니다. 캐시하지 않습니다.
 * 쿠키가 아직 없으면(첫 방문) 헤더 없이 부릅니다 — 그 방문자는 아직 투표한 적이 없습니다.
 */
export async function apiGetVisitor<T>(path: string): Promise<T> {
  const headers = await buildHeaders();
  const v = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (v && /^[A-Za-z0-9-]{8,64}$/.test(v)) headers['X-Visitor-Key'] = v;
  const res = await fetch(BASE + path, { headers, cache: 'no-store' });
  const body = await res.json().catch(() => ({ code: 'PARSE_ERROR', message: '응답을 읽을 수 없습니다.' }));
  if (!res.ok) throw new ApiFailure(res.status, body as ApiError);
  return body as T;
}

/**
 * 공개 응답 전용.
 *
 * ★ 로그인 상태에 따라 달라지는 응답에는 쓰지 마십시오 —
 *   캐시 키에 쿠키가 없어 남의 응답이 갈 수 있습니다.
 *   그런 것은 apiGetPersonal 을 쓰십시오.
 */
/**
 * v10.103 — 누구에게나 같은 공개 응답(언어 목록 등) · 로그인 토큰 · 언어 머리말을 붙이지 않습니다.
 *   붙이면 캐시가 토큰 · 언어마다 따로 생겨, 운영이 설정을 바꾼 직후 어떤 사람에게는 옛 값이 나옵니다(docs/157 §3-1 · docs/161).
 */
export async function apiGetPublic<T>(path: string, revalidate = 30): Promise<T> {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, next: { revalidate } });
  const body = await res.json().catch(() => ({ code: 'PARSE_ERROR', message: '응답을 읽을 수 없습니다.' }));
  if (!res.ok) throw new ApiFailure(res.status, body as ApiError);
  return body as T;
}

export async function apiGet<T>(path: string, revalidate = 30): Promise<T> {
  const headers = await buildHeaders();

  /* 개인화 경로를 캐시에 태우면 유출입니다.
   * 실수를 잡아 no-store 로 떨어뜨립니다 — 조용히 새는 것보다 낫습니다. */
  const personal = /^\/(me|partner|admin)\b/.test(path);
  if (personal) return apiGetPersonal<T>(path);

  const res = await fetch(BASE + path, { headers, next: { revalidate } });
  const body = await res.json().catch(() => ({ code: 'PARSE_ERROR', message: '응답을 읽을 수 없습니다.' }));
  if (!res.ok) throw new ApiFailure(res.status, body as ApiError);
  return body as T;
}
