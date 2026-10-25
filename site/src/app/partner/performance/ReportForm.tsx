'use client';
/* v10.31 (W5 · CTR-450) — 이행 보고: 확인비용을 낸 배정 건에만 · 한 건에 한 번(서버가 봄). 소비자가 확인하면 성사. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/components/partner/act';

export function ReportForm({ open }: { open: Array<{ deliveryId: string; summary: string; categoryName: string | null }> }) {
  const router = useRouter();
  const t = useTranslations('partner.reportForm');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [d, setD] = useState(open[0]?.deliveryId ?? '');
  const [content, setContent] = useState('');
  const [doneOn, setDoneOn] = useState(today);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<['ok' | 'err', string] | null>(null);
  if (!open.length) return <p className="pt-ls">{t('none')}</p>;
  async function go() {
    setBusy(true); setM(null);
    try {
      const r = await api<{ note: string }>('POST', '/partner/performance', { deliveryId: d, content, doneOn, amount: amount ? Number(amount) : undefined });
      setM(['ok', r.note]); setContent(''); setAmount(''); router.refresh();
    } catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  return (
    <div data-report-form>
      <label className="fld"><span>{t('lead')}</span>
        <select className="pt-input" value={d} onChange={(e) => setD(e.target.value)}>
          {open.map((o) => <option key={o.deliveryId} value={o.deliveryId}>{o.summary}{o.categoryName ? ` · ${o.categoryName}` : ''}</option>)}
        </select></label>
      <label className="fld"><span>{t('content')}</span><input className="pt-input" value={content} onChange={(e) => setContent(e.target.value)} maxLength={300} placeholder={t('contentPh')} /></label>
      <div className="pt-row">
        <label>{t('doneOn')}<input className="pt-input" type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} /></label>
        <label>{t('amount')}<input className="pt-input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 150 }} /></label>
        <button type="button" className="pt-bp" disabled={busy || content.trim().length < 2 || !d} onClick={() => void go()}>{busy ? t('sending') : t('submit')}</button>
      </div>
      {m && <p className={`pt-msg ${m[0]}`} role="status">{m[1]}</p>}
    </div>
  );
}
