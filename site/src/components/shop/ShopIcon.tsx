/**
 * v10.183 (docs/286) — 받은 그림(아이콘 20개)에 없는 성분 · 고민 아이콘 5개.
 *   전에는 글자(「멀」 · 「M」)나 서버 이모지(🌙 📉 🔋)가 나와 줄이 고르지 않았습니다(이모지는 기기마다 모양도 다름).
 *   받은 그림과 같은 납작한 색 그림 · 같은 자리 크기(48px). 그림을 새로 받으면 ShopPic 으로 바꾸면 됩니다.
 */
import type { ReactElement } from 'react';

const ICONS: Record<string, ReactElement> = {
  /* 멀티비타민 — 색이 다른 알약 셋 */
  MULTI: (
    <>
      <rect x="6" y="20" width="22" height="11" rx="5.5" transform="rotate(-35 17 25.5)" fill="#f59e0b" />
      <rect x="6" y="20" width="11" height="11" rx="5.5" transform="rotate(-35 17 25.5)" fill="#fbbf24" />
      <rect x="20" y="10" width="20" height="10" rx="5" transform="rotate(20 30 15)" fill="#ef4444" />
      <rect x="20" y="10" width="10" height="10" rx="5" transform="rotate(20 30 15)" fill="#fca5a5" />
      <circle cx="31" cy="34" r="7" fill="#22c55e" />
      <path d="M26.5 34h9" stroke="#bbf7d0" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  /* MSM — 무릎 관절(뼈 둘 · 연골) */
  MSM: (
    <>
      <path d="M17 4h10v13c0 2-2 3.5-5 3.5s-5-1.5-5-3.5z" fill="#cbd5e1" />
      <path d="M17 44h10V31c0-2-2-3.5-5-3.5S17 29 17 31z" fill="#cbd5e1" />
      <ellipse cx="22" cy="24" rx="9" ry="3.2" fill="#60a5fa" />
      <path d="M9 18c-2 3-2 9 0 12M35 18c2 3 2 9 0 12" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  /* 수면 · 스트레스 — 달 · 별 */
  SLEEP: (
    <>
      <path d="M30 8a16 16 0 1 0 8 27A13 13 0 0 1 30 8z" fill="#fbbf24" />
      <path d="M36 9l1.2 2.6 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z" fill="#a78bfa" />
      <circle cx="13" cy="10" r="1.6" fill="#a78bfa" />
    </>
  ),
  /* 혈당 — 핏방울 · 내려가는 선 */
  GLUCOSE: (
    <>
      <path d="M17 6c5 7 9 12 9 17a9 9 0 0 1-18 0c0-5 4-10 9-17z" fill="#ef4444" />
      <path d="M13 23a4 4 0 0 0 4 4" stroke="#fecaca" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M27 31l5-6 4 4 6-9" stroke="#3b82f6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M27 40h15" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  /* 피로회복 — 차오르는 건전지 · 번개 */
  FATIGUE: (
    <>
      <rect x="13" y="8" width="20" height="34" rx="4" fill="#dcfce7" stroke="#16a34a" strokeWidth="2.4" />
      <rect x="18" y="4" width="10" height="5" rx="1.5" fill="#16a34a" />
      <rect x="16" y="24" width="14" height="15" rx="2" fill="#22c55e" />
      <path d="M24.5 12l-6 11h5l-2 9 7-12h-5z" fill="#facc15" stroke="#ca8a04" strokeWidth="1" strokeLinejoin="round" />
    </>
  ),
};

export function hasShopIcon(code: string): boolean {
  return code in ICONS;
}

export function ShopIcon({ code }: { code: string }) {
  const g = ICONS[code];
  if (!g) return null;
  return <svg className="shop-ico" width="48" height="48" viewBox="0 0 48 48" aria-hidden>{g}</svg>;
}
