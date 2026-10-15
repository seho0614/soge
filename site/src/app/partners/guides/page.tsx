import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import type { AffGuide } from '@/components/partners/types';
import { FileOpenButton } from '@/components/files/FileOpenButton';

export const metadata: Metadata = { title: '파트너가이드' };

/**
 * SB-AFC-GDE-010 파트너가이드 — GET /partner/affiliate/guides · GET /files/{id} (첨부, D007)
 *
 * 운영이 올린 가이드(활성)만 순서대로 옵니다. 비어 있으면 빈 화면 대신 다음 행동을 안내합니다.
 */
export default async function PartnerGuidesPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGetPersonal<AffGuide[]>('/partner/affiliate/guides').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>파트너가이드</h1></div>
      <p className="lead">처음이시면 여기부터 보십시오.</p>

      {rows === null ? (
        <p className="form-error" role="alert">가이드를 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : rows.length === 0 ? (
        <p className="empty">아직 등록된 가이드가 없습니다. 궁금한 것은 <Link href="/partners/inquiries">1:1 문의</Link>로 물어 주십시오.</p>
      ) : (
        <ol className="p2list">
          {rows.map((g) => (
            <li key={g.id} className="card p2pad">
              <details>
                <summary><strong>{g.title}</strong></summary>
                <p className="doc-body">{g.body}</p>
                {g.fileId && <p><FileOpenButton fileId={g.fileId} name={g.fileName} size={g.fileSize} label="첨부 내려받기" /></p>}
              </details>
            </li>
          ))}
        </ol>
      )}

      <div className="notice">
        <b>소개비와는 다른 것입니다.</b> 소개비는 아는 분을 이어 드리고 <b>당사자끼리</b> 주고받는 돈이고,
        제휴수수료는 <b>회사가 지급</b>합니다. <Link href="/partners/products">추천상품에서 링크 만들기 ›</Link>
      </div>
    </>
  );
}
