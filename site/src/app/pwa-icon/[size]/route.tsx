import { ImageResponse } from 'next/og';

/**
 * v10.499 (D272 · docs/637) 앱 아이콘 — /pwa-icon/192 · /pwa-icon/512 · /pwa-icon/maskable(512 · 가장자리 여백 — 둥근 모양으로 잘려도 S 가 남게)
 *   탭 아이콘(app/icon.tsx)과 같은 그림 · 같은 색(디자인 시트 --sgb-navy · --sgb-accent 값 — 그림 만들기는 CSS 토큰을 읽지 못해 값을 적음)
 *   따로 그린 로고 그림 파일이 저장소에 없어(site/public) 글자 그림으로 만듦 — 로고 원본이 정해지면 바꿈(docs/637 4절)
 */
export const dynamic = 'force-static';
export function generateStaticParams() { return [{ size: '192' }, { size: '512' }, { size: 'maskable' }]; }

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const px = size === '192' ? 192 : 512;
  const mask = size === 'maskable';
  const inner = mask ? Math.round(px * 0.62) : px;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#00245a', borderRadius: mask ? 0 : Math.round(px * 0.19) }}>
        <div style={{ width: inner, height: inner, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', color: '#fff', fontSize: Math.round(inner * 0.69), fontWeight: 700, lineHeight: 1 }}>S</div>
          <div style={{ display: 'flex', width: Math.round(inner * 0.44), height: Math.max(3, Math.round(inner * 0.09)), background: '#f5a008', marginTop: Math.round(inner * 0.03) }} />
        </div>
      </div>
    ),
    { width: px, height: px },
  );
}
