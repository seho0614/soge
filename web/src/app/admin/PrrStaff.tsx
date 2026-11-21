/* ===== v10.566 · 568 (docs/708 · 710) 직원 · 권한 › 거둘 후보 · 입사 · 퇴사 — web/src/app/admin/PrrStaff.tsx 새 파일 =====
 * PermReview  분기 권한 정기 점검 — 거둘 후보 표 · 고르기 · 한 번에 거두기(사유) · 둠(메모) · 후보 다시 만들기(SUPER)
 * StaffCases  직원 입사 · 퇴사 흐름 — 목록 · 열기(입사: 직원 고르기 또는 새 직원 / 퇴사: 직원 · 퇴사일) · 단계 · 초대 안내문 · 권한 거두기 · 끝내기 · 취소
 * 서버: /admin/staff/review* · /admin/staff/cases*(보기 ADMIN · 고치기 SUPER) · 고치기 단추는 SUPER 에게만 보임
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { n, useAct, ymd, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { ErrorView } from '../../components/ErrorView';
import { ROLE_LABEL } from './RoleAdmin';

const isSuper = () => tokenRoles().includes('SUPER');
const ask = (q: string, def = '') => { const v = prompt(q, def); return v == null ? null : v.trim(); };

/* ── v10.566 거둘 후보 ─────────────────────────────────────────── */
interface ReviewItem {
  id: string; kind: string; kindKo: string; accountId: string; targetKind: string; target: string; state: string; detail: Record<string, unknown>;
  name: string | null; email: string | null; status: string; lastLoginAt: string | null; employeeName: string | null; leftOn: string | null;
  groupName: string; overrideTask: string | null; blocked: number; decidedAt: string | null; decidedBy: string | null; decideNote: string | null;
}
interface ReviewT {
  quarter: string; current: boolean; built: { lastBuiltAt: string; runs: number } | null; items: ReviewItem[]; open: number; byKind: Record<string, number>;
  kinds: Record<string, string>; idleDays: number; useSince: string; useDays: number; groupIdleReady: boolean; auto: boolean;
  roleReview: { reviewedAt: string | null; reviewedBy: string | null } | null; quarters: Array<{ quarter: string; open: number; revoked: number; kept: number }>; canRevoke: boolean; note: string;
}
const ST_KO: Record<string, string> = { OPEN: '남음', REVOKED: '거둠', KEPT: '둠', GONE: '없어짐' };
const targetKo = (r: ReviewItem) =>
  r.targetKind === 'ROLE' ? `역할 ${ROLE_LABEL[r.target] ?? r.target}` : r.targetKind === 'GROUP' ? `권한그룹 ${r.groupName || r.target}` : `개별 ${r.overrideTask ?? r.target}`;

