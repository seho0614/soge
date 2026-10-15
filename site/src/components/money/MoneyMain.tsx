/**
 * SB-MNY-MAIN-010 소개장터 메인 — 2026-10-09 제시 디자인 · v10.30.
 *   근거: docs/design/money_main_20261009.webp(화면) · 모양은 styles/money.css · 그림은 public/money(받은 그림에서 자른 것 그대로)
 *
 * 10/9 답 — ① 「시안 + 실제 웹 모양」(DB 변경 없음) ② 「지금 있던 구역은 디자인 아래에 남김」 ③ 「디자인 시트는 소개장터에만」 ④ 「글꼴도 소개장터에만」.
 * v10.29(시안 디자인 · 기능 반영)의 관 화면 부품(components/gwan) · 공통 검색(components/search) 위에 얹었습니다.
 *
 * ★ 이 파일은 **조회만** 합니다 — 화면은 MoneyView(클라이언트 컴포넌트)가 그립니다. 이유는 메인(components/home/HomeView.tsx)과 같습니다:
 *   서버 컴포넌트가 만든 화면 조각이 크면 React 가 조각을 뒤로 미뤄 따로 보내는데, 브라우저가 그 조각이 오기 전에 수화를 시작하면
 *   「Minified React error #418」이 납니다(창 6개로 동시에 30번씩 열면 540번 가운데 23번 — 2026-10-10 실측 · v10.29 의 관 화면도 같은 방식으로 18 / 540).
 *   자료(글자 · 숫자 · 목록)는 뒤로 밀리지 않으므로, 서버는 자료만 넘깁니다. 서버에서 미리 그려 보내는 것(SSR)은 그대로입니다.
 *
 * 구역(위 → 아래)과 자료:
 *   1 맨 위        제목 · 검색(MoneySearch — 누르면 검색 팝업 · 제출하면 /search?q=…&gwanCode=MNY) · 광고 칸(GET /ads/serve?slot=GHERO · 소재가 없으면 칸을 그리지 않음)
 *   2 바로가기 3장 소개하기(/register) · 소개받고 싶어요(/request/new) · 소개받기(/request) — v10.29 의 역할 탭 3개와 같은 곳
 *   3 분야 14칸    이름은 그림 그대로 · 누르면 그 낱말로 아래 목록을 거릅니다(/money?keyword=…#mny-list) — 서버에 이 분류가 없습니다(menu.ts)
 *   4 왼쪽 분류    같은 방식. 「지역으로 찾기」는 넣지 않았습니다 — 매물 · 요청에 지역 값이 없습니다
 *   5 소개 요청    GET /requests?gwanCode=MNY&limit=4 — 사진 · 지역 · 종류 탭은 서버에 없어 그 칸만 뺐습니다
 *   6 지금 있던 것 (#mny-list) 퀵메뉴 5 · 「소개상품 찾기」(구분 · 분류) · 검색 조건 줄 · 매물 사진 카드 · 건수/쪽/정렬 — v10.29 관 첫 화면(GwanLanding)의
 *                  부품과 조회 규칙 그대로(GET /listings · /categories · /gwans). 주소(?sort · ?badge · ?cat · ?grade · ?keyword · ?cursor · ?p)도 그대로 받습니다.
 *   7 공급자 등록  /register
 *
 * v10.31 (w2 · 10/10 「시안 기준」) — v10.30 에서 서버 자료가 없어 뺐던 7구역을 **서버까지 만들어** 시안대로 그립니다:
 *   많이 찾는 키워드(GET /search/keywords) · 서비스 업체 추천(GET /market/suppliers) · AI 추천 맞춤 공급자(GET /market/suppliers/recommended) ·
 *   띠 광고(GET /ads/serve?slot=GBAND) · 최근 실제 연결 사례(GET /market/success/recent) · 지역으로 찾기(GET /market/regions → ?region=) ·
 *   요청 종류 탭 · 사진 · 지역(GET /market/requests). 숫자 · 글은 모두 서버 기록이고, 자료가 없으면 그 구역 안에 「아직 없습니다」를 냅니다.
 * v10.29 관 첫 화면에 있다가 **이 디자인으로 바뀌며 빠진 것**: 지역 설정 칸(고른 값을 기억만 하고 목록을 거르지 않던 칸) · 검색줄 옆 띠 그림(스마트팜 견본) ·
 *   아래 안내 6칸 · 왼쪽 「상품 분류」 목록(같은 분류를 「소개상품 찾기」의 고르기 칸에서 고릅니다). 관이 **중지**되면 안내 한 줄만 냅니다.
 */
import { apiGet, apiGetPersonal } from '@/lib/api';
import type { Gwan, ListingCardData, ListingListData } from '@/lib/types';
import type { AdServe } from '@/components/home/types';
import { safeSort } from '@/lib/format';
import type { GwQuery } from '@/components/gwan/GwanLanding';
import { GW, GRADES, SORTS, qhref } from '@/components/gwan/gw';
import type { GwCategory } from '@/components/gwan/GwParts';
import type { Keywords, MarketRegions, MarketReqs, Recommended, SuccessCase, Supplier } from '@/components/market/types';
import { MoneyView } from './MoneyView';

