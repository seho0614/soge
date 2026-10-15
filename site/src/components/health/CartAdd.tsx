'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { needsLogin } from './util';

/**
 * 장바구니 담기 · 바로구매 — POST /me/health/cart
 *
 * **재고를 잡지 않습니다**(서버 규칙). 주문하실 때 다시 확인합니다.
 * 비로그인이면 API 가 403 UNAUTHENTICATED 를 줍니다 → 로그인으로 보냅니다.
 */
export function CartAdd({
  code, name, compact = false, max = 99, optionId, label, hideBuy = false,
}: { code: string; name: string; compact?: boolean; max?: number; optionId?: string | null; label?: string; hideBuy?: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cap = Math.max(1, Math.min(max, 99));

  function add(buyNow: boolean) {
    setMsg(null);
    start(async () => {
      const r = await fetch('/api/v1/me/health/cart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        /* v10.26 — 옵션(개월 수). 옵션이 하나뿐인 상품(단품)은 서버가 정합니다 */
        body: JSON.stringify({ productCode: code, qty, ...(optionId ? { optionId } : {}) }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setMsg({ ok: false, text: d?.message ?? '담지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' });
        return;
      }
      if (buyNow) { router.push('/health/order'); return; }
      setMsg({ ok: true, text: `${name}${label ? ` ${label}` : ''} 을(를) 장바구니에 담았습니다.` });
      router.refresh();
    });
  }

  /* v10.26 — 카드의 담기는 시안처럼 🛒 그림 단추(hlt-cartic) */
  if (compact) {
    return (
      <div className="hlt-add">
        <button type="button" className="hlt-cartic" disabled={pending} onClick={() => add(false)} data-cardadd={code}
          aria-label={`${name} 장바구니에 담기`}>{pending ? '…' : '🛒'}</button>
        {msg && (msg.ok
          ? <Link href="/health/cart" className="hlt-ok">담았습니다 · 장바구니 보기</Link>
          : <span className="form-error" role="alert">{msg.text}</span>)}
      </div>
    );
  }

  return (
    <div className="hlt-buy">
      <div className="hlt-qty">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="수량 줄이기">−</button>
        <input type="number" min={1} max={cap} value={qty} aria-label={`${name} 수량`}
          onChange={(e) => setQty(Math.max(1, Math.min(cap, Number(e.target.value) || 1)))} />
        <button type="button" onClick={() => setQty((q) => Math.min(cap, q + 1))} aria-label="수량 늘리기">+</button>
      </div>
      {!hideBuy && <div className="hlt-btns">
        <button type="button" className="hlt-btn lg" disabled={pending} onClick={() => add(false)}>장바구니</button>
        <button type="button" className="hlt-btn lg pri" disabled={pending} onClick={() => add(true)}>
          {pending ? '처리 중…' : '바로구매'}
        </button>
      </div>}
      {msg && (msg.ok
        ? <p className="ok-note" role="status">{msg.text} <Link href="/health/cart">장바구니 보기</Link></p>
        : <p className="form-error" role="alert">{msg.text}</p>)}
    </div>
  );
}
