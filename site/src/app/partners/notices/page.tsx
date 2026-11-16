import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';   // v10.279 (D210) 공지는 보는 사람 등급 기준
import { ymd } from '@/components/partners/fmt';
import type { Notice } from '@/components/partners/types';
import { NoticeDetails } from '@/components/common/NoticeDetails';
import { NoticeFiles } from '@/components/common/NoticeFiles';
import { NoticeHashOpen } from '@/components/common/NoticeHashOpen';
import { NoticeEmptyText, NoticePager, NoticeSearch, noticeQuery } from '@/components/common/NoticeListTools';
import { PlazaReadAll } from '@/components/community/PlazaReadAll';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('notices.metaTitle') };
}

/**
 * SB-AFC-NTC-010 공지사항 — GET /notices
 *
 * 공개 공지(발행된 것만) — v10.279 (D210) 부터 보는 사람의 등급에 맞는 것만이라 apiGetPersonal(캐시 안 함).
 * 고정 공지가 먼저 옵니다.
 * v10.293 (docs/415) 펼칠 때 읽음 기록 · 최근 30일 안 펼친 공지는 「새 글」(NoticeDetails).
 * v10.328 (docs/456) 소개광장 › 공지와 같은 찾기(nq) · 30개씩 쪽(np) · 「모두 읽음」 · 30개 밖 #n-<id> 공지 한 건(NoticeHashOpen).
 */
export default async function PartnerNoticesPage({ searchParams }: { searchParams: Promise<{ nq?: string; np?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');
  const tp = await getTranslations('plaza');
  const { nq, np, api } = noticeQuery(await searchParams);

  const rows = await apiGetPersonal<Notice[]>(api).catch(() => null);

  return (
    <>
      <div className="page-head"><h1>{t('notices.title')}</h1></div>
      <p className="lead">{t('notices.lead')}</p>
      {rows && rows.some((n) => n.unread === true) && <p data-notice-read-all-row><PlazaReadAll label={tp('ntc.readAll')} failLabel={tp('ntc.readAllFail')} /></p>}
      <NoticeSearch path="/partners/notices" nq={nq} />
      <NoticeHashOpen shown={(rows ?? []).map((n) => n.id)} login labels={{ old: tp('ntc.oldOne'), isNew: t('notices.new'), files: t('notices.files'), gone: tp('ntc.gone') }} />

      {rows === null ? (
        <p className="form-error" role="alert">{t('notices.loadFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty" data-notice-empty><NoticeEmptyText nq={nq} np={np} empty={t('common.noNotices')} /></p>
      ) : (
        <ul className="p2list">
          {rows.map((n) => (
            <li key={n.id} id={`n-${n.id}`} className="card p2pad">
              <NoticeDetails id={n.id} unread={n.unread === true} newLabel={t('notices.new')} summary={<>
                  {n.isPinned && <span className="state state-in_review">{t('notices.pinned')}</span>} <strong>{n.title}</strong>{' '}
                  <span className="dim">{ymd(n.publishedAt)}</span>
                </>}>
                <p className="doc-body">{n.body}</p>
                <NoticeFiles id={n.id} files={n.files} label={t('notices.files')} />
              </NoticeDetails>
            </li>
          ))}
        </ul>
      )}
      {rows && <NoticePager path="/partners/notices" nq={nq} np={np} count={rows.length} />}
    </>
  );
}
