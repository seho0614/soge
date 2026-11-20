'use client';
/**
 * v10.542 (D284 · docs/680) SB-MYP-VSX-010 나의공간 › 방문 예약 — 브라우저 부품
 *   GET /vsx/me · 매물 고르면 GET /vsx/owner/listings/{id}/slots · 칸 열기 POST /vsx/owner/listings/{id}/slots · 닫기 POST /vsx/owner/slots/{id}/close
 *   예약 줄: 취소 POST /vsx/bookings/{id}/cancel · 확정 /confirm · 노쇼 · 방문 끝 /mark — 노쇼 횟수는 보이지 않음(운영 화면에서만 · 대표 11/21)
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import '@/styles/vsx.css';

interface VRow { id: string; state: string; memo: string | null; startsAt: string; endsAt: string; listingId: string; title: string; canCancel: boolean }
interface ORow extends VRow { visitor: string; canConfirm: boolean; canMark: boolean }
interface OL { id: string; title: string; openSlots: number }
interface Res { enabled: boolean; slotDays: number; maxOpen: number; minutes: number[]; asVisitor: VRow[]; asOwner: ORow[]; ownerListings: OL[] }
interface SRow { id: string; startsAt: string; endsAt: string; state: string; future: boolean; bookingState: string | null; visitor: string | null }

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export function VisitsView() {
  const t = useTranslations('vsx.my');
  const ts = useTranslations('vsx.st');
  const [d, setD] = useState<Res | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lid, setLid] = useState('');
  const [slots, setSlots] = useState<SRow[]>([]);
  const [date, setDate] = useState(today());
  const [times, setTimes] = useState('');
  const [mins, setMins] = useState(30);

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/vsx/me').catch(() => null);
    setD(r && r.ok ? await r.json() as Res : null);
  }, []);
  const loadSlots = useCallback(async (id: string) => {
    if (!id) { setSlots([]); return; }
    const r = await fetch(`/api/v1/vsx/owner/listings/${encodeURIComponent(id)}/slots`).catch(() => null);
    const x = r && r.ok ? await r.json() as { slots: SRow[] } : null;
    setSlots(x?.slots ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSlots(lid); }, [lid, loadSlots]);

  async function post(key: string, url: string, body: unknown, ok?: (x: Record<string, unknown>) => string) {
    setBusy(key); setMsg(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const x = await r.json().catch(() => ({})) as Record<string, unknown>;
      if (!r.ok) { setMsg(String(x.message ?? t('failed'))); return; }
      if (ok) setMsg(ok(x));
      await load(); await loadSlots(lid);
    } finally { setBusy(null); }
  }
  if (!d) return null;
  if (!d.enabled && d.asVisitor.length === 0 && d.asOwner.length === 0) return <div className="vsx-empty" data-vsx-my-off="">{t('off')}</div>;

  const cancel = (id: string) => {
    const reason = prompt(t('reason')) ?? undefined;
    if (reason === undefined) return;
    void post(`c${id}`, `/api/v1/vsx/bookings/${id}/cancel`, { reason: reason.trim() || undefined });
  };
  const open = () => {
    const list = times.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    void post('open', `/api/v1/vsx/owner/listings/${encodeURIComponent(lid)}/slots`, { date, times: list, minutes: mins },
      (x) => t('opened', { made: String(x.made ?? 0), skipped: String((x.skipped as unknown[] | undefined)?.length ?? 0) }));
  };

  return (
    <div data-vsx-my={d.enabled ? 'on' : 'off'}>
      {!d.enabled && <p className="vsx-note warn">{t('off')}</p>}
      {msg && <p className="vsx-note warn" role="status">{msg}</p>}

      <h2 className="vsx-h2">{t('visitorHead')}</h2>
      {d.asVisitor.length === 0 ? <div className="vsx-empty">{t('none')}</div> : (
        <ul className="vsx-list" data-vsx-my-visitor={d.asVisitor.length}>
          {d.asVisitor.map((r) => (
            <li key={r.id}>
              <div className="t"><b>{r.title}</b><span className="m">{kst(r.startsAt)} · {ts(r.state as 'REQUESTED')}{r.memo ? ` · ${r.memo}` : ''}</span></div>
              {r.canCancel && <button className="vsx-btn" disabled={busy === `c${r.id}`} onClick={() => cancel(r.id)}>{t('cancel')}</button>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="vsx-h2">{t('ownerHead')}</h2>
      {d.asOwner.length === 0 ? <div className="vsx-empty">{t('none')}</div> : (
        <ul className="vsx-list" data-vsx-my-owner={d.asOwner.length}>
          {d.asOwner.map((r) => (
            <li key={r.id}>
              <div className="t"><b>{r.title}</b>
                <span className="m">{kst(r.startsAt)} · {t('visitor', { name: r.visitor })} · {ts(r.state as 'REQUESTED')}{r.memo ? ` · ${r.memo}` : ''}</span>
              </div>
              {r.canConfirm && <button className="vsx-btn pri" disabled={busy === `f${r.id}`} onClick={() => void post(`f${r.id}`, `/api/v1/vsx/bookings/${r.id}/confirm`, {})}>{t('confirm')}</button>}
              {r.canCancel && <button className="vsx-btn" disabled={busy === `c${r.id}`} onClick={() => cancel(r.id)}>{t('cancel')}</button>}
              {r.canMark && <>
                <button className="vsx-btn" disabled={busy === `m${r.id}`} onClick={() => void post(`m${r.id}`, `/api/v1/vsx/bookings/${r.id}/mark`, { result: 'DONE' })}>{t('doneBtn')}</button>
                <button className="vsx-btn" disabled={busy === `m${r.id}`} onClick={() => void post(`m${r.id}`, `/api/v1/vsx/bookings/${r.id}/mark`, { result: 'NOSHOW' })}>{t('noshowBtn')}</button>
              </>}
            </li>
          ))}
        </ul>
      )}

      {d.enabled && d.ownerListings.length > 0 && (
        <div className="vsx-box" data-vsx-my-slots="">
          <h3>{t('slotsHead')}</h3>
          <p className="vsx-note">{t('limits', { days: String(d.slotDays), max: String(d.maxOpen) })}</p>
          <div className="vsx-row">
            <select aria-label={t('pickListing')} value={lid} onChange={(e) => setLid(e.target.value)}>
              <option value="">{t('pickListing')}</option>
              {d.ownerListings.map((l) => <option key={l.id} value={l.id}>{l.title} ({t('openSlots', { n: l.openSlots })})</option>)}
            </select>
          </div>
          {lid && (
            <>
              <div className="vsx-row">
                <label>{t('date')} <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} /></label>
                <label>{t('minutes')} <select value={mins} onChange={(e) => setMins(Number(e.target.value))}>{d.minutes.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
              </div>
              <div className="vsx-row">
                <input aria-label={t('times')} placeholder={t('times')} value={times} onChange={(e) => setTimes(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
                <button className="vsx-btn pri" disabled={busy === 'open' || !times.trim()} onClick={open} data-vsx-open="">{t('open')}</button>
              </div>
              <ul className="vsx-list" data-vsx-slot-list={slots.length}>
                {slots.map((s) => (
                  <li key={s.id}>
                    <div className="t"><b>{kst(s.startsAt)} ~ {kst(s.endsAt).slice(11)}</b>
                      <span className="m">{s.state === 'CLOSED' ? t('close') : ''}{s.bookingState ? ` ${ts(s.bookingState as 'REQUESTED')} · ${s.visitor ?? ''}` : ''}</span></div>
                    {s.state === 'OPEN' && s.future && <button className="vsx-btn" disabled={busy === `x${s.id}`}
                      onClick={() => confirm(t('confirmClose')) && void post(`x${s.id}`, `/api/v1/vsx/owner/slots/${s.id}/close`, {})}>{t('close')}</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
