/* ===== ㉕ v10.441 ~ 444 (D258 · docs/578 ~ 581) 업무별 권한 관리 — web/src/app/admin/Perm.tsx 새 파일 =====
 * 운영 화면 「사무」 › 「권한 관리」(SUPER) — 업무그룹 · 업무 · 권한그룹 매트릭스(업무 × 보기 · 고치기 · 승인 · 내려받기) · 개인권한 · 미리보기 · SHADOW 기록 · 바꾼 기록
 * 화면 반영 — loadPerm() · permVisible(tab) · permCan(tab, level): 검사 모드가 ON 이고 표에 있는 탭이면 권한그룹대로(아니면 지금처럼 역할)
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const LV = ['VIEW', 'EDIT', 'APPROVE', 'EXPORT'] as const;
const LV_KO: Record<string, string> = { VIEW: '보기', EDIT: '고치기', APPROVE: '승인', EXPORT: '내려받기' };

/* ── 화면 반영 ── */
interface PermMe { mode: string; decide?: string; super: boolean; tasks: Record<string, string[]>; known: string[] }   // v10.615 decide — perm.mode(ROLE · COMPARE · GROUPS)
let ME: (PermMe & { knownSet: Set<string> }) | null = null;
const listeners = new Set<() => void>();
/** 로그인 뒤 한 번(운영 화면 Console) — 실패하면 지금처럼 역할만 */
export function loadPerm() {
  return api<PermMe>('/admin/perm/me').then((m) => { ME = { ...m, knownSet: new Set(m.known ?? []) }; listeners.forEach((f) => f()); }).catch(() => { ME = null; });
}
export function usePermTick() { const [, set] = useState(0); useEffect(() => { const f = () => set((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []); }
const enforced = () => !!ME && (ME.mode === 'ON' || ME.decide === 'GROUPS') && !ME.super;   // v10.615 (docs/757) 판정 방식 GROUPS 면 검사 ON 과 같게(서버가 권한그룹으로 정함)
/** v10.615 (docs/757) 이 탭을 권한그룹만으로 고를지 — 판정 방식 GROUPS · SUPER 아님 · 표(perm_tasks)에 있는 탭(App.tsx 가 SUPER 전용 탭은 빼고 씀) */
export const permGroupsTab = (tab: string) => !!ME && ME.decide === 'GROUPS' && !ME.super && ME.knownSet.has(tab);
/** 화면 단추 막기 — 검사 모드가 SHADOW · ON 이고 SUPER 가 아니면(서버는 ON 일 때만 막음 · 화면은 SHADOW 부터 미리 맞춤) */
const uiScoped = () => !!ME && (ME.mode === 'ON' || ME.mode === 'SHADOW' || ME.decide === 'GROUPS') && !ME.super;   // v10.615 GROUPS 면 검사 모드와 상관없이
/** 탭을 보일지 — 검사 ON 이고 표에 있는 탭이면 보기 권한이 있어야 함 */
export const permVisible = (tab: string) => !enforced() || !ME!.knownSet.has(tab) || (ME!.tasks[tab] ?? []).includes('VIEW');
/** 그 탭에서 그 수준을 할 수 있는지(고치기 · 승인 · 내려받기 단추) */
export const permCan = (tab: string, level: string) => !enforced() || !ME!.knownSet.has(tab) || (ME!.tasks[tab] ?? []).includes(level);
/** 지금 탭에 보기만 있으면 맨 위 한 줄 */
export function PermReadonlyBar({ tab }: { tab: string }) {
  usePermTick();
  if (!uiScoped() || !ME!.knownSet.has(tab) || (ME!.tasks[tab] ?? []).includes('EDIT')) return null;
  return <p className="warn-text" data-perm-readonly={tab}>이 업무는 보기 권한만 있습니다 — 고치기 · 승인 단추를 막았습니다(권한 관리는 SUPER).</p>;
}

/* ---------------------------------------------------------------------
 * v10.444 (D258 · docs/581) 탭 내용 감싸기 — App.tsx 한 곳에서 <PermScope tab={tab}> 로 모든 운영 화면을 감쌈(화면마다 손대지 않음)
 *   고치기(EDIT) 없음 → 단추를 막음 · 승인(APPROVE) 없음 → 결재 · 승인 · 확정 단추(data-perm="approve" 또는 글자)만 막음 ·
 *   내려받기(EXPORT) 없음 → CSV · 내려받기 단추 막음. 탭 이동(data-tab · role=tab) · 펼치기(aria-expanded) · 보기 글자(보기 · 닫기 · 찾기 · 이전 · 다음 …) ·
 *   data-perm="view" 는 늘 살림. 입력 칸(고르기 · 날짜 · 찾기)은 막지 않음 — 저장 단추가 막히므로 바뀌지 않음.
 *   <fieldset disabled> 를 쓰지 않는 까닭: fieldset 은 안의 단추를 하나도 살릴 수 없어(legend 밖) 「보기 · 내려받기」 단추까지 죽음.
 *   대신 작은 훅(MutationObserver)이 단추마다 disabled 를 붙이고, 우리가 붙인 것만(data-perm-off) 되돌림. 서버 검사는 그대로(ON 이면 403).
 * ------------------------------------------------------------------- */
const VIEW_TEXT = /^(보기|열기|닫기|접기|펼치기|더 보기|지난|새로고침|다시 읽기|다시 불러오기|찾기|검색|미리보기|이전|다음|인쇄|모두 보기|◀|▶|‹|›|«|»|<|>)/;
const EXPORT_TEXT = /(CSV|내려받기|엑셀|PDF)/;
const APPROVE_TEXT = /^(승인|반려|결재|확정|지급 처리|지급함|마감|해 마감|풀기|되돌리기)/;
export interface PermScopeLv { edit: boolean; approve: boolean; exp: boolean }
/** 그 탭의 화면 권한 — 막을 것이 없으면 null(검사 OFF · SUPER · 표에 없는 탭) */
export function permScopeOf(tab: string): PermScopeLv | null {
  if (!uiScoped() || !ME!.knownSet.has(tab)) return null;
  const t = ME!.tasks[tab] ?? [];
  const sc = { edit: t.includes('EDIT'), approve: t.includes('APPROVE'), exp: t.includes('EXPORT') };
  return sc.edit && sc.approve && sc.exp ? null : sc;
}
/** 단추 하나를 살릴지 */
export function permButtonAllowed(b: { dataset: DOMStringMap; textContent: string | null; getAttribute(n: string): string | null; hasAttribute(n: string): boolean }, sc: PermScopeLv) {
  const tag = b.dataset.perm, txt = (b.textContent ?? '').trim();
  if (b.getAttribute('role') === 'tab' || b.hasAttribute('data-tab') || b.hasAttribute('aria-expanded') || tag === 'view') return true;
  if (tag === 'export' || EXPORT_TEXT.test(txt)) return sc.exp;
  if (tag === 'approve' || APPROVE_TEXT.test(txt)) return sc.approve;
  if (tag === 'edit') return sc.edit;
  if (VIEW_TEXT.test(txt)) return true;
  return sc.edit;
}
function applyScope(root: HTMLElement, sc: PermScopeLv) {
  root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    if (!permButtonAllowed(b, sc)) {
      if (!b.disabled) { b.disabled = true; b.dataset.permOff = '1'; if (!b.title) { b.title = '이 업무의 권한이 없습니다(권한 관리는 SUPER)'; b.dataset.permTitle = '1'; } }
    } else if (b.dataset.permOff) {
      b.disabled = false; delete b.dataset.permOff; if (b.dataset.permTitle) { b.removeAttribute('title'); delete b.dataset.permTitle; }
    }
  });
}
function clearScope(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('button[data-perm-off]').forEach((b) => {
    b.disabled = false; delete b.dataset.permOff; if (b.dataset.permTitle) { b.removeAttribute('title'); delete b.dataset.permTitle; }
  });
}
/** App.tsx 가 모든 탭 내용을 감쌈 */
export function PermScope({ tab, children }: { tab: string; children: ReactNode }) {
  usePermTick();
  const ref = useRef<HTMLDivElement>(null);
  const sc = permScopeOf(tab);
  const key = sc ? `${sc.edit ? 1 : 0}${sc.approve ? 1 : 0}${sc.exp ? 1 : 0}` : 'all';
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!sc) { clearScope(root); return; }
    let running = false;
    const run = () => { if (running) return; running = true; try { applyScope(root, sc); } finally { running = false; } };
    run();
    const mo = new MutationObserver(run);
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    return () => { mo.disconnect(); clearScope(root); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, key]);
  return <div ref={ref} className={sc && !sc.edit ? 'perm-scope perm-readonly' : 'perm-scope'} data-perm-scope={tab} data-perm-level={key}>{children}</div>;
}

