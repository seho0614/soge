/* v10.513 ~ 516 (D276) ㊻ 매물 — 사용자 웹 브라우저 부품이 같은 주소(/api/v1 · 쿠키)로 부르는 작은 도우미 */
export interface LsxRes<T> { ok: boolean; status: number; body: T & { code?: string; message?: string; details?: Record<string, unknown> } }

export async function lsxCall<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<LsxRes<T>> {
  const r = await fetch(`/api/v1${path}`, {
    method, cache: 'no-store',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : (method === 'GET' ? undefined : '{}'),
  });
  const b = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: b as LsxRes<T>['body'] };
}

/** 한국 날짜 · 시각(짧게) */
export const kstShort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const kstDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';
