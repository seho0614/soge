'use client';
/**
 * 브라우저에서 그리는 화면(메인 HomeView 등)용 언어 단추 — 켜진 언어를 브라우저에서 받아(GET /api/v1/i18n/langs)
 * 다국어가 켜져 있고 언어가 둘 이상일 때만 LangSwitch 를 그립니다. 꺼져 있으면 아무것도 그리지 않음(전과 같음). v10.95
 */
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { LangSwitch } from './LangSwitch';

export function LangAuto() {
  const locale = useLocale();
  const [items, setItems] = useState<{ code: string; name: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/v1/i18n/langs', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.enabled && Array.isArray(j.items) && j.items.length > 1) setItems(j.items); })
      .catch(() => { /* 못 받으면 단추 없음 */ });
    return () => { live = false; };
  }, []);
  return items ? <LangSwitch items={items} locale={locale} /> : null;
}
