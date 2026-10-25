import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import type { AffGuide } from '@/components/partners/types';
import { FileOpenButton } from '@/components/files/FileOpenButton';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('guides.title') };
}

/**
 * SB-AFC-GDE-010 파트너가이드 — GET /partner/affiliate/guides · GET /files/{id} (첨부, D007)
 *
 * 운영이 올린 가이드(활성)만 순서대로 옵니다. 비어 있으면 빈 화면 대신 다음 행동을 안내합니다.
 */
export default async function PartnerGuidesPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const rows = await apiGetPersonal<AffGuide[]>('/partner/affiliate/guides').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>{t('guides.title')}</h1></div>
      <p className="lead">{t('guides.lead')}</p>

      {rows === null ? (
        <p className="form-error" role="alert">{t('guides.loadFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{t.rich('guides.empty', { a: (c) => <Link href="/partners/inquiries">{c}</Link> })}</p>
      ) : (
        <ol className="p2list">
          {rows.map((g) => (
            <li key={g.id} className="card p2pad">
              <details>
                <summary><strong>{g.title}</strong></summary>
                <p className="doc-body">{g.body}</p>
                {g.fileId && <p><FileOpenButton fileId={g.fileId} name={g.fileName} size={g.fileSize} label={t('guides.download')} /></p>}
              </details>
            </li>
          ))}
        </ol>
      )}

      <div className="notice">
        {t.rich('guides.diff', { b: (c) => <b>{c}</b>, a: (c) => <Link href="/partners/products">{c}</Link> })}
      </div>
    </>
  );
}
