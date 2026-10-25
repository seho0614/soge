/**
 * SB-HOM-MAIN-010 메인(로그인) · SB-HOM-MAIN-011 메인(비로그인) — 「hero 페이지」 디자인 (v10.13 · 2026-10-02 사장님이 주신 그림)
 *
 * 순서: 메인 전용 헤더 → 히어로(검색 탭 · 검색창 · 넘겨 보는 안내/HERO 광고 · 추천 칩) → 오늘의 소개뱅크 →
 *   지금, 어떤 소개가 필요하세요? → 오늘의 PICK → 이건 어때? → 띠배너 → 지금 우리동네 → 믿고 연결받는 안심소개 →
 *   최근 뜨는 창업 → 나를 위한 소개 → 소개뱅크 핵심 → 메인 전용 푸터
 * 근거: spec/design/hero_page_20261002.png (주신 그림) · docs/57_메인디자인적용_v10.13_20261002.md
 *
 * 메인만 머리 · 바닥이 다릅니다 — 공통 머리 · 바닥은 app/layout.tsx 가 메인에서만 그리지 않습니다(components/Chrome.tsx).
 * 사진 · 아이콘 · 로고는 그림에서 그대로 잘라 낸 것입니다(public/home/d).
 *
 * ★ 내용 — 사장님 결정(2026-10-02): 「실제 웹에도 그림 내용 그대로」. 그래서 기본값은 그림의 예시 내용입니다(content.ts 의 sampleContent).
 *   순위 · 평점 · 참여 수 · 인물은 실제 데이터가 아닙니다. 오픈 전에 사이트 환경변수 **HOME_CONTENT=live** 로 바꾸면
 *   같은 모양에 서버 데이터(상품 · 매물 · 요청 · 소개광장 글)가 들어갑니다(liveContent). 그때만 아래 목록 조회를 합니다.
 *
 * 조회는 여기서 한 번에 합니다. API 하나가 실패해도 그 칸만 비웁니다(.catch).
 *   늘        GET /gwans · /footer-links · /site-settings/public · /ads/serve?slot=HERO(성향 광고) · /me/summary(로그인) · /community/polls?scope=home(투표)
 *             · /weather/today?region=(v10.49 오늘의 날씨 · 10분 캐시 · 지역은 쿠키 sgb_wx · 없으면 운영이 정한 처음 지역)
 *   live 만   GET /listings · /requests · /health/products · /community/posts
 */
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { apiGet, apiGetPersonal, apiGetVisitor } from '@/lib/api';
import { me } from '@/lib/session';
import type { FooterLink, Gwan, ListingListData } from '@/lib/types';
import type { HltProduct } from '@/components/health/types';
import { WX_COOKIE, WX_REGION_RE, type AdServe, type HomeRequest, type MeSummary, type WeatherToday } from '@/components/home/types';
import type { PromoSlide } from '@/components/home/HeroPromo';
import type { Poll } from '@/components/community/poll';
import { HomeView } from '@/components/home/HomeView';
import { liveContent, sampleContent } from '@/components/home/content';
import { Msgs } from '@/i18n/Msgs';
import { getFmt } from '@/lib/getFmt';
import '@/styles/home.css';

/* 추천 칩 — 글은 사전(main.hero.chips) */
const CHIPS = ['c1', 'c2', 'c3', 'c4'] as const;

/* 히어로 오른쪽 카드의 안내 장. 첫 장이 그림에 있는 장(전문가 포트폴리오)입니다. gwan 이 있으면 그 관이 살아 있을 때만 냅니다 */
type SlideKey = 'pf' | 'biz' | 'health' | 'community';
/* 글(tag · title · desc · cta)은 사전(main.promo) — 그릴 때 넣습니다 */
const SLIDES: (Omit<PromoSlide, 'k' | 'tag' | 'title' | 'desc' | 'cta'> & { k: SlideKey; gwan?: string })[] = [
  { k: 'pf', gwan: 'MAL', href: '/mall', art: 'd/promo-art.png' },
  { k: 'biz', gwan: 'BIZ', href: '/biz', imgs: ['d/pick-3.png', 'd/start-2.png'] },
  { k: 'health', gwan: 'HLT', href: '/health', imgs: ['d/pick-1.png', 'd/poll-purifier.png'] },
  { k: 'community', href: '/community', imgs: ['d/pick-4.png', 'd/town-3.png'] },
];

