'use client';
import { useState } from 'react';

/** v10.27 (G-130) — 글자 복사 단추(송장번호 등). 복사가 막힌 브라우저면 글자를 골라 두고 안내합니다 */
export function CopyText({ text, label = '복사' }: { text: string; label?: string }) {
  const [done, setDone] = useState<null | 'ok' | 'manual'>(null);
  return (
    <button type="button" className="hlt-btn sm" data-copy={text}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone('ok'); }
        catch { setDone('manual'); }
      }}>
      {done === 'ok' ? '복사했습니다' : done === 'manual' ? '길게 눌러 복사하십시오' : label}
    </button>
  );
}
