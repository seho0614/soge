import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

/**
 * v10.208 (D185 · docs/333) — 소개몰 개봉 반품 재고(SB-ADM-HOS-010)
 *   반품 승인 때 「개봉됨」이면 주문 줄마다 여기 남음 — 직판은 보관(폐기 대기) · 폐기, 입점은 판매자 반송.
 *   식품 · 화장품 개봉품은 재판매 금지(법무 11/7) — 보관한 것은 폐기로만 옮김(사유 · 감사 기록).
 */
interface Item {
  id: string; state: string; qty: number; note: string | null; createdAt: string; orderNo: string;
  productCode: string; productName: string; optionLabel: string | null; optionPrice: number | null; optionId: string | null; sellerType: string;
}
interface List { items: Item[]; counts: { hold: number; discarded: number; toSeller: number } }

const STATE: Record<string, string> = { HOLD: '보관(폐기 대기)', DISCARDED: '폐기', TO_SELLER: '판매자 반송' };

export function HealthOpenStock() {
  const [state, setState] = useState('HOLD');
  const r = useApi<List>(`/admin/health/open-stock${state ? `?state=${state}` : ''}`);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const count = (s: string) => (s === 'HOLD' ? d.counts.hold : s === 'DISCARDED' ? d.counts.discarded : s === 'TO_SELLER' ? d.counts.toSeller : '');

  async function discard(x: Item) {
    const why = window.prompt(`${x.productName} ${x.qty}개를 폐기로 옮깁니다 — 사유(2자 이상 · 예: 유통기한 확인 뒤 폐기)`) ?? '';
    if (why.trim().length < 2) return;
    try {
      await api(`/admin/health/open-stock/${x.id}/discard`, { method: 'POST', body: JSON.stringify({ note: why }) });
      setRes({ ok: true, text: `${x.productName} — 폐기로 옮겼습니다` }); r.reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '옮기지 못했습니다.' });
    }
  }

  return (
    <div data-open-stock>
      <p className="hint">반품 승인 때 「개봉됨」으로 판정한 상품입니다. 직판 상품은 보관(폐기 대기) · 폐기, 입점 상품은 판매자에게 돌려보냅니다. <b>식품 · 화장품 개봉품은 다시 팔 수 없습니다</b>(법무 확인) — 보관한 것은 폐기로 옮깁니다.</p>
      <div className="ad-dact">
        {(['HOLD', 'DISCARDED', 'TO_SELLER', ''] as const).map((s) => (
          <button key={s || 'ALL'} className={state === s ? 'btn-ok' : 'btn-plain'} onClick={() => setState(s)} data-open-state={s || 'ALL'}>
            {s ? STATE[s] : '전체'} {count(s)}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>들어온 날</th><th>주문</th><th>상품 · 옵션</th><th>수량</th><th>처리</th><th>메모</th><th /></tr></thead>
          <tbody>
            {d.items.map((x) => (
              <tr key={x.id} data-open-item={x.id}>
                <td>{x.createdAt}</td><td>{x.orderNo}</td>
                <td>{x.productName} <span className="dim">{x.optionLabel ?? ''}</span></td>
                <td>{x.qty}</td><td>{STATE[x.state] ?? x.state}</td><td>{x.note ?? ''}</td>
                <td>{x.state === 'HOLD' && <button className="btn-plain" onClick={() => discard(x)} data-open-discard>폐기</button>}</td>
              </tr>
            ))}
            {d.items.length === 0 && <tr><td colSpan={7} className="muted">없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {res && <p className={res.ok ? 'hint' : 'form-error'} data-open-res>{res.text}</p>}
    </div>
  );
}
