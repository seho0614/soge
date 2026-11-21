import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { MyHead, Note, Empty } from '@/components/my/ui';
import { LsqBulkForm } from '@/components/lsq/BulkForm';
import '@/styles/lpx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lsq.bulk'))('title') };
}
export const dynamic = 'force-dynamic';

type Mine = { on: boolean; maxRows: number; columns: string[]; required: string[]; template: string;
  jobs: Array<{ id: string; state: string; rows: number; made: number; failed: number; createdAt: string }> };
const KEYS = ['template', 'pick', 'paste', 'preview', 'confirm', 'busy', 'failed', 'line', 'state', 'titleCol', 'problems', 'stVALID', 'stINVALID', 'stCREATED', 'stFAILED', 'verifyFirst'] as const;

/** SB-MYP-LSQ-010 매물 일괄 등록 (v10.602 · docs/744) — GET /lsq/me/bulk · 미리보기 → 확정(검수 큐) */
export default async function ListingBulkPage() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('lsq.bulk');
  const d = await apiGetPersonal<Mine>('/lsq/me/bulk').catch(() => null);
  const labels = Object.fromEntries(KEYS.map((k) => [k, t.raw(k) as string]));
  return (
    <div data-screen="SB-MYP-LSQ-010" data-lsq-bulk={d?.on ? 'on' : 'off'}>
      <MyHead title={t('title')} sub={t('sub')} />
      {!d || !d.on ? <Note kind="warn">{t('off')}</Note> : (
        <>
          <Note kind="info">{t('columns', { cols: d.columns.join(', '), need: d.required.join(', ') })} {t('max', { n: d.maxRows })}</Note>
          <LsqBulkForm labels={labels} template={d.template} />
        </>
      )}
      <h2 className="lpx-h2">{t('jobs')}</h2>
      {!d || d.jobs.length === 0 ? <Empty>{t('none')}</Empty> : (
        <ul className="lpx-list" data-lsq-bulk-jobs={d.jobs.length}>
          {d.jobs.map((j) => <li key={j.id}>{t('jobLine', { at: ymdKst(j.createdAt), rows: j.rows, made: j.made, failed: j.failed })}</li>)}
        </ul>
      )}
    </div>
  );
}
