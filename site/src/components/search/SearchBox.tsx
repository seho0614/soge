'use client';
/**
 * v10.29 — 시안 검색줄(proto_lite.html 의 searchTop() · search(blue, promo)) + 검색 팝업(SPOP).
 * 머리줄 · 관 화면 검색줄 모두 이 부품 하나를 씁니다. (팝업 동작은 SearchPopup.tsx)
 *
 * 쓰는 법(한 줄):
 *   import { SearchBox } from '@/components/search/SearchBox';
 *   <SearchBox variant="gwan" gwanCode="MNY" blue />
 *
 * 시안처럼 검색칸에 들어가는 세 길을 모두 팝업으로 돌립니다 —
 *   mousedown(누르기 · 초점이 뒤 칸으로 옮겨가기 전에) · focus(Tab 이동) · input(그래도 새어 들어온 글자는 팝업으로 옮김).
 * 🔍(제출)를 누르면 칸의 말로 통합 검색 결과(/search?q=)로 갑니다. 칸이 비어 있으면 팝업을 엽니다.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SearchPopup } from './SearchPopup';

export type SearchGwan = 'MNY' | 'MAL' | 'BIZ' | 'HLT';

export interface SearchBoxProps {
  /** header = 머리줄의 돋보기 단추 · top = 관 화면 위 전체 폭(searchTop) · gwan = 관 화면 검색줄(search()) */
  variant?: 'header' | 'top' | 'gwan';
  /** 관 화면에서 쓰면 그 관 결과를 먼저 보여 주고, 제출할 때 /search?q=&gwanCode= 으로 보냅니다 */
  gwanCode?: SearchGwan;
  /** 시안 search(blue) — 파랑 테두리 */
  blue?: boolean;
  /** 처음 칸에 넣어 둘 말(검색 결과 화면에서 q) */
  defaultValue?: string;
  placeholder?: string;
  /** 왼쪽 「전체 ⌄」 글자 */
  catLabel?: string;
  /** 시안 search(.., promo) 의 오른쪽 홍보 칸 — 넣으면 .srow 로 나란히 */
  aside?: React.ReactNode;
  className?: string;
}

export function SearchBox({
  variant = 'gwan', gwanCode, blue, defaultValue = '',
  placeholder = '상품, 서비스, 업체, 창업아이템을 검색하세요', catLabel = '전체', aside, className,
}: SearchBoxProps) {
  const [open, setOpen] = useState(false);
  const h = useTranslations('header');   // v10.95 — 머리줄 돋보기 이름만(관 화면 검색칸은 2-2)
  const [seed, setSeed] = useState('');
  const [val, setVal] = useState(defaultValue);

  const openWith = (v: string) => { setSeed(v); setOpen(true); };

  const popup = open && (
    <SearchPopup seed={seed} gwanCode={gwanCode} onClose={() => setOpen(false)} />
  );

  /* 머리줄 — 시안의 일반 머리줄에는 검색칸이 없습니다. 개발에 있던 머리줄 검색은 돋보기 단추로 남겨 같은 팝업을 엽니다. */
  if (variant === 'header') {
    return (
      <>
        <button type="button" className="pc-hsch" aria-label={h('search')} title={h('search')} onClick={() => openWith('')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
        </button>
        {popup}
      </>
    );
  }

  const form = (
    <form
      className={`pc-sb${blue ? ' blue' : ''}`}
      role="search" action="/search" noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const q = val.trim();
        openWith(q);   /* v10.40 — 결과는 팝업에서(대표 지시 2026-10-14 · 결과 화면으로 가지 않음) */
      }}
    >
      <span className="sc">{catLabel} ⌄</span>
      <input
        className="si" name="q" type="search" autoComplete="off" placeholder={placeholder}
        aria-label="검색어" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-haspopup="dialog"
        value={val}
        onChange={(e) => {
          /* 새어 들어온 글자 — 뒤 칸은 비우고 팝업으로 옮깁니다(시안 그대로) */
          const typed = e.target.value;
          setVal('');
          if (!open) openWith(typed);
        }}
        onMouseDown={(e) => { if (!open) { e.preventDefault(); openWith(val); } }}
        onFocus={(e) => { if (!open) { e.currentTarget.blur(); openWith(val); } }}
      />
      {gwanCode && <input type="hidden" name="gwanCode" value={gwanCode} />}
      <button className="sg" type="submit" aria-label="검색">🔍</button>
    </form>
  );

  return (
    <>
      <div className={`pc-srow${aside ? '' : ' nop'}${variant === 'top' ? ' top' : ''}${className ? ' ' + className : ''}`}>
        <div className="scol">{form}</div>
        {aside}
      </div>
      {popup}
    </>
  );
}
