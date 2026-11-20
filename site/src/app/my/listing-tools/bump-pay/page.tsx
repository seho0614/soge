import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { MyHead, Note } from '@/components/my/ui';
import { Msgs } from '@/i18n/Msgs';
import { BumpPayConfirm } from '@/components/lsx/BumpPayConfirm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lsx'))('payTitle') };
}
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string; listing?: string }> };

/**
 * SB-MYP-LSX-030 끌어올리기 결제 성공 주소 (v10.515 · D276) — 토스 결제창이 ?paymentKey=&orderId=&amount=&listing= 로 돌려보냄.
 * ★ 여기까지 왔다고 결제된 것이 아님 — 서버가 승인해야 돈이 움직이고 끌어올림. amount 는 서버가 1회 금액 + 부가세와 대조.
 */
export default async function BumpPay({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('lsx');
  const { paymentKey, orderId, amount, listing } = await searchParams;
  const amt = Number(amount);
  const valid = !!paymentKey && /^[A-Za-z0-9_-]{1,200}$/.test(paymentKey) && !!orderId && /^[A-Za-z0-9_-]{6,64}$/.test(orderId)
    && Number.isInteger(amt) && amt > 0 && !!listing && /^[0-9a-fA-F-]{36}$/.test(listing);
  return (
    <>
      <MyHead title={t('payTitle')} />
      {valid ? <Msgs ns={['lsx']}><BumpPayConfirm listingId={listing!} paymentKey={paymentKey!} orderId={orderId!} amount={amt} /></Msgs>
        : <Note kind="warn">{t('payBad')}</Note>}
    </>
  );
}
