import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { Gwan, ListingListData } from '@/lib/types';
import { ListingList } from '@/components/ListingList';
import { PATH_GWAN, safeSort } from '@/lib/format';
import { SecHead, ShopMain } from '@/components/shop/ShopMain';
import { GwanLanding } from '@/components/gwan/GwanLanding';
import { MoneyMain } from '@/components/money/MoneyMain';
import '@/styles/mal.css';

type Props = {
  params: Promise<{ gwan: string }>;
  searchParams: Promise<{ sort?: string; cursor?: string; badge?: string; axis?: string; cat?: string; grade?: string; keyword?: string; p?: string;
    /* v10.31 (w2) — 지역 · 소개창업 축의 갈래(d) · 초단기(hot) */ region?: string; d?: string; hot?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gwan } = await params;
  const code = PATH_GWAN[gwan];
  if (!code) return {};
  const list = await apiGet<Gwan[]>('/gwans', 300).catch(() => []);
  const g = list.find((x) => x.code === code);
  return { title: g?.name ?? '매물', description: g?.description ?? undefined };
}

/** SB-{G}-MAIN-010 · SB-{G}-LST-010 — 관 랜딩 겸 목록 */
export default async function GwanPage({ params, searchParams }: Props) {
  const { gwan } = await params;
  const q0 = await searchParams;
  const q = { ...q0, sort: safeSort(q0.sort) };
  const code = PATH_GWAN[gwan];
  if (!code) notFound();
  /* v10.29 — 소개장터 · 안심소개 · 소개창업 첫 화면은 시안 배치(gwanLanding)로 그립니다(components/gwan/GwanLanding).
   *   안심소개의 「상담 축 통합」(?axis=consult · D005)도 그 안에 그대로 있습니다. 소개몰(HLT)만 아래 전용 메인입니다. */
  /* v10.30 — 소개장터 첫 화면만 2026-10-09 제시 디자인입니다(components/money/MoneyMain · 10/9 답 ①~④).
   *   v10.29 의 관 화면 부품 · 조회 규칙은 그 화면 아래 「지금 있던 구역」(#mny-list)에 그대로 씁니다. 안심소개 · 소개창업은 v10.29 그대로입니다. */
  if (code === 'MNY') return <MoneyMain q={q0} />;
  if (code === 'MAL' || code === 'BIZ') return <><GwanLanding code={code} q={q0} /><i hidden data-root-end="" /></>;

  const qs = new URLSearchParams({ gwanCode: code, limit: '20' });
  if (q.sort) qs.set('sort', q.sort);
  if (q.cursor) qs.set('cursor', q.cursor);
  if (q.badge) qs.set('badge', q.badge);

  const data = await apiGet<ListingListData>(`/listings?${qs}`);
  const gwans = await apiGet<Gwan[]>('/gwans', 300).catch(() => []);
  const g = gwans.find((x) => x.code === code);
  /* 20261007 (v10.25) — 소개몰(HLT)은 제시 디자인의 메인을 씁니다(components/shop/ShopMain). 도매 · 납품 매물 목록은 그 아래 한 구역으로 남깁니다(지금 있던 것). */
  if (code === 'HLT') {
    return (
      <><div className="shop">
        <ShopMain />
        <div className="shop-in">
          <section className="shop-sec" data-shop-listings="1">
            <SecHead title="도매 · 납품 매물" lead="사업자 사이의 건강 상품 거래를 소개합니다." />
            <div className="quick" style={{ margin: '0 10px 14px' }}>
              {[['', '전체'], ['URGENT', '급구'], ['VERIFIED_DOC', '서류 확인']].map(([v, t]) => (
                <a key={t} href={`/${gwan}${v ? `?badge=${v}` : ''}`} className={q.badge === v || (!q.badge && !v) ? 'on' : ''}>{t}</a>
              ))}
            </div>
            <ListingList data={data} />
            {data.nextCursor && (
              <a className="more" href={`/${gwan}?${new URLSearchParams({ ...(q.sort ? { sort: q.sort } : {}), ...(q.badge ? { badge: q.badge } : {}), cursor: data.nextCursor })}`}>더 보기</a>
            )}
          </section>
        </div>
      </div><i hidden data-root-end="" /></>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>{g?.name ?? '매물'}</h1>
        <div className="quick">
          {[['', '전체'], ['URGENT', '급구'], ['VERIFIED_DOC', '서류 확인']].map(([v, t]) => (
            <a key={t} href={`/${gwan}${v ? `?badge=${v}` : ''}`}
               className={q.badge === v || (!q.badge && !v) ? 'on' : ''}>{t}</a>
          ))}
        </div>
      </div>
      <ListingList data={data} />
      {data.nextCursor && (
        <a className="more" href={`/${gwan}?${new URLSearchParams({ ...(q.sort ? { sort: q.sort } : {}), ...(q.badge ? { badge: q.badge } : {}), cursor: data.nextCursor })}`} /* 20261001 — 정렬·배지를 이어 붙입니다. 빠지면 2쪽이 다른 정렬의 커서로 500 이었습니다 */>
          더 보기
        </a>
      )}
    </>
  );
}
