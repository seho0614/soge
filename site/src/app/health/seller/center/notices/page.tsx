/** SB-HLT-SEL-030 판매자센터 › 소개몰 공지 모두 (v10.330 · docs/459) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { NoticeDetails } from '@/components/common/NoticeDetails';
import { NoticeFiles, type NoticeFile } from '@/components/common/NoticeFiles';
import { NoticeEmptyText, NoticePager, NoticeSearch, noticeQuery } from '@/components/common/NoticeListTools';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('center.noticesTitle') }) };
}
export const dynamic = 'force-dynamic';

type SellerNotice = { id: string; title: string; body: string; publishedAt: string; isPinned: boolean; unread?: boolean; files?: NoticeFile[] };

/**
 * 판매자센터 「소개몰 공지」 상자의 「지난 공지 모두 보기」 — GET /me/health/seller/notices?q=&page=.
 *   찾기(nq) · 30개씩(np)은 소개광장 · 파트너센터 공지와 같은 부품(NoticeListTools).
 *   펼치면 판매자 읽음 기록(POST /me/health/seller/notices/{id}/read — 요율 공지 「읽음 n / 대상 m」 증거) · 「모두 읽음」은 두지 않음.
 */
export default async function HltSellerNoticesPage({ searchParams }: { searchParams: Promise<{ nq?: string; np?: string }> }) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('hlt.center');
  const { nq, np, api } = noticeQuery(await searchParams);
  let rows: SellerNotice[] | null = null;
  let notSeller = false;
  try {
    rows = await apiGetPersonal<SellerNotice[]>(api.replace(/^\/notices/, '/me/health/seller/notices'));
  } catch (e) {
    notSeller = e instanceof ApiFailure && e.status === 403;
  }
  const path = '/health/seller/center/notices';
  return (
    <><div className="hlt" data-seller-notices-page="">
      <HltNav back="/health/seller/center" />
      <Crumb items={[{ href: '/health/seller', label: t('apply') }, { href: '/health/seller/center', label: t('noticesBack') }, { label: t('noticesTitle') }]} />
      <div className="page-head"><h1>{t('noticesTitle')}</h1></div>
      {notSeller ? <HltEmpty msg={t('notSeller')} href="/health/seller" label={t('apply')} /> : rows === null ? <p className="form-error" role="alert">{t('errLoad')}</p> : <>
        <p className="lead">{t('noticesLead')}</p>
        <NoticeSearch path={path} nq={nq} />
        {rows.length === 0 ? (
          <p className="empty" data-notice-empty><NoticeEmptyText nq={nq} np={np} empty={t('noticesEmpty')} /></p>
        ) : (
          <ul className="p2list">
            {rows.map((x) => (
              <li key={x.id} id={`n-${x.id}`} className="card p2pad" data-seller-notice={x.id}>
                <NoticeDetails id={x.id} unread={x.unread === true} newLabel={t('noticeNew')} readPath={`/api/v1/me/health/seller/notices/${x.id}/read`} summary={<>
                  <strong>{x.title}</strong> <span className="dim">{String(x.publishedAt).slice(0, 10)}</span>
                </>}>
                  <p style={{ whiteSpace: 'pre-line' }}>{x.body}</p>
                  <NoticeFiles id={x.id} files={x.files} label={t('noticeFiles')} />
                </NoticeDetails>
              </li>
            ))}
          </ul>
        )}
        <NoticePager path={path} nq={nq} np={np} count={rows.length} />
      </>}
    </div><i hidden data-root-end="" /></>
  );
}
