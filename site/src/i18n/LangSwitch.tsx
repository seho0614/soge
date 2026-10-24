'use client';
/**
 * 언어 단추 (v10.95 · 2-1) — 다국어가 켜져 있고 켜진 언어가 둘 이상일 때만 그립니다(LangPick).
 * 고르면 쿠키 sgb_lang(1년)을 쓰고, 로그인한 회원이면 서버에도 저장(PUT /me/lang · 로그인 안 했으면 401 은 그냥 둠) → 화면을 다시 받습니다.
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';

export function LangSwitch({ items, locale }: { items: { code: string; name: string }[]; locale: string }) {
  const t = useTranslations('lang');
  const router = useRouter();
  const [busy, start] = useTransition();
  const pick = (code: string) => start(async () => {
    document.cookie = `sgb_lang=${code}; path=/; max-age=31536000; samesite=lax`;
    await fetch('/api/v1/me/lang', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: code }) }).catch(() => null);
    router.refresh();
  });
  return (
    <label className="lang-pick" data-lang-pick="">
      <span className="sr-only">{t('label')}</span>
      <select value={locale} disabled={busy} onChange={(e) => pick(e.target.value)} aria-label={t('label')}>
        {items.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}
