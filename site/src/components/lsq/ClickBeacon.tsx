'use client';
import { useEffect } from 'react';

/**
 * v10.604 (docs/746) 검색 클릭 분석 — 통합 검색 결과에서 매물 줄(a[data-lsq-pos])을 누르면 한 번 POST /api/v1/site/lsq/search-click
 *   보내는 것: 검색어 · 누른 매물 번호 · 결과 안 순위(광고 줄 제외) · 관 탭 — 그뿐입니다.
 *   보내지 않는 것: 계정 · 방문자 번호 · 쿠키 · 브라우저 정보(서버도 저장하지 않음 · 날 × 낱말 × 순위 수만 셈).
 *   브라우저 「추적 안 함」(DNT) · GPC 이면 보내지 않음 · 서버 스위치(lsq.search_click)가 꺼져 있으면 서버가 받지 않음.
 */
export function LsqClickBeacon({ q, gwan }: { q: string; gwan: string }) {
  useEffect(() => {
    if (!q) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return;
    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as Element | null)?.closest?.('a[data-lsq-pos]');
      if (!a) return;
      const pos = Number(a.getAttribute('data-lsq-pos'));
      if (!Number.isInteger(pos) || pos < 1 || pos > 100) return;
      const json = JSON.stringify({ q: q.slice(0, 80), listingId: a.getAttribute('data-lsq-id') || undefined, pos, gwan });
      try {
        const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/v1/site/lsq/search-click', new Blob([json], { type: 'application/json' }));
        if (!sent) void fetch('/api/v1/site/lsq/search-click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => undefined);
      } catch { /* 보내지 못해도 화면 이동은 그대로 */ }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [q, gwan]);
  return null;
}
