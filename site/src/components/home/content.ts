/**
 * SB-HOM-MAIN-010 · 011 — 새 메인(「hero 페이지」 디자인 · v10.13)에 넣을 내용.
 *
 * 화면(Sections.tsx)은 하나이고, 내용만 두 가지입니다.
 *
 *   sampleContent()   그림의 내용 그대로 — **지금 쓰는 값**입니다.
 *                     사장님 결정(2026-10-02): 「실제 웹에도 그림 내용 그대로」.
 *                     ★ 순위 · 평점 · 참여 수 · 인물은 실제 데이터가 아닙니다. 오픈 전에 아래 실제 데이터 판으로 바꾸십시오.
 *   liveContent()     같은 모양에 서버 데이터(상품 · 매물 · 요청 · 소개광장 글)를 넣은 판.
 *                     사이트 환경변수 HOME_CONTENT=live 로 켭니다. 받쳐 줄 데이터가 없는 칸은 「준비 중」으로 둡니다.
 *
 * 그림 속 글자 가운데 뜻이 통하지 않게 뭉개진 곳(자동 생성 흔적)은 뜻이 통하게 적었습니다:
 *   「분당 의원원」 → 분당 의원 · 「어한련 검심 +30%」 → 관심 급상승 +30% · 「무료로」(창업 4번째) → 무점포 ·
 *   세 번째 투표 카드의 작은 글 → 「실제 사용자들의 솔직한 의견을 기다려요.」
 */
import type { ListingCardData } from '@/lib/types';
import type { HltProduct } from '@/components/health/types';
import { GWAN_PATH, won } from '@/lib/format';
import type { HomeRequest } from './types';

export interface Row { t: string; href: string }
export interface RankCard {
  k: string; badge: string; tone: 'red' | 'blue' | 'violet'; title: string; user?: boolean; art: string;
  rows: Row[]; empty: Row;
}
export interface PickCard {
  key: string; href: string; img: string; badge: string; tone: string; kind: string; title: string;
  /** 그림 속 사진에는 꼬리표가 이미 그려져 있습니다 — 같은 자리에 같은 폭(%)으로 글자를 덮어 선명하게 합니다 */
  bw?: number;
  strong?: string; off?: string; sub?: string; rate?: string; meta?: string;
}
export interface TownCard { tag: string; t: string; d: [string, string]; img: string; loc: string | null; href: string }
export interface TrustCard { img: string; t: string; d: [string, string?]; href: string }
export interface StartCard { key: string; href: string; img: string; badge: string; tone: string; bw?: number; title: string; sub: string }
export interface HomeContent {
  mode: 'sample' | 'live';
  todaySub: string; todayMore: string;
  banner: { title: [string, string]; desc: [string, string]; href: string };
  ranks: RankCard[];
  picksSub: string; picks: PickCard[]; picksMore: string;
  stripSub: string;
  townReady: boolean; towns: TownCard[];
  trusts: TrustCard[];
  starts: StartCard[];
}

const TOWN: [string, string, [string, string], string, string][] = [
  ['동네픽', '지금 핫한 맛집', ['우리동네 사람들이', '많이 찾는 맛집이에요.'], 'd/town-1.png', '판교역 300m'],
  ['동네소개', '우리동네 가볼 만한 곳', ['카페, 핫플, 맛집, 생활정보까지', '한눈에 확인하세요.'], 'd/town-2.png', '정자동 500m'],
  ['동네참여', '우리동네 이야기', ['지금 우리동네 사람들의', '생생한 이야기를 만나보세요.'], 'd/town-3.png', '분당구 1km'],
];

