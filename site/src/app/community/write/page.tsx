import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { PostEditor } from '@/components/community/PostEditor';
import type { PostDetail } from '@/components/community/types';
import { PlazaHero } from '@/components/community/Plaza';
import '@/styles/plaza.css';

export const metadata: Metadata = { title: '소개광장 글쓰기' };

interface MyDeal { id: string; title: string; status: string; statusLabel: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* 후기를 쓸 수 있는 거래 상태 — DB fn_post_guard 와 같은 목록입니다 */
const DONE = new Set(['CONFIRMED', 'FULFILLED', 'CLOSED']);

/**
 * SB-HOM-CMU-030 글쓰기 · 수정(?edit={id})
 *
 * API: POST /community/classify · POST /me/community/posts · PATCH /me/community/posts/{id} ·
 *      DELETE /me/community/posts/{id} (모두 PostEditor 에서 호출)
 * 소개 후기용 거래 목록은 GET /me/deals 에서 성사된 것만 거릅니다.
 */
export default async function CommunityWritePage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');

  const { edit } = await searchParams;
  let initial: { id: string; title: string; body: string; board: string } | undefined;
  let editErr: string | null = null;

  if (edit) {
    const d = UUID.test(edit)
      ? await apiGetPersonal<PostDetail>(`/community/posts/${edit}`).catch(() => null)
      : null;
    if (!d || !d.ok || !d.id) editErr = '고칠 글을 찾지 못했습니다.';
    else if (!d.mine) editErr = '내가 쓴 글만 고칠 수 있습니다.';
    else initial = { id: d.id, title: d.title ?? '', body: d.body ?? '', board: d.board ?? '' };
  }

  const deals = initial ? [] : await apiGetPersonal<MyDeal[]>('/me/deals')
    .then((rows) => rows.filter((x) => DONE.has(x.status)))
    .catch(() => [] as MyDeal[]);

  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
      <div className="plz-narrow">
      <h1>{initial ? '글 수정' : '글쓰기'}</h1>
      <p className="lead">제목과 내용을 쓰시면 <b>어느 게시판인지 골라 드립니다.</b></p>
      {editErr ? (
        <>
          <p className="form-error" role="alert">{editErr}</p>
          <p className="auth-foot"><Link href="/community">목록으로</Link></p>
        </>
      ) : (
        <PostEditor edit={initial} deals={deals.map((x) => ({ id: x.id, title: x.title, statusLabel: x.statusLabel }))} />
      )}
      </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
