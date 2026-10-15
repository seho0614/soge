'use client';
import { useState } from 'react';

/** 글자를 클립보드로 복사. 권한이 없으면 직접 복사하시라고 알려 드립니다. */
export function CopyButton({ text, label = '복사하기' }: { text: string; label?: string }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('복사했습니다.');
    } catch {
      setMsg('브라우저가 복사를 막았습니다. 글자를 길게 눌러 직접 복사해 주십시오.');
    }
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <span className="p2copy">
      <button type="button" className="btn-sm" onClick={() => void copy()}>{label}</button>
      {msg && <span className="dim" role="status">{msg}</span>}
    </span>
  );
}
