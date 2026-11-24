'use client';
import { useEffect } from 'react';

/* v10.722 (D325 · docs/830) 꾸밀 페이지 방문 한 번 — 화면이 열리면 한 번(같은 탭 다시 열면 안 보냄 · 서버도 같은 기기 같은 날 한 번)
 *   쿠키 · 계정 · 위치를 보내지 않음 · 실패해도 화면과 상관없음 · DNT 켠 브라우저는 보내지 않음 · 미리보기(?lp=)는 세지 않음 */
export function LayoutViewPing({ k }: { k: string }) {
  useEffect(() => {
    const key = `slv:${k}`;
    try {
      if (navigator.doNotTrack === '1' || sessionStorage.getItem(key) || /[?&]lp=/.test(location.search)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* 저장소를 못 써도 한 번은 보냄(서버가 거름) */ }
    const v = /(?:^|;\s*)sgb_ab=([ab])/.exec(document.cookie)?.[1];   // v10.760 A/B 비교 판(비교가 없으면 서버가 무시)
    fetch(`/api/v1/site-layouts/${encodeURIComponent(k)}/view${v ? `?v=${v}` : ''}`, { method: 'POST', keepalive: true, credentials: 'omit' }).catch(() => undefined);
  }, [k]);
  return null;
}
