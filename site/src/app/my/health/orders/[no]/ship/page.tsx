/** SB-HLT-MYO-030 배송 조회 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder, HltShipment } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav } from '@/components/health/MyHltNav';
import { CopyText } from '@/components/health/CopyText';
import { ORDER_LABEL, SHIP_LABEL, ymdhm } from '@/components/health/util';

export const metadata: Metadata = { title: '배송 조회 · 소개몰' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ no: string }> };

/**
 * 배송 조회 — GET /me/health/orders/{no} + /shipments
 * 언제 무엇이 있었는지 남습니다 — "안 왔다" 는 문의에 답하기 위해서입니다(API 설명).
 * 택배사 연동 전에는 송장번호를 그대로 보여 드립니다 — 빈 화면을 주지 않습니다.
 */
export default async function MyHltShip({ params }: Props) {
  if (!(await me())) redirect('/login');
  const no = decodeURIComponent((await params).no);
  const enc = encodeURIComponent(no);

  let o: HltOrder | null = null;
  let ships: HltShipment[] = [];
  let err: string | null = null;
  try {
    [o, ships] = await Promise.all([
      apiGetPersonal<HltOrder>(`/me/health/orders/${enc}`),
      apiGetPersonal<HltShipment[]>(`/me/health/orders/${enc}/shipments`),
    ]);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '배송 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }

  if (!o) {
    return (
      <><div className="hlt">
        <MyHltNav on="orders" />
        <div className="page-head"><h1>배송 조회</h1></div>
        <HltEmpty msg={err ?? '주문을 찾을 수 없습니다.'} href="/my/health/orders" label="내 주문" />
      </div><i hidden data-root-end="" /></>
    );
  }

  const last = ships.find((s) => s.trackingNo) ?? ships[0];

  return (
    <><div className="hlt">
      <MyHltNav on="orders" />
      <div className="hlt-crumb">
        <Link href="/my/health/orders">내 주문</Link> › <Link href={`/my/health/orders/${enc}`}>{o.orderNo}</Link> › 배송 조회
      </div>
      <div className="page-head"><h1>배송 조회</h1></div>

      <section className="hlt-box">
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>주문번호</th><td>{o.orderNo}</td></tr>
            <tr><th>주문 상태</th><td>{ORDER_LABEL[o.status] ?? o.status}</td></tr>
            <tr><th>택배사</th><td>{last?.carrier ?? '발송 전'}</td></tr>
            <tr><th>송장번호</th><td className="mono">{last?.trackingNo ?? '발송 전'}</td></tr>
          </tbody>
        </table>
        {last?.trackingNo && (
          <div className="hlt-btns">
            <CopyText text={last.trackingNo} label="송장번호 복사" />
            <Link className="hlt-btn sm" href={`/my/health/orders/${enc}/ship/carrier`} data-carrier-link="">택배사에서 보기</Link>
          </div>
        )}
      </section>

      <section className="hlt-box">
        <h3>배송 추적</h3>
        {ships.length === 0 ? (
          <p className="hint">
            아직 발송 전입니다. 결제 확인 후 영업일 2일 안에 보내 드리고, 보내면 여기에 기록이 남습니다.
          </p>
        ) : (
          <ul className="hlt-tl">
            {ships.map((s, i) => (
              <li key={i} className={i === 0 ? 'on' : undefined}>
                <b>{SHIP_LABEL[s.state] ?? s.state}</b> <span className="hint">{ymdhm(s.happenedAt)}</span>
                {s.note && <p className="hint">{s.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="hlt-btns">
        <Link className="hlt-btn" href={`/my/health/orders/${enc}`}>주문 상세</Link>
        {['SHIPPED', 'DELIVERED', 'CONFIRMED'].includes(o.status) &&
          <Link className="hlt-btn" href={`/my/health/returns/new?o=${enc}`}>반품신청</Link>}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