export function PermReview() {
  const [q, setQ] = useState('');
  const r = useApi<ReviewT>(`/admin/staff/review${q ? `?quarter=${encodeURIComponent(q)}` : ''}`);
  const a = useAct();
  const sup = isSuper();
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState('');
  const [showAll, setShowAll] = useState(false);
  const rows = (r.data?.items ?? []).filter((x) => (showAll || x.state === 'OPEN') && (!kind || x.kind === kind));
  const ids = Object.keys(pick).filter((k) => pick[k]);
  const after = () => { setPick({}); r.reload(); };
  const build = () => void a.run('build', () => api<{ note: string }>('/admin/staff/review/build', { method: 'POST', body: '{}' }), r.reload, (x) => x.note);
  const revoke = () => {
    const why = ask(`고른 후보 ${ids.length}건을 거둡니다(역할 · 권한그룹 · 개별 권한 지움).\n사유를 적어 주십시오(권한 변경 기록에 남습니다)`, `${r.data?.quarter ?? ''} 권한 정기 점검`);
    if (!why) return;
    void a.run('revoke', () => api<{ note: string }>('/admin/staff/review/revoke', { method: 'POST', body: JSON.stringify({ ids, reason: why }) }), after, (x) => x.note);
  };
  const keep = () => {
    const why = ask(`고른 후보 ${ids.length}건을 그대로 둡니다. 메모를 적어 주십시오(고칠 수 없습니다)`);
    if (!why) return;
    void a.run('keep', () => api<{ note: string }>('/admin/staff/review/keep', { method: 'POST', body: JSON.stringify({ ids, note: why }) }), after, (x) => x.note);
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const d = r.data;
  return (
    <section data-perm-review={d?.open ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p>
            <b>{d.quarter}</b> 거둘 후보 <b className={d.open ? 'warn-text' : undefined} data-perm-review-open={d.open}>{d.open}</b>건
            {d.built ? <span className="muted"> · 마지막으로 만든 때 {ymdhm(d.built.lastBuiltAt)}({d.built.runs}번)</span> : <span className="muted"> · 아직 만들지 않음</span>}
            {' · '}분기 점검 기록 {d.roleReview?.reviewedAt ? <span className="st ok">{ymd(d.roleReview.reviewedAt)} {d.roleReview.reviewedBy ?? ''}</span> : <a href="#/role-review" className="warn-text">아직 — 권한 점검에서 남기기</a>}
          </p>
          <p className="muted" data-perm-review-ready={d.groupIdleReady ? 'y' : 'n'}>
            안 쓴 기간 {d.idleDays}일(설정 ops.role_idle_days) · 업무 사용 기록 {d.useSince}부터 {d.useDays}일 · 자동 만들기 {d.auto ? '켜짐' : '꺼짐'}
          </p>
          <p>
            <select value={q} onChange={(e) => { setQ(e.target.value); setPick({}); }} aria-label="분기">
              <option value="">이번 분기</option>
              {d.quarters.map((x) => <option key={x.quarter} value={x.quarter}>{x.quarter} · 남음 {x.open} · 거둠 {x.revoked} · 둠 {x.kept}</option>)}
            </select>{' '}
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류">
              <option value="">종류 모두</option>
              {Object.entries(d.kinds).map(([k, v]) => <option key={k} value={k}>{v} {d.byKind[k] ? `(${d.byKind[k]})` : ''}</option>)}
            </select>{' '}
            <label><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 결정한 것도 보기</label>{' '}
            {sup && d.current && <button className="btn-sm btn-plain" disabled={a.busy === 'build'} onClick={build} data-perm-review-build="">후보 다시 만들기</button>}
          </p>
        </>
      )}
      <div className="ad-tw"><table className="tbl">
        <thead><tr>
          <th>{sup && <input type="checkbox" aria-label="모두 고르기" checked={rows.length > 0 && rows.filter((x) => x.state === 'OPEN').every((x) => pick[x.id])}
            onChange={(e) => setPick(e.target.checked ? Object.fromEntries(rows.filter((x) => x.state === 'OPEN').map((x) => [x.id, true])) : {})} data-perm-review-all="" />}</th>
          <th>종류</th><th>계정</th><th>대상</th><th>근거</th><th className="num">최근 막힘</th><th>상태</th>
        </tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.id} data-perm-review-row={x.id} className={x.state !== 'OPEN' ? 'dim' : undefined}>
            <td>{sup && x.state === 'OPEN' && <input type="checkbox" checked={!!pick[x.id]} onChange={(e) => setPick({ ...pick, [x.id]: e.target.checked })} aria-label={`${x.id} 고르기`} data-perm-review-pick={x.id} />}</td>
            <td><span className={`badge ${x.kind === 'LEFT_STAFF' ? 'badge-urgent' : 'badge-verified'}`}>{x.kindKo}</span></td>
            <td><b>{x.name || '(이름 없음)'}</b> <span className="muted mono">{x.email}</span>{x.employeeName && <small className="muted"> · 직원 {x.employeeName}{x.leftOn ? ` · 퇴사 ${x.leftOn}` : ''}</small>}</td>
            <td>{targetKo(x)}</td>
            <td className="muted">
              {x.kind === 'LOGIN_IDLE' && <>마지막 로그인 {ymd(x.lastLoginAt)}</>}
              {x.kind === 'GROUP_IDLE' && <>붙은 날 {ymd(String(x.detail.grantedAt ?? ''))} · {String(x.detail.idleDays ?? '')}일 안 씀</>}
              {x.kind === 'LEFT_STAFF' && <>퇴사 {String(x.detail.leftOn ?? '')}</>}
              {x.kind === 'EXTERNAL_NO_EXPIRY' && <>기한 없음 · 받은 날 {ymd(String(x.detail.grantedAt ?? ''))}</>}
              {x.kind === 'ROLE_GONE' && <>역할 거둔 때 {ymd(String(x.detail.roleGoneAt ?? ''))}</>}
              {x.kind === 'EXPIRED_LEFTOVER' && <>기한 {ymd(String(x.detail.expiresAt ?? ''))}</>}
            </td>
            <td className="num">{x.blocked ? <span className="warn-text">{n(x.blocked)}</span> : <span className="dim">0</span>}</td>
            <td>{ST_KO[x.state] ?? x.state}{x.decideNote && <small className="muted"> · {x.decideNote}{x.decidedBy ? ` · ${x.decidedBy}` : ''}</small>}</td>
          </tr>))}</tbody>
      </table></div>
      {sup && (
        <p>
          고른 것 <b data-perm-review-picked={ids.length}>{ids.length}</b>건{' '}
          <button className="btn-ok" disabled={!ids.length || a.busy === 'revoke'} onClick={revoke} data-perm-review-revoke="">한 번에 거두기</button>{' '}
          <button className="btn-sm btn-plain" disabled={!ids.length || a.busy === 'keep'} onClick={keep} data-perm-review-keep="">그대로 두기</button>
          {' '}<small className="muted">마지막 SUPER · 자기 자신은 거두지 않습니다(그 줄만 실패).</small>
        </p>
      )}
      {d && <p className="muted">{d.note}</p>}
    </section>
  );
}

