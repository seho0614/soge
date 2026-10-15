'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HltOption } from './types';
import { krw, needsLogin } from './util';

/**
 * 상품 상세의 「옵션 선택 (복용 개월 수)」 — 시안(SB-HLT-PRD-010) 그대로 (v10.26).
 *   옵션마다 한 줄: 이름 · 「결제 N원 · 남은 수량 N개」 · 수량 − / + · 「담기」. 재고 0 이면 「품절」 표 + 단추 잠금.
 *   아래 큰 단추 「장바구니」 「바로구매」는 **가장 짧은 개월 수 옵션**(대표 옵션)을 담습니다(시안과 같음).
 * 옵션이 하나뿐인 상품(단품)은 줄 없이 수량 · 큰 단추만 둡니다.
 */
export function OptionRows({ code, name, options }: { code: string; name: string; options: HltOption[] }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(options.map((o) => [o.id, 1])));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /* 대표 옵션 = 가장 짧은 개월 수(단품이 먼저) — 서버의 대표 판매가와 같은 규칙 */
  const rep = [...options].sort((a, b) => (a.months ?? 0) - (b.months ?? 0))[0];
  const single = options.length === 1;
  const repSold = !rep || rep.stock <= 0;

  function add(o: HltOption, buyNow: boolean) {
    setMsg(null);
    start(async () => {
      const r = await fetch('/api/v1/me/health/cart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode: code, optionId: o.id, qty: qty[o.id] ?? 1 }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setMsg({ ok: false, text: d?.message ?? '담지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' });
        return;
      }
      if (buyNow) { router.push('/health/order'); return; }
      setMsg({ ok: true, text: `${name}${o.months ? ` ${o.label}` : ''} 을(를) 장바구니에 담았습니다.` });
      router.refresh();
    });
  }
  const Qty = ({ o }: { o: HltOption }) => {
    const cap = Math.max(1, Math.min(o.stock, 99)); const v = qty[o.id] ?? 1;
    return (
      <span className="hlt-qty">
        <button type="button" onClick={() => setQty({ ...qty, [o.id]: Math.max(1, v - 1) })} aria-label="수량 줄이기" disabled={o.stock <= 0}>−</button>
        <input type="number" min={1} max={cap} value={v} disabled={o.stock <= 0} aria-label={`${o.label} 수량`}
          onChange={(e) => setQty({ ...qty, [o.id]: Math.max(1, Math.min(cap, Number(e.target.value) || 1)) })} />
        <button type="button" onClick={() => setQty({ ...qty, [o.id]: Math.min(cap, v + 1) })} aria-label="수량 늘리기" disabled={o.stock <= 0}>+</button>
      </span>
    );
  };

  return (
    <div data-options={options.length}>
      {!single && (
        <div style={{ marginTop: 16 }}>
          <h3>옵션 선택 <span className="hlt-sm hlt-mut3">(복용 개월 수)</span></h3>
          {options.map((o) => (
            <div key={o.id} className={`hlt-optrow${o.stock <= 0 ? ' sold' : ''}`} data-option={o.id}>
              <span className="nm" data-optlabel="1">
                {/* 시안의 옵션 이름 그대로 — 「월 3,900원 × 9개월 분 : 메가바이탈 비타민C 3000 2+1」 */}
                {o.unit != null ? `월 ${krw(o.unit)} × ${o.months}개월 분 : ${name}${o.tag ? ` ${o.tag}` : ''}` : o.label}
                {o.stock <= 0 && <> <span className="hlt-bdg soldout">품절</span></>}
                <br /><span className="hlt-sm hlt-mut3">결제 {krw(o.price)}{o.stock > 0 && ` · 남은 수량 ${o.stock}개`}</span>
              </span>
              <Qty o={o} />
              <button type="button" className="hlt-btn sm" disabled={pending || o.stock <= 0} onClick={() => add(o, false)} data-addcart={o.id}>담기</button>
            </div>
          ))}
          <p className="hlt-sm hlt-mut3" style={{ marginTop: 6 }}>개월 수에 따라 월 단가가 다릅니다. 라벨 앞의 월 단가로 바로 비교하십시오.</p>
        </div>
      )}
      {single && rep && <div style={{ marginTop: 16 }}><Qty o={rep} /> <span className="hlt-sm hlt-mut3">{rep.stock > 0 ? `남은 수량 ${rep.stock}개` : '지금은 품절입니다'}</span></div>}
      <div className="hlt-btns" style={{ marginTop: 16 }}>
        <button type="button" className="hlt-btn lg" style={{ flex: 1 }} disabled={pending || repSold} onClick={() => rep && add(rep, false)} data-addcart-main>장바구니</button>
        <button type="button" className="hlt-btn lg pri" style={{ flex: 1 }} disabled={pending || repSold} onClick={() => rep && add(rep, true)} data-buynow>
          {repSold ? '품절' : pending ? '처리 중…' : '바로구매'}
        </button>
      </div>
      {!single && rep && <p className="hlt-sm hlt-mut3" style={{ marginTop: 4 }}>큰 단추는 「{rep.label}」을 담습니다.</p>}
      {msg && (msg.ok
        ? <p className="ok-note" role="status">{msg.text} <Link href="/health/cart">장바구니 보기</Link></p>
        : <p className="form-error" role="alert">{msg.text}</p>)}
      {/* 좁은 화면의 아래 구매 줄(시안 hlt-buybar) — 넓은 화면에서는 숨김 */}
      <div className="hlt-buybar">
        <button type="button" className="hlt-btn" disabled={pending || repSold} onClick={() => rep && add(rep, false)}>장바구니</button>
        <button type="button" className="hlt-btn pri" disabled={pending || repSold} onClick={() => rep && add(rep, true)}>{repSold ? '품절' : '바로구매'}</button>
      </div>
    </div>
  );
}
