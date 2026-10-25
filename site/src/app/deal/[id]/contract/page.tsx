import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { dtKst } from '@/lib/format';
import { getFmt } from '@/lib/getFmt';
import { ContractPanel } from '@/components/ContractPanel';
import { DealShell } from '@/components/deal/DealShell';
import { loadDeal } from '@/components/deal/load';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('contract') };
}

/**
 * SB-HOM-DEL-010 계약서 — v10.31 시안 scDeal: 3단계 띠 · 거래 정보 표 · 계약 조건 표 · 「다음 — 결제 단계」 · 계약서 내려받기.
 *   계약서 발급 · 서명(ContractPanel)은 그대로 — 발급 시점에 합의 금액이 고정(D-03) · 양측 서명이면 성사 확정 · 정산 신청(A-15).
 */
export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await me())) redirect('/login');
  const r = await loadDeal(id);
  if ('error' in r) return <div className="w1 w1-wrap"><div className="w1-empty">{r.error}</div></div>;
  const d = r.d;
  const c = d.contract;
  const t = await getTranslations('deal.contract');
  const f = await getFmt();
  const rows: Array<[string, React.ReactNode]> = [
    [t('target'), d.title ?? '—'],
    [t('amount'), d.amount != null ? f.won(d.amount) : t('amountPending')],
    [t('fee'), d.agreedFee != null ? t('feeValue', { fee: f.won(d.agreedFee) }) : t('feePending')],
    [t('bearer'), d.feeBearerLabel ?? t('bearerPending')],
    [t('refCode'), d.refCode ? `${d.refCode} · tier ${d.tier}` : t('none')],
    [t('due'), d.dueDate ?? t('duePending')],
    [t('pay'), t('payValue')],
    [t('dispute'), t('disputeValue')],
  ];
  if (d.special) rows.splice(6, 0, [t('special'), d.special]);
  return (
    <DealShell d={d} step={0} title={t('title')} sub={t('sub')}>
      <h2 className="w1-s2">{t('terms')}</h2>
      <table className="w1-tb"><thead><tr><th style={{ width: 140 }}>{t('thItem')}</th><th>{t('thContent')}</th></tr></thead>
        <tbody>{rows.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v}</td></tr>)}</tbody></table>
      <div className="w1-nt" style={{ marginTop: 10 }}>{t.rich('feeNote', { b: (x) => <b>{x}</b> })}</div>

      <h2 className="w1-s2">{t('issueTitle')}</h2>
      <p className="w1-ls" style={{ margin: '0 0 8px' }}>{t.rich('issueNote', { b: (x) => <b>{x}</b> })}</p>
      <Msgs ns={['deal']}><ContractPanel dealId={d.id} initial={c ? { id: '', issuedAt: c.issuedAt, signedByBuyerAt: c.signedBuyerAt, signedBySellerAt: c.signedSellerAt } : null} /></Msgs>

      <div className="w1-dact">
        <Link className="w1-bp" href={`/deal/${d.id}/payment`}>{t('next')}</Link>
        {/* v10.32 — 시안처럼 「계약서 내려받기」 단추를 늘 둡니다(발급 전에는 누를 수 없고 까닭을 옆에 적음) */}
        {c?.hasDocument
          ? <Link className="w1-bo" href={`/my/contracts`} data-contract-download>{t('download')}</Link>
          : <><button type="button" className="w1-bo" disabled data-contract-download title={t('downloadTitle')}>{t('download')}</button>
            <span className="w1-ls" style={{ alignSelf: 'center' }}>{t('downloadHint', { issued: c ? t('issuedParen', { at: dtKst(c.issuedAt) }) : '' })}</span></>}
      </div>
    </DealShell>
  );
}