/* ── v10.568 입사 · 퇴사 ─────────────────────────────────────────── */
interface CaseItem { id: string; employeeId: string; name: string; kind: string; state: string; targetOn: string; dueOn: string; overdue: boolean; openedAt: string; closedAt: string | null; progress: { done: number; total: number; left: string[] } | null }
interface EmpPick { id: string; name: string; joinedOn: string; leftOn: string | null; linked: boolean; joinOpen: boolean; leaveOpen: boolean }
interface CasesT { items: CaseItem[]; open: number; overdue: number; employees: EmpPick[]; canEdit: boolean; note: string }
interface Step { key: string; ko: string; state: 'DONE' | 'SKIP' | 'TODO'; how: 'AUTO' | 'MANUAL'; manual: boolean; detail: string; go: string | null; note?: string | null; data?: Record<string, unknown> | null }
/** 퇴직금 추계 한 줄(금액은 SUPER 에게만 옴) */
const sevText = (s: Step): string | null => {
  const e = s.data?.estimate as { estimate?: number; ym?: string } | null | undefined;
  return e && typeof e.estimate === 'number' ? ` — 추계 ${n(e.estimate)}원(${e.ym ?? ''} 기준 · 정산은 급여 › 퇴직금)` : null;
};
interface CaseT {
  case: { id: string; kind: string; state: string; targetOn: string; dueOn: string; overdue: boolean; inviteEmail: string | null; invitedAt: string | null; note: string | null; closeNote: string | null };
  employee: { id: string; name: string; joinedOn: string; leftOn: string | null; linked: boolean }; steps: Step[]; left: string[]; canClose: boolean; canEdit: boolean; note: string;
}
const KIND_KO: Record<string, string> = { JOIN: '입사', LEAVE: '퇴사' };
const CST_KO: Record<string, string> = { OPEN: '진행 중', DONE: '끝남', CANCELED: '취소' };
const SST: Record<string, { t: string; c: string }> = { DONE: { t: '됨', c: 'st ok' }, SKIP: { t: '건너뜀', c: 'muted' }, TODO: { t: '남음', c: 'warn-text' } };

