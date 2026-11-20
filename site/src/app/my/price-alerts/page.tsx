import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { MyHead } from '@/components/my/ui';
import { PriceAlertsView } from './PriceAlertsView';
import '@/styles/mbx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mbx.price'))('title') };
}

/**
 * v10.503 (D273 · docs/641) SB-MYP-MBX-030 가격 알림
 *   켠 것(기준값 → 지금 값) · 관심 목록에서 켤 수 있는 매물 · 「내릴 때만」 · 끄기. 매일 08:30 하루 한 번 묶음 알림(알림 수신 설정 따름).
 */
export default async function PriceAlertsPage() {
  if (!(await me())) redirect('/login?next=/my/price-alerts');
  const t = await getTranslations('mbx.price');
  return (
    <div data-screen="SB-MYP-MBX-030">
      <MyHead title={t('title')} sub={t('sub')} />
      <Msgs ns={['mbx']}><PriceAlertsView /></Msgs>
    </div>
  );
}
