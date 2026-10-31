import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { getTranslations } from 'next-intl/server';
import { isBoard, type PostRow } from '@/components/community/types';
import { BoardBadge, Pager, PlazaHero, PlazaTabs, PLAZA_TABS, dot, plazaHref } from '@/components/community/Plaza';
import { TownBadge, TownVerify } from '@/components/community/TownVerify';
import { me } from '@/lib/session';
import '@/styles/plaza.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('hero.name') };
}

interface Board { items: PostRow[]; total: number; page: number; size: number; pages: number }

/**
 * SB-HOM-CMU-010 소개광장 목록 — GET /community/board?board=&q=&page= (v10.23 · 2026-10-07 제시 디자인)
 *
 * 사진 띠(제목 · 게시글 검색 · 안내) → 알약 탭 → 표(분류 배지) → 쪽 번호 · 글쓰기.
 * 검색어 · 게시판 · 쪽 번호는 모두 주소에 실립니다 — 새로 고쳐도, 주소를 보내도 같은 화면입니다.
 *
 * ★ apiGetPersonal 입니다. 검수 대기 글은 **작성자 본인에게만** 보여서(서버 pendingMine)
 *   사람마다 응답이 다릅니다 — 캐시하면 남의 대기 글이 보이거나 내 글이 "사라집니다".
 * ★ 작성자는 서버가 첫 글자만 내려줍니다(김OO · G-146). 화면에서 가리는 것이 아닙니다.
 * 비로그인도 봅니다. 글쓰기만 로그인이 필요합니다.
 */
export default async function CommunityPage({ searchParams }: {
  searchParams: Promise<{ board?: string | string[]; q?: string | string[]; page?: string | string[]; deleted?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations('plaza');
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? '';
  const cur = PLAZA_TABS.some((t) => t.v === one(sp.board)) ? one(sp.board) : '';
  const q = one(sp.q).trim().replace(/\s+/g, ' ');
  const pageIn = /^\d{1,9}$/.test(one(sp.page)) ? Number(one(sp.page)) : 1;
  const page = pageIn >= 1 ? pageIn : 1;

  const qs = new URLSearchParams({ page: String(page) });
  if (cur) qs.set('board', cur);
  if (q) qs.set('q', q);
  let err: string | null = null;
  const b = await apiGetPersonal<Board>(`/community/board?${qs}`).catch((e) => {
    err = e instanceof ApiFailure && e.status === 400 ? e.body.message : t('list.loadFail');
    return null;
  });
  const rows = b?.items ?? [];
  const hrefOf = (p: number) => plazaHref({ board: cur, q, page: p });

  return (
    <><div className="plz">
      <PlazaHero q={q} board={cur} />
      <div className="plz-body">
        {sp.deleted && <p className="ok-note" role="status">{t('list.deleted')}</p>}
        <PlazaTabs cur={cur} q={q} />
        <TownVerify loggedIn={!!(await me())} />
        {q && b && (
          <p className="plz-found" role="status">
            {t.rich('list.found', { b: (c) => <b>{c}</b>, q, n: b.total.toLocaleString('ko-KR'), clear: (c) => <Link href={plazaHref({ board: cur })}>{c}</Link> })}
          </p>
        )}

        {err ? (
          <p className="plz-err form-error" role="alert">{err} <Link href="/community">{t('list.toAll')}</Link></p>
        ) : rows.length === 0 ? (
          <p className="plz-empty">
            {b && b.total > 0
              ? <>{t.rich('list.emptyPage', { page: String(page), first: (c) => <Link href={hrefOf(1)}>{c}</Link> })}</>
              : q
                ? <>{t.rich('list.emptySearch', { clear: (c) => <Link href={plazaHref({ board: cur })}>{c}</Link> })}</>
                : <>{cur ? t('list.emptyBoard', { board: isBoard(cur) ? t(`board.${cur}`) : cur }) : t('list.emptyAll')} {t('list.firstPost')}</>}
          </p>
        ) : (
          <div className="plz-tblw">
            <table className="plz-tbl">
              <thead><tr><th scope="col">{t('list.th.title')}</th><th scope="col">{t('list.th.board')}</th><th scope="col">{t('list.th.author')}</th><th scope="col">{t('list.th.date')}</th><th scope="col">{t('list.th.views')}</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.isPinned && <span className="plz-pin">{t('list.pinned')}</span>}
                      <Link href={`/community/${p.id}`}>{p.title}</Link>
                      {p.commentCount > 0 && <span className="plz-cc" aria-label={t('list.comments', { n: String(p.commentCount) })}>[{p.commentCount}]</span>}
                      {p.pendingMine && <span className="state state-suspended">{t('pendingMine')}</span>}
                    </td>
                    <td><BoardBadge board={p.board} /></td>
                    <td>{p.author} <TownBadge town={p.authorTown} /></td>
                    <td>{dot(p.createdAt)}</td>
                    <td>{p.views.toLocaleString('ko-KR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="plz-foot">
          {b && b.pages > 0 && <Pager page={b.page} pages={b.pages} hrefOf={hrefOf} />}
          <Link className="plz-write cmu-write" href="/community/write">{t('list.write')}</Link>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