export default async function Home() {
  const t = await getTranslations('main');
  const principal = await me().catch(() => null);
  const loggedIn = !!principal;
  const liveMode = process.env.HOME_CONTENT === 'live';
  const wxPick = (await cookies()).get(WX_COOKIE)?.value ?? '';
  const wxRegion = WX_REGION_RE.test(wxPick) ? wxPick : '';

  const [gwans, links, settings, ad, summary, polls, weather] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    apiGet<FooterLink[]>('/footer-links', 300).catch(() => [] as FooterLink[]),
    /* 60초 — 운영이 넣은 사회관계망 주소 · 법정 표시가 1분 안에 메인에 반영됩니다(v10.14 · 전에는 5분) */
    apiGet<Record<string, string | null>>('/site-settings/public', 60).catch(() => ({} as Record<string, string | null>)),
    apiGetPersonal<AdServe>('/ads/serve?slot=HERO').catch(() => null),
    loggedIn ? apiGetPersonal<MeSummary>('/me/summary').catch(() => null) : Promise.resolve(null),
    /* 「이건 어때?」 — 메인에 낼 투표(종류마다 1건). 내가 고른 보기가 사람(계정 · 방문자)마다 달라 캐시하지 않습니다 (D021) */
    apiGetVisitor<Poll[]>('/community/polls?scope=home').catch(() => [] as Poll[]),
    /* v10.49 (D103) 오늘의 날씨 — 기상청 자료는 API 가 발표마다 한 번만 받습니다. 실패하면 띠를 그리지 않습니다 */
    apiGet<WeatherToday>(`/weather/today${wxRegion ? `?region=${wxRegion}` : ''}`, 600).catch(() => null),
  ]);
  const live = gwans.filter((g) => g.isActive !== false).map((g) => g.code);
  const on = (c: string) => live.includes(c);

  const f = await getFmt();
  let c = sampleContent(live, t, f);
  if (liveMode) {
    const [mal, biz, mny, reqs, prods, posts] = await Promise.all([
      apiGet<ListingListData>('/listings?gwanCode=MAL&limit=3').catch(() => null),
      apiGet<ListingListData>('/listings?gwanCode=BIZ&limit=4&sort=POPULAR').catch(() => null),
      apiGet<ListingListData>('/listings?gwanCode=MNY&limit=3&sort=POPULAR').catch(() => null),
      apiGet<HomeRequest[]>('/requests?limit=4', 10).catch(() => [] as HomeRequest[]),
      apiGet<HltProduct[]>('/health/products', 60).catch(() => [] as HltProduct[]),
      apiGet<{ id: string; title: string }[]>('/community/posts?limit=3', 30).catch(() => []),
    ]);
    /* 광고(promoted)는 라벨 없이 섞지 않습니다 — 일반(organic)만 씁니다 (INV-11) */
    c = liveContent(live, {
      prods: on('HLT') ? prods : [], mal: on('MAL') ? (mal?.organic ?? []) : [], biz: on('BIZ') ? (biz?.organic ?? []) : [],
      mny: on('MNY') ? (mny?.organic ?? []) : [], reqs, posts,
    }, t, f);
  }

  const heroAd = ad && !ad.empty && ad.id ? ad : null;
  const slides = SLIDES.filter((s) => !s.gwan || on(s.gwan)).map(({ gwan: _g, ...s }): PromoSlide => ({
    ...s, tag: t(`promo.slides.${s.k}.tag`), title: t(`promo.slides.${s.k}.title`), desc: t(`promo.slides.${s.k}.desc`), cta: t('promo.cta'),
  }));
  /* 그림은 「2 / 5」 — 광고가 첫 장일 때 그림에 있는 장이 둘째 장입니다. 그 장부터 엽니다 */
  const start = heroAd && slides[0]?.k === 'pf' ? 1 : 0;

  /* ★ 화면은 HomeView(클라이언트 컴포넌트)가 그립니다 — 여기서는 **자료만** 넘깁니다. 이유는 HomeView.tsx 머리말(수화 오류 #418). */
  return (
    <Msgs ns={['main']}>
      <HomeView c={c} gwans={gwans} links={links} settings={settings} loggedIn={loggedIn} summary={summary}
        live={live} ad={heroAd} slides={slides} start={start} chips={CHIPS.map((k) => t(`hero.chips.${k}`))} year={new Date().getFullYear()} polls={polls}
        weather={weather} />
    </Msgs>
  );
}
