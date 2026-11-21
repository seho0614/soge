'use client';
/**
 * v10.608 (docs/750) 반품 · 교환 사진 · 판정 기록 — 회원(취소 · 반품 내역) · 입점 판매자(판매자센터 › 반품 사진 · 판정) 같은 부품
 *   펼칠 때 GET /api/v1/lsq/returns/{id}/evidence · 사진 붙이기 = 기존 파일 올리기(RETURN_PHOTO) → POST …/photos
 *   판매자는 검수 판정(상품 상태 · 책임 · 메모 · 회원에게 보임) POST …/verdicts · 글자는 서버 화면이 넘겨 줌(labels)
 */
import { useState } from 'react';
import { uploadFile, UploadError, type UploadPurpose } from '@/lib/upload';

export type RetLabels = Record<string, string>;
interface Ev {
  returnId: string; state: string; view: string; photosOn: boolean; photoMax: number; canAddPhoto: boolean; canInspect: boolean;
  photos: Array<{ id: string; side: string; note: string | null; url: string }>;
  verdicts: Array<{ id: string; kind: string; side: string; fromState: string | null; toState: string | null; condition: string | null; fault: string | null; note: string | null; createdAt: string }>;
}
const CONDS = ['UNOPENED', 'OPENED', 'USED', 'DAMAGED', 'MISSING', 'WRONG_ITEM'] as const;
const FAULTS = ['BUYER', 'SELLER', 'CARRIER', 'UNKNOWN'] as const;
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function LsqReturnEvidence({ returnId, labels: L }: { returnId: string; labels: RetLabels }) {
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<Ev | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cond, setCond] = useState<string>('OPENED');
  const [fault, setFault] = useState<string>('UNKNOWN');
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const base = `/api/v1/lsq/returns/${encodeURIComponent(returnId)}`;

  async function load() {
    const r = await fetch(`${base}/evidence`, { cache: 'no-store' });
    const j = (await r.json().catch(() => null)) as (Ev & { message?: string }) | null;
    if (!r.ok || !j) { setErr(j?.message ?? L.failed ?? ''); return; }
    setEv(j);
  }
  async function toggle() { const o = !open; setOpen(o); if (o && !ev) await load(); }
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy('up'); setErr(null); setMsg(null);
    try {
      const up = await uploadFile(f, 'RETURN_PHOTO' as string as UploadPurpose);
      const r = await fetch(`${base}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: up.fileId }) });
      const j = (await r.json().catch(() => null)) as { message?: string } | null;
      if (!r.ok) { setErr(j?.message ?? L.failed ?? ''); return; }
      setMsg(L.added ?? ''); await load();
    } catch (e) { setErr(e instanceof UploadError ? e.message : (L.failed ?? '')); } finally { setBusy(''); }
  }
  async function inspect() {
    setBusy('v'); setErr(null); setMsg(null);
    try {
      const r = await fetch(`${base}/verdicts`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'INSPECT', condition: cond, fault, note: note.trim() || undefined, visibleToBuyer: visible }) });
      const j = (await r.json().catch(() => null)) as { message?: string } | null;
      if (!r.ok) { setErr(j?.message ?? L.failed ?? ''); return; }
      setMsg(L.saved ?? ''); setNote(''); await load();
    } catch { setErr(L.failed ?? ''); } finally { setBusy(''); }
  }
  const lab = (k: string) => L[k] ?? k;
  return (
    <div className="lpx-box" data-lsq-ret={returnId}>
      <button type="button" className="lpx-btn" onClick={() => void toggle()} data-lsq-ret-toggle="">{open ? lab('hide') : lab('show')}</button>
      {open && ev && (
        <>
          <p className="lpx-note">{lab('photos').replace('{n}', String(ev.photos.length))}</p>
          {ev.photos.length > 0 && (
            <p className="lpx-row" data-lsq-ret-photos={ev.photos.length}>
              {ev.photos.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={`${lab(`side${p.side}`)}${p.note ? ` · ${p.note}` : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={lab(`side${p.side}`)} width={88} height={88} style={{ objectFit: 'cover', borderRadius: 7 }} />
                </a>
              ))}
            </p>
          )}
          {ev.canAddPhoto && (
            <p><label className="lpx-btn">{busy === 'up' ? lab('uploading') : lab('add')}
              <input type="file" accept="image/jpeg,image/png" hidden disabled={!!busy} onChange={(e) => void pick(e.target.files?.[0])} data-lsq-ret-file="" />
            </label> <span className="lpx-note">{lab('max').replace('{n}', String(ev.photoMax))}</span></p>
          )}
          {!ev.photosOn && <p className="lpx-note">{lab('off')}</p>}
          <ul className="lpx-list" data-lsq-ret-log={ev.verdicts.length}>
            {ev.verdicts.length === 0 ? <li className="lpx-note">{lab('noLog')}</li> : ev.verdicts.map((v) => (
              <li key={v.id}><span className="t"><b>{lab(`k${v.kind}`)} · {lab(`side${v.side}`)}</b>
                <span className="m">{[v.toState ? `${v.fromState ? `${lab(`s${v.fromState}`)} → ` : ''}${lab(`s${v.toState}`)}` : null,
                  v.condition ? `${lab('condition')} ${lab(`c${v.condition}`)}` : null, v.fault ? `${lab('fault')} ${lab(`f${v.fault}`)}` : null, v.note].filter(Boolean).join(' · ')}</span></span>
                <span className="m">{when(v.createdAt)}</span></li>
            ))}
          </ul>
          {ev.canInspect && ev.view === 'SELLER' && (
            <div className="lpx-row" data-lsq-ret-inspect="">
              <b>{lab('inspect')}</b>
              <select aria-label={lab('condition')} value={cond} onChange={(e) => setCond(e.target.value)}>{CONDS.map((c) => <option key={c} value={c}>{lab(`c${c}`)}</option>)}</select>
              <select aria-label={lab('fault')} value={fault} onChange={(e) => setFault(e.target.value)}>{FAULTS.map((c) => <option key={c} value={c}>{lab(`f${c}`)}</option>)}</select>
              <input aria-label={lab('note')} placeholder={lab('note')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              <label><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> {lab('visible')}</label>
              <button type="button" className="lpx-btn pri" disabled={!!busy} onClick={() => void inspect()}>{lab('save')}</button>
            </div>
          )}
        </>
      )}
      {msg && <p role="status" className="lpx-note">{msg}</p>}
      {err && <p role="alert" className="lpx-note warn">{err}</p>}
    </div>
  );
}
