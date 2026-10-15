/**
 * 소개몰 그림 조각 — 받은 제시 그림(JPEG)에서 **다시 압축하지 않고** 자른 파일입니다(public/shop · qa/cut_mall.py).
 * 손실 없이 자르면 왼쪽 · 위가 16점 칸에 맞춰져 조금 넉넉합니다. assets.json 의 inner(보일 자리)만 보이게 상자에 넣습니다.
 * 원본 PNG 가 오면 파일과 assets.json 만 바꿉니다. next/image 는 다른 형식으로 바꿔 내주므로 쓰지 않습니다.
 */
import assets from './assets.json';

type Part = { file: string; inner: number[]; w: number; h: number };
const PARTS = assets.parts as Record<string, Part>;

/** h(높이) 또는 w(폭)에 맞춰 같은 비율로 넣습니다. 둘 다 주지 않으면 그림의 크기 그대로(받은 그림 1092px = 화면 1500px)입니다. */
export function ShopPic({ name, h, w, className }: { name: string; h?: number; w?: number; className?: string }) {
  const a = PARTS[name];
  if (!a) return null;
  const x0 = a.inner[0] ?? 0, y0 = a.inner[1] ?? 0, x1 = a.inner[2] ?? a.w, y1 = a.inner[3] ?? a.h;
  const s = h ? h / (y1 - y0) : w ? w / (x1 - x0) : 1500 / 1092;
  const r = Math.round;
  return (
    <span className={`shop-pic${className ? ` ${className}` : ''}`} style={{ width: r((x1 - x0) * s), height: r((y1 - y0) * s) }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/shop/${a.file}`} alt="" width={r(a.w * s)} height={r(a.h * s)} style={{ left: -r(x0 * s), top: -r(y0 * s) }} />
    </span>
  );
}
