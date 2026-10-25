/** SB-HLT-RTN-020 취소 · 반품 내역 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltReturn } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav } from '@/components/health/MyHltNav';
import {
  codeText, reasonLabel, RETURN_KIND, RETURN_REASONS, RETURN_SHIP_ROUND_TRIP, RETURN_STATE, RETURN_TONE, ymd,
} from '@/components/health/util';

import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('hReturns.meta') };
}
export const dynamic = 'force-dynamic';

/** 교환 배송비 상태 — 서버 FEE_STATE_SQL · v10.99 이름은 사전(myDeal.hReturns.fee.*) */
const FEE_STATES = ['NONE', 'UNPAID', 'PAID', 'REFUNDED'] as const;
const isFeeState = (s: string): s is (typeof FEE_STATES)[number] => (FEE_STATES as readonly string[]).includes(s);

/** 취소 · 반품 내역 — GET /me/health/returns (본인 것만, 최근 50건) */
export default async function MyHltReturns() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('myDeal');
  const f = await getFmt();
  const to = await getTranslations('order');

  let rows: HltReturn[] | null = null;
  let err: string | null = null;
  try {
    rows = await apiGetPersonal<HltReturn[]>('/me/health/returns');
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : t('hReturns.loadFail');
  }

  return (
    <><div className="hlt">
      <MyHltNav on="returns" />
      <div className="page-head">
        <h1>{t('hNav.returns')}</h1>
        <Link className="hlt-btn sm" href="/my/health/returns/new">{t('hReturns.new')}</Link>
      </div>
      {rows === null ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows.length === 0 ? (
        <HltEmpty msg={t('hReturns.empty')} href="/my/health/orders" label={t('hReturns.orders')} />
      ) : (
        <div className="rows">
          {rows.map((r) => {
            const party = RETURN_REASONS.find((x) => x.code === r.reason)?.party;
            return (
              <div key={r.id} className="hlt-ord">
                <div className="hlt-ord-h">
                  <span>{ymd(r.createdAt)} · <b>{codeText(to, 'returnKind', r.kind, RETURN_KIND[r.kind] ?? r.kind)}</b></span>
                  <span className={`state state-${RETURN_TONE[r.state] ?? 'requested'}`}>{codeText(to, 'returnState', r.state, RETURN_STATE[r.state] ?? r.state)}</span>
                </div>
                <table className="tbl hlt-tbl">
                  <tbody>
                    <tr><th>{t('h.orderNo')}</th><td><Link href={`/my/health/orders/${encodeURIComponent(r.orderNo)}`}>{r.orderNo}</Link></td></tr>
                    <tr><th>{t('hReturns.reason')}</th><td>{codeText(to, 'reason', r.reason, reasonLabel(r.reason))}</td></tr>
                    {party && r.kind === 'RETURN' && (
                      <tr><th>{t('hReturns.cost')}</th><td>{party === 'CUSTOMER'
                        ? t('hReturns.costCustomer', { v: f.won(RETURN_SHIP_ROUND_TRIP, '-') })
                        : t('hReturns.costSeller')}</td></tr>
                    )}
                    {r.convertedFrom && <tr><th>{t('hReturns.changed')}</th><td>{t('hReturns.changedV')}</td></tr>}
                    {/* v10.26 — 교환 배송비(회원 사정 왕복 · 신청 때 결제). 회사 사정 교환은 0원 */}
                    {r.kind === 'EXCHANGE' && (
                      <tr data-fee-state={r.feeState ?? 'NONE'}><th>{t('hReturns.exFee')}</th><td>
                        {r.feeState === 'REFUNDED'
                          ? t('hReturns.feeRefunded')
                          : (r.exchangeFee ?? 0) > 0 ? `${f.won(r.exchangeFee, '-')} · ${isFeeState(r.feeState ?? 'NONE') ? t(`hReturns.fee.${(r.feeState ?? 'NONE') as (typeof FEE_STATES)[number]}`) : ''}` : t('hReturns.feeNone')}
                        {r.feeState === 'UNPAID' && r.state === 'REQUESTED' && (
                          <> <Link className="hlt-btn sm pri" href={`/my/health/returns/${encodeURIComponent(r.id)}/fee`} data-fee-pay-link>{t('hBtn.pay')}</Link></>
                        )}
                      </td></tr>
                    )}
                    {r.kind !== 'EXCHANGE' && r.beforePayment && <tr><th>{t('hReturns.refund')}</th><td data-before-payment>{t('hReturns.beforePay')}</td></tr>}
                    {r.kind !== 'EXCHANGE' && !r.beforePayment && <tr><th>{t('hReturns.refund')}</th><td data-ship-deduction={r.shipDeduction ?? 0}>{r.refundAmount != null ? f.won(r.refundAmount, '-') : t('hReturns.tbd')}{(r.shipDeduction ?? 0) > 0 && t('hReturns.deduct', { v: f.won(r.shipDeduction!, '-') })}{r.refundedAt && t('hReturns.refunded', { d: ymd(r.refundedAt) })}</td></tr>}
                    {r.decideNote && <tr><th>{t('hReturns.memo')}</th><td>{r.decideNote}</td></tr>}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
