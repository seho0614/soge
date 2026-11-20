import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { MyHead } from '@/components/my/ui';
import { OffersView } from '@/components/lpx/OffersView';
import '@/styles/lpx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lpx.my'))('title') };
}

/**
 * v10.549 (D286 · docs/687) SB-MYP-LPX-010 나의공간 › 가격 제안
 *   받은 제안(수락 · 거절 · 되제안 · 가린 이름) · 보낸 제안(되제안 수락 · 거절 · 다시 제안 · 거두기) — 되제안 · 다시 제안 합쳐 lpx.offer_counter_max(처음 3)번 — 합의하면 「1:1 문의」로 기존 거래 흐름
 *   GET /lpx/me/offers · POST /lpx/offers/{id}/accept · /reject · /counter · /reoffer · /withdraw · 매물 상세 칸은 GET /lpx/listings/{id}/offer · POST /lpx/listings/{id}/offers
 *   나의공간 메뉴(MyShell)는 고치지 않음 — 알림 링크 · 매물 상세 「관리」로 들어옴
 */
export default async function MyOffersPage() {
  if (!(await me())) redirect('/login?next=/my/offers');
  const t = await getTranslations('lpx.my');
  return (
    <div data-screen="SB-MYP-LPX-010">
      <MyHead title={t('title')} sub={t('sub')} />
      <Msgs ns={['lpx']}><OffersView /></Msgs>
    </div>
  );
}
