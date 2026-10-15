import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Row {
  orderNo: string; status: string; total: number | string; paidAt: string | null; shippedAt: string | null;
  deliveredAt: string | null; confirmedAt: string | null; confirmedBy: string | null; confirmDue: string | null;
  itemName: string | null; itemCount: number; carrier: string | null; trackingNo: string | null;
  shipState: string | null; shipAt: string | null; openReturn: boolean;
}
interface List { counts: { toShip: number; shipping: number; delivered: number; confirmed: number }; carriers: string[]; items: Row[] }

const ST: Record<string, string> = { PAID: '결제 완료', PREPARING: '상품 준비중', SHIPPED: '배송중', DELIVERED: '배송 완료', CONFIRMED: '구매확정' };
const FILTERS: Array<[string, string]> = [['PAID', '발송할 것'], ['SHIPPED', '배송중'], ['DELIVERED', '배송 완료'], ['CONFIRMED', '구매확정'], ['', '전체']];

/**
 * SB-ADM-HOR-010 소개몰 주문 — v10.28 (G-147 · G-194 · D035 · 10/9 확인한 제안 그림 ⑦).
 * 결제 완료 주문에 택배사 · 송장번호를 넣고 「발송 처리」 → 「배송중」. 단계는 운영자가 바꿈(택배사 연동은 계약 뒤).
 * 송장은 배송중일 때만 고침(전 기록은 남음). 배송 완료 7일(청약철회 기간이 더 길면 그 기간) 뒤 자동 구매확정. 모든 처리는 감사 기록.
 */
export function HealthOrders({ onGo }: { onGo?: (tab: string) => void } = {}) {
  const [filter, setFilter] = useState('PAID');
  const [q, setQ] = useState('');
  const path = `/admin/health/orders?${new URLSearchParams({ ...(filter ? { status: filter } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`;
  const list = useApi<List>(path);
  const a = useAct();
  const [form, setForm] = useState<Record<string, { carrier: string; trackingNo: string }>>({});
  const f = (no: string, carriers: string[]) => form[no] ?? { carrier: carriers[0] ?? '', trackingNo: '' };
  const setF = (no: string, carriers: string[], k: 'carrier' | 'trackingNo', v: string) =>
    setForm((s) => ({ ...s, [no]: { ...f(no, carriers), [k]: v } }));

  const post = (key: string, url: string, body: unknown) =>
    void a.run(key, () => api<{ note: string }>(url, { method: 'POST', body: JSON.stringify(body) }), list.reload);

  if (list.error) return <ErrorView error={list.error} />;
  const d = list.data; const carriers = d?.carriers ?? [];
  return (
    <section data-screen="SB-ADM-HOR-010">
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <p className="lead">택배사 연동 전이라 단계는 운영자가 바꿉니다.
        배송 완료 7일(청약철회 기간이 더 길면 그 기간) 뒤 자동으로 구매확정됩니다. 처리는 모두 감사 기록에 남습니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts" style={{ margin: '8px 0' }} data-hor-filter>
        {FILTERS.map(([k, label]) => {
          const cnt = d ? ({ PAID: d.counts.toShip, SHIPPED: d.counts.shipping, DELIVERED: d.counts.delivered, CONFIRMED: d.counts.confirmed } as Record<string, number>)[k] : undefined;
          return <button key={k || 'all'} type="button" className={filter === k ? 'btn-ok' : 'btn-plain'} onClick={() => setFilter(k)} data-hor-f={k || 'ALL'}>
            {label}{cnt !== undefined ? ` ${cnt}` : ''}</button>;
        })}
        <input placeholder="주문번호 찾기" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: 8, width: 180 }} data-hor-q />
      </div>
      {!d ? <p className="muted">불러오는 중…</p> : d.items.length === 0 ? <p className="muted" data-hor-empty>해당하는 주문이 없습니다.</p> : (
        <table className="tbl" data-hor-table>
          <thead><tr><th>주문번호</th><th>상품</th><th>금액</th><th>결제</th><th>상태</th><th>택배사 · 송장</th><th>처리</th></tr></thead>
          <tbody>
            {d.items.map((r) => {
              const v = f(r.orderNo, carriers);
              const toShip = r.status === 'PAID' || r.status === 'PREPARING';
              return (
                <tr key={r.orderNo} data-hor-row={r.orderNo}>
                  <td className="mono">{r.orderNo}</td>
                  <td>{r.itemName ?? '—'}{r.itemCount > 1 ? ` (${r.itemCount}종)` : ''}</td>
                  <td className="num-cell">{n(r.total)}원</td>
                  <td>{ymdhm(r.paidAt)}</td>
                  <td>{ST[r.status] ?? r.status}{r.openReturn && <div className="warn-text">취소 · 반품 신청 처리 중</div>}
                    {r.status === 'DELIVERED' && r.confirmDue && <div className="muted">자동 확정 {ymdhm(r.confirmDue)}</div>}
                    {r.status === 'CONFIRMED' && <div className="muted">{r.confirmedBy === 'AUTO' ? '자동' : '구매자'} · {ymdhm(r.confirmedAt)}</div>}</td>
                  <td>{toShip || r.status === 'SHIPPED' ? (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <select value={v.carrier} onChange={(e) => setF(r.orderNo, carriers, 'carrier', e.target.value)} data-hor-carrier>
                        {carriers.map((c) => <option key={c}>{c}</option>)}</select>
                      <input value={v.trackingNo} placeholder={r.trackingNo ?? '숫자 10 ~ 14자리'} inputMode="numeric" style={{ width: 140 }}
                        onChange={(e) => setF(r.orderNo, carriers, 'trackingNo', e.target.value.replace(/\D/g, ''))} data-hor-track />
                    </span>) : <span className="mono">{r.carrier ?? '—'} {r.trackingNo ?? ''}</span>}
                    {r.status === 'SHIPPED' && r.trackingNo && <div className="muted mono">지금: {r.carrier} {r.trackingNo}</div>}</td>
                  <td className="acts">
                    {toShip && <button type="button" className="btn-ok" disabled={a.busy === `s-${r.orderNo}` || r.openReturn}
                      onClick={() => post(`s-${r.orderNo}`, `/admin/health/orders/${r.orderNo}/ship`, v)} data-hor-ship>발송 처리</button>}
                    {r.status === 'SHIPPED' && <>
                      <button type="button" className="btn-ok" disabled={a.busy === `d-${r.orderNo}`}
                        onClick={() => post(`d-${r.orderNo}`, `/admin/health/orders/${r.orderNo}/advance`, { state: 'DELIVERED' })} data-hor-deliver>배송 완료로</button>
                      <button type="button" className="btn-plain" disabled={a.busy === `t-${r.orderNo}` || !v.trackingNo}
                        onClick={() => post(`t-${r.orderNo}`, `/admin/health/orders/${r.orderNo}/tracking`, v)} data-hor-fix>송장 고치기</button>
                    </>}
                    {r.status === 'DELIVERED' && <span className="muted">구매확정 대기</span>}
                  </td>
                </tr>);
            })}
          </tbody>
        </table>)}
      {/* v10.31 — 시안 아래 바로가기(소개몰 리뷰 · 문의 → · 소개몰 정산 →) */}
      {onGo && <div className="ad-dact">
        <button className="btn-plain" onClick={() => onGo('hlt-reviews')}>소개몰 리뷰 · 문의 →</button>
        <button className="btn-plain" onClick={() => onGo('hlt-settle')}>소개몰 정산 →</button>
      </div>}
    </section>
  );
}
