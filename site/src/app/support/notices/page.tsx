import type { Metadata } from 'next';
import Link from 'next/link';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { NoticeDetails } from '@/components/common/NoticeDetails';
import { getTranslations } from 'next-intl/server';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('notices') };
}

interface Notice { id: string; title: string; body: string; isPinned: boolean; publishedAt: string | null; unread?: boolean }

/**
 * v10.279 (D210 · docs/408) 고객센터 › 공지사항 — GET /notices(보는 사람 기준)
 *   서버가 보는 사람의 등급(fn_notice_grades)에 맞는 공지만 줌 — 로그인하지 않으면 「전체 공개」만 · 「관리자」 공지는 사용자 웹에 나오지 않음.
 *   사람마다 결과가 달라 캐시하지 않음(apiGetPersonal).
 *   v10.293 (docs/415) 로그인했으면 펼칠 때 읽음 기록 · 최근 30일 안 펼친 공지는 「새 글」(NoticeDetails).
 */
export default async function SupportNoticesPage() {
  const [user, t] = await Promise.all([me().catch(() => null), getTranslations('deal.support')]);
  const rows = await apiGetPersonal<Notice[]>('/notices').catch(() => null);
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-NTC-010">
      <BackBar href="/support/new" label={t('backCs')} wrap={false} />
      <div className="w1-pgh"><div><h1>{t('ntcTitle')}</h1><p>{t('ntcLead')}</p></div></div>
      {!user && <p className="w1-nt" data-notice-login><Link href="/login?next=/support/notices">{t('ntcLogin')}</Link></p>}
      {rows === null ? (
        <p className="form-error" role="alert">{t('ntcFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty" data-notice-empty>{t('ntcEmpty')}</p>
      ) : (
        <ul className="w1-list" data-site-notices={rows.length} style={{ listStyle: 'none', padding: 0 }}>
          {rows.map((n) => (
            <li key={n.id} id={`n-${n.id}`} className="card" style={{ padding: 12, marginBottom: 8 }} data-site-notice={n.id}>
              <NoticeDetails id={n.id} unread={n.unread === true} newLabel={t('ntcNew')} login={!!user} summary={<>
                  {n.isPinned && <span className="w1-did">{t('ntcPinned')}</span>} <strong>{n.title}</strong>{' '}
                  <span className="dim">{String(n.publishedAt ?? '').slice(0, 10)}</span>
                </>}>
                <p style={{ whiteSpace: 'pre-line' }}>{n.body}</p>
              </NoticeDetails>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
