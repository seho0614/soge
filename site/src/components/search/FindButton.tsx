'use client';
/**
 * v10.40 — 머리줄 돋보기(소개광장 · 소개몰 머리줄 .b2-find)를 누르면 **검색 팝업**이 열립니다(시안 SPOP — 「머리줄 돋보기는 검색 팝업으로 엽니다」).
 * 전: 통합 검색 결과 화면(/search)으로 가는 링크. 대표 지시(2026-10-14) — 검색 결과는 팝업에서 보고, 누르면 그 자리로 갑니다.
 */
import { useState, type ReactNode } from 'react';
import { SearchPopup } from './SearchPopup';
import type { SearchGwan } from './SearchBox';

export function FindButton({ className, gwanCode, children }: { className: string; gwanCode?: SearchGwan; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-label="검색" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <SearchPopup seed="" gwanCode={gwanCode} onClose={() => setOpen(false)} />}
    </>
  );
}
