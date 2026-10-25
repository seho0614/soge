'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * v10.28 「소개비 받기」 — POST /settlements {dealId}. 성사 때 자동으로 정산이 생기지 않은 거래(개인이 계좌를 나중에 확인한 경우 등)에 씁니다.
 * 받을 계좌가 확인되지 않았으면 서버가 409 ACCOUNT_REQUIRED 로 막습니다 — 화면도 먼저 안내합니다.
 */
export function ClaimButton({ dealId, ready }: { dealId: string; ready: boolean }) {
  const router = useRouter();
  const t = useTranslations('myDeal');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/v1/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealId }) });
      const d = await r.json().catch(() => null);
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) { setErr(d?.message ?? t('claim.fail')); return; }
      setMsg(d?.note ?? t('claim.done'));
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <span className="acts" data-stl-claim-wrap={dealId}>
      <button type="button" className="btn-sm p2primary" disabled={busy} onClick={go} data-stl-claim={dealId}
        title={ready ? undefined : t('claim.needAccTitle')}>{busy ? t('claim.busy') : t('claim.btn')}</button>
      {!ready && <span className="dim">{t('claim.needAcc')}</span>}
      {msg && <span className="ok-note" role="status">{msg}</span>}
      {err && <span className="form-error" role="alert" data-stl-claim-err>{err}</span>}
    </span>
  );
}
