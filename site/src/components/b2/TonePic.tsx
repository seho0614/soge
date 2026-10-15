'use client';
/**
 * 머리줄 · 바닥줄의 그림 고르기 — 소개장터 메인(/money)에서는 2026-10-09 제시 디자인에서 자른 그림을, 그 밖(소개광장 · 소개몰)에서는 지금 그림을 씁니다. v10.29
 * 둘 다 서버에서 그려 넘겨받고(조회 없음), 주소만 보고 하나를 내보냅니다. 「이미지 그대로 사용」(10/9) — 로고도 그 디자인의 것을 자른 그대로입니다.
 */
import { usePathname } from 'next/navigation';
import { isMoneyMain } from '@/components/Chrome';

export function TonePic({ base, money }: { base: React.ReactNode; money: React.ReactNode }) {
  return <>{isMoneyMain(usePathname()) ? money : base}</>;
}
