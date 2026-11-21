import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { LsqReturnEvidenceBox } from '@/components/lsq/ReturnEvidenceBox';
import '@/styles/lpx.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  const tr = await getTranslations('lsq.ret');
  return { title: t('meta.title', { title: tr('seller') }) };
}
export const dynamic = 'force-dynamic';

type Rows = { on: boolean; items: Array<{ id: string; kind: string; state: string; orderNo: string; createdAt: string; photos: number; verdicts: number }> };

/** SB-HLT-LSQ-020 판매자센터 › 반품 사진 · 판정 (v10.608 · docs/750) — GET /lsq/seller/returns · 신청마다 사진 · 판정 기록(LsqReturnEvidence) */
export default async function SellerReturnEvidencePage() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('hlt.center');
  const tr = await getTranslations('lsq.ret');
  const d = await apiGetPersonal<Rows>('/lsq/seller/returns').catch(() => null);
  const ST: Record<string, string> = { REQUESTED: tr('sREQUESTED'), APPROVED: tr('sAPPROVED'), REJECTED: tr('sREJECTED'), REFUNDED: tr('sREFUNDED') };
  return (
    <><div className="hlt" data-screen="SB-HLT-LSQ-020" data-lsq-seller-returns={d?.items.length ?? 0}>
      <HltNav back="/health/seller/center" />
      <Crumb items={[{ href: '/health/seller', label: t('apply') }, { href: '/health/seller/center', label: tr('back') }, { label: tr('seller') }]} />
      <div className="page-head"><h1>{tr('seller')}</h1></div>
      <p className="hlt-mut">{tr('sellerSub')}</p>
      {d && !d.on && <p className="warn-text">{tr('off')}</p>}
      {!d || d.items.length === 0 ? <HltEmpty msg={tr('sellerEmpty')} href="/health/seller/center" label={tr('back')} /> : (
        <div className="rows">
          {d.items.map((r) => (
            <section key={r.id} className="hlt-box" data-lsq-seller-return={r.id}>
              <h3>{r.orderNo} · {ST[r.state] ?? r.state}</h3>
              <LsqReturnEvidenceBox returnId={r.id} />
            </section>
          ))}
        </div>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
