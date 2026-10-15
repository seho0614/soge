'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HltCart } from './types';
import { krw, needsLogin } from './util';
import { ProductArt } from './ProductArt';

/**
 * 장바구니 — 수량 바꾸기 · 빼기 (v10.26 — 줄(옵션)마다 PATCH /me/health/cart/lines/{옵션}, 0 이면 빠집니다).
 *
 * 합계와 배송비는 **서버가 계산해** 내려보낸 값만 씁니다 — 화면에서 더하면
 * 화면과 주문서가 갈립니다. PATCH 응답이 새 장바구니 전체라 그대로 바꿔 끼웁니다.
 */
export function CartView({ initial }: { initial: HltCart }) {
  const router = useRouter();
  const [cart, setCart] = useState(initial);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  /* v10.26 — 줄 = 상품 + 옵션. 수량은 줄(옵션)마다 바꿉니다(PATCH /me/health/cart/lines/{옵션}) */
  function setQty(optionId: string, qty: number) {
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/me/health/cart/lines/${encodeURIComponent(optionId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setErr(d?.message ?? '수량을 바꾸지 못했습니다.');
        return;
      }
      setCart(d as HltCart);
      router.refresh();
    });
  }

  /* v10.26 — 「가격이 변경되었습니다 — 확인했습니다」(시안). 담을 때 값을 지금 값으로 맞춘 뒤에 주문할 수 있습니다 */
  function ackPrices() {
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/me/health/cart/ack-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { if (needsLogin(r.status, d?.code)) { router.push('/login'); return; } setErr(d?.message ?? '확인하지 못했습니다.'); return; }
      setCart(d as HltCart);
      router.refresh();
    });
  }

  if (cart.items.length === 0) {
    return (
      <div className="hlt-empty">
        <p>장바구니가 비어 있습니다.</p>
        <Link className="hlt-btn pri" href="/health">상품 둘러보기</Link>
      </div>
    );
  }

  return (
    <>
      {/* 시안의 판매자별 묶음 머리 — 지금은 모두 직판이라 한 묶음입니다(입점 판매자는 v10.28) */}
      <div className="hlt-sm hlt-mut3" data-seller-group="DIRECT"><span className="hlt-bdg direct">직판</span> 소개뱅크 직판관</div>
      <div className="hlt-lines">
        {cart.items.map((it) => {
          const bad = it.overStock || it.notOnSale;
          return (
            <div key={it.optionId} className={`hlt-ci${bad ? ' bad' : ''}`} data-cart-line={it.optionId}>
              <span className="hlt-mini"><ProductArt p={it} size={44} /></span>
              <div className="bd">
                <Link href={`/health/p/${encodeURIComponent(it.code)}`}><b>{it.name}</b></Link>
                {it.optionLabel && it.optionLabel !== '단품' && <span className="hlt-optnm" data-optlabel>{it.optionLabel}</span>}
                <span className="hint">{krw(it.price)} · {it.code}</span>
                {it.priceChanged && it.addedPrice != null && (
                  <span className="hlt-pchg" data-price-changed>가격이 변경되었습니다 — 담을 때 <s>{krw(it.addedPrice)}</s> → 현재 <b>{krw(it.price)}</b></span>
                )}
                {it.withdrawalBlockedIf && <span className="hint">청약철회 제한: {it.withdrawalBlockedIf}</span>}
                {it.notOnSale && <p className="form-error">판매가 종료된 상품입니다. 빼고 진행해 주십시오.</p>}
                {!it.notOnSale && it.overStock && (
                  <p className="form-error">
                    재고가 부족합니다. 남은 수량 {it.stock}개
                    {it.stock > 0 && (
                      <button type="button" className="hlt-btn sm" disabled={pending}
                        onClick={() => setQty(it.optionId, it.stock)}>수량 맞추기</button>
                    )}
                  </p>
                )}
              </div>
              <div className="hlt-ci-act">
                <div className="hlt-qty">
                  <button type="button" disabled={pending || it.qty <= 1}
                    onClick={() => setQty(it.optionId, it.qty - 1)} aria-label={`${it.name} 수량 줄이기`}>−</button>
                  <input type="number" min={1} max={99} defaultValue={it.qty} key={it.qty}
                    aria-label={`${it.name} 수량`}
                    onBlur={(e) => {
                      const v = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                      if (v !== it.qty) setQty(it.optionId, v);
                    }} />
                  <button type="button" disabled={pending || it.qty >= 99}
                    onClick={() => setQty(it.optionId, it.qty + 1)} aria-label={`${it.name} 수량 늘리기`}>+</button>
                </div>
                <b className="money">{krw(it.amount)}</b>
                <button type="button" className="hlt-btn sm danger" disabled={pending}
                  onClick={() => setQty(it.optionId, 0)}>삭제</button>
              </div>
            </div>
          );
        })}
      </div>

      {err && <p className="form-error" role="alert">{err}</p>}

      <section className="hlt-box">
        <div className="hlt-sum"><span>상품 금액</span><span>{krw(cart.goods)}</span></div>
        <div className="hlt-sum"><span>배송비</span><span>{cart.shipFee === 0 ? '무료' : krw(cart.shipFee)}</span></div>
        <div className="hlt-sum tot"><span>결제 예정 금액</span><span>{krw(cart.total)}</span></div>
        {cart.note && <p className="hint">{cart.note}</p>}
        {cart.hasProblem && (
          <p className="form-error" role="alert">주문할 수 없는 항목이 있습니다. 위에서 정리한 뒤 진행하십시오.</p>
        )}
        {cart.priceChanged && (
          <label className="hlt-chk" data-price-ack>
            <input type="checkbox" checked={false} disabled={pending} onChange={ackPrices} />
            <span>가격이 바뀐 상품이 있습니다 — 바뀐 값을 <b>확인했습니다</b></span>
          </label>
        )}
        {cart.hasProblem || cart.priceChanged
          ? <button type="button" className="cta-primary" disabled>주문하기</button>
          : <Link className="cta-primary as-link" href="/health/order">주문하기</Link>}
      </section>
      <p className="hint">
        장바구니는 <b>재고를 잡지 않습니다</b> — 주문하실 때 재고 · 가격 · 판매 상태를 다시 봅니다.
        담을 때 본 금액과 결제 금액이 다르면 분쟁이 되므로 조용히 바꾸지 않습니다.
      </p>
    </>
  );
}
