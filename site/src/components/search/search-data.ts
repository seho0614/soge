import { won } from '@/lib/format';
import { sugWords } from './sug';

/**
 * 검색 팝업(SearchPopup)의 자료 형식 · 범위 표(SCOPES) · 순수 도우미(시안 srcToks · srcScore · 가격 표기) · 서버 부르기.
 * v10.86 — SearchPopup.tsx 에서 나눔(동작 같음). 화면 · 상태는 SearchPopup.tsx 에 그대로 있습니다.
 */
export interface HitListing {
  id: string; gwanCode: string; categoryName: string | null; title: string; desiredFee: number | null;
  dealAmount?: number | null; viewCount?: number | null; region?: { sido?: string | null; sigungu?: string | null } | null;
}

export interface HitRequest { id: string; gwanCode: string; title: string; createdAt: string | null; categoryName?: string | null; summary?: string | null; region?: string | null }

interface Intro { alias: string; grade: string; regions: string[]; categories: string[] }

export interface Suggest { keywords: string[]; categories: string[]; introducers: Intro[] }

export interface HitProduct { code: string; name: string; price: number; category: string | null; soldOut?: boolean }

export interface HitPost { id: string; title: string; author: string; createdAt: string }

export interface Row { t1: string; t2: string; rt: string; href: string }

/** 메인 히어로 탭(시안 MHX_TABS) — 결과를 거르는 범위 */
export type SearchScope = 'ai' | 'product' | 'service' | 'company' | 'biz' | 'town' | 'pro';

interface ScopeDef {
  /** 사전 키(searchPop.scope.*) — v10.97 */
  label: `scope.${SearchScope}`;
  /** 요청 · 매물을 볼 관(빈 배열이면 요청 · 매물을 보지 않음) */
  gwans: string[];
  intro: boolean; products: boolean; posts: boolean;
  /** 제출하면 갈 곳 */
  href: (q: string) => string;
}

export const SCOPES: Record<SearchScope, ScopeDef> = {
  ai: { label: 'scope.ai', gwans: ['MNY', 'MAL', 'BIZ', 'HLT'], intro: true, products: false, posts: false, href: (q) => searchHref(q) },
  product: { label: 'scope.product', gwans: [], intro: false, products: true, posts: false, href: (q) => `/health/search?${new URLSearchParams({ q: q.trim() })}` },
  service: { label: 'scope.service', gwans: ['MNY'], intro: false, products: false, posts: false, href: (q) => searchHref(q, 'MNY') },
  company: { label: 'scope.company', gwans: ['MAL'], intro: false, products: false, posts: false, href: (q) => searchHref(q, 'MAL') },
  biz: { label: 'scope.biz', gwans: ['BIZ'], intro: false, products: false, posts: false, href: (q) => searchHref(q, 'BIZ') },
  town: { label: 'scope.town', gwans: [], intro: false, products: false, posts: true, href: (q) => `/search?${new URLSearchParams({ q: q.trim(), tab: 'CMU' })}` },
  pro: { label: 'scope.pro', gwans: ['MAL'], intro: true, products: false, posts: false, href: (q) => searchHref(q, 'MAL') },
};

/** 검색어 집계 — 제출 · 고를 때만(글자마다 부르지 않음). 쿠키 없이 · 실패해도 화면은 그대로 */
export function logSearch(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  try {
    void fetch('/api/v1/search/log', {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: t.slice(0, 100) }),
    }).catch(() => undefined);
  } catch { /* 무시 */ }
}

export interface Group { sec: string; items: Row[] }

/* 시안 srcToks — 친 말 전체 + (네 글자 이상이면) 문장에서 뽑은 낱말 */
export function srcToks(q: string): string[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const ws = [t];
  if (t.length >= 4) sugWords(t).forEach((w0) => { const w = w0.toLowerCase(); if (w.length >= 2 && !ws.includes(w)) ws.push(w); });
  return ws;
}

/* 시안 srcScore — 전체가 맞으면 10점, 낱말 하나에 1점 */
export function srcScore(ws: string[], s: string): number {
  const x = s.toLowerCase();
  return ws.reduce((n, w, i) => (w && x.includes(w) ? n + (i === 0 ? 10 : 1) : n), 0);
}

/* 시안 가격 표기 — 3,200만원 · 1억 2,000만원 */
export function manwon(v: number): string {
  const m = Math.round(v / 10000);
  if (m <= 0) return won(v);
  const eok = Math.floor(m / 10000), rest = m % 10000;
  return eok ? `${eok}억${rest ? ` ${rest.toLocaleString('ko-KR')}만원` : '원'}` : `${rest.toLocaleString('ko-KR')}만원`;
}

/* v10.97 — 사전 키(searchPop.gwan.*) */
export const SRC_GN: Record<string, 'gwan.MNY' | 'gwan.MAL' | 'gwan.BIZ' | 'gwan.HLT'> = { MNY: 'gwan.MNY', MAL: 'gwan.MAL', BIZ: 'gwan.BIZ', HLT: 'gwan.HLT' };

/* 관 이름 · 순서 — 서버(/gwans) 정본을 한 번만 받습니다. 시안 GW 순서(MNY · MAL · BIZ · HLT) */
export const GW_ORDER = ['MNY', 'MAL', 'BIZ', 'HLT'];

/* v10.97 — 사전 키(searchPop.grade.*) */
export const GRADE: Record<string, 'grade.SEED' | 'grade.VERIFIED' | 'grade.EXPERT' | 'grade.TOP' | 'grade.REGION_PARTNER'> = {
  SEED: 'grade.SEED', VERIFIED: 'grade.VERIFIED', EXPERT: 'grade.EXPERT', TOP: 'grade.TOP', REGION_PARTNER: 'grade.REGION_PARTNER',
};

export async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const r = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

export function searchHref(q: string, gwanCode?: string) {
  const qs = new URLSearchParams({ q: q.trim() });
  if (gwanCode) qs.set('gwanCode', gwanCode);
  return `/search?${qs}`;
}
