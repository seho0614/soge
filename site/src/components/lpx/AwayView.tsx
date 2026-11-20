'use client';
/**
 * v10.551 (D286 · docs/689) SB-MYP-LPX-020 나의공간 › 자리 비움 — 클라이언트 부품
 *   GET · PUT /lpx/me/away · POST /lpx/me/away/end
 *   시작 · 끝 날짜 · 한 줄 안내(연락처는 서버가 가림) · 끝 날짜가 지나면 저절로 풀림 · 보낸 자동 안내 수
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Cur { id: string; startsOn: string; endsOn: string; message: string | null; showing: boolean; notices: number }
interface Res { enabled: boolean; maxDays: number; today: string; current: Cur | null; recent: Array<{ id: string; startsOn: string; endsOn: string; state: string; notices: number }>; note: string }

export function AwayView() {
  const t = useTranslations('lpx.awayMy');
  const [d, setD] = useState<Res | null>(null);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [m, setM] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch('/api/v1/lpx/me/away').catch(() => null);
    const x = r && r.ok ? await r.json() as Res : null;
    setD(x);
    if (x) { setA(x.current?.startsOn ?? x.today); setB(x.current?.endsOn ?? x.today); setM(x.current?.message ?? ''); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <p className="lpx-empty">{t('loading')}</p>;

  async function send(method: 'PUT' | 'POST', path: string, body: unknown) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const x = await r.json().catch(() => null) as { message?: string; note?: string } | null;
      setMsg(r.ok ? (x?.note ?? t('done')) : (x?.message ?? t('failed')));
      if (r.ok) await load();
    } finally { setBusy(false); }
  }

  return (
    <div data-lpx-my-away={d.current ? (d.current.showing ? 'showing' : 'waiting') : 'none'}>
      {!d.enabled && <p className="lpx-note warn">{t('off')}</p>}
      {msg && <p className="lpx-note warn" role="status">{msg}</p>}
      {d.current && (
        <div className="lpx-box">
          <h3>{d.current.showing ? t('nowShowing') : t('nowWaiting')}</h3>
          <p>{d.current.startsOn} ~ {d.current.endsOn}{d.current.message ? ` · ${d.current.message}` : ''}</p>
          <p className="lpx-note">{t('notices', { n: d.current.notices })}</p>
          <button className="lpx-btn" disabled={busy} onClick={() => void send('POST', '/api/v1/lpx/me/away/end', {})} data-lpx-away-end="">{t('end')}</button>
        </div>
      )}
      {d.enabled && (
        <div className="lpx-box">
          <h3>{d.current ? t('change') : t('set')}</h3>
          <div className="lpx-row">
            <label>{t('from')} <input type="date" value={a} min={d.today} onChange={(e) => setA(e.target.value)} /></label>
            <label>{t('to')} <input type="date" value={b} min={a || d.today} onChange={(e) => setB(e.target.value)} /></label>
          </div>
          <div className="lpx-row">
            <input aria-label={t('message')} placeholder={t('message')} maxLength={200} value={m} onChange={(e) => setM(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
            <button className="lpx-btn pri" disabled={busy || !a || !b} data-lpx-away-save=""
              onClick={() => void send('PUT', '/api/v1/lpx/me/away', { startsOn: a, endsOn: b, message: m.trim() || undefined })}>{t('save')}</button>
          </div>
          <p className="lpx-note">{t('max', { n: d.maxDays })}</p>
        </div>
      )}
      {d.recent.length > 0 && (
        <>
          <h2 className="lpx-h2">{t('recent')}</h2>
          <ul className="lpx-list">{d.recent.map((r) => <li key={r.id}><span className="t">{r.startsOn} ~ {r.endsOn}</span><span className="m">{t('notices', { n: r.notices })}</span></li>)}</ul>
        </>
      )}
      <p className="lpx-note">{d.note}</p>
    </div>
  );
}
