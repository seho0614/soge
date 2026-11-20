/* v10.499 (D272 · docs/637) 소개뱅크 서비스 워커 — 오프라인 안내 화면만
 *
 *   하는 일: 화면 이동(navigate)이 네트워크 오류로 실패할 때만 미리 받아 둔 /offline.html 을 보여 줌.
 *   하지 않는 일: 앱 화면 · 그림 · 스크립트 · API 를 캐시하지 않음(옛 화면이 남지 않게) — 성공한 응답은 그대로 브라우저로.
 *   판이 바뀌면 VER 를 올림 → 새 워커가 옛 캐시를 지움. 등록 · 지우기는 components/upt/PwaRegister(운영 설정 site.pwa · 처음 off).
 *   next.config 가 이 파일에 Cache-Control: no-cache 를 붙임(워커 자체가 옛 것으로 남지 않게).
 */
const VER = 'sgb-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VER).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;   // 화면 이동만 — 그 밖은 손대지 않음
  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE).then((m) => m || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))),
  );
});
