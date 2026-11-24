import { useState } from 'react';
import { MemberNotesBox } from './MemberOpsBoxes';   // v10.361 (D237) 운영 메모
import { CsxDraftBox } from './CsxDesk';   // v10.528 (D280) AI 답변 초안 상자
import { BzxInquiryPhotos } from './Bzx';   // v10.611 (docs/753) 사진 미리 보기 · 답변 사진
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Row {
  id: string; no: string; category: string; categoryLabel: string | null; title: string; status: string; channel: string;
  createdAt: string; dueAt: string | null; answeredAt: string | null; overdue: boolean; guest: boolean;
  email: string | null; nameHead: string; assignee: string | null; files: number;
  feedback?: string | null; reopenCount?: number;   /* v10.341 (D231) 회원 만족도 · 다시 연 횟수 */
  sourceGwan?: string | null; sourcePage?: string | null;   /* v10.681 (D318) 관 페이지에서 온 문의 */
}
interface ListData {
  rows: Row[]; more: boolean; page: number;
  counts: { open: number; overdue: number; answered: number; closed: number };
  categories: Array<{ code: string; label: string }>;
}
interface One extends Omit<Row, 'files' | 'nameHead'> { accountId?: string | null;   /* v10.361 운영 메모 */
  body: string; answer: string | null; answeredBy: string | null; assigneeId: string | null; staffNote: string | null;
  name: string | null; files: string[]; dealId: string | null; dealStatus: string | null;
  past: Array<{ id: string; no: string; title: string; status: string; createdAt: string }>;
  staff: Array<{ id: string; email: string }>;
}

interface Tpl { id: string; title: string; body: string; sortOrder: number; isActive: boolean; updatedAt: string; gwanCode?: string | null }   // v10.766 관별 틀

const ST: Record<string, string> = { OPEN: '답변 전', ANSWERED: '답변 완료', CLOSED: '닫힘' };
const ST_CLS: Record<string, string> = { OPEN: 'wait', ANSWERED: 'ok', CLOSED: '' };

/**
 * SB-ADM-INQ-010 1:1 문의 (v10.333 · D225 · docs/464)
 *
 * 대표 11/17 「① 1:1 문의 답변함」. 고객센터 문의하기 폼 · 1:1 문의 챗봇 「상담원 연결」로 들어온 문의를 여기서 답합니다.
 * 답하면 회원에게 알림이 가고 나의공간 · 「내 문의 내역」에 답이 보입니다. 기한은 접수 뒤 영업일 1일 — 넘기면 운영 알림.
 */
