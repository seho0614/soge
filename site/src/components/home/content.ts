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
import { GWAN_PATH } from '@/lib/format';
import type { getTranslations } from 'next-intl/server';
import type { Fmt } from '@/lib/fmtBind';
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

/* v10.102 2-5c — 글은 사전 main.demo.* (그림의 예시 내용 · 나중에 서버 자료로 바뀝니다). [키, 그림, 거리(사전 키)] */
const TOWN = [
  ['t1', 'd/town-1.png'],
  ['t2', 'd/town-2.png'],
  ['t3', 'd/town-3.png'],
] as const;
/** main 사전 번역기 — page.tsx 의 getTranslations('main') 을 넘깁니다 */
export type MainT = Awaited<ReturnType<typeof getTranslations<'main'>>>;
const towns = (t: MainT, withLoc: boolean): TownCard[] => TOWN.map(([k, img]) => ({
  tag: t(`demo.towns.${k}.tag`), t: t(`demo.towns.${k}.t`), d: [t(`demo.towns.${k}.d1`), t(`demo.towns.${k}.d2`)] as [string, string],
  img, loc: withLoc ? t(`demo.towns.${k}.loc`) : null, href: '/community',
}));

/** 그림의 내용 그대로. 누르면 실제로 있는 화면으로 갑니다 */
export function sampleContent(live: string[], t: MainT, f: Fmt): HomeContent {
  const on = (c: string) => live.includes(c);
  const search = (q: string) => `/health/search?q=${encodeURIComponent(q)}`;
  /* 검색어(q)는 한국어 그대로 보냅니다(검색 색인이 한국어) — 보이는 글만 사전 */
  const PRODUCT_Q = [['r1', '음식물처리기'], ['r2', '에어프라이어'], ['r3', '커피머신']] as const;
  return {
    mode: 'sample',
    todaySub: t('demo.sample.todaySub'), todayMore: '/search',
    banner: { title: [t('demo.sample.banner.t1'), 'TOP 10'], desc: [t('demo.sample.banner.d1'), t('demo.sample.banner.d2')], href: '/community' },
    ranks: [
      ...(on('HLT') ? [{
        k: 'product', badge: t('demo.sample.rank.productBadge'), tone: 'red' as const, title: t('demo.sample.rank.productTitle'), art: 'd/rank-1.png',
        rows: PRODUCT_Q.map(([k, q]) => ({ t: t(`demo.sample.rank.product.${k}`), href: search(q) })), empty: { t: t('demo.rank.goMall'), href: '/health' },
      }] : []),
      {
        k: 'request', badge: 'NEW', tone: 'blue', title: t('demo.rank.requestTitle'), art: 'd/rank-2.png',
        rows: (['r1', 'r2', 'r3'] as const).map((k) => ({ t: t(`demo.sample.rank.request.${k}`), href: '/request' })), empty: { t: t('demo.rank.getReferred'), href: '/request' },
      },
      {
        k: 'community', badge: t('demo.sample.rank.townBadge'), tone: 'violet', title: t('demo.sample.rank.townTitle'), user: true, art: 'd/rank-3.png',
        rows: (['r1', 'r2', 'r3'] as const).map((k) => ({ t: t(`demo.sample.rank.town.${k}`), href: '/community' })), empty: { t: t('demo.rank.community'), href: '/community' },
      },
    ],
    picksSub: t('demo.sample.picksSub'), picksMore: '/search',
    picks: [
      { key: 'p1', href: on('HLT') ? '/health' : '/search', img: 'd/pick-1.png', badge: t('demo.sample.picks.p1.badge'), bw: 56, tone: 'hot', kind: t('demo.kind.product'), title: t('demo.sample.picks.p1.title'), strong: f.won(238000), off: '32%', rate: '4.8 (532)' },
      { key: 'p2', href: on('MAL') ? '/mal/consult' : '/search', img: 'd/pick-2.png', badge: t('demo.sample.picks.p2.badge'), bw: 40, tone: 'teal', kind: t('demo.kind.expert'), title: t('demo.sample.picks.p2.title'), sub: t('demo.sample.picks.p2.sub'), rate: '4.9 (320)' },
      { key: 'p3', href: on('BIZ') ? '/biz' : '/search', img: 'd/pick-3.png', badge: t('demo.sample.picks.p3.badge'), bw: 51, tone: 'hot', kind: t('demo.kind.biz'), title: t('demo.sample.picks.p3.title'), sub: t('demo.sample.picks.p3.sub'), rate: '4.7 (118)' },
      { key: 'p4', href: '/community', img: 'd/pick-4.png', badge: t('demo.sample.picks.p4.badge'), bw: 39, tone: 'mint', kind: t('demo.kind.town'), title: t('demo.sample.picks.p4.title'), sub: t('demo.sample.picks.p4.sub'), rate: '4.8 (1,234)' },
      { key: 'p5', href: '/community/polls', img: 'd/pick-5.png', badge: t('demo.sample.picks.p5.badge'), bw: 55, tone: 'blue', kind: t('demo.kind.poll'), title: t('demo.sample.picks.p5.title'), sub: t('demo.sample.picks.p5.sub'), rate: '4.6 (1,842)' },
    ],
    stripSub: t('demo.sample.stripSub'),
    townReady: true,
    towns: towns(t, true),
    trusts: [
      { img: 'trust-1', t: t('demo.trust.expert.t'), d: [t('demo.trust.expert.d')], href: '/mal/consult' },
      { img: 'trust-2', t: t('demo.trust.company.t'), d: [t('demo.trust.company.d')], href: '/mall' },
      { img: 'trust-3', t: t('demo.trust.goods.t'), d: [t('demo.sample.trustGoods')], href: '/mall/list' },
      { img: 'trust-4', t: t('demo.trust.sameDay.t'), d: [t('demo.trust.sameDay.d1'), t('demo.sample.trustSameDay')], href: '/consult' },
    ],
    starts: [
      { key: 's1', href: '/biz', img: 'd/start-1.png', badge: t('demo.sample.starts.s1.badge'), tone: 'hot', bw: 53, title: t('demo.sample.starts.s1.title'), sub: t('demo.sample.starts.s1.sub') },
      { key: 's2', href: '/biz', img: 'd/start-2.png', badge: t('demo.sample.starts.s2.badge'), tone: 'blue', bw: 43, title: t('demo.sample.starts.s2.title'), sub: t('demo.sample.starts.s2.sub') },
      { key: 's3', href: '/biz', img: 'd/start-3.png', badge: t('demo.sample.starts.s3.badge'), tone: 'hot', bw: 32, title: t('demo.sample.starts.s3.title'), sub: t('demo.sample.starts.s3.sub') },
      { key: 's4', href: '/biz', img: 'd/start-4.png', badge: t('demo.sample.starts.s4.badge'), tone: 'hot', bw: 31, title: t('demo.sample.starts.s4.title'), sub: t('demo.sample.starts.s4.sub') },
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
}, t: MainT, f: Fmt): HomeContent {
  const on = (c: string) => live.includes(c);
  const n = (x: number) => f.num(x);
  const p = d.prods.filter((x) => !x.soldOut);
  const like = (x: number) => t('demo.live.like', { n: n(x) });
  const listing = (x: ListingCardData, kind: string, badge: string, tone: string): PickCard => ({
    key: x.id, href: `/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`, img: listingArt(x.gwanCode, x.categoryName, x.title),
    badge, tone, kind, title: x.title, sub: `${x.categoryName} · ${x.owner.companyName}`,
    meta: `${t('demo.live.fee', { fee: f.won(x.desiredFee) })}${x.likeCount > 0 ? ` · ${like(x.likeCount)}` : ''}`,
  });
  const product = (x: HltProduct): PickCard => ({
    key: x.code, href: `/health/p/${encodeURIComponent(x.code)}`, img: productArt(x), badge: t('demo.live.newProduct'), tone: 'hot', kind: t('demo.kind.product'),
    title: x.name, strong: f.won(x.price), meta: x.category ?? t('demo.live.mall'),
  });
  const company = (x: ListingCardData) => listing(x, t('demo.kind.company'), x.owner.verified ? t('demo.live.verified') : t('demo.live.safe'), 'blue');
  const picks: PickCard[] = [];
  if (p[0]) picks.push(product(p[0]));
  if (d.mal[0]) picks.push(company(d.mal[0]));
  if (d.biz[0]) picks.push(listing(d.biz[0], t('demo.kind.biz'), d.biz[0].likeCount > 0 ? like(d.biz[0].likeCount) : t('demo.live.startups'), 'hot'));
  if (d.mny[0]) picks.push(listing(d.mny[0], t('demo.kind.referral'), t('demo.live.market'), 'mint'));
  if (d.reqs[0]) picks.push({
    key: d.reqs[0].id, href: `/request/${d.reqs[0].id}`, img: 't-request.svg', badge: d.reqs[0].statusLabel ?? t('demo.kind.request'), tone: 'blue', kind: t('demo.kind.request'),
    title: d.reqs[0].title, sub: d.reqs[0].categoryName ?? t('demo.rank.getReferred'), meta: t('demo.live.proposals', { n: n(d.reqs[0].proposalCount) }),
  });
  if (p[1]) picks.push(product(p[1]));
  if (d.mal[1]) picks.push(company(d.mal[1]));
  if (d.biz[1]) picks.push(listing(d.biz[1], t('demo.kind.biz'), t('demo.live.startups'), 'hot'));

  return {
    mode: 'live',
    todaySub: t('demo.live.todaySub'), todayMore: '/search',
    banner: on('MNY')
      ? { title: [t('demo.live.bannerMny.t1'), 'TOP 10'], desc: [t('demo.live.bannerMny.d1'), t('demo.live.bannerMny.d2')], href: '/money?sort=POPULAR' }
      : { title: [t('demo.live.bannerSearch.t1'), t('demo.live.bannerSearch.t2')], desc: [t('demo.live.bannerSearch.d1'), t('demo.live.bannerSearch.d2')], href: '/search' },
    ranks: [
      ...(on('HLT') ? [{
        k: 'product', badge: t('demo.live.mall'), tone: 'red' as const, title: t('demo.live.rank.productTitle'), art: 'd/rank-1.png',
        rows: d.prods.slice(0, 3).map((x) => ({ t: x.name, href: `/health/p/${encodeURIComponent(x.code)}` })), empty: { t: t('demo.rank.goMall'), href: '/health' },
      }] : []),
      {
        k: 'request', badge: 'NEW', tone: 'blue', title: t('demo.rank.requestTitle'), art: 'd/rank-2.png',
        rows: d.reqs.slice(0, 3).map((r) => ({ t: r.title, href: `/request/${r.id}` })), empty: { t: t('demo.live.rank.requestEmpty'), href: '/request' },
      },
      {
        k: 'community', badge: t('demo.rank.community'), tone: 'violet', title: t('demo.live.rank.communityTitle'), art: 'd/rank-3.png',
        rows: d.posts.slice(0, 3).map((x) => ({ t: x.title, href: `/community/${x.id}` })), empty: { t: t('demo.live.rank.communityEmpty'), href: '/community' },
      },
    ],
    picksSub: t('demo.live.picksSub'), picksMore: '/search', picks,
    stripSub: t('demo.live.stripSub'),
    townReady: false,
    towns: towns(t, false),
    trusts: [
      { img: 'trust-1', t: t('demo.trust.expert.t'), d: [t('demo.trust.expert.d')], href: '/mal/consult' },
      { img: 'trust-2', t: t('demo.trust.company.t'), d: [t('demo.trust.company.d')], href: '/mall' },
      { img: 'trust-3', t: t('demo.trust.goods.t'), d: [t('demo.live.trustGoods')], href: '/mall/list' },
      { img: 'trust-4', t: t('demo.trust.sameDay.t'), d: [t('demo.trust.sameDay.d1'), t('demo.live.trustSameDay')], href: '/consult' },
    ],
    starts: d.biz.slice(0, 4).map((x) => ({
      key: x.id, href: `/biz/${x.id}`, img: listingArt('BIZ', x.categoryName, x.title),
      badge: x.likeCount > 0 ? like(x.likeCount) : x.categoryName, tone: 'hot',
      title: x.title, sub: `${x.categoryName} · ${t('demo.live.fee', { fee: f.won(x.desiredFee) })}`,
    })),
  };
}
