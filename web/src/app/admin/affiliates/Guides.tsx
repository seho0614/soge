import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { withUpload, guessType } from '../../../lib/files';
import { type FileRef, FileCell } from './shared';

interface Guide extends FileRef { id: string; title: string; body: string; sortOrder: number; isActive: boolean; updatedAt: string }

/* ── 파트너가이드 (SB-AFF-MTR-010 안) ─────────────────────────────── */
export function Guides() {
  const r = useApi<Guide[]>('/admin/affiliates/guides');
  const [f, setF] = useState({ title: '', body: '', sortOrder: '100' });
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const a = useAct();
  const create = () => {
    if (f.title.trim().length < 2) { a.setErr('가이드 제목을 두 자 이상 적으십시오.'); return; }
    if (f.body.trim().length < 5) { a.setErr('가이드 본문을 다섯 자 이상 적으십시오.'); return; }
    if (file && !['application/pdf', 'image/jpeg', 'image/png'].includes(guessType(file))) { a.setErr('첨부는 PDF · JPG · PNG 만 받습니다.'); return; }
    void a.run('guide-new', () => withUpload(file, 'PARTNER_GUIDE', (fileId) => api('/admin/affiliates/guides', {
        method: 'POST',
        body: JSON.stringify({ title: f.title.trim(), body: f.body.trim(), sortOrder: Number(f.sortOrder) || 0, fileId }),
      })), () => { setF({ title: '', body: '', sortOrder: '100' }); setFile(null); setFileKey((k) => k + 1); r.reload(); });
  };
  const toggle = (g: Guide) => a.run(g.id, () => api(`/admin/affiliates/guides/${g.id}`, {
    method: 'PATCH', body: JSON.stringify({ isActive: !g.isActive }) }), r.reload, g.isActive ? '껐습니다. 파트너에게 안 보입니다.' : '켰습니다.');

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data ?? [];
  return (
    <>
      <h2>파트너가이드 <em>{rows.length}</em></h2>
      <p className="card">가이드는 심의 없이 <b>바로</b> 파트너가이드에 보입니다. 첨부는 <b>승인된(ACTIVE) 파트너만</b> 내려받습니다.</p>
      <Flash msg={a.msg} err={a.err} />
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">등록된 가이드가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>순서</th><th>제목</th><th>첨부</th><th>상태</th><th>수정일</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td className="num-cell">{g.sortOrder}</td>
                <td><b>{g.title}</b></td>
                <td><FileCell f={g} onErr={a.setErr} /></td>
                <td>{g.isActive ? <span className="st ok">보임</span> : <span className="st no">꺼짐</span>}</td>
                <td className="muted">{ymd(g.updatedAt)}</td>
                <td><button className="btn-plain" disabled={a.busy === g.id} onClick={() => void toggle(g)}>{g.isActive ? '끄기' : '켜기'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="sec">가이드 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>제목</span><input value={f.title} aria-label="가이드 제목" onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label><span>순서 (작을수록 위)</span><input type="number" min={0} value={f.sortOrder} aria-label="가이드 순서" onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>본문</span>
            <textarea rows={4} value={f.body} aria-label="가이드 본문" onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>첨부 (선택 · PDF · JPG · PNG)</span>
            <input key={fileKey} type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="가이드 첨부"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'guide-new'} onClick={create}>
          {a.busy === 'guide-new' ? '올리는 중…' : '가이드 올리기'}</button></div>
      </div>
    </>
  );
}
