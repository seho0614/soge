'use client';
/**
 * v10.503 (D273 · docs/641) SB-MYP-MBX-030 가격 알림 — 브라우저 부품
 *   GET /me/price-alerts · POST /me/price-alerts(켜기 · 「내릴 때만」) · DELETE /me/price-alerts/{type}/{key}(끄기)
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
import { GWAN_PATH } from '@/lib/format';

interface W { type: 'LISTING' | 'PRODUCT'; key: string; title: string; gwanCode?: string | null; price: number | null; fee: number | null;
  basePrice: number | null; baseFee: number | null; dropOnly: boolean; open: boolean; lastNotifiedAt: string | null }
interface Fav { key: string; title: string; gwanCode: string; price: number | null; fee: number | null }
interface Res { enabled: boolean; max: number; items: W[]; favorites: Fav[] }

export function PriceAlertsView() {
  const t = useTranslations('mbx.price');
  const f = useFmt();
  const [d, setD] = useState<Res | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/v1/me/price-alerts').catch(() => null);
    setD(r && r.ok ? await r.json() as Res : { enabled: false, max: 0, items: [], favorites: [] });
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function turnOn(type: 'LISTING' | 'PRODUCT', key: string, dropOnly?: boolean) {
    setMsg(null); setBusy(key);
    try {
      const r = await fetch('/api/v1/me/price-alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, key, dropOnly }) });
      const x = await r.json().catch(() => null) as { message?: string } | null;
      if (!r.ok) { setMsg(x?.message ?? t('failed')); return; }
      await load();
    } finally { setBusy(null); }
  }
  async function turnOff(type: 'LISTING' | 'PRODUCT', key: string) {
    setMsg(null); setBusy(key);
    try {
      const r = await fetch(`/api/v1/me/price-alerts/${type}/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!r.ok) { setMsg(t('failed')); return; }
      await load();
    } finally { setBusy(null); }
  }
  const href = (type: string, key: string, gwan?: string | null) => (type === 'PRODUCT' ? `/health/p/${encodeURIComponent(key)}` : `/${GWAN_PATH[gwan ?? ''] ?? 'money'}/${key}`);
  if (!d) return null;

  return (
    <>
      {!d.enabled && <p className="mbx-note warn" data-mbx-price-off="">{t('off')}</p>}
      <p className="mbx-note">{t('how', { max: String(d.max) })}</p>
      {msg && <p className="mbx-note warn" role="status">{msg}</p>}
      <h2 className="mbx-h1">{t('onHead')}</h2>
      {d.items.length === 0 ? <div className="mbx-empty" data-mbx-price-empty="">{t('empty')}</div> : (
        <ul className="mbx-list" data-mbx-price-list={d.items.length}>
          {d.items.map((w) => {
            const moved = w.open && (w.price !== w.basePrice || (w.type === 'LISTING' && w.fee !== w.baseFee));
            return (
              <li key={`${w.type}:${w.key}`} className={w.open ? '' : 'closed'} data-mbx-price-row={w.type}>
                <span className="mbx-badge">{w.type === 'PRODUCT' ? t('product') : t('listing')}</span>
                <div className="t">
                  {w.open ? <Link href={href(w.type, w.key, w.gwanCode)}><b>{w.title}</b></Link> : <b>{t('closed')}</b>}
                  <span className="m">{t('base')} {f.won(w.basePrice)} → {t('now')} {f.won(w.price)}
                    {w.type === 'LISTING' ? ` · ${t('fee')} ${f.won(w.baseFee)} → ${f.won(w.fee)}` : ''}
                    {moved ? <> · <span className="mbx-badge hot">{t('moved')}</span></> : null}</span>
                </div>
                <label className="m"><input type="checkbox" checked={w.dropOnly} disabled={busy === w.key || !d.enabled}
                  onChange={(e) => void turnOn(w.type, w.key, e.target.checked)} data-mbx-price-drop="" /> {t('dropOnly')}</label>
                <button type="button" className="mbx-btn" disabled={busy === w.key} onClick={() => void turnOff(w.type, w.key)} data-mbx-price-off-btn="">{t('turnOff')}</button>
              </li>
            );
          })}
        </ul>
      )}
      <h2 className="mbx-h1 mbx-gap">{t('favHead')}</h2>
      {d.favorites.length === 0 ? <div className="mbx-empty">{t('favEmpty')} <Link href="/my/likes">{t('toLikes')}</Link></div> : (
        <ul className="mbx-list" data-mbx-price-favs={d.favorites.length}>
          {d.favorites.map((x) => (
            <li key={x.key}>
              <div className="t"><Link href={href('LISTING', x.key, x.gwanCode)}><b>{x.title}</b></Link><span className="m">{f.won(x.price)} · {t('fee')} {f.won(x.fee)}</span></div>
              <button type="button" className="mbx-btn pri" disabled={busy === x.key || !d.enabled} onClick={() => void turnOn('LISTING', x.key)} data-mbx-price-on="">{t('turnOn')}</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
