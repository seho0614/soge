import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { SettlementAccountForm } from '@/components/partners/SettlementAccountForm';
import { krw, ymd, SETTLE_STATE, TRACK } from '@/components/partners/fmt';
import type { AffSettlements } from '@/components/partners/types';

export const metadata: Metadata = { title: '정산내역' };

/**
 * SB-AFC-STL-010 정산내역
 *
 * GET /partner/affiliate/settlements · POST /partner/affiliate/settlement-account
 * · POST /partner/affiliate/settlement-account/verify/request · POST /partner/affiliate/settlement-account/verify (D001 1원 인증)
 * ★ 계좌 등록은 본인인증(IDENTITY_VERIFIED) 뒤에만 됩니다 — 403 IDENTITY_REQUIRED 면 /verify 로.
 * ★ 원천징수 3.3% 는 사업소득세입니다. 실지급액과 함께 적어 둡니다.
 */
export default async function PartnerSettlementsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const d = await apiGetPersonal<AffSettlements>('/partner/affiliate/settlements').catch(() => null);
  const acc = d?.account ?? null;

  return (
    <>
      <div className="page-head"><h1>정산내역</h1></div>
      <p className="lead">지급 내역과 정산 계좌입니다.</p>

      {d?.note && <div className="notice warn"><b>{d.note}</b> {acc ? <>아래 「계좌 1원 인증」에서 인증하십시오.</> : null}</div>}

      {d === null ? (
        <p className="form-error" role="alert">정산 내역을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : d.items.length === 0 ? (
        <p className="empty">아직 정산된 내역이 없습니다. 주문이 확정되면 월 단위로 정산합니다.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>기간</th><th>트랙</th><th className="num">총액</th><th className="num">원천징수</th><th className="num">실지급</th><th>상태</th><th>지급일</th></tr></thead>
          <tbody>
            {d.items.map((s) => (
              <tr key={s.id}>
                <td>{ymd(s.from)} ~ {ymd(s.to)}</td>
                <td>{TRACK[s.track] ?? s.track}</td>
                <td className="num">{krw(s.gross)}</td>
                <td className="num">{krw(s.withholding)}</td>
                <td className="num"><b>{krw(s.net)}</b></td>
                <td><span className={'state ' + (SETTLE_STATE[s.state]?.c ?? '')}>{SETTLE_STATE[s.state]?.t ?? s.state}</span></td>
                <td>{ymd(s.paidAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="notice"><b>원천징수 3.3%</b>는 사업소득세입니다. 연말에 종합소득세 신고를 하시면 정산됩니다.</div>

      <h2 className="sec-title p2gap">정산 계좌</h2>
      {acc ? (
        <table className="tbl">
          <tbody>
            <tr><th>은행</th><td>{acc.bankName} <span className="dim">끝 {acc.last4}</span></td></tr>
            <tr><th>예금주</th><td>{acc.holderName}</td></tr>
            <tr><th>상태</th><td data-testid="account-state">{acc.verifiedAt
              ? <><span className="state state-published">인증 완료</span> <span className="dim">{ymd(acc.verifiedAt)}</span></>
              : acc.verifyLocked
                ? <span className="state state-rejected">인증 막힘 — 계좌를 다시 등록하십시오</span>
                : acc.verifyPending
                  ? <span className="state state-in_review">코드 입력 대기</span>
                  : <span className="state state-in_review">1원 인증 전</span>}</td></tr>
          </tbody>
        </table>
      ) : <p className="empty">등록된 정산 계좌가 없습니다. 계좌가 없으면 지급되지 않습니다.</p>}
      <SettlementAccountForm hasAccount={!!acc} identityVerified={!!p.identityVerifiedAt} account={acc} />
    </>
  );
}
