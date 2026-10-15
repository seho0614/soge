'use client';
/**
 * 소개장터 메인 — 맨 위 검색칸. v10.30
 *
 * 모양은 2026-10-09 제시 디자인 그대로(styles/money.css 의 .mny-search)이고, 동작은 v10.29 의 공통 검색(components/search)과 같습니다 —
 *   칸을 누르거나(mousedown) Tab 으로 들어오거나(focus) 글자가 새어 들어오면(input) **검색 팝업**(SearchPopup · 추천 검색어 · 최근 검색어)을 열고,
 *   돋보기(제출)를 누르면 칸의 말로 통합 검색 결과(/search?q=…&gwanCode=MNY)로 갑니다. 칸이 비어 있으면 팝업을 엽니다.
 * 스크립트가 꺼져 있어도 <form action="/search"> 라 그대로 검색 결과로 갑니다.
 */
import { useState } from 'react';
import { SearchPopup } from '@/components/search/SearchPopup';
import { MnyPic } from './pics';

export function MoneySearch() {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState('');
  const [val, setVal] = useState('');
  const openWith = (v: string) => { setSeed(v); setOpen(true); };
  return (
    <>
      <form className="mny-search" role="search" action="/search" noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const q = val.trim();
          openWith(q);   /* v10.40 — 결과는 팝업에서(대표 지시 2026-10-14 · 결과 화면으로 가지 않음) */
        }}>
        <MnyPic name="spark" />
        <label className="mny-sr" htmlFor="mny-q">키워드 검색</label>
        <input id="mny-q" name="q" type="search" placeholder="키워드를 검색해보세요." autoComplete="off" maxLength={50}
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-haspopup="dialog"
          value={val}
          onChange={(e) => { const typed = e.target.value; setVal(''); if (!open) openWith(typed); }}
          onMouseDown={(e) => { if (!open) { e.preventDefault(); openWith(val); } }}
          onFocus={(e) => { if (!open) { e.currentTarget.blur(); openWith(val); } }} />
        <input type="hidden" name="gwanCode" value="MNY" />
        <button type="submit" aria-label="검색">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden><circle cx="10.6" cy="10.6" r="7" /><path d="m16 16 4.6 4.6" /></svg>
        </button>
      </form>
      {open && <SearchPopup seed={seed} gwanCode="MNY" onClose={() => setOpen(false)} />}
    </>
  );
}
