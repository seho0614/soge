import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { type PostDetail, type PostComment } from '@/components/community/types';
import { BoardBadge, PlazaHero, PlazaTabs, dot } from '@/components/community/Plaza';
import { CommentForm, ReplyToggle } from '@/components/community/CommentForm';
import { PostOwnerActions } from '@/components/community/PostOwnerActions';
import '@/styles/plaza.css';

export const metadata: Metadata = { title: '소개광장 글' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SB-HOM-CMU-020 글 상세 · 댓글
 *
 *   GET  /community/posts/{id}                 글 · 댓글 (조회수 +1)
 *   POST /me/community/posts/{id}/comments     댓글 · 대댓글(1단계)
 *
 * ★ 가려진 글은 자리를 남깁니다(서버 hidden) — 통째로 사라지면 같은 글을 다시 씁니다.
 * ★ 개인 응답입니다(mine · 검수 중 내 글) — apiGetPersonal.
 * v10.23 (2026-10-07 제시 디자인) — 낮은 사진 띠 · 알약 탭 · 남색 + 주황. 작성자는 서버가 첫 글자만 내려줍니다(김OO · G-146).
 */
export default async function CommunityPostPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { posted, saved } = await searchParams;
  const principal = await me();

  let d: PostDetail | null = null;
  let failMsg = '글을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.';
  if (!UUID.test(id)) {
    d = { ok: false, note: '없는 글입니다.' };
  } else {
    d = await apiGetPersonal<PostDetail>(`/community/posts/${id}`).catch((e) => {
      if (e instanceof ApiFailure && e.status < 500) failMsg = e.body.message;
      return null;
    });
  }

  const back = <p className="plz-backw"><Link className="plz-back" href="/community">← 목록으로</Link></p>;
  /** 틀 — 낮은 사진 띠 + 알약 탭(고른 게시판 표시) + 본문 */
  const Shell = ({ board, children }: { board?: string; children: React.ReactNode }) => (
    <div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <PlazaTabs cur={board ?? 'none'} />
        <div className="plz-narrow">{children}</div>
      </div>
    </div>
  );

  if (!d) return <Shell><p className="form-error" role="alert">{failMsg}</p>{back}</Shell>;
  if (!d.ok) return <Shell><h1>소개광장</h1><p className="plz-empty">{d.note ?? '없는 글입니다.'} 지워졌거나 주소가 잘못되었습니다.</p>{back}</Shell>;
  if (d.hidden || d.pending) {
    return (
      <Shell board={d.board}>
        <h1>{d.hidden ? '가려진 글' : '검수 중인 글'}</h1>
        <p className="notice">{d.note}</p>
        {back}
      </Shell>
    );
  }

  const comments = d.comments ?? [];
  const roots = comments.filter((c) => !c.parentId);
  const kids = (pid: string) => comments.filter((c) => c.parentId === pid);
  const loggedIn = !!principal;

  const Cmt = ({ c, re }: { c: PostComment; re?: boolean }) => (
    <div className={'cmu-cmt' + (re ? ' re' : '')}>
      <b>{c.author}</b> <span className="dim">{dot(c.createdAt)}</span>
      <p>{c.hidden ? <span className="dim">신고가 들어와 가려진 댓글입니다.</span> : c.body}</p>
    </div>
  );

  /* v10.26 (G-173) — 지운 글은 자리만 남깁니다. 서버가 제목 · 본문을 내려 주지 않습니다. 달린 댓글은 읽을 수만 있습니다(새 댓글 칸은 없음). */
  if (d.deleted) {
    return (
      <Shell board={d.board}>
        <h1>지운 글</h1>
        <p className="notice">{d.note ?? '작성자가 지운 글입니다.'}</p>
        {roots.length > 0 && (
          <>
            <h2>댓글 {comments.length}</h2>
            <div className="card p2pad">
              {roots.map((c) => (
                <div key={c.id}>
                  <Cmt c={c} />
                  {kids(c.id).map((k) => <Cmt key={k.id} c={k} re />)}
                </div>
              ))}
            </div>
          </>
        )}
        {back}
      </Shell>
    );
  }

  return (
    <Shell board={d.board}>
      {posted === 'PENDING' && <p className="notice"><b>글을 올렸습니다.</b> 첫 글이라 확인 후 다른 분들께 보입니다. 보통 하루 안에 끝납니다.</p>}
      {posted === 'PUBLISHED' && <p className="ok-note" role="status">글을 올렸습니다.</p>}
      {saved && <p className="ok-note" role="status">수정했습니다.</p>}

      <article className="plz-post">
        <header>
          <BoardBadge board={d.board} />
          <h1>{d.title}</h1>
          <p className="plz-meta">
            <span>{d.author}</span><span>{dot(d.createdAt)}</span><span>조회 {(d.views ?? 0).toLocaleString('ko-KR')}</span>
            {d.state === 'PENDING' && <span className="state state-suspended">검수 중 · 나만 보임</span>}
            {d.state === 'HIDDEN' && <span className="state state-rejected">가려짐</span>}
          </p>
        </header>
        {d.state === 'HIDDEN' && d.hiddenReason && <div className="notice warn"><b>가려진 사유:</b> {d.hiddenReason}</div>}
        <p className="doc-body">{d.body}</p>
      </article>
      {d.board === 'REVIEW' && (
        <div className="notice"><b>성사된 거래가 확인된 후기입니다.</b> 거래 기록이 없으면 후기를 쓰실 수 없습니다.</div>
      )}
      {d.mine && <PostOwnerActions id={d.id!} />}

      <h2>댓글 {comments.length}</h2>
      <div className="card p2pad">
        {roots.length === 0 ? <p className="dim">아직 댓글이 없습니다.</p> : roots.map((c) => (
          <div key={c.id}>
            <Cmt c={c} />
            {kids(c.id).map((k) => <Cmt key={k.id} c={k} re />)}
            {loggedIn && !c.hidden && <ReplyToggle postId={d.id!} parentId={c.id} loggedIn={loggedIn} />}
          </div>
        ))}
      </div>
      <p className="hint">대댓글은 1단계까지입니다. 더 깊으면 화면에서 읽기 어렵습니다.</p>
      <CommentForm postId={d.id!} loggedIn={loggedIn} reportHref={!d.mine && d.state === 'PUBLISHED' ? `/report/post/${d.id}` : undefined} />
      {back}
    </Shell>
  );
}
