'use client';
/**
 * v10.499 (D272 · docs/637) 앱처럼 설치(PWA) — 서비스 워커 등록
 *   켜기: 운영 설정 site.pwa = on(처음 off) 이고 운영 빌드(NODE_ENV=production)일 때만 /sw.js 등록 — 개발 · 점검판 화면이 옛 것으로 남지 않게
 *   끄기: site.pwa 를 off 로 돌리면 이미 등록된 우리 서비스 워커를 지우고 우리 캐시(sgb-offline-*)도 지움(되돌리는 스위치)
 *   서비스 워커는 화면 이동이 실패할 때 오프라인 안내(/offline.html)만 보여 줌 — 화면 · 그림 · API 를 캐시하지 않음(public/sw.js)
 */
import { useEffect } from 'react';

export function PwaRegister({ on }: { on: boolean }) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (on && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
      return;
    }
    navigator.serviceWorker.getRegistrations().then((rs) => {
      for (const r of rs) {
        const u = r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? '';
        if (u.endsWith('/sw.js')) void r.unregister();
      }
    }).catch(() => undefined);
    if (typeof caches !== 'undefined') {
      caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sgb-offline-')).map((k) => caches.delete(k)))).catch(() => undefined);
    }
  }, [on]);
  return null;
}
