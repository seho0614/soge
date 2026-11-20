/* ===== ㉜ 사무 2 (D263 · docs/600 ~ 603) — web/src/app/admin/Ofc.tsx 새 파일 =====
 * 대표 11/20 「㉜ 사무 2」.
 *   OfcCalendar   사무 › 사내 일정   — 달 · 주 보기 · 휴가 · 품의 쓸 날 · 신고 기한 · 계약 만기 · 급여일 · 출장 · 업무 기한 · 직접 일정(개인 · 회사)
 *   OfcTasks      사무 › 업무 요청   — 칸반(요청 · 진행 · 완료) · 맡은 것 · 요청한 것 · 모두(SUPER) · 댓글 · 기한 표시
 *   OfcTrips      사무 › 출장        — 신청(예상 여비 → 품의) · 다녀온 뒤 정산(→ 경비 청구) · 여비 기준(SUPER)
 *   OfcNotifyBox  사무 › 내 알림     — 브라우저 알림 켜기 · 종류 · 시험 알림(계정마다 서버에 저장 · 브라우저 허락은 브라우저마다)
 *   BrowserNotify (보이지 않음)      — Console 에 한 번 놓음: 켠 계정만 ofc.notify_poll_sec 마다 「내 알림」을 묻고 새 것만 Notification 으로 띄움
 *                                     (서버 푸시 · 서비스 워커 없음 · 이미 띄운 열쇠는 이 브라우저 localStorage 에 계정마다 · 막히면 메모리만)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md · 왼쪽 트리 AdminTree 는 고치지 않음)
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, tokenRoles, tokenSub } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { uploadFile } from '../../lib/files';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const addD = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const dow = (d: string) => new Date(Date.parse(d)).getUTCDay();
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const goTab = (t?: string) => { if (t) location.hash = `#/${t}`; };

/* ── v10.462 사내 일정 ── */
interface CalItem { key: string; kind: string; title: string; start: string; end: string; time: string | null; mine: boolean; editable: boolean; id?: string; scope?: string; memo?: string | null; tab?: string }
interface CalView { from: string; to: string; today: string; items: CalItem[]; count: number; kinds: Record<string, string>; canCompany: boolean; finance: boolean; note: string }
const KIND_STYLE: Record<string, CSSProperties> = {
  EVENT: { background: 'var(--pp-l)', color: 'var(--ink)' }, LEAVE: { background: 'var(--g50)', color: 'var(--ink-2)' }, APV: { background: 'var(--or-l)', color: 'var(--ink)' },
  TAX: { background: 'var(--danger-w)', color: 'var(--danger)' }, PAY: { background: 'var(--g50)', color: 'var(--ink)' }, CONTRACT: { background: 'var(--or-l)', color: 'var(--ink-2)' },
  TRIP: { background: 'var(--pp-l)', color: 'var(--ink-2)' }, TASK: { background: 'var(--g50)', color: 'var(--danger)' },
};
const BLANK_EV = { id: '', scope: 'PERSONAL', title: '', startOn: kstDay(), endOn: '', time: '', memo: '' };

