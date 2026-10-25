'use client';
/* v10.31 (W5 · CTR-300) — 상담 줄의 메모(쌓임). 전화번호 · 이메일은 서버가 막습니다(보관 기한 뒤에도 남지 않게). */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/partner/act';
import { useTranslations } from 'next-intl';

export function LeadMemo({ deliveryId, last, count }: { deliveryId: string; last: string | null; count: number }) {
  const t = useTranslations('partnerOps.leads.memo');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    try { await api('POST', `/partner/leads/${deliveryId}/memo`, { body }); setBody(''); setOpen(false); router.refresh(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="pt-memo" data-lead-memo>
      {last ? <span className="pt-ls">{t('memo')} — {last}{count > 1 ? ` ${t('more', { n: String(count - 1) })}` : ''}</span> : null}
      {!open ? <button type="button" className="pt-bo sm" onClick={() => setOpen(true)} style={{ marginLeft: last ? 6 : 0 }}>{t('memo')}</button> : (
        <form onSubmit={save}>
          <input className="pt-input" value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} placeholder={t('ph')} />
          <button className="pt-bp sm" disabled={busy || !body.trim()}>{busy ? t('saving') : t('save')}</button>
          <button type="button" className="pt-bo sm" onClick={() => setOpen(false)}>{t('close')}</button>
        </form>
      )}
      {err && <p className="pt-msg err">{err}</p>}
    </div>
  );
}