/* ── SUPER 화면 ── */
interface Overview {
  mode: string; widen?: boolean; levels: string[];
  taskGroups: Array<{ key: string; name: string; sort: number }>;
  tasks: Array<{ key: string; name: string; groupKey: string; levels: string[]; active: boolean }>;
  roleGroups: Array<{ key: string; name: string; kind: string; fromRole: string | null; note: string | null; active: boolean; items: number; people: number }>;
  people: Array<{ id: string; name: string; email: string; roles: string[]; kind: string; groups: Array<{ key: string; expiresAt: string | null }>; overrides: number }>;
  note: string;
}

export function PermAdmin() {
  const q = useApi<Overview>('/admin/perm/overview');
  const [view, setView] = useState<'groups' | 'people' | 'shadow' | 'changes' | 'widen'>('groups');
  const [rg, setRg] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const d = q.data;
  return (
    <section data-perm-admin={d?.roleGroups.length ?? ''}>
      {d && <p className={d.mode === 'ON' ? '' : 'warn-text'} data-perm-mode={d.mode}>검사 모드 <b>{d.mode}</b> — {d.mode === 'SHADOW' ? '막지 않고 「막혔을 것」만 기록합니다(정책 › 전체 설정 perm.enforce 를 ON 으로 바꾸면 막음).' : d.mode === 'ON' ? '권한그룹대로 막습니다.' : '업무 권한을 보지 않습니다(역할만).'}</p>}
      {d && <WidenSwitch on={!!d.widen} mode={d.mode} onDone={q.reload} />}
      <p>{(['groups', 'people', 'shadow', 'changes', 'widen'] as const).map((v) => (
        <button key={v} className={view === v ? 'btn-sm' : 'btn-sm btn-plain'} onClick={() => setView(v)} data-perm-view={v}>
          {({ groups: '권한그룹', people: '개인권한', shadow: '막혔을 요청', changes: '바꾼 기록', widen: '넓혀서 통과' } as Record<string, string>)[v]}</button>))}</p>
      {view === 'widen' && <WidenLog />}
      {d && view === 'groups' && (
        <>
          <table className="tbl" data-perm-groups={d.roleGroups.length}><thead><tr><th>권한그룹</th><th>구분</th><th>항목</th><th>사람</th><th /></tr></thead>
            <tbody>{d.roleGroups.map((g) => (
              <tr key={g.key}><td>{g.name} <small className="dim">{g.key}{g.fromRole ? ` · 역할 ${g.fromRole} 처음 변환` : ''}</small></td><td>{g.kind === 'MANAGER' ? '관리자' : '업무용'}</td><td>{g.items}</td><td>{g.people}</td>
                <td><button className="btn-sm btn-plain" onClick={() => setRg(g.key)} data-perm-group-open={g.key}>고치기</button></td></tr>))}</tbody></table>
          <button className="btn-sm" onClick={() => setRg('NEW')} data-perm-group-new="">새 권한그룹</button>
          {rg && <RoleGroupEdit key={rg} k={rg} ov={d} onDone={() => { setRg(null); q.reload(); }} />}
        </>
      )}
      {d && view === 'people' && (
        <>
          <table className="tbl" data-perm-people={d.people.length}><thead><tr><th>운영자</th><th>역할</th><th>구분</th><th>권한그룹</th><th>개별</th><th /></tr></thead>
            <tbody>{d.people.map((p) => (
              <tr key={p.id}><td>{p.name || p.email}</td><td><small>{p.roles.join(' · ')}</small></td><td>{p.kind === 'MANAGER' ? '관리자' : '업무용'}</td>
                <td><small>{p.groups.map((g) => g.key + (g.expiresAt ? `(~${String(g.expiresAt).slice(0, 10)})` : '')).join(' · ') || '—'}</small></td><td>{p.overrides || '—'}</td>
                <td><button className="btn-sm btn-plain" onClick={() => setWho(p.id)} data-perm-person-open={p.id}>고치기</button></td></tr>))}</tbody></table>
          {who && <AccountEdit key={who} id={who} ov={d} onDone={() => { setWho(null); q.reload(); }} />}
        </>
      )}
      {view === 'shadow' && <ShadowLog />}
      {view === 'changes' && <PermChanges />}
      {d && <p className="muted">{d.note}</p>}
    </section>
  );
}

