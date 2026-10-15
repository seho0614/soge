import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { Pgh } from '@/components/partner/ui';
import { CashPayConfirm } from '@/components/partner/CashPanel';

export const metadata: Metadata = { title: '충전 확인' };

/** v10.31 (W5) — 토스 결제창에서 돌아오는 자리(successUrl). 서버가 결제사에 승인을 확인한 뒤 원장에 올립니다(같은 주문은 한 번만). */
export default async function CashPay({ searchParams }: { searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const sp = await searchParams;
  const ok = !!sp.paymentKey && !!sp.orderId && /^\d+$/.test(sp.amount ?? '');
  return (
    <><Pgh title="충전 확인" />
      {ok ? <CashPayConfirm paymentKey={sp.paymentKey!} orderId={sp.orderId!} amount={Number(sp.amount)} />
          : <p className="pt-msg err">결제 정보가 없습니다. <a href="/partner/cash">리드 이용료</a>에서 다시 충전해 주십시오.</p>}
    <i hidden data-root-end="" /></>
  );
}
