import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface ReviewRow {
  code: string; name: string; status: string; price: number | string; summary: string | null; caution: string | null;
  notice: Record<string, string> | null; reviewNo: string | null; categoryCode: string | null; categoryName: string | null;
  sellerCode: string; sellerName: string; payable: boolean; submittedAt: string | null; options: number;
}

/**
 * SB-ADM-HST-010 소개몰 정산 › 「입점 상품 검수」 (v10.166 · D156 · docs/257)
 *
 * 판매자가 「검수 요청」한 상품 — 통과하면 판매자가 「판매 시작」을 할 수 있습니다.
 * 금지 표현 · 판매 범위(의료기기 · 건강기능식품 잠금) · 옵션은 DB 가 이미 막고, 여기서는 글 · 고시 · 광고 문구가 사실과 맞는지 봅니다.
 */
export function HealthProductReviews() {
  const list = useApi<ReviewRow[]>('/admin/health/product-reviews');
  const a = useAct();
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const rows = list.data;

  const approve = (x: ReviewRow) => void a.run(x.code, () => api(`/admin/health/product-reviews/${encodeURIComponent(x.code)}`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVE' }) }),
    list.reload, `${x.name} 검수를 통과시켰습니다. 판매자가 「판매 시작」을 할 수 있습니다.`);
  const reject = (x: ReviewRow) => {
    const note = prompt(`${x.name} 반려 사유 — 무엇을 고치면 되는지까지 적어 주십시오(판매자에게 그대로 보임)`) ?? '';
    if (!note.trim()) return;
    void a.run(x.code, () => api(`/admin/health/product-reviews/${encodeURIComponent(x.code)}`, { method: 'POST', body: JSON.stringify({ decision: 'REJECT', note }) }), list.reload);
  };

  return (
    <>
      <h3 className="sec" data-product-reviews="">입점 상품 검수 <em>{rows.length}</em></h3>
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">검수를 기다리는 입점 상품이 없습니다.</p>}
      {rows.map((x) => (
        <div key={x.code} className="card row" data-product-review={x.code}>
          <div className="row-main">
            <strong>{x.name}</strong> <span className="dim mono">{x.code}</span>
            <span className="dim">{x.sellerName} · {x.categoryName ?? x.categoryCode ?? '갈래 없음'} · {n(x.price)}원 · 옵션 {x.options} · {x.payable ? '지급 가능' : '하위가맹점 없음(판매 시작 막힘)'} · 요청 {ymdhm(x.submittedAt)}</span>
            {x.summary && <span className="dim">{x.summary}</span>}
            {x.notice && Object.keys(x.notice).length > 0 && (
              <span className="dim">고시 {Object.entries(x.notice).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>
            )}
            {x.caution && <span className="dim">주의 {x.caution}</span>}
          </div>
          <div className="row-act">
            <button className="btn-ok" disabled={a.busy === x.code} onClick={() => approve(x)}>통과</button>{' '}
            <button className="btn-no" disabled={a.busy === x.code} onClick={() => reject(x)}>반려</button>
          </div>
        </div>
      ))}
    </>
  );
}
