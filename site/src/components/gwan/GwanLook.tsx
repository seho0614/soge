import type { CSSProperties } from 'react';

/* ---------------------------------------------------------------------
 * v10.663 (D314 · docs/795) 관 아이콘 · 대표 색 — 운영 화면 › 관 관리 › 관 설정 › 기본 정보에서 고른 이름
 *   아이콘은 정해 둔 12개(선 그림 · 글자 색을 따름) · 색은 디자인 시트 관 색(sgb-tokens.css --sgb-<이름>)만 — 모르는 이름은 그리지 않음
 *   이름 목록은 서버 GWAN_ICONS · GWAN_COLORS · DB gwans_icon_check · gwans_color_check 와 같게
 * ------------------------------------------------------------------- */

const ICON_PATH: Record<string, string> = {
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5',
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  briefcase: 'M3 8h18v12H3zM9 8V5h6v3',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  car: 'M3 16v-4l2-5h14l2 5v4zM7 16v2M17 16v2',
  tool: 'M14 6l4 4-9 9H5v-4z',
  leaf: 'M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  cart: 'M3 4h2l2 11h11l2-8H6M9 20h.01M17 20h.01',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .5 3 2 3 5',
  gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-2-4-6-4-6-1s6 1 6 1M12 9c2-4 6-4 6-1s-6 1-6 1',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
};
const COLORS = ['money', 'mall', 'biz', 'shop', 'plaza', 'navy', 'link'];

export function GwanIcon({ name, size = 22, label }: { name?: string | null; size?: number; label?: string }) {
  const d = name ? ICON_PATH[name] : undefined;
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
         role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-gwan-icon={name} style={{ verticalAlign: '-4px', flex: 'none' }}>
      <path d={d} />
    </svg>
  );
}

/** 대표 색 — 모르는 이름이면 undefined(기본 모양) */
export const gwanColor = (c?: string | null): string | undefined => (c && COLORS.includes(c) ? `var(--sgb-${c})` : undefined);

/** 관 머리(page-head) 꾸밈 — 위 굵은 선 · 제목 색 */
export function gwanHeadStyle(c?: string | null): CSSProperties | undefined {
  const v = gwanColor(c);
  return v ? { borderTop: `4px solid ${v}` } : undefined;
}