/** 그림의 내용 그대로. 누르면 실제로 있는 화면으로 갑니다 */
export function sampleContent(live: string[]): HomeContent {
  const on = (c: string) => live.includes(c);
  const search = (q: string) => `/health/search?q=${encodeURIComponent(q)}`;
  return {
    mode: 'sample',
    todaySub: '지금 가장 많이 찾는 정보와 실시간 트렌드를 확인해보세요.', todayMore: '/search',
    banner: { title: ['가을 나들이 맛집', 'TOP 10'], desc: ['지금 많이 찾는 가족 외식 장소를', '소개해드려요.'], href: '/community' },
    ranks: [
      ...(on('HLT') ? [{
        k: 'product', badge: '실시간 LIVE', tone: 'red' as const, title: '인기 급상승 상품', art: 'd/rank-1.png',
        rows: ['음식물처리기', '에어프라이어', '커피머신'].map((t) => ({ t, href: search(t) })), empty: { t: '소개몰 가기', href: '/health' },
      }] : []),
      {
        k: 'request', badge: 'NEW', tone: 'blue', title: '소개를 기다리는 요청', art: 'd/rank-2.png',
        rows: ['세무 상담이 필요해요', '상가 인테리어 업체', '학원 강사 구해요'].map((t) => ({ t, href: '/request' })), empty: { t: '소개받기', href: '/request' },
      },
      {
        k: 'community', badge: '우리동네 인기', tone: 'violet', title: '판교 · 분당', user: true, art: 'd/rank-3.png',
        rows: ['판교 가족식당', '분당 의원', '정자동 카페'].map((t) => ({ t, href: '/community' })), empty: { t: '소개광장', href: '/community' },
      },
    ],
    picksSub: '지금 주목받는 상품, 전문가, 창업아이템, 동네정보를 한눈에!', picksMore: '/search',
    picks: [
      { key: 'p1', href: on('HLT') ? '/health' : '/search', img: 'd/pick-1.png', badge: '오늘 할인 TOP', bw: 56, tone: 'hot', kind: '상품', title: 'AI 음식물처리기 A1', strong: '238,000원', off: '32%', rate: '4.8 (532)' },
      { key: 'p2', href: on('MAL') ? '/mal/consult' : '/search', img: 'd/pick-2.png', badge: '본사 검증', bw: 40, tone: 'teal', kind: '전문가', title: '김현우 세무사', sub: '개인 · 법인 세무 상담', rate: '4.9 (320)' },
      { key: 'p3', href: on('BIZ') ? '/biz' : '/search', img: 'd/pick-3.png', badge: '관심 급상승', bw: 51, tone: 'hot', kind: '창업', title: '무인 스터디카페 창업', sub: '3천만원 이하 가능', rate: '4.7 (118)' },
      { key: 'p4', href: '/community', img: 'd/pick-4.png', badge: '내 주변', bw: 39, tone: 'mint', kind: '동네정보', title: '판교 가족식당 추천', sub: '도보 5분 · 후기 1,234건', rate: '4.8 (1,234)' },
      { key: 'p5', href: '/community/polls', img: 'd/pick-5.png', badge: '1,842명 참여', bw: 55, tone: 'blue', kind: '설문', title: '카페에서 중요한 것은?', sub: '지금 투표해보세요', rate: '4.6 (1,842)' },
    ],
    stripSub: '소개뱅크가 추천하는 우리동네 감성 핫플레이스',
    townReady: true,
    towns: TOWN.map(([tag, t, d, img, loc]) => ({ tag, t, d, img, loc, href: '/community' })),
    trusts: [
      { img: 'trust-1', t: '전문가 소개', d: ['검증된 전문가와 1:1 상담'], href: '/mal/consult' },
      { img: 'trust-2', t: '업체 소개', d: ['믿을 수 있는 지역업체'], href: '/mall' },
      { img: 'trust-3', t: '물건 소개', d: ['검증된 인기 상품'], href: '/mall/list' },
      { img: 'trust-4', t: '당일연락 소개', d: ['이사 · 청소 · 수리 등', '검증된 당일 연락'], href: '/consult' },
    ],
    starts: [
      { key: 's1', href: '/biz', img: 'd/start-1.png', badge: '관심 급상승 +30%', tone: 'hot', bw: 53, title: '무인카페 창업', sub: '저렴한 초기비용으로 시작' },
      { key: 's2', href: '/biz', img: 'd/start-2.png', badge: '3천만원 이하', tone: 'blue', bw: 43, title: '무인 편의점 창업', sub: '소자본으로 가능한 창업' },
      { key: 's3', href: '/biz', img: 'd/start-3.png', badge: '1인 운영', tone: 'hot', bw: 32, title: '반려동물 케어샵', sub: '1인으로 운영 가능한 아이템' },
      { key: 's4', href: '/biz', img: 'd/start-4.png', badge: '무점포', tone: 'hot', bw: 31, title: '1인 온라인 스토어', sub: '지금 많이 시작하는 창업' },
    ],
  };
}

