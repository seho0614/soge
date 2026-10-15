/* ---------------------------------------------------------------------
 * 외부 연동 공통 — JSON HTTP 호출 · 필드 경로 · 오류 분류 (D008 · 2026-10-02)
 *
 * 계좌인증 · 중개사 대조처럼 **업체(벤더)마다 형식이 다른 연동**을
 * 설정만으로 붙이기 위한 작은 도구입니다. 형식을 코드에 박지 않고
 * 환경변수의 필드 지도(map)로 읽습니다 — 업체를 정한 뒤 지도만 채웁니다.
 *
 * 오류는 다섯 가지로 나눕니다. 화면 문구와 재시도 여부가 다르기 때문입니다.
 *   TIMEOUT      응답 지연          — 잠시 뒤 다시
 *   NETWORK      연결 실패          — 잠시 뒤 다시(운영 확인)
 *   AUTH         401 · 403          — 키 · 발신 IP 문제, 이용자가 고칠 수 없음
 *   HTTP_4XX     그 밖의 4xx        — 요청 값 문제
 *   UPSTREAM     5xx                — 기관 장애
 *   BAD_RESPONSE JSON 아님 · 형식 다름
 * ------------------------------------------------------------------- */

export type HttpErrorKind = 'TIMEOUT' | 'NETWORK' | 'AUTH' | 'HTTP_4XX' | 'UPSTREAM' | 'BAD_RESPONSE';

export interface HttpJsonResult {
  ok: boolean;
  status: number;
  body: any;
  errorKind?: HttpErrorKind;
  /** 로그 · 화면용 짧은 설명. 키 · 개인정보를 담지 않습니다 */
  error?: string;
}

/** 시험에서 갈아끼우기 위해 fetch 모양만 받습니다 */
export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean; status: number; text: () => Promise<string>;
}>;

export async function httpJson(opts: {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}): Promise<HttpJsonResult> {
  const f = opts.fetchFn ?? (fetch as unknown as FetchLike);
  const method = opts.method ?? 'POST';
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await f(opts.url, {
      method,
      headers: { Accept: 'application/json',
                 ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
                 ...(opts.headers ?? {}) },
      body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
  } catch (e: any) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { ok: false, status: 0, body: null,
      errorKind: timeout ? 'TIMEOUT' : 'NETWORK',
      error: timeout ? `응답 지연(${opts.timeoutMs ?? 5000}ms 초과)` : '연결 실패' };
  }

  let text = '';
  try { text = await res.text(); } catch { /* 본문 없음 */ }
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = undefined; }
  }

  if (!res.ok) {
    const kind: HttpErrorKind = res.status === 401 || res.status === 403 ? 'AUTH'
      : res.status >= 500 ? 'UPSTREAM' : 'HTTP_4XX';
    return { ok: false, status: res.status, body: body ?? null, errorKind: kind, error: `HTTP ${res.status}` };
  }
  if (body === undefined) {
    return { ok: false, status: res.status, body: null, errorKind: 'BAD_RESPONSE', error: 'JSON 이 아닌 응답' };
  }
  return { ok: true, status: res.status, body };
}

/** 'a.b.0.c' 경로로 값을 꺼냅니다. 없으면 undefined */
export function getPath(obj: unknown, path: string | undefined): any {
  if (!path) return undefined;
  let cur: any = obj;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(k) ? cur[Number(k)] : cur[k];
  }
  return cur;
}

/** 'a.b' 경로에 값을 넣습니다(중첩 본문을 만드는 업체용) */
export function setPath(obj: Record<string, any>, path: string, value: unknown) {
  const ks = path.split('.');
  let cur = obj;
  ks.slice(0, -1).forEach((k) => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
  cur[ks[ks.length - 1]] = value;
}

/** 환경변수의 JSON 을 읽습니다. 형식이 틀리면 기본값을 쓰고 이유를 돌려줍니다 */
export function envJson<T extends object>(name: string, fallback: T): { value: T; error?: string } {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return { value: fallback };
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { value: { ...fallback, ...v } };
    return { value: fallback, error: `${name} 는 JSON 객체여야 합니다` };
  } catch {
    return { value: fallback, error: `${name} JSON 형식 오류` };
  }
}

export const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 이름 대조용 정규화 — 공백 · 문장부호 · 법인 표기를 걷어냅니다 */
export function normName(s: unknown): string {
  return String(s ?? '')
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}
