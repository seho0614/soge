'use client';
/**
 * v10.602 (docs/744) 매물 CSV 일괄 등록 — 파일 고르기(또는 붙여 넣기) → POST /api/v1/lsq/me/bulk/preview → 줄마다 결과 → POST …/{id}/confirm
 *   확정한 줄은 기존 매물 등록과 같은 길로 검수 큐에 들어감 · 글자는 서버 화면이 넘겨 줌(labels)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Row = { line: number; state: string; data: { title?: string }; problems: string[] };
type Res = { line: number; state: string; note?: string };

export function LsqBulkForm({ labels: L, template }: { labels: Record<string, string>; template: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [name, setName] = useState<string | undefined>(undefined);
  const [job, setJob] = useState<{ jobId: string; valid: number; items: Row[]; note: string } | null>(null);
  const [done, setDone] = useState<{ results: Res[]; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ST: Record<string, string> = { VALID: L.stVALID ?? '', INVALID: L.stINVALID ?? '', CREATED: L.stCREATED ?? '', FAILED: L.stFAILED ?? '' };

  async function post(path: string, body?: unknown) {
    const r = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, j };
  }
  async function preview() {
    setBusy(true); setErr(null); setJob(null); setDone(null);
    try {
      const r = await post('/lsq/me/bulk/preview', { csv, fileName: name });
      if (!r.ok) { setErr(r.j?.message ?? L.failed ?? ''); return; }
      setJob(r.j);
    } catch { setErr(L.failed ?? ''); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!job) return;
    setBusy(true); setErr(null);
    try {
      const r = await post(`/lsq/me/bulk/${encodeURIComponent(job.jobId)}/confirm`);
      if (!r.ok) { setErr(r.status === 403 ? (L.verifyFirst ?? '') : (r.j?.message ?? L.failed ?? '')); return; }
      setDone(r.j); router.refresh();
    } catch { setErr(L.failed ?? ''); } finally { setBusy(false); }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + template], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'sogaebank-listings.csv'; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div data-lsq-bulk-form="">
      <p className="lpx-row">
        <button type="button" className="lpx-btn" onClick={download} data-lsq-bulk-template="">{L.template}</button>
        <label className="lpx-btn">{L.pick}
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); setCsv(await f.text()); } }} data-lsq-bulk-file="" />
        </label>
      </p>
      <textarea aria-label={L.paste} placeholder={L.paste} value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} style={{ width: '100%' }} data-lsq-bulk-csv="" />
      <p className="lpx-row"><button type="button" className="lpx-btn pri" disabled={busy || !csv.trim()} onClick={() => void preview()} data-lsq-bulk-preview="">{busy ? L.busy : L.preview}</button></p>
      {job && (
        <>
          <table className="lpx-tbl" data-lsq-bulk-rows={job.items.length}>
            <thead><tr><th>{L.line}</th><th>{L.titleCol}</th><th>{L.state}</th><th>{L.problems}</th></tr></thead>
            <tbody>{job.items.map((r) => (
              <tr key={r.line}><td>{r.line}</td><td>{r.data.title ?? ''}</td><td>{ST[r.state] ?? r.state}</td><td>{r.problems.join(' · ')}</td></tr>
            ))}</tbody>
          </table>
          <p className="lpx-note">{job.note}</p>
          {job.valid > 0 && !done && <p className="lpx-row"><button type="button" className="lpx-btn pri" disabled={busy} onClick={() => void confirm()} data-lsq-bulk-confirm="">{busy ? L.busy : L.confirm}</button></p>}
        </>
      )}
      {done && (
        <>
          <p role="status" className="lpx-note" data-lsq-bulk-done="">{done.note}</p>
          <ul className="lpx-list">{done.results.filter((x) => x.state === 'FAILED').map((x) => <li key={x.line}>{L.line} {x.line} · {ST.FAILED} · {x.note}</li>)}</ul>
        </>
      )}
      {err && <p role="alert" className="lpx-note warn">{err}</p>}
    </div>
  );
}
