import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { dtKst, won } from '@/lib/format';
import { PaymentReportForm } from '@/components/PaymentReportForm';
import { DealShell } from '@/components/deal/DealShell';
import { loadDeal } from '@/components/deal/load';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('payment') };
}

/**
 * SB-HOM-DEL-020 결제 · 대금 — v10.31 시안 scDealPay 의 모양: 3단계 띠 · 거래 정보 표 · 금액 · 대금 수수 · 양측 3칸 · 현황 표 · 다음/이전.
 *   시안의 에스크로(5,000만원 이상 · 양측 동의)는 실제 웹에서 폐지된 상태(INV-11 — 플랫폼은 자금을 보관 · 중계하지 않음)라
 *   「양측 동의」 칸은 양측의 **대금 지급 신고** 현황으로 보입니다(실제 자료). 에스크로 재도입은 결제대행 · 법무 판단이 필요해 이번에 하지 않음(결정 기록).
 *   대금 지급 신고 폼(PaymentReportForm)은 그대로.
 */
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await me())) redirect('/login');
  const r = await loadDeal(id);
  if ('error' in r) return <div className="w1 w1-wrap"><div className="w1-empty">{r.error}</div></div>;
  const d = r.d;
  const t = await getTranslations('deal');
  const by = (p: string) => d.payments.find((x) => x.party === p);
  const n = ['BUYER', 'SELLER'].filter((p) => by(p)).length;
  return (
    <DealShell d={d} step={1} title={t('pay.title')} sub={t('pay.sub')}>
      <div className="w1-esc">
        <div className="er"><span>{t('pay.amount')}</span><b>{d.amount != null ? won(d.amount) : t('pay.amountPending')}</b>
          {d.amount != null && <span className={`w1-bg ${d.amount >= 50_000_000 ? 'ok' : 'off'}`}>{d.amount >= 50_000_000 ? t('pay.over') : t('pay.under')}</span>}</div>
        <div className="er"><span>{t('pay.transfer')}</span><b>{t('pay.direct')}</b><span className="w1-bg off">{t('pay.noEscrow')}</span></div>
        <div className="er"><span>{t('pay.reports')}</span><b>{n} / 2</b><span className={`w1-bg ${n === 2 ? 'ok' : 'wait'}`}>{n === 2 ? t('pay.done') : t('common.wait')}</span></div>
      </div>
      <div className="w1-nt">{t('pay.note')}</div>

      <h2 className="w1-s2">{t('pay.status')}</h2>
      <table className="w1-tb"><thead><tr><th>{t('pay.thParty')}</th><th>{t('pay.thReport')}</th></tr></thead>
        <tbody>
          {([['BUYER', d.buyer], ['SELLER', d.seller]] as const).map(([p, name]) => {
            const x = by(p);
            return <tr key={p}><td><b>{name}</b>{d.myRole === p ? t('common.me') : ''}</td>
              <td>{x ? <><span className="w1-bg ok">{t('pay.reported')}</span> {dtKst(x.reportedAt)} · {x.method}</> : <span className="w1-bg wait">{t('pay.notReported')}</span>}</td></tr>;
          })}
        </tbody></table>
      <div className="w1-nt" style={{ marginTop: 10 }}>{t.rich('pay.skipNote', { b: (c) => <b>{c}</b> })}</div>

      {d.myRole !== 'INTRODUCER' && (<><h2 className="w1-s2">{t('pay.thReport')}</h2><Msgs ns={['deal']}><PaymentReportForm dealId={d.id} /></Msgs></>)}

      <div className="w1-dact">
        <Link className="w1-bp" href={`/deal/${d.id}/confirm`}>{t('pay.next')}</Link>
        <Link className="w1-bo" href={`/deal/${d.id}/contract`}>{t('pay.prev')}</Link>
      </div>
    </DealShell>
  );
}
