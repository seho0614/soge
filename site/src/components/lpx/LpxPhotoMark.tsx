import type { ReactNode } from 'react';
import { lpxExtras } from './extras';
import '@/styles/lpx.css';

/**
 * v10.550 (D286 · docs/688) 매물 사진 워터마크 — 서버 부품
 *   원본 사진 바이트는 그대로(새 npm 없음 · 그림 도구 없음) — 사진 칸(GwPhotos) 위에 「SogaeBank/소개뱅크」 글자를 CSS 로 겹침
 *   스위치(lpx.watermark · 처음 off)가 꺼져 있거나 올린 사진이 없으면 감싸기만 하고 아무것도 더하지 않음(지금 화면 그대로)
 *   글자는 누르기를 막지 않음(pointer-events none) · 화면 읽기 프로그램은 건너뜀(aria-hidden)
 */
export async function LpxPhotoMark({ listingId, has, children }: { listingId: string; has: boolean; children: ReactNode }) {
  const x = has ? await lpxExtras(listingId) : null;
  const m = x?.watermark;
  if (!m?.on || !m.text) return <>{children}</>;
  const style = { opacity: m.opacity / 100 };
  return (
    <div className="lpx-wm-wrap" data-lpx-wm={m.pos}>
      {children}
      {m.pos === 'TILE'
        ? <span className="lpx-wm-tile" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="lpx-wm" style={style}>{m.text}</span>)}</span>
        : <span className={`lpx-wm lpx-wm-${m.pos.toLowerCase()}`} style={style} aria-hidden="true">{m.text}</span>}
    </div>
  );
}
