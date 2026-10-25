/** SB-HLT-ORD-030 주문 완료 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder } from '@/components/health/types';
import { HltEmpty, HltSteps, SellerBox } from '@/components/health/HltParts';
import { codeText, krw, ORDER_LABEL, ORDER_TONE, PAY_LABEL, PAY_STATE, ymdhm } from '@/components/health/util';
import { getTranslations } from 'next-intl/server';


export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('order'))('meta.done') };
}
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ no?: string; m?: string; st?: string }> };

/**
 * 주문 완료 — GET /me/health/orders/{no}
 *
 * 상태는 **서버 값 그대로** 보여 줍니다(주소의 m · st 는 쓰지 않습니다 — 고칠 수 있습니다).
 * D006 — 결제 건(payment)으로 결제수단 · 결제 상태 · **시험 결제(stub)** · 가상계좌 안내를 보여 줍니다.
 */
export default async function HltOrderDone({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const { no } = await searchParams;
  const t = await getTranslations('order');

  let o: HltOrder | null = null;
  let err: string | null = null;
  if (no) {
    try {
      o = await apiGetPersonal<HltOrder>(`/me/health/orders/${encodeURIComponent(no)}`);
    } catch (e) {
      err = e instanceof ApiFailure && e.status < 500 ? e.body.message : t('common.orderLoadFail');
    }
  }

  const pay = o?.payment ?? null;
  const vbank = pay?.state === 'READY' && pay.pgStatus === 'WAITING_FOR_DEPOSIT' ? pay.vbank : null;

  if (!o) {
    return (
      <><div className="hlt">
        <div className="page-head"><h1>{t('donePage.title')}</h1></div>
        <HltEmpty msg={err ?? t('donePage.noOrder')} href="/my/health/orders" label={t('common.myOrders')} />
      </div><i hidden data-root-end="" /></>
    );
  }

  return (
    <><div className="hlt">
      <div className="page-head"><h1>{o.status === 'PAID' ? t('donePage.paid') : t('donePage.received')}</h1></div>
      <HltSteps at={3} />

      <section className="hlt-box">
        <div className="hlt-ord-h">
          <b>{t('common.orderNo', { no: o.orderNo })}</b>
          <span className={`state state-${ORDER_TONE[o.status] ?? 'held'}`}>{codeText(t, 'orderState', o.status, ORDER_LABEL[o.status] ?? o.status)}</span>
        </div>
        {o.items.map((i) => (
          <div key={i.optionId ?? i.code} className="hlt-sum" data-item={i.code}><span>{i.name}{i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm"> {i.optionLabel}</span>} × {i.qty}</span><span>{krw(i.amount)}</span></div>
        ))}
        <div className="hlt-sum"><span>{t('common.shipFee')}</span><span>{Number(o.shipFee) === 0 ? t('common.free') : krw(o.shipFee)}</span></div>
        <div className="hlt-sum tot"><span>{t('common.payAmount')}</span><span>{krw(o.total)}</span></div>
        {pay && (
          <p className="hint">
            {t('donePage.payInfo', { method: codeText(t, 'payMethod', pay.method, PAY_LABEL[pay.method] ?? pay.method), state: codeText(t, 'payState', pay.state, PAY_STATE[pay.state] ?? pay.state) })}
            {pay.approvedAt && pay.state === 'PAID' && t('donePage.approvedAt', { at: ymdhm(pay.approvedAt) })}
            {pay.stub && <> <span className="state state-held" title={t('donePage.stubTitle')}>{t('donePage.stubBadge')}</span></>}
          </p>
        )}
      </section>

      {pay?.stub && (
        <div className="notice" role="note">
          {t.rich('donePage.stubNotice', { b: (c) => <b>{c}</b> })}
        </div>
      )}

      {o.status === 'PENDING' && (
        vbank ? (
          <section className="hlt-box">
            <h3>{t('donePage.vbankTitle')}</h3>
            <div className="hlt-sum"><span>{t('donePage.bank')}</span><span>{vbank.bankCode ?? '-'}</span></div>
            <div className="hlt-sum"><span>{t('donePage.account')}</span><span className="mono">{vbank.accountNumber ?? '-'}</span></div>
            <div className="hlt-sum"><span>{t('donePage.holder')}</span><span>{vbank.customerName ?? '-'}</span></div>
            <div className="hlt-sum"><span>{t('donePage.due')}</span><span>{ymdhm(vbank.dueDate)}</span></div>
            <div className="hlt-sum tot"><span>{t('donePage.depositAmount')}</span><span>{krw(o.total)}</span></div>
            <p className="hint">{t('donePage.vbankNote')}</p>
          </section>
        ) : (
          <div className="notice">
            {t.rich('donePage.notApproved', { link: (c) => <Link href={`/health/order/pay?no=${encodeURIComponent(o.orderNo)}`}>{c}</Link> })}
          </div>
        )
      )}

      <div className="notice">
        {t.rich('donePage.withdrawal', { b: (c) => <b>{c}</b> })}
        {o.items.filter((i) => i.withdrawalBlockedIf).map((i) => (
          <span key={i.optionId ?? i.code}><br />{t('donePage.blockedItem', { name: i.name, cond: i.withdrawalBlockedIf ?? '' })}</span>
        ))}
      </div>

      <SellerBox compact />

      <div className="hlt-btns">
        <Link className="hlt-btn pri" href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>{t('common.orderDetail')}</Link>
        <Link className="hlt-btn" href="/health">{t('donePage.keepShopping')}</Link>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
