'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';
import type { HltSaleCategory } from './types';

export interface SellerCenterInfo {
  code: string; name: string; type: string; status: string; commissionRate: number | string | null; payable: boolean;
  shipFee: number; freeShipOver: number | null; returnShipFee: number;
  products: number; onSale: number; inReview: number; tenantOn: boolean;
  /** v10.277 (D208 · docs/406) 예정된 수수료율 변경 — 입점 약관 제17조 4항(30일 전 공지) */
  /** v10.278 (D209) 소개몰 공지(게시된 것 · 최근 5) */
  notices?: { id: string; title: string; body: string; publishedAt: string; isPinned: boolean }[];
  rateSchedules?: { scope: 'SELLER' | 'TYPE' | 'CATEGORY'; effectiveDate: string; fromRate: number | string | null; toRate: number | string | null; reason: string; categoryName: string | null }[];
}
export interface SellerProduct {
  code: string; name: string; status: string; reviewState: 'NONE' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'; reviewNote: string | null;
  price: number | string; stock: number | string; categoryCode: string | null; categoryName: string | null;
}

/**
 * v10.166 (D156 · docs/257) — 소개몰 판매자센터: 배송비 · 반품비 · 내 상품 · 상품 등록(초안) · 검수 요청 · 판매 시작 · 중지 · 값 · 재고.
 *   상품 규칙(금지 표현 · 판매 범위 · 옵션)은 서버 · DB 가 봄 — 거절 글을 그대로 보여 줌.
 *   판매 시작은 검수 통과 · 판매자 승인 · 하위가맹점 등록 · 입점 켜짐이 모두 있어야 됨(DB).
 */
