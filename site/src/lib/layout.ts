import { apiGet, apiGetPublic } from '@/lib/api';

/* ---------------------------------------------------------------------
 * v10.696 ~ 700 (D321 · docs/804 ~ 808) 꾸밀 페이지 — 운영 화면 › 관 관리 › 페이지 목록에서 게시한 배치(GET /site-layouts/{key})
 *   layout 이 null 이면 게시한 판이 없음 → 코드의 처음 배치 그대로 · 읽지 못해도 처음 배치(화면이 깨지지 않게)
 *   ?lp=<40자> 미리보기 — 저장된 초안(캐시 없이) · 링크가 끝나면 처음 배치
 *   구역 열쇠는 서버 LAYOUT_SPECS(site-layouts.service.ts)와 같음
 * ------------------------------------------------------------------- */
export type LayKey = 'HOME' | 'MNY' | 'MAL' | 'BIZ' | 'LED' | 'HLT' | 'EARN';   // v10.702 EARN 허브
export interface LaySlide { show: boolean; tag?: string; title?: string; desc?: string; cta?: string; href?: string; image?: string }
export interface Lay {
  sections: Array<{ key: string; show: boolean }>;
  texts: Record<string, string>;
  slides?: Record<string, LaySlide>;
  picks?: Record<string, string[]>;
  inserts: Record<string, Array<Record<string, any>>>;
}
export async function getLayout(key: LayKey, lp?: string | string[] | null): Promise<Lay | null> {
  const tok = typeof lp === 'string' && /^[0-9a-f]{40}$/.test(lp) ? lp : null;
  const r = await (tok
    ? apiGetPublic<{ layout: Lay | null }>(`/site-layouts/${key}?preview=${tok}`, 0)
    : apiGet<{ layout: Lay | null }>(`/site-layouts/${key}`, 60)).catch(() => null);
  return r?.layout ?? null;
}
/** 구역 차례 — 배치가 없으면 처음 차례(order) 그대로 · 있으면 배치 차례(빠진 구역은 뒤에) */
export function layOrder(lay: Lay | null, order: string[]): Array<{ key: string; show: boolean }> {
  if (!lay) return order.map((key) => ({ key, show: true }));
  const known = new Set(order);
  const got = lay.sections.filter((s) => known.has(s.key));
  const seen = new Set(got.map((s) => s.key));
  return [...got, ...order.filter((k) => !seen.has(k)).map((key) => ({ key, show: true }))];
}
/** 숨긴 구역 · 순서를 CSS 로(구역 안 배치가 클라이언트 화면이라 직접 못 바꾸는 곳) — 배치가 없으면 아무것도 안 냄 */
export function layCss(lay: Lay | null, scope: string, order: string[]): string {
  if (!lay) return '';
  const o = layOrder(lay, order);
  const moved = o.some((s, i) => s.key !== order[i]);
  const rules = o.map((s, i) => `${scope} [data-lay-sec="${s.key}"]{${s.show ? '' : 'display:none!important;'}${moved ? `order:${i + 1};` : ''}}`).filter((r) => !r.endsWith('{}'));
  return (moved ? `${scope} [data-lay-box]{display:flex;flex-direction:column}` : '') + rules.join('');
}
