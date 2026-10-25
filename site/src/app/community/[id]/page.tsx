import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { TranslateButton } from '@/components/community/TranslateButton';
import { type PostDetail, type PostComment } from '@/components/community/types';
import { BoardBadge, PlazaHero, PlazaTabs, dot } from '@/components/community/Plaza';
import { CommentForm, ReplyToggle } from '@/components/community/CommentForm';
import { PostOwnerActions } from '@/components/community/PostOwnerActions';
import '@/styles/plaza.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('post.title') };
}

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
  searchParams: Promise<{ posted?: string; saved?: string; orig?: string }>;
}) {
  const { id } = await params;
  const { posted, saved, orig } = await searchParams;
  const principal = await me();
  const t = await getTranslations('plaza');

  let d: PostDetail | null = null;
  let failMsg = t('post.loadFail');
  if (!UUID.test(id)) {
    d = { ok: false, note: t('post.noSuch') };
  } else {
    d = await apiGetPersonal<PostDetail>(`/community/posts/${id}${orig === '1' ? '?orig=1' : ''}`).catch((e) => {   // v10.105 — 「원문 보기」
      if (e instanceof ApiFailure && e.status < 500) failMsg = e.body.message;
      return null;
    });
  }

  const back = <p className="plz-backw"><Link className="plz-back" href="/community">{t('post.back')}</Link></p>;
  /** 틀 — 낮은 사진 띠 + 알약 탭(고른 게시판 표시) + 본문 */
  const Shell = ({ board, children }: { board?: string; children: React.ReactNode }) => (
    <div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <PlazaTabs cur={board ?? 'none'} />
        <div className="plz-narrow"><Msgs ns={['plaza']}>{children}</Msgs></div>
      </div>
    </div>
  );

  if (!d) return <Shell><p className="form-error" role="alert">{failMsg}</p>{back}</Shell>;
  if (!d.ok) return <Shell><h1>{t('hero.name')}</h1><p className="plz-empty">{d.note ?? t('post.noSuch')} {t('post.goneOrBad')}</p>{back}</Shell>;
  if (d.hidden || d.pending) {
    return (
      <Shell board={d.board}>
        <h1>{d.hidden ? t('post.hiddenTitle') : t('post.pendingTitle')}</h1>
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
      <p>{c.hidden ? <span className="dim">{c.hiddenBy === 'REPORT' ? t('comment.hiddenReport') : t('comment.hiddenAdmin')}</span> : c.body}
        {c.translated && <span className="dim" data-mt=""> · {t('mt.label')}</span>}</p>
      {/* v10.80 — 남의 공개 댓글은 신고(본인인증 회원 · 서로 다른 3명이면 가려짐 · D110) */}
      {loggedIn && !c.mine && !c.hidden && <a className="dim cmu-rpt" href={`/report/comment/${c.id}`} data-comment-report="">{t('comment.report')}</a>}
    </div>
  );

  /* v10.26 (G-173) — 지운 글은 자리만 남깁니다. 서버가 제목 · 본문을 내려 주지 않습니다. 달린 댓글은 읽을 수만 있습니다(새 댓글 칸은 없음). */
  if (d.deleted) {
    return (
      <Shell board={d.board}>
        <h1>{t('post.deletedTitle')}</h1>
        <p className="notice">{d.note ?? t('post.deletedNote')}</p>
        {roots.length > 0 && (
          <>
            <h2>{t('comment.count', { n: String(comments.length) })}</h2>
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
      {posted === 'PENDING' && <p className="notice">{t.rich('post.postedPending', { b: (c) => <b>{c}</b> })}</p>}
      {posted === 'PUBLISHED' && <p className="ok-note" role="status">{t('post.posted')}</p>}
      {saved && <p className="ok-note" role="status">{t('post.saved')}</p>}

      <article className="plz-post">
        <header>
          <BoardBadge board={d.board} />
          <h1>{d.title}</h1>
          <p className="plz-meta">
            <span>{d.author}</span><span>{dot(d.createdAt)}</span><span>{t('post.views', { n: (d.views ?? 0).toLocaleString('ko-KR') })}</span>
            {d.state === 'PENDING' && <span className="state state-suspended">{t('pendingMine')}</span>}
            {d.state === 'HIDDEN' && <span className="state state-rejected">{t('post.hidden')}</span>}
          </p>
        </header>
        {d.state === 'HIDDEN' && d.hiddenReason && <div className="notice warn"><b>{t('post.hiddenReason')}</b> {d.hiddenReason}</div>}
        {/* v10.105 (다국어 3-3) — 기계 번역 표시 · 원문 보기 / 번역 보기(누를 때만 번역 · 다국어가 꺼져 있거나 한국어면 나오지 않음) */}
        {d.translated && <p className="plz-meta" data-mt=""><span>{t('mt.label')}</span><Link href={`/community/${d.id}?orig=1`}>{t('mt.showOrig')}</Link></p>}
        {orig === '1' && <p className="plz-meta" data-mt-orig=""><Link href={`/community/${d.id}`}>{t('mt.showTr')}</Link></p>}
        {/* 아직 번역 안 된 칸(나중에 달린 댓글 포함)이 있을 때만 */}
        {orig !== '1' && d.i18nAvailable && <TranslateButton postId={d.id!} />}
        <p className="doc-body">{d.body}</p>
      </article>
      {d.board === 'REVIEW' && (
        <div className="notice">{t.rich('post.reviewNote', { b: (c) => <b>{c}</b> })}</div>
      )}
      {d.mine && <PostOwnerActions id={d.id!} />}

      <h2>{t('comment.count', { n: String(comments.length) })}</h2>
      <div className="card p2pad">
        {roots.length === 0 ? <p className="dim">{t('comment.none')}</p> : roots.map((c) => (
          <div key={c.id}>
            <Cmt c={c} />
            {kids(c.id).map((k) => <Cmt key={k.id} c={k} re />)}
            {loggedIn && !c.hidden && <ReplyToggle postId={d.id!} parentId={c.id} loggedIn={loggedIn} />}
          </div>
        ))}
      </div>
      <p className="hint">{t('comment.depthHint')}</p>
      <CommentForm postId={d.id!} loggedIn={loggedIn} reportHref={!d.mine && d.state === 'PUBLISHED' ? `/report/post/${d.id}` : undefined} />
      {back}
    </Shell>
  );
}