export function SellerCenter({ info, items, cats }: { info: SellerCenterInfo; items: SellerProduct[]; cats: HltSaleCategory[] }) {
  const t = useTranslations('hlt.center');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = cats.filter((c) => c.state === 'OPEN');

  async function send(path: string, method: string, body: unknown, done: string) {
    setErr(null); setMsg(null);
    const r = await fetch(`/api/v1/me/health/seller${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      if (needsLogin(r.status, d?.code)) { router.push('/login'); return false; }
      setErr(r.status >= 500 ? t('errSave') : d?.message ?? t('errSave'));
      return false;
    }
    setMsg(done); router.refresh();
    return true;
  }

  function saveShipping(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = (k: string) => Number(String(fd.get(k) ?? '').replace(/[^0-9]/g, '') || 0);
    const over = String(fd.get('freeShipOver') ?? '').trim();
    start(async () => { await send('/shipping', 'PATCH', { shipFee: num('shipFee'), freeShipOver: over ? num('freeShipOver') : null, returnShipFee: num('returnShipFee') }, t('saved')); });
  }

  function createProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const v = (k: string) => String(fd.get(k) ?? '').trim();
    const notice: Record<string, string> = {};
    for (const line of v('notice').split('\n')) {
      const i = line.indexOf(':');
      if (i > 0 && line.slice(i + 1).trim()) notice[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    start(async () => {
      const okd = await send('/products', 'POST', {
        code: v('code'), name: v('name'), categoryCode: v('categoryCode'), summary: v('summary') || undefined, caution: v('caution') || undefined,
        notice, options: [{ price: Number(v('price').replace(/[^0-9]/g, '') || 0), stock: Number(v('stock').replace(/[^0-9]/g, '') || 0) }],
      }, t('created'));
      if (okd) form.reset();
    });
  }

  const act = (p: SellerProduct, what: 'submit' | 'ON_SALE' | 'STOPPED') => start(async () => {
    if (what === 'submit') await send(`/products/${encodeURIComponent(p.code)}/submit`, 'POST', {}, t('submitted'));
    else await send(`/products/${encodeURIComponent(p.code)}/status`, 'POST', { status: what }, what === 'ON_SALE' ? t('started') : t('stopped'));
  });

  return (
    <div data-seller-center={info.code}>
      <section className="hlt-box">
        <h3>{info.name} <small className="dim">{info.code}</small></h3>
        <p>{t('summary', { products: String(info.products), onSale: String(info.onSale), inReview: String(info.inReview) })}</p>
        {!info.tenantOn && <p className="notice" data-center-warn="off">{t('tenantOff')}</p>}
        {(info.rateSchedules ?? []).map((r, i) => {
          const rt = (v: number | string | null) => (v === null ? t('rateNext') : `${Number(v)}%`);
          const what = r.scope === 'SELLER' ? t('rateSchedSeller') : r.scope === 'TYPE' ? t('rateSchedType') : t('rateSchedCategory', { name: r.categoryName ?? '' });
          return <p key={i} className="notice" data-rate-schedule-notice={r.effectiveDate}>{t('rateSched', { what, from: rt(r.fromRate), to: rt(r.toRate), date: r.effectiveDate, reason: r.reason })}</p>;
        })}
        {(info.notices ?? []).length > 0 && (
          <div className="card" data-seller-notices={(info.notices ?? []).length}>
            <b>{t('notices')}</b>
            {(info.notices ?? []).map((x) => (
              <details key={x.id} data-seller-notice={x.id}>
                <summary>{x.title} <span className="dim">{String(x.publishedAt).slice(0, 10)}</span></summary>
                <p style={{ whiteSpace: 'pre-line' }}>{x.body}</p>
              </details>
            ))}
          </div>
        )}
        {!info.payable && <p className="notice" data-center-warn="payable">{t('notPayable')}</p>}
        {info.status === 'PAUSED' && <p className="notice">{t('paused')}</p>}
      </section>

      {msg && <p className="ok-note" role="status">{msg}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}

      <section className="hlt-box">
        <h3>{t('shipTitle')}</h3>
        <form className="auth hlt-form" onSubmit={saveShipping} data-center-shipping="">
          <label className="fld"><span>{t('shipFee')}</span><input name="shipFee" inputMode="numeric" defaultValue={String(info.shipFee)} /></label>
          <label className="fld"><span>{t('freeShipOver')}</span><input name="freeShipOver" inputMode="numeric" placeholder={t('freeShipPh')} defaultValue={info.freeShipOver ? String(info.freeShipOver) : ''} /></label>
          <label className="fld"><span>{t('returnShipFee')}</span><input name="returnShipFee" inputMode="numeric" defaultValue={String(info.returnShipFee)} /></label>
          <p className="hint">{t('returnHelp')}</p>
          <button className="cta-primary" disabled={pending}>{t('save')}</button>
        </form>
      </section>

      <section className="hlt-box">
        <h3>{t('listTitle')}</h3>
        {items.length === 0 && <p className="hint">{t('empty')}</p>}
        {items.length > 0 && (
          <table className="tbl hlt-tbl">
            <thead><tr><th>{t('colName')}</th><th>{t('colPrice')}</th><th>{t('colStatus')}</th><th>{t('colReview')}</th><th /></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.code} data-center-product={p.code} data-review={p.reviewState}>
                  <td><b>{p.name}</b><br /><small className="dim">{p.code} · {p.categoryName ?? ''}</small></td>
                  <td>{Number(p.price).toLocaleString()} · {t('stockN', { n: String(p.stock) })}</td>
                  <td>{t(`status.${p.status as 'DRAFT' | 'ON_SALE' | 'SOLD_OUT' | 'STOPPED'}`)}</td>
                  <td>{t(`review.${p.reviewState}`)}{p.reviewState === 'REJECTED' && p.reviewNote ? <><br /><small className="form-error">{p.reviewNote}</small></> : null}</td>
                  <td>
                    {(p.reviewState === 'NONE' || p.reviewState === 'REJECTED') && <button className="hlt-btn sm" disabled={pending} onClick={() => act(p, 'submit')} data-center-submit="">{t('submit')}</button>}
                    {p.reviewState === 'APPROVED' && p.status !== 'ON_SALE' && <button className="hlt-btn sm" disabled={pending} onClick={() => act(p, 'ON_SALE')} data-center-start="">{t('start')}</button>}
                    {p.status === 'ON_SALE' && <button className="hlt-btn sm" disabled={pending} onClick={() => act(p, 'STOPPED')}>{t('stop')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="hlt-box">
        <h3>{t('newTitle')}</h3>
        <form className="auth hlt-form" onSubmit={createProduct} data-center-new="">
          <label className="fld"><span>{t('code')}</span><input name="code" required pattern="[A-Za-z0-9][A-Za-z0-9-]{1,29}" placeholder="VITC-60" /></label>
          <p className="hint">{t('codeHelp', { prefix: info.code })}</p>
          <label className="fld"><span>{t('name')}</span><input name="name" required maxLength={80} /></label>
          <label className="fld"><span>{t('category')}</span>
            <select name="categoryCode" required defaultValue="">{[<option key="" value="" disabled>{t('pick')}</option>, ...open.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)]}</select></label>
          <label className="fld"><span>{t('summaryField')}</span><input name="summary" maxLength={120} /></label>
          <label className="fld"><span>{t('price')}</span><input name="price" required inputMode="numeric" /></label>
          <label className="fld"><span>{t('stock')}</span><input name="stock" required inputMode="numeric" defaultValue="0" /></label>
          <label className="fld"><span>{t('caution')}</span><textarea name="caution" maxLength={500} rows={2} /></label>
          <label className="fld"><span>{t('notice')}</span><textarea name="notice" rows={4} placeholder={t('noticePh')} /></label>
          <button className="cta-primary" disabled={pending}>{t('create')}</button>
        </form>
      </section>
    </div>
  );
}
