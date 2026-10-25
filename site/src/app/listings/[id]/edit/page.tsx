import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import type { ListingDetailData } from '@/lib/types';
import { BackBar } from '@/components/common/BackBar';
import { ListingEditForm, type Draft, type ReviewState } from '@/components/ListingEditForm';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('forms.editPage'))('title') };
}

/** SB-HOM-REG-020 — v10.31 시안 scRegEdit. 수정은 재검수를 유발하고 배지가 회수됩니다 */
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await me())) redirect('/login');
  const { id } = await params;
  let item: ListingDetailData;
  /* 본인 것(검수 중 · 반려 포함)을 봐야 해서 로그인 응답을 씁니다 — 캐시하지 않음 */
  try { item = await apiGetPersonal<ListingDetailData>(`/listings/${id}`); }
  catch (e) { if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) notFound() /* 20261002 — 형식이 틀린 번호도 404 (전: 500) */; throw e; }
  if (item.isOwn === false) notFound();
  const [review, draft] = await Promise.all([
    apiGetPersonal<ReviewState>(`/me/listings/${id}/review`).catch(() => null),
    apiGetPersonal<Draft | null>(`/me/listings/${id}/draft`).catch(() => null),
  ]);

  const t = await getTranslations('forms.editPage');

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-REG-020" style={{ maxWidth: 860 }}>
      <BackBar href="/my/listings" label={t('back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{t('title')}</h1>
        <p>{t('sub')}</p>
      </div>
      <div style={{ marginTop: 12 }}><Msgs ns={['forms']}><ListingEditForm item={item} review={review} draft={draft && draft.savedAt ? draft : null} /></Msgs></div>
    </div>
  );
}
