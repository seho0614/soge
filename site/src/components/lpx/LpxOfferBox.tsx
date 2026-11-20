'use client';
/**
 * v10.549 (D286 · docs/687) 매물 상세 「가격 제안」 칸 — 클라이언트 부품
 *   GET /lpx/listings/{id}/offer · POST /lpx/listings/{id}/offers · POST /lpx/offers/{id}/accept · /reject · /reoffer · /withdraw
 *   되제안을 받으면 수락 · 거절 · 다시 제안(되제안 · 다시 제안 합쳐 counterMax 번 · 대표 11/21 처음 3)
 *   로그인 회원만 부름 · 꺼져 있으면 아무것도 그리지 않음 · 내 매물이면 「나의공간 › 가격 제안」 안내(기다리는 수)
 *   수락돼도 거래를 만들지 않음 — 「1:1 문의」로 기존 거래 흐름 안내
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

interface Mine { id: string; state: string; amount: string; counterAmount: string | null; counterMemo: string | null; expiresAt: string; counterCount: number }
interface Box { enabled: boolean; own: boolean; asking: string | null; minAmount: string | null; days: number; counterMax: number; mine: Mine | null; received: number }

const won = (v: string | number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const ymd = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function LpxOfferBox({ listingId, loggedIn }: { listingId: string; loggedIn: boolean }) {
  const t = useTranslations('lpx.offer');
  const ts = useTranslations('lpx.st');
  const [d, setD] = useState<Box | null>(null);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/lpx/listings/${encodeURIComponent(listingId)}/offer`).catch(() => null);
    setD(r && r.ok ? await r.json() as Box : null);
  }, [listingId]);
  useEffect(() => { if (loggedIn) void load(); }, [loggedIn, load]);

  if (!loggedIn) return <div className="lpx-box" data-lpx-offer="guest"><h3>{t('title')}</h3><p className="lpx-note">{t('loginFirst')} <Link href="/login">{t('login')}</Link></p></div>;
  if (!d || !d.enabled) return null;
  if (d.own) return <div className="lpx-box" data-lpx-offer="own"><h3>{t('title')}</h3><p className="lpx-note">{t('own', { n: d.received })} <Link href="/my/offers">{t('manage')}</Link></p></div>;

  async function post(path: string, body: unknown, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const x = await r.json().catch(() => null) as { message?: string; note?: string } | null;
      if (!r.ok) { setMsg(x?.message ?? t('failed')); return; }
      setMsg(x?.note ?? okText); setAmount(''); setMemo('');
      await load();
    } finally { setBusy(false); }
  }
  const digits = amount.replace(/[^0-9]/g, '');
  const m = d.mine;

  return (
    <div className="lpx-box" data-lpx-offer={m ? m.state : 'new'}>
      <h3>{t('title')}</h3>
      <p className="lpx-note">{t('sub', { asking: won(d.asking), days: d.days })}</p>
      {msg && <p className="lpx-note warn" role="status">{msg}</p>}
      {m ? (
        <div className="lpx-row" data-lpx-offer-mine={m.state}>
          <span>{t('mine', { amount: won(m.amount), state: ts(m.state as 'OPEN'), until: ymd(m.expiresAt) })}</span>
          {m.state === 'COUNTERED' && (
            <>
              <span className="lpx-badge ok">{t('counter', { amount: won(m.counterAmount) })}{m.counterMemo ? ` · ${m.counterMemo}` : ''}</span>
              <button className="lpx-btn pri" disabled={busy} onClick={() => void post(`/api/v1/lpx/offers/${m.id}/accept`, {}, t('accepted'))} data-lpx-accept="">{t('accept')}</button>
              <button className="lpx-btn" disabled={busy} onClick={() => void post(`/api/v1/lpx/offers/${m.id}/reject`, {}, t('rejected'))}>{t('reject')}</button>
              {m.counterCount < d.counterMax && (
                <>
                  <input inputMode="numeric" aria-label={t('reofferAmount')} placeholder={t('reofferAmount')} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 160 }} />
                  <button className="lpx-btn" disabled={busy || digits.length < 3} data-lpx-reoffer=""
                    onClick={() => void post(`/api/v1/lpx/offers/${m.id}/reoffer`, { amount: digits }, t('reoffered'))}>{t('reoffer')}</button>
                </>
              )}
              <span className="lpx-note">{t('rounds', { n: m.counterCount, max: d.counterMax })}</span>
            </>
          )}
          <button className="lpx-btn" disabled={busy} onClick={() => { if (confirm(t('confirmWithdraw'))) void post(`/api/v1/lpx/offers/${m.id}/withdraw`, {}, t('withdrawn')); }}>{t('withdraw')}</button>
          <Link className="lpx-btn" href="/my/offers">{t('manage')}</Link>
        </div>
      ) : (
        <div className="lpx-row">
          <input inputMode="numeric" aria-label={t('amount')} placeholder={d.minAmount ? t('amountMin', { min: won(d.minAmount) }) : t('amount')} value={amount}
            onChange={(e) => setAmount(e.target.value)} style={{ width: 200 }} data-lpx-amount="" />
          <input aria-label={t('memo')} placeholder={t('memo')} maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="lpx-btn pri" disabled={busy || digits.length < 3} data-lpx-offer-send=""
            onClick={() => void post(`/api/v1/lpx/listings/${encodeURIComponent(listingId)}/offers`, { amount: digits, memo: memo.trim() || undefined }, t('sent'))}>{t('send')}</button>
        </div>
      )}
      <p className="lpx-note">{t('notContract')}</p>
    </div>
  );
}
