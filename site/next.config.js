/* v10.95 — 다국어(next-intl · src/i18n/request.ts) */
const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts');

/* v10.177 (docs/275) — 보고만 하기 정책. 그림 · 영상은 https 어디서나(상품 그림 등) · 그 밖(스크립트 · 연결 · 끼워 넣기)은 우리 사이트만 → 밖은 보고됨 */
const CSP_REPORT_ONLY = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:", "media-src 'self' blob: https:", "font-src 'self' data:",
  "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  'report-uri /api/v1/csp-report',
].join('; ');

/** @type {import('next').NextConfig} */
module.exports = withNextIntl({
  reactStrictMode: true,
  /* v10.176 (D165 · docs/273) — 보안 머리글. 남의 사이트 안에 끼워 보이기는 막고(같은 사이트 안은 허용 — 시험 서명 · 본인인증 창),
   * 카메라 · 마이크는 끔, 위치는 우리 사이트만(동네 인증 · 맛집 지도). 스크립트 출처 제한(전체 CSP)은 화면이 깨질 위험이 커 넣지 않음 */
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/((?!api/).*)',   // /api 는 API 가 같은 머리글을 붙임(겹치지 않게)
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        /* v10.177 (docs/275) — 스크립트 출처 제한은 「보고만 하기」로 먼저(화면을 막지 않음). 브라우저가 정책 밖 출처를 /api/v1/csp-report 로 알리면
         * 운영 화면 「지켜보기」의 「정책 보고」에 모입니다. 1 ~ 2주 본 뒤 필요한 출처를 넣고 막는 정책으로 바꿀지 판단 */
        { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
      ],
    }];
  },
  /* D007 — 개발(로컬 저장소)에서는 파일 바이트가 /api 프록시(middleware)를 지납니다.
   * 기본 10MB 를 넘으면 Next 가 **조용히 잘라** 넘깁니다(→ 서버가 크기 불일치로 거절).
   * 마케팅 영상 50MB 까지 받도록 넉넉히. S3 를 쓰면 브라우저가 S3 로 직접 올려 여기를 지나지 않습니다. */
  experimental: { proxyClientMaxBodySize: '60mb' },   // v10.221 — next 16 에서 이름이 바뀜(전 middlewareClientMaxBodySize)
  /* v10.34 의 수화 오류(#418) 고침(next-loaders/hydration-replay-fix.js · webpack)은 v10.221 에서 지움 —
   * next 16 안의 React(19.3.0-canary)에 같은 고침(replaySuspendedUnitOfWork case 5 의 nextHydratableInstance 되돌림)이 들어 있고,
   * next 16 빌드(Turbopack)는 webpack 설정을 쓰지 않습니다. */
  async rewrites() {
    // 컨테이너에서는 localhost 가 자기 자신입니다(위와 같은 이유).
    const api = process.env.API_ORIGIN || 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
});