function RoleGroupEdit({ k, ov, onDone }: { k: string; ov: Overview; onDone: () => void }) {
  const a = useAct();
  const isNew = k === 'NEW';
  const q = useApi<{ group: { key: string; name: string; kind: string; note: string | null }; items: Array<{ taskKey: string; level: string }> }>(isNew ? '/admin/perm/overview' : `/admin/perm/role-groups/${k}`);
  const [key, setKey] = useState(isNew ? '' : k);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('STAFF');
  const [sel, setSel] = useState<Set<string> | null>(isNew ? new Set() : null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!isNew && q.data && 'group' in q.data && sel === null) {
      setName(q.data.group.name); setKind(q.data.group.kind); setSel(new Set(q.data.items.map((i) => `${i.taskKey}:${i.level}`)));
    }
  }, [q.data]);
  const toggle = (t: string, l: string) => setSel((s) => { const n = new Set(s ?? []); const k2 = `${t}:${l}`; if (n.has(k2)) n.delete(k2); else n.add(k2); return n; });
  const rowAll = (t: string, on: boolean) => setSel((s) => { const n = new Set(s ?? []); LV.forEach((l) => (on ? n.add(`${t}:${l}`) : n.delete(`${t}:${l}`))); return n; });
  const save = () => void a.run('save', () => api(`/admin/perm/role-groups/${encodeURIComponent(key)}`, { method: 'PUT',
    body: JSON.stringify({ name, kind, reason, items: [...(sel ?? [])].map((x) => { const [taskKey, level] = x.split(':'); return { taskKey, level }; }) }) }), onDone);
  if (!sel) return <p className="muted">불러오는 중…</p>;
  return (
    <div className="card pad" data-perm-group-edit={k}>
      <Flash msg={a.msg} err={a.err} />
      <p>{isNew && <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="키(예: ACCT_STAFF)" size={16} />}{' '}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" size={16} />{' '}
        <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="STAFF">업무용</option><option value="MANAGER">관리자</option></select>{' '}
        <small className="dim">고른 칸 {sel.size}</small></p>
      {ov.taskGroups.map((g) => {
        const ts = ov.tasks.filter((t) => t.groupKey === g.key && t.active);
        if (!ts.length) return null;
        return (
          <details key={g.key} open={ts.some((t) => LV.some((l) => sel.has(`${t.key}:${l}`)))}><summary>{g.name} <small className="dim">{ts.length}</small></summary>
            <table className="tbl"><thead><tr><th>업무</th>{LV.map((l) => <th key={l}>{LV_KO[l]}</th>)}<th /></tr></thead>
              <tbody>{ts.map((t) => (
                <tr key={t.key} data-perm-task={t.key}><td>{t.name} <small className="dim">{t.key}</small></td>
                  {LV.map((l) => <td key={l}><input type="checkbox" checked={sel.has(`${t.key}:${l}`)} disabled={!t.levels.includes(l)} onChange={() => toggle(t.key, l)} aria-label={`${t.name} ${LV_KO[l]}`} /></td>)}
                  <td><button className="btn-sm btn-plain" onClick={() => rowAll(t.key, !LV.every((l) => sel.has(`${t.key}:${l}`)))}>모두</button></td></tr>))}</tbody></table>
          </details>
        );
      })}
      <p><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(꼭)" size={30} />{' '}
        <button className="btn-sm" disabled={a.busy === 'save' || reason.trim().length < 2 || !key} onClick={save} data-perm-group-save="">저장</button>{' '}
        <button className="btn-sm btn-plain" onClick={onDone}>닫기</button></p>
    </div>
  );
}

