'use client';
/** v10.31 (w2) — 베스트매칭 사례 한 줄의 동의 · 철회(매도자는 한마디 · 별점) */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function StoryConsent({ row }: { row: { id: string; headline: string; status: string; title: string; side: 'SELLER' | 'BUYER'; consentAt: string | null; sellerComment: string | null; sellerRating: number | null } }) {
  const router = useRouter();
  const [comment, setComment] = useState(row.sellerComment ?? '');
  const [rating, setRating] = useState(row.sellerRating ?? 5);
  const [msg, setMsg] = useState('');
  async function send(consent: boolean) {
    const body = consent && row.side === 'SELLER' ? { consent, ...(comment.trim().length >= 5 ? { comment: comment.trim() } : {}), rating } : { consent };
    const r = await fetch(`/api/v1/market/success-stories/${row.id}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(consent ? '동의했습니다.' : '동의를 거두었습니다.'); router.refresh(); } else setMsg(j.message ?? '처리하지 못했습니다.');
  }
  return (
    <div className="gw-axrow" data-story={row.id}>
      <div className="gw-axl"><span className={`gw-axb${row.consentAt ? ' gw-axok' : ''}`}>{row.consentAt ? '동의함' : '동의 대기'}</span>
        <b>{row.headline}</b><span className="gw-ls">{row.title} · {row.side === 'SELLER' ? '매도자' : '매수자'} · 상태 {row.status === 'PUBLISHED' ? '공개 중' : row.status === 'HIDDEN' ? '내림' : '준비 중'}</span>
        {row.side === 'SELLER' && !row.consentAt && (
          <span className="gw-inl" style={{ marginTop: 6 }}>
            <input className="gw-inp" placeholder="매도자 한마디(선택 · 5자 이상)" maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
            <select className="gw-inp" style={{ flex: 'none', width: 90 }} aria-label="별점" value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select>
          </span>
        )}
        {msg && <span className="gw-axmsg" role="status">{msg}</span>}
      </div>
      <div className="gw-axr">{row.consentAt
        ? <button type="button" className="gw-bo gw-sm" onClick={() => void send(false)}>동의 거두기</button>
        : <button type="button" className="gw-bp gw-sm" onClick={() => void send(true)}>공개에 동의</button>}</div>
    </div>
  );
}
