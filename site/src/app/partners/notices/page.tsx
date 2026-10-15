import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymd } from '@/components/partners/fmt';
import type { Notice } from '@/components/partners/types';

export const metadata: Metadata = { title: '파트너 공지사항' };

/**
 * SB-AFC-NTC-010 공지사항 — GET /notices
 *
 * 공개 공지(발행된 것만)를 그대로 씁니다. 누구에게나 같은 응답이라 apiGet(캐시)입니다.
 * 고정 공지가 먼저 옵니다.
 */
export default async function PartnerNoticesPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGet<Notice[]>('/notices', 60).catch(() => null);

  return (
    <>
      <div className="page-head"><h1>공지사항</h1></div>
      <p className="lead">파트너 대상 공지입니다.</p>

      {rows === null ? (
        <p className="form-error" role="alert">공지를 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : rows.length === 0 ? (
        <p className="empty">등록된 공지가 없습니다.</p>
      ) : (
        <ul className="p2list">
          {rows.map((n) => (
            <li key={n.id} id={`n-${n.id}`} className="card p2pad">
              <details>
                <summary>
                  {n.isPinned && <span className="state state-in_review">고정</span>} <strong>{n.title}</strong>{' '}
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
