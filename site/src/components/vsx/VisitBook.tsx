'use client';
/**
 * v10.542 (D284 · docs/680) 매물 상세(SB-{G}-DTL-010) 아래 「방문 예약」 칸
 *   GET /vsx/listings/{id}/slots · POST /vsx/listings/{id}/book · POST /vsx/bookings/{id}/cancel
 *   로그인 회원만 부름 · 스위치(vsx.enabled · 처음 off)가 꺼져 있거나 열린 칸이 없고 내 예약도 없으면 아무것도 그리지 않음(지금 화면 그대로)
 *   내 매물이면 「나의공간 › 방문 예약」 안내만
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import '@/styles/vsx.css';

interface Slot { id: string; startsAt: string; endsAt: string; taken: boolean }
interface Mine { id: string; state: string; startsAt: string; endsAt: string; memo: string | null }
interface Res { enabled: boolean; own: boolean; slots: Slot[]; mine: Mine | null }

const kstDay = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const kstHm = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(11, 16);

export function VisitBook({ listingId, loggedIn }: { listingId: string; loggedIn: boolean }) {
  const t = useTranslations('vsx.book');
  const ts = useTranslations('vsx.st');
  const [d, setD] = useState<Res | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [memo, setMemo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/vsx/listings/${encodeURIComponent(listingId)}/slots`).catch(() => null);
    setD(r && r.ok ? await r.json() as Res : null);
  }, [listingId]);
  useEffect(() => { if (loggedIn) void load(); }, [loggedIn, load]);

  if (!loggedIn || !d || !d.enabled) return null;
  if (d.own) return <div className="vsx-box" data-vsx-book="own"><h3>{t('title')}</h3><p className="vsx-note">{t('own')} <Link href="/my/visits">{t('manage')}</Link></p></div>;
  if (!d.mine && d.slots.length === 0) return null;

  async function send() {
    if (!pick) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/vsx/listings/${encodeURIComponent(listingId)}/book`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotId: pick, memo: memo.trim() || undefined }) });
      const x = await r.json().catch(() => null) as { message?: string } | null;
      if (!r.ok) { setMsg(x?.message ?? t('failed')); return; }
      setMsg(t('sent')); setPick(null); setMemo('');
      await load();
    } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    if (!confirm(t('confirmCancel'))) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/vsx/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const x = await r.json().catch(() => null) as { message?: string } | null;
      if (!r.ok) { setMsg(x?.message ?? t('failed')); return; }
      await load();
    } finally { setBusy(false); }
  }
  const days = [...new Set(d.slots.map((s) => kstDay(s.startsAt)))];

  return (
    <div className="vsx-box" data-vsx-book={d.slots.length}>
      <h3>{t('title')}</h3>
      <p className="vsx-note">{t('sub')}</p>
      {msg && <p className="vsx-note warn" role="status">{msg}</p>}
      {d.mine ? (
        <div className="vsx-row" data-vsx-book-mine={d.mine.state}>
          <span>{t('mine', { when: `${kstDay(d.mine.startsAt)} ${kstHm(d.mine.startsAt)}`, state: ts(d.mine.state as 'REQUESTED') })}</span>
          <button className="vsx-btn" disabled={busy} onClick={() => void cancel(d.mine!.id)}>{t('cancel')}</button>
          <Link className="vsx-btn" href="/my/visits">{t('manage')}</Link>
        </div>
      ) : (
        <>
          <div className="vsx-days">
            {days.map((day) => (
              <div className="vsx-day" key={day}><b>{day}</b>
                <div className="vsx-slots">
                  {d.slots.filter((s) => kstDay(s.startsAt) === day).map((s) => (
                    <button key={s.id} type="button" className={`vsx-slot${pick === s.id ? ' on' : ''}`} disabled={s.taken || busy} aria-pressed={pick === s.id}
                      onClick={() => setPick(s.id)} title={s.taken ? t('taken') : undefined}>{kstHm(s.startsAt)} ~ {kstHm(s.endsAt)}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="vsx-row">
            <input aria-label={t('memo')} placeholder={t('memo')} maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button className="vsx-btn pri" disabled={!pick || busy} onClick={() => void send()} data-vsx-book-send="">{t('send')}</button>
          </div>
        </>
      )}
    </div>
  );
}
