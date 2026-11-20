import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { MyHead } from '@/components/my/ui';
import { AwayView } from '@/components/lpx/AwayView';
import '@/styles/lpx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lpx.awayMy'))('title') };
}

/**
 * v10.551 (D286 · docs/689) SB-MYP-LPX-020 나의공간 › 자리 비움
 *   시작 · 끝 날짜 · 한 줄 안내 — 매물 상세에 보이고 문의 · 질문 · 가격 제안 · 방문 예약을 보낸 회원에게 한 번 알림 · 끝 날짜 지나면 저절로 풀림
 *   GET · PUT /lpx/me/away · POST /lpx/me/away/end · 나의공간 메뉴(MyShell)는 고치지 않음
 */
export default async function MyAwayPage() {
  if (!(await me())) redirect('/login?next=/my/away');
  const t = await getTranslations('lpx.awayMy');
  return (
    <div data-screen="SB-MYP-LPX-020">
      <MyHead title={t('title')} sub={t('sub')} />
      <Msgs ns={['lpx']}><AwayView /></Msgs>
    </div>
  );
}
