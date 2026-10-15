'use client';
/**
 * SB-HOM-MAIN-010 · 011 — 메인 화면 전체(「hero 페이지」 디자인 · v10.13). page.tsx 가 조회한 **자료만** 받아 그립니다.
 *
 * ★ 왜 클라이언트 컴포넌트인가 (2026-10-02 실측)
 *   처음에는 구역들을 서버 컴포넌트로 그렸습니다. 그러자 메인을 열 때 가끔(약 3 ~ 13%) 브라우저 콘솔에
 *   「Minified React error #418」(수화 실패)가 뜨고 화면을 통째로 다시 그렸습니다. 화면은 같아 보이지만 오류입니다.
 *   원인 — 서버 컴포넌트가 만든 화면 조각이 한 줄 3,200바이트를 넘으면 React 가 조각을 **뒤로 미뤄** 따로 보냅니다
 *   (react-server-dom 의 MAX_ROW_SIZE). 메인은 조각이 커서 구역마다 뒤로 밀렸고, 브라우저가 그 조각이 다 오기 전에
 *   수화를 시작하면 <div class="home"> 을 두 번 맞춰 보다가 어긋났습니다(React 가 태그 요소를 다시 그릴 때 수화 위치를 되돌리지 않음).
 *   실패한 자리를 직접 확인했습니다 — 항상 div.home, 다음 차례가 header.home-hd.
 *   자료(글자 · 숫자 · 목록)는 뒤로 밀리지 않습니다. 그래서 서버는 자료만 넘기고 화면은 여기서 그립니다.
 *   서버에서 미리 그려 보내는 것(SSR)은 그대로입니다 — 첫 화면 · 검색 노출은 달라지지 않습니다.
 *   다른 화면은 손대지 않았습니다(같은 일이 드물게 납니다 — docs/57 의 확인 항목).
 *
 * 그래서 이 파일 아래(Sections · Frame · Icons)는 서버 전용 기능(쿠키 · 조회)을 쓰면 안 됩니다. 조회는 page.tsx 에서만 합니다.
 * 연도처럼 서버와 브라우저에서 달라질 수 있는 값은 page.tsx 가 정해서 넘깁니다(year).
 */
import Link from 'next/link';
import type { FooterLink, Gwan } from '@/lib/types';
import type { HomeContent } from './content';
import type { AdServe, MeSummary } from './types';
import type { Poll as PollData } from '../community/poll';
import { HERO_SEARCH_EVENT, HeroSearch } from './HeroSearch';
import { HeroPromo, type PromoSlide } from './HeroPromo';
import { DemoBar, HomeFooter, HomeHeader } from './Frame';
import { isOps } from '@/components/common/links';
import { Line, Pic } from './Icons';
import { Core, ForMe, Needs, Picks, Poll, Startup, Strip, Today, Town, Trust } from './Sections';

export interface HomeViewProps {
  c: HomeContent;
  gwans: Gwan[];
  links: FooterLink[];
  settings: Record<string, string | null>;
  loggedIn: boolean;
  summary: MeSummary | null;
  /** 살아 있는 관 코드 */
  live: string[];
  /** HERO 광고(없으면 null) */
  ad: AdServe | null;
  slides: PromoSlide[];
  start: number;
  chips: string[];
  year: number;
  /** 메인에 낼 투표(종류마다 1건 · 없을 수 있음) — 실제 표 수 포함 */
  polls: PollData[];
}

export function HomeView({ c, gwans, links, settings, loggedIn, summary, live, ad, slides, start, chips, year, polls }: HomeViewProps) {
  const on = (code: string) => live.includes(code);
  return (
    <div className="home" data-content={c.mode}>
      <HomeHeader gwans={gwans} loggedIn={loggedIn} summary={summary} />

      <section className="home-hero" aria-labelledby="home-h1">
        <div className="home-in">
          <div className="home-heroin">
            <div className="home-herol">
              <span className="home-aibdg"><Pic name="spark-s" h={19} /> 소뱅AI 연결</span>
              <h1 id="home-h1">무엇을 찾고 계세요?<br /><em>소뱅AI가 딱 맞는 소개</em>를 이어드려요.</h1>
              <p className="home-lead">사람, 상품, 서비스, 창업, 동네정보까지{' '}<br />소개뱅크 안에서 더 빠르고 똑똑하게 연결해드려요.</p>
              <HeroSearch live={live} />
            </div>
            <HeroPromo ad={ad} slides={slides} start={start} />
          </div>
          <div className="home-chips">
            {/* v10.31 — 시안 .mh-chip: 누르면 그 말로 검색 팝업이 열립니다(HeroSearch). 자바스크립트가 없으면 링크대로 통합 검색 */}
            {chips.map((q) => (
              <Link key={q} className="home-chip mh-chip" href={`/search?q=${encodeURIComponent(q)}`} data-q={q}
                onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent(HERO_SEARCH_EVENT, { detail: q })); }}>
                <Line name="search" size={18} w={2.4} />{q}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Today c={c} />
      <Needs live={live} />
      <Picks c={c} />
      <Poll polls={polls} />
      <Strip c={c} />
      <Town c={c} />
      {on('MAL') && <Trust c={c} />}
      {on('BIZ') && <Startup c={c} />}
      <ForMe loggedIn={loggedIn} summary={summary} />
      <Core />

      <DemoBar ops={isOps(summary?.principal?.roles)} />
      <HomeFooter links={links} settings={settings} sample={c.mode === 'sample'} year={year} loggedIn={loggedIn} ops={isOps(summary?.principal?.roles)} />
    </div>
  );
}
