import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { ListingListData } from '@/lib/types';
import { GWAN_PATH, ago, won } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { SearchBox, type SearchGwan } from '@/components/search/SearchBox';
import { PromptSearch } from './PromptSearch';
import { budgetText } from '@/components/request/ReqCard';

export const metadata: Metadata = { title: '통합 검색' };
const EMPTY: ListingListData = { promoted: [], organic: [], nextCursor: null, adNotice: '' };

interface ReqHit {
  id: string; gwanCode: string; title: string; createdAt: string | null;
  /* v10.31 — 시안 「등록자 · 예산」 */
  categoryName?: string | null; region?: string | null; budgetMin?: number | null; budgetMax?: number | null; companyName?: string | null;
}
interface PostRow { id: string; title: string; author: string; createdAt: string; commentCount?: number }
interface Board { items: PostRow[]; total: number }

/* 관 탭은 목록이 있는 세 관만(시안 S4.tabs — 전체 · 소개장터 · 안심소개 · 소개창업 · 소개받기 · 소개광장) */
const LIST_GWANS = ['MNY', 'MAL', 'BIZ'];
const TABS_FIXED = { ALL: '전체', REQ: '소개받기', CMU: '소개광장' } as const;

/**
 * v10.29 — SB-HOM-SRC-010 통합 검색 결과 — 시안 scSearch 모양 그대로.
 *
 *   ← 돌아가기 · 「‘q’ 검색 결과」 + 건수 · 탭(전체 · 관별 · 소개받기 · 소개광장 — 주소 ?tab= 으로, 새로 고쳐도 그대로)
 *   「전체 목록 보기」 · 「원하는 것을 요청으로 올리기」 · (개발) 「문장으로 찾기」(SB-HOM-SCH-020 — PromptSearch 그대로 · /search#prompt)
 *   상품 · 서비스 표 · 소개받기 요청 줄 · 소개광장 글 줄
 *
 * 자료(기존 API 그대로):
 *   상품 · 서비스   GET /listings?keyword=&sort=RELEVANCE(&gwanCode=)   — 광고(promoted)는 「광고」 표시 + 광고 고지
 *   소개받기 요청   GET /search?q=   의 requests (두 글자부터 — 서버 규칙)
 *   소개광장       GET /community/board?q=  (작성자는 첫 글자만 — 서버가 가림)
 * v10.31 — 시안 표 그대로 「구분 · 상품·서비스 · 업종 · 등급 · 등록자 · 소개비 · 조회」(목록 API 에 gradeLabel · viewCount 를 더함).
 *   소개받기 줄은 「등록자 · 예산」(GET /search 의 requests 에 회사명 · 예산 · 지역을 더함 — 비공개 요청은 빠짐).
 * 주소: q · gwanCode(관 화면 검색줄에서 오면 그 관 탭) · tab. 전에 쓰던 /search?q=&gwanCode= 주소는 그대로 됩니다.
 */
