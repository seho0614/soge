'use client';
import { useState } from 'react';

/** 공유 링크 + 복사 버튼. 클립보드가 막히면 직접 복사하시라고 알려 드립니다. */
export function CopyLink({ text }: { text: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('복사했습니다.');
    } catch {
      setMsg('브라우저가 복사를 막았습니다. 링크를 길게 눌러 직접 복사해 주십시오.');
    }
    setTimeout(() => setMsg(null), 2500);
  }
  return (
    <div>
      <output className="rc-link" data-refshare-link={text}>{text}</output>
      <div className="rc-act">
        <button type="button" className="rc-btn ghost" onClick={() => void copy()} data-refshare-copy="1">링크 복사</button>
        {msg && <span className="rc-note" role="status">{msg}</span>}
      </div>
    </div>
  );
}
