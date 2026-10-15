import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { PartnerInquiryForm } from '@/components/partners/PartnerInquiryForm';
import { ymd, INQ_STATE } from '@/components/partners/fmt';
import type { AffInquiry } from '@/components/partners/types';

export const metadata: Metadata = { title: '1:1 문의' };

/**
 * SB-AFC-QNA-010 1:1 문의
 *
 * GET /partner/affiliate/inquiries (내 문의) · POST /partner/affiliate/inquiries (접수).
 * 답변이 달린 것은 펼쳐서 봅니다.
 */
export default async function PartnerInquiriesPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGetPersonal<AffInquiry[]>('/partner/affiliate/inquiries').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>1:1 문의</h1></div>
      <p className="lead">궁금한 것을 물으십시오.</p>

      {rows === null ? (
        <p className="form-error" role="alert">문의 내역을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : rows.length === 0 ? (
        <p className="empty">아직 남기신 문의가 없습니다.</p>
      ) : (
        <ul className="p2list">
          {rows.map((q) => (
            <li key={q.id} className="card p2pad">
              <details>
                <summary>
                  <strong>{q.subject}</strong>{' '}
                  <span className={'state ' + (INQ_STATE[q.state]?.c ?? '')}>{INQ_STATE[q.state]?.t ?? q.state}</span>{' '}
                  <span className="dim">{ymd(q.createdAt)}</span>
                </summary>
                <p className="doc-body">{q.body}</p>
                {q.answer
                  ? <div className="notice"><b>답변</b> <span className="dim">{ymd(q.answeredAt)}</span><p className="doc-body">{q.answer}</p></div>
                  : <p className="dim">아직 답변 전입니다.</p>}
              </details>
            </li>
          ))}
        </ul>
      )}

      <h2 className="sec-title p2gap">새 문의</h2>
      <PartnerInquiryForm />
    </>
  );
}
