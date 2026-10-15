'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** v10.28 (D036) — 상품 문의 쓰기. 본인인증 회원 · 비공개 고르기(쓴 사람과 운영자만 봄) · 운영자가 답하면 알림 */
export function QnaForm({ code }: { code: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/v1/health/products/${encodeURIComponent(code)}/qna`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, isPrivate: priv }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? '문의를 보내지 못했습니다.'); return; }
      setBody(''); setPriv(false); setMsg(d?.note ?? '문의를 받았습니다.'); router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <div className="hlt-qnaform" data-qna-form>
      <textarea rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="상품에 대해 궁금한 점을 적어 주십시오(5자 이상). 개인정보는 적지 마십시오." data-qna-body />
      <div className="hlt-btns">
        <label><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} data-qna-private /> 비공개(나와 운영자만 봄)</label>
        <button type="button" className="hlt-btn sm pri" disabled={busy || body.trim().length < 5} onClick={go} data-qna-send>{busy ? '보내는 중…' : '문의하기'}</button>
      </div>
      {msg && <p className="hlt-ok" role="status">{msg}</p>}
      {err && <p className="warn-text" role="alert">{err}</p>}
    </div>
  );
}
