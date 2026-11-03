import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { exportMyData, me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyHead, Note } from '@/components/my/ui';
import { DataExportForm } from './DataExportForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.data'))('title') };
}

interface Status { used: number; limit: number; left: number; sections: string[] }

/**
 * SB-MYP-DAT-010 내 정보 내려받기 (v10.181 · D170 · docs/283)
 *   GET  /me/data-export — 오늘 남은 횟수 · 들어가는 칸
 *   POST /me/data-export — 비밀번호 확인 → 본인 정보 JSON(다른 회원 정보 · 운영 메모 · 비밀값 없음) · 하루 privacy.export_daily 번
 */
export default async function DataExportPage() {
  if (!(await me())) redirect('/login?next=/my/account/data');
  const t = await getTranslations('my.data');
  const st = await apiGetPersonal<Status>('/me/data-export').catch(() => null);

  async function doExport(password: string) {
    'use server';
    return exportMyData(password);
  }

  return (
    <><div data-my-data-export="">
      <MyHead title={t('title')} sub={t('sub')}
        right={<Link className="my-bo" href="/my/account">{t('backProfile')}</Link>} />
      <Note kind="info"><b>{t('whatB')}</b> {t('whatText')}</Note>
      <Note kind="plain">{t('notIncluded')}</Note>
      {!st ? <Note kind="warn" role="alert">{t('loadFail')}</Note> : (
        <>
          <Note kind="plain" data-export-left={String(st.left)}>{t('left', { left: String(st.left), limit: String(st.limit) })}</Note>
          {st.left > 0 ? <DataExportForm action={doExport} /> : <Note kind="warn">{t('limitReached', { limit: String(st.limit) })}</Note>}
        </>
      )}
      <Note kind="plain">{t('privacyLink')} <Link href="/my/account/privacy">{t('privacyLinkGo')}</Link></Note>
    </div><i hidden data-root-end="" /></>
  );
}
