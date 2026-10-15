import Link from 'next/link';
import type { ListingCardData } from '@/lib/types';
import { won, ago, GWAN_PATH } from '@/lib/format';

/**
 * 목록 카드. 73화면 중 관 랜딩·목록·검색·마이페이지가 모두 이걸 씁니다.
 *
 * 금액이 시각적 정점입니다. 등급은 표시하지 않습니다 —
 * 필터·정렬에만 씁니다. "브론즈 매물"로 보이면 낙인이 됩니다.
 */
export function ListingCard({ item }: { item: ListingCardData }) {
  const href = `/${GWAN_PATH[item.gwanCode] ?? 'money'}/${item.id}`;
  return (
    <article className="card">
      <Link href={href} className="card-link">
        <div className="card-top">
          <span className="cat">{item.categoryName}</span>
          {item.badges.map((b) => (
            <span key={b.type} className={`badge badge-${b.type.toLowerCase()}`}>{b.label}</span>
          ))}
          {/* 유료 노출은 라벨과 함께만 나갑니다 (전상법) */}
          {item.isAd && item.adLabel && <span className="badge badge-ad">{item.adLabel}</span>}
        </div>

        <h3 className="card-title">{item.title}</h3>

        <div className="card-fee">
          <span className="money">{won(item.desiredFee)}</span>
          {item.feeBearerLabel && <span className="bearer">{item.feeBearerLabel}</span>}
        </div>

        <div className="card-meta">
          <span>{item.owner.companyName}</span>
          {item.owner.verified && <span className="verified">사업자 인증</span>}
          {item.owner.confirmedDeals > 0 && <span>성사 {item.owner.confirmedDeals}건</span>}
          {/* 20260930 — 서버(UTC)와 브라우저(KST) 시각 차로 React 418 경고 */}<span className="when" suppressHydrationWarning>{ago(item.publishedAt)}</span>
        </div>
      </Link>
    </article>
  );
}
