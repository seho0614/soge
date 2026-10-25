/**
 * 그 화면 언어에 묶은 금액 · 시각 표기(v10.102 · docs/160) — 브라우저 부품과 async 가 아닌 서버 부품에서.
 *   const f = useFmt();  f.won(12000) → ko 「12,000원」 · en 「₩12,000」 ·  f.ko 로 한국어인지 봅니다.
 *   async 서버 부품은 getFmt()(lib/getFmt.ts).
 */
import { useLocale } from 'next-intl';
import { bind } from './fmtBind';

export function useFmt() {
  return bind(useLocale());
}
