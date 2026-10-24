import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ListingCardData } from '@/lib/types';
import { ago, GWAN_PATH } from '@/lib/format';
import { manwon, photoSrc, regionText } from './gw';

/**
 * v10.29 — 시안 사진 카드(prodGrid 의 .pgc) — 관 첫 화면 · 퀵메뉴 화면이 씁니다.
 *
 * v10.31 (w2 · 시안 기준) — 서버가 사진 · 지역 · 거래 금액 · 급구/급매를 싣게 되어 시안 모양 그대로 그립니다.
 *  · 사진 — 매물 대표 사진(thumbUrl). 없으면 분류 그림(시안 PHOTO_MAP).
 *  · 금액 — 거래(희망) 금액(시안 「6,200만원」). 없으면 「소개비 ○만원」(안심소개 부동산은 노출료라 「금액 협의」 · A-07).
 *  · 「경기 수원시 · 1시간 전」 — 매물 지역(없으면 인증 사업장 주소). 지역을 모르면 등록자 이름.
 *  · 왼쪽 위 딱지 — 급구 · 급매(기한 있는 표시) → 광고 → 서류 확인. 광고는 라벨과 함께만(전상법).
 */
/** v10.97 — 글은 사전 gwan.card.*(tr 을 넘기면). 넘기지 않으면 예전처럼 한국어(다른 화면이 그대로 부름).
 *  금액 — 한국어는 시안 「180만원」 꼴(manwon), 다른 언어는 원 단위 숫자(₩1,800,000) */
type CardKey = 'card.exposureFee' | 'card.negotiableAmount' | 'card.fee' | 'card.negotiable';
const CARD_KO: Record<CardKey, string> = { 'card.exposureFee': '노출료', 'card.negotiableAmount': '금액 협의', 'card.fee': '소개비', 'card.negotiable': '협의' };
export function cardPrice(item: ListingCardData, tr?: (k: CardKey) => string, locale = 'ko'): { label?: string; value: string } {
  const L = (k: CardKey) => (tr ? tr(k) : CARD_KO[k]);
  const amt = (n: number | null | undefined) => (n == null ? L('card.negotiable') : locale === 'ko' ? manwon(n) : `₩${n.toLocaleString('en-US')}`);
  if (item.dealAmount != null) return { value: amt(item.dealAmount) };
  if (item.isRealty) return { label: L('card.exposureFee'), value: L('card.negotiableAmount') };
  return { label: L('card.fee'), value: amt(item.desiredFee) };
}

export function GwCard({ item }: { item: ListingCardData }) {
  const href = `/${GWAN_PATH[item.gwanCode] ?? 'money'}/${item.id}`;
  const badge = item.urgent?.label ?? (item.isAd && item.adLabel ? item.adLabel : item.badges.find((b) => b.type !== 'URGENT' && b.type !== 'URGENT_SALE')?.label);
  const t = useTranslations('gwan');
  const locale = useLocale();
  const price = cardPrice(item, (k) => t(k), locale);
  const where = regionText(item.region) || item.owner.companyName;
  return (
    <Link className="gw-pgc" href={href} data-listing={item.id} data-urgent={item.urgent?.kind}>
      <div className="gw-pgt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gw-thp" src={photoSrc(item.categoryName, item.thumbUrl ? [item.thumbUrl] : null)} alt="" loading="lazy" />
        {badge && <span className={`gw-hot${item.isAd && !item.urgent ? ' ad' : ''}`}>{badge}</span>}
        <span className="gw-cc">{item.categoryName}</span>
      </div>
      <div className="gw-pgb">
        <div className="gw-tt">{item.title}</div>
        <div className="gw-pr">{price.label && <small className="gw-prl">{price.label}</small>} {price.value}</div>
        <div className="gw-mt2">
          <span suppressHydrationWarning>{where}{item.publishedAt ? ` · ${ago(item.publishedAt)}` : ''}</span>
          <span>♡ {item.likeCount}</span>
        </div>
      </div>
    </Link>
  );
}

/** 카드 묶음 — 광고(유료 노출)는 일반과 나눠 라벨을 붙여 그립니다(ListingList 와 같은 원칙 · INV-11) */
export function GwGrid({ promoted, organic, adNotice }: { promoted?: ListingCardData[]; organic: ListingCardData[]; adNotice?: string }) {
  const t = useTranslations('gwan.card');
  return (
    <>
      {promoted && promoted.length > 0 && (
        <section className="gw-adz" aria-label={t('adsAria')}>
          <p className="gw-adn">{adNotice}</p>
          <div className="gw-pgrid">{promoted.map((x) => <GwCard key={x.id} item={x} />)}</div>
        </section>
      )}
      <div className="gw-pgrid">{organic.map((x) => <GwCard key={x.id} item={x} />)}</div>
    </>
  );
}
