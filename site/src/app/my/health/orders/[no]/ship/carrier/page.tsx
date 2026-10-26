/** SB-HLT-MYO-040 택배사 조회 · v10.27 (G-130) — 시안 「택배사 조회」와 같은 화면 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder, HltShipment } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav } from '@/components/health/MyHltNav';
import { CopyText } from '@/components/health/CopyText';

import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('hCarrier.meta') };
}
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ no: string }> };

/**
 * 택배사 조회 — 택배사 조회 창으로 넘길 값(택배사 · 송장번호)을 보입니다.
 * 택배사 연동 전에는 바깥 창을 열지 않고 송장번호 복사로 대신합니다. 이름 · 주소 · 연락처는 넘기지 않습니다.
 * v10.31 (시안 「택배사에서 보기」 — 실제 서비스는 택배사 조회 창을 새 창으로 엶) — 서버가 택배사 공개 조회 주소에 송장번호만 넣어 준
 *   trackUrl 을 새 창으로 엽니다(보던 소개몰 화면은 그대로). 주소를 모르는 택배사면 송장번호 복사로 대신합니다.
 */
export default async function MyHltCarrier({ params }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('myDeal');
  const f = await getFmt();
  const no = decodeURIComponent((await params).no);
  const enc = encodeURIComponent(no);
  let o: HltOrder | null = null; let ships: HltShipment[] = []; let err: string | null = null;
  try {
    [o, ships] = await Promise.all([
      apiGetPersonal<HltOrder>(`/me/health/orders/${enc}`),
      apiGetPersonal<HltShipment[]>(`/me/health/orders/${enc}/shipments`),
    ]);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 && f.ko ? e.body.message : t('h.shipLoadFail');
  }
  if (!o) {
    return (<><div className="hlt"><MyHltNav on="orders" /><div className="page-head"><h1>{t('hCarrier.title')}</h1></div>
      <HltEmpty msg={err ?? t('h.notFound')} href="/my/health/orders" label={t('hNav.orders')} /></div><i hidden data-root-end="" /></>);
  }
  const last = ships.find((s) => s.trackingNo) ?? null;
  return (
    <><div className="hlt">
      <MyHltNav on="orders" />
      <div className="hlt-crumb">
        <Link href="/my/health/orders">{t('hNav.orders')}</Link> › <Link href={`/my/health/orders/${enc}`}>{o.orderNo}</Link> › <Link href={`/my/health/orders/${enc}/ship`}>{t('hShip.title')}</Link> › {t('hCarrier.title')}
      </div>
      <div className="page-head"><h1>{t('hCarrier.title')}</h1></div>
      <section className="hlt-box" data-carrier="">
        {last ? (
          <>
            <p className="hint">{t.rich('hCarrier.intro', { b: (c) => <b>{c}</b> })}</p>
            <table className="tbl hlt-tbl"><tbody>
              <tr><th>{t('h.carrier')}</th><td>{last.carrier ?? '—'}</td></tr>
              <tr><th>{t('h.trackingNo')}</th><td className="mono">{last.trackingNo}</td></tr>
              <tr><th>{t('hCarrier.passed')}</th><td>{t('hCarrier.passedV')}</td></tr>
              <tr><th>{t('hCarrier.pre')}</th><td>{t('hCarrier.preV')}</td></tr>
            </tbody></table>
            <div className="hlt-btns">
              {last.trackUrl && <a className="hlt-btn sm pri" href={last.trackUrl} target="_blank" rel="noopener noreferrer" data-carrier-open="">{t('hCarrier.open')}</a>}
              <CopyText text={last.trackingNo ?? ''} label={t('h.copyTracking')} />
              <Link className="hlt-btn sm" href={`/my/health/orders/${enc}/ship`}>{t('hCarrier.back')}</Link></div>
          </>
        ) : (
          <>
            {/* v10.32 — 발송 전에도 시안의 표 · 단추 2 모양(값은 비어 있음 · 단추는 누를 수 없음) */}
            <p className="hint">{t('hCarrier.none')}</p>
            <table className="tbl hlt-tbl" data-carrier-empty=""><tbody>
              <tr><th>{t('h.carrier')}</th><td className="hint">{t('h.notShipped')}</td></tr>
              <tr><th>{t('h.trackingNo')}</th><td className="hint">{t('h.notShipped')}</td></tr>
              <tr><th>{t('hCarrier.passed')}</th><td>{t('hCarrier.passedV')}</td></tr>
              <tr><th>{t('hCarrier.pre')}</th><td>{t('hCarrier.preV')}</td></tr>
            </tbody></table>
            <div className="hlt-btns">
              <button type="button" className="hlt-btn sm pri" disabled title={t('hCarrier.afterShip')}>{t('hCarrier.open')}</button>
              <Link className="hlt-btn sm" href={`/my/health/orders/${enc}/ship`}>{t('hCarrier.back')}</Link></div>
          </>
        )}
      </section>
    </div><i hidden data-root-end="" /></>
  );
}
