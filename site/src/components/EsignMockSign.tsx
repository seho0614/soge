'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * v10.143 (D139 · docs/217) — 가짜 전자서명 화면(/contract/mock-sign) — 점검판(esign.provider = MOCK)에서만 씀
 *   내 쪽 서명(SIGN) · 거절(REJECT) → POST /deals/{id}/contract/esign/mock-sign → 계약 화면으로 돌아감.
 *   MOCK 이 아니면 서버가 403 MOCK_ONLY — 이 화면으로는 운영에서 서명할 수 없음.
 */
export function EsignMockSign({ dealId }: { dealId: string }) {
  const t = useTranslations('myDeal.esignMock');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(action: 'SIGN' | 'REJECT') {
    setErr(null); setBusy(true);
    try {
      const r = await fetch(`/api/v1/deals/${dealId}/contract/esign/mock-sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message ?? t('failed')); return; }
      window.location.assign(`/my/contracts/${dealId}`);
    } catch { setErr(t('failed')); } finally { setBusy(false); }
  }

  return (
    <div data-esign-mock-window="">
      <p className="stub-note">{t('note')}</p>
      {err && <p className="form-error" role="alert">{err}</p>}
      <p>
        <button className="cta-primary" disabled={busy || !dealId} onClick={() => void go('SIGN')} data-mock-esign-ok="">{t('ok')}</button>{' '}
        <button className="my-bp" disabled={busy || !dealId} onClick={() => void go('REJECT')} data-mock-esign-reject="">{t('reject')}</button>
      </p>
    </div>
  );
}
