import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { MyHead, Note, Empty } from '@/components/my/ui';
import { Msgs } from '@/i18n/Msgs';
import { VideoRow, type VideoItem, type VideoPolicy } from '@/components/lsy/VideoManager';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lsy'))('pageTitle') };
}
export const dynamic = 'force-dynamic';

/** SB-MYP-LSY-010 매물 동영상 · 사진 점검 (v10.525 · 526 · D279 · docs/663 · 664) — GET /me/lsy/videos */
export default async function ListingVideoPage() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('lsy');
  const d = await apiGetPersonal<VideoPolicy & { items: VideoItem[] }>('/me/lsy/videos').catch(() => null);
  return (
    <>
      <MyHead title={t('pageTitle')} sub={t('pageSub', { mb: String(d?.maxMb ?? 30), sec: String(d?.maxSec ?? 60) })} />
      {d && !d.on && <Note kind="warn" data-lsy-video-off="">{t('videoOff')}</Note>}
      <Note kind="info">{t('reviewNote')}</Note>
      {!d || d.items.length === 0 ? <Empty>{t('empty')}</Empty> : (
        <Msgs ns={['lsy']}>
          <div data-lsy-videos={d.items.length}>{d.items.map((it) => <VideoRow key={it.id} item={it} policy={{ on: d.on, maxMb: d.maxMb, maxSec: d.maxSec, photoCheck: d.photoCheck }} />)}</div>
        </Msgs>
      )}
    </>
  );
}
