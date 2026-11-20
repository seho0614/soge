import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { MyHead, Note, Empty } from '@/components/my/ui';
import { Msgs } from '@/i18n/Msgs';
import { SavedList, type SavedItem } from '@/components/lsx/SavedList';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lsx'))('savedTitle') };
}
export const dynamic = 'force-dynamic';

/** SB-MYP-LSX-010 저장한 검색 (v10.513 · D276 · docs/651) — GET /me/saved-searches */
export default async function SavedSearches() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('lsx');
  const d = await apiGetPersonal<{ on: boolean; max: number; items: SavedItem[] }>('/me/saved-searches').catch(() => ({ on: false, max: 10, items: [] as SavedItem[] }));
  return (
    <>
      <MyHead title={t('savedTitle')} sub={t('savedSub', { max: String(d.max) })} />
      {!d.on && <Note kind="warn" data-lsx-saved-off="">{t('savedOff')}</Note>}
      {d.items.length === 0 ? <Empty>{t('savedEmpty')}</Empty> : <Msgs ns={['lsx']}><SavedList items={d.items} /></Msgs>}
    </>
  );
}
