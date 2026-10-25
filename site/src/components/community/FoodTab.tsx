import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';

/**
 * v10.47 (D100 · docs/98) — 소개광장 알약 탭 「우리동네 맛집」.
 *
 * 지도 사용(map.enabled)이 켜져 있을 때만 나옵니다. 꺼져 있으면(처음 값) 아무것도 그리지 않아 탭 줄이 v10.46 과 같습니다.
 * 켜짐 여부는 누구에게나 같으므로 apiGet(캐시 60초)으로 읽습니다. 못 읽으면 탭을 감춥니다(지금 화면 그대로).
 */
export async function FoodTab({ cur }: { cur: string }) {
  const m = await apiGet<{ enabled: boolean }>('/community/food', 60).catch(() => null);
  if (!m?.enabled) return null;
  const t = await getTranslations('plaza');
  return <Link href="/community/food" aria-current={cur === 'food' ? 'page' : undefined} data-food-tab>{t('tabs.food')}</Link>;
}
