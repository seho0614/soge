/** SB-HLT-RTN-020 취소 · 반품 내역 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltReturn } from '@/components/health/types';
import { HltEmpty } from '@/components/health/HltParts';
import { MyHltNav } from '@/components/health/MyHltNav';
import {
  krw, reasonLabel, RETURN_KIND, RETURN_REASONS, RETURN_SHIP_ROUND_TRIP, RETURN_STATE, RETURN_TONE, ymd,
} from '@/components/health/util';

export const metadata: Metadata = { title: '취소 · 반품 내역 · 소개몰' };
export const dynamic = 'force-dynamic';

/** 교환 배송비 상태 — 서버 FEE_STATE_SQL */
const FEE_STATE: Record<string, string> = {
  NONE: '없음', UNPAID: '결제 전 — 결제하셔야 교환을 처리합니다', PAID: '결제 완료', REFUNDED: '돌려드림',
};

/** 취소 · 반품 내역 — GET /me/health/returns (본인 것만, 최근 50건) */
export default async function MyHltReturns() {
  if (!(await me())) redirect('/login');

  let rows: HltReturn[] | null = null;
  let err: string | null = null;
  try {
    rows = await apiGetPersonal<HltReturn[]>('/me/health/returns');
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '내역을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }

  return (
    <><div className="hlt">
      <MyHltNav on="returns" />
      <div className="page-head">
        <h1>취소 · 반품 내역</h1>
        <Link className="hlt-btn sm" href="/my/health/returns/new">새로 신청</Link>
      </div>
      {rows === null ? (
        <p className="form-error" role="alert">{err}</p>
      ) : rows.length === 0 ? (
        <HltEmpty msg="취소·반품 내역이 없습니다." href="/my/health/orders" label="주문 내역" />
      ) : (
        <div className="rows">
          {rows.map((r) => {
            const party = RETURN_REASONS.find((x) => x.code === r.reason)?.party;
            return (
              <div key={r.id} className="hlt-ord">
                <div className="hlt-ord-h">
                  <span>{ymd(r.createdAt)} · <b>{RETURN_KIND[r.kind] ?? r.kind}</b></span>
                  <span className={`state state-${RETURN_TONE[r.state] ?? 'requested'}`}>{RETURN_STATE[r.state] ?? r.state}</span>
                </div>
                <table className="tbl hlt-tbl">
                  <tbody>
                    <tr><th>주문번호</th><td><Link href={`/my/health/orders/${encodeURIComponent(r.orderNo)}`}>{r.orderNo}</Link></td></tr>
                    <tr><th>사유</th><td>{reasonLabel(r.reason)}</td></tr>
                    {party && r.kind === 'RETURN' && (
                      <tr><th>비용 부담</th><td>{party === 'CUSTOMER'
                        ? `고객 부담 (왕복 배송비 ${krw(RETURN_SHIP_ROUND_TRIP)} — 환불액에서 뺍니다)`
                        : '판매자 부담 (비용 없음)'}</td></tr>
                    )}
                    {r.convertedFrom && <tr><th>바뀐 신청</th><td>교환 신청을 반품으로 바꿨습니다 (재고가 없어 교환할 수 없었던 경우 · 판매 약관)</td></tr>}
                    {/* v10.26 — 교환 배송비(회원 사정 왕복 · 신청 때 결제). 회사 사정 교환은 0원 */}
                    {r.kind === 'EXCHANGE' && (
                      <tr data-fee-state={r.feeState ?? 'NONE'}><th>교환 배송비</th><td>
                        {r.feeState === 'REFUNDED'
                          ? '결제하신 교환 배송비를 돌려드렸습니다'
                          : (r.exchangeFee ?? 0) > 0 ? `${krw(r.exchangeFee)} · ${FEE_STATE[r.feeState ?? 'NONE']}` : '없음 (판매자 부담)'}
                        {r.feeState === 'UNPAID' && r.state === 'REQUESTED' && (
                          <> <Link className="hlt-btn sm pri" href={`/my/health/returns/${encodeURIComponent(r.id)}/fee`} data-fee-pay-link>결제하기</Link></>
                        )}
                      </td></tr>
                    )}
                    {r.kind !== 'EXCHANGE' && r.beforePayment && <tr><th>환불 금액</th><td data-before-payment>결제 전 취소 — 낸 돈이 없어 환불이 없습니다</td></tr>}
                    {r.kind !== 'EXCHANGE' && !r.beforePayment && <tr><th>환불 금액</th><td data-ship-deduction={r.shipDeduction ?? 0}>{r.refundAmount != null ? krw(r.refundAmount) : '확정 전'}{(r.shipDeduction ?? 0) > 0 && ` (왕복 배송비 ${krw(r.shipDeduction!)} 차감)`}{r.refundedAt && ` · ${ymd(r.refundedAt)} 환불`}</td></tr>}
                    {r.decideNote && <tr><th>처리 메모</th><td>{r.decideNote}</td></tr>}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
