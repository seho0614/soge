import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { apiGetPublic } from '@/lib/api';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { RecentView } from './RecentView';
import '@/styles/mbx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mbx.recent'))('title'), robots: { index: false, follow: false } };
}

/**
 * v10.501 (D273 · docs/639) SB-HOM-MBX-010 최근 본 매물 · 상품
 *   로그인 회원은 서버에 적힌 것(최근 순 · mbx.recent_max 개), 로그인 전은 이 브라우저에 남은 것만 — 같은 화면 하나로.
 *   스위치(mbx.recent)가 꺼져 있으면 「지금은 쓰지 않는 기능」만 보입니다.
 */
export default async function RecentPage() {
  const [sw, viewer, t] = await Promise.all([
    apiGetPublic<{ recent: boolean }>('/site/mbx/switches', 60).catch(() => ({ recent: false })),
    me().catch(() => null),
    getTranslations('mbx.recent'),
  ]);
  return (
    <div className="mbx-wrap" data-screen="SB-HOM-MBX-010">
      <h1 className="mbx-h1">{t('title')}</h1>
      <p className="mbx-sub">{t('sub')}</p>
      <Msgs ns={['mbx']}><RecentView loggedIn={!!viewer} enabled={!!sw.recent} /></Msgs>
    </div>
  );
}
