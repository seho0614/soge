/** useFmt · getFmt 가 함께 쓰는 묶음(v10.102 · docs/160) — 함수는 lib/fmt.ts */
import * as F from './fmt';

export function bind(loc: string) {
  return {
    loc,
    ko: loc === 'ko',
    num: (n: number | string | null | undefined) => F.num(n, loc),
    won: (n: number | string | null | undefined, empty?: string) => F.won(n, loc, empty),
    wonOf: (s: string) => F.wonOf(s, loc),
    manwon: (man: number | string, ko?: string) => F.manwon(man, loc, ko),
    /** ko 는 koText 그대로, 다른 언어는 영어 「3h ago」 */
    ago: (iso: string | null | undefined, koText: string, withMinutes = false) => (loc === 'ko' ? koText : F.agoEn(iso, withMinutes)),
    /** ko 는 koText 그대로, 다른 언어는 「Nov 10」 · 「Nov 10, 2026」 */
    md: (iso: string, koText: string) => (loc === 'ko' ? koText : F.mdEn(iso)),
    ymd: (iso: string, koText: string) => (loc === 'ko' ? koText : F.ymdEn(iso)),
    mdNum: (m: number, d: number, koText: string) => (loc === 'ko' ? koText : F.mdNumEn(m, d)),
  };
}
export type Fmt = ReturnType<typeof bind>;
