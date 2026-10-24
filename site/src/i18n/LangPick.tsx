/** 서버에서 — 다국어가 꺼져 있거나 언어가 하나면 아무것도 그리지 않음(언어 단추 숨김 · multilingual-i18n #8) */
import { getLocale } from 'next-intl/server';
import { langInfo } from './request';
import { LangSwitch } from './LangSwitch';

export async function LangPick() {
  const info = await langInfo();
  if (!info.enabled || info.items.length < 2) return null;
  return <LangSwitch items={info.items.map(({ code, name }) => ({ code, name }))} locale={await getLocale()} />;
}
