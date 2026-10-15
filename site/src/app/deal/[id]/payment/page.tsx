import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { dtKst, won } from '@/lib/format';
import { PaymentReportForm } from '@/components/PaymentReportForm';
import { DealShell } from '@/components/deal/DealShell';
import { loadDeal } from '@/components/deal/load';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '결제 · 대금' };

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
  const by = (p: string) => d.payments.find((x) => x.party === p);
  const n = ['BUYER', 'SELLER'].filter((p) => by(p)).length;
  return (
    <DealShell d={d} step={1} title="결제 · 대금" sub="대금은 당사자끼리 직접 주고받습니다. 플랫폼은 보관하거나 중계하지 않습니다 — 여기서는 지급 사실만 신고합니다 (INV-11).">
      <div className="w1-esc">
        <div className="er"><span>거래금액</span><b>{d.amount != null ? won(d.amount) : '합의 전'}</b>
          {d.amount != null && <span className={`w1-bg ${d.amount >= 50_000_000 ? 'ok' : 'off'}`}>{d.amount >= 50_000_000 ? '5,000만원 이상' : '5,000만원 미만'}</span>}</div>
        <div className="er"><span>대금 수수</span><b>당사자 직접</b><span className="w1-bg off">에스크로 미사용</span></div>
        <div className="er"><span>양측 지급 신고</span><b>{n} / 2</b><span className={`w1-bg ${n === 2 ? 'ok' : 'wait'}`}>{n === 2 ? '완료' : '대기'}</span></div>
      </div>
      <div className="w1-nt">플랫폼은 대금을 보관하지 않습니다. 지급 신고는 성사 확정과 분쟁 때 근거로 쓰입니다 — 금액 · 계좌는 받지 않습니다.</div>

      <h2 className="w1-s2">신고 현황</h2>
      <table className="w1-tb"><thead><tr><th>당사자</th><th>대금 지급 신고</th></tr></thead>
        <tbody>
          {([['BUYER', d.buyer], ['SELLER', d.seller]] as const).map(([p, name]) => {
            const x = by(p);
            return <tr key={p}><td><b>{name}</b>{d.myRole === p ? ' (나)' : ''}</td>
              <td>{x ? <><span className="w1-bg ok">신고</span> {dtKst(x.reportedAt)} · {x.method}</> : <span className="w1-bg wait">미신고</span>}</td></tr>;
          })}
        </tbody></table>
      <div className="w1-nt" style={{ marginTop: 10 }}><b>관에 따라 이 단계를 건너뛸 수 있습니다.</b> 계약서 없이 진행한 거래는 성사 확정에서 양측이 각각 확인하면 됩니다.</div>

      {d.myRole !== 'INTRODUCER' && (<><h2 className="w1-s2">대금 지급 신고</h2><PaymentReportForm dealId={d.id} /></>)}

      <div className="w1-dact">
        <Link className="w1-bp" href={`/deal/${d.id}/confirm`}>다음 — 성사 확정</Link>
        <Link className="w1-bo" href={`/deal/${d.id}/contract`}>이전 — 계약서</Link>
      </div>
    </DealShell>
  );
}
