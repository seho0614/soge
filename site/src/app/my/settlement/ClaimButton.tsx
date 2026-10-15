'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * v10.28 「소개비 받기」 — POST /settlements {dealId}. 성사 때 자동으로 정산이 생기지 않은 거래(개인이 계좌를 나중에 확인한 경우 등)에 씁니다.
 * 받을 계좌가 확인되지 않았으면 서버가 409 ACCOUNT_REQUIRED 로 막습니다 — 화면도 먼저 안내합니다.
 */
export function ClaimButton({ dealId, ready }: { dealId: string; ready: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/v1/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId }) });
      const d = await r.json().catch(() => null);
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) { setErr(d?.message ?? '신청하지 못했습니다.'); return; }
      setMsg(d?.note ?? '정산을 신청했습니다.');
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <span className="acts" data-stl-claim-wrap={dealId}>
      <button type="button" className="btn-sm p2primary" disabled={busy} onClick={go} data-stl-claim={dealId}
        title={ready ? undefined : '받을 계좌를 먼저 확인해 주십시오'}>{busy ? '신청하는 중…' : '소개비 받기'}</button>
      {!ready && <span className="dim">받을 계좌 확인이 먼저입니다</span>}
      {msg && <span className="ok-note" role="status">{msg}</span>}
      {err && <span className="form-error" role="alert" data-stl-claim-err>{err}</span>}
    </span>
  );
}
