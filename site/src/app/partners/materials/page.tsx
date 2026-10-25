import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { CopyButton } from '@/components/partners/CopyButton';
import { FileOpenButton } from '@/components/files/FileOpenButton';
import { ymd, codeText } from '@/components/partners/fmt';
import type { AffMaterial } from '@/components/partners/types';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('materials.title') };
}

/**
 * SB-AFC-MKT-010 마케팅자료실 — GET /partner/affiliate/materials · GET /files/{id}
 *
 * ★ 심의를 통과한(APPROVED) 자료만 옵니다. 파트너가 뿌리는 순간 **회사가 한 말**이 됩니다.
 * ★ D007 — 파일이 있으면 내려받기 버튼. GET /files/{fileId} 가 5분짜리 주소를 줍니다(ACTIVE 파트너만).
 */
export default async function PartnerMaterialsPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const rows = await apiGetPersonal<AffMaterial[]>('/partner/affiliate/materials').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>{t('materials.title')}</h1></div>
      <p className="lead">{t('materials.lead')}</p>
      <div className="notice warn">
        {t.rich('materials.warn', { b: (c) => <b>{c}</b> })}
      </div>

      {rows === null ? (
        <p className="form-error" role="alert">{t('materials.loadFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{t('materials.empty')}</p>
      ) : (
        <ul className="p2list">
          {rows.map((m) => (
            <li key={m.id} className="card p2pad">
              <details>
                <summary><strong>{m.title}</strong> <span className="state state-in_review">{codeText(t, 'materialKind', m.kind)}</span> <span className="dim">{ymd(m.createdAt)}</span></summary>
                {m.body && <p className="doc-body">{m.body}</p>}
                {m.fileId
                  ? <p><FileOpenButton fileId={m.fileId} name={m.fileName} size={m.fileSize} /></p>
                  : m.fileKey && <p className="dim">{t('materials.file')}<span className="mono">{m.fileKey}</span>{t('materials.notLinked')}</p>}
                {m.body && <CopyButton text={m.body} label={t('materials.copyText')} />}
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="notice">{t.rich('materials.ask', { b: (c) => <b>{c}</b>, a: (c) => <Link href="/partners/inquiries">{c}</Link> })}</div>
    </>
  );
}