export function InquiryDesk() {
  const [f, setF] = useState({ status: 'OPEN', category: '', overdue: false, q: '', page: 1 });
  const [word, setWord] = useState('');
  const qs = new URLSearchParams({ ...(f.status ? { status: f.status } : {}), ...(f.category ? { category: f.category } : {}),
    ...(f.overdue ? { overdue: '1' } : {}), ...(f.q ? { q: f.q } : {}), page: String(f.page) }).toString();
  const list = useApi<ListData>(`/admin/inquiries?${qs}`);
  const [open, setOpen] = useState<string | null>(null);
  const [tpl, setTpl] = useState(false);
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const { rows, counts, categories, more, page } = list.data;
  const pick = (v: Partial<typeof f>) => { setOpen(null); setF({ ...f, page: 1, ...v }); };

  return (
    <section data-inquiry-desk="">
      <InquiryStats />
      <p data-inquiry-counts={`${counts.open}|${counts.overdue}|${counts.answered}|${counts.closed}`}>
        <button className={`btn-sm ${f.status === 'OPEN' && !f.overdue ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ status: 'OPEN', overdue: false })}>답변 전 <b>{counts.open}</b></button>{' '}
        <button className={`btn-sm ${f.overdue ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ status: 'OPEN', overdue: true })} data-inquiry-overdue-btn="">
          기한 넘김 <b className={counts.overdue ? 'warn-text' : undefined}>{counts.overdue}</b></button>{' '}
        <button className={`btn-sm ${f.status === 'ANSWERED' ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ status: 'ANSWERED', overdue: false })}>답변 완료 {counts.answered}</button>{' '}
        <button className={`btn-sm ${f.status === 'CLOSED' ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ status: 'CLOSED', overdue: false })}>닫힘 {counts.closed}</button>{' '}
        <button className={`btn-sm ${!f.status ? 'btn-ok' : 'btn-plain'}`} onClick={() => pick({ status: '', overdue: false })}>모두</button>
      </p>
      <p>
        <select name="inq-category" value={f.category} onChange={(e) => pick({ category: e.target.value })}>
          <option value="">분류 모두</option>
          {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>{' '}
        <input name="inq-q" value={word} onChange={(e) => setWord(e.target.value)} placeholder="제목 · 본문 · 메일"
          onKeyDown={(e) => { if (e.key === 'Enter') pick({ q: word.trim() }); }} />{' '}
        <button className="btn-plain btn-sm" onClick={() => pick({ q: word.trim() })} data-inquiry-q-go="">찾기</button>{' '}
        <button className="btn-plain btn-sm" onClick={() => setTpl(!tpl)} data-inquiry-tpl-manage="">{tpl ? '답변 틀 닫기' : '답변 틀 관리'}</button>
      </p>
      {tpl && <TemplateManager />}
      <table className="tbl" data-inquiry-rows={rows.length}>
        <thead><tr><th>문의번호</th><th>분류</th><th>제목</th><th>보낸 사람</th><th>접수</th><th>기한</th><th>상태</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="muted">해당하는 문의가 없습니다.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} data-inquiry-row={r.id} className={r.overdue ? 'warn' : undefined}>
              <td className="mono">{r.no}</td>
              <td>{r.categoryLabel ?? r.category}{r.channel === 'BOT' && <><br /><small className="dim">챗봇 → 상담원</small></>}
                {r.sourceGwan && <><br /><small className="dim" data-inquiry-source>관 {r.sourceGwan}{r.sourcePage ? ` › ${r.sourcePage === 'home' ? '첫 화면' : r.sourcePage}` : ''}</small></>}</td>
              <td><button className="linkbtn" onClick={() => setOpen(open === r.id ? null : r.id)} data-inquiry-open={r.id}>{r.title}</button>
                {r.files > 0 && <small className="dim"> · 첨부 {r.files}</small>}
                {r.feedback === 'UNRESOLVED' && <span className="badge badge-urgent" data-inquiry-reopened=""> 다시 열림{(r.reopenCount ?? 0) > 1 ? ` ${r.reopenCount}` : ''}</span>}
                {r.feedback === 'RESOLVED' && <span className="badge badge-verified" data-inquiry-resolved-row=""> 해결됨</span>}</td>
              <td>{r.guest ? <span className="muted">비회원 · </span> : null}{r.email ?? '—'}</td>
              <td className="muted">{ymdhm(r.createdAt)}</td>
              <td className={r.overdue ? 'warn-text' : 'muted'}>{r.status === 'OPEN' && r.dueAt ? ymdhm(r.dueAt) : '—'}{r.overdue && ' · 넘김'}</td>
              <td><span className={`ad-bg ${ST_CLS[r.status] ?? ''}`}>{ST[r.status] ?? r.status}</span>{r.assignee && <><br /><small className="dim">{r.assignee}</small></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {page > 1 && <button className="btn-plain btn-sm" onClick={() => setF({ ...f, page: page - 1 })}>← 앞 쪽</button>}{' '}
        {more && <button className="btn-plain btn-sm" onClick={() => setF({ ...f, page: page + 1 })}>다음 쪽 →</button>}
      </p>
      {open && <InquiryOne id={open} onChanged={list.reload} />}
      <div className="ad-nt info">
        답변은 회원에게 그대로 보입니다 — 금액 · 기한 · 법률 문구는 약관 · 화면과 같게 적습니다. 비회원 문의는 메일로만 답이 갑니다(운영 메일 준비 전이면 「메일 대기」).
        답변을 고치면 옛 답은 감사 기록에 남습니다. 거래 분쟁은 이 창구가 아니라 거래 › 분쟁에서 처리해야 정산 보류가 걸립니다.
      </div>
    </section>
  );
}

