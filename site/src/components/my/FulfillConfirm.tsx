'use client';
/**
 * v10.31 (W5 요청 · SHARED_NOTES) — 상담 업체의 이행 보고 확인 · 이의. POST /me/fulfillment-reports/{id}/confirm { result, rating?, note? }
 * 한 번만 됩니다. 이의는 무엇이 다른지 적어야 합니다(서버도 같은 규칙).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FulfillConfirm({ id }: { id: string }) {
  const r = useRouter();
  const [rating, setRating] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function send(result: 'CONFIRMED' | 'DISPUTED') {
    if (result === 'DISPUTED' && !note.trim()) { setMsg({ ok: false, t: '무엇이 다른지 적어 주십시오.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/v1/me/fulfillment-reports/${encodeURIComponent(id)}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result, ...(result === 'CONFIRMED' ? { rating } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setMsg({ ok: false, t: j?.message ?? '처리하지 못했습니다.' }); return; }
      setMsg({ ok: true, t: result === 'CONFIRMED' ? '이행을 확인했습니다. 성사로 잡혔습니다.' : '이의를 보냈습니다.' });
      r.refresh();
    } catch { setMsg({ ok: false, t: '연결하지 못했습니다.' }); } finally { setBusy(false); }
  }
  return (
    <div className="my-ans" data-fulfill={id}>
      <select className="my-inp" style={{ maxWidth: 120 }} value={rating} onChange={(e) => setRating(Number(e.target.value))} aria-label="평점">
        {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} {n}점</option>)}
      </select>
      <input className="my-inp" style={{ maxWidth: 280 }} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="한마디 (이의면 필수)" aria-label="한마디" />
      <button type="button" className="my-bp" disabled={busy} onClick={() => send('CONFIRMED')}>이행 확인</button>
      <button type="button" className="my-bo" disabled={busy} onClick={() => send('DISPUTED')}>이의 제기</button>
      {msg && <span className={`my-ls ${msg.ok ? '' : 'warnx'}`} role="status">{msg.t}</span>}
    </div>
  );
}
