'use client';
/**
 * v10.555 (D287 · docs/693) 판매자센터 › 리뷰 답글 — 리뷰 한 줄의 답글 칸
 *   PUT /api/v1/me/health/seller/review-replies/{reviewId} { body } — 리뷰 하나에 하나 · 다시 저장하면 고치기(기록이 남음)
 *   금칙어에 걸리면 서버가 「운영 확인 뒤 보임」 안내 · 가려진 답글은 고칠 수 없음(칸을 잠금) · 글자는 서버 화면이 넘겨 줌(labels)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type L = Record<'save' | 'saving' | 'failed' | 'ph' | 'hidden', string>;

export function SellerReplyBox({ reviewId, initial, state, disabled, labels }: { reviewId: string; initial: string; state: string | null; disabled: boolean; labels: L }) {
  const router = useRouter();
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const locked = disabled || state === 'HIDDEN';
  async function save() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await fetch(`/api/v1/me/health/seller/review-replies/${encodeURIComponent(reviewId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body.trim() }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setErr(j?.message ?? labels.failed); return; }
      setMsg(j?.note ?? null);
      router.refresh();
    } catch { setErr(labels.failed); } finally { setBusy(false); }
  }
  return (
    <div className="hlt-qnaform" data-smx-reply-box={reviewId}>
      {state === 'HIDDEN' && <p className="warn-text">{labels.hidden}</p>}
      <textarea rows={3} maxLength={1000} value={body} disabled={locked} onChange={(e) => setBody(e.target.value)} placeholder={labels.ph} data-smx-reply-body="" />
      <div className="hlt-btns">
        <button type="button" className="hlt-btn sm pri" disabled={locked || busy || body.trim().length < 2} onClick={() => void save()} data-smx-reply-save="">{busy ? labels.saving : labels.save}</button>
      </div>
      {msg && <p className="hlt-ok" role="status">{msg}</p>}
      {err && <p className="warn-text" role="alert">{err}</p>}
    </div>
  );
}
