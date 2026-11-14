import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';   // v10.279 (D210) 공지는 보는 사람 등급 기준
import { ymd } from '@/components/partners/fmt';
import type { Notice } from '@/components/partners/types';
import { NoticeDetails } from '@/components/common/NoticeDetails';
import { NoticeFiles } from '@/components/common/NoticeFiles';

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
 */
export default async function PartnerNoticesPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const rows = await apiGetPersonal<Notice[]>('/notices').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>{t('notices.title')}</h1></div>
      <p className="lead">{t('notices.lead')}</p>

      {rows === null ? (
        <p className="form-error" role="alert">{t('notices.loadFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{t('common.noNotices')}</p>
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
    </>
  );
}
