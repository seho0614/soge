/**
 * 소개광장의 공통 조각 — 2026-10-07 제시 디자인(docs/design/plaza_design_20261007.png) · v10.23.
 *
 *   PlazaHero   사진 띠. 목록은 큰 띠(제목 · 한 줄 설명 · 게시글 검색 · 확성기 안내), 하위 화면은 낮은 띠(제목만).
 *   PlazaTabs   알약 탭 6개 — 전체 · 소개 후기 · 업종 이야기 · 질문 · 공지 · 이건 어때? 투표.
 *   BoardBadge  분류 배지(디자인의 세 색 + 공지).
 *   Pager       쪽 번호 — ‹ 1 2 3 4 5 … 124 ›.
 *
 * 그림과 다르게 넣은 것(비교표 2-1 에서 말씀드린 대로):
 *   · 「이건 어때? 투표」 탭 — 그림에는 없지만 10/2 결정(D021)으로 소개광장 안에 둔 화면이라 여섯째 알약으로 남겼습니다.
 *   · 표 머리 — 그림은 「작성일」이 두 번입니다. 첫째는 내용이 「김OO」라 「작성자」로 넣었습니다.
 *
 * 사진: 확성기와 오른쪽 사진은 받은 그림에서 **그 자리만 그대로 잘라 낸 PNG** 입니다(public/b2 · qa/cut_b2.py).
 *   ★ 띠 사진은 임시입니다 — 받은 그림은 제목 · 검색 칸이 사진 위에 박혀 있어, 글자가 없는 오른쪽 부분만 잘라 넣었습니다.
 *     「글자 없는 원본 사진」을 주시면(10/7 답 ③) public/b2/plaza-photo.png 로 넣고 PHOTO 한 줄만 바꾸면 됩니다.
 */
import Link from 'next/link';
import { BOARD } from './types';

/** 띠 사진 — [파일, 원래 가로, 원래 세로, 띠 전체를 덮는 사진인가] */
const PHOTO: [string, number, number, boolean] = ['/b2/plaza-photo-right.png', 1600, 1212, false];

export const PLAZA_TABS = [
  { v: '',       t: '전체' },
  { v: 'REVIEW', t: '소개 후기' },
  { v: 'TRADE',  t: '업종 이야기' },
  { v: 'QNA',    t: '질문' },
  { v: 'NOTICE', t: '공지' },
] as const;

/** 목록 주소 — 값이 있는 것만 싣습니다(1쪽 · 빈 검색어는 뺍니다). */
export function plazaHref(o: { board?: string; q?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (o.board) qs.set('board', o.board);
  if (o.q) qs.set('q', o.q);
  if (o.page && o.page > 1) qs.set('page', String(o.page));
  const s = qs.toString();
  return s ? `/community?${s}` : '/community';
}

/** 날짜 — 그림의 「2026.09.15」 꼴. 한국 시각 기준입니다(서버 시각대와 무관). */
export function dot(iso?: string | null) {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}.${g('month')}.${g('day')}`;
}

export function BoardBadge({ board }: { board?: string | null }) {
  const b = board ?? '';
  return <span className={`plz-bd plz-bd-${b.toLowerCase() || 'etc'}`}>{BOARD[b] ?? b}</span>;
}

function Photo() {
  const [src, w, h, full] = PHOTO;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={'plz-photo' + (full ? ' full' : '')} src={src} width={w} height={h} alt="" aria-hidden />;
}

export function PlazaHero({ small, q, board }: { small?: boolean; q?: string; board?: string }) {
  if (small) {
    return (
      <section className="plz-hero sm" aria-label="소개광장">
        <Photo />
        <div className="plz-in">
          <p className="plz-h"><Link href="/community">소개광장</Link></p>
          <p className="plz-lead">소개 후기와 업종 이야기가 모이는 자리입니다.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="plz-hero">
      <Photo />
      <div className="plz-in">
        <h1>소개광장</h1>
        <p className="plz-lead">소개 후기와 업종 이야기가 모이는 자리입니다.</p>
        <form className="plz-find" action="/community" method="get" role="search">
          {board && <input type="hidden" name="board" value={board} />}
          <input name="q" defaultValue={q ?? ''} maxLength={50} placeholder="게시글을 검색해보세요." aria-label="게시글 검색" autoComplete="off" />
          <button type="submit" aria-label="검색">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
          </button>
        </form>
        <div className="plz-say">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="plz-mega" src="/b2/megaphone.png" width={415} height={370} alt="" aria-hidden />
          <div className="plz-note">
            <b>누구나 쓰실 수 있습니다.</b>
            <span>다만, 첫 글은 확인 후 올라갑니다 - 보통 하루 안에 끝납니다.</span>
            <span>소개 후기는 성사된 거래가 있어야 쓰실 수 있습니다.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 알약 탭 — cur: 게시판 코드('' = 전체) 또는 'polls'. 검색어가 있으면 글 탭 다섯 개가 그것을 잃지 않습니다. */
export function PlazaTabs({ cur, q }: { cur: string; q?: string }) {
  return (
    <nav className="plz-tabs" aria-label="게시판">
      {PLAZA_TABS.map((t) => (
        <Link key={t.v || 'all'} href={plazaHref({ board: t.v, q })} aria-current={cur === t.v ? 'page' : undefined}>{t.t}</Link>
      ))}
      {/* 10/2 (D021) — 「이건 어때?」 투표는 글 게시판이 아니라 따로 있는 화면입니다(SB-HOM-CMU-040) */}
      <Link href="/community/polls" aria-current={cur === 'polls' ? 'page' : undefined} data-polls-tab>이건 어때? 투표</Link>
    </nav>
  );
}

/** 쪽 번호 — 7쪽까지는 전부, 그보다 많으면 지금 쪽 둘레 다섯 개 + 처음 · 끝. */
export function Pager({ page, pages, hrefOf }: { page: number; pages: number; hrefOf: (p: number) => string }) {
  if (pages < 1) return null;
  const nums: (number | 'gap')[] = [];
  if (pages <= 7) { for (let i = 1; i <= pages; i++) nums.push(i); }
  else {
    const start = Math.max(1, Math.min(page - 2, pages - 4));
    if (start > 1) { nums.push(1); if (start > 2) nums.push('gap'); }
    for (let i = start; i <= start + 4; i++) nums.push(i);
    if (start + 4 < pages) { if (start + 4 < pages - 1) nums.push('gap'); nums.push(pages); }
  }
  const Arrow = ({ to, label, ch }: { to: number; label: string; ch: string }) =>
    to >= 1 && to <= pages && to !== page
      ? <Link href={hrefOf(to)} aria-label={label} rel={to < page ? 'prev' : 'next'}>{ch}</Link>
      : <span aria-label={label} aria-disabled="true">{ch}</span>;
  return (
    <nav className="plz-pager" aria-label="쪽 번호">
      <Arrow to={page - 1} label="이전 쪽" ch="‹" />
      {nums.map((n, i) => n === 'gap'
        ? <span key={`g${i}`} className="gap" aria-hidden>…</span>
        : n === page
          ? <span key={n} aria-current="page">{n}</span>
          : <Link key={n} href={hrefOf(n)}>{n}</Link>)}
      <Arrow to={page + 1} label="다음 쪽" ch="›" />
    </nav>
  );
}
