'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { codeText, needsLogin, RETURN_KIND, RETURN_REASONS, RETURN_SHIP_ROUND_TRIP } from './util';
import type { HltReturnShip } from './types';
import { ExchangeFeePay } from './ExchangeFeePay';
import { useFmt } from '@/lib/useFmt';

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
  const t = useTranslations('order');
  const f = useFmt();
  const kindText = (k: string) => codeText(t, 'returnKind', k, RETURN_KIND[k] ?? k);
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
        setErr(r.status >= 500 ? t('ret.errServer') : d?.message ?? t('ret.errShort'));
        return;
      }
      /* router.refresh() 를 하지 않습니다 — 새로 그리면 페이지가 "이미 접수된 신청" 으로 바뀌어
       * 접수 완료 안내가 사라집니다. 완료 화면의 링크로 내역을 보시면 됩니다. */
      if (kind === 'EXCHANGE' && d?.feeState === 'UNPAID' && d?.id) setFeeDue({ id: String(d.id), amount: Number(d.exchangeFee) });
      setDone(d?.note ?? (kind === 'EXCHANGE' ? t('ret.doneAlone') : t('ret.doneDefault')));   // 교환은 문장 하나로 보임
    });
  }

  if (done) {
    return (
      <div className="result">
        <p className="ok-note" role="status">{kind === 'EXCHANGE' ? done : t('ret.doneMsg', { kind: kindText(kind), done })}</p>
        {feeDue && <ExchangeFeePay returnId={feeDue.id} amount={feeDue.amount} />}
        <div className="hlt-btns">
          <Link className="hlt-btn pri" href="/my/health/returns">{t('common.returnsList')}</Link>
          <Link className="hlt-btn" href={`/my/health/orders/${encodeURIComponent(orderNo)}`}>{t('common.orderDetail')}</Link>
        </div>
      </div>
    );
  }

  return (
    <form className="auth hlt-form hlt-ret32" onSubmit={submit}>
      {/* v10.32 — 시안 순서: 신청 종류 → ① 항목 → ② 사유(+ 상세 사유) → 포장 여부 → ③ 환불 예상(고객 귀책 강조 상자) → 반품 주소 띠 → 접수 */}
      {kinds.length > 1 && (
        <div className="hlt-box fld">
          <h3>{t('ret.kindTitle')}</h3>
          <div className="hlt-chips" role="radiogroup" aria-label={t('ret.kindTitle')}>
            {kinds.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k}
                className={`hlt-chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{kindText(k)}</button>
            ))}
          </div>
        </div>
      )}
      {items}
      <div className="hlt-box">
        <h3>{t('ret.reasonTitle')}</h3>
        <label className="fld">
          {/* v10.31 (시안 「② 사유 · 사유를 골라 주십시오」) */}
          <span>{t('ret.reasonPick')}</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} required aria-label={t('ret.reasonPick')}>
            {reasons.map((r) => <option key={r.code} value={r.code}>{codeText(t, 'reason', r.code, r.label)}</option>)}
          </select>
          <em>
            {kind === 'CANCEL'
              ? t('ret.cancelFree')
              : party === 'SELLER'
                ? t('ret.sellerFree')
                : kind === 'EXCHANGE'
                  ? t('ret.exchangeFee', { fee: f.won(exchangeFee, '-') })
                  : ship
                    ? t('ret.returnDeduct', { fee: f.won(ship.roundTripFee, '-') })
                    : t('ret.customerPays')}
          </em>
        </label>
        <label className="fld">
          <span>{t('ret.detail')}</span>
          <textarea rows={3} value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)}
            placeholder={t('ret.detailPh')} />
        </label>
        <p className="hint" style={{ margin: 0 }}>{t('ret.faultNote')}</p>
      </div>
      {kind !== 'CANCEL' && (
        <div className="hlt-box fld">
          <h3>{t('ret.openedTitle')}</h3>
          <div className="hlt-chips" role="radiogroup" aria-label={t('ret.openedAria')}>
            {([[false, 'notOpened'], [true, 'opened']] as const).map(([v, label]) => (
              <button key={label} type="button" role="radio" aria-checked={opened === v}
                className={`hlt-chip${opened === v ? ' on' : ''}`} onClick={() => setOpened(v)}>{t(`ret.${label}`)}</button>
            ))}
          </div>
          <em>
            {opened === true
              ? (party === 'SELLER'
                ? t('ret.openedSeller')
                : t('ret.openedCustomer'))
              : t('ret.openedDefault')}
          </em>
        </div>
      )}
      {/* v10.25 — 시안의 「환불 예상」 표. 금액은 서버 값(주문 상세 returnShip)입니다 — 교환은 환불이 없어 보이지 않습니다 */}
      {/* v10.27 (G-184) — 결제하지 않은 주문은 낸 돈이 없어 환불 표를 그리지 않습니다 */}
      {kind !== 'EXCHANGE' && ship?.paid === false && (
        <div className="hlt-box" data-refund-table data-before-payment>
          <h3>{t('ret.beforePayTitle')}</h3>
          <p className="hint">{t.rich('ret.beforePay', { b: (c) => <b>{c}</b> })}</p>
        </div>
      )}
      {kind !== 'EXCHANGE' && ship?.paid !== false && ship?.paidAmount != null && (
        <div className="hlt-box" data-refund-table data-paid={ship.paidAmount}>
          <h3>{t('ret.refundTitle')}</h3>
          <div className="hlt-sum"><span>{t('common.payAmount')}</span><span>{f.won(ship.paidAmount, '-')}</span></div>
          <div className="hlt-sum"><span>{t('ret.returnShip')}</span><span>{f.won(deducts ? ship.paidAmount - ship.customerRefundEstimate : 0, '-')}</span></div>
          <div className="hlt-sum tot" {...(deducts ? { 'data-refund-estimate': ship.customerRefundEstimate } : {})}>
            <span>{t('ret.refundDue')}</span>
            <span>{f.won(deducts ? ship.customerRefundEstimate : ship.paidAmount, '-')}</span>
          </div>
          {deducts ? (
            <div className="hlt-fault" data-fault-box="">
              <span>{t('ret.faultCustomer')}</span>
              <b>{t('ret.deducted', { amount: f.won(ship.paidAmount - ship.customerRefundEstimate, '-') })}</b>
            </div>
          ) : (
            <p className="hint">{kind === 'CANCEL' ? t('ret.cancelFree') : t('ret.sellerFree')}</p>
          )}
          <p className="hint">{t('ret.serverCalc')}</p>
        </div>
      )}
      {/* v10.26 — 시안의 「교환 비용」 상자(spec/proto.html updateRefund). 교환은 환불이 없고, 회원 사정이면 왕복 배송비를 냅니다 */}
      {kind === 'EXCHANGE' && (
        <div className="hlt-box" data-exchange-box data-exchange-fee={party === 'SELLER' ? 0 : exchangeFee}>
          <h3>{t('ret.exchangeTitle')}</h3>
          <div className="hlt-sum tot"><span>{t('common.feeRound')}</span><span>{f.won(party === 'SELLER' ? 0 : exchangeFee, '-')}</span></div>
          <div className={`hlt-note26${party === 'SELLER' ? '' : ' warn'}`} style={{ marginTop: 10 }}>
            {t.rich('ret.exchangeNoRefund', { b: (c) => <b>{c}</b> })}{' '}
            {party === 'SELLER'
              ? <>{t.rich('ret.sellerFault', { b: (c) => <b>{c}</b> })}</>
              : <>{t.rich('ret.customerFault', { fee: f.won(exchangeFee, '-'), b: (c) => <b>{c}</b> })}</>}
          </div>
          <p className="hint">{t('ret.soldOutNote')}</p>
        </div>
      )}
      {kind !== 'CANCEL' && returnAddr && (
        <div className="hlt-retaddr" data-return-addr="">{t('ret.returnAddr', { addr: returnAddr })}</div>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="cta-primary" disabled={pending || !reason}>
        {pending ? t('ret.submitting') : t('ret.submit', { kind: kindText(kind) })}
      </button>
      <p className="cta-note">{t('ret.ctaNote')}</p>
    </form>
  );
}