function AccountEdit({ id, ov, onDone }: { id: string; ov: Overview; onDone: () => void }) {
  const a = useAct();
  const q = useApi<{ account: { name: string; email: string; roles: string[]; kind: string }; groups: Array<{ key: string; expiresAt: string | null }>;
    overrides: Array<{ taskKey: string; level: string; effect: string; expiresAt: string | null; reason: string }>; preview: Record<string, string[]>; note: string }>(`/admin/perm/accounts/${id}`);
  const [kind, setKind] = useState<string | null>(null);
  const [groups, setGroups] = useState<Array<{ key: string; expiresAt: string }>>([]);
  const [ovs, setOvs] = useState<Array<{ taskKey: string; level: string; effect: string; expiresAt: string }>>([]);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (q.data && kind === null) {
      setKind(q.data.account.kind);
      setGroups(q.data.groups.map((g) => ({ key: g.key, expiresAt: g.expiresAt ? String(g.expiresAt).slice(0, 10) : '' })));
      setOvs(q.data.overrides.map((o) => ({ taskKey: o.taskKey, level: o.level, effect: o.effect, expiresAt: o.expiresAt ? String(o.expiresAt).slice(0, 10) : '' })));
    }
  }, [q.data]);
  const save = () => void a.run('save', () => api(`/admin/perm/accounts/${id}`, { method: 'PUT', body: JSON.stringify({
    kind, reason, groups: groups.map((g) => ({ key: g.key, expiresAt: g.expiresAt || null })),
    overrides: ovs.filter((o) => o.taskKey).map((o) => ({ ...o, expiresAt: o.expiresAt || null })) }) }), onDone);
  const d = q.data;
  if (!d || kind === null) return <p className="muted">불러오는 중…</p>;
  const visibleTasks = Object.keys(d.preview);
  return (
    <div className="card pad" data-perm-person-edit={id}>
      <Flash msg={a.msg} err={a.err} />
      <b>{d.account.name || d.account.email}</b> <small className="dim">역할 {d.account.roles.join(' · ')}</small>{' '}
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="구분"><option value="STAFF">업무용</option><option value="MANAGER">관리자</option></select>
      <h4>권한그룹</h4>
      {groups.map((g, i) => (
        <p key={i}><select value={g.key} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
          {ov.roleGroups.filter((r) => r.active).map((r) => <option key={r.key} value={r.key}>{r.name}{r.kind === 'MANAGER' ? ' (관리자)' : ''}</option>)}</select>{' '}
          기한 <input type="date" value={g.expiresAt} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, expiresAt: e.target.value } : x)))} />{' '}
          <button className="btn-sm btn-plain" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>빼기</button></p>))}
      <button className="btn-sm btn-plain" onClick={() => setGroups([...groups, { key: ov.roleGroups[0]?.key ?? '', expiresAt: '' }])} data-perm-add-group="">그룹 더하기</button>
      <h4>개별 더하기 · 빼기</h4>
      {ovs.map((o, i) => (
        <p key={i}><select value={o.taskKey} onChange={(e) => setOvs(ovs.map((x, j) => (j === i ? { ...x, taskKey: e.target.value } : x)))}>
          <option value="">업무 고르기</option>{ov.tasks.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select>{' '}
          <select value={o.level} onChange={(e) => setOvs(ovs.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)))}>{LV.map((l) => <option key={l} value={l}>{LV_KO[l]}</option>)}</select>{' '}
          <select value={o.effect} onChange={(e) => setOvs(ovs.map((x, j) => (j === i ? { ...x, effect: e.target.value } : x)))}><option value="ALLOW">더하기</option><option value="DENY">빼기</option></select>{' '}
          기한 <input type="date" value={o.expiresAt} onChange={(e) => setOvs(ovs.map((x, j) => (j === i ? { ...x, expiresAt: e.target.value } : x)))} />{' '}
          <button className="btn-sm btn-plain" onClick={() => setOvs(ovs.filter((_, j) => j !== i))}>지우기</button></p>))}
      <button className="btn-sm btn-plain" onClick={() => setOvs([...ovs, { taskKey: '', level: 'VIEW', effect: 'ALLOW', expiresAt: '' }])} data-perm-add-override="">개별 줄 더하기</button>
      <h4>지금 권한 미리보기 <small className="dim">업무 {visibleTasks.length}</small></h4>
      <p data-perm-preview={visibleTasks.length}><small>{visibleTasks.map((t) => `${ov.tasks.find((x) => x.key === t)?.name ?? t}(${d.preview[t]!.map((l) => LV_KO[l]).join('·')})`).join(' · ') || '없음'}</small></p>
      <p className="muted">{d.note}</p>
      <p><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(꼭)" size={30} />{' '}
        <button className="btn-sm" disabled={a.busy === 'save' || reason.trim().length < 2} onClick={save} data-perm-person-save="">저장</button>{' '}
        <button className="btn-sm btn-plain" onClick={onDone}>닫기</button></p>
    </div>
  );
}

