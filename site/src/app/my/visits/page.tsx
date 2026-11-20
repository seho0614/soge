import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { MyHead } from '@/components/my/ui';
import { VisitsView } from '@/components/vsx/VisitsView';
import '@/styles/vsx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('vsx.my'))('title') };
}

/**
 * v10.542 (D284 · docs/680) SB-MYP-VSX-010 나의공간 › 방문 예약
 *   내가 한 예약(취소) · 내 매물에 온 예약(확정 · 취소 · 노쇼 · 방문 끝 · 가린 이름 · 지난 180일 노쇼 수) · 내 매물 칸 열기 · 닫기
 *   GET /vsx/me · GET /vsx/owner/listings/{id}/slots · POST /vsx/owner/listings/{id}/slots · /vsx/owner/slots/{id}/close · /vsx/bookings/{id}/cancel · /confirm · /mark
 */
export default async function MyVisitsPage() {
  if (!(await me())) redirect('/login?next=/my/visits');
  const t = await getTranslations('vsx.my');
  return (
    <div data-screen="SB-MYP-VSX-010">
      <MyHead title={t('title')} sub={t('sub')} />
      <Msgs ns={['vsx']}><VisitsView /></Msgs>
    </div>
  );
}
