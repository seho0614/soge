'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HltCart } from './types';
import { useTranslations } from 'next-intl';
import { krw, needsLogin } from './util';
import { ProductArt } from './ProductArt';

/**
 * 장바구니 — 수량 바꾸기 · 빼기 (v10.26 — 줄(옵션)마다 PATCH /me/health/cart/lines/{옵션}, 0 이면 빠집니다).
 *
 * 합계와 배송비는 **서버가 계산해** 내려보낸 값만 씁니다 — 화면에서 더하면
 * 화면과 주문서가 갈립니다. PATCH 응답이 새 장바구니 전체라 그대로 바꿔 끼웁니다.
 */
export function CartView({ initial }: { initial: HltCart }) {
  const t = useTranslations('order');
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
        setErr(d?.message ?? t('cart.errQty'));
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
      if (!r.ok) { if (needsLogin(r.status, d?.code)) { router.push('/login'); return; } setErr(d?.message ?? t('cart.errAck')); return; }
      setCart(d as HltCart);
      router.refresh();
    });
  }

  if (cart.items.length === 0) {
    return (
      <div className="hlt-empty">
        <p>{t('cart.empty')}</p>
        <Link className="hlt-btn pri" href="/health">{t('cart.browse')}</Link>
      </div>
    );
  }

  return (
    <>
      {/* 시안의 판매자별 묶음 머리 — 지금은 모두 직판이라 한 묶음입니다(입점 판매자는 v10.28) */}
      <div className="hlt-sm hlt-mut3" data-seller-group="DIRECT"><span className="hlt-bdg direct">{t('common.direct')}</span> {t('cart.directStore')}</div>
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
                  <span className="hlt-pchg" data-price-changed>{t.rich('cart.priceChanged', { was: krw(it.addedPrice), now: krw(it.price), s: (c) => <s>{c}</s>, b: (c) => <b>{c}</b> })}</span>
                )}
                {it.withdrawalBlockedIf && <span className="hint">{t('common.withdrawalLimit', { v: it.withdrawalBlockedIf })}</span>}
                {it.notOnSale && <p className="form-error">{t('cart.notOnSale')}</p>}
                {!it.notOnSale && it.overStock && (
                  <p className="form-error">
                    {t('cart.lowStock', { n: String(it.stock) })}
                    {it.stock > 0 && (
                      <button type="button" className="hlt-btn sm" disabled={pending}
                        onClick={() => setQty(it.optionId, it.stock)}>{t('cart.fitQty')}</button>
                    )}
                  </p>
                )}
              </div>
              <div className="hlt-ci-act">
                <div className="hlt-qty">
                  <button type="button" disabled={pending || it.qty <= 1}
                    onClick={() => setQty(it.optionId, it.qty - 1)} aria-label={t('cart.dec', { name: it.name })}>−</button>
                  <input type="number" min={1} max={99} defaultValue={it.qty} key={it.qty}
                    aria-label={t('cart.qty', { name: it.name })}
                    onBlur={(e) => {
                      const v = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                      if (v !== it.qty) setQty(it.optionId, v);
                    }} />
                  <button type="button" disabled={pending || it.qty >= 99}
                    onClick={() => setQty(it.optionId, it.qty + 1)} aria-label={t('cart.inc', { name: it.name })}>+</button>
                </div>
                <b className="money">{krw(it.amount)}</b>
                <button type="button" className="hlt-btn sm danger" disabled={pending}
                  onClick={() => setQty(it.optionId, 0)}>{t('cart.delete')}</button>
              </div>
            </div>
          );
        })}
      </div>

      {err && <p className="form-error" role="alert">{err}</p>}

      <section className="hlt-box">
        <div className="hlt-sum"><span>{t('common.goods')}</span><span>{krw(cart.goods)}</span></div>
        <div className="hlt-sum"><span>{t('common.shipFee')}</span><span>{cart.shipFee === 0 ? t('common.free') : krw(cart.shipFee)}</span></div>
        <div className="hlt-sum tot"><span>{t('cart.totalDue')}</span><span>{krw(cart.total)}</span></div>
        {cart.note && <p className="hint">{cart.note}</p>}
        {cart.hasProblem && (
          <p className="form-error" role="alert">{t('cart.hasProblem')}</p>
        )}
        {cart.priceChanged && (
          <label className="hlt-chk" data-price-ack>
            <input type="checkbox" checked={false} disabled={pending} onChange={ackPrices} />
            <span>{t.rich('cart.ack', { b: (c) => <b>{c}</b> })}</span>
          </label>
        )}
        {cart.hasProblem || cart.priceChanged
          ? <button type="button" className="cta-primary" disabled>{t('cart.order')}</button>
          : <Link className="cta-primary as-link" href="/health/order">{t('cart.order')}</Link>}
      </section>
      <p className="hint">
        {t.rich('cart.note', { b: (c) => <b>{c}</b> })}
      </p>
    </>
  );
}
