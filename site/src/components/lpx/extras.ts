import { cache } from 'react';
import { apiGet } from '@/lib/api';

/**
 * v10.549 ~ 552 (D286 · docs/687 ~ 690) 매물 상세 덧붙임 정보 — 공개 GET /site/lpx/listings/{id}(로그인 없음 · 개인정보 없음 · 30초 캐시)
 *   한 요청 안에서 사진 워터마크(LpxPhotoMark) · 자리 비움(LpxAwayNote) · 가격 제안(LpxOfferBox)이 같은 응답을 씀(cache)
 *   API 가 없거나 실패하면 모두 꺼진 값 — 지금 화면 그대로
 */
export interface LpxExtras {
  watermark: { on: boolean; text: string; pos: 'BR' | 'BL' | 'TR' | 'TL' | 'C' | 'TILE'; opacity: number };
  away: { startsOn: string; endsOn: string; message: string | null } | null;
  offer: { enabled: boolean };
  stats: { ym: string; n: number; median: string; area: string; allCategories: boolean } | null;
}

const OFF: LpxExtras = { watermark: { on: false, text: '', pos: 'BR', opacity: 35 }, away: null, offer: { enabled: false }, stats: null };

export const lpxExtras = cache((id: string) => apiGet<LpxExtras>(`/site/lpx/listings/${encodeURIComponent(id)}`, 30).catch(() => OFF));
