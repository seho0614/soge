import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

interface Product {
  id: string; code: string; name: string; advertiser: string | null; commission: number | string;
  status: string; landingUrl: string; orders: number; rateChanges: number; updatedAt: string;
}

const PST: Record<string, string> = { DRAFT: '초안', ON_SALE: '판매중', SOLD_OUT: '품절', STOPPED: '중단' };

/* ── SB-AFF-PRD-010 ──────────────────────────────────────────────── */
export function Products() {
  const r = useApi<Product[]>('/admin/affiliates/products');
  const [f, setF] = useState({ code: '', name: '', commission: '', landingUrl: '', advertiser: '' });
  const [rate, setRate] = useState<Record<string, string>>({});
  const a = useAct();

  const create = () => {
    const commission = Number(f.commission);
    if (f.code.trim().length < 2 || f.name.trim().length < 2) { a.setErr('코드와 상품명을 두 자 이상 적으십시오.'); return; }
    if (!Number.isInteger(commission) || commission < 1) { a.setErr('건당 수수료는 1원 이상의 정수입니다.'); return; }
    if (f.landingUrl.trim().length < 8) { a.setErr('랜딩 주소를 적으십시오.'); return; }
    void a.run('new', () => api('/admin/affiliates/products', {
      method: 'POST',
      body: JSON.stringify({ code: f.code.trim(), name: f.name.trim(), commission, landingUrl: f.landingUrl.trim(),
        advertiser: f.advertiser.trim() || undefined }),
    }), () => { setF({ code: '', name: '', commission: '', landingUrl: '', advertiser: '' }); r.reload(); });
  };
  const patch = (p: Product, body: Record<string, unknown>) =>
    a.run(p.id, () => api(`/admin/affiliates/products/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      () => { setRate((x) => { const nx = { ...x }; delete nx[p.id]; return nx; }); r.reload(); });

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  return (
    <>
      <h2>제휴상품 · 단가 <em>{r.data.length}</em></h2>
      <p className="card warn">
        <b>단가를 바꿔도 이미 생긴 주문은 그대로입니다.</b> 주문이 생긴 시점의 단가로 고정되고, 새 주문부터
        새 단가가 적용됩니다 — 소급하면 이미 정산한 것이 흔들립니다.
      </p>
      <Flash msg={a.msg} err={a.err} />
      {r.data.length === 0 && <p className="muted">등록된 제휴상품이 없습니다.</p>}
      {r.data.length > 0 && (
        <table className="tbl">
          <thead><tr><th>상품</th><th>광고주</th><th>건당 수수료</th><th>주문</th><th>단가변경</th><th>상태</th></tr></thead>
          <tbody>
            {r.data.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b> <span className="mono">{p.code}</span></td>
                <td className="muted">{p.advertiser ?? '—'}</td>
                <td>
                  <input className="inp-sm" style={{ width: '7rem' }} type="number" min={1} aria-label={`${p.code} 수수료`}
                         value={rate[p.id] ?? String(p.commission)} onChange={(e) => setRate({ ...rate, [p.id]: e.target.value })} />
                  <button className="btn-sm" disabled={rate[p.id] === undefined || a.busy === p.id}
                          onClick={() => void patch(p, { commission: Number(rate[p.id]) })}>단가 저장</button>
                </td>
                <td className="num-cell">{n(p.orders)}</td>
                <td className="num-cell">{p.rateChanges}회</td>
                <td>
                  <select className="sel" style={{ marginBottom: 0 }} value={p.status} disabled={a.busy === p.id}
                          aria-label={`${p.code} 상태`} onChange={(e) => void patch(p, { status: e.target.value })}>
                    {Object.entries(PST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card"><b>등록하면 초안으로 들어갑니다.</b> 판매중으로 바꾸셔야 파트너에게 보입니다.</p>
      <p className="card warn"><b>재고 연동이 없습니다.</b> 광고주가 마감했으면 손으로 품절 · 중단으로 바꾸셔야 합니다 — 안 바꾸면 파트너가 계속 뿌립니다.</p>

      <h3 className="sec">상품 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>코드</span><input value={f.code} placeholder="AP-002" onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label><span>상품명</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label><span>건당 수수료(원)</span><input type="number" min={1} value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} /></label>
          <label><span>광고주</span><input value={f.advertiser} onChange={(e) => setF({ ...f, advertiser: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>랜딩 주소</span><input value={f.landingUrl} placeholder="https://" onChange={(e) => setF({ ...f, landingUrl: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'new'} onClick={create}>상품 등록</button></div>
        <p className="hint"><b>건당 정액입니다.</b> 비율이 아닌 것은 거래액을 우리가 못 보기 때문입니다.</p>
      </div>
    </>
  );
}
