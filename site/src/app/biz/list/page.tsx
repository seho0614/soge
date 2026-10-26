import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GwList } from '@/components/gwan/GwList';

/* v10.119 — 탭 제목도 화면 언어로(한국어는 전과 같은 「소개창업 전체 목록」) */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('gwan');
  return { title: t('list.title', { name: t('meta.BIZ.name') }) };
}

type Props = { searchParams: Promise<{ sort?: string; cursor?: string; badge?: string; p?: string }> };

/**
 * SB-BIZ-LST-010 소개창업 전체 목록
 * v10.29 — 시안 배치(큰 갈래 3칸 + 사진 카드 6열)로 그립니다. 주소 · 정렬(?sort=new|best|urgent|verified · fee 추가) · API 는 그대로입니다.
 *   그리는 일은 components/gwan/GwList 가 합니다(세 관이 한 틀).
 */
export default async function Page({ searchParams }: Props) {
  return <><GwList code="BIZ" q={await searchParams} /><i hidden data-root-end="" /></>;
}
