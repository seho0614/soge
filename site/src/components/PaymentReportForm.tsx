'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** 금액·계좌 입력이 없습니다 — deal_payment_records 에 그 컬럼이 없습니다 (INV-11) */
export function PaymentReportForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const t = useTranslations('deal.payReport');
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);   // 신고 뒤 거래 상태(서버가 알려 줌)
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/deals/${dealId}/payment-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: String(fd.get('method') ?? 'BANK_TRANSFER'),
          memo: String(fd.get('memo') ?? '') || undefined,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      setDone(String(d?.dealStatus ?? 'PAYMENT_REPORTED'));
      router.refresh();
    });
  }

  /* v10.27 (G-201) — 안내를 거래 상태에 맞춥니다. 전에는 이미 확정된 거래에도
   * 「상대방이 확인하면 계약서 서명으로 진행합니다」가 나왔습니다. */
  if (done) {
    const closed = done === 'CONFIRMED' || done === 'SETTLED';
    return (
      <div className="result" data-pay-done={done}>
        <p className="ok-note">
          {closed
            ? t('closed')
            : t('open')}
        </p>
        {closed
          ? <a className="cta-primary as-link" href={`/deal/${dealId}/review`}>{t('review')}</a>
          : <a className="cta-primary as-link" href={`/deal/${dealId}/confirm`}>{t('toConfirm')}</a>}
        <a className="as-link" style={{ marginLeft: 12 }} href="/my/deals">{t('myDeals')}</a>
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>{t('method')}</span>
        <select name="method">
          <option value="BANK_TRANSFER">{t('bank')}</option>
          <option value="CASH">{t('cash')}</option>
          <option value="OTHER">{t('other')}</option>
        </select>
      </label>
      <label className="fld">
        <span>{t('memo')}</span>
        <textarea name="memo" rows={3} placeholder={t('memoPh')} />
        <em>{t('memoNote')}</em>
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="cta-primary" disabled={pending}>
        {pending ? t('pending') : t('submit')}
      </button>
    </form>
  );
}
