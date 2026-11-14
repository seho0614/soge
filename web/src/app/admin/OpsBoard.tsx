import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

type Kind = 'DAILY_DIGEST' | 'URGENT' | 'OWNER_TODO' | 'TEST' | 'STAFF';
interface Row {
  id: string; kind: Kind; title: string; preview: string; telegram: string | null; slack: string | null; isPinned: boolean;
  takenDownAt: string | null; createdAt: string; updatedAt: string | null; author: string | null; reads: number; comments: number; readByMe: boolean;
}
interface List { items: Row[]; total: number; page: number; pageSize: number }
interface DetailData {
  id: string; kind: Kind; title: string; body: string; telegram: string | null; slack: string | null; isPinned: boolean; takenDownAt: string | null;
  takenDownReason: string | null; createdAt: string; author: string | null; mine: boolean;
  comments: { id: string; body: string; at: string; author: string | null }[];
  reads: { at: string; who: string | null }[];
  revisions: { id: string; before: { title?: string; body?: string }; reason: string | null; at: string; who: string | null }[];
}
const KIND: Record<Kind, string> = { DAILY_DIGEST: '하루 요약', URGENT: '급한 알림', OWNER_TODO: '대표 할 일', TEST: '시험 메시지', STAFF: '운영자 글' };
/** 보낸 결과 낱말 → 글자 */
const sent = (v: string | null) => v === null ? '—' : v === 'SENT' ? '보냄' : v === 'OFF' ? '꺼짐'
  : ['NO_TOKEN', 'NO_CHAT', 'NO_WEBHOOK'].includes(v) ? `준비 안 됨(${v})` : `실패(${v.replace(/^SEND_/, '')})`;

/**
 * SB-ADM-OBD-010 운영자 게시판 (v10.286 · D213 · docs/412 · 운영 화면 계정 모두)
 *
 * 자동 글(하루 요약 · 급한 알림 · 대표 할 일 주간 · 시험 메시지)은 텔레그램 · 슬랙 결과와 함께 항상 올라옴(꺼져 있어도).
 * 운영자 글쓰기 · 고치기(쓴 사람 · SUPER · 전 내용 기록) · 내리기 · 댓글 · 「확인함」. 사용자 웹에는 없음.
 */
