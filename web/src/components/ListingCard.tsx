import { won, ago } from '../lib/format';
import { AdLabel } from './Badge';

export interface ListingCardData {
  id: string;
  gwanCode: string;
  categoryName: string;
  title: string;
  desiredFee: number | null;
  feeBearerLabel: string | null;
  owner: { companyName: string; verified: boolean; confirmedDeals: number };
  badges: { type: string; label: string; validUntil?: string }[];
  isAd: boolean;
  adLabel: string | null;
  publishedAt: string | null;
  likeCount: number;
  liked: boolean;
}

/**
 * 목록 카드. 73화면 중 관 랜딩·목록·검색·마이페이지가 모두 이걸 씁니다.
 *
 * 설계 규칙
 *   - 금액이 시각적 정점. 제목보다 크게
 *   - 등급을 표시하지 않습니다. 필터·정렬에만 씁니다 —
 *     "브론즈 매물"로 보이면 낙인이 됩니다
 *   - 그림자 없음. 구분선으로 충분합니다
 */
export function ListingCard({ item, onOpen }: {
  item: ListingCardData;
  onOpen: (id: string) => void;
}) {
  return (
    <article
      className="card"
      onClick={() => onOpen(item.id)}
      style={{ padding: 'var(--sp-4)', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>{item.categoryName}</span>
        {item.badges.map((b) => (
          <span key={b.type} style={{
            fontSize: 'var(--fs-xs)', fontWeight: 700,
            color: b.type === 'URGENT' ? 'var(--danger)' : 'var(--accent)',
          }}>{b.label}</span>
        ))}
        {item.isAd && item.adLabel && <AdLabel text={item.adLabel} />}
      </div>

      <h3 style={{
        margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, lineHeight: 1.45,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{item.title}</h3>

      {/* 금액이 정점입니다 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)', margin: 'var(--sp-3) 0' }}>
        <strong className="num" style={{
          fontSize: 'var(--fs-money)', color: 'var(--money)', letterSpacing: '-0.02em',
        }}>{won(item.desiredFee)}</strong>
        {item.feeBearerLabel && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>{item.feeBearerLabel}</span>
        )}
      </div>

      <div style={{
        borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-2)',
        display: 'flex', gap: 'var(--sp-2)', alignItems: 'center',
        fontSize: 'var(--fs-sm)', color: 'var(--ink-2)',
      }}>
        <span>{item.owner.companyName}</span>
        {/* 품질 보증이 아니라 사실 표시입니다 */}
        {item.owner.verified && <span style={{ color: 'var(--money)' }}>· 사업자 인증</span>}
        {item.owner.confirmedDeals > 0 && <span>· 성사 {item.owner.confirmedDeals}건</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>{ago(item.publishedAt)}</span>
      </div>
    </article>
  );
}
