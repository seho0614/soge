import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymd, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Seller {
  code: string; name: string; type: string; status: string;
  commissionRate: number | string; payable: boolean;
  onSale: number | string; expiredLicenses: number | string;
}
interface SettleRow {
  from: string; to: string; seller: string; sellerName: string;
  gross: number | string; commission: number | string; refund: number | string;
  carriedIn: number | string; net: number | string; carriedOut: number | string; status: string;
}
interface Settle {
  items: SettleRow[]; ready: { n: number; amount: number | string };
  blocked: Array<{ code: string; name: string; reason: string }>; note?: string;
}
interface Rate {
  categoryCode: string; rate: number | string; referralPct: number | string;
  note: string | null; updatedAt: string; changes: number;
}

interface ReturnRow {
  id: string; kind: string; reason: string; detail: string | null; state: string;
  decideNote: string | null; createdAt: string; decidedAt: string | null;
  orderNo: string; orderStatus: string; total: number | string;
  deliveredAt: string | null; restockedAt: string | null;
  buyerName: string; items: string | null; blockedIf: string | null;
  /* D006 — 개봉 판정 · 환불 */
  restockSkipped: string | null; customerOpened: boolean | null; opened: boolean | null;
  refundAmount: number | string | null; refundedAt: string | null; refundError: string | null;
  /** 환불 때 뺀 반품 배송비 (D009) */
  shipDeduction?: number | string | null;
  payState: string | null; payStub: boolean | null; payAmount: number | string | null; payMethod: string | null;
  /** v10.26 — 교환 배송비(회원 사정 교환 6,000원 · 신청 때 결제) · 결제 상태 · 반품으로 바꾼 신청 · 교환 접수 뒤 지난 날 */
  exchangeFee?: number | string; feeState?: 'NONE' | 'UNPAID' | 'PAID' | 'REFUNDED'; convertedFrom?: string | null;
  feeRefundError?: string | null; daysSince?: number | null;
}
const FEE: Record<string, string> = { NONE: '비용 없음(회사 사정)', UNPAID: '교환 배송비 결제 전', PAID: '교환 배송비 결제됨', REFUNDED: '교환 배송비 돌려드림' };
/** 교환할 상품이 없을 때 입고를 기다리는 날(약관 제3조) — 지나면 「반품으로 바꾸기」 */
const EXCHANGE_WAIT_DAYS = 14;

const RKIND: Record<string, string> = { CANCEL: '취소', RETURN: '반품', EXCHANGE: '교환' };
const RSTATE: Record<string, string> = { REQUESTED: '접수', APPROVED: '승인', REJECTED: '반려', REFUNDED: '환불 완료' };
const REASON: Record<string, string> = {
  CHANGE_MIND: '단순 변심', WRONG_ORDER: '잘못 주문', DEFECT: '파손 · 불량',
  WRONG_ITEM: '다른 상품', MISMATCH: '표시와 다름', DELAY: '배송 지연',
};
const OSTATE: Record<string, string> = {
  PENDING: '결제 대기', PAID: '결제 완료', PREPARING: '상품 준비중', SHIPPED: '배송중',
  DELIVERED: '배송 완료', CANCELED: '취소 완료', RETURNED: '반품 완료',
};

/**
 * 취소 · 반품 처리 (D002 · D006)
 *   GET /admin/health/returns · POST /admin/health/returns/{id}/decide · POST /admin/health/returns/{id}/refund
 *
 * 승인하면 주문이 취소·반품 완료로 바뀌고 **재고는 DB 가 한 번만 되돌립니다.**
 * 반품은 **개봉 여부를 골라야 승인됩니다**(D006, 사장님 결정 2026-10-02) — 개봉이면 재판매할 수 없어 재고로 되돌리지 않습니다.
 * 결제된 주문은 승인과 함께 환불됩니다. 환불이 실패하면 승인에 머물고 「환불 다시 시도」가 나옵니다.
 * 반려는 사유가 필수입니다(고객에게 보입니다).
 */
