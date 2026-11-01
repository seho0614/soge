import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface Watch {
  signups: number; logins: number; posts: number; listings: number; orders: number; paidOrders: number; stubPaidOrders: number;
  openAlerts: number; orderOpen: 'on' | 'off'; assumePayment: 'on' | 'off'; directOnSale: number; warn?: string;
  stubOrders: Array<{ orderNo: string; total: number | string; status: string; paidAt: string }>;
}

/**
 * v10.170 (D159 · docs/262) — 운영 화면 첫 화면 「공개 직후 지켜보기」
 *
 * 사용자 웹을 전체 공개(11/1)한 뒤 오늘 들어온 것 · **시험 결제(stub)로 결제 완료된 주문**(돈을 받지 않은 주문) · 확인 안 한 운영 알림.
 * 「주문 받기」(mall.order_open)를 여기서 바로 끄고 켭니다(SUPER — 사이트 설정과 같은 API · 감사 기록).
 */
export function LaunchWatch() {
  const w = useApi<Watch>('/admin/launch-watch');
  const a = useAct();
  if (w.error || !w.data) return null;
  const d = w.data;
  const toggle = () => {
    const to = d.orderOpen === 'on' ? 'off' : 'on';
    if (!confirm(to === 'off' ? '소개몰 주문 · 결제를 막습니다(상품 보기 · 담기는 됨). 결제대행사 연결 전 시험 결제 주문을 막으려면 끄십시오.' : '소개몰 주문 · 결제를 엽니다. 결제대행사가 연결되지 않았으면 시험 결제 주문이 생깁니다.')) return;
    void a.run('order', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'mall.order_open', value: to }) }), w.reload,
      to === 'off' ? '주문 받기를 껐습니다.' : '주문 받기를 켰습니다.');
  };
  const tiles: Array<[string, number, boolean?]> = [
    ['오늘 가입', d.signups], ['오늘 로그인', d.logins], ['소개광장 글', d.posts], ['매물', d.listings],
    ['소개몰 주문', d.orders], ['결제 완료', d.paidOrders], ['시험 결제 주문', d.stubPaidOrders, d.stubPaidOrders > 0], ['확인 안 한 알림', d.openAlerts, d.openAlerts > 0],
  ];
  return (
    <section className="card pad" data-launch-watch="">
      <h3 className="sec">공개 직후 지켜보기 <small className="dim">오늘 · 한국 시간</small></h3>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-tiles">
        {tiles.map(([k, v, warn]) => (
          <div key={k} className={`ad-tile${warn ? ' warn' : ''}`} data-watch={k}><span className="tl">{k}</span><b>{n(v)}</b></div>
        ))}
      </div>
      {d.warn && <p className="card warn" data-watch-warn="">{d.warn}</p>}
      <p>
        소개몰 주문 받기 <b data-order-open={d.orderOpen}>{d.orderOpen === 'on' ? '켜짐' : '꺼짐'}</b> · 간주 결제 {d.assumePayment === 'on' ? '켜짐(시험 결제)' : '꺼짐'} · 판매 중 직판 상품 {n(d.directOnSale)}개{' '}
        <button className={d.orderOpen === 'on' ? 'btn-no' : 'btn-ok'} disabled={a.busy === 'order'} onClick={toggle} data-order-toggle="">{d.orderOpen === 'on' ? '주문 받기 끄기' : '주문 받기 켜기'}</button>
      </p>
      {d.stubOrders.length > 0 && (
        <table className="tbl">
          <thead><tr><th>시험 결제 주문</th><th>금액</th><th>상태</th><th>결제 시각</th></tr></thead>
          <tbody>{d.stubOrders.map((o) => <tr key={o.orderNo}><td className="mono">{o.orderNo}</td><td className="num-cell">{n(o.total)}</td><td>{o.status}</td><td className="muted">{ymdhm(o.paidAt)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
