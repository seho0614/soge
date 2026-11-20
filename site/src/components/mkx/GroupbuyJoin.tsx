'use client';
/**
 * v10.540 (D283 · docs/678) 공동구매 참여 단추 — POST /api/v1/health/groupbuys/{id}/join(기본 배송지 · 수량 1)
 *   성공하면 내 주문(결제 화면)으로 · 실패하면 서버 안내 글(주문 받기 꺼짐 · 이미 참여 · 배송지 없음 …)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type L = Record<'join' | 'busy' | 'login' | 'pay' | 'failed', string>;

export function GroupbuyJoin({ id, loggedIn, labels }: { id: string; loggedIn: boolean; labels: L }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!loggedIn) return <a className="my-bo sm" href={`/login?next=${encodeURIComponent('/health/groupbuys')}`}>{labels.login}</a>;
  async function join() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/health/groupbuys/${id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qty: 1 }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setMsg(j?.message ?? labels.failed); return; }
      setMsg(labels.pay);
      if (typeof j?.payUrl === 'string' && j.payUrl.startsWith('/')) router.push(j.payUrl);
    } catch { setMsg(labels.failed); } finally { setBusy(false); }
  }
  return (
    <p>
      <button type="button" className="my-bp" disabled={busy} onClick={() => void join()} data-mkx-gb-join={id}>{busy ? labels.busy : labels.join}</button>
      {msg && <span className="my-ls" role="status"> {msg}</span>}
    </p>
  );
}
