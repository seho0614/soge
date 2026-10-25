'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 매물 내리기 (v10.27 · G-193 ④).
 * 시안(scMyLst)의 「삭제」 대신 「내리기」입니다 — 지우면 문의 · 거래 · 소개 이력이 가리키는 곳이 사라집니다.
 * 내린 매물은 목록 · 검색에서 빠지고, 다시 올리려면 수정해서 재검수를 받습니다.
 */
export function ArchiveButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const t = useTranslations('deal.archive');
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/listings/${id}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      setAsk(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (!ask) return <button type="button" className="btn-sm" onClick={() => setAsk(true)} data-archive={id}>{t('btn')}</button>;
  return (
    <span className="confirm-inline" role="group" aria-label={t('aria')} data-archive-ask={id}>
      <span>{t('ask', { title })}</span>
      <button type="button" className="btn-sm danger" disabled={busy} onClick={go} data-archive-yes>{busy ? t('busy') : t('btn')}</button>
      <button type="button" className="btn-sm" disabled={busy} onClick={() => setAsk(false)}>{t('cancel')}</button>
      {err && <span className="warn-text" role="alert">{err}</span>}
    </span>
  );
}
