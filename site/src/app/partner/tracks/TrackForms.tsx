'use client';
/* v10.31 (W5 · CTR-950) — 전용 트랙의 입력: 판금 · 도색 견적 보내기(연 요청만) · 카탈로그 품목 추가 · 노출/숨김 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/partner/act';

type Msg = ['ok' | 'err', string] | null;
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setM(null);
    try { await fn(); setM(['ok', ok]); router.refresh(); return true; } catch (e) { setM(['err', (e as Error).message]); return false; } finally { setBusy(false); }
  };
  return { busy, m, run };
}

export function QuoteForm({ deliveryId, amount }: { deliveryId: string; amount: number | null }) {
  const { busy, m, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(amount ? String(amount) : '');
  const [msg, setMsg] = useState('');
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      {!open ? <button type="button" className="pt-bo sm" onClick={() => setOpen(true)}>{amount ? '견적 고치기' : '견적 보내기'}</button> : (
        <span className="pt-row">
          <input className="pt-input" type="number" min={1} value={v} onChange={(e) => setV(e.target.value)} placeholder="금액(원)" style={{ width: 120 }} />
          <input className="pt-input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="안내(선택)" style={{ width: 180 }} />
          <button type="button" className="pt-bp sm" disabled={busy || !(Number(v) > 0)}
                  onClick={() => void run(() => api('POST', `/partner/tracks/repair/${deliveryId}/quote`, { amount: Number(v), message: msg || null }), '견적을 저장했습니다.').then((ok) => ok && setOpen(false))}>저장</button>
          <button type="button" className="pt-bo sm" onClick={() => setOpen(false)}>닫기</button>
        </span>
      )}
      {m && <span className={`pt-msg ${m[0]}`}>{m[1]}</span>}
    </span>
  );
}

export function CatalogForm() {
  const { busy, m, run } = useRun();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('RENTAL');
  const [price, setPrice] = useState('');
  return (
    <div className="pt-fset" data-catalog-form>
      <h3>제품 등록</h3>
      <div className="pt-row">
        <label style={{ flex: 1, minWidth: 220 }}>제품<input className="pt-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 정수기 · 코웨이 CHP-671L" /></label>
        <label>형태<select className="pt-input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="RENTAL">렌탈(월)</option><option value="SALE">판매</option></select></label>
        <label>가격(원){kind === 'RENTAL' ? ' / 월' : ''}<input className="pt-input" type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 130 }} /></label>
        <button type="button" className="pt-bp" disabled={busy || name.trim().length < 2 || !(Number(price) > 0)}
                onClick={() => void run(() => api('POST', '/partner/tracks/catalog', { name, saleKind: kind, price: Number(price) }), '등록했습니다.').then((ok) => { if (ok) { setName(''); setPrice(''); } })}>등록</button>
      </div>
      {m && <p className={`pt-msg ${m[0]}`}>{m[1]}</p>}
    </div>
  );
}

export function CatalogToggle({ id, state }: { id: string; state: string }) {
  const { busy, m, run } = useRun();
  const next = state === 'LISTED' ? 'HIDDEN' : 'LISTED';
  return <span><button type="button" className="pt-bo sm" disabled={busy}
    onClick={() => void run(() => api('PATCH', `/partner/tracks/catalog/${id}`, { state: next }), next === 'LISTED' ? '다시 보이게 했습니다.' : '숨겼습니다.')}>{state === 'LISTED' ? '숨기기' : '다시 보이기'}</button>
    {m && <span className={`pt-msg ${m[0]}`}> {m[1]}</span>}</span>;
}
