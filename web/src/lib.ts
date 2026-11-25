/* e1.4 (docs/004) ERP 화면 공통 — 증표는 sessionStorage 에만(창을 닫으면 사라짐 · 운영 화면 저장소와 따로)
 *   오류 모양 { code, message } (소개뱅크 · ERP API 같음) */
const KEY = 'erp_token';
export const getToken = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t: string | null) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* 저장 못 함 — 이 창만 */ } };

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = getToken();
  const r = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFailure(r.status, String(body?.code ?? 'ERROR'), String(body?.message ?? '처리하지 못했습니다.'));
  return body as T;
}

/** 주소 조각(#/handoff?code=…)에서 코드 꺼내기 — 쓰고 나면 주소에서 지움 */
export function takeHandoffCode(hash: string): string | null {
  const m = /^#\/handoff\?(.*)$/.exec(hash);
  if (!m) return null;
  const code = new URLSearchParams(m[1]).get('code');
  return code && /^[A-Za-z0-9_-]{30,60}$/.test(code) ? code : null;
}

/** 메뉴 — E3 ~ E6 에서 하나씩 채움(지금은 「준비 중」) */
export const MENU: { key: string; label: string; phase: string }[] = [
  { key: 'acct', label: '회계 · 세무', phase: 'E3' },
  { key: 'hr', label: '인사 · 급여', phase: 'E4' },
  { key: 'ofc', label: '사무', phase: 'E4' },
  { key: 'gw', label: '그룹웨어', phase: 'E4G' },
  { key: 'sales', label: '영업', phase: 'E5' },
  { key: 'buy', label: '구매', phase: 'E5' },
  { key: 'trade', label: '무역', phase: 'E5' },
  { key: 'qlt', label: '품질', phase: 'E5' },
  { key: 'lgl', label: '법무', phase: 'E5' },
  { key: 'its', label: '자산', phase: 'E5' },
  { key: 'jobs', label: '정기 작업', phase: 'e1.3' },
];
