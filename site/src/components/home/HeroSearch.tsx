'use client';
/**
 * SB-HOM-MAIN-010 · 011 — 히어로의 검색 탭 · 검색창 (v10.13 「hero 페이지」 디자인).
 *
 * v10.31 — 시안과 같게: 검색칸을 누르거나(mousedown) · Tab 으로 들어오거나(focus) · 글자를 치면(input) **검색 팝업(SearchPopup)** 이 열립니다
 *   (시안 mxHero 주석 「검색창을 누르면 기존 검색 팝업(spop)이 열립니다」 · 머리줄 · 관 화면과 같은 부품).
 *   팝업 안: 추천 검색어 칩(검색어 집계 · 제한업종 제외) · 관별 결과(요청 · 인기 매물 · 소개자) · ↑↓ · Enter → 상세 · 「이렇게 찾습니다」 ·
 *   고른 줄 없이 Enter → 결과 화면 · ESC / 바깥 누르면 닫힘.
 *
 * 탭 7개(시안 MHX_TABS)가 팝업의 결과를 거릅니다(SearchPopup 의 SCOPES):
 *   AI 검색      전체(요청 · 매물 · 소개자 + 「이렇게 찾습니다」) → /search?q=
 *   상품         소개몰 상품                                       → /health/search?q=
 *   서비스       소개장터                                           → /search?q=&gwanCode=MNY
 *   업체         안심소개                                           → /search?q=&gwanCode=MAL
 *   창업         소개창업                                           → /search?q=&gwanCode=BIZ
 *   동네정보     소개광장 글                                        → /search?q=&tab=CMU
 *   사람/전문가  소개자 + 안심소개(전문 업종)                        → /search?q=&gwanCode=MAL
 * 아래 추천 칩(HomeView)을 누르면 그 말로 팝업이 열립니다(시안 .mh-chip — 검색창에 넣고 input 을 쏨).
 * 자바스크립트가 없으면 폼 GET 으로 그 탭의 결과 화면에 갑니다. 빈 검색어만 여기서 막습니다(시안 toast 문구).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SCOPES, SearchPopup, type SearchScope } from '@/components/search/SearchPopup';
import { Line, Pic } from './Icons';

/* 핵심 칸 「AI로 찾고」가 #home-q 로 이 입력칸을 가리킵니다 — 바꾸면 Sections.tsx 도 같이 */
const HERO_INPUT_ID = 'home-q';
/** 히어로 아래 추천 칩이 팝업을 여는 신호 (HomeView) */
export const HERO_SEARCH_EVENT = 'sgb:hero-search';

/* 탭 이름(t) · 예시 글(ph)은 사전 main.heroSearch.tabs.<k> — 시안 MHX_TABS 의 글자 그대로 */
interface Tab { k: SearchScope; action: string; gwan?: string; tab?: string }
const TABS: Tab[] = [
  { k: 'ai', action: '/search' },
  { k: 'product', action: '/health/search', gwan: 'HLT' },
  { k: 'service', action: '/search', gwan: 'MNY' },
  { k: 'company', action: '/search', gwan: 'MAL' },
  { k: 'biz', action: '/search', gwan: 'BIZ' },
  { k: 'town', action: '/search', tab: 'CMU' },
  { k: 'pro', action: '/search', gwan: 'MAL' },
];

export function HeroSearch({ live }: { live: string[] }) {
  const tr = useTranslations('main');
  const tabs = TABS.filter((t) => !t.gwan || live.includes(t.gwan));
  const [tab, setTab] = useState<SearchScope>('ai');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState('');
  const cur = tabs.find((t) => t.k === tab) ?? tabs[0]!;

  const openWith = useCallback((v: string) => { setMsg(''); setSeed(v); setOpen(true); }, []);

  /* 추천 칩 · 「AI로 찾고」(#home-q) — 팝업을 엽니다 */
  useEffect(() => {
    const onChip = (e: Event) => openWith(String((e as CustomEvent<string>).detail ?? ''));
    const onAnchor = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.(`a[href="#${HERO_INPUT_ID}"]`);
      if (!a) return;
      e.preventDefault();
      document.getElementById(HERO_INPUT_ID)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      openWith('');
    };
    window.addEventListener(HERO_SEARCH_EVENT, onChip);
    document.addEventListener('click', onAnchor);
    if (window.location.hash === `#${HERO_INPUT_ID}`) openWith('');
    return () => { window.removeEventListener(HERO_SEARCH_EVENT, onChip); document.removeEventListener('click', onAnchor); };
  }, [openWith]);

  return (
    <div className="home-search">
      <div className="home-stabs" role="tablist" aria-label={tr('heroSearch.tabsAria')}>
        {tabs.map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={t.k === cur.k} data-stab={t.k}
            className={`home-stab${t.k === cur.k ? ' on' : ''}`} onClick={() => { setTab(t.k); setMsg(''); }}>{tr(`heroSearch.tabs.${t.k}.t`)}</button>
        ))}
      </div>
      <form className="home-sb" role="search" action={cur.action} method="get" data-scope={cur.k} noValidate
        onSubmit={(e) => {
          const el = e.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
          const v = el?.value.trim() ?? '';
          e.preventDefault();
          /* 시안: 빈 칸 제출 → 「무엇을 소개받고 싶은지 적어 주세요.」 · 말이 있으면(자바스크립트 이전에 친 글자) 그 범위 결과로 */
          if (!v) { setMsg(tr('heroSearch.empty')); return; }
          window.location.assign(SCOPES[cur.k].href(v));
        }}>
        <div className="home-sbin">
          <span className="home-spark" aria-hidden="true"><Pic name="spark" h={34} /></span>
          <span className="home-sbtx">
            <label className="home-sblab" htmlFor={HERO_INPUT_ID}>{tr('heroSearch.label')}</label>
            <input id={HERO_INPUT_ID} className="si" name="q" type="search" autoComplete="off" placeholder={tr(`heroSearch.tabs.${cur.k}.ph`)}
              role="combobox" aria-autocomplete="list" aria-expanded={open} aria-haspopup="dialog"
              defaultValue=""
              /* 시안 SPOP 의 세 길 — mousedown(초점이 옮겨가기 전에) · focus(Tab) · input(새어 들어온 글자는 팝업으로) */
              onMouseDown={(e) => { if (!open) { e.preventDefault(); openWith(e.currentTarget.value); } }}
              onFocus={(e) => { if (!open) { e.currentTarget.blur(); openWith(e.currentTarget.value); } }}
              onInput={(e) => {
                const typed = e.currentTarget.value;
                e.currentTarget.value = '';
                if (!open) openWith(typed);
              }} />
          </span>
          {/* 자바스크립트가 없을 때의 폼 GET — 그 탭의 결과 화면 */}
          {cur.gwan && cur.action === '/search' && <input type="hidden" name="gwanCode" value={cur.gwan} />}
          {cur.tab && <input type="hidden" name="tab" value={cur.tab} />}
          <button type="submit" className="home-go" aria-label={tr('heroSearch.submitAria')}><Line name="search" size={24} w={2.6} /></button>
        </div>
      </form>
      {msg && <p className="home-sbmsg" role="alert">{msg}</p>}
      {open && <SearchPopup seed={seed} scope={cur.k} onClose={() => setOpen(false)} />}
    </div>
  );
}
