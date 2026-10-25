import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { apiGetPersonal } from '@/lib/api';
import { PostEditor } from '@/components/community/PostEditor';
import type { PostDetail } from '@/components/community/types';
import { PlazaHero } from '@/components/community/Plaza';
import '@/styles/plaza.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('write.title') };
}

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
  const t = await getTranslations('plaza');
  let initial: { id: string; title: string; body: string; board: string } | undefined;
  let editErr: string | null = null;

  if (edit) {
    const d = UUID.test(edit)
      ? await apiGetPersonal<PostDetail>(`/community/posts/${edit}`).catch(() => null)
      : null;
    if (!d || !d.ok || !d.id) editErr = t('write.notFound');
    else if (!d.mine) editErr = t('write.notMine');
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
      <h1>{initial ? t('write.editH') : t('write.newH')}</h1>
      <p className="lead">{t.rich('write.lead', { b: (c) => <b>{c}</b> })}</p>
      {editErr ? (
        <>
          <p className="form-error" role="alert">{editErr}</p>
          <p className="auth-foot"><Link href="/community">{t('write.toList')}</Link></p>
        </>
      ) : (
        <Msgs ns={['plaza']}><PostEditor edit={initial} deals={deals.map((x) => ({ id: x.id, title: x.title, statusLabel: x.statusLabel }))} /></Msgs>
      )}
      </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
