import { ImageResponse } from 'next/og';

/** v10.174 (docs/268) — 브라우저 탭 아이콘(전에는 없어 빈 아이콘 · /favicon.ico 404). 남색 바탕에 S · 주황 밑줄(디자인 시트 색) */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#00245a', borderRadius: 6 }}>
        <div style={{ display: 'flex', color: '#fff', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>S</div>
        <div style={{ display: 'flex', width: 14, height: 3, background: '#f5a008', marginTop: 1 }} />
      </div>
    ),
    size,
  );
}
