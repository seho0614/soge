'use client';
/** v10.606 (docs/748) 정기 배송 「지금 다시 결제」 단추 — POST /api/v1/lsq/me/subscriptions/{id}/retry · 글자는 서버 화면이 넘겨 줌 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LsqSubRetryButton({ id, label, busyLabel, failLabel }: { id: string; label: string; busyLabel: string; failLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/lsq/me/subscriptions/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = (await r.json().catch(() => null)) as { note?: string; message?: string } | null;
      setMsg(r.ok ? (j?.note ?? null) : (j?.message ?? failLabel));
      router.refresh();
    } catch { setMsg(failLabel); } finally { setBusy(false); }
  }
  return (
    <span>
      <button type="button" className="hlt-btn sm pri" disabled={busy} onClick={() => void go()} data-lsq-sub-retry={id}>{busy ? busyLabel : label}</button>
      {msg && <span role="status" className="hint"> {msg}</span>}
    </span>
  );
}
