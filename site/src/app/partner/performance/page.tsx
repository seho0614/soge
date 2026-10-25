import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tile, Tw, won } from '@/components/partner/ui';
import { ReportForm } from './ReportForm';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('performance') };
}

interface Perf {
  rows: Array<{ id: string; no: string; content: string; doneOn: string; amount: number | null; consumerState: string; consumerAt: string | null;
    rating: number | null; reportedAt: string; summary: string; consumerCanConfirm: boolean }>;
  open: Array<{ deliveryId: string; summary: string; categoryName: string | null; viewedAt: string }>;
  metrics: { received: number; viewed: number; avgViewMin: number | null; billed: number };
  note: string;
}

/**
 * SB-PTC-CTR-450 성과 관리 — v10.31 (W5 · 10/10 시안 기준 scPtnPerf)
 *   「거래 · 내용 · 이행 보고 · 보고 상태 · 소비자 확인」 표 → 안내 → 이행 보고 폼.
 *   계약 성사형은 파트너가 이행을 보고하고 **소비자가 확인해야 성사**입니다(서버 partner_fulfillment_reports).
 *   개발에만 있던 실적 4칸(받은 리드 · 열람률 · 평균 열람 · 이용료 확정)은 아래에 둡니다(유지).
 */
export default async function PerformancePage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('partner.perf');
  const f = await getFmt();
  const tp = await getTranslations('partner');
  const mins = (m: number | null | undefined) => (m == null ? '—' : m < 60 ? tp('common.min', { n: String(m) }) : tp('common.hour', { n: String(Math.round(m / 60)) }));
  const d = await apiGet<Perf>('/partner/performance', 0).catch(() => null);
  if (!d) return <><Pgh title={t('title')} /><Empty>{tp('common.notPartner')}</Empty><i hidden data-root-end="" /></>;
  const m = d.metrics;
  const rate = m.received ? Math.round((m.viewed / m.received) * 1000) / 10 : null;

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      {d.rows.length === 0 ? <Empty>{t('empty')}</Empty> : (
        <Tw head={[t('thDeal'), t('thContent'), t('thReport'), t('thReportSt'), t('thConsumer')]}>
          {d.rows.map((r) => (
            <tr key={r.id}>
              <td><b className="pt-code">{r.no}</b></td>
              <td>{r.content}<div className="pt-ls">{r.summary}{r.amount ? ` · ${f.wonOf(won(r.amount))}` : ''}</div></td>
              <td>{ymdKst(r.doneOn)}</td>
              <td><Bg tone="ok">{t('reported')}</Bg></td>
              <td>{r.consumerState === 'CONFIRMED' ? <Bg tone="ok">{t('confirmed')}{r.rating ? ` · ★${r.rating}` : ''}</Bg>
                : r.consumerState === 'DISPUTED' ? <Bg tone="no">{t('disputed')}</Bg>
                : <><Bg tone="wait">{t('waitCustomer')}</Bg>{!r.consumerCanConfirm ? <div className="pt-ls">{t('noConfirmUi')}</div> : null}</>}</td>
            </tr>
          ))}
        </Tw>
      )}
      <Note kind="info"><b>{d.note}</b></Note>
      <Note kind="warn">{t.rich('consumerNote', { b: (c) => <b>{c}</b> })}</Note>

      <S2>{t('report')}</S2>
      <div className="pt-fset"><ReportForm open={d.open.map((o) => ({ deliveryId: o.deliveryId, summary: o.summary, categoryName: o.categoryName }))} /></div>

      <S2>{t('metrics')}</S2>
      <div className="pt-tiles" data-ptn-perf>
        <Tile label={t('recv')} value={(m.received ?? 0).toLocaleString('ko-KR')} unit={tp('common.unit.case')} href="/partner/leads" />
        <Tile label={t('viewRate')} value={rate ?? '—'} unit={rate != null ? '%' : undefined} sub={t('viewRateSub')} href="/partner/trust" />
        <Tile label={t('avgView')} value={mins(m.avgViewMin)} sub={t('avgViewSub')} href="/partner/trust" />
        <Tile label={t('billed')} value={(m.billed ?? 0).toLocaleString('ko-KR')} unit={tp('common.unit.case')} sub={t('billedSub')} href="/partner/cash" />
      </div>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/stats">{t('statsLink')}</Link>
        <Link className="pt-bo" href="/partner/trust">{t('trustLink')}</Link>
        <Link className="pt-bo" href="/partner/services">{tp('common.toServices')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
