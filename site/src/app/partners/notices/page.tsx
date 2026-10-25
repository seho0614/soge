import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymd } from '@/components/partners/fmt';
import type { Notice } from '@/components/partners/types';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('notices.metaTitle') };
}

/**
 * SB-AFC-NTC-010 공지사항 — GET /notices
 *
 * 공개 공지(발행된 것만)를 그대로 씁니다. 누구에게나 같은 응답이라 apiGet(캐시)입니다.
 * 고정 공지가 먼저 옵니다.
 */
export default async function PartnerNoticesPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const rows = await apiGet<Notice[]>('/notices', 60).catch(() => null);

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
              <details>
                <summary>
                  {n.isPinned && <span className="state state-in_review">{t('notices.pinned')}</span>} <strong>{n.title}</strong>{' '}
                  <span className="dim">{ymd(n.publishedAt)}</span>
                </summary>
                <p className="doc-body">{n.body}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
