'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 댓글 · 대댓글 — POST /me/community/posts/{id}/comments
 *
 * ★ 대댓글은 1단계까지입니다(DB fn_comment_depth). 답글의 답글은 원 댓글에 붙입니다.
 */
export function CommentForm({ postId, parentId, loggedIn, onDone, reportHref }: {
  postId: string; parentId?: string; loggedIn: boolean; onDone?: () => void;
  /** v10.27 (G-191) — 시안처럼 「댓글 달기」 옆의 「신고」(남의 글일 때만) */
  reportHref?: string;
}) {
  const t = useTranslations('plaza.comment');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!loggedIn) {
    return <p className="hint">{t.rich('loginHint', { login: (c) => <Link href="/login">{c}</Link> })}</p>;
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    setErr(null);
    if (body.length < 2) { setErr(t('tooShort')); return; }
    start(async () => {
      const r = await fetch(`/api/v1/me/community/posts/${postId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, parentId }),
      });
      const d = await r.json().catch(() => null) as { message?: string } | null;
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      form.reset();
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form className="cmu-cform" onSubmit={submit}>
      <textarea name="body" className="inp" rows={parentId ? 2 : 3} maxLength={2000}
        placeholder={parentId ? t('replyPh') : t('commentPh')} aria-label={parentId ? t('reply') : t('comment')} />
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('posting') : parentId ? t('replySubmit') : t('commentSubmit')}</button>
        {reportHref && <> <Link className="btn-sm" href={reportHref} data-report-post>{t('report')}</Link></>}</div>
    </form>
  );
}

/** 댓글 옆 "답글" 토글 */
export function ReplyToggle({ postId, parentId, loggedIn }: { postId: string; parentId: string; loggedIn: boolean }) {
  const t = useTranslations('plaza.comment');
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>{open ? t('replyClose') : t('reply')}</button>
      {open && <CommentForm postId={postId} parentId={parentId} loggedIn={loggedIn} onDone={() => setOpen(false)} />}
    </div>
  );
}
