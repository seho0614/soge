/* ===== v10.474 (D265 · docs/612) QR 그림 — web/src/lib/qr.ts 새 파일 =====
 * 대표 11/20 「㉟ ④ 고정자산 QR 라벨 — 새 npm 의존성 없이」.
 *   qrMatrix(text) — 바이트 방식 · 오류 정정 M(약 15%) · 판 1 ~ 10(글자 수에 맞춰 가장 작은 판) · 마스크 8개 중 벌점이 가장 낮은 것
 *   qrSvg(text, cell, quiet) — 인쇄 창에 넣을 SVG 글자(검정 칸 하나의 path · 둘레 여백 4칸)
 *   QR 표준(ISO/IEC 18004)의 공개된 셈 그대로(리드 솔로몬 · BCH 형식 · 판 정보) — 자산 코드(SGB-AST-000123 · 14자)는 판 1(21 × 21)에 들어감.
 *   ★ 휴대폰 · 리더기로 실제 읽히는지는 합친 뒤 화면에서 한 번 확인(NOTES) — 코드 글자를 라벨에 함께 찍어 못 읽혀도 손으로 적을 수 있음.
 */

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VER = 10;

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function rawModules(ver: number) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK_M[ver]! * BLOCKS_M[ver]!;

function gfMul(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree: number) {
  const r: number[] = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < r.length) r[j] = r[j]! ^ r[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data: number[], div: number[]) {
  const r: number[] = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    div.forEach((c, i) => { r[i] = r[i]! ^ gfMul(c, f); });
  }
  return r;
}

function alignPositions(ver: number, size: number) {
  if (ver === 1) return [] as number[];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** 글자 → QR 칸(true = 검정) · 너무 길면(판 10 넘음) Error */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= MAX_VER; ver++) {
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > MAX_VER) throw new Error('QR: 글자가 너무 깁니다');
  const size = ver * 4 + 17;
  const capBits = dataCodewords(ver) * 8;

  /* 1. 비트 묶음 — 방식(0100 바이트) · 글자 수 · 글자 · 끝 표시 · 바이트 맞춤 · 채움(EC 11) */
  const bb: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bb.push((v >>> i) & 1); };
  put(0x4, 4); put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capBits - bb.length));
  put(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bb.length; i += 8) data.push(bb.slice(i, i + 8).reduce((a, x) => (a << 1) | x, 0));

  /* 2. 블록마다 오류 정정 · 섞기 */
  const nBlocks = BLOCKS_M[ver]!, eccLen = ECC_PER_BLOCK_M[ver]!, raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const words: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]!); });
  }

  /* 3. 기능 무늬 — 찾기 · 타이밍 · 정렬 · 형식(자리) · 판 정보 */
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, d: boolean) => { m[y]![x] = d; fn[y]![x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
    }
  }
  const al = alignPositions(ver, size);
  al.forEach((ay, i) => al.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask: number) => {
    const d = (0 << 3) | mask;   // 오류 정정 M = 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6)); set(8, 8, bit(bits, 7)); set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit(bits, i)); set(b, a, bit(bits, i));
    }
  }

  /* 4. 자료 칸 — 오른쪽 아래부터 두 줄씩 지그재그 */
  let p = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
      if (!fn[y]![x] && p < words.length * 8) { m[y]![x] = bit(words[p >>> 3]!, 7 - (p & 7)); p++; }
    }
  }

  /* 5. 마스크 — 8개 중 벌점이 가장 낮은 것(벌점은 읽기 쉬움만 가름 · 어느 마스크든 표준에 맞음) */
  const maskOn = (k: number, x: number, y: number) => {
    switch (k) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const flip = (k: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y]![x] && maskOn(k, x, y)) m[y]![x] = !m[y]![x]; };
  const penalty = () => {
    let s = 0, dark = 0;
    for (let i = 0; i < size; i++) {
      for (const line of [m[i]!, m.map((r) => r[i]!)]) {
        let run = 1;
        for (let k = 1; k <= size; k++) {
          if (k < size && line[k] === line[k - 1]) run++;
          else { if (run >= 5) s += run - 2; run = 1; }
        }
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y]![x];
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) s += 3;
    }
    for (const r of m) for (const c of r) if (c) dark++;
    return s + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0, bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    flip(k); drawFormat(k);
    const sc = penalty();
    if (sc < bestScore) { bestScore = sc; best = k; }
    flip(k);
  }
  flip(best); drawFormat(best);
  return m;
}

/** 글자 → SVG(검정 칸 path · 흰 바탕 · 둘레 quiet 칸 여백) — 인쇄 창에 그대로 넣음 */
export function qrSvg(text: string, cell = 4, quiet = 4): string {
  const m = qrMatrix(text);
  const n = m.length + quiet * 2, px = n * cell;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${n}" height="${n}" fill="white"/><path d="${d}" fill="black"/></svg>`;
}
