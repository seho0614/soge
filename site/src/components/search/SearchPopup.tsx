'use client';
/**
 * v10.29 — 시안 검색 팝업(proto_lite.html 의 SPOP) 그대로 + 실제 서버 자료.
 *
 *   머리   돋보기 · 입력칸(「무엇을 찾으십니까 — 예) 10평 이내 상가 급매」) · ESC
 *   몸     ① 「이렇게 찾습니다」(6글자 이상 문장 — 시안 sugMatch 의 문장 읽기 줄, 브라우저 규칙 · AI 라 쓰지 않음)
 *          ② 추천 검색어 칩(시안 sugg — 인기 검색어 · 업종 · 등록 제목. 제한업종은 서버가 이미 뺌)
 *          ③ 관별로 묶은 결과 — 요청(관마다) · 인기 매물 · 소개자 (시안 find 의 순서 · 관마다 4건)
 *   바닥   ↑↓ 이동 · Enter 열기 · ESC 닫기
 *
 * 동작: ↑↓ 로 고르고 Enter 로 엶 · 누르면 상세로 바로 이동 · ESC / 어두운 바깥을 누르면 닫힘.
 *       고른 줄 없이 Enter → 통합 검색 결과(/search?q=, SB-HOM-SRC-010). (시안은 팝업 입력칸이 form 밖이라 Enter 가 아무 일도
 *       하지 않았습니다 — 결함으로 기록하고 결과 화면으로 잇습니다.)
 *
 * v10.40 (대표 지시 2026-10-14 「이전에 검색 기능을 개발에 반영」) — 시안 SPOP(spec/proto.html · var SPOP) 그대로 맞췄습니다:
 *   · 찾기 = 시안 srcToks · srcScore — 친 말 전체(10점) + 네 글자 이상이면 문장에서 뽑은 낱말(sugWords · 1점씩).
 *     요청은 제목 · 업종 · 설명 · 지역, 매물은 제목 · 업종 · 지역에서 찾습니다(전: 제목만 — 「렌탈」처럼 업종 이름으로 친 말이 빠짐).
 *   · 묶음 = 시안 find — 관별 요청(소개장터 · 안심소개 · 소개창업 · 관마다 3건 · 「분류 · 지역」 · 「요청」) → 인기 매물(4건 · 「분류 · 지역」 · 가격)
 *     → 소개자(3건). 고르면 그 상세로 바로 갑니다.
 *   · 빈 칸에서 Enter → 「무엇을 소개받고 싶은지 적어 주세요.」(시안 그대로)
 *   ★ 대표 지시(2026-10-14) 「검색 결과 보기 링크 삭제 · 검색 결과는 팝업창에 보여 주고 클릭 시 위치로 간다」 — 시안과 다르게 한 곳 셋:
 *     ① 맨 아래 줄 「🔎 ‘…’ 통합 검색 결과 보기」를 두지 않습니다(결과 화면으로 가는 링크).
 *     ② 고른 줄 없이 Enter → 결과 화면이 아니라 **맨 위 결과의 자리로** 갑니다. 결과가 없으면 팝업 그대로.
 *     ③ 「이렇게 찾습니다」(문장 읽기)는 읽은 내용을 보여 주기만 합니다(결과 화면으로 가지 않음).
 *     그래서 빈 결과 문구 · 바닥 글에서 「통합 검색」 말을 뺐습니다. 시안 파일(spec/proto.html)은 고치지 않습니다(대표 지시).
 *   · 줄 고르기는 시안처럼 ↑↓ 로만 합니다(마우스를 올리는 것은 색만 바뀜 — 전: 마우스가 지나간 줄이 골라져 Enter 가 엉뚱한 줄로 감).
 *
 * 자료(모두 읽기 전용 · 로그인 없이 · 쿠키를 싣지 않음 — INV-SCH1):
 *   GET /api/v1/search?q=           요청 · 매물(두 글자부터 — 서버 규칙 QUERY_TOO_SHORT)
 *   GET /api/v1/search/suggest?q=   추천 검색어 · 업종 · 소개자(이름 첫 글자만)
 *   GET /api/v1/gwans               관 이름(정본)
 *   (v10.31) GET /api/v1/health/products?keyword=   상품 탭(소개몰 상품) · GET /api/v1/community/board?q=   동네정보 탭(소개광장 글)
 *   (v10.31) POST /api/v1/search/log  검색을 **제출하거나 줄을 골랐을 때만** 검색어 집계(search_term_stats)를 쌓습니다 — 추천 검색어의 재료.
 *
 * v10.31 — 메인 히어로의 탭 7개(시안 MHX_TABS)가 결과를 거릅니다(scope). 시안은 고른 탭을 form 의 data-scope 에 적어 두기만 했습니다 —
 *   시안이 뜻한 동작대로 범위를 나눕니다(무엇이 어디로 가는지는 SCOPES 표 · 결정 기록 w1_decisions.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { GWAN_PATH, ago, won } from '@/lib/format';
import { sugMatch, sugWords, type SugItem } from './sug';
import type { SearchGwan } from './SearchBox';

interface HitListing {
  id: string; gwanCode: string; categoryName: string | null; title: string; desiredFee: number | null;
  dealAmount?: number | null; viewCount?: number | null; region?: { sido?: string | null; sigungu?: string | null } | null;
}
interface HitRequest { id: string; gwanCode: string; title: string; createdAt: string | null; categoryName?: string | null; summary?: string | null; region?: string | null }
interface Intro { alias: string; grade: string; regions: string[]; categories: string[] }
interface Suggest { keywords: string[]; categories: string[]; introducers: Intro[] }
interface HitProduct { code: string; name: string; price: number; category: string | null; soldOut?: boolean }
interface HitPost { id: string; title: string; author: string; createdAt: string }
interface Row { t1: string; t2: string; rt: string; href: string }

/** 메인 히어로 탭(시안 MHX_TABS) — 결과를 거르는 범위 */
export type SearchScope = 'ai' | 'product' | 'service' | 'company' | 'biz' | 'town' | 'pro';
interface ScopeDef {
  label: string;
  /** 요청 · 매물을 볼 관(빈 배열이면 요청 · 매물을 보지 않음) */
  gwans: string[];
  intro: boolean; products: boolean; posts: boolean;
  /** 제출하면 갈 곳 */
  href: (q: string) => string;
}
export const SCOPES: Record<SearchScope, ScopeDef> = {
  ai: { label: 'AI 검색', gwans: ['MNY', 'MAL', 'BIZ', 'HLT'], intro: true, products: false, posts: false, href: (q) => searchHref(q) },
  product: { label: '상품', gwans: [], intro: false, products: true, posts: false, href: (q) => `/health/search?${new URLSearchParams({ q: q.trim() })}` },
  service: { label: '서비스', gwans: ['MNY'], intro: false, products: false, posts: false, href: (q) => searchHref(q, 'MNY') },
  company: { label: '업체', gwans: ['MAL'], intro: false, products: false, posts: false, href: (q) => searchHref(q, 'MAL') },
  biz: { label: '창업', gwans: ['BIZ'], intro: false, products: false, posts: false, href: (q) => searchHref(q, 'BIZ') },
  town: { label: '동네정보', gwans: [], intro: false, products: false, posts: true, href: (q) => `/search?${new URLSearchParams({ q: q.trim(), tab: 'CMU' })}` },
  pro: { label: '사람/전문가', gwans: ['MAL'], intro: true, products: false, posts: false, href: (q) => searchHref(q, 'MAL') },
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
interface Group { sec: string; items: Row[] }

/* 시안 srcToks — 친 말 전체 + (네 글자 이상이면) 문장에서 뽑은 낱말 */
function srcToks(q: string): string[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const ws = [t];
  if (t.length >= 4) sugWords(t).forEach((w0) => { const w = w0.toLowerCase(); if (w.length >= 2 && !ws.includes(w)) ws.push(w); });
  return ws;
}
/* 시안 srcScore — 전체가 맞으면 10점, 낱말 하나에 1점 */
function srcScore(ws: string[], s: string): number {
  const x = s.toLowerCase();
  return ws.reduce((n, w, i) => (w && x.includes(w) ? n + (i === 0 ? 10 : 1) : n), 0);
}
/* 시안 가격 표기 — 3,200만원 · 1억 2,000만원 */
function manwon(v: number): string {
  const m = Math.round(v / 10000);
  if (m <= 0) return won(v);
  const eok = Math.floor(m / 10000), rest = m % 10000;
  return eok ? `${eok}억${rest ? ` ${rest.toLocaleString('ko-KR')}만원` : '원'}` : `${rest.toLocaleString('ko-KR')}만원`;
}
const SRC_GN: Record<string, string> = { MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개몰' };

/* 관 이름 · 순서 — 서버(/gwans) 정본을 한 번만 받습니다. 시안 GW 순서(MNY · MAL · BIZ · HLT) */
const GW_ORDER = ['MNY', 'MAL', 'BIZ', 'HLT'];
let gwanCache: Record<string, string> | null = null;
const GRADE: Record<string, string> = {
  SEED: '새싹 소개자', VERIFIED: '인증 소개자', EXPERT: '전문 소개자', TOP: '우수 소개자', REGION_PARTNER: '지역 파트너',
};

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
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

export function SearchPopup({ seed, gwanCode, scope, onClose }: {
  seed: string; gwanCode?: SearchGwan; scope?: SearchScope; onClose: () => void;
}) {
  const sc = scope ? SCOPES[scope] : null;
  const router = useRouter();
  const [q, setQ] = useState(seed);
  const [hot, setHot] = useState(-1);
  const [gn, setGn] = useState<Record<string, string>>(gwanCache ?? {});
  const [sug, setSug] = useState<Suggest>({ keywords: [], categories: [], introducers: [] });
  const [hit, setHit] = useState<{ q: string; listings: HitListing[]; requests: HitRequest[]; products: HitProduct[]; posts: HitPost[] }>(
    { q: '', listings: [], requests: [], products: [], posts: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  /* 관 이름 */
  useEffect(() => {
    if (gwanCache) return;
    const ac = new AbortController();
    getJson<Array<{ code: string; name: string }>>('/api/v1/gwans', ac.signal).then((g) => {
      if (!g) return;
      gwanCache = Object.fromEntries(g.map((x) => [x.code, x.name]));
      setGn(gwanCache);
    });
    return () => ac.abort();
  }, []);

  /* 입력할 때마다 — 잠깐 쉬었다가(180ms) 부릅니다. 앞 요청은 취소 */
  useEffect(() => {
    const t = q.trim();
    const ac = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      const wantMain = !sc || sc.gwans.length > 0;
      /* 시안 find 의 낱말(전체 + 문장에서 뽑은 낱말 · 두 글자 이상) — 낱말마다 요청 · 매물을 받아 아래에서 시안 점수로 고릅니다 */
      const toks = srcToks(t).filter((w) => w.length >= 2).slice(0, 4);
      const many = <T,>(mk: (w: string) => Promise<T | null>) => Promise.all(toks.map(mk));
      const [s, rqs, lss, pr, po] = await Promise.all([
        getJson<Suggest>(`/api/v1/search/suggest?q=${encodeURIComponent(t)}`, ac.signal),
        wantMain && toks.length
          ? many((w) => getJson<HitRequest[]>(`/api/v1/requests?${new URLSearchParams({ q: w.slice(0, 50), limit: '30' })}`, ac.signal))
          : Promise.resolve([] as Array<HitRequest[] | null>),
        wantMain && toks.length
          ? many((w) => getJson<{ organic: HitListing[] }>(`/api/v1/listings?${new URLSearchParams({ keyword: w.slice(0, 50), match: 'TITLE', limit: '30' })}`, ac.signal))
          : Promise.resolve([] as Array<{ organic: HitListing[] } | null>),
        sc?.products && t
          ? getJson<HitProduct[]>(`/api/v1/health/products?keyword=${encodeURIComponent(t.slice(0, 50))}`, ac.signal)
          : Promise.resolve(null),
        sc?.posts && t
          ? getJson<{ items: HitPost[] }>(`/api/v1/community/board?${new URLSearchParams({ q: t.slice(0, 50), size: '4' })}`, ac.signal)
          : Promise.resolve(null),
      ]);
      if (ac.signal.aborted) return;
      setSug(s ?? { keywords: [], categories: [], introducers: [] });
      const inScope = (g: string) => !sc || sc.gwans.includes(g);
      const uniq = <X extends { id: string }>(a: X[]) => a.filter((x, n) => a.findIndex((y) => y.id === x.id) === n);
      setHit({
        q: t,
        listings: uniq(lss.flatMap((x) => x?.organic ?? [])).filter((x) => inScope(x.gwanCode)),
        requests: uniq(rqs.flatMap((x) => (Array.isArray(x) ? x : []))).filter((x) => inScope(x.gwanCode)),
        products: Array.isArray(pr) ? pr : [],
        posts: po?.items ?? [],
      });
      setLoading(false);
    }, t ? 180 : 0);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [q, sc]);

  useEffect(() => { setHot(-1); }, [q, hit]);
  useEffect(() => { const id = setTimeout(() => inputRef.current?.focus(), 10); return () => clearTimeout(id); }, []);

  /* 시안 sugPool — 인기(검색어) · 업종 · 등록(제목) */
  const pool: SugItem[] = useMemo(() => {
    const out: SugItem[] = [];
    sug.keywords.forEach((t) => out.push({ t, k: '인기' }));
    sug.categories.forEach((t) => out.push({ t, k: '업종' }));
    hit.listings.forEach((l) => out.push({ t: l.title, k: '등록' }));
    const seen: Record<string, 1> = {};
    return out.filter((x) => { if (!x.t || seen[x.t]) return false; seen[x.t] = 1; return true; });
  }, [sug, hit]);

  const t = q.trim();
  const matched = useMemo(() => sugMatch(t, pool), [t, pool]);
  /* 「이렇게 찾습니다」는 매물 · 요청을 보는 범위에서만(상품 · 동네정보 탭은 문장 결과 화면이 따로 없음) */
  const readRow = !sc || sc.gwans.length ? matched.find((x) => x.isQ) : undefined;
  /* 추천 검색어 칩 — 비어 있으면 인기 · 업종 앞 6개, 치면 맞는 것 5개(시안 sugg) */
  const chips = useMemo(() => {
    if (!t) return (sug.keywords.length ? sug.keywords : sug.categories).slice(0, 6);
    return matched.filter((x) => !x.isQ && x.k !== '등록').map((x) => x.t).slice(0, 5);
  }, [t, sug, matched]);

  /* 시안 find — 요청(관별) → 인기 매물 → 소개자. 관 화면에서 열었으면 그 관을 먼저 */
  const groups: Group[] = useMemo(() => {
    if (!t || hit.q !== t) return [];
    const order = (gwanCode ? [gwanCode, ...GW_ORDER.filter((g) => g !== gwanCode)] : GW_ORDER)
      .filter((g) => !sc || sc.gwans.includes(g));
    const out: Group[] = [];
    const ws = srcToks(t);
    /* ① 요청 — 관별(시안: 소개장터 · 안심소개 · 소개창업) · 관마다 점수 높은 3건 · 「분류 · 지역」 */
    order.filter((g) => g !== 'HLT').forEach((g) => {
      const items = hit.requests.filter((r) => r.gwanCode === g)
        .map((r) => ({ r, s: srcScore(ws, [r.title, r.categoryName, r.summary, r.region].filter(Boolean).join(' ')) }))
        .filter((h) => h.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
      if (items.length) out.push({
        sec: `${SRC_GN[g] ?? gn[g] ?? g} 요청`,
        items: items.map(({ r }) => ({
          t1: r.title, t2: [r.categoryName ?? '', r.region ?? ''].join(' · '), rt: '요청', href: `/request/${r.id}`,
        })),
      });
    });
    /* ② 인기 매물 — 점수 → 조회수 순 4건 · 「분류 · 지역」 · 가격 */
    const reg = (l: HitListing) => [l.region?.sido, l.region?.sigungu].filter(Boolean).join(' ');
    const seenT: Record<string, 1> = {};
    const ls = hit.listings
      .map((l) => ({ l, s: srcScore(ws, [l.title, l.categoryName, reg(l)].filter(Boolean).join(' ')) }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s || Number(b.l.viewCount ?? 0) - Number(a.l.viewCount ?? 0)
        || (gwanCode ? Number(b.l.gwanCode === gwanCode) - Number(a.l.gwanCode === gwanCode) : 0))
      .filter((h) => { if (seenT[h.l.title]) return false; seenT[h.l.title] = 1; return true; })
      .slice(0, 4).map((h) => h.l);
    if (ls.length) out.push({
      sec: '인기 매물',
      items: ls.map((l) => ({
        t1: l.title, t2: [l.categoryName ?? '', reg(l)].join(' · '),
        rt: l.dealAmount ? manwon(Number(l.dealAmount)) : l.desiredFee != null ? `소개비 ${won(l.desiredFee)}` : '',
        href: `/${GWAN_PATH[l.gwanCode] ?? 'money'}/${l.id}`,
      })),
    });
    if (hit.products.length) out.push({
      sec: '소개몰 상품',
      items: hit.products.slice(0, 4).map((p) => ({
        t1: p.name, t2: [p.category, p.soldOut ? '품절' : ''].filter(Boolean).join(' · '),
        rt: won(p.price), href: `/health/p/${encodeURIComponent(p.code)}`,
      })),
    });
    if (hit.posts.length) out.push({
      sec: '소개광장 글',
      items: hit.posts.slice(0, 4).map((p) => ({
        t1: p.title, t2: [p.author, ago(p.createdAt)].filter(Boolean).join(' · '), rt: '소개광장', href: `/community/${p.id}`,
      })),
    });
    if ((!sc || sc.intro) && sug.introducers.length) out.push({
      sec: '소개자',
      items: sug.introducers.slice(0, 3).map((r) => ({
        t1: r.alias, t2: [GRADE[r.grade] ?? r.grade, r.regions.join(', '), r.categories.join(', ')].filter(Boolean).join(' · '),
        rt: '소개자', href: '/request',
      })),
    });
    return out;
  }, [t, hit, sug, gn, gwanCode, sc]);

  /* 고를 수 있는 줄 — 결과 줄만(대표 지시 2026-10-14: 「통합 검색 결과 보기」 줄 없음 · 「이렇게 찾습니다」는 보여 주기만) */
  const rows: Row[] = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const go = useCallback((href: string) => { logSearch(t); onClose(); router.push(href); }, [t, onClose, router]);
  const [need, setNeed] = useState(false);
  useEffect(() => { if (t) setNeed(false); }, [t]);
  /* 고른 줄 없이 Enter: 맨 위 결과의 자리로(대표 지시 — 결과 화면으로 가지 않음) · 결과가 없으면 그대로 · 빈 칸이면 「무엇을 소개받고 싶은지 적어 주세요.」(시안) */
  const submit = useCallback(() => { if (!t) { setNeed(true); return; } if (rows[0]) go(rows[0].href); }, [t, rows, go]);

  /* 키보드 — ESC 닫기 · ↑↓ 이동 · Enter 열기(고른 줄이 없으면 맨 위 결과) */
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); onClose(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!rows.length) return;
        setHot((h) => {
          let n = h + (ev.key === 'ArrowDown' ? 1 : -1);
          if (n < 0) n = rows.length - 1;
          if (n >= rows.length) n = 0;
          return n;
        });
        return;
      }
      if (ev.key === 'Enter' && !ev.isComposing) {
        /* 칩 · ESC 단추에 초점이 있으면 그 단추가 받습니다 */
        if (hot < 0 && ev.target !== inputRef.current) return;
        ev.preventDefault();
        if (hot >= 0 && rows[hot]) go(rows[hot].href); else submit();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [rows, hot, go, submit, onClose]);

  useEffect(() => {
    if (hot < 0) return;
    bodyRef.current?.querySelector<HTMLElement>(`[data-i="${hot}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hot]);

  if (typeof document === 'undefined') return null;
  let i = 0;
  const empty = t && hit.q === t && !loading && !groups.length && !readRow;   /* 시안 — 결과도 문장 읽기도 없을 때 */

  return createPortal(
    <div className="pc-spop on" role="dialog" aria-modal="true" aria-label="검색" data-scope={scope ?? undefined}>
      <div className="dim" onClick={onClose} />
      <div className="box">
        <div className="hd">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef} id="spopq" type="search" autoComplete="off" value={q} maxLength={100}
            placeholder="무엇을 찾으십니까 — 예) 10평 이내 상가 급매" aria-label="검색어"
            role="combobox" aria-expanded={rows.length > 0} aria-controls="spopbd"
            aria-activedescendant={hot >= 0 ? `spop-it-${hot}` : undefined}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="esc" onClick={onClose} aria-label="닫기">ESC</button>
        </div>
        <div className="bd" id="spopbd" ref={bodyRef} role="listbox">
          {readRow && (
            <div className="it sgq" data-spop-read="" style={{ cursor: 'default' }}>
              <span className="sgqh"><span className="si2" aria-hidden="true">✨</span>
                <span className="st3">{readRow.t}</span><span className="sk">{readRow.k}</span></span>
              {(readRow.parse?.length || readRow.words?.length) ? (
                <span className="sgqb">
                  {readRow.parse?.map((c, n) => <span key={'c' + n} className="sgc"><i>{c.k}</i>{c.v}</span>)}
                  {readRow.words?.map((w, n) => <span key={'w' + n} className="sgw">{w}</span>)}
                </span>
              ) : null}
            </div>
          )}
          {chips.length > 0 && (
            <>
              <div className="sec">추천 검색어</div>
              <div className="chips">
                {chips.map((c) => (
                  <button key={c} type="button" className="chip" data-sq={c}
                    onClick={() => { setQ(c); inputRef.current?.focus(); }}>{c}</button>
                ))}
              </div>
            </>
          )}
          {need && !t && <div className="empty need" role="alert">무엇을 소개받고 싶은지 적어 주세요.</div>}
          {empty && (
            <div className="empty">찾으시는 것이 없습니다.<br />
              <span style={{ fontSize: '12px' }}>다른 말로 해 보시거나 위 추천 검색어를 눌러 보십시오.</span>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.sec}>
              <div className="sec">{g.sec}<span className="cnt">{g.items.length}</span></div>
              {g.items.map((it) => {
                const n = i++;
                return (
                  <button key={it.href + n} type="button" id={`spop-it-${n}`} data-i={n} role="option" aria-selected={hot === n}
                    className={`it${hot === n ? ' hot' : ''}`} onClick={() => go(it.href)}>
                    <span className="tt"><span className="t1">{it.t1}</span><span className="t2">{it.t2}</span></span>
                    <span className="rt">{it.rt}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="ft"><span>↑↓ 이동</span><span>Enter 열기 · 고른 줄이 없으면 맨 위 결과</span><span>ESC 닫기</span>
          {sc && scope !== 'ai' && <span className="scp">범위 · {sc.label}</span>}</div>
      </div>
    </div>,
    document.body,
  );
}
