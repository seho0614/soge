import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { krw, ymdhm, ORDER_STATE } from '@/components/partners/fmt';
import type { AffOrder } from '@/components/partners/types';

export const metadata: Metadata = { title: '주문/고객현황' };

/* 탭 — 서버 state 값 그대로. 모르는 값이 주소로 오면 전체로 돌립니다. */
const TABS = [
  { v: '',          t: '전체' },
  { v: 'PENDING',   t: '확인 중' },
  { v: 'CONFIRMED', t: '확정' },
  { v: 'SETTLED',   t: '정산됨' },
  { v: 'CANCELED',  t: '취소' },
];

/** 클릭 → 주문까지 걸린 시간. 72시간 규칙을 눈으로 보게 합니다. */
function gap(click: string | null, order: string) {
  if (!click) return '—';
  const h = Math.round((new Date(order).getTime() - new Date(click).getTime()) / 3_600_000);
  return h < 48 ? `${h}시간` : `${Math.round(h / 24)}일`;
}

/**
 * SB-AFC-ORD-010 주문/고객현황 — GET /partner/affiliate/orders?state=
 *
 * ★ 귀속은 **72시간 last-click** 입니다. 귀속 안 된 주문은 서버가 적어 주는
 *   이유(noteIfUnattributed)를 그대로 보여 드립니다 — 안 적으면 "왜 수수료가 없냐" 고 묻습니다.
 */
export default async function PartnerOrdersPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');

  const { state } = await searchParams;
  const cur = TABS.some((t) => t.v === state) ? state ?? '' : '';
  const qs = cur ? `?state=${cur}` : '';
  const rows = await apiGetPersonal<AffOrder[]>(`/partner/affiliate/orders${qs}`).catch(() => null);

  return (
    <>
      <div className="page-head"><h1>주문/고객현황</h1></div>
      <p className="lead">내 링크로 들어온 주문입니다.</p>
      <div className="notice">
        <b>클릭 후 72시간 안에 주문해야 수수료가 붙습니다.</b> 여러 파트너의 링크를 거쳤다면 <b>마지막으로 누른</b> 링크에 귀속됩니다.
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <Link key={t.v || 'all'} href={t.v ? `/partners/orders?state=${t.v}` : '/partners/orders'}
            role="tab" aria-selected={cur === t.v} className={cur === t.v ? 'on' : undefined}>{t.t}</Link>
        ))}
      </div>

      {rows === null ? (
        <p className="form-error" role="alert">주문을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : rows.length === 0 ? (
        <p className="empty">{cur ? '이 상태의 주문이 없습니다.' : '아직 들어온 주문이 없습니다.'}</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>주문번호</th><th>상품</th><th>링크</th><th className="num">수수료</th><th>상태</th><th>클릭 → 주문</th><th>주문일시</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.orderNo}>
                <td className="mono">{o.orderNo}</td>
                <td>{o.product}</td>
                <td>{o.linkLabel ?? <span className="dim">—</span>}</td>
                <td className="num">{o.attributed ? krw(o.commission) : <span className="dim">—</span>}</td>
                <td>
                  {o.attributed
                    ? <span className={'state ' + (ORDER_STATE[o.state]?.c ?? '')}>{ORDER_STATE[o.state]?.t ?? o.state}</span>
                    : <span className="state state-rejected">귀속 안 됨</span>}
                  {o.noteIfUnattributed && <div className="dim">{o.noteIfUnattributed}</div>}
                </td>
                <td>{gap(o.clickedAt, o.orderedAt)}</td>
                <td>{ymdhm(o.orderedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
