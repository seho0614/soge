import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { dtKst, won } from '@/lib/format';
import { ContractPanel } from '@/components/ContractPanel';
import { DealShell } from '@/components/deal/DealShell';
import { loadDeal } from '@/components/deal/load';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '계약 · 성사 확정' };

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
  const rows: Array<[string, React.ReactNode]> = [
    ['거래 대상', d.title ?? '—'],
    ['거래 금액', d.amount != null ? won(d.amount) : '계약 조건 합의 전'],
    ['소개비', d.agreedFee != null ? `${won(d.agreedFee)} (양측 협의 · A-12)` : '협의 전'],
    ['소개비 부담', d.feeBearerLabel ?? '협의'],
    ['소개코드', d.refCode ? `${d.refCode} · tier ${d.tier}` : '없음'],
    ['이행 예정일', d.dueDate ?? '합의 전'],
    ['대금 지급', '당사자끼리 직접 — 플랫폼은 보관 · 중계하지 않습니다(INV-11)'],
    ['분쟁 처리', '고객센터 분쟁 접수 → 정산 보류 → 운영 조정(분쟁조정 안내)'],
  ];
  if (d.special) rows.splice(6, 0, ['특약', d.special]);
  return (
    <DealShell d={d} step={0} title="계약 · 성사 확정" sub="계약 조건을 양측이 확인하는 자리입니다. 소개뱅크는 통신판매중개자이며 거래 당사자가 아닙니다.">
      <h2 className="w1-s2">계약 조건</h2>
      <table className="w1-tb"><thead><tr><th style={{ width: 140 }}>항목</th><th>내용</th></tr></thead>
        <tbody>{rows.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v}</td></tr>)}</tbody></table>
      <div className="w1-nt" style={{ marginTop: 10 }}><b>소개비는 요율표로 산정하지 않습니다 (A-12).</b> 위 금액은 당사자끼리 협의해서 정한 값이고, 플랫폼은 금액에 관여하지 않습니다. 확정 이후 금액을 바꾸면 양측이 다시 확인해야 합니다.</div>

      <h2 className="w1-s2">계약서 발급 · 서명</h2>
      <p className="w1-ls" style={{ margin: '0 0 8px' }}>발급하면 <b>합의한 소개비가 고정</b>됩니다. 이후 변경은 양측 재동의와 사유가 필요합니다.</p>
      <ContractPanel dealId={d.id} initial={c ? { id: '', issuedAt: c.issuedAt, signedByBuyerAt: c.signedBuyerAt, signedBySellerAt: c.signedSellerAt } : null} />

      <div className="w1-dact">
        <Link className="w1-bp" href={`/deal/${d.id}/payment`}>다음 — 결제 단계</Link>
        {/* v10.32 — 시안처럼 「계약서 내려받기」 단추를 늘 둡니다(발급 전에는 누를 수 없고 까닭을 옆에 적음) */}
        {c?.hasDocument
          ? <Link className="w1-bo" href={`/my/contracts`} data-contract-download>계약서 내려받기</Link>
          : <><button type="button" className="w1-bo" disabled data-contract-download title="계약서를 발급하면 내려받을 수 있습니다">계약서 내려받기</button>
            <span className="w1-ls" style={{ alignSelf: 'center' }}>계약서를 발급하면 내려받을 수 있습니다{c ? ` (발급 ${dtKst(c.issuedAt)})` : ''}.</span></>}
      </div>
    </DealShell>
  );
}
