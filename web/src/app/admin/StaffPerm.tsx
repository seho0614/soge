/* ===== v10.561 ~ 564 (D291 · docs/703 ~ 706) 직원 · 권한 — web/src/app/admin/StaffPerm.tsx 새 파일 =====
 * 운영 화면 「직원 · 권한」 그룹(키 acl): 운영자 목록 · 사원 권한 · 권한그룹 · 업무그룹 · 업무 목록 · (업무별 권한 › 판정 방식) · 바뀐 기록
 * 서버: /admin/staff(운영자 목록 · ADMIN 읽기) · /admin/perm/*(권한 관리 · SUPER) · /admin/reports/roles/changes(역할 기록 · ADMIN)
 * 회원 목록과 나눔(A안) — 운영자는 여기서 보고, 역할은 「역할 주기」에서, 업무 권한은 「사원 권한」에서 줍니다.
 */
import { useMemo, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymd, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { ErrorView } from '../../components/ErrorView';
import { TABS, tabLabel, type Tab } from '../../lib/adminMenu';
import { ROLE_LABEL } from './RoleAdmin';

const LV = ['VIEW', 'EDIT', 'APPROVE', 'EXPORT'] as const;
const LV_KO: Record<string, string> = { VIEW: '보기', EDIT: '고치기', APPROVE: '승인', EXPORT: '내려받기' };
const isSuper = () => tokenRoles().includes('SUPER');
const ask = (q: string, def = '') => { const v = prompt(q, def); return v == null ? null : v.trim(); };

/* ── v10.561 운영자 목록 ───────────────────────────────────────── */
interface StaffRow {
  id: string; name: string | null; email: string | null; status: string; roles: string[]; expiresAt: string | null; external: boolean;
  employeeId: string | null; employeeName: string | null; joinedOn: string | null; leftOn: string | null; mfa: boolean; lastLoginAt: string | null; groups: number;
  noEmployee: boolean; leftWithRole: boolean; externalNoExpiry: boolean;
}
interface StaffT { items: StaffRow[]; total: number; noEmployee: number; leftWithRole: number; noMfa: number; note: string }

export function StaffList() {
  const s = useApi<StaffT>('/admin/staff');
  const a = useAct();
  const sup = isSuper();
  const [q, setQ] = useState('');
  const rows = (s.data?.items ?? []).filter((r) => !q.trim() || `${r.name ?? ''} ${r.email ?? ''} ${r.employeeName ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const revoke = (r: StaffRow) => {
    const why = ask(`${r.name ?? r.email} 님의 운영 역할(${r.roles.map((x) => ROLE_LABEL[x] ?? x).join(', ')})을 모두 거둡니다.\n사유를 적어 주십시오(기록에 남습니다)`);
    if (!why) return;
    void a.run(`rv${r.id}`, () => api<{ note: string }>(`/admin/staff/${r.id}/revoke-all`, { method: 'POST', body: JSON.stringify({ reason: why }) }), s.reload, (x) => x.note);
  };
  if (s.error) return <ErrorView error={s.error} onRetry={s.reload} />;
  return (
    <section data-staff-list={s.data?.total ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {s.data && (
        <p>
          운영자 <b>{s.data.total}</b>명 · 직원 연결 없음 <b data-staff-noemp={s.data.noEmployee}>{s.data.noEmployee}</b> · 퇴사했는데 역할 남음 <b className={s.data.leftWithRole ? 'warn-text' : undefined} data-staff-left={s.data.leftWithRole}>{s.data.leftWithRole}</b> · 2단계 안 함 {s.data.noMfa}{' '}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 메일 · 직원" aria-label="운영자 찾기" />{' '}
          <a href="#/roles" className="btn-sm btn-plain" data-staff-go-roles="">역할 주기로</a>
        </p>
      )}
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>계정</th><th>역할</th><th>기한</th><th>연결 직원</th><th>2단계</th><th>마지막 로그인</th><th>권한그룹</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={r.status !== 'ACTIVE' ? 'dim' : undefined} data-staff-row={r.id}>
            <td><b>{r.name || '(이름 없음)'}</b> <span className="muted mono">{r.email}</span>{r.status !== 'ACTIVE' && <small className="muted"> · {r.status}</small>}</td>
            <td>{r.roles.map((x) => <span key={x} className={`badge ${x === 'SUPER' ? 'badge-urgent' : 'badge-verified'}`}>{ROLE_LABEL[x] ?? x} </span>)}{r.external && <small className="muted"> 외부</small>}</td>
            <td>{r.expiresAt ? ymd(r.expiresAt) : <span className="dim">—</span>}{r.externalNoExpiry && <small className="warn-text"> 기한 없음</small>}</td>
            <td>{r.employeeId ? <>{r.employeeName} <small className="muted">{r.joinedOn}{r.leftOn ? ` ~ ${r.leftOn}` : ''}</small>{r.leftWithRole && <small className="warn-text" data-staff-leftrow=""> 퇴사 · 역할 남음</small>}</>
              : <span className="warn-text" data-staff-noemp-row="">직원 연결 없음</span>}</td>
            <td>{r.mfa ? <span className="st ok">등록</span> : <span className="muted">안 함</span>}</td>
            <td className="muted">{ymdhm(r.lastLoginAt)}</td>
            <td className="num">{r.groups}</td>
            <td>{sup && <button className="btn-sm btn-plain" disabled={a.busy === `rv${r.id}`} onClick={() => revoke(r)} data-staff-revoke={r.id}>역할 모두 거두기</button>}</td>
          </tr>))}</tbody>
      </table></div>
      {s.data && <p className="muted">{s.data.note}</p>}
    </section>
  );
}

/* ── v10.563 사원 권한 ─────────────────────────────────────────── */
interface PermStaffRow { id: string; name: string; email: string; status: string; roles: string[]; groups: Array<{ key: string; expiresAt: string | null }>; overrides: number; tasks: number; employeeName: string | null; conflicts: string[] }
interface RoleGroupRow { key: string; name: string; kind: string; fromRole: string | null; active: boolean; items: number; people: number }
interface Overview { roleGroups: RoleGroupRow[]; tasks: Array<{ key: string; name: string }> }
interface AccDetail { account: { id: string; name: string; email: string; roles: string[]; kind: string }; groups: Array<{ key: string; expiresAt: string | null }>;
  overrides: Array<{ taskKey: string; level: string; effect: string; expiresAt: string | null; reason: string }>; preview: Record<string, string[]> }

export function PermStaff() {
  const l = useApi<{ items: PermStaffRow[]; note: string }>('/admin/perm/staff');
  const ov = useApi<Overview>('/admin/perm/overview');
  const [pick, setPick] = useState<string | null>(null);
  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  return (
    <section data-perm-staff={l.data?.items.length ?? ''}>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>사원</th><th>역할</th><th>권한그룹(기한)</th><th className="num">개별</th><th className="num">업무</th><th>조합</th></tr></thead>
        <tbody>{(l.data?.items ?? []).map((r) => (
          <tr key={r.id} className={pick === r.id ? 'on' : undefined}>
            <td><button className="linkbtn" onClick={() => setPick(r.id)} data-perm-staff-open={r.id}>{r.name || r.email}</button>{!r.employeeName && <small className="muted"> 직원 연결 없음</small>}</td>
            <td>{r.roles.map((x) => ROLE_LABEL[x] ?? x).join(', ')}</td>
            <td>{r.groups.map((g) => `${g.key}${g.expiresAt ? `(${ymd(g.expiresAt)})` : ''}`).join(' · ') || <span className="dim">—</span>}</td>
            <td className="num">{r.overrides}</td><td className="num">{r.tasks}</td>
            <td>{r.conflicts.length ? <span className="warn-text" data-perm-staff-conflict={r.id}>어긋남 {r.conflicts.join(', ')}</span> : <span className="dim">—</span>}</td>
          </tr>))}</tbody>
      </table></div>
      {pick && ov.data && <PermStaffEdit id={pick} groups={ov.data.roleGroups} tasks={ov.data.tasks} onDone={l.reload} />}
      {l.data && <p className="muted">{l.data.note}</p>}
    </section>
  );
}

function PermStaffEdit({ id, groups, tasks, onDone }: { id: string; groups: RoleGroupRow[]; tasks: Array<{ key: string; name: string }>; onDone: () => void }) {
  const d = useApi<AccDetail>(`/admin/perm/accounts/${id}`);
  const a = useAct();
  const [sel, setSel] = useState<Record<string, string> | null>(null);   // 권한그룹 키 → 기한(빈 글자 = 없음)
  const [ovs, setOvs] = useState<AccDetail['overrides'] | null>(null);
  const [add, setAdd] = useState({ taskKey: '', level: 'VIEW', effect: 'ALLOW' });
  const cur = sel ?? Object.fromEntries((d.data?.groups ?? []).map((g) => [g.key, g.expiresAt ? g.expiresAt.slice(0, 10) : '']));
  const curOv = ovs ?? d.data?.overrides ?? [];
  const toggle = (k: string) => { const n = { ...cur }; if (k in n) delete n[k]; else n[k] = ''; setSel(n); };
  const save = () => {
    const reason = ask('사원 권한을 저장합니다. 사유를 적어 주십시오'); if (!reason) return;
    void a.run('save', () => api<{ note: string }>(`/admin/perm/accounts/${id}`, { method: 'PUT', body: JSON.stringify({
      kind: d.data?.account.kind, reason,
      groups: Object.entries(cur).map(([key, e]) => ({ key, expiresAt: e || null })),
      overrides: curOv.map((o) => ({ taskKey: o.taskKey, level: o.level, effect: o.effect, expiresAt: o.expiresAt, reason: o.reason || reason })) }) }),
      () => { setSel(null); setOvs(null); d.reload(); onDone(); }, (r) => r.note);
  };
  if (d.error) return <ErrorView error={d.error} onRetry={d.reload} />;
  if (!d.data) return <p className="muted">불러오는 중…</p>;
  return (
    <div className="card" data-perm-staff-edit={id}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">{d.data.account.name || d.data.account.email} <small className="muted">{d.data.account.roles.join(', ')} · {d.data.account.kind}</small></h3>
      <p><b>권한그룹</b></p>
      <ul className="plain">{groups.filter((g) => g.active || g.key in cur).map((g) => (
        <li key={g.key}><label><input type="checkbox" checked={g.key in cur} onChange={() => toggle(g.key)} data-perm-staff-group={g.key} /> {g.name} <small className="muted">{g.key}{g.fromRole ? ` · 역할 ${g.fromRole} 처음 그룹` : ''}</small></label>
          {g.key in cur && <> 기한 <input type="date" value={cur[g.key] ?? ''} onChange={(e) => setSel({ ...cur, [g.key]: e.target.value })} aria-label={`${g.name} 기한`} /></>}</li>))}</ul>
      <p><b>개별 더하기 · 빼기</b></p>
      <table className="tbl"><tbody>{curOv.map((o, i) => (
        <tr key={`${o.taskKey}${o.level}`}><td>{tabLabel(o.taskKey as Tab)} <small className="muted">{o.taskKey}</small></td><td>{LV_KO[o.level]}</td><td>{o.effect === 'ALLOW' ? '더하기' : '빼기'}</td><td>{o.expiresAt ? ymd(o.expiresAt) : ''}</td>
          <td><button className="btn-sm btn-plain" onClick={() => setOvs(curOv.filter((_, j) => j !== i))}>지우기</button></td></tr>))}</tbody></table>
      <p>
        <select value={add.taskKey} onChange={(e) => setAdd({ ...add, taskKey: e.target.value })} aria-label="업무"><option value="">업무 고르기</option>{tasks.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.key})</option>)}</select>{' '}
        <select value={add.level} onChange={(e) => setAdd({ ...add, level: e.target.value })} aria-label="수준">{LV.map((x) => <option key={x} value={x}>{LV_KO[x]}</option>)}</select>{' '}
        <select value={add.effect} onChange={(e) => setAdd({ ...add, effect: e.target.value })} aria-label="더하기 빼기"><option value="ALLOW">더하기</option><option value="DENY">빼기</option></select>{' '}
        <button className="btn-sm" disabled={!add.taskKey} onClick={() => setOvs([...curOv.filter((o) => !(o.taskKey === add.taskKey && o.level === add.level)), { ...add, expiresAt: null, reason: '' }])}>넣기</button>
      </p>
      <p><button className="btn-ok" disabled={a.busy === 'save'} onClick={save} data-perm-staff-save="">저장</button> <small className="muted">함께 못 갖는 조합(정산 승인 ↔ 지급 실행 등)이면 저장되지 않습니다.</small></p>
      <details><summary>실제 권한 미리보기 {Object.keys(d.data.preview).length}개 업무</summary>
        <table className="tbl" data-perm-staff-preview=""><tbody>{Object.entries(d.data.preview).map(([t, ls]) => <tr key={t}><td>{tabLabel(t as Tab)} <small className="muted">{t}</small></td><td>{ls.map((x) => LV_KO[x] ?? x).join(' · ')}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

/* ── v10.562 권한그룹(업무그룹 × 수준) ─────────────────────────── */
interface TGroup { key: string; name: string; active: boolean; tasks: string[]; menuGroup: boolean; roleGroups: number; note: string | null; sort: number }
interface SetsT { group: { key: string; name: string; kind: string; fromRole: string | null; note: string | null; active: boolean }; sets: Array<{ taskGroupKey: string; level: string }>;
  items: Array<{ taskKey: string; level: string; effect: string }>; preview: Record<string, string[]>; tasks: number; conflicts: Array<{ code: string; name: string }> }
interface RuleT { code: string; name: string; note: string | null; active: boolean; a: string[]; b: string[] }

export function PermRoles() {
  const ov = useApi<Overview>('/admin/perm/overview');
  const tg = useApi<{ items: TGroup[] }>('/admin/perm/task-groups');
  const cf = useApi<{ items: RuleT[]; note: string }>('/admin/perm/conflicts');
  const [pick, setPick] = useState<string | null>(null);
  const a = useAct();
  const newGroup = () => { const k = ask('새 권한그룹 키(대문자 · 숫자 · 밑줄 · 예 ACCT_STAFF)'); if (k && /^[A-Z][A-Z0-9_]{1,40}$/.test(k)) setPick(k); else if (k) a.setErr('키는 대문자 · 숫자 · 밑줄입니다.'); };
  const editRule = (r?: RuleT) => {
    const code = r?.code ?? ask('규칙 코드(대문자 · 숫자 · 밑줄)'); if (!code) return;
    const name = ask('규칙 이름', r?.name ?? ''); if (!name) return;
    const A = ask('A 쪽 「업무:수준」(쉼표로)', (r?.a ?? []).join(', ')); if (A == null) return;
    const B = ask('B 쪽 「업무:수준」(쉼표로)', (r?.b ?? []).join(', ')); if (B == null) return;
    const reason = ask('사유'); if (!reason) return;
    const sp = (x: string) => x.split(',').map((y) => y.trim()).filter(Boolean);
    void a.run(`cf${code}`, () => api<{ note: string }>(`/admin/perm/conflicts/${code}`, { method: 'PUT', body: JSON.stringify({ name, a: sp(A), b: sp(B), reason, active: r?.active ?? true }) }), cf.reload, (x) => x.note);
  };
  return (
    <section data-perm-roles={ov.data?.roleGroups.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>{(ov.data?.roleGroups ?? []).map((g) => (
        <button key={g.key} className={pick === g.key ? 'btn-sm' : 'btn-sm ghost'} onClick={() => setPick(g.key)} data-perm-role-open={g.key}>{g.name} <small>{g.people}명</small></button>))}{' '}
        <button className="btn-sm btn-plain" onClick={newGroup} data-perm-role-new="">새 권한그룹</button></p>
      {pick && tg.data && <RoleSetsEdit key={pick} groupKey={pick} taskGroups={tg.data.items} tasks={ov.data?.tasks ?? []} onDone={ov.reload} />}
      <h3>함께 못 갖는 조합</h3>
      <table className="tbl" data-perm-conflicts={cf.data?.items.length ?? ''}><thead><tr><th>규칙</th><th>A 쪽</th><th>B 쪽</th><th>켜짐</th><th /></tr></thead>
        <tbody>{(cf.data?.items ?? []).map((r) => <tr key={r.code}><td>{r.name} <small className="muted">{r.code}</small></td><td>{r.a.join(', ')}</td><td>{r.b.join(', ')}</td><td>{r.active ? '켬' : '끔'}</td>
          <td><button className="btn-sm btn-plain" onClick={() => editRule(r)}>고치기</button></td></tr>)}</tbody></table>
      <p><button className="btn-sm btn-plain" onClick={() => editRule()}>규칙 더하기</button></p>
      {cf.data && <p className="muted">{cf.data.note}</p>}
    </section>
  );
}

function RoleSetsEdit({ groupKey, taskGroups, tasks, onDone }: { groupKey: string; taskGroups: TGroup[]; tasks: Array<{ key: string; name: string }>; onDone: () => void }) {
  const d = useApi<SetsT>(`/admin/perm/role-groups/${groupKey}/sets`);
  const a = useAct();
  const isNew = !!d.error;
  const [sets, setSets] = useState<Set<string> | null>(null);
  const [items, setItems] = useState<SetsT['items'] | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [add, setAdd] = useState({ taskKey: '', level: 'VIEW', effect: 'ALLOW' });
  const curSets = sets ?? new Set((d.data?.sets ?? []).map((s) => `${s.taskGroupKey}:${s.level}`));
  const curItems = items ?? d.data?.items ?? [];
  const flip = (k: string) => { const n = new Set(curSets); if (n.has(k)) n.delete(k); else n.add(k); setSets(n); };
  const save = () => {
    const reason = ask('권한그룹을 저장합니다. 사유를 적어 주십시오'); if (!reason) return;
    void a.run('save', () => api<{ note: string }>(`/admin/perm/role-groups/${groupKey}/sets`, { method: 'PUT', body: JSON.stringify({
      name: name ?? d.data?.group.name ?? groupKey, kind: d.data?.group.kind ?? 'STAFF', reason,
      sets: [...curSets].map((k) => { const [taskGroupKey, level] = k.split(':'); return { taskGroupKey, level }; }), items: curItems }) }),
      () => { setSets(null); setItems(null); d.reload(); onDone(); }, (r) => r.note);
  };
  return (
    <div className="card" data-perm-role-edit={groupKey}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">{isNew ? '새 권한그룹' : '권한그룹'} {groupKey} <input value={name ?? d.data?.group.name ?? ''} onChange={(e) => setName(e.target.value)} placeholder="이름" aria-label="권한그룹 이름" />
        {d.data?.group.fromRole && <small className="muted"> 역할 {d.data.group.fromRole} 처음 그룹(역할을 받으면 저절로 붙음)</small>}</h3>
      <div className="ad-tw"><table className="tbl" data-perm-role-sets="">
        <thead><tr><th>업무그룹</th>{LV.map((x) => <th key={x}>{LV_KO[x]}</th>)}</tr></thead>
        <tbody>{taskGroups.map((g) => (
          <tr key={g.key} className={g.active ? undefined : 'dim'}><td>{g.name} <small className="muted">{g.key} · 업무 {g.tasks.length}</small></td>
            {LV.map((x) => <td key={x}><input type="checkbox" checked={curSets.has(`${g.key}:${x}`)} onChange={() => flip(`${g.key}:${x}`)} aria-label={`${g.name} ${LV_KO[x]}`} data-perm-set={`${g.key}:${x}`} /></td>)}</tr>))}</tbody>
      </table></div>
      <p><b>업무 하나씩 더하기 · 빼기</b></p>
      <table className="tbl"><tbody>{curItems.map((o, i) => (
        <tr key={`${o.taskKey}${o.level}`}><td>{tabLabel(o.taskKey as Tab)} <small className="muted">{o.taskKey}</small></td><td>{LV_KO[o.level]}</td><td>{o.effect === 'DENY' ? '빼기' : '더하기'}</td>
          <td><button className="btn-sm btn-plain" onClick={() => setItems(curItems.filter((_, j) => j !== i))}>지우기</button></td></tr>))}</tbody></table>
      <p>
        <select value={add.taskKey} onChange={(e) => setAdd({ ...add, taskKey: e.target.value })} aria-label="업무"><option value="">업무 고르기</option>{tasks.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.key})</option>)}</select>{' '}
        <select value={add.level} onChange={(e) => setAdd({ ...add, level: e.target.value })} aria-label="수준">{LV.map((x) => <option key={x} value={x}>{LV_KO[x]}</option>)}</select>{' '}
        <select value={add.effect} onChange={(e) => setAdd({ ...add, effect: e.target.value })} aria-label="더하기 빼기"><option value="ALLOW">더하기</option><option value="DENY">빼기</option></select>{' '}
        <button className="btn-sm" disabled={!add.taskKey} onClick={() => setItems([...curItems.filter((o) => !(o.taskKey === add.taskKey && o.level === add.level)), { ...add }])}>넣기</button>
      </p>
      <p><button className="btn-ok" disabled={a.busy === 'save'} onClick={save} data-perm-role-save="">저장</button></p>
      {d.data && (
        <details><summary>실제 여는 업무 {d.data.tasks}개{d.data.conflicts.length ? ` · 조합 어긋남 ${d.data.conflicts.map((c) => c.name).join(', ')}` : ''}</summary>
          <table className="tbl" data-perm-role-preview={d.data.tasks}><tbody>{Object.entries(d.data.preview).map(([t, ls]) => <tr key={t}><td>{tabLabel(t as Tab)} <small className="muted">{t}</small></td><td>{ls.map((x) => LV_KO[x] ?? x).join(' · ')}</td></tr>)}</tbody></table>
        </details>
      )}
    </div>
  );
}

/* ── v10.562 업무그룹 ─────────────────────────────────────────── */
export function PermGroups() {
  const tg = useApi<{ items: TGroup[]; note: string }>('/admin/perm/task-groups');
  const tk = useApi<{ items: Array<{ key: string; name: string }> }>('/admin/perm/tasks');
  const [pick, setPick] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string> | null>(null);
  const a = useAct();
  const g = (tg.data?.items ?? []).find((x) => x.key === pick);
  const cur = sel ?? new Set(g?.tasks ?? []);
  const save = (active?: boolean) => {
    if (!pick) return;
    const name = g?.name ?? ask('업무그룹 이름'); if (!name) return;
    const reason = ask('사유'); if (!reason) return;
    void a.run('save', () => api<{ note: string }>(`/admin/perm/task-groups/${pick}`, { method: 'PUT', body: JSON.stringify({ name, active: active ?? g?.active ?? true, tasks: [...cur], reason }) }),
      () => { setSel(null); tg.reload(); }, (r) => r.note);
  };
  const create = () => { const k = ask('새 업무그룹 키(소문자 · 숫자 · 밑줄 · 예 money_view)'); if (k && /^[a-z][a-z0-9_]{1,30}$/.test(k)) { setPick(k); setSel(new Set()); } else if (k) a.setErr('키는 소문자 · 숫자 · 밑줄입니다.'); };
  if (tg.error) return <ErrorView error={tg.error} onRetry={tg.reload} />;
  return (
    <section data-perm-groups={tg.data?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>{(tg.data?.items ?? []).map((x) => (
        <button key={x.key} className={pick === x.key ? 'btn-sm' : 'btn-sm ghost'} onClick={() => { setPick(x.key); setSel(null); }} data-perm-group-open={x.key}>
          {x.name} <small>{x.tasks.length}{x.active ? '' : ' · 끔'}</small></button>))}{' '}
        <button className="btn-sm btn-plain" onClick={create} data-perm-group-new="">새 업무그룹</button></p>
      {pick && (
        <div className="card" data-perm-group-edit={pick}>
          <h3 className="sec">{g?.name ?? '새 업무그룹'} <small className="muted">{pick}{g?.menuGroup ? ' · 메뉴 그룹(지우지 않음)' : ''} · 쓰는 권한그룹 {g?.roleGroups ?? 0}</small></h3>
          <ul className="plain ad-cols">{(tk.data?.items ?? []).map((t) => (
            <li key={t.key}><label><input type="checkbox" checked={cur.has(t.key)} onChange={() => { const n = new Set(cur); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); setSel(n); }} data-perm-group-task={t.key} /> {t.name} <small className="muted">{t.key}</small></label></li>))}</ul>
          <p><button className="btn-ok" disabled={a.busy === 'save'} onClick={() => save()} data-perm-group-save="">저장</button>{' '}
            {g && <button className="btn-sm btn-plain" onClick={() => save(!g.active)}>{g.active ? '끄기' : '켜기'}</button>}</p>
        </div>
      )}
      {tg.data && <p className="muted">{tg.data.note}</p>}
    </section>
  );
}

/* ── v10.562 업무 목록 ─────────────────────────────────────────── */
interface TaskRow { key: string; name: string; description: string | null; menuGroup: string; levels: string[]; active: boolean; groups: string[]; routes: number; roleGroups: number }
export function PermTasks() {
  const t = useApi<{ items: TaskRow[]; noRoute: number; note: string }>('/admin/perm/tasks');
  const a = useAct();
  const [only, setOnly] = useState<'all' | 'noroute' | 'missing'>('all');
  const have = useMemo(() => new Set((t.data?.items ?? []).map((x) => x.key)), [t.data]);
  const missing = TABS.map(([k]) => k).filter((k) => !have.has(k));
  const edit = (x: TaskRow) => {
    const name = ask(`${x.key} 이름`, x.name); if (!name) return;
    const description = ask('설명(비우면 없음)', x.description ?? ''); if (description == null) return;
    const lv = ask('쓸 수 있는 수준(VIEW, EDIT, APPROVE, EXPORT 중 쉼표로)', x.levels.join(', ')); if (!lv) return;
    const reason = ask('사유'); if (!reason) return;
    void a.run(`e${x.key}`, () => api<{ note: string }>(`/admin/perm/tasks/${x.key}`, { method: 'PUT', body: JSON.stringify({ name, description, levels: lv.split(',').map((y) => y.trim().toUpperCase()).filter(Boolean), reason }) }), t.reload, (r) => r.note);
  };
  const onoff = (x: TaskRow) => { const reason = ask(`${x.name} 업무를 ${x.active ? '끕니다' : '켭니다'} — 사유`); if (reason) void a.run(`o${x.key}`, () => api<{ note: string }>(`/admin/perm/tasks/${x.key}`, { method: 'PUT', body: JSON.stringify({ active: !x.active, reason }) }), t.reload, (r) => r.note); };
  const create = (k: string) => {
    const groupKey = ask(`${k} 업무를 넣을 기본 메뉴 그룹 키(예 acl · admacc)`); if (!groupKey) return;
    const reason = ask('사유'); if (!reason) return;
    void a.run(`c${k}`, () => api<{ note: string }>('/admin/perm/tasks', { method: 'POST', body: JSON.stringify({ key: k, name: tabLabel(k as Tab), groupKey, reason }) }), t.reload, (r) => r.note);
  };
  if (t.error) return <ErrorView error={t.error} onRetry={t.reload} />;
  const rows = (t.data?.items ?? []).filter((x) => only !== 'noroute' || x.routes === 0);
  return (
    <section data-perm-tasks={t.data?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <button className={only === 'all' ? 'btn-sm' : 'btn-sm ghost'} onClick={() => setOnly('all')}>모두 {t.data?.items.length ?? 0}</button>{' '}
        <button className={only === 'noroute' ? 'btn-sm' : 'btn-sm ghost'} onClick={() => setOnly('noroute')} data-perm-tasks-noroute={t.data?.noRoute ?? ''}>주소 연결 없음 {t.data?.noRoute ?? 0}</button>{' '}
        <button className={only === 'missing' ? 'btn-sm' : 'btn-sm ghost'} onClick={() => setOnly('missing')} data-perm-tasks-missing={missing.length}>탭에는 있는데 업무 없음 {missing.length}</button>
      </p>
      {only === 'missing' ? (
        <ul className="plain">{missing.map((k) => <li key={k}>{tabLabel(k)} <small className="muted">{k}</small> <button className="btn-sm btn-plain" onClick={() => create(k)} data-perm-task-create={k}>업무로 더하기</button></li>)}</ul>
      ) : (
        <div className="ad-tw"><table className="tbl">
          <thead><tr><th>업무</th><th>설명</th><th>수준</th><th>업무그룹</th><th className="num">주소</th><th className="num">권한그룹</th><th /></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.key} className={x.active ? undefined : 'dim'} data-perm-task={x.key}>
              <td>{x.name} <small className="muted">{x.key}</small></td><td className="muted">{x.description ?? ''}</td>
              <td>{x.levels.map((l) => LV_KO[l] ?? l).join(' · ')}</td><td>{x.groups.join(', ')}</td>
              <td className="num">{x.routes === 0 ? <span className="warn-text">0</span> : x.routes}</td><td className="num">{x.roleGroups}</td>
              <td><button className="btn-sm btn-plain" onClick={() => edit(x)}>고치기</button> <button className="btn-sm btn-plain" onClick={() => onoff(x)}>{x.active ? '끄기' : '켜기'}</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {t.data && <p className="muted">{t.data.note}</p>}
    </section>
  );
}

/* ── v10.563 바뀐 기록 ─────────────────────────────────────────── */
interface RoleChange { id: number; email: string; role: string; action: string; reason: string | null; changedBy: string | null; changedAt: string }
interface PermChange { id: string; targetKind: string; target: string; action: string; reason: string; createdAt: string; actor: string | null }
export function PermLog() {
  const r = useApi<RoleChange[]>('/admin/reports/roles/changes');
  const sup = isSuper();
  return (
    <section data-perm-log={r.data?.length ?? ''}>
      <h3>역할 주고 거둔 기록</h3>
      {r.error ? <ErrorView error={r.error} onRetry={r.reload} /> : (
        <table className="tbl"><thead><tr><th>때</th><th>계정</th><th>역할</th><th>동작</th><th>사유</th><th>처리자</th></tr></thead>
          <tbody>{(r.data ?? []).slice(0, 100).map((c) => <tr key={c.id}><td>{ymdhm(c.changedAt)}</td><td className="muted">{c.email}</td><td>{ROLE_LABEL[c.role] ?? c.role}</td>
            <td>{c.action === 'GRANT' ? '부여' : '회수'}</td><td className="muted">{c.reason ?? '—'}</td><td className="muted">{c.changedBy ?? '—'}</td></tr>)}</tbody></table>
      )}
      {sup ? <PermChangeLog /> : <p className="muted">업무 권한(권한그룹 · 업무그룹 · 사원 권한 · 판정 방식) 바꾼 기록은 최고 관리자(SUPER)만 봅니다.</p>}
    </section>
  );
}
function PermChangeLog() {
  const p = useApi<{ items: PermChange[] }>('/admin/perm/changes');
  return (
    <>
      <h3>업무 권한 바꾼 기록</h3>
      <table className="tbl" data-perm-log-perm={p.data?.items.length ?? ''}><thead><tr><th>때</th><th>무엇</th><th>동작</th><th>사유</th><th>누가</th></tr></thead>
        <tbody>{(p.data?.items ?? []).map((c) => <tr key={c.id}><td>{ymdhm(c.createdAt)}</td><td>{c.targetKind} {c.target}</td><td>{c.action}</td><td className="muted">{c.reason}</td><td className="muted">{c.actor ?? '—'}</td></tr>)}</tbody></table>
      <p className="muted">기록은 고칠 수 없습니다.</p>
    </>
  );
}

/* ── v10.564 판정 방식(업무별 권한 탭 위) ──────────────────────── */
interface CheckT { key: string; label: string; ok: boolean; need: boolean; detail: string }   // v10.624 (docs/767)
interface ModeT { checklist?: CheckT[]; compareHours?: number; mode: string; modes: string[]; unmapped: number; unmappedItems: Array<{ method: string; pattern: string; roles: string[]; controller: string }>; diff24: number;
  recent: Array<{ at: string; who: string | null; method: string; pattern: string; taskKeys: string[]; level: string; diff: string }>; since: string | null; groupsReady: boolean; note: string }
const MODE_KO: Record<string, string> = { ROLE: '역할로(지금처럼)', COMPARE: '역할로 · 권한그룹과 비교 기록', GROUPS: '권한그룹으로' };
export function PermModeBox() {
  const m = useApi<ModeT>('/admin/perm/mode');
  const a = useAct();
  const change = (to: string) => {
    /* v10.624 (docs/767) — 권장 줄(COMPARE 24시간 · 검사 ON)이 아직이면 GROUPS 전에 한 번 더 묻습니다(서버는 꼭 줄만 막음) */
    const soft = to === 'GROUPS' ? (m.data?.checklist ?? []).filter((c) => !c.need && !c.ok) : [];
    if (soft.length && !window.confirm(`권장 조건이 아직입니다 — ${soft.map((c) => `${c.label}(${c.detail})`).join(' · ')}. 그래도 GROUPS 로 바꿀까요?`)) return;
    const reason = ask(`판정 방식을 「${MODE_KO[to] ?? to}」(${to})로 바꿉니다. 사유를 적어 주십시오`); if (!reason) return;
    void a.run(`m${to}`, () => api<{ note: string }>('/admin/perm/mode', { method: 'PUT', body: JSON.stringify({ mode: to, reason }) }), m.reload, (r) => r.note);
  };
  if (m.error) return null;
  const d = m.data;
  return (
    <div className="card" data-perm-mode={d?.mode ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">판정 방식 <small className="muted">perm.mode</small></h3>
      {d && (
        <>
          <p>지금 <b data-perm-mode-now={d.mode}>{MODE_KO[d.mode] ?? d.mode}</b>{d.since ? <small className="muted"> · {ymdhm(d.since)}부터</small> : null} ·
            연결 안 된 /admin 주소 <b className={d.unmapped ? 'warn-text' : undefined} data-perm-mode-unmapped={d.unmapped}>{d.unmapped}</b> ·
            최근 24시간 다름 <b className={d.diff24 ? 'warn-text' : undefined} data-perm-mode-diff={d.diff24}>{d.diff24}</b></p>
          <p>{d.modes.filter((x) => x !== d.mode).map((x) => (
            <button key={x} className="btn-sm" disabled={a.busy === `m${x}` || (x === 'GROUPS' && !d.groupsReady)} onClick={() => change(x)} data-perm-mode-to={x}>{MODE_KO[x] ?? x}로</button>))}
            {!d.groupsReady && d.mode !== 'GROUPS' && <small className="muted"> 권한그룹으로 바꾸려면 연결 안 된 주소 0 · 24시간 다름 0 이어야 합니다.</small>}</p>
          {(d.checklist ?? []).length > 0 && (
            <table className="tbl" data-perm-mode-check={(d.checklist ?? []).filter((c) => c.ok).length}>
              <caption className="muted">GROUPS 로 바꾸기 전 점검(「꼭」은 서버가 막고 「권장」은 알림만)</caption>
              <tbody>{(d.checklist ?? []).map((c) => (
                <tr key={c.key} data-perm-check={c.key}><td>{c.ok ? '통과' : <b className="warn-text">아직</b>}</td><td>{c.label}</td><td className="muted">{c.need ? '꼭' : '권장'}</td><td className="mono">{c.detail}</td></tr>))}</tbody>
            </table>)}
          {d.unmappedItems.length > 0 && (
            <details><summary>연결 안 된 주소 {d.unmapped}</summary>
              <table className="tbl"><tbody>{d.unmappedItems.map((u) => <tr key={`${u.method}${u.pattern}`}><td className="mono">{u.method} {u.pattern}</td><td className="muted">{u.roles.join(', ')}</td><td className="muted">{u.controller}</td></tr>)}</tbody></table>
            </details>
          )}
          {d.recent.length > 0 && (
            <details><summary>최근 다름 {d.recent.length}</summary>
              <table className="tbl"><tbody>{d.recent.map((r, i) => <tr key={i}><td>{ymdhm(r.at)}</td><td>{r.who ?? '—'}</td><td className="mono">{r.method} {r.pattern}</td><td>{r.taskKeys.join(', ')} {LV_KO[r.level] ?? r.level}</td>
                <td>{r.diff === 'ROLE_ONLY' ? '역할만 엶(권한그룹은 막음)' : '권한그룹만 엶(역할은 막음)'}</td></tr>)}</tbody></table>
            </details>
          )}
          <p className="muted">{d.note}</p>
          <PermReadiness mode={d.mode} onDone={m.reload} />
        </>
      )}
    </div>
  );
}

/* v10.774 (D329 · docs/882) GROUPS 전환 준비 — 7일 다름 · 권한그룹 없는 운영 계정 · 바꾼 뒤 이틀 확인 카드 · COMPARE 로 한 번에 되돌리기 */
interface ReadyT { mode: string; days: Array<{ day: string; diff: number }>; zeroDays: number; lastDiffAt: string | null; staffNoGroup: number; staffNoGroupItems: Array<{ name: string | null; email: string }>; roleGroups: number; after: { since: string; hours: number } | null; note: string }
function PermReadiness({ mode, onDone }: { mode: string; onDone: () => void }) {
  const r = useApi<ReadyT>('/admin/perm/mode/readiness', [mode]);
  const a = useAct();
  if (!r.data) return null;
  const d = r.data;
  const revert = () => {
    const reason = ask('판정 방식을 GROUPS 에서 COMPARE(역할로 · 비교 기록)로 되돌립니다. 사유를 적어 주십시오'); if (!reason) return;
    void a.run('revert', () => api<{ note: string }>('/admin/perm/mode/revert', { method: 'POST', body: JSON.stringify({ reason }) }), () => { r.reload(); onDone(); }, (x) => x.note);
  };
  return (
    <div className="card pad" data-perm-ready={d.zeroDays}>
      <Flash msg={a.msg} err={a.err} />
      <b>GROUPS 전환 준비</b>
      {d.after && <p className="ad-nt warn" data-perm-after={d.after.hours}>GROUPS 로 바꾼 지 {d.after.hours}시간 — 첫 이틀은 운영자들이 평소 화면을 열 수 있는지 확인하십시오(막히면 아래 「COMPARE 로 되돌리기」).</p>}
      <table className="tbl"><tbody>
        <tr><th>최근 7일 다름</th><td data-perm-ready-days>{d.days.map((x) => <span key={x.day} className={x.diff ? 'chip warn-text' : 'chip'}>{x.day.slice(5)} {x.diff}</span>)}</td></tr>
        <tr><th>이어진 다름 0</th><td>{d.zeroDays}일{d.lastDiffAt ? <small className="muted"> · 마지막 다름 {ymdhm(d.lastDiffAt)}</small> : null}</td></tr>
        <tr><th>권한그룹 없는 운영 계정</th><td className={d.staffNoGroup ? 'warn-text' : undefined} data-perm-ready-nogroup={d.staffNoGroup}>{d.staffNoGroup}{d.staffNoGroupItems.length > 0 && <small className="muted"> — {d.staffNoGroupItems.map((x) => x.name ?? x.email).join(' · ')}</small>}</td></tr>
        <tr><th>역할에서 만든 권한그룹(R_)</th><td>{d.roleGroups}</td></tr>
      </tbody></table>
      {d.mode === 'GROUPS' && <p><button className="btn-sm btn-no" disabled={a.busy === 'revert'} onClick={revert} data-perm-revert>COMPARE 로 되돌리기</button></p>}
      <p className="muted">{d.note}</p>
    </div>
  );
}
