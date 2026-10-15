/** SB-MYP-SUB-010 구독 결제 — 토스 결제창 성공 주소 (v10.27 · G-189) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { SubPayConfirm } from '@/components/billing/SubPayConfirm';
import { MyHead, Note } from '@/components/my/ui';

export const metadata: Metadata = { title: '구독 결제 확인' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string; plan?: string }> };

/**
 * 토스 결제창이 성공하면 이 주소로 돌아옵니다 — ?paymentKey=&orderId=&amount=&plan=
 * ★ 여기까지 왔다고 결제된 것이 아닙니다. 서버가 승인(POST /subscriptions → 결제사 confirm)해야 돈이 움직이고 구독이 열립니다.
 *   금액은 서버가 요금제 월 회비와 대조합니다(주소의 amount 는 고칠 수 있으므로 믿지 않음).
 * v10.29 — 나의공간 틀 안에 시안 머리 모양으로(기능 그대로).
 */
export default async function SubPayPage({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const { paymentKey, orderId, plan } = await searchParams;
  const ok = !!paymentKey && /^[A-Za-z0-9_-]{1,200}$/.test(paymentKey)
    && !!orderId && /^[A-Za-z0-9_-]{6,64}$/.test(orderId) && !!plan && /^[A-Z_]{2,20}$/.test(plan);
  return (
    <><div className="auth-wrap">
      <MyHead title="구독 결제 확인" sub="결제사 승인을 확인한 뒤 구독이 열립니다." />
      {ok
        ? <SubPayConfirm paymentKey={paymentKey!} orderId={orderId!} plan={plan!} />
        : <Note kind="warn">결제 정보가 올바르지 않습니다. <a href="/my/subscription">구독 · 소개코드</a>에서 다시 확인해 주십시오.</Note>}
    </div><i hidden data-root-end="" /></>
  );
}
