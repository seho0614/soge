'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** 공유 링크 + 복사 버튼. 클립보드가 막히면 직접 복사하시라고 알려 드립니다. */
export function CopyLink({ text }: { text: string }) {
  const t = useTranslations('refcode.copy');
  const [msg, setMsg] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(t('copied'));
    } catch {
      setMsg(t('blocked'));
    }
    setTimeout(() => setMsg(null), 2500);
  }
  return (
    <div>
      <output className="rc-link" data-refshare-link={text}>{text}</output>
      <div className="rc-act">
        <button type="button" className="rc-btn ghost" onClick={() => void copy()} data-refshare-copy="1">{t('button')}</button>
        {msg && <span className="rc-note" role="status">{msg}</span>}
      </div>
    </div>
  );
}
