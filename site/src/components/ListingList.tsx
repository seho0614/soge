import type { ListingListData } from '@/lib/types';
import { useTranslations } from 'next-intl';
import { ListingCard } from './ListingCard';

/**
 * 광고와 일반을 분리해 렌더합니다.
 *
 * 하나의 배열로 합치면 라벨을 빠뜨릴 수 있고, 그게 곧 노출순위
 * 표시 의무 위반입니다. 서버가 분리해 내려주는 이유가 여기 있습니다.
 */
export function ListingList({ data }: { data: ListingListData }) {
  const t = useTranslations('listing');
  return (
    <>
      {data.promoted.length > 0 && (
        <section className="ad-zone" aria-label={t('adZone')}>
          <p className="ad-notice">{data.adNotice}</p>
          <div className="grid">
            {data.promoted.map((x) => <ListingCard key={x.id} item={x} />)}
          </div>
        </section>
      )}

      {data.organic.length === 0 ? (
        <p className="empty">{t('empty')}</p>
      ) : (
        <div className="grid">
          {data.organic.map((x) => <ListingCard key={x.id} item={x} />)}
        </div>
      )}
    </>
  );
}
