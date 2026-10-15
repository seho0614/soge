'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { krw, needsLogin, RETURN_KIND, RETURN_REASONS, RETURN_SHIP_ROUND_TRIP } from './util';
import type { HltReturnShip } from './types';
import { ExchangeFeePay } from './ExchangeFeePay';

/**
 * 취소 · 반품 신청 — POST /me/health/returns { orderNo, kind, reason, detail }
 *
 * 귀책은 **사유가 정합니다** — 고객이 고르지 않습니다(시안). 서버에는 사유 코드를 보냅니다.
 * `sellerOnly` 는 청약철회 기간(7일)이 지나 판매자 귀책 사유만 받을 수 있을 때입니다
 * (전자상거래법 17조 3항 — 표시·광고와 다르거나 계약과 다르게 이행된 경우).
 * ★ 판정은 서버가 합니다(D002). 이 제한은 안내일 뿐이고, 서버가 422 로 막으면 그 사유를 그대로 보여 드립니다.
 */
export function ReturnForm({ orderNo, kinds, sellerOnly = false, ship, exchangeFee = RETURN_SHIP_ROUND_TRIP, items, returnAddr }: {
  orderNo: string; kinds: string[]; sellerOnly?: boolean;
  /** v10.32 — 시안 순서대로 「신청 종류」 아래에 그리는 ① 항목 칸(페이지가 만든 것) */
  items?: React.ReactNode;
  /** v10.32 — 시안 「반품 주소」 띠(판매자 반품 주소 · 서버 값). 없으면 띠를 그리지 않음 */
  returnAddr?: string | null;
  /** v10.26 — 회원 사정 교환의 왕복 배송비(서버 값 · 주문 상세 exchangeFee). 회사 사정이면 0원 */
  exchangeFee?: number;
  /** 고객 사정 반품의 왕복 배송비 차감 — 서버 값(주문 상세 returnShip). 없으면 금액 없이 안내만 */
  ship?: HltReturnShip;
}) {
  const router = useRouter();
  const reasons = RETURN_REASONS.filter((r) => !sellerOnly || r.party === 'SELLER');
  const [kind, setKind] = useState<string>(kinds[0] ?? 'CANCEL');
  const [reason, setReason] = useState(reasons[0]?.code ?? '');
  const [detail, setDetail] = useState('');
  /* D006 — 포장을 여셨는지 (반품·교환만). 참고용이고 판정은 운영이 합니다. 고르지 않으면 보내지 않습니다 */
  const [opened, setOpened] = useState<boolean | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /* v10.26 — 교환을 접수했는데 교환 배송비를 내야 하면 그 자리에서 결제 단추를 보여 드립니다 */
  const [feeDue, setFeeDue] = useState<{ id: string; amount: number } | null>(null);
  const party = RETURN_REASONS.find((r) => r.code === reason)?.party;
  /* 10/2 결정 — 고객 사정(단순 변심 · 잘못 주문) **반품**은 왕복 배송비를 빼고 환불합니다(D009) */
  const deducts = kind === 'RETURN' && !!ship && ship.customerReasons.includes(reason);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/me/health/returns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNo, kind, reason, detail: detail.trim() || undefined,
          opened: kind !== 'CANCEL' && opened !== null ? opened : undefined }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setErr(r.status >= 500 ? '접수하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' : d?.message ?? '접수하지 못했습니다.');
        return;
      }
      /* router.refresh() 를 하지 않습니다 — 새로 그리면 페이지가 "이미 접수된 신청" 으로 바뀌어
       * 접수 완료 안내가 사라집니다. 완료 화면의 링크로 내역을 보시면 됩니다. */
      if (kind === 'EXCHANGE' && d?.feeState === 'UNPAID' && d?.id) setFeeDue({ id: String(d.id), amount: Number(d.exchangeFee) });
      setDone(d?.note ?? '접수했습니다.');
    });
  }

  if (done) {
    return (
      <div className="result">
        <p className="ok-note" role="status">{kind === 'EXCHANGE' ? done : `${RETURN_KIND[kind]} 신청을 ${done}`}</p>
        {feeDue && <ExchangeFeePay returnId={feeDue.id} amount={feeDue.amount} />}
        <div className="hlt-btns">
          <Link className="hlt-btn pri" href="/my/health/returns">취소 · 반품 내역</Link>
          <Link className="hlt-btn" href={`/my/health/orders/${encodeURIComponent(orderNo)}`}>주문 상세</Link>
        </div>
      </div>
    );
  }

  return (
    <form className="auth hlt-form hlt-ret32" onSubmit={submit}>
      {/* v10.32 — 시안 순서: 신청 종류 → ① 항목 → ② 사유(+ 상세 사유) → 포장 여부 → ③ 환불 예상(고객 귀책 강조 상자) → 반품 주소 띠 → 접수 */}
      {kinds.length > 1 && (
        <div className="hlt-box fld">
          <h3>신청 종류</h3>
          <div className="hlt-chips" role="radiogroup" aria-label="신청 종류">
            {kinds.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k}
                className={`hlt-chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{RETURN_KIND[k]}</button>
            ))}
          </div>
        </div>
      )}
      {items}
      <div className="hlt-box">
        <h3>② 사유</h3>
        <label className="fld">
          {/* v10.31 (시안 「② 사유 · 사유를 골라 주십시오」) */}
          <span>사유를 골라 주십시오</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} required aria-label="사유를 골라 주십시오">
            {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
          <em>
            {kind === 'CANCEL'
              ? '발송 전 취소는 비용이 들지 않습니다.'
              : party === 'SELLER'
                ? '판매자 사유라 반품 배송비가 들지 않습니다.'
                : kind === 'EXCHANGE'
                  ? `단순 변심 · 잘못 주문으로 교환하시면 왕복 배송비 ${krw(exchangeFee)}을 접수 때 결제합니다.`
                  : ship
                    ? `단순 변심 · 잘못 주문으로 반품하시면 왕복 배송비 ${krw(ship.roundTripFee)}을 뺀 금액을 환불합니다.`
                    : '단순 변심 · 잘못 주문은 왕복 배송비를 고객이 부담합니다.'}
          </em>
        </label>
        <label className="fld">
          <span>상세 사유 (선택)</span>
          <textarea rows={3} value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)}
            placeholder="판매자 사유라면 상태를 자세히 적어 주시면 빠릅니다" />
        </label>
        <p className="hint" style={{ margin: 0 }}>귀책은 사유가 정합니다 — 사용자가 고르지 않습니다.</p>
      </div>
      {kind !== 'CANCEL' && (
        <div className="hlt-box fld">
          <h3>포장을 여셨나요?</h3>
          <div className="hlt-chips" role="radiogroup" aria-label="개봉 여부">
            {([[false, '열지 않았습니다'], [true, '열었습니다']] as const).map(([v, label]) => (
              <button key={label} type="button" role="radio" aria-checked={opened === v}
                className={`hlt-chip${opened === v ? ' on' : ''}`} onClick={() => setOpened(v)}>{label}</button>
            ))}
          </div>
          <em>
            {opened === true
              ? (party === 'SELLER'
                ? '상품이 상했거나 다른 것이 왔으면 여셨더라도 돌려받으실 수 있습니다.'
                : '식품 · 건강기능식품은 포장을 여시면 청약철회가 제한될 수 있습니다. 여신 상품은 다시 팔 수 없어 재고로 돌리지 않습니다.')
              : '알려 주시면 빠르게 처리됩니다. 최종 판단은 반송된 상품을 확인한 뒤 저희가 합니다.'}
          </em>
        </div>
      )}
      {/* v10.25 — 시안의 「환불 예상」 표. 금액은 서버 값(주문 상세 returnShip)입니다 — 교환은 환불이 없어 보이지 않습니다 */}
      {/* v10.27 (G-184) — 결제하지 않은 주문은 낸 돈이 없어 환불 표를 그리지 않습니다 */}
      {kind !== 'EXCHANGE' && ship?.paid === false && (
        <div className="hlt-box" data-refund-table data-before-payment>
          <h3>결제 전 취소</h3>
          <p className="hint">아직 결제하지 않은 주문이라 <b>환불할 금액이 없습니다.</b> 취소가 접수되면 주문이 바로 정리됩니다.</p>
        </div>
      )}
      {kind !== 'EXCHANGE' && ship?.paid !== false && ship?.paidAmount != null && (
        <div className="hlt-box" data-refund-table data-paid={ship.paidAmount}>
          <h3>③ 환불 예상</h3>
          <div className="hlt-sum"><span>결제 금액</span><span>{krw(ship.paidAmount)}</span></div>
          <div className="hlt-sum"><span>반품 배송비 (왕복)</span><span>{krw(deducts ? ship.paidAmount - ship.customerRefundEstimate : 0)}</span></div>
          <div className="hlt-sum tot" {...(deducts ? { 'data-refund-estimate': ship.customerRefundEstimate } : {})}>
            <span>환불 예정액</span>
            <span>{krw(deducts ? ship.customerRefundEstimate : ship.paidAmount)}</span>
          </div>
          {deducts ? (
            <div className="hlt-fault" data-fault-box="">
              <span>고객 귀책이라</span>
              <b>{krw(ship.paidAmount - ship.customerRefundEstimate)}이 환불액에서 빠집니다.</b>
            </div>
          ) : (
            <p className="hint">{kind === 'CANCEL' ? '발송 전 취소는 비용이 들지 않습니다.' : '판매자 사유라 반품 배송비가 들지 않습니다.'}</p>
          )}
          <p className="hint">서버가 계산한 값입니다. 화면에서 다시 계산하지 않습니다.</p>
        </div>
      )}
      {/* v10.26 — 시안의 「교환 비용」 상자(spec/proto.html updateRefund). 교환은 환불이 없고, 회원 사정이면 왕복 배송비를 냅니다 */}
      {kind === 'EXCHANGE' && (
        <div className="hlt-box" data-exchange-box data-exchange-fee={party === 'SELLER' ? 0 : exchangeFee}>
          <h3>교환 비용</h3>
          <div className="hlt-sum tot"><span>교환 배송비 (왕복)</span><span>{krw(party === 'SELLER' ? 0 : exchangeFee)}</span></div>
          <div className={`hlt-note26${party === 'SELLER' ? '' : ' warn'}`} style={{ marginTop: 10 }}>
            교환은 <b>환불 없이</b> 같은 상품을 다시 보내 드립니다.{' '}
            {party === 'SELLER'
              ? <>판매자 귀책이라 <b>비용이 들지 않습니다.</b></>
              : <>고객 귀책이라 <b>왕복 배송비 {krw(exchangeFee)}을 부담</b>하십니다 — 접수하신 뒤 바로 결제합니다. 반려되거나 판매자 귀책으로 판정되면 돌려드립니다.</>}
          </div>
          <p className="hint">교환할 상품이 다 팔렸으면 입고를 14일까지 기다린 뒤 반품으로 바꿔 드립니다(원하시면 바로 반품). 그때는 반품 배송비를 빼지 않고 전액 환불하며, 교환 배송비도 돌려드립니다.</p>
        </div>
      )}
      {kind !== 'CANCEL' && returnAddr && (
        <div className="hlt-retaddr" data-return-addr="">반품은 수거 후 검수를 거쳐 환불됩니다. 반품 주소: {returnAddr}</div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="cta-primary" disabled={pending || !reason}>
        {pending ? '접수 중…' : `${RETURN_KIND[kind]} 접수`}
      </button>
      <p className="cta-note">접수 후 3영업일 안에 결과를 알려 드립니다. 환불은 반품 상품을 받은 날부터 영업일 3일 안에 합니다.</p>
    </form>
  );
}
