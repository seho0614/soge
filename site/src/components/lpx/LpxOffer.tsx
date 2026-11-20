import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { lpxExtras } from './extras';
import { LpxOfferBox } from './LpxOfferBox';
import '@/styles/lpx.css';

/**
 * v10.549 · 552 (D286 · docs/687 · 690) 매물 상세 아래 「가격 제안」 칸 + 「이 지역 시세」 한 줄 — 서버 부품
 *   시세(lpx.stats on · 매물 5개 넘는 칸)가 있으면 한 줄 · 가격 제안(lpx.offer on · 관별 · 게시 중 · 거래 금액 있음)이면 제안 칸(로그인 회원만 부름)
 *   둘 다 없으면 아무것도 그리지 않음(지금 화면 그대로)
 */
export async function LpxOffer({ listingId, gwanCode, loggedIn }: { listingId: string; gwanCode: string; loggedIn: boolean }) {
  const x = await lpxExtras(listingId);
  if (!x.offer.enabled && !x.stats) return null;
  const t = await getTranslations('lpx.stats');
  return (
    <>
      {x.stats && (
        <p className="lpx-stat-line" data-lpx-stat-line={x.stats.n}>
          {t('line', { area: x.stats.area, ym: x.stats.ym, won: Number(x.stats.median).toLocaleString('ko-KR'), n: x.stats.n })}
          {' '}<Link href={`/price-stats?gwan=${gwanCode}`}>{t('more')}</Link>
        </p>
      )}
      {x.offer.enabled && <LpxOfferBox listingId={listingId} loggedIn={loggedIn} />}
    </>
  );
}