function HealthReturns() {
  const [state, setState] = useState('REQUESTED');
  const list = useApi<ReturnRow[]>(`/admin/health/returns?state=${state}`);
  const a = useAct();
  /* 반품별 개봉 판정 — 고르기 전에는 승인 버튼이 잠깁니다 */
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  /* v10.26 — 교환: 회사 사정으로 판정해 승인(교환 배송비를 받지 않고 낸 돈을 돌려드림) · 반품으로 바꾸기(교환할 상품 없음) · 교환 배송비 환불 다시 시도 */
  const sellerFault = (r: ReturnRow) => {
    if (!confirm(`${r.orderNo} 교환을 「회사 사정」으로 판정해 승인합니다.\n교환 배송비를 받지 않고${r.feeState === 'PAID' ? ` 낸 ${n(r.exchangeFee)}원을 돌려드립니다` : ''}.`)) return;
    void a.run(r.id, () => api<{ note: string }>(`/admin/health/returns/${r.id}/decide`, {
      method: 'POST', body: JSON.stringify({ state: 'APPROVED', sellerFault: true, note: '회사 사정으로 판정' }),
    }).finally(list.reload));
  };
  const convert = (r: ReturnRow) => {
    const note = prompt(`교환할 상품이 없어 반품으로 바꿉니다(약관 제3조 — ${EXCHANGE_WAIT_DAYS}일까지 입고를 기다림 · 회원이 원하면 바로). 까닭 — 고객에게 보입니다`,
      `교환할 상품이 ${EXCHANGE_WAIT_DAYS}일 안에 입고되지 않음`);
    if (note === null) return;
    void a.run(`cv-${r.id}`, () => api<{ note: string }>(`/admin/health/returns/${r.id}/convert`, { method: 'POST', body: JSON.stringify({ note }) }).finally(list.reload));
  };
  const feeRefund = (r: ReturnRow) => void a.run(`fr-${r.id}`, () => api<{ state: string }>(`/admin/health/returns/${r.id}/fee-refund`, { method: 'POST', body: '{}' }).finally(list.reload),
    undefined, (x) => (x?.state === 'REFUNDED' ? '교환 배송비를 돌려드렸습니다.' : '환불하지 못했습니다 — 다시 시도해 주십시오.'));

  const decide = (r: ReturnRow, ok: boolean) => {
    const note = ok ? undefined : prompt('반려 사유 — 고객에게 그대로 보입니다. 청약철회는 법이 준 권리라 근거가 필요합니다') ?? '';
    if (!ok && !note?.trim()) return;
    const op = r.kind === 'RETURN' ? opened[r.id] : undefined;
    if (ok && r.kind === 'RETURN' && op === undefined) return;
    const stock = r.kind === 'EXCHANGE' ? '교환은 주문 상태를 바꾸지 않습니다.'
      : op ? '개봉 반품 — 주문은 반품 완료가 되지만 재고로 되돌리지 않습니다.'
        : '주문이 닫히고 재고가 되돌아갑니다.';
    const money = r.kind !== 'EXCHANGE' && r.payState === 'PAID'
      ? `\n${refundText(r)}${r.payStub ? '(시험 결제)' : ''}.` : '';
    if (ok && !confirm(`${r.orderNo} ${RKIND[r.kind] ?? r.kind} 을(를) 승인합니다.\n${stock}${money}`)) return;
    void a.run(r.id, () => api<{ note: string; ok?: boolean }>(`/admin/health/returns/${r.id}/decide`, {
      method: 'POST', body: JSON.stringify({ state: ok ? 'APPROVED' : 'REJECTED', note, ...(op !== undefined ? { opened: op } : {}) }),
    }).finally(list.reload));
  };

  const refund = (r: ReturnRow) => {
    let body: Record<string, unknown> = {};
    /* 가상계좌로 입금된 결제는 환불 받을 계좌가 필요합니다(PG 규칙). 저장하지 않고 PG 로만 넘깁니다 */
    if (r.payMethod === 'VBANK' && !r.payStub) {
      const v = prompt('가상계좌 환불 — 환불 받을 계좌를 「은행코드 계좌번호 예금주」 로 적어 주십시오 (저장하지 않습니다)');
      if (!v?.trim()) return;
      const [bank, accountNumber, ...h] = v.trim().split(/\s+/);
      body = { refundReceiveAccount: { bank, accountNumber, holderName: h.join(' ') } };
    }
    if (!confirm(`${r.orderNo} ${refundText(r)}.`)) return;
    void a.run(`rf-${r.id}`, () => api<{ note: string }>(`/admin/health/returns/${r.id}/refund`, {
      method: 'POST', body: JSON.stringify(body),
    }).finally(list.reload));
  };

  return (
    <>
      <h3 className="sec">취소 · 반품 처리 <em>{(list.data ?? []).length}</em></h3>
      <p className="hint">
        승인하면 주문이 닫히고 <b>재고가 한 번만 되돌아갑니다</b>. 반품은 <b>개봉 여부를 골라야</b> 승인됩니다 —
        개봉이면 재판매할 수 없어 재고로 되돌리지 않습니다. 결제된 주문은 승인과 함께 환불됩니다. 반려는 사유가 필요합니다.
      </p>
      <div className="acts">
        {['REQUESTED', 'APPROVED', 'REFUNDED', 'REJECTED', 'ALL'].map((s) => (
          <button key={s} className={s === state ? 'btn-ok' : 'btn-plain'} onClick={() => setState(s)}>
            {s === 'ALL' ? '전체' : RSTATE[s]}
          </button>
        ))}
      </div>
      <Flash msg={a.msg} err={a.err} />
      {list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <p className="muted">해당 신청이 없습니다.</p>}
      {(list.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>접수</th><th>주문</th><th>구분</th><th>사유</th><th>상품</th><th>주문 상태</th><th>처리</th></tr></thead>
          <tbody>
            {(list.data ?? []).map((r) => (
              <tr key={r.id} data-return={r.id}>
                <td className="muted">{ymdhm(r.createdAt)}</td>
                <td><span className="mono">{r.orderNo}</span><br /><span className="muted">{r.buyerName} · {n(r.total)}원</span>
                  {r.payState && <><br /><span className="muted">결제 {r.payState === 'PAID' ? '완료' : '취소(환불)'}{r.payStub && ' · 시험 결제'}</span></>}</td>
                <td><b>{RKIND[r.kind] ?? r.kind}</b>
                  {r.kind === 'EXCHANGE' && r.feeState && <><br /><span className={r.feeState === 'UNPAID' ? 'warn-text' : 'muted'} data-fee-state={r.feeState}>{FEE[r.feeState]}{Number(r.exchangeFee ?? 0) > 0 && ` ${n(r.exchangeFee)}원`}</span></>}
                  {r.kind === 'EXCHANGE' && r.daysSince != null && r.state !== 'REJECTED' && <><br /><span className={r.daysSince >= EXCHANGE_WAIT_DAYS ? 'warn-text' : 'muted'}>접수 뒤 {r.daysSince}일</span></>}
                  {r.convertedFrom && <><br /><span className="muted">교환에서 바꾼 반품</span></>}</td>
                <td>{REASON[r.reason] ?? r.reason}{r.detail && <><br /><span className="muted">{r.detail}</span></>}
                  {r.customerOpened != null && <><br /><span className="muted">고객: {r.customerOpened ? '열었다고 적음' : '열지 않았다고 적음'}</span></>}</td>
                <td>{r.items}{r.blockedIf && <><br /><span className="warn-text">철회 제한: {r.blockedIf}</span></>}</td>
                <td>{OSTATE[r.orderStatus] ?? r.orderStatus}
                  {r.deliveredAt && <><br /><span className="muted">수령 {ymd(r.deliveredAt)}</span></>}
                  {r.restockedAt && <><br /><span className="muted">재고 복구 {ymd(r.restockedAt)}</span></>}
                  {r.restockSkipped === 'OPENED' && <><br /><span className="warn-text">개봉 — 재고 미복구</span></>}</td>
                <td>
                  {r.state === 'REQUESTED' ? (
                    <>
                      {r.kind === 'RETURN' && (
                        <fieldset style={{ border: 0, padding: 0, margin: "0 0 6px" }} aria-label="개봉 여부 판정">
                          <label><input type="radio" name={`op-${r.id}`} checked={opened[r.id] === false}
                            onChange={() => setOpened({ ...opened, [r.id]: false })} /> 미개봉 — 재고로 되돌림</label><br />
                          <label><input type="radio" name={`op-${r.id}`} checked={opened[r.id] === true}
                            onChange={() => setOpened({ ...opened, [r.id]: true })} /> 개봉됨 — 재판매 불가, 재고로 되돌리지 않음</label>
                        </fieldset>
                      )}
                      {r.kind === 'RETURN' && r.convertedFrom && r.payState === 'PAID' && (
                        <p className="muted" data-deduct-preview="0">재고가 없어 교환에서 바꾼 반품 — 회사 사정이라 왕복 배송비를 빼지 않고 {n(r.payAmount)}원을 모두 환불합니다(판매 약관 1.2 제3조 ③).</p>
                      )}
                      {r.kind === 'RETURN' && !r.convertedFrom && CUSTOMER_REASONS.includes(r.reason) && r.payState === 'PAID' && (
                        <p className="muted" data-deduct-preview>고객 사정 반품 — 승인하면 왕복 배송비 {n(RETURN_SHIP_ROUND_TRIP)}원을 빼고 {n(Math.max(0, Number(r.payAmount ?? 0) - RETURN_SHIP_ROUND_TRIP))}원을 환불합니다.</p>
                      )}
                      <div className="acts">
                        <button className="btn-ok" disabled={a.busy === r.id || (r.kind === 'RETURN' && opened[r.id] === undefined)}
                          title={r.kind === 'RETURN' && opened[r.id] === undefined ? '개봉 여부를 먼저 골라 주십시오' : undefined}
                          onClick={() => decide(r, true)}>승인</button>
                        <button className="btn-plain" disabled={a.busy === r.id} onClick={() => decide(r, false)}>반려</button>
                        {r.kind === 'EXCHANGE' && Number(r.exchangeFee ?? 0) > 0 && (
                          <button className="btn-plain" disabled={a.busy === r.id} onClick={() => sellerFault(r)} data-act="seller-fault">회사 사정으로 판정해 승인</button>
                        )}
                        {r.kind === 'EXCHANGE' && <button className="btn-plain" disabled={a.busy === `cv-${r.id}`} onClick={() => convert(r)} data-act="convert">반품으로 바꾸기</button>}
                      </div>
                      {r.kind === 'EXCHANGE' && r.feeState === 'UNPAID' && <p className="muted">교환 배송비를 결제하기 전에는 승인할 수 없습니다(회사 사정이면 「회사 사정으로 판정해 승인」).</p>}
                    </>
                  ) : (
                    <span>{RSTATE[r.state] ?? r.state}
                      {r.opened != null && r.kind === 'RETURN' && <><br /><span className="muted">판정: {r.opened ? '개봉' : '미개봉'}</span></>}
                      {r.state === 'REFUNDED' && <><br /><span className="muted" data-ship-deduction={Number(r.shipDeduction ?? 0)}>환불 {n(r.refundAmount)}원{Number(r.shipDeduction ?? 0) > 0 && ` (왕복 배송비 ${n(r.shipDeduction)}원 차감)`} · {ymd(r.refundedAt)}</span></>}
                      {r.decideNote && <><br /><span className="muted">{r.decideNote}</span></>}
                      {r.kind === 'EXCHANGE' && r.state === 'APPROVED' && <><br /><button className="btn-plain" disabled={a.busy === `cv-${r.id}`} onClick={() => convert(r)} data-act="convert">반품으로 바꾸기(재고 없음)</button></>}
                      {r.kind === 'EXCHANGE' && r.feeRefundError && <><br /><span className="warn-text" role="alert">교환 배송비 환불 실패: {r.feeRefundError}</span>
                        <br /><button className="btn-ok" disabled={a.busy === `fr-${r.id}`} onClick={() => feeRefund(r)}>교환 배송비 환불 다시 시도</button></>}
                      {r.state === 'APPROVED' && r.payState === 'PAID' && r.kind !== 'EXCHANGE' && (
                        <>
                          {r.refundError && <><br /><span className="warn-text" role="alert">환불 실패: {r.refundError}</span></>}
                          <br /><button className="btn-ok" disabled={a.busy === `rf-${r.id}`} onClick={() => refund(r)}>환불 다시 시도</button>
                        </>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* 10/2 결정 — 고객 사정 반품의 왕복 배송비 차감. 실제 차감은 서버(health-policy.ts)가 하고, 여기는 미리 보기입니다 */
const CUSTOMER_REASONS = ['CHANGE_MIND', 'WRONG_ORDER'];
const RETURN_SHIP_ROUND_TRIP = 6000;
function refundText(r: { kind: string; reason: string; payAmount: number | string | null; convertedFrom?: string | null }) {
  const paid = Number(r.payAmount ?? 0);
  /* v10.26 — 교환에서 바꾼 반품은 빼지 않습니다(서버 refundDeduction 과 같음) */
  return r.kind === 'RETURN' && !r.convertedFrom && CUSTOMER_REASONS.includes(r.reason)
    ? `결제 ${n(paid)}원에서 왕복 배송비 ${n(RETURN_SHIP_ROUND_TRIP)}원을 빼고 ${n(Math.max(0, paid - RETURN_SHIP_ROUND_TRIP))}원을 환불합니다`
    : `결제 ${n(paid)}원을 환불합니다`;
}
const TYPE: Record<string, string> = { DIRECT: '직판', BRAND: '입점(브랜드)', GENERAL: '입점(일반)' };
const SST: Record<string, string> = { DRAFT: '마감 대기', CONFIRMED: '확정', PAID: '지급', CARRIED: '다음 주 이월' };

/** 지난주 월요일 (정산 시작일 기본값) */
function lastMonday() {
  const d = new Date(); const day = (d.getDay() + 6) % 7; // 월=0
  d.setDate(d.getDate() - day - 7);
  /* 10/2 — 브라우저 날짜 그대로. toISOString(UTC)은 한국 시간에서 하루 앞(일요일)이 됩니다 */
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * SB-ADM-HST-010 소개몰 정산
 *
 * 주 단위로 마감합니다. **배송 완료 후 7일**이 지난 건만 집계합니다 — 청약철회 기간입니다.
 *
 * 판매수수료는 소개비와 다른 돈입니다. 소개형 관의 소개비는 소개자에게 전액 지급되지만,
 * 소개몰 판매수수료는 **소개뱅크가 받습니다.**
 * 확정 · 지급 기록은 '지급' 탭(SB-ADM-PAY-010)에서 합니다.
 */
export function HealthSettle({ onGo }: { onGo?: (tab: string) => void }) {
  const sellers = useApi<Seller[]>('/admin/health/sellers');
  const settle = useApi<Settle>('/admin/health/settlements');
  const rates = useApi<Rate[]>('/admin/health/commission-rates');
  const [from, setFrom] = useState(lastMonday());
  const a = useAct();

  const close = () => {
    if (!confirm(`${from} 부터 7일을 마감합니다.\n배송 완료 후 7일이 지난 건만 집계합니다.`)) return;
    void a.run('close', () => api<{ created: number; carried: number; note: string }>('/admin/health/settlements/close', {
      method: 'POST', body: JSON.stringify({ periodFrom: from }),
    }), settle.reload, (r) => `${r.note} 정산서 ${r.created}건 · 이월 ${r.carried}건.`);
  };

  if (sellers.error) return <ErrorView error={sellers.error} onRetry={sellers.reload} />;
  if (settle.error) return <ErrorView error={settle.error} onRetry={settle.reload} />;

  const s = settle.data;
  return (
    <section>
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <p className="card">
        <b>판매수수료는 소개비와 다른 돈입니다.</b> 소개형 관의 소개비는 소개자에게 전액 지급되지만,
        소개몰 판매수수료는 <b>소개뱅크가 받습니다.</b>
      </p>
      <Flash msg={a.msg} err={a.err} />

      <HealthReturns />

      <h3 className="sec">판매자 <em>{(sellers.data ?? []).length}</em></h3>
      {sellers.data && sellers.data.length === 0 && <p className="muted">등록된 판매자가 없습니다.</p>}
      {(sellers.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>코드</th><th>이름</th><th>구분</th><th>판매중</th><th>지급</th><th>수수료율</th><th>만료 인허가</th></tr></thead>
          <tbody>
            {(sellers.data ?? []).map((x) => (
              <tr key={x.code}>
                <td className="mono">{x.code}</td><td><b>{x.name}</b></td>
                <td>{TYPE[x.type] ?? x.type}</td>
                <td className="num-cell">{n(x.onSale)}</td>
                <td>{x.type === 'DIRECT' ? <span className="dim">해당 없음</span>
                  : x.payable ? <span className="st ok">가능</span> : <span className="st no">불가</span>}</td>
                <td className="num-cell">{x.type === 'DIRECT' ? '—' : `${x.commissionRate}%`}</td>
                <td className="num-cell">{Number(x.expiredLicenses) > 0 ? <b className="warn-text">{n(x.expiredLicenses)}</b> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(s?.blocked ?? []).length > 0 && (
        <p className="card warn">
          <b>하위가맹점 ID 가 없어 지급이 막힌 판매자 {s!.blocked.length}곳</b> — {s!.blocked.map((b) => b.name).join(' · ')}.
          집계는 되지만 돈을 보낼 곳이 없습니다. 결제사 계약 뒤에 채우면 풀립니다.
        </p>
      )}

      <h3 className="sec">주 정산 마감</h3>
      <div className="card pad">
        <p>마감 가능 <b>{n(s?.ready.n)}</b>건 · 상품 금액 <b className="money-sm">{n(s?.ready.amount)}원</b></p>
        <div className="form-grid">
          <label><span>정산 시작일 (월요일)</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        </div>
        <div className="acts">
          <button className="btn-ok" disabled={!from || a.busy === 'close'} onClick={close} data-week-close>이번 주 마감</button>
          {onGo && <button className="btn-plain" onClick={() => onGo('payouts')}>확정 · 지급은 지급 탭에서</button>}
          {/* v10.31 — 시안 아래 단추 줄 */}
          {onGo && <button className="btn-plain" onClick={() => onGo('hlt-orders')}>소개몰 주문 · 발송</button>}
          {onGo && <button className="btn-plain" onClick={() => onGo('hlt-reviews')}>소개몰 리뷰 · 문의</button>}
        </div>
        <p className="hint"><b>지급액이 음수면 이월합니다.</b> 판매자 계좌에서 빼 올 수 없기 때문입니다.</p>
      </div>

      <h3 className="sec">정산서 <em>{(s?.items ?? []).length}</em></h3>
      {s && s.items.length === 0 && <p className="muted">아직 마감한 정산이 없습니다.</p>}
      {(s?.items ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>기간</th><th>판매자</th><th>매출</th><th>수수료</th><th>환불</th><th>이월</th><th>지급액</th><th>상태</th></tr></thead>
          <tbody>
            {s!.items.map((r) => (
              <tr key={r.seller + r.from}>
                <td className="muted">{ymd(r.from)} ~ {ymd(r.to)}</td>
                <td>{r.sellerName}</td>
                <td className="num-cell">{n(r.gross)}</td>
                <td className="num-cell">{n(r.commission)}</td>
                <td className="num-cell">{n(r.refund)}</td>
                <td className="num-cell">{n(r.carriedIn)}</td>
                <td className="num-cell">{Number(r.net) < 0 ? <b className="warn-text">{n(r.net)}</b> : <b>{n(r.net)}</b>}</td>
                <td>{SST[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">수수료율</h3>
      {rates.error ? <ErrorView error={rates.error} onRetry={rates.reload} /> : null}
      <table className="tbl">
        <thead><tr><th>카테고리</th><th>요율</th><th>소개자 몫</th><th>메모</th><th>변경 이력</th></tr></thead>
        <tbody>
          {(rates.data ?? []).map((r) => (
            <tr key={r.categoryCode}>
              <td className="mono">{r.categoryCode === '*' ? '기본' : r.categoryCode}</td>
              <td className="num-cell">{r.rate}%</td>
              <td className="num-cell">{r.referralPct}%</td>
              <td className="muted">{r.note}</td>
              <td className="num-cell">{r.changes ? `${r.changes}건` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card warn">
        <b>요율은 소개뱅크가 정합니다.</b> 바꾸면 이력이 남고, <b>이미 판매된 건에는 적용되지 않습니다</b> —
        주문 시점 요율이 그 주문에 박혀 있습니다.
      </p>
    </section>
  );
}
