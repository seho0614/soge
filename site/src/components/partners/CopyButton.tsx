'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** 글자를 클립보드로 복사. 권한이 없으면 직접 복사하시라고 알려 드립니다. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useTranslations('affiliate.copy');
  const [msg, setMsg] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(t('done'));
    } catch {
      setMsg(t('blocked'));
    }
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <span className="p2copy">
      <button type="button" className="btn-sm" onClick={() => void copy()}>{label ?? t('default')}</button>
      {msg && <span className="dim" role="status">{msg}</span>}
    </span>
  );
}
