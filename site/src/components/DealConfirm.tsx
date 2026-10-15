'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 거래 확인 (2026-10-01 결정 Q2 · Q3).
 *
 * 양측이 각각 누르면 그 자리에서 거래가 확정됩니다(서버 C997).
 * 개인 회원도 본인인증 후 누를 수 있습니다. 계약서를 쓰는 거래는 서명으로도 확정됩니다.
 */
export function DealConfirm({ dealId, done = false }: { dealId: string; done?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function confirmDeal() {
    if (!window.confirm('이 거래가 성사되었음을 확인합니다. 상대방도 확인하면 확정되며 되돌릴 수 없습니다.')) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/v1/deals/${dealId}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (d?.code === 'IDENTITY_REQUIRED') { router.push('/verify'); return; }
        setErr(d?.message ?? '확인하지 못했습니다.');
        return;
      }
      setMsg(d?.note ?? '확인했습니다.');
      router.refresh();
    } finally { setBusy(false); }
  }

  /* v10.31 — 누른 뒤 화면을 새로 그리면(router.refresh) 내 확인이 끝나 단추가 빠집니다. 단추만 빼고 이 자리는 남겨
   * 서버가 돌려준 결과 글(「상대방 확인을 기다립니다」 · 「양측이 확인해 거래가 확정되었습니다」)이 사라지지 않게 합니다. */
  if (done && !msg && !err) return null;
  return (
    <div style={{ marginTop: 12 }}>
      {!done && (
        <button className="cta-primary" disabled={busy} onClick={() => void confirmDeal()}>
          {busy ? '처리 중…' : '거래 성사 확인'}
        </button>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}
