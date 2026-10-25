import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { PartnerInquiryForm } from '@/components/partners/PartnerInquiryForm';
import { ymd, INQ_STATE, codeText } from '@/components/partners/fmt';
import type { AffInquiry } from '@/components/partners/types';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('inquiries.title') };
}

/**
 * SB-AFC-QNA-010 1:1 문의
 *
 * GET /partner/affiliate/inquiries (내 문의) · POST /partner/affiliate/inquiries (접수).
 * 답변이 달린 것은 펼쳐서 봅니다.
 */
export default async function PartnerInquiriesPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const rows = await apiGetPersonal<AffInquiry[]>('/partner/affiliate/inquiries').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>{t('inquiries.title')}</h1></div>
      <p className="lead">{t('inquiries.lead')}</p>

      {rows === null ? (
        <p className="form-error" role="alert">{t('inquiries.loadFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{t('inquiries.empty')}</p>
      ) : (
        <ul className="p2list">
          {rows.map((q) => (
            <li key={q.id} className="card p2pad">
              <details>
                <summary>
                  <strong>{q.subject}</strong>{' '}
                  <span className={'state ' + (INQ_STATE[q.state]?.c ?? '')}>{codeText(t, 'inqState', q.state)}</span>{' '}
                  <span className="dim">{ymd(q.createdAt)}</span>
                </summary>
                <p className="doc-body">{q.body}</p>
                {q.answer
                  ? <div className="notice"><b>{t('inquiries.answer')}</b> <span className="dim">{ymd(q.answeredAt)}</span><p className="doc-body">{q.answer}</p></div>
                  : <p className="dim">{t('inquiries.noAnswer')}</p>}
              </details>
            </li>
          ))}
        </ul>
      )}

      <h2 className="sec-title p2gap">{t('inquiries.newTitle')}</h2>
      <PartnerInquiryForm />
    </>
  );
}
