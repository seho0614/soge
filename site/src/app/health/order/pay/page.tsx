/** SB-HLT-ORD-020 결제 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder } from '@/components/health/types';
import { HltEmpty, HltNav, HltSteps } from '@/components/health/HltParts';
import { PayForm } from '@/components/health/PayForm';
import { codeText, ORDER_LABEL } from '@/components/health/util';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('order'))('meta.pay') };
}
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ no?: string; m?: string }> };

/**
 * 결제 — 주문번호(?no=)의 결제 대기 주문만 결제합니다.
 * 내 주문 목록의 "결제하기" 도 여기로 옵니다.
 * D006 — 결제창(토스) → /health/order/pay/success 에서 승인(POST /health/orders/{no}/pay/confirm).
 */
export default async function HltPayPage({ searchParams }: Props) {
  const p = await me();
  if (!p) redirect('/login');
  const { no, m } = await searchParams;
  const t = await getTranslations('order');
  const f = await getFmt();

  let o: HltOrder | null = null;
  let err: string | null = null;
  if (no) {
    try {
      o = await apiGetPersonal<HltOrder>(`/me/health/orders/${encodeURIComponent(no)}`);
    } catch (e) {
      err = e instanceof ApiFailure && e.status < 500 ? e.body.message : t('common.orderLoadFail');
    }
  }

  return (
    <><div className="hlt">
      <HltNav on="cart" back="/health/order" />
      <div className="page-head"><h1>{t('payPage.title')}</h1></div>
      <HltSteps at={2} />

      {!no ? (
        <HltEmpty msg={t('payPage.noPending')} href="/my/health/orders" label={t('common.myOrders')} />
      ) : !o ? (
        <HltEmpty msg={err ?? t('payPage.notFound')} href="/my/health/orders" label={t('common.myOrders')} />
      ) : o.status !== 'PENDING' ? (
        <div className="notice notice-act">
          <div>
            <strong>{t('payPage.already')}</strong>
            <p>{t('payPage.alreadyInfo', { no: o.orderNo, state: codeText(t, 'orderState', o.status, ORDER_LABEL[o.status] ?? o.status) })}</p>
          </div>
          <Link className="cta-primary as-link" href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>{t('common.orderDetail')}</Link>
        </div>
      ) : o.cancelRequested ? (
        /* v10.26 (G-183) — 취소 신청이 접수된 주문은 결제를 받지 않습니다(서버도 409 CANCEL_REQUESTED) */
        <div className="notice notice-act">
          <div>
            <strong>{t('payPage.cancelReq')}</strong>
            <p>{t('payPage.cancelReqInfo', { no: o.orderNo })}</p>
          </div>
          <Link className="cta-primary as-link" href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>{t('common.orderDetail')}</Link>
        </div>
      ) : o.items.length === 0 ? (
        /* ★ 주문 생성이 중간에 실패하면 품목 없는 주문이 남습니다(백엔드 결함 보고) — 결제를 받지 않습니다 */
        <div className="notice">{t('payPage.noItems', { no: o.orderNo })}</div>
      ) : !p.identityVerifiedAt ? (
        <div className="notice notice-act">
          <div><strong>{t('payPage.needVerify')}</strong></div>
          <Link className="cta-primary as-link" href={`/verify?next=${encodeURIComponent(`/health/order/pay?no=${o.orderNo}`)}`}>{t('common.verify')}</Link>
        </div>
      ) : (
        <section className="hlt-box">
          <h3>{t('common.orderNo', { no: o.orderNo })}</h3>
          {o.items.map((i) => (
            <div key={i.optionId ?? i.code} className="hlt-sum" data-item={i.code}><span>{i.name}{i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm"> {i.optionLabel}</span>} × {i.qty}</span><span>{f.won(i.amount, '-')}</span></div>
          ))}
          <div className="hlt-sum"><span>{t('common.shipFee')}</span><span>{Number(o.shipFee) === 0 ? t('common.free') : f.won(o.shipFee, '-')}</span></div>
          <div className="hlt-sum tot"><span>{t('common.payAmount')}</span><span>{f.won(o.total, '-')}</span></div>
          <Msgs ns={['order']}><PayForm orderNo={o.orderNo} total={Number(o.total)} initialMethod={m ?? 'CARD'} /></Msgs>
          <p className="hint">
            {t('payPage.cardNote')}
          </p>
          {/* v10.27 (G-201) — 결제를 나중에 하려는 분이 주문을 다시 찾을 길(전에는 이 화면에서 내 주문으로 가는 링크가 없었음) */}
          <p className="hint" data-pay-myorders>
            {t.rich('payPage.later', {
              detail: (c) => <Link href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>{c}</Link>,
              orders: (c) => <Link href="/my/health/orders">{c}</Link>,
            })}
          </p>
        </section>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
