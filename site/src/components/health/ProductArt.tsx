/**
 * 상품 그림 — 사진이 있으면 사진, 없으면 시안의 그린 그림(spec/proto.html productArt · 19611 ~ 19717)을 그대로 옮긴 것.
 *
 * 시안과 다른 곳(10/8 확인 「추천한 형태로 · 디자인은 깨지 말 것」):
 *   그림 안의 「건강기능식품」 「GMP」 **글자를 넣지 않습니다** — 시안은 건강식품 · 화장품 상품에도 이 글자가 그려졌습니다.
 *   꼴(상자 · 파우치 · 병) · 색 · 띠 · 도안 자리(선)는 그대로 둡니다. 그림에는 성분 이름 · 함량만 적습니다.
 * 서버 · 클라이언트 어디서나 씁니다(상태 없음).
 */
type Skin = { a: string; b: string; cap: string; ink: string; band: string; bandInk: string; label: string; bg: string };
const ART_SKIN: Record<string, Skin> = {
  GOLD: { a: '#f8cf4d', b: '#e0a100', cap: '#c08600', ink: '#3a2a00', band: '#e5484d', bandInk: '#ffffff', label: '#fffdf3', bg: '#f3f3f4' },
  BLUE: { a: '#2a5fd8', b: '#16359a', cap: '#122c7d', ink: '#ffffff', band: '#ffffff', bandInk: '#1e50c8', label: '#e8efff', bg: '#f3f3f4' },
  COBALT: { a: '#1d4ed8', b: '#1e3a8a', cap: '#111827', ink: '#0f2a6b', band: '#1d4ed8', bandInk: '#ffffff', label: '#ffffff', bg: '#f3f3f4' },
  DARK: { a: '#3a4048', b: '#1b1e24', cap: '#0e1014', ink: '#1d2129', band: '#1f6feb', bandInk: '#ffffff', label: '#ffffff', bg: '#f3f3f4' },
  GREEN: { a: '#3aa76d', b: '#1f7a4a', cap: '#17603a', ink: '#ffffff', band: '#ffffff', bandInk: '#1f7a4a', label: '#f2fff8', bg: '#f3f3f4' },
  ORANGE: { a: '#f08c2e', b: '#d2600a', cap: '#a94a04', ink: '#3d1e00', band: '#ffffff', bandInk: '#d2600a', label: '#fff8f0', bg: '#f3f3f4' },
  PLUM: { a: '#8b5cf6', b: '#6431c9', cap: '#4c22a0', ink: '#ffffff', band: '#ffffff', bandInk: '#6431c9', label: '#f7f2ff', bg: '#f3f3f4' },
  TEAL: { a: '#22a6a6', b: '#11767a', cap: '#0b5b5e', ink: '#ffffff', band: '#ffffff', bandInk: '#11767a', label: '#f0fdfd', bg: '#f3f3f4' },
  ROSE: { a: '#e0568a', b: '#b32b62', cap: '#8d1f4c', ink: '#ffffff', band: '#ffffff', bandInk: '#b32b62', label: '#fff2f7', bg: '#f3f3f4' },
};
const KEYS = Object.keys(ART_SKIN);

/** 색이 정해지지 않았으면 코드로 고릅니다(시안 artSkin 과 같은 식) */
function skin(code: string, tone?: string | null): Skin {
  if (tone && ART_SKIN[tone]) return ART_SKIN[tone] as Skin;
  let n = 0;
  for (let i = 0; i < code.length; i++) n += code.charCodeAt(i) * (i + 3);
  return ART_SKIN[KEYS[n % KEYS.length] as string] as Skin;
}

export interface ArtInput {
  code: string;
  art?: { form: string | null; tone: string | null } | null;
  imageUrl?: string | null;
  mainIngredient?: { name: string; amount: string | null } | null;
  name?: string;
}

/** 앞면 인쇄 — 성분 · 함량 (· 설명줄) */
function Face({ x, y, cw, ink, sub, rules, nm, am }: { x: number; y: number; cw: number; ink: string; sub: string; rules: boolean; nm: string; am: string }) {
  const cx = x + cw / 2;
  return (
    <>
      <text x={cx} y={y + 9} textAnchor="middle" fontSize="9" fontWeight="800" fill={ink} textLength={cw - 8} lengthAdjust="spacingAndGlyphs">{nm}</text>
      <text x={cx} y={y + 18} textAnchor="middle" fontSize="7" fontWeight="700" fill={ink} opacity=".88">{am}</text>
      {rules && <>
        <rect x={x + 5} y={y + 23} width={cw - 10} height="1.5" rx=".7" fill={sub} opacity=".45" />
        <rect x={x + 5} y={y + 27} width={cw - 18} height="1.5" rx=".7" fill={sub} opacity=".45" />
      </>}
    </>
  );
}
/** 도안 자리 — 시안의 원 · 네모 모양만(글자 없음) */
function Seals({ x, y, ink }: { x: number; y: number; ink: string }) {
  return (
    <>
      <circle cx={x + 5} cy={y + 6} r="4.8" fill="none" stroke={ink} strokeWidth="1" opacity=".5" />
      <rect x={x + 15} y={y + 1.8} width="24" height="8.6" rx="2" fill={ink} opacity=".1" />
    </>
  );
}

