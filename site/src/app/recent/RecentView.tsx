'use client';
/**
 * v10.501 (D273 · docs/639) SB-HOM-MBX-010 최근 본 매물 · 상품 — 브라우저 부품
 *   로그인 회원: 서버 목록(GET /me/recent) · 하나 지우기(DELETE /me/recent/{type}/{key}) · 모두 지우기(DELETE /me/recent)
 *                들어올 때 이 브라우저에 남은 것을 한 번 합침(POST /me/recent/merge)
 *   로그인 전:   이 브라우저 목록(localStorage) — 서버에 보내지 않음
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
import { GWAN_PATH } from '@/lib/format';
import { clearLocalRecent, localRecent, mergeLocalRecent, removeLocalRecent, type MbxType } from '@/components/mbx/mbxLocal';

interface Row { type: MbxType; key: string; title: string; price?: number | null; fee?: number | null; gwanCode?: string | null; categoryName?: string | null;
  open: boolean; soldOut?: boolean | null; viewedAt: string; viewCount?: number }

const hrefOf = (r: Row) => (r.type === 'PRODUCT' ? `/health/p/${encodeURIComponent(r.key)}` : `/${GWAN_PATH[r.gwanCode ?? ''] ?? 'money'}/${r.key}`);

export function RecentView({ loggedIn, enabled }: { loggedIn: boolean; enabled: boolean }) {
  const t = useTranslations('mbx.recent');
  const f = useFmt();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [max, setMax] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!loggedIn) { setRows(localRecent().map((x) => ({ ...x, open: true, viewedAt: x.at }))); return; }
    await mergeLocalRecent();
    const r = await fetch('/api/v1/me/recent').catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) as { items?: Row[]; max?: number } | null : null;
    setRows(d?.items ?? []); if (d?.max) setMax(d.max);
  }, [loggedIn]);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  if (!enabled) return <div className="mbx-empty" data-mbx-recent-off="">{t('off')}</div>;

  async function remove(r: Row) {
    setMsg(null);
    if (!loggedIn) { removeLocalRecent(r.type, r.key); void load(); return; }
    const res = await fetch(`/api/v1/me/recent/${r.type}/${encodeURIComponent(r.key)}`, { method: 'DELETE' });
    if (!res.ok) { setMsg(t('failed')); return; }
    void load();
  }
  async function clearAll() {
    setMsg(null);
    if (!window.confirm(t('clearConfirm'))) return;
    if (!loggedIn) { clearLocalRecent(); void load(); return; }
    const res = await fetch('/api/v1/me/recent', { method: 'DELETE' });
    if (!res.ok) { setMsg(t('failed')); return; }
    void load();
  }

  return (
    <>
      <p className="mbx-note" data-mbx-recent-where={loggedIn ? 'server' : 'browser'}>{loggedIn ? t('memberNote', { max: String(max) }) : t('guestNote')}</p>
      {msg && <p className="mbx-note warn" role="status">{msg}</p>}
      {rows === null ? null : rows.length === 0 ? (
        <div className="mbx-empty" data-mbx-recent-empty="">{t('empty')} <Link href="/money">{t('browse')}</Link></div>
      ) : (
        <>
          <div className="mbx-row"><button type="button" className="mbx-btn" onClick={() => void clearAll()} data-mbx-recent-clear="">{t('clear')}</button>
            <Link className="mbx-btn" href="/compare" prefetch={false}>{t('toCompare')}</Link></div>
          <ul className="mbx-list" data-mbx-recent-list={rows.length}>
            {rows.map((r) => (
              <li key={`${r.type}:${r.key}`} className={r.open ? '' : 'closed'} data-mbx-recent-row={r.type}>
                <span className="mbx-badge">{r.type === 'PRODUCT' ? t('product') : t('listing')}</span>
                <div className="t">
                  {r.open ? <Link href={hrefOf(r)}><b>{r.title}</b></Link> : <b>{t('closed')}</b>}
                  <span className="m" suppressHydrationWarning>
                    {r.price != null ? f.won(r.price) : ''}{r.fee != null ? ` · ${t('fee', { v: f.won(r.fee) })}` : ''}{r.categoryName ? ` · ${r.categoryName}` : ''}
                    {r.soldOut ? ` · ${t('soldOut')}` : ''} · {t('viewed', { at: new Date(r.viewedAt).toLocaleString(f.ko ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Seoul', hour12: false }) })}
                  </span>
                </div>
                <button type="button" className="mbx-btn" onClick={() => void remove(r)} aria-label={t('remove')} data-mbx-recent-remove="">{t('remove')}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
