'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 내 글 수정 · 삭제 — DELETE /me/community/posts/{id}
 *
 * ★ 실제로 지우지 않고 감춥니다(서버). 달린 댓글은 남습니다 — 확인 창에 적어 둡니다.
 */
export function PostOwnerActions({ id }: { id: string }) {
  const t = useTranslations('plaza');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(t('post.confirmDelete'))) return;
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/me/community/posts/${id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => null) as { ok?: boolean; note?: string; message?: string } | null;
      if (!r.ok || d?.ok === false) { setErr(d?.note ?? d?.message ?? t('post.deleteFail')); return; }
      router.push('/community?deleted=1');
      router.refresh();
    });
  }

  return (
    <div className="p2act">
      <Link className="btn-sm" href={`/community/write?edit=${id}`}>{t('post.edit')}</Link>
      <button type="button" className="btn-sm" disabled={pending} onClick={remove}>{pending ? t('post.deleting') : t('post.delete')}</button>
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}