/* ── 실제 데이터 판 (HOME_CONTENT=live) ─────────────────────────────────── */

/** 분류 그림 고르기 — 분류 이름 · 제목의 낱말로 고릅니다. 실제 매물에는 그림 속 사진을 붙일 수 없어 분류 그림을 씁니다 */
export function listingArt(gwan: string, cat: string | null, title: string): string {
  const pick = (s: string): string | null => {
    if (/태양광|발전소/.test(s)) return 't-solar.svg';
    if (/차량|중고차|화물|트럭|자동차|지게차/.test(s)) return 't-car.svg';
    if (/인수|합병|양도|양수|인맥|용역|납품/.test(s)) return 't-people.svg';
    if (/설비|기계|장비|집기|굴삭|선반/.test(s)) return 't-machine.svg';
    if (/임대|상가|건물|부동산|사무실|토지|공장|창고|공간/.test(s)) return 't-building.svg';
    if (/프랜차이즈|가맹|카페|식당|매장|편의점|점포/.test(s)) return 't-store.svg';
    return null;
  };
  /* 분류 이름이 먼저입니다 — 제목의 낱말보다 분류가 그 매물의 성격을 더 잘 말합니다 */
  return pick(cat ?? '') ?? pick(title) ?? (gwan === 'BIZ' ? 't-store.svg' : gwan === 'MAL' ? 't-building.svg' : 't-people.svg');
}
export function productArt(p: HltProduct): string {
  if (p.categoryCode === 'HLT_MEDDEV') return 't-device.svg';
  if (p.categoryCode === 'HLT_FITNESS') return 't-fitness.svg';
  return 't-product.svg';
}

