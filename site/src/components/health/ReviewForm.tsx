'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface MyReview { id: string; rating: number; body: string; state: string; hiddenReason: string | null }

/**
 * v10.28 (D036) 리뷰 쓰기 · 고치기 · 지우기 — 구매확정한 주문의 상품마다 1건 · 별점 1 ~ 5 · 글 10 ~ 1,000자(사진은 받지 않음).
 * 효능 · 효과를 단정하는 표현(금칙어)이 있으면 운영 확인 뒤 보입니다. 운영자는 지우지 않고 가립니다(사유 알림).
 */
export function ReviewForm({ orderNo, productCode, optionId, name, mine }: { orderNo: string; productCode: string; optionId?: string | null; name: string; mine: MyReview | null }) {
  const router = useRouter();
  const t = useTranslations('hlt.reviewForm');
  const [edit, setEdit] = useState(!mine);
  const [rating, setRating] = useState(mine?.rating ?? 5);
  const [body, setBody] = useState(mine?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(method: 'POST' | 'PATCH' | 'DELETE') {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const url = method === 'POST' ? '/api/v1/me/health/reviews' : `/api/v1/me/health/reviews/${mine!.id}`;
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify(method === 'POST' ? { orderNo, productCode, optionId: optionId ?? undefined, rating, body } : { rating, body }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('failed')); return; }
      setMsg(d?.note ?? t('done')); setEdit(false); router.refresh();
    } finally { setBusy(false); }
  }

  if (mine && !edit) {
    return (
      <div className="hlt-rvform" data-myreview={mine.id} data-myreview-state={mine.state}>
        <div><span className="hlt-stars">{'★★★★★'.slice(0, mine.rating)}{'☆☆☆☆☆'.slice(0, 5 - mine.rating)}</span> <b>{t('mine')}</b>
          {mine.state === 'PENDING' && <span className="hlt-bdg" data-review-pending> {t('pending')}</span>}
          {mine.state === 'HIDDEN' && <span className="hlt-bdg soldout"> {t('hidden', { reason: mine.hiddenReason ?? '' })}</span>}</div>
        <p>{mine.body}</p>
        <div className="hlt-btns">
          {mine.state !== 'HIDDEN' && <button type="button" className="hlt-btn sm" onClick={() => setEdit(true)} data-review-edit>{t('edit')}</button>}
          <button type="button" className="hlt-btn sm" disabled={busy} onClick={() => send('DELETE')} data-review-del>{t('delete')}</button>
        </div>
        {msg && <p className="hlt-ok" role="status">{msg}</p>}
        {err && <p className="warn-text" role="alert">{err}</p>}
      </div>);
  }
  return (
    <div className="hlt-rvform" data-review-form={productCode}>
      <div><b>{name}</b> {t('write')}</div>
      <div className="hlt-starpick" role="radiogroup" aria-label={t('starAria')}>
        {[1, 2, 3, 4, 5].map((k) => <button key={k} type="button" role="radio" aria-checked={rating === k} className={k <= rating ? 'on' : undefined} onClick={() => setRating(k)} data-star={k}>★</button>)}
        <span className="hlt-mut hlt-sm"> {t('points', { n: String(rating) })}</span>
      </div>
      <textarea rows={4} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('placeholder')} data-review-body />
      <div className="hlt-btns">
        <button type="button" className="hlt-btn sm pri" disabled={busy || body.trim().length < 10} onClick={() => send(mine ? 'PATCH' : 'POST')} data-review-send>{busy ? t('sending') : mine ? t('edit') : t('submit')}</button>
        {mine && <button type="button" className="hlt-btn sm" onClick={() => setEdit(false)}>{t('cancel')}</button>}
      </div>
      <p className="hlt-mut hlt-sm">{t('note')}</p>
      {msg && <p className="hlt-ok" role="status">{msg}</p>}
      {err && <p className="warn-text" role="alert">{err}</p>}
    </div>);
}