export function OpsBoard() {
  const isSuper = tokenRoles().includes('SUPER');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...(kind ? { kind } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(unread ? { unread: '1' } : {}), page: String(page) }).toString();
  const q = useApi<List>(`/admin/ops-board?${qs}`);
  const [open, setOpen] = useState<DetailData | null>(null);
  const [nf, setNf] = useState({ title: '', body: '', isPinned: false });
  const [cm, setCm] = useState('');
  const [ed, setEd] = useState<null | { title: string; body: string; reason: string }>(null);
  const sets = useApi<{ key: string; value: string | null }[]>('/admin/site-settings');
  const [ret, setRet] = useState<string | null>(null);
  const a = useAct();

  const load = async (id: string) => { try { setOpen(await api<DetailData>(`/admin/ops-board/${id}`)); setEd(null); setCm(''); } catch (e) { a.setErr(String((e as Error).message ?? e)); } };
  const after = (id?: string) => { q.reload(); if (id) void load(id); };
  const write = () => {
    if (!nf.title.trim() || !nf.body.trim()) { a.setErr('제목과 본문을 적어 주십시오.'); return; }
    void a.run('new', () => api<{ note: string }>('/admin/ops-board', { method: 'POST', body: JSON.stringify({ title: nf.title.trim(), body: nf.body.trim(), isPinned: nf.isPinned }) }),
      () => { setNf({ title: '', body: '', isPinned: false }); q.reload(); }, (r) => r.note);
  };
  const read = (id: string) => void a.run(`read:${id}`, () => api(`/admin/ops-board/${id}/read`, { method: 'POST' }), () => after(id), '확인함으로 남겼습니다.');
  const comment = (id: string) => {
    if (!cm.trim()) return;
    void a.run(`cm:${id}`, () => api<{ note: string }>(`/admin/ops-board/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: cm.trim() }) }), () => after(id), (r) => r.note);
  };
  const pin = (d: DetailData) => void a.run(`pin:${d.id}`, () => api<{ note: string }>(`/admin/ops-board/${d.id}`, { method: 'PATCH', body: JSON.stringify({ isPinned: !d.isPinned }) }), () => after(d.id), (r) => r.note);
  const save = (d: DetailData) => {
    if (!ed) return;
    void a.run(`ed:${d.id}`, () => api<{ note: string }>(`/admin/ops-board/${d.id}`, { method: 'PATCH', body: JSON.stringify({ title: ed.title.trim(), body: ed.body.trim(), ...(ed.reason.trim() ? { reason: ed.reason.trim() } : {}) }) }), () => after(d.id), (r) => r.note);
  };
  const down = (d: DetailData) => {
    const reason = prompt(`「${d.title}」 글을 내립니다(지우지 않고 「내림」으로 남음). 사유(2자 이상)`);
    if (reason === null) return;
    if (reason.trim().length < 2) { a.setErr('사유를 2자 이상 적어 주십시오.'); return; }
    void a.run(`down:${d.id}`, () => api<{ note: string }>(`/admin/ops-board/${d.id}/take-down`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), () => after(d.id), (r) => r.note);
  };
  const retVal = ret ?? (sets.data ?? []).find((x) => x.key === 'ops.board_retention_days')?.value ?? '';
  const saveRet = () => {
    if (!/^[1-9]\d{0,4}$/.test(retVal.trim())) { a.setErr('1 이상의 일 수를 적어 주십시오.'); return; }
    void a.run('ret', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'ops.board_retention_days', value: retVal.trim() }) }),
      () => { setRet(null); sets.reload(); }, '보관 기간을 바꿨습니다.');
  };
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <section data-ops-board={d?.total ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts" data-ops-board-filter>
        <select aria-label="종류" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          <option value="">모든 종류</option>
          {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
        </select>
        <label><span>시작</span> <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label><span>끝</span> <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        <label><input type="checkbox" checked={unread} onChange={(e) => { setUnread(e.target.checked); setPage(1); }} data-ops-board-unread /> 내가 안 본 것</label>
        <button className="btn-plain btn-sm" onClick={q.reload}>새로 보기</button>
      </div>
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : !d ? <p className="muted">불러오는 중…</p> : d.items.length === 0 ? <p className="muted">글이 없습니다.</p> : (
        <table className="tbl">
          <thead><tr><th>때</th><th>종류</th><th>제목</th><th>텔레그램</th><th>슬랙</th><th>확인 · 댓글</th></tr></thead>
          <tbody>
            {d.items.map((r) => (
              <tr key={r.id} data-ops-board-row={r.id} data-ops-board-kind={r.kind} className={r.readByMe ? '' : 'strong'}>
                <td className="dim">{ymdhm(r.createdAt)}</td>
                <td>{KIND[r.kind] ?? r.kind}</td>
                <td>
                  {r.isPinned && <span className="badge badge-verified">고정</span>} {r.takenDownAt && <span className="badge">내림</span>}{' '}
                  <button className="linkbtn" onClick={() => void load(r.id)} data-ops-board-open={r.id}>{r.title}</button>
                  {r.author && <span className="dim"> · {r.author}</span>}
                  {!r.readByMe && <span className="badge badge-urgent"> 안 봄</span>}
                </td>
                <td className="dim" data-ops-board-tg={r.telegram ?? ''}>{sent(r.telegram)}</td>
                <td className="dim" data-ops-board-slack={r.slack ?? ''}>{sent(r.slack)}</td>
                <td className="dim">확인 {r.reads}명 · 댓글 {r.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && pages > 1 && (
        <div className="acts" data-ops-board-pages={pages}>
          <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>앞</button>
          <span className="dim">{page} / {pages}(모두 {d.total})</span>
          <button className="btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>뒤</button>
        </div>
      )}

      {open && (
        <div className="card pad" data-ops-board-detail={open.id}>
          <div className="acts" style={{ justifyContent: 'space-between' }}>
            <b>{open.title}</b>
            <button className="btn-sm" onClick={() => setOpen(null)}>닫기</button>
          </div>
          <p className="dim">{KIND[open.kind]} · {ymdhm(open.createdAt)}{open.author ? ` · ${open.author}` : ''} · 텔레그램 {sent(open.telegram)} · 슬랙 {sent(open.slack)}</p>
          {open.takenDownAt && <p className="card warn">내린 글 — {ymdhm(open.takenDownAt)} · 사유: {open.takenDownReason}</p>}
          {ed ? (
            <div className="form-grid">
              <label><span>제목</span><input value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} /></label>
              <label><span>고치는 까닭(선택)</span><input value={ed.reason} onChange={(e) => setEd({ ...ed, reason: e.target.value })} /></label>
              <label style={{ gridColumn: '1 / -1' }}><span>본문</span><textarea rows={6} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} /></label>
              <div className="acts"><button className="btn-ok" onClick={() => save(open)} data-ops-board-save>저장</button><button className="btn-sm" onClick={() => setEd(null)}>그만</button></div>
            </div>
          ) : <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }} data-ops-board-body>{open.body}</pre>}
          <div className="acts">
            {<button className="btn-ok" disabled={a.busy === `read:${open.id}`} onClick={() => read(open.id)} data-ops-board-read>확인함</button>}
            {open.kind === 'STAFF' && !open.takenDownAt && (open.mine || isSuper) && !ed && <button className="btn-sm" onClick={() => setEd({ title: open.title, body: open.body, reason: '' })} data-ops-board-edit>고치기</button>}
            {isSuper && !open.takenDownAt && <button className="btn-sm" onClick={() => pin(open)} data-ops-board-pin>{open.isPinned ? '고정 풀기' : '고정'}</button>}
            {!open.takenDownAt && (open.mine || isSuper) && <button className="btn-sm" onClick={() => down(open)} data-ops-board-down>내리기</button>}
          </div>
          <p className="dim" data-ops-board-reads={open.reads.length}>확인한 사람 {open.reads.length}명{open.reads.length ? ` — ${open.reads.map((r) => `${r.who ?? '—'}(${ymdhm(r.at)})`).join(' · ')}` : ''}</p>
          <div data-ops-board-comments={open.comments.length}>
            <b>댓글 {open.comments.length}</b>
            {open.comments.map((c) => <p key={c.id}><span className="dim">{c.author ?? '—'} · {ymdhm(c.at)}</span><br />{c.body}</p>)}
            <div className="acts">
              <input aria-label="댓글" value={cm} onChange={(e) => setCm(e.target.value)} placeholder="댓글(고칠 수 없음)" style={{ flex: 1 }} data-ops-board-comment-input />
              <button className="btn-sm" disabled={!cm.trim() || a.busy === `cm:${open.id}`} onClick={() => comment(open.id)} data-ops-board-comment>남기기</button>
            </div>
          </div>
          {open.revisions.length > 0 && (
            <details data-ops-board-revisions={open.revisions.length}>
              <summary>고친 기록 {open.revisions.length}</summary>
              {open.revisions.map((v) => <p key={v.id} className="dim">{ymdhm(v.at)} · {v.who ?? '—'}{v.reason ? ` · ${v.reason}` : ''} — 전 제목 「{v.before.title}」</p>)}
            </details>
          )}
        </div>
      )}

      <h3 className="ad-s2">글쓰기</h3>
      <div className="card pad" data-ops-board-new>
        <div className="form-grid">
          <label><span>제목</span><input value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} data-ops-board-new-title /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>본문</span><textarea rows={4} value={nf.body} onChange={(e) => setNf({ ...nf, body: e.target.value })} data-ops-board-new-body /></label>
        </div>
        <div className="acts">
          <label><input type="checkbox" checked={nf.isPinned} onChange={(e) => setNf({ ...nf, isPinned: e.target.checked })} /> 고정</label>
          <button className="btn-ok" disabled={a.busy === 'new'} onClick={write} data-ops-board-write>올리기</button>
        </div>
        <p className="hint">운영 화면 계정(관리자 · 최고 관리자 · 검수 · 지급 · 파트너 담당)만 봅니다. 고치면 전 내용이 남고, 지우지 않고 「내림」으로 남습니다.</p>
      </div>

      {isSuper && (
        <div className="card pad" data-ops-board-retention>
          <label><span>자동 글 보관 기간(일)</span> <input inputMode="numeric" value={retVal} onChange={(e) => setRet(e.target.value)} data-ops-board-retention-input />
            <button className="btn-sm" disabled={ret === null || a.busy === 'ret'} onClick={saveRet}>저장</button></label>
          <p className="hint">지나면 매일 04:40 정기 작업이 자동 글을 지웁니다(운영자 글 · 고정한 글은 남김). 관리자 공지 사본은 2일 동안 첫 화면에 보입니다.</p>
        </div>
      )}
    </section>
  );
}