export function ProductArt({ p, size = 100, className }: { p: ArtInput; size?: number; className?: string }) {
  if (p.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={p.imageUrl} alt={p.name ?? ''} width={size} height={size} loading="lazy" />;
  }
  const k = skin(p.code, p.art?.tone);
  const u = `ar-${p.code.replace(/[^A-Za-z0-9_-]/g, '')}-${size}`;
  const nm = String(p.mainIngredient?.name ?? p.name ?? '').slice(0, 8);
  const am = String(p.mainIngredient?.amount ?? '');
  const form = p.art?.form || 'BOTTLE';
  let body;
  if (form === 'BOX') {
    body = <>
      <path d="M32 30 L41 22 L89 22 L80 30 Z" fill={k.b} />
      <path d="M80 30 L89 22 L89 86 L80 94 Z" fill={k.b} opacity=".78" />
      <rect x="32" y="30" width="48" height="64" fill={`url(#${u})`} />
      <rect x="32" y="30" width="48" height="8.5" fill={k.band} />
      <Face x={32} y={44} cw={48} ink={k.ink} sub={k.ink} rules nm={nm} am={am} />
      <Seals x={35} y={76} ink={k.ink} />
    </>;
  } else if (form === 'POUCH') {
    body = <>
      <rect x="30" y="18" width="52" height="7" fill={k.b} />
      <path d="M30 25 l4 3 l4 -3 l4 3 l4 -3 l4 3 l4 -3 l4 3 l4 -3 l4 3 l4 -3 l4 3 l4 -3 l4 3 l4 -3 v-1 h-52 z" fill={k.b} opacity=".55" />
      <path d="M30 25 h52 v65 a3 3 0 0 1 -3 3 h-46 a3 3 0 0 1 -3 -3 z" fill={`url(#${u})`} />
      <path d="M78 19 l4 3 l-4 3 z" fill={k.cap} />
      <rect x="35" y="40" width="42" height="36" rx="3" fill={k.label} />
      <Face x={35} y={44} cw={42} ink={k.cap} sub={k.cap} rules nm={nm} am={am} />
      <Seals x={37} y={78} ink="#ffffff" />
    </>;
  } else {
    body = <>
      <rect x="44" y="13" width="32" height="14" rx="2.5" fill={k.cap} />
      <rect x="47" y="16" width="1.6" height="8" fill="#fff" opacity=".22" />
      <rect x="51" y="16" width="1.6" height="8" fill="#fff" opacity=".22" />
      <rect x="67" y="16" width="1.6" height="8" fill="#fff" opacity=".22" />
      <rect x="46" y="26" width="28" height="5" fill={k.b} />
      <path d="M38 40 q0 -9 8 -9 h28 q8 0 8 9 v46 a7 7 0 0 1 -7 7 h-30 a7 7 0 0 1 -7 -7 z" fill={`url(#${u})`} />
      <rect x="38" y="44" width="44" height="40" fill={k.label} />
      <rect x="38" y="44" width="44" height="3.5" fill={k.band} />
      <Face x={38} y={49} cw={44} ink={k.cap} sub={k.cap} rules={false} nm={nm} am={am} />
      <Seals x={40} y={71} ink={k.cap} />
      <rect x="42" y="36" width="3" height="52" rx="1.5" fill="#fff" opacity=".18" />
    </>;
  }
  return (
    <svg className={className} viewBox="0 0 112 112" width={size} height={size} role="img" focusable="false"
         aria-label={`${nm} ${am} 상품 그림 (직접 그린 그림입니다)`} data-art={form}>
      <defs><linearGradient id={u} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={k.a} /><stop offset="1" stopColor={k.b} /></linearGradient></defs>
      <rect width="112" height="112" fill={k.bg} />
      <ellipse cx="56" cy="97" rx="26" ry="4" fill="#000" opacity=".08" />
      <g transform="translate(0,3)">{body}</g>
    </svg>
  );
}

/** 배지 톱니(시안 rosette) — 「신규입점」 「특별가격」 */
export function Rosette({ label }: { label: string }) {
  let d = '';
  for (let i = 0; i < 36; i++) {
    const a = (Math.PI * 2 * i) / 36;
    const r = i % 2 ? 19.5 : 23;
    d += `${i ? 'L' : 'M'}${(25 + r * Math.cos(a)).toFixed(1)} ${(25 + r * Math.sin(a)).toFixed(1)} `;
  }
  const two = label.length > 2;
  return (
    <svg className="hlt-rose" viewBox="0 0 50 50" width="46" height="46" role="img" aria-label={label} focusable="false" data-badge={label}>
      <path d={`${d}Z`} fill="#2fa84f" />
      {two ? <>
        <text x="25" y="23" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">{label.slice(0, 2)}</text>
        <text x="25" y="35" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">{label.slice(2, 4)}</text>
      </> : <text x="25" y="30" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">{label}</text>}
    </svg>
  );
}
