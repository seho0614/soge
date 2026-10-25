/**
 * 언어별 금액 · 시각 표기 (v10.102 · 다국어 2-5c · docs/160)
 *
 *   한국어(ko)는 그동안 화면마다 쓰던 글자를 **그대로** 냅니다 — 「1,200,000원」 · 「협의」 · 「3시간 전」 · 「11월 10일」.
 *   다른 언어는 대표 결정(2026-10-25)대로 **전체 숫자**로 씁니다 — 「₩1,200,000」(억 · 만 줄임은 한국어에서만).
 *   이 파일은 순수 함수만 둡니다(서버 · 브라우저 어디서나). 화면에서는 useFmt()(lib/useFmt.ts) · getFmt()(lib/getFmt.ts)로 그 화면 언어에 묶어 씁니다.
 *   언어가 늘면 EN 자리에 그 언어 표를 더합니다(지금은 ko 밖은 모두 영어 표기).
 */
export type Loc = string;
const isKo = (loc: Loc) => loc === 'ko';

const EN = { nego: 'Negotiable', now: 'just now', h: (n: number) => `${n}h ago`, m: (n: number) => `${n} min ago`, d: (n: number) => `${n}d ago` };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 숫자만(천 단위 쉼표) — ko · en 모양이 같습니다 */
export const num = (n: number | string | null | undefined, loc: Loc) => Number(n ?? 0).toLocaleString(isKo(loc) ? 'ko-KR' : 'en-US');

/**
 * 원 금액 — ko 「1,200,000원」 · en 「₩1,200,000」.
 *   empty: 값이 없을 때 글자(화면마다 '협의' · '—' · '-' 로 달랐음 — 그 화면 것을 넘김). 'nego' 를 넘기면 ko 「협의」 · en 「Negotiable」.
 */
export function won(n: number | string | null | undefined, loc: Loc, empty: string = 'nego'): string {
  if (n == null || n === '') return empty === 'nego' ? (isKo(loc) ? '협의' : EN.nego) : empty;
  return isKo(loc) ? `${Number(n).toLocaleString('ko-KR')}원` : `₩${Number(n).toLocaleString('en-US')}`;
}

/** 이미 쉼표를 찍은 숫자 글자에 원 단위만 붙임 — ko 「1,000원」 · en 「₩1,000」 */
export const wonOf = (s: string, loc: Loc) => (isKo(loc) ? `${s}원` : `₩${s}`);

/** 만원 단위 값 — ko 「300만원」(그 화면이 쓰던 모양) · en 「₩3,000,000」 */
export const manwon = (man: number | string, loc: Loc, ko: string = `${man}만원`) => (isKo(loc) ? ko : `₩${Math.round(Number(man) * 10000).toLocaleString('en-US')}`);

/** 몇 분 · 시간 · 일 전 — ko 는 부르는 쪽이 쓰던 글자(koText)를 그대로 넘기고, 다른 언어만 여기서 만듭니다 */
export function agoEn(iso: string | null | undefined, withMinutes = false): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.round(ms / 60000));
  if (withMinutes) return m < 60 ? EN.m(m) : m < 1440 ? EN.h(Math.round(m / 60)) : EN.d(Math.round(m / 1440));   // 분 단위 화면은 분에서 반올림(한국어 도우미와 같은 셈)
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return EN.now;
  if (h < 24) return EN.h(h);
  const d = Math.floor(h / 24);
  if (d < 30) return EN.d(d);
  return ymdEn(iso);
}

/** 한국 날짜(Asia/Seoul) 조각 */
function kst(iso: string): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: v('year'), m: v('month'), d: v('day') };
}
/** 「Nov 10, 2026」 */
export function ymdEn(iso: string): string { const k = kst(iso); return `${MON[k.m - 1]} ${k.d}, ${k.y}`; }
/** 「Nov 10」 */
export function mdEn(iso: string): string { const k = kst(iso); return `${MON[k.m - 1]} ${k.d}`; }
/** 월 · 일 숫자로 — 「Nov 10」 (ko 는 부르는 쪽 글자 그대로) */
export const mdNumEn = (m: number, d: number) => `${MON[m - 1]} ${d}`;
