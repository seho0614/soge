/* v10.499 (D272 · docs/637) 소개뱅크 서비스 워커 — 오프라인 안내 화면만
 *
 *   하는 일: 화면 이동(navigate)이 네트워크 오류로 실패할 때만 미리 받아 둔 /offline.html 을 보여 줌.
 *   하지 않는 일: 앱 화면 · 그림 · 스크립트 · API 를 캐시하지 않음(옛 화면이 남지 않게) — 성공한 응답은 그대로 브라우저로.
 *   판이 바뀌면 VER 를 올림 → 새 워커가 옛 캐시를 지움. 등록 · 지우기는 components/upt/PwaRegister(운영 설정 site.pwa · 처음 off).
 *   next.config 가 이 파일에 Cache-Control: no-cache 를 붙임(워커 자체가 옛 것으로 남지 않게).
 */
const VER = 'sgb-offline-v2';
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

/* v10.538 (D283 · docs/676) 웹 푸시 — 서버(mkx/webpush.ts)가 암호화해 보낸 알림 { title · body · url · tag } 을 띄움.
 *   주소는 우리 사이트 안 경로(/ 로 시작 · // 아님)만 — 아니면 나의공간 › 알림. 누르면 열린 창을 그 주소로 옮기거나 새 창. 글을 캐시하지 않음. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = typeof d.title === 'string' && d.title ? d.title.slice(0, 80) : '소개뱅크 알림';
  const url = typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//') ? d.url : '/my/notifications';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof d.body === 'string' ? d.body.slice(0, 200) : '',
    tag: typeof d.tag === 'string' ? d.tag.slice(0, 40) : undefined,
    icon: '/pwa-icon/192', badge: '/pwa-icon/192', data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/my/notifications';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : w));
    }
    return self.clients.openWindow(url);
  }));
});