export function liveContent(live: string[], d: {
  prods: HltProduct[]; mal: ListingCardData[]; biz: ListingCardData[]; mny: ListingCardData[];
  reqs: HomeRequest[]; posts: { id: string; title: string }[];
}): HomeContent {
  const on = (c: string) => live.includes(c);
  const n = (x: number) => x.toLocaleString('ko-KR');
  const p = d.prods.filter((x) => !x.soldOut);
  const listing = (x: ListingCardData, kind: string, badge: string, tone: string): PickCard => ({
    key: x.id, href: `/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`, img: listingArt(x.gwanCode, x.categoryName, x.title),
    badge, tone, kind, title: x.title, sub: `${x.categoryName} · ${x.owner.companyName}`,
    meta: `소개비 ${won(x.desiredFee)}${x.likeCount > 0 ? ` · 관심 ${n(x.likeCount)}` : ''}`,
  });
  const product = (x: HltProduct): PickCard => ({
    key: x.code, href: `/health/p/${encodeURIComponent(x.code)}`, img: productArt(x), badge: '새 상품', tone: 'hot', kind: '상품',
    title: x.name, strong: won(x.price), meta: x.category ?? '소개몰',
  });
  const picks: PickCard[] = [];
  if (p[0]) picks.push(product(p[0]));
  if (d.mal[0]) picks.push(listing(d.mal[0], '업체', d.mal[0].owner.verified ? '인증 업체' : '안심소개', 'blue'));
  if (d.biz[0]) picks.push(listing(d.biz[0], '창업', d.biz[0].likeCount > 0 ? `관심 ${n(d.biz[0].likeCount)}` : '소개창업', 'hot'));
  if (d.mny[0]) picks.push(listing(d.mny[0], '소개', '소개장터', 'mint'));
  if (d.reqs[0]) picks.push({
    key: d.reqs[0].id, href: `/request/${d.reqs[0].id}`, img: 't-request.svg', badge: d.reqs[0].statusLabel ?? '요청', tone: 'blue', kind: '요청',
    title: d.reqs[0].title, sub: d.reqs[0].categoryName ?? '소개받기', meta: `제안 ${n(d.reqs[0].proposalCount)}건`,
  });
  if (p[1]) picks.push(product(p[1]));
  if (d.mal[1]) picks.push(listing(d.mal[1], '업체', d.mal[1].owner.verified ? '인증 업체' : '안심소개', 'blue'));
  if (d.biz[1]) picks.push(listing(d.biz[1], '창업', '소개창업', 'hot'));

  return {
    mode: 'live',
    todaySub: '지금 올라온 상품 · 요청 · 이야기를 한곳에서 확인해보세요.', todayMore: '/search',
    banner: on('MNY')
      ? { title: ['소개장터 인기', 'TOP 10'], desc: ['관심이 가장 많이 모인 매물을', '모았어요.'], href: '/money?sort=POPULAR' }
      : { title: ['소개뱅크', '통합 검색'], desc: ['찾는 것을 문장으로', '물어보세요.'], href: '/search' },
    ranks: [
      ...(on('HLT') ? [{
        k: 'product', badge: '소개몰', tone: 'red' as const, title: '새로 들어온 상품', art: 'd/rank-1.png',
        rows: d.prods.slice(0, 3).map((x) => ({ t: x.name, href: `/health/p/${encodeURIComponent(x.code)}` })), empty: { t: '소개몰 가기', href: '/health' },
      }] : []),
      {
        k: 'request', badge: 'NEW', tone: 'blue', title: '소개를 기다리는 요청', art: 'd/rank-2.png',
        rows: d.reqs.slice(0, 3).map((r) => ({ t: r.title, href: `/request/${r.id}` })), empty: { t: '소개받기 요청 올리기', href: '/request' },
      },
      {
        k: 'community', badge: '소개광장', tone: 'violet', title: '새로 올라온 이야기', art: 'd/rank-3.png',
        rows: d.posts.slice(0, 3).map((x) => ({ t: x.title, href: `/community/${x.id}` })), empty: { t: '첫 이야기를 남겨 보세요', href: '/community' },
      },
    ],
    picksSub: '지금 올라온 상품, 업체, 창업아이템, 요청을 한눈에!', picksMore: '/search', picks,
    stripSub: '소개광장에서 우리동네 이야기를 나눠 보세요',
    townReady: false,
    towns: TOWN.map(([tag, t, dd, img]) => ({ tag, t, d: dd, img, loc: null, href: '/community' })),
    trusts: [
      { img: 'trust-1', t: '전문가 소개', d: ['검증된 전문가와 1:1 상담'], href: '/mal/consult' },
      { img: 'trust-2', t: '업체 소개', d: ['믿을 수 있는 지역업체'], href: '/mall' },
      { img: 'trust-3', t: '물건 소개', d: ['검증된 업체의 매물'], href: '/mall/list' },
      { img: 'trust-4', t: '당일연락 소개', d: ['이사 · 청소 · 수리 등', '인증업체 1곳이 연락'], href: '/consult' },
    ],
    starts: d.biz.slice(0, 4).map((x) => ({
      key: x.id, href: `/biz/${x.id}`, img: listingArt('BIZ', x.categoryName, x.title),
      badge: x.likeCount > 0 ? `관심 ${n(x.likeCount)}` : x.categoryName, tone: 'hot',
      title: x.title, sub: `${x.categoryName} · 소개비 ${won(x.desiredFee)}`,
    })),
  };
}
