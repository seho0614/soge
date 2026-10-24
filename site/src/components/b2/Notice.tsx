'use client';
/**
 * 두 관 전용 바닥줄의 고지 — 화면마다 다릅니다(v10.25 · 2026-10-07 결정 「두 고지를 같이」).
 *
 *   소개몰(/health… · /my/health…)   직판 고지 + 통신판매중개자 고지 — 소개몰의 상품은 소개뱅크가 직접 팔고,
 *                                     같은 화면의 도매 · 납품 매물은 회원 사이의 거래를 중개하는 것이라 둘 다 필요합니다.
 *   그 밖(소개광장)                   통신판매중개자 고지 하나 — 지금 그대로.
 *
 * 문구는 서버 설정(legal.direct_notice · legal.intermediary_notice) 그대로입니다. 앞의 꼬리표만 화면이 붙입니다(어느 거래에 붙는 말인지).
 * 전에는 직접 파는 소개몰 화면에도 「통신판매의 당사자가 아닙니다」만 나왔습니다.
 */
import { usePathname } from 'next/navigation';
import { isShop } from '@/components/Chrome';
import { useTranslations } from 'next-intl';

export function B2Notice({ inter, direct }: { inter?: string | null; direct?: string | null }) {
  const t = useTranslations('b2');
  const shop = isShop(usePathname());
  if (shop && direct) {
    return (
      <>
        <p className="b2-notice" data-notice="direct"><span className="b2-ntag">{t('directTag')}</span>{direct}</p>
        {inter && <p className="b2-notice" data-notice="inter"><span className="b2-ntag">{t('interTag')}</span>{inter}</p>}
      </>
    );
  }
  return inter ? <p className="b2-notice" data-notice="inter">{inter}</p> : null;
}
