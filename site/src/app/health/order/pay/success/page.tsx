/** SB-HLT-ORD-020 결제 — 결제창 성공 주소 (D006) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { HltEmpty, HltNav, HltSteps } from '@/components/health/HltParts';
import { PayConfirm } from '@/components/health/PayConfirm';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('order'))('meta.paySuccess') };
}
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }> };

/**
 * 토스 결제창이 성공하면 이 주소로 돌아옵니다 — ?paymentKey=&orderId=&amount=
 *
 * ★ 여기까지 왔다고 결제된 것이 아닙니다. 서버가 승인(confirm)해야 돈이 움직입니다.
 *   amount 는 주소에 있어 고칠 수 있으므로 **서버가 주문 금액과 대조**합니다(다르면 승인하지 않습니다).
 *   승인되면 주문 완료로, 아니면 주문 실패로 넘어갑니다.
 */
export default async function HltPaySuccess({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('order');
  const { paymentKey, orderId, amount } = await searchParams;
  const amt = Number(amount);
  const valid = !!paymentKey && /^[A-Za-z0-9_-]{1,200}$/.test(paymentKey)
    && !!orderId && /^[A-Za-z0-9_-]{1,64}$/.test(orderId) && Number.isInteger(amt) && amt > 0;

  return (
    <><div className="hlt">
      <HltNav on="cart" back="/health/order" />
      <div className="page-head"><h1>{t('successPage.title')}</h1></div>
      <HltSteps at={2} />
      {valid
        ? <Msgs ns={['order']}><PayConfirm orderNo={orderId!} paymentKey={paymentKey!} amount={amt} /></Msgs>
        : <HltEmpty msg={t('successPage.invalid')} href="/my/health/orders" label={t('common.myOrders')} />}
    </div><i hidden data-root-end="" /></>
  );
}
