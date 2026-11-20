import { ImageResponse } from 'next/og';

/** v10.499 (D272 · docs/637) 아이폰 홈 화면 아이콘(180) — 탭 아이콘 app/icon.tsx 와 같은 그림 · 디자인 시트 색 값(그림 만들기는 CSS 토큰을 못 읽음) */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#00245a' }}>
        <div style={{ display: 'flex', color: '#fff', fontSize: 124, fontWeight: 700, lineHeight: 1 }}>S</div>
        <div style={{ display: 'flex', width: 80, height: 16, background: '#f5a008', marginTop: 6 }} />
      </div>
    ),
    size,
  );
}
