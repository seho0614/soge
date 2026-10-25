'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** v10.27 (G-130) — 글자 복사 단추(송장번호 등). 복사가 막힌 브라우저면 글자를 골라 두고 안내합니다 */
export function CopyText({ text, label }: { text: string; label?: string }) {
  const t = useTranslations('order');
  const [done, setDone] = useState<null | 'ok' | 'manual'>(null);
  return (
    <button type="button" className="hlt-btn sm" data-copy={text}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone('ok'); }
        catch { setDone('manual'); }
      }}>
      {done === 'ok' ? t('copy.copied') : done === 'manual' ? t('copy.manual') : label ?? t('copy.copy')}
    </button>
  );
}
