/**
 * 다국어 — 언어 정하기 · 사전 (v10.95 · 2-1 · docs/148 · docs/153)
 *
 *   다국어(i18n.enabled)가 꺼져 있으면 쿠키를 읽지 않고 늘 한국어 — 화면 · 캐시가 전과 같습니다.
 *   켜져 있으면 쿠키 sgb_lang 의 언어(켜진 언어만) · 없으면 한국어.
 *   사전은 한국어(ko.json)를 바탕으로 그 언어 사전을 덮습니다 — 영어 문장이 빠진 곳은 한국어가 나갑니다(빈칸 금지).
 */
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { apiGet } from '@/lib/api';
import ko from './messages/ko.json';

export const LANG_COOKIE = 'sgb_lang';
export interface LangInfo { enabled: boolean; items: { code: string; name: string; rtl: boolean }[] }

type Dict = { [k: string]: string | Dict };
function merge(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? merge(b, v) : v;
  }
  return out;
}

export async function langInfo(): Promise<LangInfo> {
  return apiGet<LangInfo>('/i18n/langs', 60).catch(() => ({ enabled: false, items: [{ code: 'ko', name: '한국어', rtl: false }] }));
}

export default getRequestConfig(async () => {
  const info = await langInfo();
  let locale = 'ko';
  if (info.enabled) {
    const c = (await cookies()).get(LANG_COOKIE)?.value;
    if (c && info.items.some((i) => i.code === c)) locale = c;
  }
  const messages = locale === 'ko' ? ko
    : merge(ko as Dict, (await import(`./messages/${locale}.json`).then((m) => m.default as Dict).catch(() => ({}) as Dict)));
  return { locale, messages };
});
