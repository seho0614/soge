import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';

/** v10.507 (D274) 소개광장 목록 위 「활동 랭킹 보기」 — plaza.ranking(공개 설정)이 on 일 때만 */
export async function RankingLink() {
  const st = await apiGet<Record<string, string | null>>('/site-settings/public', 300).catch(() => ({} as Record<string, string | null>));
  if (st['plaza.ranking'] !== 'on') return null;
  const t = await getTranslations('plaza');
  return <p className="plz-meta" data-rank-link=""><Link href="/community/ranking">{t('rankLink')}</Link></p>;
}
