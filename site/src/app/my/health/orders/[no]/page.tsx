/** SB-HLT-MYO-020 주문 상세 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder, HltReturn } from '@/components/health/types';
import { HltEmpty, SellerBox } from '@/components/health/HltParts';
import { MyHltNav, OrderButtons } from '@/components/health/MyHltNav';
import { ReviewForm, type MyReview } from '@/components/health/ReviewForm';
import { Msgs } from '@/i18n/Msgs';
import { ProductArt } from '@/components/health/ProductArt';
import {
  codeText, ORDER_LABEL, ORDER_STEPS, ORDER_TONE, reasonLabel, RETURN_KIND, RETURN_STATE, RETURN_TONE, ymd, ymdhm,
} from '@/components/health/util';

import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('hOrder.meta') };
}
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ no: string }> };

/**
 * 주문 상세 — GET /me/health/orders/{no}
 * 주문 시점에 복사된 청약철회 규칙이 품목마다 옵니다 — 상품 규칙이 나중에 바뀌어도 이 값이 적용됩니다.
 * 이 주문의 취소·반품 신청도 함께 보여 드립니다(GET /me/health/returns 에서 거름).
 */
export default async function MyHltOrderDetail({ params }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('myDeal');
  const f = await getFmt();
  const to = await getTranslations('order');
  const no = decodeURIComponent((await params).no);

  let o: HltOrder | null = null;
  let err: string | null = null;
  try {
    o = await apiGetPersonal<HltOrder>(`/me/health/orders/${encodeURIComponent(no)}`);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 && f.ko ? e.body.message : t('h.loadFail');
  }
  if (!o) {
    return (
      <><div className="hlt">
        <MyHltNav on="orders" />
        <div className="page-head"><h1>{t('hOrder.title')}</h1></div>
        <HltEmpty msg={err ?? t('h.notFound')} href="/my/health/orders" label={t('hNav.orders')} />
      </div><i hidden data-root-end="" /></>
    );
  }

  const returns = (await apiGetPersonal<HltReturn[]>('/me/health/returns').catch(() => [] as HltReturn[]))
    .filter((r) => r.orderNo === o!.orderNo);
  /* v10.28 (D036) — 구매확정 주문이면 상품 줄마다 리뷰 쓰기 · 내 리뷰 */
  const myReviews = o.status === 'CONFIRMED'
    ? await apiGetPersonal<Array<MyReview & { productCode: string; optionId: string | null }>>(`/me/health/orders/${encodeURIComponent(o.orderNo)}/reviews`).catch(() => [])
    : [];
  const cur = ORDER_STEPS.indexOf(o.status);
  const ended = o.status === 'CANCELED' || o.status === 'RETURNED';

  return (
    <><div className="hlt">
      <MyHltNav on="orders" />
      <div className="hlt-crumb"><Link href="/my/health/orders">{t('hNav.orders')}</Link> › {o.orderNo}</div>
      <div className="page-head">
        <h1>{t('hOrder.title')}</h1>
        <span className={`state state-${ORDER_TONE[o.status] ?? 'held'}`}>{codeText(to, 'orderState', o.status, ORDER_LABEL[o.status] ?? o.status)}</span>
      </div>

      <section className="hlt-box">
        <h3>{t('hOrder.progress')}</h3>
        {ended
          ? <p>{t('hOrder.ended', { label: codeText(to, 'orderState', o.status, ORDER_LABEL[o.status] ?? '') })}</p>
          : (
            <ol className="hlt-steps">
              {ORDER_STEPS.map((s, i) => <li key={s} className={i === cur ? 'on' : i < cur ? 'done' : undefined}>{codeText(to, 'orderState', s, ORDER_LABEL[s] ?? s)}</li>)}
            </ol>
          )}
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>{t('hOrder.order')}</th><td>{ymdhm(o.createdAt)}</td></tr>
            <tr><th>{t('hOrder.paid')}</th><td>{o.paidAt ? ymdhm(o.paidAt) : t('hOrder.unpaid')}</td></tr>
            <tr><th>{t('hOrder.shipped')}</th><td>{o.shippedAt ? ymdhm(o.shippedAt) : '-'}</td></tr>
            <tr><th>{t('hOrder.delivered')}</th><td>{o.deliveredAt ? ymdhm(o.deliveredAt) : '-'}</td></tr>
            {/* v10.28 (D035) — 구매확정(직접 · 자동) · 배송 완료면 자동 확정 기한 */}
            <tr data-confirm-row><th>{t('hOrder.confirm')}</th><td>{o.confirmedAt ? `${ymdhm(o.confirmedAt)} · ${o.confirmedBy === 'AUTO' ? t('hOrder.auto') : t('hOrder.manual')}`
              : o.confirmOverdue && o.confirmDue ? t('hOrder.overdue', { d: ymdhm(o.confirmDue) })
              : o.confirmDue ? t('hOrder.due', { d: ymdhm(o.confirmDue) }) : '-'}</td></tr>
            {/* v10.31 (시안 주문서 「배송 요청사항」) */}
            {o.shipMemo && <tr data-ship-memo><th>{t('hOrder.shipMemo')}</th><td>{o.shipMemo}</td></tr>}
          </tbody>
        </table>
        {/* v10.31 (결함 · 주문 시각 어긋남) — 시각 순서가 맞지 않는 예전 기록(시험 자료)은 그 사실을 알립니다. 이제 DB 가 순서를 지킵니다(D064) */}
        {((o.deliveredAt && o.deliveredAt < o.createdAt) || (o.shippedAt && o.shippedAt < o.createdAt) || (o.deliveredAt && !o.shippedAt)) && (
          <p className="hint" data-time-odd="">{t('hOrder.timeOdd')}</p>
        )}
      </section>

      <section className="hlt-box">
        <h3>{t('hOrder.items')}</h3>
        {o.items.map((i) => (
          <div key={i.optionId ?? i.code} className="hlt-ci" data-item={i.code}>
            <span className="hlt-mini"><ProductArt p={i} size={44} /></span>
            <div className="bd">
              <Link href={`/health/p/${encodeURIComponent(i.code)}`}><b>{i.name}</b></Link>
              {i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm" data-optlabel>{i.optionLabel}</span>}
              <span className="hint">{f.won(i.unitPrice, '-')} × {t('h.qty', { n: String(i.qty) })}</span>
              <span className="hint">
                {t('hOrder.withdraw', { n: String(i.withdrawalDays ?? 7) })}{i.withdrawalLabel && ` · ${i.withdrawalLabel}`}
                {i.withdrawalBlockedIf && t('hOrder.limit', { v: i.withdrawalBlockedIf })}
              </span>
            </div>
            <b className="money">{f.won(i.amount, '-')}</b>
          </div>
        ))}
      </section>

      {o.status === 'CONFIRMED' && (
        <section className="hlt-box" id="review" data-review-sec>
          <h3>{t('hOrder.review')}</h3>
          <Msgs ns={['hlt']}>{o.items.map((i) => (
            <ReviewForm key={`r-${i.optionId ?? i.code}`} orderNo={o!.orderNo} productCode={i.code} optionId={i.optionId ?? null} name={i.name}
              mine={myReviews.find((r) => r.productCode === i.code && (r.optionId ?? null) === (i.optionId ?? null)) ?? null} />
          ))}</Msgs>
        </section>
      )}

      <section className="hlt-box">
        <h3>{t('hOrder.payInfo')}</h3>
        <div className="hlt-sum"><span>{t('hOrder.goods')}</span><span>{f.won(o.goodsAmount, '-')}</span></div>
        <div className="hlt-sum"><span>{t('hOrder.shipFee')}</span><span>{Number(o.shipFee) === 0 ? t('hOrder.free') : f.won(o.shipFee, '-')}</span></div>
        <div className="hlt-sum tot"><span>{t('hOrder.totalPay')}</span><span>{f.won(o.total, '-')}</span></div>
      </section>

      {returns.length > 0 && (
        <section className="hlt-box">
          <h3>{t('hOrder.returnsH')}</h3>
          {returns.map((r) => (
            <div key={r.id} className="hlt-sum" data-return={r.kind}>
              <span>
                {ymd(r.createdAt)} · {codeText(to, 'returnKind', r.kind, RETURN_KIND[r.kind] ?? r.kind)} · {codeText(to, 'reason', r.reason, reasonLabel(r.reason))}
                {r.convertedFrom && t('hOrder.converted')}
                {/* v10.26 — 교환 배송비를 아직 내지 않은 교환은 여기서도 결제로 갑니다 */}
                {r.kind === 'EXCHANGE' && r.feeState === 'UNPAID' && r.state === 'REQUESTED' && (
                  <> · {t('hOrder.feeUnpaid', { v: f.won(r.exchangeFee, '-') })} <Link className="hlt-btn sm pri" href={`/my/health/returns/${encodeURIComponent(r.id)}/fee`} data-fee-pay-link>{t('hBtn.pay')}</Link></>
                )}
                {r.kind === 'EXCHANGE' && r.feeState === 'PAID' && t('hOrder.feePaid', { v: f.won(r.exchangeFee, '-') })}
              </span>
              <span className={`state state-${RETURN_TONE[r.state] ?? 'requested'}`}>{codeText(to, 'returnState', r.state, RETURN_STATE[r.state] ?? r.state)}</span>
            </div>
          ))}
          <Link href="/my/health/returns">{t('hOrder.viewReturns')}</Link>
        </section>
      )}

      <SellerBox />
      <OrderButtons o={o} detail={false} />
    </div><i hidden data-root-end="" /></>
  );
}
