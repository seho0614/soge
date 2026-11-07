import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

/**
 * v10.208 (D185 · docs/333) — 소개몰 개봉 반품 재고(SB-ADM-HOS-010)
 *   반품 승인 때 「개봉됨」이면 주문 줄마다 여기 남음 — 직판은 보관 · 폐기, 입점은 판매자 반송.
 *   보관한 것을 같은 옵션끼리 골라 「할인 판매로」 → 「[개봉 반품] …」 상품(값은 원래보다 낮게 · 유통기한 · 상태 메모).
 *   판매 스위치 hlt.open_stock_sale 가 꺼져 있으면 멈춘 채로 두고, 켜면 판매 중(켜기 SUPER · 법적 허용 범위 확인 뒤).
 */
interface Item {
  id: string; state: string; qty: number; note: string | null; expiresOn: string | null; createdAt: string; orderNo: string;
  productCode: string; productName: string; optionLabel: string | null; optionPrice: number | null; optionId: string | null; sellerType: string;
  saleCode: string | null; saleStatus: string | null; saleStock: number | null; salePrice: number | null;
}
interface List { items: Item[]; counts: { hold: number; forSale: number; discarded: number; toSeller: number }; saleOn: boolean }

const STATE: Record<string, string> = { HOLD: '보관', FOR_SALE: '할인 판매', DISCARDED: '폐기', TO_SELLER: '판매자 반송' };
const won = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('ko-KR')}원`);

export function HealthOpenStock() {
  const [state, setState] = useState('HOLD');
  const r = useApi<List>(`/admin/health/open-stock${state ? `?state=${state}` : ''}`);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [exp, setExp] = useState('');
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const sup = tokenRoles().includes('SUPER');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const chosen = d.items.filter((x) => pick[x.id]);
  const first = chosen[0];
  const sameOpt = !!first && chosen.every((x) => x.optionId === first.optionId && x.state === 'HOLD');
  const fail = (e: unknown, t: string) => setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : t });

  async function sell() {
    if (!sameOpt || !first) { setRes({ ok: false, text: '보관 중인 같은 상품 · 같은 옵션끼리 골라 주십시오.' }); return; }
    if (!window.confirm(`${first.productName} ${first.optionLabel ?? ''} ${chosen.reduce((a, x) => a + x.qty, 0)}개를 ${won(Number(price))}에 할인 판매로 옮길까요?\n(원래 ${won(first.optionPrice)}${d.saleOn ? '' : ' · 판매 스위치가 꺼져 있어 멈춘 채로 둡니다'})`)) return;
    try {
      const x = await api<{ code: string; status: string; stock: number }>('/admin/health/open-stock/sell', {
        method: 'POST', body: JSON.stringify({ ids: chosen.map((c) => c.id), price: Number(price), ...(note.trim() ? { note } : {}), ...(exp ? { expiresOn: exp } : {}) }),
      });
      setRes({ ok: true, text: `${x.code} — ${x.status === 'ON_SALE' ? '판매 중' : '멈춤(스위치를 켜면 판매)'} · 재고 ${x.stock}` });
      setPick({}); setPrice(''); setNote(''); setExp(''); r.reload();
    } catch (e) { fail(e, '옮기지 못했습니다.'); }
  }
  async function discard(x: Item) {
    const why = window.prompt(`${x.productName} ${x.qty}개를 폐기로 옮깁니다 — 사유(2자 이상)`) ?? '';
    if (why.trim().length < 2) return;
    try {
      await api(`/admin/health/open-stock/${x.id}/discard`, { method: 'POST', body: JSON.stringify({ note: why }) });
      setRes({ ok: true, text: `${x.productName} — 폐기로 옮겼습니다` }); r.reload();
    } catch (e) { fail(e, '옮기지 못했습니다.'); }
  }
  async function toggle() {
    const on = !d.saleOn;
    if (!window.confirm(on
      ? '개봉 반품 할인 판매를 켭니다. 멈춰 둔 개봉 반품 상품이 판매 중이 됩니다.\n개봉 식품 · 화장품 재판매의 법적 허용 범위를 확인하셨습니까?'
      : '개봉 반품 할인 판매를 끕니다. 판매 중인 개봉 반품 상품이 멈춥니다.')) return;
    try {
      await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'hlt.open_stock_sale', value: on ? 'on' : 'off' }) });
      setRes({ ok: true, text: on ? '할인 판매를 켰습니다' : '할인 판매를 껐습니다' }); r.reload();
    } catch (e) { fail(e, '바꾸지 못했습니다.'); }
  }

  return (
    <div data-open-stock>
      <div className="card">
        <p className="hint">반품 승인 때 「개봉됨」으로 판정한 상품입니다. 직판 상품은 보관 · 폐기, 입점 상품은 판매자에게 돌려보냅니다. 보관 중인 것을 같은 옵션끼리 골라 할인 판매로 옮길 수 있습니다.</p>
        <p data-open-switch>할인 판매 스위치(<code>hlt.open_stock_sale</code>): <b>{d.saleOn ? '켜짐' : '꺼짐'}</b>
          {' '}{(sup || d.saleOn) && <button className="btn-plain" onClick={toggle} data-open-toggle>{d.saleOn ? '끄기' : '켜기(SUPER)'}</button>}
          {!d.saleOn && <span className="dim"> — 개봉 식품 · 화장품 재판매의 법적 허용 범위를 확인한 뒤 켜십시오(docs/333).</span>}</p>
      </div>
      <div className="ad-dact">
        {(['HOLD', 'FOR_SALE', 'DISCARDED', 'TO_SELLER', ''] as const).map((s) => (
          <button key={s || 'ALL'} className={state === s ? 'btn-ok' : 'btn-plain'} onClick={() => { setState(s); setPick({}); }} data-open-state={s || 'ALL'}>
            {s ? STATE[s] : '전체'} {s === 'HOLD' ? d.counts.hold : s === 'FOR_SALE' ? d.counts.forSale : s === 'DISCARDED' ? d.counts.discarded : s === 'TO_SELLER' ? d.counts.toSeller : ''}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th /><th>들어온 날</th><th>주문</th><th>상품 · 옵션</th><th>수량</th><th>처리</th><th>메모 · 유통기한</th><th>할인 판매</th><th /></tr></thead>
          <tbody>
            {d.items.map((x) => (
              <tr key={x.id} data-open-item={x.id}>
                <td>{x.state === 'HOLD' && <input type="checkbox" checked={!!pick[x.id]} onChange={(e) => setPick({ ...pick, [x.id]: e.target.checked })} data-open-pick />}</td>
                <td>{x.createdAt}</td><td>{x.orderNo}</td>
                <td>{x.productName} <span className="dim">{x.optionLabel ?? ''} · {won(x.optionPrice)}</span></td>
                <td>{x.qty}</td><td>{STATE[x.state] ?? x.state}</td>
                <td>{x.note ?? ''}{x.expiresOn ? ` · ${x.expiresOn}` : ''}</td>
                <td>{x.saleCode ? `${x.saleCode} · ${won(x.salePrice)} · ${x.saleStatus === 'ON_SALE' ? '판매 중' : x.saleStatus === 'SOLD_OUT' ? '품절' : '멈춤'} · 남은 ${x.saleStock ?? 0}` : '—'}</td>
                <td>{x.state === 'HOLD' && <button className="btn-plain" onClick={() => discard(x)} data-open-discard>폐기</button>}</td>
              </tr>
            ))}
            {d.items.length === 0 && <tr><td colSpan={9} className="muted">없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {chosen.length > 0 && (
        <div className="card" data-open-sell>
          <b>할인 판매로 옮기기 — {chosen.length}건 · {chosen.reduce((a, x) => a + x.qty, 0)}개</b>
          {!sameOpt && <p className="form-error">같은 상품 · 같은 옵션끼리만 한 번에 옮길 수 있습니다.</p>}
          <div className="ad-dact">
            <input value={price} inputMode="numeric" placeholder={`할인 값(원래 ${won(first?.optionPrice ?? null)})`} onChange={(e) => setPrice(e.target.value)} data-open-price />
            <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} data-open-exp />
            <input value={note} maxLength={300} placeholder="상태 메모(예: 외부 상자만 개봉 · 내용물 밀봉)" onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} data-open-note />
            <button className="btn-ok" disabled={!sameOpt || !(Number(price) > 0)} onClick={sell} data-open-sell-go>할인 판매로</button>
          </div>
        </div>
      )}
      {res && <p className={res.ok ? 'hint' : 'form-error'} data-open-res>{res.text}</p>}
    </div>
  );
}
