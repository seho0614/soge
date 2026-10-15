import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tw, won, type Tone } from '@/components/partner/ui';
import { SettlementAccountForm } from '@/components/partners/SettlementAccountForm';

export const metadata: Metadata = { title: '파트너 정산' };

interface S {
  unpaid: string; billed: string; voided: string; unpaidCount: number; unpaidCap: number;
  months: Array<{ month: string; leads: number; amount: string }>;
  payouts: Array<{ id: string; track: string; from: string; to: string; month: string; gross: number; withholding: number; net: number; state: string; paidAt: string | null; deals: number }>;
  account: { bankName: string; last4: string; holderName: string; verifiedAt: string | null; verifyStub: boolean } | null;
  /* v10.34 (D093) — 운영 법인이 발행하는 두 가지(리드 이용료 · 노출료)는 국세청 전송 상태 · 승인번호 */
  invoices: Array<{ kind: string; invoiceNo: string | null; issuedOn: string | null; total: number; supply: number | null; vat: number | null; state: string; month: string; etaxStatus?: string | null; approvalNo?: string | null }>;
  payoutDay: number; note: string;
}
const ST: Record<string, [string, Tone]> = { DRAFT: ['정산 예정', 'wait'], CONFIRMED: ['정산 예정', 'wait'], PAID: ['지급 완료', 'ok'], CARRIED: ['이월', 'off'] };
const TRACK: Record<string, string> = { AFFILIATE: '제휴수수료', REFERRAL: '소개 정산' };
/** v10.34 — 세금계산서 상태(사실 그대로) — 간주면 「전송 대기 — 연동 전」 */
const invSt = (i: S['invoices'][number]): [string, Tone] => i.etaxStatus === 'SENT' ? ['발행 · 국세청 전송', 'ok']
  : i.etaxStatus === 'ASSUMED' ? ['전송 대기 — 연동 전', 'wait']
  : i.etaxStatus === 'CANCELED' ? ['취소 · 수정 발행', 'off']
  : i.etaxStatus === 'SENDING' || i.etaxStatus === 'FAILED' ? ['발행 처리 중', 'wait']
  : i.state === 'ISSUED' ? ['발행', 'ok'] : ['발행 요청', 'wait'];
