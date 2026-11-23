'use client';
import { useEffect } from 'react';

/* v10.667 (D315 · docs/795) 관 페이지 방문 한 번 — 화면이 열리면 한 번 보냄(같은 탭에서 다시 열면 안 보냄 · 서버도 같은 기기 같은 날 한 번)
 *   쿠키 · 계정 · 위치를 보내지 않음 · 실패해도 화면과 상관없음 · DNT 켠 브라우저는 보내지 않음 */
export function ViewPing({ code, slug }: { code: string; slug: string }) {
  useEffect(() => {
    const k = `gpv:${code}:${slug}`;
    try {
      if (navigator.doNotTrack === '1' || sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, '1');
    } catch { /* 저장소를 못 써도 한 번은 보냄(서버가 거름) */ }
    fetch(`/api/v1/gwans/${encodeURIComponent(code)}/pages/${encodeURIComponent(slug)}/view`, { method: 'POST', keepalive: true, credentials: 'omit' }).catch(() => undefined);
  }, [code, slug]);
  return null;
}
