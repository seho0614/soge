import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { apiGetPublic } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import { CompareView } from './CompareView';
import '@/styles/mbx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mbx.compare'))('title'), robots: { index: false, follow: false } };
}

/**
 * v10.502 (D273 · docs/640) SB-HOM-MBX-020 비교하기 — 로그인 없이
 *   비교함은 이 브라우저(localStorage)에만 — 매물끼리 또는 상품끼리 최대 4개 · 서버는 공개 칸만 돌려줌(GET /site/mbx/compare)
 */
export default async function ComparePage() {
  const [sw, t] = await Promise.all([
    apiGetPublic<{ compare: boolean }>('/site/mbx/switches', 60).catch(() => ({ compare: false })),
    getTranslations('mbx.compare'),
  ]);
  return (
    <div className="mbx-wrap" data-screen="SB-HOM-MBX-020">
      <h1 className="mbx-h1">{t('title')}</h1>
      <p className="mbx-sub">{t('sub')}</p>
      <Msgs ns={['mbx']}><CompareView enabled={!!sw.compare} /></Msgs>
    </div>
  );
}
