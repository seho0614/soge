import type { MetadataRoute } from 'next';

/**
 * v10.499 (D272 · docs/637) 앱처럼 설치 — 웹 앱 정보(/manifest.webmanifest · Next 가 <link rel="manifest"> 를 붙임)
 *   아이콘은 /pwa-icon/192 · 512 · maskable(app/pwa-icon · 탭 아이콘 app/icon.tsx 와 같은 그림 — 남색 바탕 S · 주황 밑줄)
 *   색은 디자인 시트 값(--sgb-navy #00245a · --sgb-bg #f5f7fa) — 이 파일은 CSS 밖이라 토큰 이름을 쓸 수 없어 값을 적음(sgb-tokens.css 를 바꾸면 여기도)
 *   서비스 워커 등록은 운영 설정 site.pwa(처음 off · components/upt/PwaRegister) — 이 정보만 있어서는 아무것도 캐시하지 않음
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '소개뱅크',
    short_name: '소개뱅크',
    description: '개인 · 사업자 누구나 거래처 · 매물 · 창업 자리를 소개하고 소개비를 받는 P2P 소개 플랫폼',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'ko',
    background_color: '#f5f7fa',
    theme_color: '#00245a',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
