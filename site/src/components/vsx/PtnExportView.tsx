'use client';
/**
 * v10.544 (D284 · docs/682) SB-PTC-VSX-010 파트너센터 › 자료 내려받기 — 브라우저 부품
 *   GET /partner/export(상태) · POST /partner/export/request(사유) · GET /partner/export/leads?ticket=&from=&to= · GET /partner/export/perf
 *   받은 CSV 글을 이 브라우저에서 파일로 저장(서버에 파일을 남기지 않음 · 엑셀이 한글을 읽도록 BOM 은 서버가 붙임)
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import '@/styles/vsx.css';

interface Log { kind: string; rows: number; from: string | null; to: string | null; at: string; mine: boolean }
interface Res { enabled: boolean; canExport: boolean; company: string; maxRows: number; ticket: string | null; pending: string | null; until: string | null; logs: Log[]; note: string }

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const ymd = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

function save(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function PtnExportView() {
  const t = useTranslations('vsx.exp');
  const [d, setD] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState(ymd(Date.now() - 89 * 86400e3));
  const [to, setTo] = useState(ymd(Date.now()));
  const load = useCallback(async () => {
    const r = await fetch('/api/v1/partner/export').catch(() => null);
    if (!r || !r.ok) { const x = r ? await r.json().catch(() => null) as { message?: string } | null : null; setErr(x?.message ?? t('failed')); setD(null); return; }
    setErr(null); setD(await r.json() as Res);
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function call(url: string, init?: RequestInit) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, init);
      const x = await r.json().catch(() => ({})) as { message?: string; filename?: string; csv?: string; note?: string };
      if (!r.ok) { setMsg(x.message ?? t('failed')); return; }
      if (x.csv && x.filename) { save(x.filename, x.csv); setMsg(`${t('done')} ${x.note ?? ''}`.trim()); } else setMsg(x.note ?? t('done'));
      await load();
    } finally { setBusy(false); }
  }

  if (err) return <p className="vsx-note warn" data-vsx-exp-err="">{err}</p>;
  if (!d) return null;
  if (!d.enabled) return <div className="vsx-empty" data-vsx-exp-off="">{t('off')}</div>;
  if (!d.canExport) return <div className="vsx-empty" data-vsx-exp-role="">{t('role')}</div>;

  return (
    <div data-vsx-exp={d.ticket ? 'ready' : d.pending ? 'pending' : 'none'}>
      {msg && <p className="vsx-note warn" role="status">{msg}</p>}
      <div className="vsx-box">
        <h3>{t('leadsHead')}</h3>
        <p className="vsx-note">{t('leadsHelp')}</p>
        {d.ticket ? (
          <>
            <p className="vsx-note">{t('ready', { until: d.until ? kst(d.until) : '—' })}</p>
            <div className="vsx-row">
              <label>{t('from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>{t('to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <button className="vsx-btn pri" disabled={busy} data-vsx-exp-leads=""
                onClick={() => void call(`/api/v1/partner/export/leads?ticket=${encodeURIComponent(d.ticket!)}&from=${from}&to=${to}`)}>{t('download')}</button>
            </div>
          </>
        ) : d.pending ? <p className="vsx-note">{t('pending', { id: d.pending })}</p> : (
          <div className="vsx-row">
            <input aria-label={t('reason')} placeholder={t('reason')} maxLength={150} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
            <button className="vsx-btn" disabled={busy || reason.trim().length < 2} data-vsx-exp-request=""
              onClick={() => void call('/api/v1/partner/export/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) })}>{t('request')}</button>
          </div>
        )}
      </div>
      <div className="vsx-box">
        <h3>{t('perfHead')}</h3>
        <button className="vsx-btn" disabled={busy} data-vsx-exp-perf="" onClick={() => void call('/api/v1/partner/export/perf')}>{t('perfDownload')}</button>
      </div>
      <h2 className="vsx-h2">{t('logsHead')}</h2>
      {d.logs.length === 0 ? <div className="vsx-empty">{t('none')}</div> : (
        <ul className="vsx-list" data-vsx-exp-logs={d.logs.length}>
          {d.logs.map((l, i) => (
            <li key={i}><div className="t"><b>{l.kind === 'LEADS' ? t('kindLeads') : t('kindPerf')} · {t('rows', { n: l.rows })}</b>
              <span className="m">{kst(l.at)}{l.from ? ` · ${l.from} ~ ${l.to ?? ''}` : ''}</span></div></li>
          ))}
        </ul>
      )}
    </div>
  );
}
