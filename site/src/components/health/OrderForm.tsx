'use client';
import { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HltAddress, HltCart } from './types';
import { krw, needsLogin, PAY_METHODS } from './util';
import { ProductArt } from './ProductArt';

/**
 * 주문서 — POST /health/orders { addressId, items:[{productCode, qty}] }
 *
 * 금액은 **서버가 다시 계산**합니다. 여기 보이는 합계도 장바구니 API 의 서버 계산값입니다.
 * 주문이 만들어지면 담았던 줄을 장바구니에서 뺍니다 — 서버가 비우지 않아
 * 그대로 두면 같은 상품을 두 번 주문하게 됩니다.
 * v10.31 (시안 주문서) — 배송지 상자 안 「배송 요청사항」(50자 · 주문에 저장 · 발송 화면에 보임 · 전화번호 · 계좌번호는 서버가 거름) ·
 *   결제수단 「간편결제」 칩(결제사 결제창에서 고름) · 결제 금액의 「할인」 줄(쿠폰 · 적립금이 없어 0원 — 판매가에 이미 할인이 들어 있음).
 */
export function OrderForm({ cart, addresses }: { cart: HltCart; addresses: HltAddress[] }) {
  const router = useRouter();
  const [addr, setAddr] = useState(addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? '');
  const [method, setMethod] = useState('CARD');
  const [memo, setMemo] = useState('');
  const [agree1, setAgree1] = useState(false);
  const [agree2, setAgree2] = useState(false);
  /* v10.25 — 시안처럼 고른 배송지 한 곳만 보이고 「변경」을 누르면 전체가 펼쳐집니다(배송지가 많으면 주문서가 길어졌습니다) */
  const [pick, setPick] = useState(false);
  const picked = addresses.find((a) => a.id === addr);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  /* v10.26 (G-182) — 이 주문서가 **지금 장바구니와 같은지** 열릴 때 한 번 확인합니다.
   * 화면은 앞서 받아 둔 주문서를 다시 보여 줄 수 있습니다(결제 화면의 「← 뒤로」 · 브라우저의 뒤로 가기). 이미 주문해 장바구니가 비었는데
   * 예전 품목이 그대로 보이면 같은 것을 또 주문하게 됩니다. 다르면 화면을 새로 받습니다(서버도 예전 주문서는 409 CART_CHANGED 로 거절합니다). */
  const shown = cart.items.map((i) => `${i.optionId}:${i.qty}`).sort().join(',');
  useEffect(() => {
    let live = true;
    fetch('/api/v1/me/health/cart', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { items?: { optionId: string; qty: number }[] } | null) => {
        if (!live || !c) return;
        const now = (c.items ?? []).map((i) => `${i.optionId}:${i.qty}`).sort().join(',');
        if (now !== shown) router.refresh();
      })
      .catch(() => { /* 확인하지 못해도 주문서는 그대로 씁니다 — 주문할 때 서버가 다시 봅니다 */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = !!addr && agree1 && agree2 && !cart.hasProblem && !cart.priceChanged && cart.items.length > 0;

  function submit() {
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/health/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          addressId: addr,
          /* v10.26 (G-182) — 장바구니에서 온 주문임을 알립니다. 서버가 장바구니와 대조해, 이미 주문한 예전 주문서를 다시 보내면 거절합니다 */
          fromCart: true,
          /* v10.26 — 옵션 단위(같은 상품의 두 옵션은 두 줄) */
          items: cart.items.map((i) => ({ productCode: i.code, optionId: i.optionId, qty: i.qty })),
          ...(memo.trim() ? { shipMemo: memo.trim() } : {}),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        /* 이 주문서가 예전 것입니다(이미 주문했거나 장바구니가 바뀜) — 안내하고 화면을 새로 받습니다. 주문은 만들어지지 않았습니다 */
        if (d?.code === 'CART_CHANGED') { setErr(d.message); router.refresh(); return; }
        /* v10.26 — 담은 뒤 값이 바뀐 상품이 있음 — 장바구니에서 「확인했습니다」를 받습니다 */
        if (d?.code === 'PRICE_CHANGED') { setErr(d.message); router.refresh(); return; }
        if (r.status >= 500) { setErr('주문을 접수하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.'); return; }
        const q = new URLSearchParams({ step: 'order', code: d?.code ?? String(r.status), msg: d?.message ?? '주문을 접수하지 못했습니다.' });
        router.push(`/health/order/fail?${q}`);
        return;
      }
      /* 주문한 줄은 서버가 같은 거래에서 장바구니에서 뺍니다(v10.26 — 전에는 화면이 줄마다 지웠습니다) */
      router.push(`/health/order/pay?no=${encodeURIComponent(d.orderNo)}&m=${method}`);
    });
  }

  return (
    <>
      <section className="hlt-box">
        <h3>주문 상품</h3>
        {cart.items.map((i) => (
          <div key={i.optionId} className="hlt-ci" data-order-line={i.optionId}>
            <span className="hlt-mini"><ProductArt p={i} size={44} /></span>
            <div className="bd">
              <b>{i.name}</b>
              {i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm" data-optlabel>{i.optionLabel}</span>}
              <span className="hint">{krw(i.price)} × {i.qty}개</span>
              {i.withdrawalBlockedIf && <span className="hint">청약철회 제한: {i.withdrawalBlockedIf}</span>}
            </div>
            <b className="money">{krw(i.amount)}</b>
          </div>
        ))}
      </section>

      <section className="hlt-box">
        <h3>배송지</h3>
        {addresses.length === 0 ? (
          <div className="notice">
            배송지가 없습니다. 먼저 등록하십시오.{' '}
            <Link href="/my/health/addresses?next=/health/order">배송지 등록</Link>
          </div>
        ) : !pick && picked ? (
          <div className="hlt-addr-picked" data-addr-picked>
            <p>
              <b>{picked.label || '배송지'}</b>{picked.isDefault && <span className="hlt-bdg">기본</span>}
              {' '}{picked.receiver} · {picked.phone}<br />
              <span className="hint">({picked.zipcode}) {picked.addr1} {picked.addr2 ?? ''}</span>
            </p>
            <div className="hlt-btns">
              <button type="button" className="hlt-btn sm" data-addr-change onClick={() => setPick(true)}>변경</button>
              <Link className="hlt-btn sm" href="/my/health/addresses?next=/health/order">배송지 관리</Link>
            </div>
          </div>
        ) : (
          <div className="hlt-radios" role="radiogroup" aria-label="배송지">
            {addresses.map((a) => (
              <label key={a.id} className={`hlt-radio${addr === a.id ? ' on' : ''}`}>
                <input type="radio" name="addr" value={a.id} checked={addr === a.id} onChange={() => { setAddr(a.id); setPick(false); }} />
                <span>
                  <b>{a.label || '배송지'}</b>{a.isDefault && <span className="hlt-bdg">기본</span>}
                  {' '}{a.receiver} · {a.phone}<br />
                  <span className="hint">({a.zipcode}) {a.addr1} {a.addr2 ?? ''}</span>
                </span>
              </label>
            ))}
            <Link className="hlt-btn sm" href="/my/health/addresses?next=/health/order">배송지 관리</Link>
          </div>
        )}
        <div className="hlt-f" data-ship-memo="">
          <label htmlFor="shipMemo">배송 요청사항</label>
          <input id="shipMemo" value={memo} maxLength={50} placeholder="부재 시 경비실에 맡겨 주세요"
            onChange={(e) => setMemo(e.target.value)} />
          <span className="hint">{memo.length}/50 · 전화번호 · 계좌번호는 적지 마십시오(받는 분 연락처는 배송지에 있습니다).</span>
        </div>
      </section>

      <section className="hlt-box">
        <h3>결제수단</h3>
        <div className="hlt-chips" role="radiogroup" aria-label="결제수단">
          {PAY_METHODS.map((m) => (
            <button key={m.code} type="button" role="radio" aria-checked={method === m.code}
              className={`hlt-chip${method === m.code ? ' on' : ''}`} onClick={() => setMethod(m.code)}>{m.label}</button>
          ))}
        </div>
        {method === 'EASY' && <p className="hint">간편결제(토스페이 · 카카오페이 · 네이버페이 등)는 다음 단계의 결제창에서 고릅니다.</p>}
        <p className="hint">카드번호는 저희 쪽에 남지 않습니다 — PG 가 처리하고 저희는 거래번호만 받습니다.</p>
      </section>

      <section className="hlt-box">
        <h3>결제 금액</h3>
        <div className="hlt-sum"><span>상품 금액</span><span>{krw(cart.goods)}</span></div>
        <div className="hlt-sum"><span>배송비</span><span>{cart.shipFee === 0 ? '무료' : krw(cart.shipFee)}</span></div>
        <div className="hlt-sum" data-discount=""><span>할인</span><span>{krw(0)}</span></div>
        <div className="hlt-sum tot"><span>총 결제 금액</span><span>{krw(cart.total)}</span></div>
        <p className="hint">금액은 주문할 때 서버가 다시 계산합니다.</p>
      </section>

      {/* 두 동의를 하나로 합치지 않습니다 — 개인정보보호법상 동의 항목은 구분해 표시해야 합니다(시안) */}
      <section className="hlt-box">
        <h3>동의</h3>
        <label className="hlt-chk">
          <input type="checkbox" checked={agree1} onChange={(e) => setAgree1(e.target.checked)} />
          <span>[필수] 주문 내용과 청약철회 조건을 확인했으며 구매에 동의합니다
            {' '}(<Link href="/health/guide">이용안내 · 청약철회</Link>)</span>
        </label>
        <label className="hlt-chk">
          <input type="checkbox" checked={agree2} onChange={(e) => setAgree2(e.target.checked)} />
          <span>[필수] 배송을 위해 받는 분 성함 · 연락처 · 주소를 배송사에 제공하는 데 동의합니다</span>
        </label>
      </section>

      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="button" className="cta-primary" disabled={!ready || pending} onClick={submit}>
        {pending ? '주문 접수 중…' : `${krw(cart.total)} 결제하기`}
      </button>
      {!ready && !pending && (
        <p className="cta-note">
          {!addr ? '배송지를 등록해 주십시오.' : !(agree1 && agree2) ? '필수 동의 두 가지에 체크해 주십시오.'
            : cart.priceChanged ? <>가격이 바뀐 상품이 있습니다 — <Link href="/health/cart">장바구니</Link>에서 확인해 주십시오.</> : '주문할 수 없는 항목이 있습니다.'}
        </p>
      )}
    </>
  );
}
