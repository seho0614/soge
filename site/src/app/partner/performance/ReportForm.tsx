'use client';
/* v10.31 (W5 · CTR-450) — 이행 보고: 확인비용을 낸 배정 건에만 · 한 건에 한 번(서버가 봄). 소비자가 확인하면 성사. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/partner/act';

export function ReportForm({ open }: { open: Array<{ deliveryId: string; summary: string; categoryName: string | null }> }) {
  const router = useRouter();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [d, setD] = useState(open[0]?.deliveryId ?? '');
  const [content, setContent] = useState('');
  const [doneOn, setDoneOn] = useState(today);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<['ok' | 'err', string] | null>(null);
  if (!open.length) return <p className="pt-ls">보고할 건이 없습니다 — 연락처를 연(확인비용을 낸) 상담만 이행을 보고할 수 있습니다.</p>;
  async function go() {
    setBusy(true); setM(null);
    try {
      const r = await api<{ note: string }>('POST', '/partner/performance', { deliveryId: d, content, doneOn, amount: amount ? Number(amount) : undefined });
      setM(['ok', r.note]); setContent(''); setAmount(''); router.refresh();
    } catch (e) { setM(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  return (
    <div data-report-form>
      <label className="fld"><span>상담 건</span>
        <select className="pt-input" value={d} onChange={(e) => setD(e.target.value)}>
          {open.map((o) => <option key={o.deliveryId} value={o.deliveryId}>{o.summary}{o.categoryName ? ` · ${o.categoryName}` : ''}</option>)}
        </select></label>
      <label className="fld"><span>이행 내용</span><input className="pt-input" value={content} onChange={(e) => setContent(e.target.value)} maxLength={300} placeholder="예: 이사 · 쓰리룸 · 송파 (연락처는 적지 마십시오)" /></label>
      <div className="pt-row">
        <label>이행일<input className="pt-input" type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} /></label>
        <label>거래액(원 · 선택)<input className="pt-input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 150 }} /></label>
        <button type="button" className="pt-bp" disabled={busy || content.trim().length < 2 || !d} onClick={() => void go()}>{busy ? '보내는 중…' : '이행 보고'}</button>
      </div>
      {m && <p className={`pt-msg ${m[0]}`} role="status">{m[1]}</p>}
    </div>
  );
}