export function StaffCases() {
  const l = useApi<CasesT>('/admin/staff/cases');
  const a = useAct();
  const sup = isSuper();
  const [pick, setPick] = useState<string | null>(null);
  const [form, setForm] = useState({ kind: 'JOIN', employeeId: '', name: '', joinedOn: '', monthlyBase: '', leftOn: '', note: '' });
  const open = () => {
    const body: Record<string, unknown> = { kind: form.kind, note: form.note || undefined };
    if (form.employeeId) body.employeeId = form.employeeId;
    if (form.kind === 'JOIN' && !form.employeeId) { body.name = form.name; body.joinedOn = form.joinedOn; body.monthlyBase = Number(form.monthlyBase || 0); }
    if (form.kind === 'LEAVE' && form.leftOn) body.leftOn = form.leftOn;
    void a.run('open', () => api<{ id: string; note: string }>('/admin/staff/cases', { method: 'POST', body: JSON.stringify(body) }),
      () => { setForm({ ...form, employeeId: '', name: '', joinedOn: '', monthlyBase: '', leftOn: '', note: '' }); l.reload(); }, (x) => x.note);
  };
  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  const emps = (l.data?.employees ?? []).filter((e) => (form.kind === 'JOIN' ? !e.joinOpen && !e.leftOn : !e.leaveOpen));
  return (
    <section data-staff-cases={l.data?.open ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {l.data && <p>진행 중 <b>{l.data.open}</b> · 기한 넘김 <b className={l.data.overdue ? 'warn-text' : undefined} data-staff-cases-overdue={l.data.overdue}>{l.data.overdue}</b></p>}
      {sup && l.data && (
        <div className="card" data-staff-case-new="">
          <h3 className="sec">흐름 열기</h3>
          <p>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, employeeId: '' })} aria-label="종류" data-staff-case-kind="">
              <option value="JOIN">입사</option><option value="LEAVE">퇴사</option>
            </select>{' '}
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} aria-label="직원" data-staff-case-emp="">
              <option value="">{form.kind === 'JOIN' ? '새 직원 넣기' : '직원 고르기'}</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name} · 입사 {e.joinedOn}{e.leftOn ? ` · 퇴사 ${e.leftOn}` : ''}{e.linked ? ' · 계정 연결' : ''}</option>)}
            </select>
          </p>
          {form.kind === 'JOIN' && !form.employeeId && (
            <p>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="이름" aria-label="이름" maxLength={40} />{' '}
              입사일 <input type="date" value={form.joinedOn} onChange={(e) => setForm({ ...form, joinedOn: e.target.value })} aria-label="입사일" />{' '}
              <input type="number" min={0} value={form.monthlyBase} onChange={(e) => setForm({ ...form, monthlyBase: e.target.value })} placeholder="월 기본급(원)" aria-label="월 기본급" />
              {' '}<small className="muted">급여 › 직원과 같은 칸 — 주민등록번호 · 계좌는 받지 않습니다.</small>
            </p>
          )}
          {form.kind === 'LEAVE' && (
            <p>퇴사일 <input type="date" value={form.leftOn} onChange={(e) => setForm({ ...form, leftOn: e.target.value })} aria-label="퇴사일" data-staff-case-left="" />{' '}
              <small className="muted">급여 › 직원에 이미 넣었으면 비워 둡니다. 연결 계정에 운영 역할이 남으면 운영 알림이 올라갑니다.</small></p>
          )}
          <p>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="메모(선택)" aria-label="메모" maxLength={200} />{' '}
            <button className="btn-ok" disabled={a.busy === 'open'} onClick={open} data-staff-case-open="">열기</button>
          </p>
        </div>
      )}
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>직원</th><th>종류</th><th>날짜</th><th>기한</th><th>진행</th><th>상태</th></tr></thead>
        <tbody>{(l.data?.items ?? []).map((c) => (
          <tr key={c.id} className={pick === c.id ? 'on' : c.state !== 'OPEN' ? 'dim' : undefined} data-staff-case-row={c.id}>
            <td><button className="linkbtn" onClick={() => setPick(c.id)} data-staff-case-pick={c.id}>{c.name}</button></td>
            <td>{KIND_KO[c.kind] ?? c.kind}</td>
            <td>{c.targetOn}</td>
            <td className={c.overdue ? 'warn-text' : 'muted'}>{c.state === 'OPEN' ? c.dueOn : '—'}{c.overdue && ' 넘김'}</td>
            <td>{c.progress ? `${c.progress.done} / ${c.progress.total}` : '—'}</td>
            <td>{CST_KO[c.state] ?? c.state}{c.closedAt && <small className="muted"> {ymd(c.closedAt)}</small>}</td>
          </tr>))}</tbody>
      </table></div>
      {pick && <StaffCaseDetail id={pick} onDone={l.reload} />}
      {l.data && <p className="muted">{l.data.note}</p>}
    </section>
  );
}

function StaffCaseDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const d = useApi<CaseT>(`/admin/staff/cases/${id}`);
  const a = useAct();
  const [guide, setGuide] = useState<string | null>(null);
  const re = () => { d.reload(); onDone(); };
  if (d.error) return <ErrorView error={d.error} onRetry={d.reload} />;
  if (!d.data) return <p className="muted">불러오는 중…</p>;
  const c = d.data.case, ed = d.data.canEdit;
  const invite = () => {
    const em = ask('운영 계정으로 쓸 메일 주소(본인이 사용자 웹에 이 메일로 가입합니다)');
    if (!em) return;
    void a.run('invite', () => api<{ note: string; guide: string }>(`/admin/staff/cases/${id}/invite`, { method: 'POST', body: JSON.stringify({ email: em }) }),
      re, (x) => { setGuide(x.guide); return x.note; });
  };
  const mark = (s: Step, action: 'DONE' | 'SKIP') => {
    const note = action === 'SKIP' ? ask(`「${s.ko}」 단계를 건너뜁니다. 사유를 적어 주십시오`) : ask(`「${s.ko}」 단계를 「됨」으로 적습니다. 메모(선택)`, '');
    if (note == null || (action === 'SKIP' && !note)) return;
    void a.run(`s${s.key}`, () => api<{ note: string }>(`/admin/staff/cases/${id}/steps/${s.key}`, { method: 'PUT', body: JSON.stringify({ action, note }) }), re, (x) => x.note);
  };
  const undo = (s: Step) => void a.run(`u${s.key}`, () => api<{ note: string }>(`/admin/staff/cases/${id}/steps/${s.key}`, { method: 'DELETE' }), re, (x) => x.note);
  const revoke = () => {
    const why = ask(`${d.data!.employee.name} 님 계정의 운영 역할 · 권한그룹 · 개별 권한을 모두 거둡니다. 사유를 적어 주십시오`, '퇴사');
    if (!why) return;
    void a.run('revoke', () => api<{ note: string }>(`/admin/staff/cases/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: why }) }), re, (x) => x.note);
  };
  const close = () => void a.run('close', () => api<{ note: string }>(`/admin/staff/cases/${id}/close`, { method: 'POST', body: '{}' }), re, (x) => x.note);
  const cancel = () => {
    const why = ask('흐름을 취소합니다(퇴사일 · 거둔 권한은 그대로). 사유를 적어 주십시오');
    if (!why) return;
    void a.run('cancel', () => api<{ note: string }>(`/admin/staff/cases/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: why }) }), re, (x) => x.note);
  };
  return (
    <div className="card" data-staff-case={id}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">{d.data.employee.name} — {KIND_KO[c.kind]} 흐름 <small className="muted">{CST_KO[c.state]} · {c.targetOn} · 기한 {c.dueOn}{c.overdue ? ' 넘김' : ''}</small></h3>
      <table className="tbl" data-staff-case-steps={d.data.steps.length}><tbody>{d.data.steps.map((s) => (
        <tr key={s.key} data-staff-step={s.key} data-staff-step-state={s.state}>
          <td><b>{s.ko}</b> <small className="muted">{s.how === 'AUTO' ? '저절로' : '손으로'}</small></td>
          <td><span className={SST[s.state]?.c}>{SST[s.state]?.t}</span>{s.note && <small className="muted"> · {s.note}</small>}</td>
          <td className="muted">{s.detail}
            {s.key === 'ASSETS' && Array.isArray(s.data?.assets) && (s.data!.assets as Array<{ id: string; name: string; assetTag: string | null }>).length > 0 &&
              <> — {(s.data!.assets as Array<{ id: string; name: string; assetTag: string | null }>).map((x) => `${x.name}${x.assetTag ? `(${x.assetTag})` : ''}`).join(' · ')}</>}
            {s.key === 'SEVERANCE' && sevText(s)}
            {s.key === 'DOCS' && Array.isArray(s.data?.docs) && (
              <ul className="plain" data-staff-docs="">{(s.data!.docs as Array<{ doc: string; law: string; years: number; keepUntil: string | null }>).map((x) => <li key={x.doc}>{x.doc} — {x.law} {x.years}년 · {x.keepUntil ?? '퇴사일 뒤'}까지</li>)}</ul>
            )}
          </td>
          <td>
            {s.go && <a href={`#/${s.go}`} className="btn-sm btn-plain">자세히</a>}{' '}
            {ed && s.key === 'INVITE' && s.state === 'TODO' && <button className="btn-sm" disabled={a.busy === 'invite'} onClick={invite} data-staff-invite="">초대 메일 적기</button>}
            {ed && s.key === 'ROLES' && s.state === 'TODO' && <button className="btn-sm" disabled={a.busy === 'revoke'} onClick={revoke} data-staff-case-revoke="">권한 모두 거두기</button>}
            {ed && s.how === 'MANUAL' && s.state === 'TODO' && s.key !== 'INVITE' && <button className="btn-sm" disabled={a.busy === `s${s.key}`} onClick={() => mark(s, 'DONE')} data-staff-step-done={s.key}>확인함</button>}
            {ed && s.state === 'TODO' && !['EMPLOYEE', 'LEFT_ON'].includes(s.key) && <button className="btn-sm btn-plain" disabled={a.busy === `s${s.key}`} onClick={() => mark(s, 'SKIP')} data-staff-step-skip={s.key}>건너뛰기</button>}
            {ed && s.manual && <button className="btn-sm btn-plain" disabled={a.busy === `u${s.key}`} onClick={() => undo(s)} data-staff-step-undo={s.key}>되돌리기</button>}
          </td>
        </tr>))}</tbody></table>
      {guide && <p className="card" data-staff-invite-guide=""><b>안내문(복사해 전하십시오)</b><br />{guide}</p>}
      {c.inviteEmail && <p className="muted">초대 메일 {c.inviteEmail} · {ymdhm(c.invitedAt)}</p>}
      {ed && (
        <p>
          <button className="btn-ok" disabled={!d.data.canClose || a.busy === 'close'} onClick={close} data-staff-case-close="">흐름 끝내기</button>{' '}
          <button className="btn-sm btn-plain" disabled={a.busy === 'cancel'} onClick={cancel} data-staff-case-cancel="">취소</button>
          {!d.data.canClose && <small className="muted"> 남은 단계 {d.data.left.length}개</small>}
        </p>
      )}
      {c.closeNote && <p className="muted">끝낸 메모: {c.closeNote}</p>}
      <p className="muted">{d.data.note}</p>
    </div>
  );
}