function ShadowLog() {
  const q = useApi<{ days: number; mode: string; note: string; rows: Array<{ method: string; pattern: string; taskKeys: string[]; level: string; mode: string; n: number; lastAt: string; who: string[] }> }>('/admin/perm/shadow?days=7');
  const d = q.data;
  if (!d) return null;
  return (
    <div data-perm-shadow={d.rows.length}>
      <p className="muted">{d.note}</p>
      <table className="tbl"><thead><tr><th>주소</th><th>업무</th><th>수준</th><th>누가</th><th>번</th><th>마지막</th></tr></thead>
        <tbody>{d.rows.map((r, i) => <tr key={i}><td><small>{r.method} {r.pattern}</small></td><td>{r.taskKeys.join(' · ')}</td><td>{LV_KO[r.level] ?? r.level}</td><td><small>{r.who.join(' · ')}</small></td><td>{r.n}</td><td>{ymdhm(r.lastAt)}</td></tr>)}</tbody></table>
      {!d.rows.length && <p className="muted">최근 7일 막혔을 요청이 없습니다.</p>}
    </div>
  );
}

function PermChanges() {
  const q = useApi<{ items: Array<{ id: string; targetKind: string; target: string; action: string; reason: string; createdAt: string; actor: string | null }> }>('/admin/perm/changes');
  if (!q.data) return null;
  return (
    <table className="tbl" data-perm-changes={q.data.items.length}><thead><tr><th>때</th><th>대상</th><th>무엇</th><th>사유</th><th>누가</th></tr></thead>
      <tbody>{q.data.items.map((c) => <tr key={c.id}><td>{ymdhm(c.createdAt)}</td><td>{c.targetKind} {c.target}</td><td>{c.action}</td><td>{c.reason}</td><td>{c.actor ?? ''}</td></tr>)}</tbody></table>
  );
}

