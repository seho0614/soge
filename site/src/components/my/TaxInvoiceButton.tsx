'use client';
/**
 * v10.31 (시안 지급 내역 「미발행」 단추) — 세금계산서는 소개자가 직접 발행합니다(소개뱅크는 대신 발행하지 않음).
 * 발행하신 뒤 여기서 「발행 완료」로 표시합니다(승인번호는 선택). POST /me/settlements/{id}/tax-invoice — 한 번만.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function TaxInvoiceButton({ id }: { id: string }) {
  const r = useRouter();
  const t = useTranslations('my.taxInv');
  const [open, setOpen] = useState(false);
  const [no, setNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function mark() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/v1/me/settlements/${encodeURIComponent(id)}/tax-invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(no.trim() ? { no: no.trim() } : {}),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErr(j?.message ?? t('failed')); return; }
      r.refresh();
    } catch { setErr(t('network')); } finally { setBusy(false); }
  }
  if (!open) {
    return <button type="button" className="my-bo sm" onClick={() => setOpen(true)} data-taxinv={id}
      title={t('title')}>{t('notIssued')}</button>;
  }
  return (
    <span className="my-addf" data-taxinv-form={id}>
      <input value={no} onChange={(e) => setNo(e.target.value)} maxLength={40} placeholder={t('noPh')} aria-label={t('noAria')} />
      <button type="button" className="my-bp sm" disabled={busy} onClick={mark}>{t('mark')}</button>
      <button type="button" className="my-bo sm" onClick={() => setOpen(false)}>{t('close')}</button>
      {err && <span className="my-ls warnx" role="alert">{err}</span>}
    </span>
  );
}
