import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { GWAN_PATH, safeSort, won } from '@/lib/format';
import type { ListingCardData, ListingListData } from '@/lib/types';
import { BackBar } from '@/components/common/BackBar';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '전체 목록' };

const GCLS: Record<string, string> = { MNY: 'g-mny', MAL: 'g-mal', BIZ: 'g-biz', HLT: 'g-hlt' };

/**
 * SB-HOM-LST-010 전체 목록 — v10.31 시안 scAllList: ← 메인 · 제목(n건) · 3단추(소개하기 · 소개받고 싶어요 · 소개받기) ·
 *   관 고르기 카드(소개장터 · 안심소개 · 소개창업 · 소개몰 — 그 관 목록으로) · 표(구분 · 상품/서비스 · 업종 · 등급 · 등록자 · 소개비).
 * 개발에만 있던 정렬(최신순 · 소개비순) · 더 보기는 시안 모양 안에 남깁니다(지시 ③). 광고 줄은 「광고」 표시를 달아 따로 위에(전상법 · INV-11).
 */
export default async function AllListings({ searchParams }: {
  searchParams: Promise<{ cursor?: string; sort?: string }>;
}) {
  const q0 = await searchParams;
  const sort = safeSort(q0.sort);
  const qs = new URLSearchParams({ limit: '20' });
  if (q0.cursor) qs.set('cursor', q0.cursor);
  if (sort) qs.set('sort', sort);
  const [data, gwans] = await Promise.all([
    apiGet<ListingListData>(`/listings?${qs}`).catch(() => ({ promoted: [], organic: [], nextCursor: null, adNotice: '' }) as ListingListData),
    apiGet<Array<{ code: string; name: string; isActive: boolean; listingCount?: number }>>('/gwans', 300).catch(() => []),
  ]);
  const GN: Record<string, string> = Object.fromEntries(gwans.map((g) => [g.code, g.name]));
  const nav = gwans.filter((g) => g.isActive && GWAN_PATH[g.code]);
  const rows: Array<ListingCardData & { ad?: boolean }> = [...data.promoted.map((r) => ({ ...r, ad: true })), ...data.organic];
  const total = gwans.filter((g) => GWAN_PATH[g.code] && g.code !== 'HLT').reduce((n, g) => n + (g.listingCount ?? 0), 0);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-LST-010">
      <BackBar href="/" label="메인" wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>전체 목록</h1>
        {total > 0 && <span className="w1-bg off">{total.toLocaleString('ko-KR')}건</span>}
        <p style={{ flexBasis: '100%', margin: '4px 0 0' }}>세 관의 등록 건을 한 자리에서 봅니다. 관을 고르면 그 관의 목록으로 좁혀집니다.</p>
      </div>

      <div className="w1-cta3">
        <Link className="c3 c3a" href="/register"><b>소개하기</b><span>내가 아는 곳을 올립니다</span></Link>
        <Link className="c3 c3b" href="/request/new"><b>소개받고 싶어요</b><span>찾는 것을 올립니다</span></Link>
        <Link className="c3 c3c" href="/request"><b>소개받기</b><span>올라온 것 중에서 고릅니다</span></Link>
      </div>

      <div className="w1-gcards">
        {nav.map((g) => (
          <Link key={g.code} className={`gcard ${GCLS[g.code] ?? ''}`} href={`/${GWAN_PATH[g.code]}`}>
            <b>{g.name}</b><span>{g.code} 목록으로</span>
          </Link>
        ))}
      </div>

      <div className="w1-lsth">
        <span className="w1-ls">{data.adNotice || ''}</span>
        <span className="srt" aria-label="정렬">
          {([['', '최신순'], ['FEE_DESC', '소개비순']] as const).map(([v, t]) => (
            <Link key={t} href={v ? `/listings?sort=${v}` : '/listings'} className={(sort ?? '') === v ? 'on' : undefined}
              aria-current={(sort ?? '') === v ? 'true' : undefined}>{t}</Link>
          ))}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="w1-empty">등록된 매물이 없습니다.</div>
      ) : (
        <div className="w1-tbw">
          <table className="w1-tb">
            <thead><tr><th>구분</th><th>상품 · 서비스</th><th>업종</th><th>등급</th><th>등록자</th><th>소개비</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.ad ? 'ad' : 'o'}-${r.id}`} data-listing={r.id}>
                  <td><span className={`w1-gt ${GCLS[r.gwanCode] ?? ''}`}>{GN[r.gwanCode] ?? r.gwanCode}</span>
                    {r.ad && <span className="w1-bg wait" style={{ marginLeft: 4 }}>{r.adLabel ?? '광고'}</span>}</td>
                  <td><Link href={`/listings/${r.id}`}><b>{r.title}</b></Link></td>
                  <td>{r.categoryName}</td>
                  <td>{r.gradeLabel ? <span className={`w1-bg ${r.gradeCode === 'G1' ? 'ok' : 'off'}`}>{r.gradeLabel}</span> : '—'}</td>
                  <td>{r.owner.companyName}{r.owner.verified ? ' ✓' : ''}</td>
                  <td>{r.desiredFee ? won(r.desiredFee) : '협의'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.nextCursor && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <Link className="w1-bo" href={`/listings?${new URLSearchParams({ ...(sort ? { sort } : {}), cursor: data.nextCursor })}`}>더 보기</Link>
        </div>
      )}
    </div>
  );
}
