'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';
import { useFmt } from '@/lib/useFmt';

export interface SellerOrderRow {
  orderNo: string; status: string; total: number | string; shipFee: number | string; paidAt: string | null; shipMemo: string | null;
  items: string | null; receiver: string | null; phone: string | null; address: string | null;
  carrier: string | null; trackingNo: string | null; openReturn: boolean;
}
export interface SellerOrders { counts: { toShip: number; shipping: number; delivered: number; confirmed: number }; carriers: string[]; items: SellerOrderRow[] }
export interface SellerReturnRow {
  id: string; kind: 'CANCEL' | 'RETURN' | 'EXCHANGE'; reason: string; detail: string | null; state: string; customerOpened: boolean | null;
  orderNo: string; orderStatus: string; total: number | string; decideNote: string | null; createdAt: string;
}

/**
 * v10.167 (docs/258) — 판매자센터 「주문 · 발송」 · 「취소 · 반품 신청」.
 *   발송 처리 · 송장 고치기 · 배송 완료는 운영과 같은 규칙(서버). 받는 분 정보는 발송 전 · 배송 중에만 내려옴(입점 약관 제22조).
 *   반품 승인 · 반려도 운영과 같은 규칙 — 반품 승인은 개봉 여부를 정해야 함 · 반려 사유는 회원에게 보임.
 */
export function SellerOrdersView({ orders, returns }: { orders: SellerOrders; returns: SellerReturnRow[] }) {
  const t = useTranslations('hlt.sorders');
  const f = useFmt();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(path: string, body: unknown, done: string) {
    setErr(null); setMsg(null);
    const r = await fetch(`/api/v1/me/health/seller${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
      setErr(r.status >= 500 ? t('errSave') : d?.message ?? t('errSave'));
      return;
    }
    setMsg(done); router.refresh();
  }

  function ship(e: React.FormEvent<HTMLFormElement>, o: SellerOrderRow, fix: boolean) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { carrier: String(fd.get('carrier') ?? ''), trackingNo: String(fd.get('trackingNo') ?? '').replace(/[^0-9]/g, '') };
    start(() => send(`/orders/${encodeURIComponent(o.orderNo)}/${fix ? 'tracking' : 'ship'}`, body, fix ? t('fixed') : t('shipped')));
  }
  const delivered = (o: SellerOrderRow) => start(() => send(`/orders/${encodeURIComponent(o.orderNo)}/advance`, { state: 'DELIVERED' }, t('deliveredDone')));
  const decide = (r: SellerReturnRow, ok: boolean) => {
    if (!ok) {
      const note = prompt(t('rejectAsk')) ?? '';
      if (!note.trim()) return;
      start(() => send(`/returns/${r.id}/decide`, { state: 'REJECTED', note }, t('rejected')));
      return;
    }
    const body: Record<string, unknown> = { state: 'APPROVED' };
    if (r.kind === 'RETURN') {
      const opened = confirm(t('openedAsk'));
      body.opened = opened;
    }
    start(() => send(`/returns/${r.id}/decide`, body, t('approved')));
  };

  return (
    <div data-seller-orders="">
      {msg && <p className="ok-note" role="status">{msg}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}
      <section className="hlt-box">
        <h3>{t('title')}</h3>
        <p>{t('counts', { toShip: String(orders.counts?.toShip ?? 0), shipping: String(orders.counts?.shipping ?? 0), delivered: String(orders.counts?.delivered ?? 0) })}</p>
        <p className="hint">{t('privacy')}</p>
        {orders.items.length === 0 && <p className="hint">{t('empty')}</p>}
        {orders.items.map((o) => (
          <div key={o.orderNo} className="hlt-box" data-seller-order={o.orderNo} data-status={o.status}>
            <b>{o.orderNo}</b> · {t(`status.${o.status as 'PAID'}`)} · {f.won(o.total, '-')}
            <p className="hint">{o.items}</p>
            {o.receiver && <p>{o.receiver} · {o.phone} · {o.address}{o.shipMemo ? ` · ${o.shipMemo}` : ''}</p>}
            {o.openReturn && <p className="notice">{t('openReturn')}</p>}
            {(o.status === 'PAID' || o.status === 'PREPARING' || o.status === 'SHIPPED') && (
              <form className="hlt-row" onSubmit={(e) => ship(e, o, o.status === 'SHIPPED')} data-seller-ship={o.orderNo}>
                <select name="carrier" defaultValue={o.carrier ?? orders.carriers[0]}>{orders.carriers.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <input name="trackingNo" required inputMode="numeric" pattern="[0-9]{10,14}" placeholder={t('trackingPh')} defaultValue={o.trackingNo ?? ''} />
                <button className="hlt-btn sm" disabled={pending}>{o.status === 'SHIPPED' ? t('fix') : t('ship')}</button>
                {o.status === 'SHIPPED' && <button type="button" className="hlt-btn sm" disabled={pending} onClick={() => delivered(o)}>{t('delivered')}</button>}
              </form>
            )}
          </div>
        ))}
      </section>
      <section className="hlt-box">
        <h3>{t('retTitle')}</h3>
        {returns.length === 0 && <p className="hint">{t('retEmpty')}</p>}
        {returns.map((r) => (
          <div key={r.id} className="hlt-row" data-seller-return={r.id} data-state={r.state}>
            <span><b>{r.orderNo}</b> · {t(`kind.${r.kind}`)} · {r.reason}{r.detail ? ` — ${r.detail}` : ''} · {t(`rstate.${r.state as 'REQUESTED'}`)}{r.decideNote ? ` · ${r.decideNote}` : ''}</span>
            {r.state === 'REQUESTED' && <>
              <button className="hlt-btn sm" disabled={pending} onClick={() => decide(r, true)}>{t('approve')}</button>
              <button className="hlt-btn sm danger" disabled={pending} onClick={() => decide(r, false)}>{t('reject')}</button>
            </>}
          </div>
        ))}
        <p className="hint">{t('retHelp')}</p>
      </section>
    </div>
  );
}