export function OfcCalendar() {
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [base, setBase] = useState(kstDay());
  const range = useMemo(() => {
    if (mode === 'week') { const s = addD(base, -dow(base)); return { from: s, to: addD(s, 6) }; }
    const first = `${base.slice(0, 7)}-01`;
    const last = addD(`${addD(first, 32).slice(0, 7)}-01`, -1);
    return { from: addD(first, -dow(first)), to: addD(last, 6 - dow(last)) };
  }, [mode, base]);
  const q = useApi<CalView>(`/admin/office/calendar?from=${range.from}&to=${range.to}`, [range.from, range.to]);
  const a = useAct();
  const [day, setDay] = useState<string | null>(null);
  const [ed, setEd] = useState<typeof BLANK_EV | null>(null);
  const d = q.data;
  const days: string[] = [];
  for (let x = range.from; x <= range.to; x = addD(x, 1)) days.push(x);
  const on = (x: string) => (d?.items ?? []).filter((it) => it.start <= x && it.end >= x);
  const move = (n: number) => setBase(mode === 'week' ? addD(base, 7 * n) : `${addD(`${base.slice(0, 7)}-15`, 30 * n).slice(0, 7)}-01`);
  const save = () => ed && void a.run('ev', () => (ed.id
    ? api(`/admin/office/events/${ed.id}`, { method: 'PUT', body: JSON.stringify({ title: ed.title, startOn: ed.startOn, endOn: ed.endOn || ed.startOn, time: ed.time || null, memo: ed.memo || null }) })
    : api('/admin/office/events', { method: 'POST', body: JSON.stringify({ scope: ed.scope, title: ed.title, startOn: ed.startOn, endOn: ed.endOn || undefined, time: ed.time || null, memo: ed.memo || null }) })),
    () => { setEd(null); q.reload(); });
  const remove = (it: CalItem) => it.id && confirm(`「${it.title}」 일정을 지울까요?`) && void a.run('rm', () => api(`/admin/office/events/${it.id}/remove`, { method: 'POST' }), () => { setEd(null); q.reload(); });
  const month = base.slice(0, 7);
  return (
    <section data-ofc-cal={d?.count ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <button className="btn-sm btn-plain" onClick={() => move(-1)} aria-label="앞">‹</button>{' '}
        <b data-ofc-cal-title="">{mode === 'month' ? `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월` : `${range.from} ~ ${range.to}`}</b>{' '}
        <button className="btn-sm btn-plain" onClick={() => move(1)} aria-label="뒤">›</button>{' '}
        <button className="btn-sm btn-plain" onClick={() => setBase(kstDay())}>오늘</button>{' '}
        <button className={`btn-sm${mode === 'month' ? '' : ' btn-plain'}`} onClick={() => setMode('month')} data-ofc-cal-mode="month">달</button>{' '}
        <button className={`btn-sm${mode === 'week' ? '' : ' btn-plain'}`} onClick={() => setMode('week')} data-ofc-cal-mode="week">주</button>{' '}
        <button className="btn-sm" onClick={() => setEd({ ...BLANK_EV, startOn: day ?? kstDay() })} data-ofc-cal-add="">일정 넣기</button>
      </div>
      {d && (
        <>
          <p className="muted" style={{ fontSize: 12 }}>{Object.entries(d.kinds).map(([k, v]) => <span key={k} style={{ ...KIND_STYLE[k], padding: '1px 7px', borderRadius: 'var(--r-sm)', marginRight: 6 }}>{v}</span>)}</p>
          <div role="grid" data-ofc-cal-grid={mode} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
            {DOW_KO.map((w, i) => <div key={w} style={{ padding: 4, fontSize: 12, textAlign: 'center', background: 'var(--g50)', color: i === 0 ? 'var(--danger)' : 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>{w}</div>)}
            {days.map((x) => {
              const list = on(x), out = mode === 'month' && x.slice(0, 7) !== month;
              return (
                <div key={x} role="gridcell" data-ofc-cal-day={x} onClick={() => setDay(x)}
                     style={{ minHeight: mode === 'week' ? 160 : 84, padding: 4, borderTop: '1px solid var(--line)', borderLeft: dow(x) ? '1px solid var(--line)' : undefined,
                              background: x === d.today ? 'var(--pp-l)' : out ? 'var(--g50)' : 'var(--paper)', cursor: 'pointer', overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, color: out ? 'var(--ink-3)' : dow(x) === 0 ? 'var(--danger)' : 'var(--ink-2)' }}>{Number(x.slice(8, 10))}</div>
                  {list.slice(0, mode === 'week' ? 12 : 4).map((it) => (
                    <div key={it.key} data-ofc-cal-item={it.kind} title={it.title}
                         style={{ ...KIND_STYLE[it.kind], fontSize: 12, padding: '0 4px', marginTop: 2, borderRadius: 'var(--r-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.time ? `${it.time} ` : ''}{it.title}
                    </div>))}
                  {list.length > (mode === 'week' ? 12 : 4) && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>+{list.length - (mode === 'week' ? 12 : 4)}</div>}
                </div>);
            })}
          </div>
          {day && (
            <div className="card pad" data-ofc-cal-dayview={day}>
              <b>{day} ({DOW_KO[dow(day)]})</b>{' '}<button className="btn-sm btn-plain" onClick={() => setDay(null)}>닫기</button>
              {!on(day).length ? <p className="muted">일정이 없습니다.</p> : (
                <table className="tbl"><tbody>{on(day).map((it) => (
                  <tr key={it.key}><td><span style={{ ...KIND_STYLE[it.kind], padding: '0 7px', borderRadius: 'var(--r-sm)', fontSize: 12 }}>{d.kinds[it.kind] ?? it.kind}</span></td>
                    <td>{it.time ?? ''}</td><td>{it.title}{it.start !== it.end && <small className="dim"> {it.start} ~ {it.end}</small>}{it.memo && <small className="dim"> · {it.memo}</small>}</td>
                    <td>{it.editable && it.kind === 'EVENT'
                      ? <><button className="btn-sm btn-plain" onClick={() => setEd({ id: it.id ?? '', scope: it.scope ?? 'PERSONAL', title: it.title.replace(/^\[회사\] /, ''), startOn: it.start, endOn: it.end, time: it.time ?? '', memo: it.memo ?? '' })}>고치기</button>{' '}
                          <button className="btn-sm btn-plain" onClick={() => remove(it)}>지우기</button></>
                      : it.tab ? <button className="btn-sm btn-plain" onClick={() => goTab(it.tab)}>화면 열기</button> : null}</td></tr>))}</tbody></table>
              )}
            </div>
          )}
          {ed && (
            <div className="card pad" data-ofc-cal-edit={ed.id || 'new'}>
              {!ed.id && (
                <select value={ed.scope} onChange={(e) => setEd({ ...ed, scope: e.target.value })} aria-label="일정 종류">
                  <option value="PERSONAL">개인(나만)</option>{d.canCompany && <option value="COMPANY">회사(모두)</option>}
                </select>)}{' '}
              <input value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} placeholder="일정 제목" size={24} aria-label="일정 제목" />{' '}
              <input type="date" value={ed.startOn} onChange={(e) => setEd({ ...ed, startOn: e.target.value })} aria-label="시작" />{' '}
              <input type="date" value={ed.endOn} onChange={(e) => setEd({ ...ed, endOn: e.target.value })} aria-label="끝(비우면 하루)" />{' '}
              <input type="time" value={ed.time} onChange={(e) => setEd({ ...ed, time: e.target.value })} aria-label="시각(비우면 종일)" />{' '}
              <input value={ed.memo} onChange={(e) => setEd({ ...ed, memo: e.target.value })} placeholder="메모" size={20} />{' '}
              <button className="btn-sm" disabled={!ed.title.trim() || !ed.startOn || a.busy === 'ev'} onClick={save} data-ofc-cal-save="">저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button>
            </div>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.463 업무 요청 ── */
interface TaskCard { id: string; title: string; state: string; stateKo: string; priority: string; dueOn: string | null; due: 'OVER' | 'TODAY' | 'LATER' | null; requester: string | null; assignee: string | null; comments: number; mineAssigned: boolean; mineRequested: boolean }
interface Board { view: string; today: string; columns: Array<{ state: string; label: string; items: TaskCard[] }>; canceled: TaskCard[]; staff: Array<{ id: string; name: string }>; canAll: boolean; me: string; counts: { open: number; over: number }; note: string }
interface TaskDet extends Omit<TaskCard, 'comments'> { body: string | null; cancelNote: string | null; comments: Array<{ id: string; kind: string; body: string; createdAt: string; author: string | null }>; can: Record<string, boolean> }
const DUE_KO: Record<string, string> = { OVER: '기한 지남', TODAY: '오늘까지' };
const BLANK_TASK = { title: '', body: '', assigneeId: '', dueOn: '', priority: 'NORMAL' };

export function OfcTasks() {
  const [view, setView] = useState('both');
  const [term, setTerm] = useState('');
  const q = useApi<Board>(`/admin/office/tasks?view=${view}&q=${encodeURIComponent(term)}`, [view, term]);
  const a = useAct();
  const [sel, setSel] = useState<string | null>(null);
  const det = useApi<TaskDet | null>(sel ? `/admin/office/tasks/${sel}` : '/admin/office/tasks?view=mine', [sel]);
  const [nt, setNt] = useState<typeof BLANK_TASK | null>(null);
  const [cm, setCm] = useState('');
  const d = q.data, t = sel && det.data && 'can' in (det.data as object) ? det.data : null;
  const reload = () => { q.reload(); det.reload(); };
  const act = (key: string, path: string, body?: unknown) => void a.run(key, () => api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }), reload);
  return (
    <section data-ofc-tasks={d ? d.counts.open : ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        {(['both', 'mine', 'requested', ...(d?.canAll ? ['all'] : [])] as string[]).map((v) => (
          <button key={v} className={`btn-sm${view === v ? '' : ' btn-plain'}`} onClick={() => setView(v)} data-ofc-task-view={v}>{({ both: '내 것 모두', mine: '맡은 것', requested: '요청한 것', all: '모두(SUPER)' } as Record<string, string>)[v]}</button>))}{' '}
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="제목 찾기" size={14} aria-label="제목 찾기" />{' '}
        <button className="btn-sm" onClick={() => setNt({ ...BLANK_TASK })} data-ofc-task-add="">업무 요청 · 할 일</button>
      </div>
      {nt && d && (
        <div className="card pad" data-ofc-task-new="">
          <input value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} placeholder="제목(2자 이상)" size={28} aria-label="업무 제목" />{' '}
          <select value={nt.assigneeId} onChange={(e) => setNt({ ...nt, assigneeId: e.target.value })} aria-label="담당자"><option value="">나(할 일)</option>{d.staff.filter((s) => s.id !== d.me).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
          <input type="date" value={nt.dueOn} min={d.today} onChange={(e) => setNt({ ...nt, dueOn: e.target.value })} aria-label="기한" />{' '}
          <label><input type="checkbox" checked={nt.priority === 'HIGH'} onChange={(e) => setNt({ ...nt, priority: e.target.checked ? 'HIGH' : 'NORMAL' })} /> 중요</label>
          <textarea value={nt.body} onChange={(e) => setNt({ ...nt, body: e.target.value })} placeholder="내용(선택)" rows={3} style={{ width: '100%', marginTop: 6 }} />
          <button className="btn-sm" disabled={nt.title.trim().length < 2 || a.busy === 'nt'} data-ofc-task-save=""
                  onClick={() => void a.run('nt', () => api('/admin/office/tasks', { method: 'POST', body: JSON.stringify({ title: nt.title, body: nt.body || null, assigneeId: nt.assigneeId || undefined, dueOn: nt.dueOn || null, priority: nt.priority }) }), () => { setNt(null); q.reload(); })}>올리기</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setNt(null)}>닫기</button>
        </div>
      )}
      {d && (
        <>
          <p className={d.counts.over ? 'warn-text' : 'muted'}>끝나지 않은 업무 {d.counts.open}건{d.counts.over ? ` · 기한 지남 ${d.counts.over}건` : ''}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {d.columns.map((c) => (
              <div key={c.state} className="card pad" data-ofc-task-col={c.state} style={{ background: 'var(--g50)' }}>
                <b>{c.label}</b> <small className="dim">{c.items.length}</small>
                {c.items.map((k) => (
                  <div key={k.id} data-ofc-task-card={k.id} onClick={() => setSel(k.id)}
                       style={{ background: sel === k.id ? 'var(--pp-l)' : 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: 8, marginTop: 8, cursor: 'pointer' }}>
                    <div style={{ fontSize: 14 }}>{k.priority === 'HIGH' && <b className="warn-text">중요 </b>}{k.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {k.mineAssigned ? `요청 ${k.requester ?? ''}` : `담당 ${k.assignee ?? ''}`}
                      {k.dueOn && <> · 기한 {k.dueOn}</>}{k.due && k.due !== 'LATER' && <b className="warn-text"> {DUE_KO[k.due]}</b>}{k.comments > 0 && <> · 댓글 {k.comments}</>}
                    </div>
                  </div>))}
              </div>))}
          </div>
          {d.canceled.length > 0 && <details><summary>취소 {d.canceled.length}건</summary>{d.canceled.map((k) => <p key={k.id} onClick={() => setSel(k.id)} style={{ cursor: 'pointer' }}>{k.title} <small className="dim">{k.requester} → {k.assignee}</small></p>)}</details>}
          {t && (
            <div className="card pad" data-ofc-task-detail={t.state}>
              <b>{t.id}. {t.title}</b> · {t.stateKo} · 요청 {t.requester} → 담당 {t.assignee}{t.dueOn && ` · 기한 ${t.dueOn}`}{t.cancelNote && ` · 취소 사유 ${t.cancelNote}`}{' '}
              <button className="btn-sm btn-plain" onClick={() => setSel(null)}>닫기</button>
              {t.body && <p style={{ whiteSpace: 'pre-wrap' }}>{t.body}</p>}
              <div className="acts">
                {t.can.start && <button className="btn-sm" onClick={() => act('mv', `/admin/office/tasks/${t.id}/move`, { to: 'DOING' })} data-ofc-task-act="start">진행</button>}{' '}
                {t.can.done && <button className="btn-sm" onClick={() => act('mv', `/admin/office/tasks/${t.id}/move`, { to: 'DONE' })} data-ofc-task-act="done">완료</button>}{' '}
                {t.can.back && <button className="btn-sm btn-plain" onClick={() => act('mv', `/admin/office/tasks/${t.id}/move`, { to: 'REQUESTED' })}>요청으로 되돌림</button>}{' '}
                {t.can.reopen && <button className="btn-sm btn-plain" onClick={() => act('mv', `/admin/office/tasks/${t.id}/move`, { to: 'DOING' })} data-ofc-task-act="reopen">다시 열기</button>}{' '}
                {t.can.assign && d && (
                  <select value="" onChange={(e) => e.target.value && act('as', `/admin/office/tasks/${t.id}/assign`, { assigneeId: e.target.value })} aria-label="담당 바꾸기">
                    <option value="">담당 바꾸기…</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}{' '}
                {t.can.cancel && <button className="btn-sm btn-plain" onClick={() => { const r = prompt('취소 사유(2자 이상)'); if (r) act('cn', `/admin/office/tasks/${t.id}/cancel`, { reason: r }); }}>취소</button>}
              </div>
              {t.comments.map((c) => <p key={c.id} style={{ fontSize: 13 }}><small className="dim">{ymdhm(c.createdAt)} · {c.author ?? ''}</small> {c.kind === 'COMMENT' ? c.body : <i className="dim">{c.body}</i>}</p>)}
              {t.can.comment && (
                <div className="acts"><input value={cm} onChange={(e) => setCm(e.target.value)} placeholder="댓글" size={40} aria-label="댓글" />{' '}
                  <button className="btn-sm" disabled={!cm.trim() || a.busy === 'cm'} onClick={() => void a.run('cm', () => api(`/admin/office/tasks/${t.id}/comments`, { method: 'POST', body: JSON.stringify({ body: cm }) }), () => { setCm(''); reload(); })} data-ofc-task-comment="">달기</button></div>)}
            </div>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.464 출장 · 여비 정산 ── */
interface Std { perDiem: number; meal: number; lodgingCaps: Record<string, number> }
interface Trip { id: string; traveler: string | null; destination: string; region: string; regionKo: string; purpose: string; departOn: string; returnOn: string; estimate: number;
  basis: Record<string, number>; requisitionId: string; reqState: string; reqStateKo: string; state: string; stateKo: string; claimId: string | null; claimState: string | null;
  mine: boolean; canSettle: boolean; settleBlock: string | null; canCancel: boolean }
interface TripList { view: string; today: string; items: Trip[]; standards: Std; regions: Record<string, string>; canAll: boolean; canEditStandards: boolean; note: string }
const BLANK_TRIP = { destination: '', region: 'OTHER', purpose: '', departOn: kstDay(1), returnOn: kstDay(1), transportEst: '' };

export function OfcTrips() {
  const [view, setView] = useState('mine');
  const q = useApi<TripList>(`/admin/office/trips?view=${view}`, [view]);
  const a = useAct();
  const [nt, setNt] = useState({ ...BLANK_TRIP });
  const [st, setSt] = useState<{ id: string; transport: string; lodging: string; nights: string; memo: string; files: Array<{ fileId: string; name: string }> } | null>(null);
  const [se, setSe] = useState<{ perDiem: string; meal: string; seoul: string; metro: string; other: string; reason: string } | null>(null);
  const d = q.data;
  const days = nt.departOn && nt.returnOn && nt.returnOn >= nt.departOn ? Math.round((Date.parse(nt.returnOn) - Date.parse(nt.departOn)) / 86400e3) + 1 : 0;
  const est = d && days ? d.standards.perDiem * days + d.standards.meal * days + (d.standards.lodgingCaps[nt.region] ?? 0) * (days - 1) + Number(nt.transportEst || 0) : 0;
  const addFile = (f?: File) => f && st && void a.run('file', async () => {
    if (st.files.length >= 3) throw new Error('증빙 파일은 3개까지입니다.');
    const u = await uploadFile(f, 'ACCT_EVIDENCE');
    setSt((x) => (x ? { ...x, files: [...x.files, { fileId: u.fileId, name: u.name }] } : x));
    return { note: `${u.name} 올림` };
  }, undefined, (r) => r.note);
  return (
    <section data-ofc-trips={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p data-ofc-trip-std="">여비 기준 — 일비 <b>{won(d.standards.perDiem)}</b> · 식비 <b>{won(d.standards.meal)}</b> · 숙박 상한 서울 {won(d.standards.lodgingCaps.SEOUL)} · 광역시 {won(d.standards.lodgingCaps.METRO)} · 그 밖 {won(d.standards.lodgingCaps.OTHER)}(1박){' '}
            <small className="dim">일반 원칙 값 · 확인 필요</small>{' '}
            {d.canEditStandards && <button className="btn-sm btn-plain" onClick={() => setSe({ perDiem: String(d.standards.perDiem), meal: String(d.standards.meal), seoul: String(d.standards.lodgingCaps.SEOUL ?? ''), metro: String(d.standards.lodgingCaps.METRO ?? ''), other: String(d.standards.lodgingCaps.OTHER ?? ''), reason: '' })} data-ofc-trip-std-edit="">기준 고치기</button>}
          </p>
          {se && (
            <div className="card pad" data-ofc-trip-std-form="">
              {(['perDiem', 'meal', 'seoul', 'metro', 'other'] as const).map((k) => (
                <label key={k} style={{ marginRight: 8 }}>{({ perDiem: '일비', meal: '식비', seoul: '서울', metro: '광역시', other: '그 밖' } as Record<string, string>)[k]} <input type="number" value={se[k]} onChange={(e) => setSe({ ...se, [k]: e.target.value })} style={{ width: 96 }} /></label>))}
              <input value={se.reason} onChange={(e) => setSe({ ...se, reason: e.target.value })} placeholder="사유(2자 이상)" size={20} />{' '}
              <button className="btn-sm" disabled={se.reason.trim().length < 2 || a.busy === 'std'} onClick={() => void a.run('std', () => api('/admin/office/trip-standards', { method: 'PUT', body: JSON.stringify({ perDiem: Number(se.perDiem), meal: Number(se.meal), seoul: Number(se.seoul), metro: Number(se.metro), other: Number(se.other), reason: se.reason }) }), () => { setSe(null); q.reload(); })}>저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setSe(null)}>닫기</button>
            </div>
          )}
          <div className="card pad" data-ofc-trip-new="">
            <b>출장 신청</b>{' '}
            <input value={nt.destination} onChange={(e) => setNt({ ...nt, destination: e.target.value })} placeholder="가는 곳" size={16} aria-label="가는 곳" />{' '}
            <select value={nt.region} onChange={(e) => setNt({ ...nt, region: e.target.value })} aria-label="지역">{Object.entries(d.regions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
            <input type="date" value={nt.departOn} onChange={(e) => setNt({ ...nt, departOn: e.target.value, returnOn: nt.returnOn < e.target.value ? e.target.value : nt.returnOn })} aria-label="가는 날" />{' '}
            <input type="date" value={nt.returnOn} min={nt.departOn} onChange={(e) => setNt({ ...nt, returnOn: e.target.value })} aria-label="오는 날" />{' '}
            <input type="number" value={nt.transportEst} onChange={(e) => setNt({ ...nt, transportEst: e.target.value })} placeholder="교통비 예상" style={{ width: 110 }} aria-label="교통비 예상" />{' '}
            <input value={nt.purpose} onChange={(e) => setNt({ ...nt, purpose: e.target.value })} placeholder="목적" size={24} aria-label="목적" />{' '}
            <span data-ofc-trip-est={est}>{days ? `${days}일 · 예상 ${won(est)}원` : ''}</span>{' '}
            <button className="btn-sm" disabled={nt.destination.trim().length < 2 || nt.purpose.trim().length < 2 || !days || a.busy === 'nt'} data-ofc-trip-save=""
                    onClick={() => void a.run('nt', () => api('/admin/office/trips', { method: 'POST', body: JSON.stringify({ ...nt, transportEst: Number(nt.transportEst || 0) }) }), () => { setNt({ ...BLANK_TRIP }); q.reload(); })}>신청(품의 올림)</button>
          </div>
          {d.canAll && <div className="acts">{(['mine', 'all'] as const).map((v) => <button key={v} className={`btn-sm${view === v ? '' : ' btn-plain'}`} onClick={() => setView(v)} data-ofc-trip-view={v}>{v === 'mine' ? '내 출장' : '모두'}</button>)}</div>}
          <table className="tbl"><thead><tr><th>번호</th>{view === 'all' && <th>사람</th>}<th>가는 곳</th><th>기간</th><th className="num">예상</th><th>품의</th><th>정산</th><th /></tr></thead>
            <tbody>{d.items.map((t) => (
              <tr key={t.id} data-ofc-trip-row={t.state}>
                <td>{t.id}</td>{view === 'all' && <td>{t.traveler}</td>}<td>{t.destination} <small className="dim">{t.regionKo}</small></td><td>{t.departOn} ~ {t.returnOn}</td>
                <td className="num">{won(t.estimate)}</td><td>{t.requisitionId}번 · {t.reqStateKo}</td>
                <td>{t.stateKo}{t.claimId && <small className="dim"> 경비 청구 {t.claimId}번 · {t.claimState}</small>}{!t.canSettle && t.settleBlock && t.state !== 'CANCELED' && <small className="dim"> · {t.settleBlock}</small>}</td>
                <td>{t.canSettle && <button className="btn-sm" onClick={() => setSt({ id: t.id, transport: '', lodging: '', nights: String(Math.max(0, (t.basis?.days ?? 1) - 1)), memo: '', files: [] })} data-ofc-trip-settle={t.id}>정산</button>}{' '}
                  {t.canCancel && <button className="btn-sm btn-plain" onClick={() => { const r = prompt('취소 사유(2자 이상)'); if (r) void a.run('cn', () => api(`/admin/office/trips/${t.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: r }) }), q.reload); }}>취소</button>}</td></tr>))}</tbody></table>
          {st && (
            <div className="card pad" data-ofc-trip-settle-form={st.id}>
              <b>{st.id}번 여비 정산</b>{' '}
              <input type="number" value={st.transport} onChange={(e) => setSt({ ...st, transport: e.target.value })} placeholder="실제 교통비" style={{ width: 110 }} aria-label="실제 교통비" />{' '}
              <input type="number" value={st.lodging} onChange={(e) => setSt({ ...st, lodging: e.target.value })} placeholder="실제 숙박비 합" style={{ width: 120 }} aria-label="실제 숙박비" />{' '}
              <label>박수 <input type="number" value={st.nights} onChange={(e) => setSt({ ...st, nights: e.target.value })} style={{ width: 56 }} /></label>{' '}
              <input value={st.memo} onChange={(e) => setSt({ ...st, memo: e.target.value })} placeholder="메모" size={18} />{' '}
              <input type="file" onChange={(e) => addFile(e.target.files?.[0])} aria-label="증빙" /> {st.files.map((f) => <small key={f.fileId} className="dim">{f.name} </small>)}
              <button className="btn-sm" disabled={a.busy === 'st'} data-ofc-trip-settle-save=""
                      onClick={() => void a.run('st', () => api(`/admin/office/trips/${st.id}/settle`, { method: 'POST', body: JSON.stringify({ transport: Number(st.transport || 0), lodging: Number(st.lodging || 0), nights: st.nights === '' ? undefined : Number(st.nights), memo: st.memo || null, attachments: st.files.map((f) => f.fileId) }) }), () => { setSt(null); q.reload(); })}>경비 청구로 올리기</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setSt(null)}>닫기</button>
              <p className="muted" style={{ fontSize: 12 }}>일비 · 식비는 날수만큼, 숙박은 실제 금액과 상한 × 박수 중 작은 것, 교통비는 실제 금액 — 신청 때 기준으로 셉니다. 경비 청구는 간이(부가세 0)로 올라가고 SUPER 가 승인합니다.</p>
            </div>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.465 브라우저 알림 ── */
interface NotifyPrefs { global: boolean; pollSec: number; enabled: boolean; kinds: string[]; kindsKo: Record<string, string>; opsAllowed: boolean; note: string }
interface FeedItem { key: string; kind: string; title: string; at: string; tab: string }
const SELF_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'];
const supported = () => typeof window !== 'undefined' && 'Notification' in window;
const seenKey = () => `sgb.ofcNotify.seen.${tokenSub() || 'x'}`;
let memSeen: string[] = [];
const readSeen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(seenKey()) ?? '[]'); return Array.isArray(v) ? v : memSeen; } catch { return memSeen; } };
const writeSeen = (v: string[]) => { memSeen = v.slice(-300); try { localStorage.setItem(seenKey(), JSON.stringify(memSeen)); } catch { /* 저장 막힘 — 메모리만 */ } };
function show(title: string, body: string, tab?: string, tag?: string) {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: tag ?? 'sgb-ofc', icon: '/favicon.ico' });
    n.onclick = () => { window.focus(); goTab(tab); n.close(); };
  } catch { /* 일부 브라우저는 페이지에서 new Notification 을 막음 — 조용히 넘김 */ }
}

export function OfcNotifyBox() {
  const q = useApi<NotifyPrefs>('/admin/me/notify');
  const a = useAct();
  const [perm, setPerm] = useState<string>(supported() ? Notification.permission : 'unsupported');
  const d = q.data;
  const save = async (enabled: boolean, kinds?: string[]) => {
    if (enabled && supported() && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') { a.setErr('브라우저가 알림을 막았습니다 — 주소창 왼쪽 자물쇠 › 알림 › 허용으로 바꾼 뒤 다시 켜십시오.'); return; }
    }
    await a.run('np', () => api('/admin/me/notify', { method: 'PUT', body: JSON.stringify({ enabled, kinds: kinds ?? d?.kinds }) }), () => { q.reload(); window.dispatchEvent(new Event('ofc-notify-changed')); });
  };
  return (
    <section data-ofc-notify={d ? (d.enabled ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          {!d.global && <p className="warn-text" data-ofc-notify-global="off">브라우저 알림이 전체 꺼져 있습니다(정책 › 전체 설정 ofc.browser_notify).</p>}
          <p>이 계정 <b data-ofc-notify-state="">{d.enabled ? '켜짐' : '꺼짐'}</b> · 이 브라우저 허락 <b data-ofc-notify-perm={perm}>{({ granted: '허락함', denied: '막음', default: '아직 묻지 않음', unsupported: '알림을 쓸 수 없는 브라우저' } as Record<string, string>)[perm] ?? perm}</b> · {d.pollSec}초마다 확인</p>
          <div className="acts">
            {d.enabled
              ? <button className="btn-sm btn-plain" disabled={a.busy === 'np'} onClick={() => void save(false)} data-ofc-notify-toggle="off">끄기</button>
              : <button className="btn-sm" disabled={!d.global || perm === 'unsupported' || a.busy === 'np'} onClick={() => void save(true)} data-ofc-notify-toggle="on">켜기</button>}{' '}
            <button className="btn-sm btn-plain" disabled={perm !== 'granted'} onClick={() => show('소개뱅크 운영 — 시험 알림', '이렇게 보입니다. 누르면 이 화면으로 옵니다.', 'ofc-notify', 'sgb-ofc-test')} data-ofc-notify-test="">시험 알림</button>
          </div>
          <p>{Object.entries(d.kindsKo).map(([k, v]) => (
            <label key={k} style={{ marginRight: 12 }} data-ofc-notify-kind={k}>
              <input type="checkbox" checked={d.kinds.includes(k)} disabled={(k === 'OPS' && !d.opsAllowed) || a.busy === 'np'}
                     onChange={(e) => void save(d.enabled, e.target.checked ? [...d.kinds, k] : d.kinds.filter((x) => x !== k))} /> {v}
            </label>))}</p>
          <p className="muted">{d.note} 알림 글에는 금액 · 개인정보를 넣지 않습니다(제목 · 이름까지).</p>
        </>
      )}
    </section>
  );
}

/** Console 에 한 번 — 켠 계정 · 허락한 브라우저 · 화면을 열어 둔 동안만 묻고 띄움(왼쪽 트리 · 상단바와 상관없음) */
export function BrowserNotify() {
  const [cfg, setCfg] = useState<{ on: boolean; sec: number }>({ on: false, sec: 60 });
  const [tick, setTick] = useState(0);
  const staff = tokenRoles().some((r) => SELF_ROLES.includes(r));
  useEffect(() => {
    if (!staff) return;
    const load = () => { api<NotifyPrefs>('/admin/me/notify').then((p) => setCfg({ on: p.global && p.enabled, sec: p.pollSec })).catch(() => setCfg({ on: false, sec: 60 })); };
    load();
    const onChange = () => { load(); setTick((x) => x + 1); };
    window.addEventListener('ofc-notify-changed', onChange);
    return () => window.removeEventListener('ofc-notify-changed', onChange);
  }, [staff]);
  useEffect(() => {
    if (!staff || !cfg.on || !supported() || Notification.permission !== 'granted') return;
    let since: string | undefined;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api<{ on: boolean; now: string; items: FeedItem[] }>(`/admin/me/notify/feed${since ? `?since=${encodeURIComponent(since)}` : ''}`);
        if (stop) return;
        if (!r.on) { setCfg((c) => ({ ...c, on: false })); return; }
        since = r.now;
        const seen = readSeen();
        const fresh = r.items.filter((x) => !seen.includes(x.key));
        if (!fresh.length) return;
        if (fresh.length > 3) show(`소개뱅크 운영 — 새 알림 ${fresh.length}건`, fresh.slice(0, 3).map((x) => x.title).join('\n'), fresh[0]!.tab, 'sgb-ofc-many');
        else for (const x of fresh) show('소개뱅크 운영', x.title, x.tab, x.key);
        writeSeen([...seen, ...fresh.map((x) => x.key)]);
      } catch { /* 로그아웃 · 잠깐 끊김 — 다음 차례에 다시 */ }
    };
    void poll();
    const t = window.setInterval(() => void poll(), Math.max(30, cfg.sec) * 1000);
    return () => { stop = true; window.clearInterval(t); };
  }, [staff, cfg.on, cfg.sec, tick]);
  return null;
}
