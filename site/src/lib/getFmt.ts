/**
 * 그 화면 언어에 묶은 금액 · 시각 표기(v10.102 · docs/160) — async 서버 부품에서.
 *   const f = await getFmt();  사용법은 useFmt 와 같습니다.
 */
import { getLocale } from 'next-intl/server';
import { bind } from './fmtBind';

export async function getFmt() {
  return bind(await getLocale());
}