const nextPay = (to: string, day: number) => { const [y, m] = to.split('-').map(Number); const d = new Date(Date.UTC(y ?? 1970, m ?? 0, day)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

/**
 * SB-PTC-CTR-410 정산 — v10.31 (W5 · 10/10 시안 기준 scPtnStl) 「성사된 소개의 정산 내역과 수령 계좌」
 *   정산 표(정산월 · 성사 · 금액 · 상태 · 지급일) → 정산 수령 계좌(인증) → 안내 → 세금계산서.
 *   ★ 정산 대상(정책 차이 — 결정 기록): 전에는 리드 이용료 청구 내역이었습니다. 이제 시안대로 **회사가 지급하는 정산**(partner_settlements ·
 *     지급 데스크 두 사람 확인)과 그 기간의 성사 건수입니다. 리드 이용료는 「리드 이용료」(선불 충전)에서 봅니다.
 *   소개비는 여기 없습니다 — 당사자끼리 직접(INV-9R). v10.38 (D096 · P2P) — 정산은 본인인증 개인도 봅니다(원천징수 3.3% · 세금계산서 대신 영수증).
 */
export default async function SettlementPage() {
  const p = await me();
  if (!p) redirect('/login');
  if (!p.identityVerifiedAt && !p.businessVerifiedAt) {
    return (
      <><Pgh title="정산" />
        <Note kind="warn"><b>본인인증이 필요합니다.</b> 정산은 본인 확인 뒤에 받으실 수 있습니다(사업자 인증은 선택 — 개인은 세금계산서 대신 영수증).</Note>
        <div className="pt-dact"><Link className="pt-bp" href="/verify">인증하러 가기</Link></div>
      <i hidden data-root-end="" /></>
    );
  }
  const s = await apiGet<S>('/partner/settlement', 0).catch(() => null);
  if (!s) return <><Pgh title="정산" /><Empty>파트너가 아닙니다.</Empty><i hidden data-root-end="" /></>;
  const acc = s.account;

  return (
    <><Pgh title="정산" sub="성사된 소개의 정산 내역과 수령 계좌입니다." />
      {s.payouts.length === 0 ? <Empty>아직 정산 내역이 없습니다. 정산이 확정되면 여기에 쌓이고, 익월 {s.payoutDay}일에 지급합니다.</Empty> : (
        <Tw head={['정산월', '성사', '금액', '상태', '지급일']} numCols={[2]}>
          {s.payouts.map((r) => {
            const st = ST[r.state] ?? [r.state, 'off' as Tone];
            return (
              <tr key={r.id}>
                <td><b>{r.month}</b><div className="pt-ls">{ymdKst(r.from)} ~ {ymdKst(r.to)} · {TRACK[r.track] ?? r.track}</div></td>
                <td>성사 {r.deals}건</td>
                <td className="num"><b>{won(r.net)}원</b><div className="pt-ls">총 {won(r.gross)} · 원천징수 {won(r.withholding)}</div></td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td>{r.paidAt ? ymdKst(r.paidAt) : `${nextPay(r.to, s.payoutDay)} 예정`}</td>
              </tr>
            );
          })}
        </Tw>
      )}
      <div className="pt-bank" data-ptn-bank>
        <span>정산 수령 계좌</span>
        {acc ? <><b>{acc.bankName} ****{acc.last4} · {acc.holderName}</b>{acc.verifiedAt ? <Bg tone="ok">인증됨</Bg> : <Bg tone="wait">대기</Bg>}{acc.verifyStub ? <span className="pt-ls">1원 인증 연동 전 — 간주</span> : null}</>
          : <b>등록된 계좌가 없습니다</b>}
      </div>
      <Note kind="info"><b>{s.note}</b> 계좌를 바꾸시면 다시 인증해야 지급됩니다.</Note>
      <details className="pt-fset" style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>{acc ? '계좌 변경 · 인증' : '계좌 등록 · 인증'}</summary>
        <div style={{ marginTop: 12 }}><SettlementAccountForm hasAccount={!!acc} identityVerified={!!p.identityVerifiedAt} account={acc ?? undefined} /></div>
      </details>

      <S2>세금계산서</S2>
      {s.invoices.length === 0 ? <Empty>발행 내역이 없습니다. 정산 지급분과 리드 이용료(유상 잔액 사용분)의 세금계산서가 달마다 여기에 쌓입니다.</Empty> : (
        <Tw head={['월', '구분', '공급가액', '세액', '합계', '상태', '번호 · 발행일']} numCols={[2, 3, 4]}>
          {s.invoices.map((i, k) => (
            <tr key={k}>
              <td>{i.month}</td><td>{i.kind === 'LEAD_CASH' ? '리드 이용료' : i.kind === 'DIRECTORY' ? '법률·세무 노출료' /* v10.33 */ : '정산 지급'}</td>
              <td className="num">{i.supply != null ? `${won(i.supply)}원` : '—'}</td><td className="num">{i.vat != null ? `${won(i.vat)}원` : '—'}</td>
              <td className="num"><b>{won(i.total)}원</b></td>
              <td><Bg tone={invSt(i)[1]}>{invSt(i)[0]}</Bg></td>
              <td>{i.invoiceNo ? <><span className="pt-code">{i.invoiceNo}</span> · {ymdKst(i.issuedOn)}</> : '—'}</td>
            </tr>
          ))}
        </Tw>
      )}
      <Note kind="warn"><b>국세청 전자세금계산서 연동 전입니다.</b> 「발행 요청」은 금액이 확정됐다는 뜻이고, 「전송 대기 — 연동 전」은 본사가 발행 처리했지만 아직 국세청에 전송되지 않았다는 뜻입니다. 국세청에 전송되면 승인번호가 보입니다.</Note>
      {(Number(s.unpaid) > 0 || s.unpaidCount > 0) && (
        <Note kind="plain"><b>전환 전 후불 미청구 이용료 {won(s.unpaid)}원({s.unpaidCount}건)</b>은 종전대로 청구됩니다(파트너 이용약관 제6조).</Note>
      )}
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/cash">리드 이용료</Link>
        <Link className="pt-bo" href="/partners/settlements">제휴 정산내역</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
