import type { Metadata } from 'next';
import { GwList } from '@/components/gwan/GwList';

export const metadata: Metadata = { title: '소개장터 전체 목록' };

type Props = { searchParams: Promise<{ sort?: string; cursor?: string; badge?: string; p?: string }> };

/**
 * SB-MNY-LST-010 소개장터 전체 목록
 * v10.29 — 시안 배치(큰 갈래 3칸 + 사진 카드 6열)로 그립니다. 주소 · 정렬(?sort=new|best|urgent|verified · fee 추가) · API 는 그대로입니다.
 *   그리는 일은 components/gwan/GwList 가 합니다(세 관이 한 틀).
 */
export default async function Page({ searchParams }: Props) {
  return <><GwList code="MNY" q={await searchParams} /><i hidden data-root-end="" /></>;
}
