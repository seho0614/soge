/** 교환 배송비 결제 — 결제창이 돌아오는 곳 · 다시 결제 (v10.26 · SB-HLT-RTN-020 「취소 · 반품 내역」의 하위 쪽) */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltReturn } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav } from '@/components/health/MyHltNav';
import { ExchangeFeeConfirm, ExchangeFeePay } from '@/components/health/ExchangeFeePay';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('hFee.meta') };
}
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string; fail?: string; code?: string; message?: string }>;
};

/**
 * 토스 결제창이 성공하면 ?paymentKey=&orderId=&amount= 로, 실패하면 ?fail=1&code=&message= 로 돌아옵니다.
 * ★ 여기까지 왔다고 결제된 것이 아닙니다 — 서버가 승인(금액은 신청의 교환 배송비와 대조)해야 돈이 움직입니다.
 * 쿼리 없이 열면 그 신청의 교환 배송비 결제 단추를 보여 드립니다(내역 · 주문 상세의 「결제하기」).
 */
export default async function MyHltReturnFee({ params, searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('myDeal');
  const { id } = await params;
  const q = await searchParams;
  const list = await apiGetPersonal<HltReturn[]>('/me/health/returns').catch(() => null);
  const r = (list ?? []).find((x) => x.id === id);
  const amt = Number(q.amount);
  const valid = !!q.paymentKey && /^[A-Za-z0-9_-]{1,200}$/.test(q.paymentKey) && Number.isInteger(amt) && amt > 0;

  return (
    <><div className="hlt">
      <MyHltNav on="returns" />
      <div className="hlt-crumb"><Link href="/my/health/returns">{t('hNav.returns')}</Link> › {t('hReturns.exFee')}</div>
      <div className="page-head"><h1>{t('hFee.title')}</h1></div>
      {!r ? (
        <HltEmpty msg={list === null ? t('hFee.loadFail') : t('hFee.notFound')}
          href="/my/health/returns" label={t('hNav.returns')} />
      ) : valid ? (
        <ExchangeFeeConfirm returnId={r.id} paymentKey={q.paymentKey!} amount={amt} />
      ) : r.feeState === 'UNPAID' && r.state === 'REQUESTED' ? (
        <>
          {q.fail && <div className="hlt-box hlt-fail" role="alert">{q.message ?? t('hFee.notApproved')}{q.code && <> ({q.code})</>}</div>}
          <ExchangeFeePay returnId={r.id} amount={Number(r.exchangeFee ?? 0)} />
        </>
      ) : (
        <HltEmpty msg={r.feeState === 'PAID' ? t('hFee.already') : t('hFee.nothing')}
          href="/my/health/returns" label={t('hNav.returns')} />
      )}
    </div><i hidden data-root-end="" /></>
  );
}