const BADGES = new Set(['URGENT', 'VERIFIED_DOC']);
const PER = 6;                       // v10.29 관 첫 화면과 같음 — 한 쪽 6칸
const BASE = '/money';
const AT = '#mny-list';              // 고르면 다시 이 구역으로 옵니다
/** 조건을 주소에 남기고(빈 값은 뺌) 목록 구역으로 */
const at = (p: Record<string, string | undefined | null>) => qhref(BASE, p) + AT;

export async function MoneyMain({ q }: { q: GwQuery & { region?: string } }) {
  const g = GW.MNY;
  const region = q.region && /^(\d{10}|ETC)$/.test(q.region) ? q.region : undefined;
  const rq = region && region !== 'ETC' ? `&regionCode=${region}` : '';
  /* 하나가 실패해도 그 칸만 비웁니다 */
  const [gwans, cats0, reqs, ad, kw, regions, sup, cases, band, float] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    apiGet<GwCategory[]>('/categories?gwanCode=MNY', 300).catch(() => [] as GwCategory[]),
    /* 요청 종류 탭은 이 화면 안에서 고릅니다(시안) — 최근 24건을 받아 탭마다 4건씩 */
    apiGet<MarketReqs>(`/market/requests?gwanCode=MNY&limit=24${rq}`, 10).catch(() => ({ items: [], kinds: [] }) as MarketReqs),
    apiGetPersonal<AdServe>('/ads/serve?slot=GHERO').catch(() => null),
    apiGet<Keywords>('/search/keywords?gwanCode=MNY&limit=5', 60).catch(() => ({ items: [] }) as Keywords),
    apiGet<MarketRegions>('/market/regions?gwanCode=MNY', 60).catch(() => null),
    apiGet<Supplier[]>(`/market/suppliers?gwanCode=MNY&limit=4${rq}`, 30).catch(() => [] as Supplier[]),
    apiGet<{ items: SuccessCase[] }>('/market/success/recent?gwanCode=MNY&limit=3', 30).catch(() => ({ items: [] as SuccessCase[] })),
    apiGetPersonal<AdServe>('/ads/serve?slot=GBAND').catch(() => null),
    apiGetPersonal<AdServe>('/ads/serve?slot=FLOAT').catch(() => null),
  ]);
  /* AI 추천 — 사람마다 다릅니다(동의 · 지역). 위 「업체 추천」에 나온 업체는 뺍니다 */
  const ai = await apiGetPersonal<Recommended>(`/market/suppliers/recommended?gwanCode=MNY&limit=4${rq}&exclude=${sup.map((x) => x.id).join(',')}`)
    .catch(() => null);
  /* 제한 업종 분류는 공개 분류 목록에서 숨깁니다(등록 화면과 같은 규칙 · v10.31) */
  const cats = cats0.filter((c) => !(c as GwCategory & { restricted?: boolean }).restricted);
  const gw = gwans.find((x) => x.code === 'MNY');
  /* 관을 **중지**했을 때 — 시안(E-01)의 안내 한 줄만 냅니다(신규 등록 · 문의가 막히므로 바로가기 · 목록을 내지 않습니다).
   *   GET /gwans 는 중지한 관을 **빼고** 내려줍니다(catalog.service.ts — WHERE is_active). 그래서 「목록은 왔는데 소개장터가 없음」도 중지로 봅니다.
   *   목록 자체를 못 받은 것(빈 배열)은 중지로 보지 않습니다 — 서버가 잠깐 느린 것을 중지로 알리면 안 됩니다. */
  if ((gw && !gw.isActive) || (!gw && gwans.length > 0)) {
    return (
      <><div className="mny" data-sgb-gwan="money" data-mny-off="1">
        <div className="mny-wrap">
          <h1 className="mny-sr">{g.name}</h1>
          <p className="mny-off" role="status"><b>{g.name}</b> 관이 <b>중지</b> 상태입니다. 신규 등록과 신규 문의만 막히고 진행 중인 거래는 그대로 완주합니다. 관을 다시 열면 이 화면이 그대로 돌아옵니다.</p>
        </div>
      </div><i hidden data-root-end="" /></>
    );
  }

  /* ── 지금 있던 구역의 조회 — components/gwan/GwanLanding 과 같은 규칙 ── */
  const cat = cats.find((c) => c.id === q.cat);
  const grade = GRADES.find((x) => x.code === q.grade && cats.some((c) => c.gradeCode === x.code)) ? q.grade : undefined;
  const badge = q.badge && BADGES.has(q.badge) ? q.badge : undefined;
  const sort = safeSort(q.sort);
  const keyword = (q.keyword ?? '').trim().slice(0, 50) || undefined;
  const page = Math.max(1, Number(q.p) || 1);
  const keep = { sort, badge, cat: cat?.id, grade, keyword, region };
  /* 구분(등급)만 고르면 그 구분의 분류로 거릅니다 — 목록 API 는 분류 하나만 받으므로, 여러 분류면 한 번에 받아 화면에서 거릅니다. */
  const gradeCats = grade && !cat ? cats.filter((c) => c.gradeCode === grade) : null;
  const qs = new URLSearchParams({ gwanCode: 'MNY', limit: String(gradeCats ? 50 : PER) });
  if (sort) qs.set('sort', sort);
  /* v10.31 — 쪽 번호(시안): 서버가 건수를 주는 page 모드. 옛 주소의 ?cursor= 는 그대로 받습니다 */
  if (q.cursor && !gradeCats) qs.set('cursor', q.cursor); else if (!gradeCats) qs.set('page', String(page));
  if (region) qs.set('regionCode', region);
  if (badge) qs.set('badge', badge);
  if (cat) qs.set('categoryId', cat.id);
  else if (gradeCats?.length === 1 && gradeCats[0]) qs.set('categoryId', gradeCats[0].id);
  if (keyword) qs.set('keyword', keyword);
  let data: ListingListData | null = gradeCats && gradeCats.length === 0
    ? { promoted: [], organic: [], nextCursor: null, adNotice: '' }
    : await apiGet<ListingListData>(`/listings?${qs}`).catch(() => null);
  let organic: ListingCardData[] = [];
  if (data) {
    const names = gradeCats ? new Set(gradeCats.map((c) => c.name)) : null;
    organic = names ? data.organic.filter((x) => names.has(x.categoryName)) : data.organic;
    if (gradeCats) data = { ...data, nextCursor: null };
  }
  const gradeNm = grade ? GRADES.find((x) => x.code === grade)?.nm : undefined;
  const regionNm = region ? (region === 'ETC' ? '기타 지역' : regions?.all.find((x) => x.code === region)?.name) : undefined;
  const sel = [regionNm, gradeNm, cat?.name, badge === 'URGENT' ? '급구' : badge === 'VERIFIED_DOC' ? '서류 확인' : undefined, keyword && `「${keyword}」`].filter(Boolean).join(' · ');
  const sortHrefs = Object.fromEntries(SORTS.map(([v]) => [v, at({ ...keep, sort: v === 'RECENT' ? undefined : v })]));
  const josa = /[가-힣]$/.test(g.sect) && (g.sect.charCodeAt(g.sect.length - 1) - 0xac00) % 28 ? '이' : '가';

  /* 화면은 MoneyView 가 그립니다 — 여기서 정한 값(주소 · 글자)만 넘깁니다. 맨 바깥은 여러 마디(G-94 규칙) */
  return (
    <><MoneyView
      keyword={keyword ?? ''} reqs={reqs} ad={ad && !ad.empty && ad.id ? ad : null}
      keywords={kw.items} regions={regions} region={region} suppliers={sup} ai={ai} cases={cases.items}
      band={band && !band.empty && band.id ? band : null} float={float && !float.empty && float.id ? float : null}
      pageCount={data?.pageCount}
      title={cat ? cat.name : `지금 인기 있는 ${g.sect}`} sel={sel} total={gw?.listingCount ?? 0} josa={josa}
      grades={GRADES.filter((x) => cats.some((c) => c.gradeCode === x.code)).map((x) => ({ code: x.code, label: x.code === 'G1' ? x.nm : `${x.nm} (가칭)` }))}
      cats={cats.map((c) => ({ id: c.id, name: c.name, gradeCode: c.gradeCode ?? '' }))}
      grade={grade} cat={cat?.id} badge={badge} sort={sort} page={page}
      bar={[
        ...(regionNm ? [{ label: regionNm, clear: '✕ 지역 해제', href: at({ ...keep, region: undefined }) }] : []),
        ...(gradeNm ? [{ label: gradeNm, clear: '✕ 구분 해제', href: at({ ...keep, grade: undefined }) }] : []),
        ...(cat ? [{ label: cat.name, clear: '✕ 분류 해제', href: at({ ...keep, cat: undefined }) }] : []),
        ...(badge ? [{ label: badge === 'URGENT' ? '급구' : '서류 확인', clear: '✕ 표시 해제', href: at({ ...keep, badge: undefined }) }] : []),
        ...(keyword ? [{ label: `「${keyword}」`, clear: '✕ 검색어 해제', href: at({ ...keep, keyword: undefined }) }] : []),
      ]}
      data={data ? { promoted: data.promoted, adNotice: data.adNotice, next: data.nextCursor ? at({ ...keep, cursor: data.nextCursor, p: String(page + 1) }) : null } : null}
      organic={organic} firstHref={at(keep)} sortHrefs={sortHrefs} keep={keep}
    /><i hidden data-root-end="" /></>
  );
}
