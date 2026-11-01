import { ImageResponse } from 'next/og';

/**
 * v10.174 (docs/268) — 카카오톡 · 문자 · 사회관계망에 주소를 붙였을 때의 미리보기 그림(1200 × 630).
 *   제 그림이 없는 화면은 모두 이것을 씁니다. 킷 안 한글 글꼴은 woff2 라 그림 만들기에 못 써서 영문 이름 · 도메인만 그립니다
 *   (제목 · 설명 글은 미리보기 글 칸에 한국어로 나감 — layout 의 openGraph). 색은 디자인 시트 --sgb-navy · --sgb-accent.
 */
export const alt = 'SoGaeBank';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 96px', background: '#00245a', color: '#fff' }}>
        <div style={{ display: 'flex', width: 96, height: 12, background: '#f5a008', marginBottom: 40 }} />
        <div style={{ display: 'flex', fontSize: 104, fontWeight: 700, letterSpacing: -2 }}>SoGaeBank</div>
        <div style={{ display: 'flex', fontSize: 40, marginTop: 24, color: '#c9d6ea' }}>P2P referral platform</div>
        <div style={{ display: 'flex', fontSize: 34, marginTop: 72, color: '#f5a008' }}>sogaebank.com</div>
      </div>
    ),
    size,
  );
}
