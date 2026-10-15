import { ListingCard, ListingCardData } from './ListingCard';

export interface ListingListData {
  promoted: ListingCardData[];
  organic: ListingCardData[];
  nextCursor: string | null;
  adNotice: string;
}

/**
 * 목록. 서버가 promoted 와 organic 을 분리해 내려줍니다.
 *
 * ★ 하나의 배열로 합쳐 렌더하지 마십시오.
 *   라벨을 빠뜨리면 노출순위 표시 의무 위반이 화면 단에서 발생합니다
 *   (전자상거래법 · INV-11). 배열이 나뉘어 있으면 그 실수가 불가능합니다.
 */
export function ListingList({ data, onOpen }: {
  data: ListingListData;
  onOpen: (id: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      {data.promoted.length > 0 && (
        <section aria-label="광고">
          <p style={{ margin: '0 0 var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--ad)' }}>
            {data.adNotice}
          </p>
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {data.promoted.map((x) => <ListingCard key={x.id} item={x} onOpen={onOpen} />)}
          </div>
        </section>
      )}

      <section aria-label="매물 목록" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {data.organic.map((x) => <ListingCard key={x.id} item={x} onOpen={onOpen} />)}
        {data.organic.length === 0 && (
          <p style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 'var(--sp-6)' }}>
            조건에 맞는 매물이 없습니다.
          </p>
        )}
      </section>
    </div>
  );
}
