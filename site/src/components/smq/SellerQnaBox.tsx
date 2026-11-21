'use client';
/**
 * v10.577 (docs/719) 판매자센터 › 상품 문의 — 문의 한 줄의 답 칸
 *   PUT /api/v1/me/health/seller/qna/{id} { body } — 다시 저장하면 고침 · 금칙어면 서버가 「운영 확인 뒤 보임」 안내 · 운영이 가린 답은 칸을 잠금
 *   글자는 서버 화면이 넘겨 줌(labels — smx.smq.qna 사전)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type L = Record<'save' | 'saving' | 'failed' | 'ph' | 'hidden', string>;

export function SellerQnaBox({ qnaId, initial, hidden, disabled, labels }: { qnaId: string; initial: string; hidden: boolean; disabled: boolean; labels: L }) {
  const router = useRouter();
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const locked = disabled || hidden;
  async function save() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await fetch(`/api/v1/me/health/seller/qna/${encodeURIComponent(qnaId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body.trim() }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setErr(j?.message ?? labels.failed); return; }
      setMsg(j?.note ?? null);
      router.refresh();
    } catch { setErr(labels.failed); } finally { setBusy(false); }
  }
  return (
    <div className="hlt-qnaform" data-smq-qna-box={qnaId}>
      {hidden && <p className="warn-text">{labels.hidden}</p>}
      <textarea rows={3} maxLength={2000} value={body} disabled={locked} onChange={(e) => setBody(e.target.value)} placeholder={labels.ph} data-smq-qna-body="" />
      <div className="hlt-btns">
        <button type="button" className="hlt-btn sm pri" disabled={locked || busy || body.trim().length < 2} onClick={() => void save()} data-smq-qna-save="">{busy ? labels.saving : labels.save}</button>
      </div>
      {msg && <p className="hlt-ok" role="status">{msg}</p>}
      {err && <p className="warn-text" role="alert">{err}</p>}
    </div>
  );
}
