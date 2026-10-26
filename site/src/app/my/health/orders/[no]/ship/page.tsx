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
import { codeText, ORDER_LABEL, SHIP_LABEL, ymdhm } from '@/components/health/util';

import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('hShip.meta') };
}
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ no: string }> };

/**
 * 배송 조회 — GET /me/health/orders/{no} + /shipments
 * 언제 무엇이 있었는지 남습니다 — "안 왔다" 는 문의에 답하기 위해서입니다(API 설명).
 * 택배사 연동 전에는 송장번호를 그대로 보여 드립니다 — 빈 화면을 주지 않습니다.
 */
export default async function MyHltShip({ params }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('myDeal');
  const f = await getFmt();
  const to = await getTranslations('order');
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
    err = e instanceof ApiFailure && e.status < 500 && f.ko ? e.body.message : t('h.shipLoadFail');
  }

  if (!o) {
    return (
      <><div className="hlt">
        <MyHltNav on="orders" />
        <div className="page-head"><h1>{t('hShip.title')}</h1></div>
        <HltEmpty msg={err ?? t('h.notFound')} href="/my/health/orders" label={t('hNav.orders')} />
      </div><i hidden data-root-end="" /></>
    );
  }

  const last = ships.find((s) => s.trackingNo) ?? ships[0];

  return (
    <><div className="hlt">
      <MyHltNav on="orders" />
      <div className="hlt-crumb">
        <Link href="/my/health/orders">{t('hNav.orders')}</Link> › <Link href={`/my/health/orders/${enc}`}>{o.orderNo}</Link> › {t('hShip.title')}
      </div>
      <div className="page-head"><h1>{t('hShip.title')}</h1></div>

      <section className="hlt-box">
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>{t('h.orderNo')}</th><td>{o.orderNo}</td></tr>
            <tr><th>{t('hShip.state')}</th><td>{codeText(to, 'orderState', o.status, ORDER_LABEL[o.status] ?? o.status)}</td></tr>
            <tr><th>{t('h.carrier')}</th><td>{last?.carrier ?? t('h.notShipped')}</td></tr>
            <tr><th>{t('h.trackingNo')}</th><td className="mono">{last?.trackingNo ?? t('h.notShipped')}</td></tr>
          </tbody>
        </table>
        {last?.trackingNo && (
          <div className="hlt-btns">
            <CopyText text={last.trackingNo} label={t('h.copyTracking')} />
            <Link className="hlt-btn sm" href={`/my/health/orders/${enc}/ship/carrier`} data-carrier-link="">{t('hShip.atCarrier')}</Link>
          </div>
        )}
      </section>

      <section className="hlt-box">
        <h3>{t('hShip.trackH')}</h3>
        {ships.length === 0 ? (
          <p className="hint">
            {t('hShip.none')}
          </p>
        ) : (
          <ul className="hlt-tl">
            {ships.map((s, i) => (
              <li key={i} className={i === 0 ? 'on' : undefined}>
                <b>{codeText(to, 'shipState', s.state, SHIP_LABEL[s.state] ?? s.state)}</b> <span className="hint">{ymdhm(s.happenedAt)}</span>
                {s.note && <p className="hint">{s.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="hlt-btns">
        <Link className="hlt-btn" href={`/my/health/orders/${enc}`}>{t('hOrder.title')}</Link>
        {['SHIPPED', 'DELIVERED', 'CONFIRMED'].includes(o.status) &&
          <Link className="hlt-btn" href={`/my/health/returns/new?o=${enc}`}>{t('hBtn.ret')}</Link>}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
