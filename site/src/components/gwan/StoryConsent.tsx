'use client';
/** v10.31 (w2) — 베스트매칭 사례 한 줄의 동의 · 철회(매도자는 한마디 · 별점) */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function StoryConsent({ row }: { row: { id: string; headline: string; status: string; title: string; side: 'SELLER' | 'BUYER'; consentAt: string | null; sellerComment: string | null; sellerRating: number | null } }) {
  const router = useRouter();
  const t = useTranslations('detail.story');
  const [comment, setComment] = useState(row.sellerComment ?? '');
  const [rating, setRating] = useState(row.sellerRating ?? 5);
  const [msg, setMsg] = useState('');
  async function send(consent: boolean) {
    const body = consent && row.side === 'SELLER' ? { consent, ...(comment.trim().length >= 5 ? { comment: comment.trim() } : {}), rating } : { consent };
    const r = await fetch(`/api/v1/market/success-stories/${row.id}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(consent ? t('consented') : t('withdrawn')); router.refresh(); } else setMsg(j.message ?? t('failed'));
  }
  return (
    <div className="gw-axrow" data-story={row.id}>
      <div className="gw-axl"><span className={`gw-axb${row.consentAt ? ' gw-axok' : ''}`}>{row.consentAt ? t('agreed') : t('pending')}</span>
        <b>{row.headline}</b><span className="gw-ls">{row.title} · {row.side === 'SELLER' ? t('seller') : t('buyer')} · {t('status', { s: row.status === 'PUBLISHED' ? t('published') : row.status === 'HIDDEN' ? t('hidden') : t('preparing') })}</span>
        {row.side === 'SELLER' && !row.consentAt && (
          <span className="gw-inl" style={{ marginTop: 6 }}>
            <input className="gw-inp" placeholder={t('commentPh')} maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
            <select className="gw-inp" style={{ flex: 'none', width: 90 }} aria-label={t('ratingAria')} value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select>
          </span>
        )}
        {msg && <span className="gw-axmsg" role="status">{msg}</span>}
      </div>
      <div className="gw-axr">{row.consentAt
        ? <button type="button" className="gw-bo gw-sm" onClick={() => void send(false)}>{t('withdraw')}</button>
        : <button type="button" className="gw-bp gw-sm" onClick={() => void send(true)}>{t('consent')}</button>}</div>
    </div>
  );
}