/** v10.442 — 권한 넓히기 스위치(perm.allow_widen · 처음 off · SUPER) */
function WidenSwitch({ on, mode, onDone }: { on: boolean; mode: string; onDone: () => void }) {
  const a = useAct();
  const flip = () => {
    const reason = prompt(on ? '권한 넓히기를 끕니다. 사유를 적으십시오.' : '권한 넓히기를 켭니다 — 역할로는 막히는 운영 화면을 권한그룹 · 개인권한이 주면 통과합니다(SUPER 전용 · 권한 관리 · 결제 · 정산 지급 · 개인정보 내려받기는 늘 막음). 사유를 적으십시오.');
    if (!reason || reason.trim().length < 2) return;
    void a.run('widen', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'perm.allow_widen', value: on ? 'off' : 'on', reason }) }), onDone);
  };
  return (
    <div className="card pad" data-perm-widen={on ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <b>권한 넓히기</b> {on ? <b className="warn-text">켜짐</b> : '꺼짐'}{' '}
      <button className="btn-sm btn-plain" disabled={a.busy === 'widen'} onClick={flip} data-perm-widen-flip="">{on ? '끄기' : '켜기'}</button>
      <p className="muted">켜면 검사 모드가 <b>ON</b> 일 때만, 역할로는 못 여는 운영 화면도 권한그룹 · 개인권한이 주면 열립니다(통과마다 감사 기록 PERM_WIDEN).
        SUPER 전용 · 권한 관리 · 역할 주기 · 외부 연동 키 · 결제 · 정산 · 출금 지급 · 개인정보 내려받기는 늘 막습니다.
        {on && mode !== 'ON' && <span className="warn-text"> 지금 검사 모드가 {mode} 라 넓히기는 아직 동작하지 않습니다.</span>}</p>
    </div>
  );
}

interface WidenRows { on: boolean; mode: string; items: Array<{ id: string; createdAt: string; who: string; method: string; path: string; task: string; level: string; roles: string[] }>; note: string }
function WidenLog() {
  const q = useApi<WidenRows>('/admin/perm/widen-log');
  const d = q.data;
  if (!d) return null;
  return (
    <div data-perm-widen-log={d.items.length}>
      <p className="muted">{d.note}</p>
      <table className="tbl"><thead><tr><th>때</th><th>누가</th><th>요청</th><th>업무 · 수준</th><th>역할</th></tr></thead>
        <tbody>{d.items.map((x) => <tr key={x.id}><td>{ymdhm(x.createdAt)}</td><td>{x.who}</td><td><small>{x.method} {x.path}</small></td><td>{x.task} · {LV_KO[x.level] ?? x.level}</td><td><small>{x.roles.join(' · ')}</small></td></tr>)}</tbody></table>
    </div>
  );
}
