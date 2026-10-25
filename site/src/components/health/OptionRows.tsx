'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HltOption } from './types';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';
import { useFmt } from '@/lib/useFmt';

/**
 * 상품 상세의 「옵션 선택 (복용 개월 수)」 — 시안(SB-HLT-PRD-010) 그대로 (v10.26).
 *   옵션마다 한 줄: 이름 · 「결제 N원 · 남은 수량 N개」 · 수량 − / + · 「담기」. 재고 0 이면 「품절」 표 + 단추 잠금.
 *   아래 큰 단추 「장바구니」 「바로구매」는 **가장 짧은 개월 수 옵션**(대표 옵션)을 담습니다(시안과 같음).
 * 옵션이 하나뿐인 상품(단품)은 줄 없이 수량 · 큰 단추만 둡니다.
 */
export function OptionRows({ code, name, options }: { code: string; name: string; options: HltOption[] }) {
  const t = useTranslations('order');
  const f = useFmt();
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
        setMsg({ ok: false, text: d?.message ?? t('opt.errAdd') });
        return;
      }
      if (buyNow) { router.push('/health/order'); return; }
      setMsg({ ok: true, text: t('opt.added', { name: `${name}${o.months ? ` ${o.label}` : ''}` }) });
      router.refresh();
    });
  }
  const Qty = ({ o }: { o: HltOption }) => {
    const cap = Math.max(1, Math.min(o.stock, 99)); const v = qty[o.id] ?? 1;
    return (
      <span className="hlt-qty">
        <button type="button" onClick={() => setQty({ ...qty, [o.id]: Math.max(1, v - 1) })} aria-label={t('opt.dec')} disabled={o.stock <= 0}>−</button>
        <input type="number" min={1} max={cap} value={v} disabled={o.stock <= 0} aria-label={t('opt.qty', { label: o.label })}
          onChange={(e) => setQty({ ...qty, [o.id]: Math.max(1, Math.min(cap, Number(e.target.value) || 1)) })} />
        <button type="button" onClick={() => setQty({ ...qty, [o.id]: Math.min(cap, v + 1) })} aria-label={t('opt.inc')} disabled={o.stock <= 0}>+</button>
      </span>
    );
  };

  return (
    <div data-options={options.length}>
      {!single && (
        <div style={{ marginTop: 16 }}>
          <h3>{t('opt.title')} <span className="hlt-sm hlt-mut3">{t('opt.months')}</span></h3>
          {options.map((o) => (
            <div key={o.id} className={`hlt-optrow${o.stock <= 0 ? ' sold' : ''}`} data-option={o.id}>
              <span className="nm" data-optlabel="1">
                {/* 시안의 옵션 이름 그대로 — 「월 3,900원 × 9개월 분 : 메가바이탈 비타민C 3000 2+1」 */}
                {o.unit != null ? t('opt.unitName', { unit: f.won(o.unit, '-'), months: String(o.months), name: `${name}${o.tag ? ` ${o.tag}` : ''}` }) : o.label}
                {o.stock <= 0 && <> <span className="hlt-bdg soldout">{t('opt.soldout')}</span></>}
                <br /><span className="hlt-sm hlt-mut3">{t('opt.pay', { price: f.won(o.price, '-') })}{o.stock > 0 && t('opt.leftSep', { n: String(o.stock) })}</span>
              </span>
              <Qty o={o} />
              <button type="button" className="hlt-btn sm" disabled={pending || o.stock <= 0} onClick={() => add(o, false)} data-addcart={o.id}>{t('opt.add')}</button>
            </div>
          ))}
          <p className="hlt-sm hlt-mut3" style={{ marginTop: 6 }}>{t('opt.monthNote')}</p>
        </div>
      )}
      {single && rep && <div style={{ marginTop: 16 }}><Qty o={rep} /> <span className="hlt-sm hlt-mut3">{rep.stock > 0 ? t('opt.left', { n: String(rep.stock) }) : t('opt.soldNow')}</span></div>}
      <div className="hlt-btns" style={{ marginTop: 16 }}>
        <button type="button" className="hlt-btn lg" style={{ flex: 1 }} disabled={pending || repSold} onClick={() => rep && add(rep, false)} data-addcart-main>{t('common.cart')}</button>
        <button type="button" className="hlt-btn lg pri" style={{ flex: 1 }} disabled={pending || repSold} onClick={() => rep && add(rep, true)} data-buynow>
          {repSold ? t('opt.soldout') : pending ? t('opt.processing') : t('opt.buyNow')}
        </button>
      </div>
      {!single && rep && <p className="hlt-sm hlt-mut3" style={{ marginTop: 4 }}>{t('opt.bigBtn', { label: rep.label })}</p>}
      {msg && (msg.ok
        ? <p className="ok-note" role="status">{msg.text} <Link href="/health/cart">{t('opt.viewCart')}</Link></p>
        : <p className="form-error" role="alert">{msg.text}</p>)}
      {/* 좁은 화면의 아래 구매 줄(시안 hlt-buybar) — 넓은 화면에서는 숨김 */}
      <div className="hlt-buybar">
        <button type="button" className="hlt-btn" disabled={pending || repSold} onClick={() => rep && add(rep, false)}>{t('common.cart')}</button>
        <button type="button" className="hlt-btn pri" disabled={pending || repSold} onClick={() => rep && add(rep, true)}>{repSold ? t('opt.soldout') : t('opt.buyNow')}</button>
      </div>
    </div>
  );
}
