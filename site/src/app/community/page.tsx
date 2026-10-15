import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { BOARD, type PostRow } from '@/components/community/types';
import { BoardBadge, Pager, PlazaHero, PlazaTabs, PLAZA_TABS, dot, plazaHref } from '@/components/community/Plaza';
import '@/styles/plaza.css';

export const metadata: Metadata = { title: '소개광장' };

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
    err = e instanceof ApiFailure && e.status === 400 ? e.body.message : '글 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.';
    return null;
  });
  const rows = b?.items ?? [];
  const hrefOf = (p: number) => plazaHref({ board: cur, q, page: p });

  return (
    <><div className="plz">
      <PlazaHero q={q} board={cur} />
      <div className="plz-body">
        {sp.deleted && <p className="ok-note" role="status">글을 지웠습니다. 달린 댓글은 남습니다.</p>}
        <PlazaTabs cur={cur} q={q} />
        {q && b && (
          <p className="plz-found" role="status">
            <b>「{q}」</b> 검색 결과 {b.total.toLocaleString('ko-KR')}건 <Link href={plazaHref({ board: cur })}>검색 지우기</Link>
          </p>
        )}

        {err ? (
          <p className="plz-err form-error" role="alert">{err} <Link href="/community">전체 목록으로</Link></p>
        ) : rows.length === 0 ? (
          <p className="plz-empty">
            {b && b.total > 0
              ? <>{page}쪽에는 글이 없습니다. <Link href={hrefOf(1)}>1쪽으로</Link></>
              : q
                ? <>찾으시는 글이 없습니다. 낱말을 줄이거나 <Link href={plazaHref({ board: cur })}>검색을 지워</Link> 보십시오.</>
                : <>{cur ? `${BOARD[cur]} 게시판에 아직 글이 없습니다.` : '아직 올라온 글이 없습니다.'} 첫 글을 남겨 보십시오.</>}
          </p>
        ) : (
          <div className="plz-tblw">
            <table className="plz-tbl">
              <thead><tr><th scope="col">제목</th><th scope="col">분류</th><th scope="col">작성자</th><th scope="col">작성일</th><th scope="col">조회</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.isPinned && <span className="plz-pin">고정</span>}
                      <Link href={`/community/${p.id}`}>{p.title}</Link>
                      {p.commentCount > 0 && <span className="plz-cc" aria-label={`댓글 ${p.commentCount}개`}>[{p.commentCount}]</span>}
                      {p.pendingMine && <span className="state state-suspended">검수 중 · 나만 보임</span>}
                    </td>
                    <td><BoardBadge board={p.board} /></td>
                    <td>{p.author}</td>
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
          <Link className="plz-write cmu-write" href="/community/write">글쓰기</Link>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
