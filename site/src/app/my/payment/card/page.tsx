/** SB-MYP-PAY-010 결제 수단 — 토스 카드 등록 창 성공 주소 (v10.148 · docs/228) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { CardAuthConfirm } from '@/components/billing/CardAuthConfirm';
import { MyHead, Note } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.payMethod'))('cardTitle') };
}
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ authKey?: string; customerKey?: string }> };

/**
 * 토스 카드 등록 창이 성공하면 이 주소로 돌아옵니다 — ?customerKey=&authKey=
 * ★ 여기까지 왔다고 등록된 것이 아닙니다. 서버가 authKey 로 빌링키를 받아야(POST /me/billing-key) 결제 수단이 생깁니다.
 *   customerKey 는 로그인한 계정과 같아야 합니다(다른 계정 창에서 돌아온 주소면 보내지 않음).
 */
export default async function CardAuthPage({ searchParams }: Props) {
  const p = await me();
  if (!p) redirect('/login');
  const { authKey, customerKey } = await searchParams;
  const t = await getTranslations('deal.payMethod');
  const ok = !!authKey && /^[A-Za-z0-9_=.-]{1,300}$/.test(authKey) && customerKey === p.accountId;
  return (
    <><div className="auth-wrap">
      <MyHead title={t('cardTitle')} sub={t('cardSub')} />
      {ok
        ? <Msgs ns={['deal']}><CardAuthConfirm authKey={authKey!} /></Msgs>
        : <Note kind="warn">{t.rich('cardBad', { a: (c) => <a href="/my/payment">{c}</a> })}</Note>}
    </div><i hidden data-root-end="" /></>
  );
}
