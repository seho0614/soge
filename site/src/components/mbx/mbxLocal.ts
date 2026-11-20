/**
 * v10.501 · 502 (D273 · docs/639 · 640) — 이 브라우저에만 두는 것(localStorage · 서버로 보내지 않음)
 *   최근 본(로그인 전) sgb_mbx_recent — [{ type, key, title, at }] 최대 20 · 로그인하면 한 번 서버로 합치고 지움(POST /me/recent/merge)
 *   비교함            sgb_mbx_cmp    — { type, items: [{ key, title }] } 최대 4 · 같은 종류만
 * 저장소가 막힌 브라우저(사생활 보호 창 등)는 조용히 넘어갑니다 — 화면은 그대로.
 */
export type MbxType = 'LISTING' | 'PRODUCT';
export interface LocalRecent { type: MbxType; key: string; title: string; at: string }
export interface LocalCompare { type: MbxType | null; items: Array<{ key: string; title: string }> }

export const RECENT_KEY = 'sgb_mbx_recent';
export const COMPARE_KEY = 'sgb_mbx_cmp';
export const LOCAL_RECENT_MAX = 20;
export const COMPARE_MAX = 4;

function read<T>(k: string, def: T): T {
  try { const v = JSON.parse(window.localStorage.getItem(k) ?? 'null') as T | null; return v ?? def; } catch { return def; }
}
function write(k: string, v: unknown) {
  try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 화면은 그대로 */ }
}

export function localRecent(): LocalRecent[] {
  const v = read<LocalRecent[]>(RECENT_KEY, []);
  return Array.isArray(v) ? v.filter((x) => x && (x.type === 'LISTING' || x.type === 'PRODUCT') && typeof x.key === 'string').slice(0, LOCAL_RECENT_MAX) : [];
}
export function pushLocalRecent(it: Omit<LocalRecent, 'at'>) {
  const rest = localRecent().filter((x) => !(x.type === it.type && x.key === it.key));
  write(RECENT_KEY, [{ ...it, title: it.title.slice(0, 80), at: new Date().toISOString() }, ...rest].slice(0, LOCAL_RECENT_MAX));
}
export function removeLocalRecent(type: MbxType, key: string) {
  write(RECENT_KEY, localRecent().filter((x) => !(x.type === type && x.key === key)));
}
export function clearLocalRecent() {
  try { window.localStorage.removeItem(RECENT_KEY); } catch { /* 그대로 */ }
}

export function localCompare(): LocalCompare {
  const v = read<LocalCompare>(COMPARE_KEY, { type: null, items: [] });
  const items = Array.isArray(v?.items) ? v.items.filter((x) => x && typeof x.key === 'string').slice(0, COMPARE_MAX) : [];
  return { type: items.length && (v.type === 'LISTING' || v.type === 'PRODUCT') ? v.type : null, items };
}
export function saveCompare(c: LocalCompare) {
  write(COMPARE_KEY, { type: c.items.length ? c.type : null, items: c.items.slice(0, COMPARE_MAX) });
  try { window.dispatchEvent(new Event('sgb-mbx-cmp')); } catch { /* 그대로 */ }
}

/** 로그인한 뒤 한 번 — 이 브라우저의 최근 본을 서버로 합치고 지움(스위치가 꺼져 있으면 서버가 saved 0 · 그래도 지우지 않음) */
export async function mergeLocalRecent(): Promise<void> {
  const items = localRecent();
  if (!items.length) return;
  try {
    const r = await fetch('/api/v1/me/recent/merge', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: items.map((x) => ({ type: x.type, key: x.key, at: x.at })) }) });
    if (!r.ok) return;
    const d = await r.json().catch(() => null) as { saved?: number } | null;
    if (d && (d.saved ?? 0) > 0) clearLocalRecent();
  } catch { /* 다음에 다시 */ }
}
