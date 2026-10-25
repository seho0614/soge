'use client';
import { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HltAddress, HltCart } from './types';
import { useTranslations } from 'next-intl';
import { codeText, needsLogin, PAY_METHODS } from './util';
import { ProductArt } from './ProductArt';
import { useFmt } from '@/lib/useFmt';

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
  const t = useTranslations('order');
  const f = useFmt();
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
        if (r.status >= 500) { setErr(t('form.errServer')); return; }
        const q = new URLSearchParams({ step: 'order', code: d?.code ?? String(r.status), msg: d?.message ?? t('form.errOrder') });
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
        <h3>{t('form.items')}</h3>
        {cart.items.map((i) => (
          <div key={i.optionId} className="hlt-ci" data-order-line={i.optionId}>
            <span className="hlt-mini"><ProductArt p={i} size={44} /></span>
            <div className="bd">
              <b>{i.name}</b>
              {i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm" data-optlabel>{i.optionLabel}</span>}
              <span className="hint">{t('form.unitQty', { price: f.won(i.price, '-'), qty: String(i.qty) })}</span>
              {i.withdrawalBlockedIf && <span className="hint">{t('common.withdrawalLimit', { v: i.withdrawalBlockedIf })}</span>}
            </div>
            <b className="money">{f.won(i.amount, '-')}</b>
          </div>
        ))}
      </section>

      <section className="hlt-box">
        <h3>{t('form.address')}</h3>
        {addresses.length === 0 ? (
          <div className="notice">
            {t('form.noAddress')}{' '}
            <Link href="/my/health/addresses?next=/health/order">{t('form.addAddress')}</Link>
          </div>
        ) : !pick && picked ? (
          <div className="hlt-addr-picked" data-addr-picked>
            <p>
              <b>{picked.label || t('form.address')}</b>{picked.isDefault && <span className="hlt-bdg">{t('form.default')}</span>}
              {' '}{picked.receiver} · {picked.phone}<br />
              <span className="hint">({picked.zipcode}) {picked.addr1} {picked.addr2 ?? ''}</span>
            </p>
            <div className="hlt-btns">
              <button type="button" className="hlt-btn sm" data-addr-change onClick={() => setPick(true)}>{t('form.change')}</button>
              <Link className="hlt-btn sm" href="/my/health/addresses?next=/health/order">{t('form.manageAddress')}</Link>
            </div>
          </div>
        ) : (
          <div className="hlt-radios" role="radiogroup" aria-label={t('form.address')}>
            {addresses.map((a) => (
              <label key={a.id} className={`hlt-radio${addr === a.id ? ' on' : ''}`}>
                <input type="radio" name="addr" value={a.id} checked={addr === a.id} onChange={() => { setAddr(a.id); setPick(false); }} />
                <span>
                  <b>{a.label || t('form.address')}</b>{a.isDefault && <span className="hlt-bdg">{t('form.default')}</span>}
                  {' '}{a.receiver} · {a.phone}<br />
                  <span className="hint">({a.zipcode}) {a.addr1} {a.addr2 ?? ''}</span>
                </span>
              </label>
            ))}
            <Link className="hlt-btn sm" href="/my/health/addresses?next=/health/order">{t('form.manageAddress')}</Link>
          </div>
        )}
        <div className="hlt-f" data-ship-memo="">
          <label htmlFor="shipMemo">{t('form.shipMemo')}</label>
          <input id="shipMemo" value={memo} maxLength={50} placeholder={t('form.shipMemoPh')}
            onChange={(e) => setMemo(e.target.value)} />
          <span className="hint">{t('form.shipMemoHint', { n: String(memo.length) })}</span>
        </div>
      </section>

      <section className="hlt-box">
        <h3>{t('common.payMethod')}</h3>
        <div className="hlt-chips" role="radiogroup" aria-label={t('common.payMethod')}>
          {PAY_METHODS.map((m) => (
            <button key={m.code} type="button" role="radio" aria-checked={method === m.code}
              className={`hlt-chip${method === m.code ? ' on' : ''}`} onClick={() => setMethod(m.code)}>{codeText(t, 'payMethod', m.code, m.label)}</button>
          ))}
        </div>
        {method === 'EASY' && <p className="hint">{t('form.easyNote')}</p>}
        <p className="hint">{t('form.cardNote')}</p>
      </section>

      <section className="hlt-box">
        <h3>{t('common.payAmount')}</h3>
        <div className="hlt-sum"><span>{t('common.goods')}</span><span>{f.won(cart.goods, '-')}</span></div>
        <div className="hlt-sum"><span>{t('common.shipFee')}</span><span>{cart.shipFee === 0 ? t('common.free') : f.won(cart.shipFee, '-')}</span></div>
        <div className="hlt-sum" data-discount=""><span>{t('form.discount')}</span><span>{f.won(0, '-')}</span></div>
        <div className="hlt-sum tot"><span>{t('form.total')}</span><span>{f.won(cart.total, '-')}</span></div>
        <p className="hint">{t('form.recalc')}</p>
      </section>

      {/* 두 동의를 하나로 합치지 않습니다 — 개인정보보호법상 동의 항목은 구분해 표시해야 합니다(시안) */}
      <section className="hlt-box">
        <h3>{t('form.agree')}</h3>
        <label className="hlt-chk">
          <input type="checkbox" checked={agree1} onChange={(e) => setAgree1(e.target.checked)} />
          <span>{t.rich('form.agree1', { link: (c) => <Link href="/health/guide">{c}</Link> })}</span>
        </label>
        <label className="hlt-chk">
          <input type="checkbox" checked={agree2} onChange={(e) => setAgree2(e.target.checked)} />
          <span>{t('form.agree2')}</span>
        </label>
      </section>

      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="button" className="cta-primary" disabled={!ready || pending} onClick={submit}>
        {pending ? t('form.submitting') : t('common.payBtn', { amount: f.won(cart.total, '-') })}
      </button>
      {!ready && !pending && (
        <p className="cta-note">
          {!addr ? t('form.needAddr') : !(agree1 && agree2) ? t('form.needAgree')
            : cart.priceChanged ? <>{t.rich('form.priceChanged', { link: (c) => <Link href="/health/cart">{c}</Link> })}</> : t('form.cannotOrder')}
        </p>
      )}
    </>
  );
}
