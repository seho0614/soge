'use client';
/** v10.598 (docs/740) 첫 거래 안내 「그만 보기」 — POST /api/v1/me/grw/first-steps/hide { hidden: true } · 글자는 서버 화면이 넘겨 줌(grw.first 사전) */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FirstStepsHide({ labels }: { labels: { hide: string; failed: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function hide() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/me/grw/first-steps/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: true }) });
      if (!r.ok) { setErr(labels.failed); return; }
      router.refresh();
    } catch { setErr(labels.failed); } finally { setBusy(false); }
  }
  return (
    <p>
      <button type="button" className="my-bo sm" disabled={busy} onClick={() => void hide()} data-grw-first-hide="">{labels.hide}</button>
      {err && <span className="warn-text" role="alert"> {err}</span>}
    </p>
  );
}
