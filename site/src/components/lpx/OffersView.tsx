'use client';
/**
 * v10.549 (D286 · docs/687) SB-MYP-LPX-010 나의공간 › 가격 제안 — 클라이언트 부품
 *   GET /lpx/me/offers · POST /lpx/offers/{id}/accept · /reject · /counter · /reoffer · /withdraw
 *   보낸 제안(되제안 수락 · 거절 · 다시 제안 · 거두기) · 받은 제안(수락 · 거절 · 되제안 · 가린 이름) — 되제안 · 다시 제안 합쳐 counterMax 번(대표 11/21 처음 3)
 *   합의하면 매물 상세의 「1:1 문의」로 기존 거래 흐름(거래를 만들지 않음)
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GWAN_PATH } from '@/lib/format';

interface Row { id: string; state: string; amount: string; counterAmount: string | null; counterMemo?: string | null; finalAmount: string | null; askingAmount: string | null;
  memo: string | null; expiresAt: string; createdAt: string; listingId: string; title: string; gwanCode: string; canAnswer: boolean; canCounter?: boolean; canReoffer?: boolean; canWithdraw?: boolean; counterCount: number; from?: string }
interface Res { enabled: boolean; days: number; counterMax: number; sent: Row[]; received: Row[]; note: string }

const won = (v: string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const ymd = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const href = (r: Row) => `/${GWAN_PATH[r.gwanCode] ?? 'money'}/${r.listingId}`;

export function OffersView() {
  const t = useTranslations('lpx.my');
  const to = useTranslations('lpx.offer');
  const ts = useTranslations('lpx.st');
  const [d, setD] = useState<Res | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await fetch('/api/v1/lpx/me/offers').catch(() => null);
    setD(r && r.ok ? await r.json() as Res : null);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <p className="lpx-empty">{t('loading')}</p>;

  async function act(id: string, what: 'accept' | 'reject' | 'withdraw' | 'counter' | 'reoffer', body: unknown = {}) {
    if (what === 'withdraw' && !confirm(to('confirmWithdraw'))) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/lpx/offers/${encodeURIComponent(id)}/${what}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const x = await r.json().catch(() => null) as { message?: string; note?: string } | null;
      setMsg(r.ok ? (x?.note ?? t('done')) : (x?.message ?? to('failed')));
      if (r.ok) await load();
    } finally { setBusy(false); }
  }

  return (
    <div data-lpx-my-offers={d.sent.length + d.received.length}>
      {!d.enabled && <p className="lpx-note warn">{t('off')}</p>}
      {msg && <p className="lpx-note warn" role="status">{msg}</p>}
      <h2 className="lpx-h2">{t('received')}</h2>
      {d.received.length === 0 ? <p className="lpx-empty">{t('emptyReceived')}</p> : (
        <ul className="lpx-list" data-lpx-received={d.received.length}>
          {d.received.map((r) => (
            <li key={r.id}>
              <div className="t"><b><Link href={href(r)}>{r.title}</Link></b>
                <span className="m">{t('lineReceived', { from: r.from ?? '', amount: won(r.amount), asking: won(r.askingAmount), until: ymd(r.expiresAt) })}{r.memo ? ` · ${r.memo}` : ''}</span></div>
              <span className={`lpx-badge${r.state === 'ACCEPTED' ? ' ok' : r.state === 'OPEN' ? ' warn' : ''}`}>{ts(r.state as 'OPEN')}{r.counterAmount ? ` · ${won(r.counterAmount)}` : ''}</span>
              {r.canAnswer && (
                <>
                  <button className="lpx-btn pri" disabled={busy} onClick={() => void act(r.id, 'accept')} data-lpx-accept={r.id}>{to('accept')}</button>
                  <button className="lpx-btn" disabled={busy} onClick={() => void act(r.id, 'reject')}>{to('reject')}</button>
                  {r.canCounter && (
                    <>
                      <input inputMode="numeric" aria-label={t('counterAmount')} placeholder={t('counterAmount')} value={counter[r.id] ?? ''} style={{ width: 150 }}
                        onChange={(e) => setCounter({ ...counter, [r.id]: e.target.value })} />
                      <button className="lpx-btn" disabled={busy || (counter[r.id] ?? '').replace(/[^0-9]/g, '').length < 3} data-lpx-counter={r.id}
                        onClick={() => void act(r.id, 'counter', { amount: (counter[r.id] ?? '').replace(/[^0-9]/g, '') })}>{t('counter')}</button>
                    </>
                  )}
                  <span className="m">{to('rounds', { n: r.counterCount, max: d.counterMax })}</span>
                </>
              )}
              {r.state === 'ACCEPTED' && <Link className="lpx-btn" href={href(r)}>{t('goInquire')}</Link>}
            </li>
          ))}
        </ul>
      )}
      <h2 className="lpx-h2">{t('sent')}</h2>
      {d.sent.length === 0 ? <p className="lpx-empty">{t('emptySent')}</p> : (
        <ul className="lpx-list" data-lpx-sent={d.sent.length}>
          {d.sent.map((r) => (
            <li key={r.id}>
              <div className="t"><b><Link href={href(r)}>{r.title}</Link></b>
                <span className="m">{t('lineSent', { amount: won(r.amount), asking: won(r.askingAmount), until: ymd(r.expiresAt) })}</span></div>
              <span className={`lpx-badge${r.state === 'ACCEPTED' ? ' ok' : r.state === 'COUNTERED' ? ' warn' : ''}`}>{ts(r.state as 'OPEN')}{r.counterAmount ? ` · ${won(r.counterAmount)}` : ''}{r.finalAmount ? ` · ${won(r.finalAmount)}` : ''}</span>
              {r.counterMemo && <span className="m">{r.counterMemo}</span>}
              {r.canAnswer && (
                <>
                  <button className="lpx-btn pri" disabled={busy} onClick={() => void act(r.id, 'accept')}>{to('accept')}</button>
                  <button className="lpx-btn" disabled={busy} onClick={() => void act(r.id, 'reject')}>{to('reject')}</button>
                  {r.canReoffer && (
                    <>
                      <input inputMode="numeric" aria-label={to('reofferAmount')} placeholder={to('reofferAmount')} value={counter[r.id] ?? ''} style={{ width: 150 }}
                        onChange={(e) => setCounter({ ...counter, [r.id]: e.target.value })} />
                      <button className="lpx-btn" disabled={busy || (counter[r.id] ?? '').replace(/[^0-9]/g, '').length < 3} data-lpx-reoffer={r.id}
                        onClick={() => void act(r.id, 'reoffer', { amount: (counter[r.id] ?? '').replace(/[^0-9]/g, '') })}>{to('reoffer')}</button>
                    </>
                  )}
                  <span className="m">{to('rounds', { n: r.counterCount, max: d.counterMax })}</span>
                </>
              )}
              {r.canWithdraw && <button className="lpx-btn" disabled={busy} onClick={() => void act(r.id, 'withdraw')}>{to('withdraw')}</button>}
              {r.state === 'ACCEPTED' && <Link className="lpx-btn" href={href(r)}>{t('goInquire')}</Link>}
            </li>
          ))}
        </ul>
      )}
      <p className="lpx-note">{d.note}</p>
    </div>
  );
}