function InquiryOne({ id, onChanged }: { id: string; onChanged: () => void }) {
  const q = useApi<One>(`/admin/inquiries/${id}`);
  const tq = useApi<{ rows: Tpl[] }>('/admin/inquiry-templates');   /* v10.334 (D226) 답변 틀 */
  const a = useAct();
  const [text, setText] = useState<string | null>(null);
  const [tplId, setTplId] = useState<string | null>(null);   /* v10.337 — 고른 답변 틀(지표) */
  const [note, setNote] = useState<string | null>(null);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const ans = text ?? d.answer ?? '';
  const after = () => { setText(null); setTplId(null); setNote(null); q.reload(); onChanged(); };
  const send = (close: boolean) => {
    if (!confirm(`${d.guest ? '비회원 문의입니다 — 메일로만 답이 갑니다. ' : '회원에게 알림이 갑니다. '}${d.answer ? '답변을 고칩니다' : '답변을 보냅니다'}${close ? '(닫음)' : ''}.`)) return;
    void a.run('answer', () => api(`/admin/inquiries/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer: ans, close, ...(tplId ? { templateId: tplId } : {}) }) }), after);
  };
  const patch = (v: Record<string, string>, ask?: string) => {
    if (ask && !confirm(ask)) return;
    void a.run('patch', () => api(`/admin/inquiries/${id}`, { method: 'PATCH', body: JSON.stringify(v) }), after);
  };
  const openFile = (fid: string) => void api<{ url?: string }>(`/files/${fid}`).then((r) => { if (r.url) window.open(r.url, '_blank', 'noopener'); })
    .catch(() => a.setErr('첨부 파일을 열지 못했습니다.'));

  return (
    <div className="card" data-inquiry-one={id}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">{d.no} · {d.title} <small className="dim">{d.categoryLabel ?? d.category} · {ST[d.status] ?? d.status}{d.overdue ? ' · 기한 넘김' : ''}</small></h3>
      {d.accountId && <MemberNotesBox accountId={d.accountId} compact />}   {/* v10.361 (D237) 그 회원 운영 메모(중요 먼저 3개) */}
      <p className="muted">
        {d.guest ? '비회원' : (d.name ?? '회원')} · {d.email ?? '—'} · 접수 {ymdhm(d.createdAt)}{d.dueAt && d.status === 'OPEN' ? ` · 기한 ${ymdhm(d.dueAt)}` : ''}
        {d.channel === 'BOT' && ' · 챗봇에서 상담원 연결(대화가 본문에 붙어 있음)'}
        {d.dealId && <> · 관련 거래 <span className="mono">{d.dealId.slice(0, 8)}</span>({d.dealStatus})</>}
        {d.sourceGwan && <> · 관 페이지에서 옴 <span className="mono">{d.sourceGwan}{d.sourcePage ? ` › ${d.sourcePage}` : ''}</span></>}
      </p>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--g50, #f8fafc)', padding: 12, borderRadius: 8 }} data-inquiry-body="">{d.body}</pre>
      {d.files.length > 0 && <p>첨부: {d.files.map((fid, i) => <button key={fid} className="btn-plain btn-sm" onClick={() => openFile(fid)}>파일 {i + 1}</button>)}</p>}
      <BzxInquiryPhotos id={id} closed={d.status === 'CLOSED'} />   {/* v10.611 (docs/753) 접수 첨부 · 더한 사진 · 답변 사진 미리 보기 */}
      {d.status !== 'CLOSED' && (tq.data?.rows ?? []).some((t) => t.isActive) && (
        <p>
          <select name="inq-template" value="" data-inquiry-template=""
            onChange={(e) => { const t = tq.data?.rows.find((x) => x.id === e.target.value); if (t && (!ans.trim() || confirm('답변 칸의 글을 이 틀로 바꿉니다.'))) { setText(t.body); setTplId(t.id); } }}>
            <option value="">답변 틀 고르기 — 칸에 채운 뒤 고쳐서 보냄</option>
            {(tq.data?.rows ?? []).filter((t) => t.isActive && (!t.gwanCode || t.gwanCode === d.sourceGwan)).sort((a, b) => Number(!!b.gwanCode && b.gwanCode === d.sourceGwan) - Number(!!a.gwanCode && a.gwanCode === d.sourceGwan))
              .map((t) => <option key={t.id} value={t.id}>{t.gwanCode ? `[${t.gwanCode}] ` : ''}{t.title}</option>)}   {/* v10.766 (docs/874) 그 관 틀 먼저 · 다른 관 틀은 숨김 */}
          </select>
        </p>
      )}
      <CsxDraftBox inquiryId={id} closed={d.status === 'CLOSED'} onUse={(t) => { setText(t); setTplId(null); }} />   {/* v10.528 (D280) 초안은 회원에게 안 보임 · 넣은 뒤 고쳐 보냄 */}
      {d.answer && <p className="muted">지난 답변 {ymdhm(d.answeredAt)}{d.answeredBy ? ` · ${d.answeredBy}` : ''}</p>}
      <textarea name="inq-answer" value={ans} onChange={(e) => setText(e.target.value)} rows={7} maxLength={4000} readOnly={d.status === 'CLOSED'}
        placeholder={d.status === 'CLOSED' ? '닫힌 문의입니다 — 「다시 열기」 뒤 답합니다.' : '답변(회원에게 그대로 보임 · 4,000자)'} style={{ width: '100%' }} data-inquiry-answer="" />
      <p>
        {d.status !== 'CLOSED' && <>
          <button className="btn-ok" disabled={a.busy === 'answer' || ans.trim().length < 2} onClick={() => send(false)} data-inquiry-send="">{d.answer ? '답변 고치기' : '답변 보내기'}</button>{' '}
          <button className="btn-plain" disabled={a.busy === 'answer' || ans.trim().length < 2} onClick={() => send(true)} data-inquiry-send-close="">보내고 닫기</button>{' '}
          <button className="btn-plain btn-sm" disabled={a.busy === 'patch'} onClick={() => patch({ status: 'CLOSED' }, '답하지 않고 닫습니다(스팸 · 중복 등).')} data-inquiry-close="">닫기</button>
        </>}
        {d.status !== 'OPEN' && <button className="btn-plain btn-sm" disabled={a.busy === 'patch'} onClick={() => patch({ status: 'OPEN' }, '다시 엽니다 — 기한은 지금부터 영업일 1일.')} data-inquiry-reopen="">다시 열기</button>}
      </p>
      <p>
        <label>담당 <select name="inq-assignee" value={d.assigneeId ?? ''} onChange={(e) => patch({ assigneeId: e.target.value })}>
          <option value="">담당 없음</option>
          {d.staff.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}
        </select></label>{' '}
        <input name="inq-note" value={note ?? d.staffNote ?? ''} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="운영 메모(회원에게 안 보임)" style={{ width: '45%' }} />{' '}
        <button className="btn-plain btn-sm" disabled={note === null || a.busy === 'patch'} onClick={() => patch({ staffNote: note ?? '' })}>메모 저장</button>
      </p>
      {d.past.length > 0 && (
        <details><summary>이 회원의 지난 문의 {d.past.length}건</summary>
          <ul className="plain">{d.past.map((p) => <li key={p.id}><span className="mono">{p.no}</span> {p.title} <small className="dim">{ST[p.status] ?? p.status} · {ymdhm(p.createdAt)}</small></li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** v10.334 (D226 · docs/465) — 답변 틀 관리(ADMIN · SUPER) · 지우기 없음(숨기기) */
function TemplateManager() {
  const q = useApi<{ rows: Tpl[] }>('/admin/inquiry-templates');
  const a = useAct();
  const [edit, setEdit] = useState<{ id: string | null; title: string; body: string; sortOrder: number; gwanCode: string } | null>(null);
  const gws = useApi<Array<{ code: string; name: string }>>('/admin/gwans');   // v10.766 관별 틀
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const save = () => {
    if (!edit) return;
    const { id, ...v } = edit;
    void a.run('tpl', () => api(id ? `/admin/inquiry-templates/${id}` : '/admin/inquiry-templates', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(v) }),
      () => { setEdit(null); q.reload(); });
  };
  const toggle = (t: Tpl) => {
    if (!confirm(t.isActive ? `「${t.title}」 틀을 숨깁니다.` : `「${t.title}」 틀을 다시 보이게 합니다.`)) return;
    void a.run(`t-${t.id}`, () => api(`/admin/inquiry-templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !t.isActive }) }), q.reload);
  };
  return (
    <div className="card" data-inquiry-templates={q.data.rows.length}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">답변 틀 <button className="btn-plain btn-sm" onClick={() => setEdit({ id: null, title: '', body: '', sortOrder: 100, gwanCode: '' })} data-inquiry-tpl-new="">새 틀</button></h3>
      {edit && (
        <div>
          <p><input name="tpl-title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={40} placeholder="틀 이름(40자)" />{' '}
            <input name="tpl-sort" type="number" min={0} max={9999} value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} style={{ width: 80 }} />{' '}
            <select name="tpl-gwan" value={edit.gwanCode} onChange={(e) => setEdit({ ...edit, gwanCode: e.target.value })} aria-label="관(선택)" data-inquiry-tpl-gwan>
              <option value="">모든 문의</option>{(Array.isArray(gws.data) ? gws.data : []).map((g) => <option key={g.code} value={g.code}>{g.name}({g.code}) 문의</option>)}</select></p>
          <p><textarea name="tpl-body" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={6} maxLength={4000} style={{ width: '100%' }} placeholder="답변 글(2 ~ 4,000자)" /></p>
          <p><button className="btn-ok" disabled={a.busy === 'tpl' || !edit.title.trim() || edit.body.trim().length < 2} onClick={save} data-inquiry-tpl-save="">저장</button>{' '}
            <button className="btn-plain btn-sm" onClick={() => setEdit(null)}>취소</button></p>
        </div>
      )}
      <table className="tbl">
        <thead><tr><th>순서</th><th>이름</th><th>관</th><th>글 앞부분</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {q.data.rows.map((t) => (
            <tr key={t.id} className={t.isActive ? undefined : 'muted'}>
              <td>{t.sortOrder}</td><td>{t.title}</td><td>{t.gwanCode ?? '모두'}</td><td className="muted">{t.body.slice(0, 50)}{t.body.length > 50 ? '…' : ''}</td>
              <td>{t.isActive ? '보임' : '숨김'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-plain btn-sm" onClick={() => setEdit({ id: t.id, title: t.title, body: t.body, sortOrder: t.sortOrder, gwanCode: t.gwanCode ?? '' })}>고치기</button>{' '}
                <button className="btn-plain btn-sm" disabled={a.busy === `t-${t.id}`} onClick={() => toggle(t)}>{t.isActive ? '숨기기' : '보이기'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Stats {
  days: number; received: number; answered: number; stillOpen: number; avgHours: number | null; medianHours: number | null;
  inTime: number; inTimeRate: number | null;
  byCategory: Array<{ category: string; label: string | null; received: number; answered: number }>;
  templates: Array<{ id: string; title: string; used: number }>;
  deflected?: number;
  resolved?: number; unresolved?: number; resolvedRate?: number | null;   /* v10.341 (D231) */
}

/** v10.337 (docs/470) — 1:1 문의 처리 지표(최근 30일) · 처음 답 시각은 감사 기록 기준 */
function InquiryStats() {
  const [days, setDays] = useState(30);
  const s = useApi<Stats>(`/admin/inquiries/stats?days=${days}`);
  if (s.error || !s.data) return null;
  const d = s.data;
  const h = (v: number | null) => (v === null ? '—' : `${v}시간`);
  return (
    <details className="card" data-inquiry-stats={`${d.received}|${d.answered}`}>
      <summary>
        <b>최근 {d.days}일</b> 접수 {d.received} · 답함 {d.answered} · 처음 답까지 평균 {h(d.avgHours)}(가운데 {h(d.medianHours)}) ·
        기한 안 {d.inTimeRate === null ? '—' : `${d.inTimeRate}%`} · 아직 답변 전 {d.stillOpen} · 문의 전 해결 <span data-inquiry-deflected={d.deflected ?? 0}>{d.deflected ?? 0}</span> ·
        해결률 <span data-inquiry-resolved={`${d.resolved ?? 0}|${d.unresolved ?? 0}`}>{d.resolvedRate == null ? '—' : `${d.resolvedRate}%`}</span>
      </summary>
      <p>
        {[7, 30, 90].map((n) => (
          <button key={n} className={`btn-sm ${days === n ? 'btn-ok' : 'btn-plain'}`} onClick={() => setDays(n)}>{n}일</button>
        ))}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <table className="tbl" data-inquiry-stats-cat=""><thead><tr><th>분류</th><th>접수</th><th>답함</th></tr></thead><tbody>
          {d.byCategory.length === 0 ? <tr><td colSpan={3} className="muted">없음</td></tr>
            : d.byCategory.map((c) => <tr key={c.category}><td>{c.label ?? c.category}</td><td>{c.received}</td><td>{c.answered}</td></tr>)}
        </tbody></table>
        <table className="tbl" data-inquiry-stats-tpl=""><thead><tr><th>답변 틀</th><th>쓴 횟수</th></tr></thead><tbody>
          {d.templates.map((t) => <tr key={t.id}><td>{t.title}</td><td>{t.used}</td></tr>)}
        </tbody></table>
      </div>
      <p className="muted">처음 답 시각은 감사 기록(답변) 기준입니다. 기한 = 접수 뒤 영업일 1일. 답변 틀 횟수는 「답변 틀 고르기」로 골라 보낸 답만 셉니다(v10.337 부터).</p>
    </details>
  );
}
