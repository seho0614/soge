'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { lsxCall } from './api';

export interface SavedItem { id: number; name: string; gwanCode: string | null; categoryName: string | null; keyword: string | null; regionCode: string | null; axis: string | null; notify: boolean; searchUrl: string | null }

/** v10.513 (D276) 저장한 검색 줄 — 알림 켜고 끄기 · 지우기 */
export function SavedList({ items }: { items: SavedItem[] }) {
  const t = useTranslations('lsx');
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function act(id: number, fn: () => Promise<{ ok: boolean; body: { message?: string } }>) {
    setBusy(id); setErr(null);
    try { const r = await fn(); if (!r.ok) setErr(r.body.message ?? t('saveFail')); else router.refresh(); } finally { setBusy(null); }
  }
  const cond = (s: SavedItem) => [s.gwanCode, s.keyword ? t('condKeyword', { kw: s.keyword }) : null, s.categoryName ? t('condCategory', { name: s.categoryName }) : null,
    s.regionCode ? t('condRegion', { code: s.regionCode }) : null, s.axis].filter(Boolean).join(' · ') || t('condAll');
  return (
    <div data-lsx-saved-list={items.length}>
      {err && <p className="warn-text" role="alert">{err}</p>}
      <table className="my-tbl">
        <thead><tr><th>{t('colName')}</th><th>{t('colCond')}</th><th>{t('colNotify')}</th><th /></tr></thead>
        <tbody>{items.map((s) => (
          <tr key={s.id} data-lsx-saved-row={s.id}>
            <td>{s.name}</td><td>{cond(s)}</td>
            <td><button type="button" className="btn-sm" disabled={busy === s.id} data-lsx-notify={s.id}
              onClick={() => act(s.id, () => lsxCall(`/me/saved-searches/${s.id}`, 'PUT', { notify: !s.notify }))}>{s.notify ? t('notifyOn') : t('notifyOff')}</button></td>
            <td>
              {s.searchUrl && <Link className="btn-sm" href={s.searchUrl}>{t('open')}</Link>}{' '}
              <button type="button" className="btn-sm" disabled={busy === s.id} data-lsx-remove={s.id}
                onClick={() => { if (window.confirm(t('removeAsk', { name: s.name }))) void act(s.id, () => lsxCall(`/me/saved-searches/${s.id}`, 'DELETE')); }}>{t('remove')}</button>
            </td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
