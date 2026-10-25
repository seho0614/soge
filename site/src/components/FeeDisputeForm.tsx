'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface DisputableFee { id: number; summary: string; amount: string; deliveredAt?: string }

/* v10.101 — 사유 이름은 사전 키(deal.fee.reasons.*) */
const REASONS = [
  ['UNREACHABLE', 'unreachable'],
  ['FALSE_INFO', 'falseInfo'],
  ['DUPLICATE', 'duplicate'],
  ['OUT_OF_SCOPE', 'outOfScope'],
] as const;

/**
 * 리드 반려 신청 폼 (SB-PTC-CTR-330 → POST /partner/fees/{id}/dispute).
 *
 * 자격(접수 72시간 · 한 건 한 번 · 월 15%)은 서버가 봅니다.
 * 막히면 서버가 준 이유를 그대로 보여 드립니다 — "왜 안 되나"를 묻지 않게.
 */
export function FeeDisputeForm({ fees }: { fees: DisputableFee[] }) {
  const router = useRouter();
  const t = useTranslations('deal.fee');
  const [f, setF] = useState({ feeId: String(fees[0]?.id ?? ''), reasonCode: 'UNREACHABLE', reason: '', evidence: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit() {
    if (f.reason.trim().length < 5) { setErr(t('short')); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await fetch(`/api/v1/partner/fees/${f.feeId}/dispute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reasonCode: f.reasonCode, reason: f.reason, evidence: f.evidence || undefined }),
      });
      const d = await r.json().catch(() => null) as { message?: string; note?: string } | null;
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      setOk(d?.note ?? t('ok'));
      setF({ ...f, reason: '', evidence: '' });
      router.refresh();
    } catch {
      setErr(t('failRetry'));
    } finally { setBusy(false); }
  }

  if (!fees.length) {
    return <div className="empty">{t('empty')}</div>;
  }
  return (
    <div className="card" style={{ padding: '18px 20px' }} id="dispute-form">
      <label className="fld"><span>{t('fee')}</span>
        <select value={f.feeId} onChange={(e) => setF({ ...f, feeId: e.target.value })} name="feeId">
          {fees.map((x) => (
            <option key={x.id} value={x.id}>
              {t('feeNo', { id: String(x.id) })} · {x.summary} · {Number(x.amount).toLocaleString('ko-KR')}원
            </option>
          ))}
        </select>
      </label>
      <label className="fld"><span>{t('reason')}</span>
        <select value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })} name="reasonCode">
          {REASONS.map(([c, l]) => <option key={c} value={c}>{t(`reasons.${l}`)}</option>)}
        </select>
      </label>
      <label className="fld"><span>{t('what')}</span>
        <textarea rows={3} maxLength={1000} value={f.reason} name="reason"
          placeholder={t('whatPh')}
          onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </label>
      <label className="fld"><span>{t('evidence')}</span>
        <input className="inp" maxLength={2000} value={f.evidence} name="evidence"
          placeholder={t('evidencePh')}
          onChange={(e) => setF({ ...f, evidence: e.target.value })} />
      </label>
      <button type="button" className="btn-primary" disabled={busy || !f.feeId} onClick={() => void submit()}>
        {busy ? t('busy') : t('submit')}
      </button>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      {ok ? <p className="ok-note" role="status">{ok}</p> : null}
      <p className="hint">
        {t.rich('hint', { b: (x) => <b>{x}</b> })}
      </p>
    </div>
  );
}
