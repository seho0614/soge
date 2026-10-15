import type { ListingListData } from '@/lib/types';
import { ListingCard } from './ListingCard';

/**
 * 광고와 일반을 분리해 렌더합니다.
 *
 * 하나의 배열로 합치면 라벨을 빠뜨릴 수 있고, 그게 곧 노출순위
 * 표시 의무 위반입니다. 서버가 분리해 내려주는 이유가 여기 있습니다.
 */
export function ListingList({ data }: { data: ListingListData }) {
  return (
    <>
      {data.promoted.length > 0 && (
        <section className="ad-zone" aria-label="광고">
          <p className="ad-notice">{data.adNotice}</p>
          <div className="grid">
            {data.promoted.map((x) => <ListingCard key={x.id} item={x} />)}
          </div>
        </section>
      )}

      {data.organic.length === 0 ? (
        <p className="empty">아직 등록된 매물이 없습니다.</p>
      ) : (
        <div className="grid">
          {data.organic.map((x) => <ListingCard key={x.id} item={x} />)}
        </div>
      )}
    </>
  );
}
