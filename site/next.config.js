/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  /* D007 — 개발(로컬 저장소)에서는 파일 바이트가 /api 프록시(middleware)를 지납니다.
   * 기본 10MB 를 넘으면 Next 가 **조용히 잘라** 넘깁니다(→ 서버가 크기 불일치로 거절).
   * 마케팅 영상 50MB 까지 받도록 넉넉히. S3 를 쓰면 브라우저가 S3 로 직접 올려 여기를 지나지 않습니다. */
  experimental: { middlewareClientMaxBodySize: '60mb' },
  /* v10.34 — 수화 오류(#418 · 부하 속에서만 드물게) 고침: 브라우저용 react-dom 에 React 19.3.0 의 고침 한 군데를 붙입니다.
   * 까닭 · 범위는 next-loaders/hydration-replay-fix.js 머리말. 서버 쪽 번들은 건드리지 않습니다. */
  webpack(config, { isServer }) {
    if (!isServer) {
      config.module.rules.unshift({
        test: /[\\/]next[\\/]dist[\\/]compiled[\\/]react-dom(-experimental)?[\\/]cjs[\\/]react-dom-client\.(production|development)\.js$/,
        enforce: 'pre',
        use: [{ loader: require('path').resolve(__dirname, 'next-loaders/hydration-replay-fix.js') }],
      });
    }
    return config;
  },
  async rewrites() {
    // 컨테이너에서는 localhost 가 자기 자신입니다(위와 같은 이유).
    const api = process.env.API_ORIGIN || 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
