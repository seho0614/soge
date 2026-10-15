import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { CopyButton } from '@/components/partners/CopyButton';
import { FileOpenButton } from '@/components/files/FileOpenButton';
import { ymd, MATERIAL_KIND } from '@/components/partners/fmt';
import type { AffMaterial } from '@/components/partners/types';

export const metadata: Metadata = { title: '마케팅자료실' };

/**
 * SB-AFC-MKT-010 마케팅자료실 — GET /partner/affiliate/materials · GET /files/{id}
 *
 * ★ 심의를 통과한(APPROVED) 자료만 옵니다. 파트너가 뿌리는 순간 **회사가 한 말**이 됩니다.
 * ★ D007 — 파일이 있으면 내려받기 버튼. GET /files/{fileId} 가 5분짜리 주소를 줍니다(ACTIVE 파트너만).
 */
export default async function PartnerMaterialsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGetPersonal<AffMaterial[]>('/partner/affiliate/materials').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>마케팅자료실</h1></div>
      <p className="lead">심의를 통과한 자료만 있습니다.</p>
      <div className="notice warn">
        <b>여기 있는 자료만 쓰십시오.</b> 직접 만드신 문구를 뿌리시면 <b>회사가 한 말</b>이 되어 문제가 될 수 있습니다 — 표시광고법이 걸립니다.
      </div>

      {rows === null ? (
        <p className="form-error" role="alert">자료를 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : rows.length === 0 ? (
        <p className="empty">아직 올라온 자료가 없습니다.</p>
      ) : (
        <ul className="p2list">
          {rows.map((m) => (
            <li key={m.id} className="card p2pad">
              <details>
                <summary><strong>{m.title}</strong> <span className="state state-in_review">{MATERIAL_KIND[m.kind] ?? m.kind}</span> <span className="dim">{ymd(m.createdAt)}</span></summary>
                {m.body && <p className="doc-body">{m.body}</p>}
                {m.fileId
                  ? <p><FileOpenButton fileId={m.fileId} name={m.fileName} size={m.fileSize} /></p>
                  : m.fileKey && <p className="dim">파일: <span className="mono">{m.fileKey}</span> (내려받을 파일이 아직 연결되지 않았습니다)</p>}
                {m.body && <CopyButton text={m.body} label="문구 복사" />}
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="notice"><b>필요한 자료가 없으면 <Link href="/partners/inquiries">문의</Link>해 주십시오.</b> 심의를 거쳐 올려 드립니다.</div>
    </>
  );
}