export default async function SearchPage({ searchParams }: {
  searchParams: Promise<{ q?: string; gwanCode?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  /* v10.83 — 한 글자는 어디서든 「두 글자 이상」(통합 검색 API 규칙과 같게 · 전: 상품 탭만 한 글자로 찾아 13건 등) */
  const short = !!q && q.replace(/\s/g, '').length < 2;
  const gwanCode = sp.gwanCode && LIST_GWANS.includes(sp.gwanCode) ? sp.gwanCode : undefined;
  const tab = sp.tab && (sp.tab in TABS_FIXED || LIST_GWANS.includes(sp.tab)) ? sp.tab : (gwanCode ?? 'ALL');
  const gTab = LIST_GWANS.includes(tab) ? tab : undefined;

  const gwans = await apiGet<Array<{ code: string; name: string }>>('/gwans', 300).catch(() => []);
  const GN: Record<string, string> = Object.fromEntries(gwans.map((g) => [g.code, g.name]));

  const showList = tab === 'ALL' || !!gTab;
  const showReq = tab === 'ALL' || tab === 'REQ';
  const showPost = tab === 'ALL' || tab === 'CMU';

  /* v10.32 — 시안처럼 관 칩마다 건수를 붙이려고 세 묶음(상품 · 요청 · 소개광장)을 늘 읽고, 고른 탭에 맞는 것만 보입니다(관 탭이면 그 관 줄만) */
  const lqs = new URLSearchParams({ limit: '20', sort: 'RELEVANCE', keyword: q, match: 'TITLE' });  /* v10.31 — 제목 · 업종에 든 것만(시안) */
  const [all, hit, board] = q && !short ? await Promise.all([
    apiGet<ListingListData>(`/listings?${lqs}`, 10).catch(() => EMPTY),
    q.length >= 2
      ? apiGet<{ requests: ReqHit[] }>(`/search?${new URLSearchParams({ q, limit: '20' })}`, 10).catch(() => ({ requests: [] as ReqHit[] }))
      : Promise.resolve({ requests: [] as ReqHit[] }),
    apiGet<Board>(`/community/board?${new URLSearchParams({ q: q.slice(0, 50), size: '10' })}`, 10).catch(() => ({ items: [], total: 0 })),
  ]) : [EMPTY, { requests: [] as ReqHit[] }, { items: [], total: 0 } as Board];
  /* 관 탭이면 그 관만 따로 읽습니다(전체 20건 안에 안 든 줄까지) */
  const list = gTab && q && !short
    ? await apiGet<ListingListData>(`/listings?${new URLSearchParams({ limit: '20', sort: 'RELEVANCE', keyword: q, match: 'TITLE', gwanCode: gTab })}`, 10).catch(() => EMPTY)
    : all;

  const rows = showList ? [...list.promoted.map((x) => ({ ...x, ad: true })), ...list.organic.map((x) => ({ ...x, ad: false }))] : [];
  const reqs = showReq ? hit.requests : [];
  const posts = showPost ? board.items : [];
  /* 칩 건수 — 광고 줄은 같은 매물이 일반 줄에도 있을 수 있어 id 로 한 번만 셉니다 */
  const seen = new Map<string, string>();
  for (const x of [...all.promoted, ...all.organic]) seen.set(x.id, x.gwanCode);
  const gCount = (g: string) => [...seen.values()].filter((c) => c === g).length;
  const cnt: Record<string, number> = { REQ: hit.requests.length, CMU: board.total };
  for (const g of LIST_GWANS) cnt[g] = gCount(g);
  cnt.ALL = seen.size + hit.requests.length + board.total;
  const n = cnt[tab] ?? 0;

  const tabs: Array<[string, string]> = [
    ['ALL', TABS_FIXED.ALL],
    ...LIST_GWANS.filter((g) => GN[g]).map((g) => [g, GN[g]] as [string, string]),
    ['REQ', TABS_FIXED.REQ], ['CMU', TABS_FIXED.CMU],
  ];
  const tabHref = (t: string) => {
    const u = new URLSearchParams({ q });
    if (t !== 'ALL') u.set('tab', t);
    return `/search?${u}`;
  };
  const back = gwanCode ? { href: `/${GWAN_PATH[gwanCode]}`, label: GN[gwanCode] ?? '이전 화면' } : { href: '/', label: '메인' };

  return (
    <div className="pc-src">
      <BackBar href={back.href} label={back.label} wrap={false} />
      <div className="pgh">
        <div>
          <h1>{q ? `‘${q}’ 검색 결과` : '통합 검색'}</h1>
          <p>세 관과 소개받기 · 소개광장을 한 번에 찾습니다. 통합 메인은 관이 아니라 허브입니다.</p>
        </div>
        {q && !short && <span className="did">{n}건</span>}
      </div>

      {/* 개발에만 있던 결과 화면 안 검색칸 — 같은 검색 팝업을 엽니다(diffs 기록) */}
      <div className="srch"><SearchBox variant="gwan" blue defaultValue={q} gwanCode={gwanCode as SearchGwan | undefined} /></div>

      {short ? (
        <div className="emp" role="status" data-search-short="">두 글자 이상 입력해 주세요.</div>
      ) : q ? (
        <>
          <nav className="tabs2" aria-label="검색 결과 묶음">
            {tabs.map(([v, label]) => (
              <Link key={v} href={tabHref(v)} className={`tb${v === tab ? ' on' : ''}`} aria-current={v === tab ? 'page' : undefined}
                data-tab={v}>{label} <i data-tab-count="">{cnt[v] ?? 0}</i></Link>
            ))}
          </nav>
          <div className="dact">
            <Link className="pc-bo sm" href={gwanCode ? `/search?gwanCode=${gwanCode}` : '/search'} data-search-again="">다시 검색</Link>
            <Link className="pc-bo sm" href="/listings">전체 목록 보기</Link>
            <Link className="pc-bo sm" href="/request/new">원하는 것을 요청으로 올리기</Link>
            {/* SB-HOM-SCH-020 — 문장으로 찾기(POST /search/prompt). key 로 검색어가 바뀌면 다시 엽니다 */}
            <PromptSearch key={q} initial={q} gwans={gwans} />
          </div>

          {showList && (rows.length ? (
            <>
              <h2 className="s2">상품 · 서비스 {rows.length}건</h2>
              <div className="tw">
                <table className="tb2">
                  <thead><tr><th>구분</th><th>상품 · 서비스</th><th>업종</th><th>등급</th><th>등록자</th><th>소개비</th><th>조회</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id + (r.ad ? '-ad' : '')}>
                        <td>
                          <span className={`gt g-${r.gwanCode.toLowerCase()}`}>{GN[r.gwanCode] ?? r.gwanCode}</span>
                          {r.ad && <span className="gt g-ad">{r.adLabel ?? '광고'}</span>}
                        </td>
                        <td><Link href={`/${GWAN_PATH[r.gwanCode] ?? 'money'}/${r.id}`}><b>{r.title}</b></Link></td>
                        <td>{r.categoryName}</td>
                        <td>{r.gradeLabel ?? '—'}</td>
                        <td>{r.owner?.companyName ?? '—'}</td>
                        <td>{won(r.desiredFee)}</td>
                        <td>{(r.viewCount ?? 0).toLocaleString('ko-KR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {list.promoted.length > 0 && list.adNotice && <p className="ls" style={{ marginTop: 6 }}>{list.adNotice}</p>}
            </>
          ) : (tab === 'ALL' || gTab) && <><h2 className="s2">상품 · 서비스</h2><div className="emp">{gTab ? '이 관에는 결과가 없습니다.' : '상품 · 서비스 결과가 없습니다.'}</div></>)}

          {/* v10.32 — 시안 순서: 상품 · 서비스 → 소개광장 글 → 소개받기 요청(개발) */}
          {showPost && (posts.length ? (
            <>
              <h2 className="s2">소개광장 {board.total}건</h2>
              {posts.map((p) => (
                <div key={p.id} className="lrow">
                  <div className="lt"><b>{p.title}</b><span className="ls">{p.author} · {ago(p.createdAt)}</span></div>
                  <div className="lact"><Link className="pc-bo sm" href={`/community/${p.id}`}>보기</Link></div>
                </div>
              ))}
            </>
          ) : (tab === 'CMU' || tab === 'ALL') && <><h2 className="s2">소개광장 0건</h2><div className="emp">맞는 소개광장 글이 없습니다.</div></>)}
          {showReq && (reqs.length ? (
            <>
              <h2 className="s2">소개받기 요청 {reqs.length}건</h2>
              {reqs.map((r) => (
                <div key={r.id} className="lrow">
                  <div className="lt"><b>{r.title}</b><span className="ls">{[
                    r.companyName ?? GN[r.gwanCode], r.categoryName, r.region,
                    r.budgetMin != null || r.budgetMax != null ? `예산 ${budgetText(r.budgetMin ?? null, r.budgetMax ?? null)}` : null,
                    ago(r.createdAt)].filter(Boolean).join(' · ')}</span></div>
                  <div className="lact"><Link className="pc-bo sm" href={`/request/${r.id}`}>보기</Link></div>
                </div>
              ))}
            </>
          ) : tab === 'REQ' && <div className="emp">{q.length < 2 ? '두 글자 이상 입력해 주세요.' : '맞는 소개받기 요청이 없습니다.'}</div>)}

        </>
      ) : (
        <div className="emp">검색어를 입력하십시오. 검색칸을 누르면 추천 검색어와 관별 결과가 바로 보입니다.</div>
      )}
    </div>
  );
}
