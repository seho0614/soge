import { Fragment, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { withUpload, guessType, TYPE_LABEL } from '../../../lib/files';
import { type FileRef, FileCell } from './shared';

interface Material extends FileRef { id: string; title: string; kind: string; body: string | null; createdAt: string; createdBy: string }

/* ── SB-AFF-MTR-010 ──────────────────────────────────────────────── */
const KIND: Record<string, string> = { IMAGE: '이미지', BANNER: '배너', COPY: '문구', VIDEO: '영상', DOC: '문서' };

/** 형식별로 받는 파일 (DB fn_file_ref_material 과 같음 — 여기는 안내용) */
const KIND_TYPES: Record<string, string[]> = {
  IMAGE: ['image/jpeg', 'image/png'], BANNER: ['image/jpeg', 'image/png'], VIDEO: ['video/mp4'],
  DOC: ['application/pdf', 'image/jpeg', 'image/png'], COPY: [],
};

const KIND_ACCEPT: Record<string, string> = {
  IMAGE: '.jpg,.jpeg,.png', BANNER: '.jpg,.jpeg,.png', VIDEO: '.mp4', DOC: '.pdf,.jpg,.jpeg,.png', COPY: '',
};

export function Materials() {
  const r = useApi<{ items: Material[]; note: string | null }>('/admin/affiliates/materials/queue');
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ title: '', kind: 'BANNER', body: '' });
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const a = useAct();
  const review = (m: Material, ok: boolean) => {
    const reason = ok ? undefined : prompt('반려 사유 — 인앱과 이메일로 갑니다') ?? '';
    if (!ok && (!reason || reason.trim().length < 2)) { a.setErr('반려 사유를 적으십시오. 안 적으면 같은 자료가 다시 올라옵니다.'); return; }
    void a.run(m.id, () => api(`/admin/affiliates/materials/${m.id}/review`, {
      method: 'POST', body: JSON.stringify({ state: ok ? 'APPROVED' : 'REJECTED', reason: reason?.trim() }),
    }), r.reload);
  };
  const create = () => {
    if (f.title.trim().length < 2) { a.setErr('제목을 두 자 이상 적으십시오.'); return; }
    if (f.kind === 'COPY' && f.body.trim().length < 5) { a.setErr('문구 자료는 본문을 다섯 자 이상 적으십시오.'); return; }
    if (f.kind !== 'COPY' && !file) { a.setErr(`${KIND[f.kind]} 자료는 파일을 고르십시오.`); return; }
    if (file && !(KIND_TYPES[f.kind] ?? []).includes(guessType(file))) {
      a.setErr(`${KIND[f.kind]} 자료는 ${(KIND_TYPES[f.kind] ?? []).map((t) => TYPE_LABEL[t]).join(' · ')} 파일만 받습니다.`); return;
    }
    void a.run('mat-new', () => withUpload(file, 'MARKETING_MATERIAL', (fileId) => api('/admin/affiliates/materials', {
        method: 'POST',
        body: JSON.stringify({ title: f.title.trim(), kind: f.kind, body: f.body.trim() || undefined, fileId }),
      })), () => { setF({ title: '', kind: f.kind, body: '' }); setFile(null); setFileKey((k) => k + 1); r.reload(); });
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const rows = r.data.items;
  const risky = (t: string) => /무조건|100%|보장|확정 수익|원금/.test(t);
  return (
    <>
      <h2>마케팅자료 심의 <em>{rows.length}</em></h2>
      <p className="card warn">
        <b>파트너가 이것을 뿌립니다 — 회사가 한 말이 됩니다.</b> 과장 · 단정 표현이 있으면 표시광고법에 걸립니다.
        &ldquo;무조건&rdquo; &ldquo;100%&rdquo; &ldquo;보장&rdquo; 같은 말을 보십시오. <b>파일도 열어 보고</b> 판단하십시오.
      </p>
      {r.data.note && <p className="card">{r.data.note}</p>}
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">심의를 기다리는 자료가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>제목</th><th>형식</th><th>파일</th><th>올린이</th><th>등록일</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <Fragment key={m.id}>
                <tr>
                  <td><button className="linkbtn" onClick={() => setOpen(open === m.id ? null : m.id)}>{m.title}</button>
                    {risky(m.title + (m.body ?? '')) && <span className="badge badge-urgent"> 단정 표현</span>}</td>
                  <td>{KIND[m.kind] ?? m.kind}</td>
                  <td><FileCell f={m} onErr={a.setErr} /></td>
                  <td>{m.createdBy}</td><td className="muted">{ymd(m.createdAt)}</td>
                  <td>
                    <button className="btn-sm" disabled={a.busy === m.id} onClick={() => review(m, true)}>승인</button>{' '}
                    <button className="btn-no" disabled={a.busy === m.id} onClick={() => review(m, false)}>반려</button>
                  </td>
                </tr>
                {open === m.id && <tr><td colSpan={6} className="muted" style={{ whiteSpace: 'pre-wrap' }}>{m.body ?? '(본문 없음)'}</td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <p className="card"><b>반려하면 인앱과 이메일로 사유가 갑니다.</b> 사유를 안 적으면 같은 자료가 다시 올라옵니다.</p>

      <h3 className="sec">자료 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>제목</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="자료 제목" /></label>
          <label><span>형식</span>
            <select value={f.kind} aria-label="자료 형식" onChange={(e) => { setF({ ...f, kind: e.target.value }); setFile(null); setFileKey((k) => k + 1); }}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {f.kind !== 'COPY' && (
            <label style={{ gridColumn: '1 / -1' }}><span>파일 ({(KIND_TYPES[f.kind] ?? []).map((t) => TYPE_LABEL[t]).join(' · ')})</span>
              <input key={fileKey} type="file" accept={KIND_ACCEPT[f.kind]} aria-label="자료 파일"
                     onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>)}
          <label style={{ gridColumn: '1 / -1' }}><span>문구 · 설명 {f.kind === 'COPY' ? '(필수)' : '(선택)'}</span>
            <textarea rows={3} value={f.body} aria-label="자료 문구" onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'mat-new'} onClick={create}>
          {a.busy === 'mat-new' ? '올리는 중…' : '심의 대기로 올리기'}</button></div>
        <p className="hint"><b>올리면 심의 대기로 들어갑니다.</b> 위 표에서 승인해야 파트너 자료실에 나갑니다.
          이미지 · 배너 10MB, PDF 20MB, 영상(MP4) 50MB 까지. 형식은 서버가 파일 내용으로 다시 판정합니다.</p>
      </div>
    </>
  );
}
