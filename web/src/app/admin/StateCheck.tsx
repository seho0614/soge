import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { Flash } from '../../components/Flash';

/**
 * v10.212 (docs/340) — 운영 상태 한눈에(첫 화면 · 보기 ADMIN · SUPER · 읽기만)
 *
 *   운영 적용 뒤 화면 확인(절차서 4-1)을 이 표 하나로 — 줄을 누르면 그 화면.
 *   ✓ 할 일 없음 · ○ 할 일 남음(오픈 전에는 정상) · ⚠ 바로 볼 것 · – 값만.
 *   v10.214 (docs/344) — 「약관 시행 예정」 줄이 더해짐(11줄 · 줄은 서버가 정함 · 이 화면은 그대로 그림).
 *   v10.238 (docs/379) — 「급한 알림 받는 길」 줄(12줄).
 *   v10.247 ~ 249 (docs/386) — 지금 판 카드 「결과 파일」(SUPER · 읽기만) · 「서버 자원 추세」 카드(ServerTrend).
 */
interface Row { key: string; label: string; state: 'ok' | 'todo' | 'warn' | 'info'; now: string; go: string }
const MARK: Record<Row['state'], string> = { ok: '✓', todo: '○', warn: '⚠', info: '–' };

export function StateCheck({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const q = useApi<Row[]>('/admin/launch-watch/state', []);
  const rows = q.data;
  if (!rows) return null;
  const warn = rows.filter((r) => r.state === 'warn').length;
  return (
    <div className={`card${warn ? ' warn' : ''}`} data-state-check data-state-warn={warn}>
      <h3 className="sec">운영 상태 한눈에 <small className="dim">운영 적용 뒤 화면 확인을 이 표로 · ✓ 할 일 없음 · ○ 할 일 남음 · ⚠ 바로 볼 것</small></h3>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-state-row={r.key} data-state={r.state}>
              <td>{r.label}</td>
              <td className={r.state === 'warn' ? 'warn-text' : r.state === 'todo' ? '' : 'muted'}>{MARK[r.state]}</td>
              <td>{r.now}</td>
              <td>{canGo(r.go) && <button className="linkbtn" onClick={() => onGo(r.go)} data-state-go={r.go}>보러 가기</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * v10.240 (docs/379) — 대표 할 일 자동 점검표(첫 화면 · 운영 상태 한눈에 아래 · 읽기만)
 *   DB 로 확인되는 일은 저절로 ✓ 됨 · ○ 아직, DB 로 알 수 없는 일은 「직접 확인」. 끝난 수 / 전체는 자동 항목만.
 *   v10.241 (D201 · docs/381) — 직접 확인 줄에 「적기」(SUPER · 메모 5자 · 끝남 · 다시 아직 · 쌓기만) · 끝남 수 / 전체는 모든 줄.
 *   v10.242 (docs/381) — 정기 점검 기한 줄 3개(줄은 서버가 정함 · 15줄).
 *   v10.246 (docs/383) — 직접 확인 줄 「기록」 → 지난 기록 최근 20줄 펼침(읽기만 · ADMIN 도 봄).
 */
interface TodoRow { key: string; label: string; done: boolean | null; now: string; go: string; manual?: boolean; mark?: { done: boolean } | null }
interface MarkHist { key: string; total: number; rows: { done: boolean; note: string; at: string; by: string | null }[] }
function MarkHistory({ k }: { k: string }) {
  const q = useApi<MarkHist>(`/admin/launch-watch/owner-todo/marks?key=${encodeURIComponent(k)}`, [k]);
  const h = q.data;
  if (!h) return <div className="muted" data-owner-hist={k}>읽는 중…</div>;
  return (
    <div data-owner-hist={k} data-owner-hist-total={h.total}>
      {h.rows.length === 0 ? <span className="muted">적은 기록 없음</span> : (
        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
          {h.rows.map((r, i) => (
            <li key={i} data-owner-hist-row={r.done ? 'done' : 'undo'}>{r.at} · {r.by ?? '(이름 없음)'} · {r.done ? '끝남' : '다시 아직'} — {r.note}</li>
          ))}
        </ul>
      )}
      {h.total > h.rows.length && <small className="dim">최근 {h.rows.length}줄 · 전체 {h.total}줄</small>}
    </div>
  );
}
export function OwnerTodo({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const q = useApi<{ rows: TodoRow[]; done: number; total: number }>('/admin/launch-watch/owner-todo', []);
  const a = useAct();
  const [edit, setEdit] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [hist, setHist] = useState<string | null>(null);
  const isSuper = tokenRoles().includes('SUPER');
  const d = q.data;
  if (!d) return null;
  const save = (key: string, done: boolean) => {
    if (note.trim().length < 5) { a.setErr('메모를 5자 이상 적어 주십시오 — 무엇을 언제 했는지.'); return; }
    void a.run('mark', () => api('/admin/launch-watch/owner-todo/mark', { method: 'POST', body: JSON.stringify({ key, done, note: note.trim() }) }),
      () => { setEdit(null); setNote(''); q.reload(); });
  };
  return (
    <div className="card" data-owner-todo data-owner-done={d.done} data-owner-total={d.total}>
      <h3 className="sec">대표 할 일 <small className="dim">끝남 {d.done} / {d.total} · 「직접 확인」은 화면 밖 일 — 끝나면 「적기」(SUPER)</small></h3>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl">
        <thead><tr><th>할 일</th><th></th><th>지금</th><th></th></tr></thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.key} data-owner-row={r.key} data-owner-state={r.done === null ? 'manual' : r.done ? 'done' : 'todo'}>
              <td>{r.label}</td>
              <td className={r.done === null ? 'muted' : ''}>{r.done === null ? '직접 확인' : r.done ? (r.manual ? '✓ 끝남' : '✓ 됨') : '○ 아직'}</td>
              <td>{r.now}
                {edit === r.key && (
                  <span data-owner-mark-form={r.key}>{' '}
                    <input name="owner-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={{ width: '40%' }}
                      placeholder="예) 11/20 요금제 금액 확정 · 운영 화면 반영" />{' '}
                    <button className="btn-ok" disabled={a.busy === 'mark'} onClick={() => save(r.key, true)} data-owner-mark-done={r.key}>끝남으로</button>{' '}
                    <button className="btn-plain" disabled={a.busy === 'mark'} onClick={() => save(r.key, false)} data-owner-mark-undo={r.key}>다시 아직</button>
                  </span>
                )}
                {hist === r.key && <MarkHistory k={r.key} />}
              </td>
              <td>{canGo(r.go) && <button className="linkbtn" onClick={() => onGo(r.go)} data-owner-go={r.go}>보러 가기</button>}
                {r.manual && isSuper && edit !== r.key && <button className="linkbtn" onClick={() => { setEdit(r.key); setNote(''); a.clear(); }} data-owner-mark={r.key}>적기</button>}
                {r.manual && r.mark && <button className="linkbtn" onClick={() => setHist(hist === r.key ? null : r.key)} data-owner-hist-btn={r.key}>{hist === r.key ? '기록 닫기' : '기록'}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * v10.244 (D202 · docs/383) — 지금 판 · 운영 적용 기록(첫 화면 · 대표 할 일 아래 · 읽기만)
 *   API 가 뜰 때 판이 바뀌었으면 한 줄(올림 · 되돌림) — apply · rollback 이 저절로 남음 · 최근 10줄.
 *   서버에 남은 가장 최근 postcheck 결과 파일의 통과 · 실패 · 확인 수(파일을 읽기만 · 없으면 「결과 파일 없음」).
 */
type RelKind = 'FIRST' | 'UP' | 'BACK' | 'OTHER';
const REL_KO: Record<RelKind, string> = { FIRST: '첫 기록', UP: '올림', BACK: '되돌림', OTHER: '바뀜' };
interface RelData {
  now: { version: string; startedAt: string };
  rows: { id: number; version: string; prev: string | null; kind: RelKind; host: string | null; at: string }[];
  postcheck: { file: string; at: string; version: string | null; pass: number; fail: number; warn: number; same: number | null; changed: number | null; ageHours: number } | null;
}
/* v10.247 (docs/386) — 적용 스크립트 결과 파일(SUPER · 읽기만 · 최근 10개 · 누르면 본문 앞 200KB) */
interface OpsFile { name: string; kind: string; at: string; size: number }
function OpsFileView({ name }: { name: string }) {
  const q = useApi<{ name: string; size: number; truncated: boolean; text: string }>(`/admin/launch-watch/releases/file?name=${encodeURIComponent(name)}`, [name]);
  if (q.error) return <p className="warn-text" data-ops-file-err={name}>열지 못함 — 파일이 지워졌거나 이름이 맞지 않습니다</p>;
  const f = q.data;
  if (!f) return <p className="muted">읽는 중…</p>;
  return (
    <div data-ops-file={f.name} data-ops-file-size={f.size}>
      {f.truncated && <small className="warn-text">앞 200KB 만 보입니다(전체 {Math.round(f.size / 1024)}KB) — 나머지는 서버에서 직접</small>}
      <pre data-ops-file-text style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, margin: '6px 0' }}>{f.text}</pre>
    </div>
  );
}
function OpsFiles() {
  const q = useApi<{ dir: string; files: OpsFile[] }>('/admin/launch-watch/releases/files', []);
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">읽는 중…</p>;
  return (
    <div data-ops-files={d.files.length}>
      {d.files.length === 0 ? <p className="muted">결과 파일 없음 — {d.dir}</p> : (
        <table className="tbl">
          <thead><tr><th>시각(서버)</th><th>종류</th><th>크기</th><th></th></tr></thead>
          <tbody>
            {d.files.map((f) => (
              <tr key={f.name} data-ops-file-row={f.kind}>
                <td>{f.at}</td><td>{f.kind}</td><td className="muted">{f.size < 1024 ? `${f.size}B` : `${Math.round(f.size / 1024)}KB`}</td>
                <td><button className="linkbtn" data-ops-file-open={f.name} onClick={() => setOpen(open === f.name ? null : f.name)}>{open === f.name ? '닫기' : '열기'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <OpsFileView name={open} />}
    </div>
  );
}

export function ReleaseLog() {
  const q = useApi<RelData>('/admin/launch-watch/releases', []);
  const [files, setFiles] = useState(false);
  const isSuper = tokenRoles().includes('SUPER');
  const d = q.data;
  if (!d) return null;
  const pc = d.postcheck;
  const bad = !!pc && (pc.fail > 0 || (pc.version !== null && pc.version !== d.now.version));
  return (
    <div className={`card${bad ? ' warn' : ''}`} data-release-log data-release-now={d.now.version} data-release-rows={d.rows.length}>
      <h3 className="sec">지금 판 {d.now.version} <small className="dim">운영 적용 기록 · API 가 뜰 때 판이 바뀌면 한 줄(올림 · 되돌림) · 뜬 시각 {new Date(d.now.startedAt).toLocaleString('ko-KR')}</small></h3>
      <p data-release-postcheck={pc ? `${pc.pass}|${pc.fail}|${pc.warn}` : 'none'} className={bad ? 'warn-text' : ''}>
        {pc
          ? <>마지막 적용 후 확인(postcheck) {pc.at}(서버 시각 · {pc.ageHours}시간 전){pc.version ? ` · ${pc.version}` : ''} — 통과 {pc.pass} · 실패 {pc.fail} · 확인 {pc.warn}
              {pc.same !== null && <> · 적용 전과 비교 같음 {pc.same} · 바뀜 {pc.changed}</>}
              {pc.version !== null && pc.version !== d.now.version && <> — 지금 판과 다름(그 뒤 postcheck 를 다시 돌리지 않음)</>}</>
          : <span className="muted">적용 후 확인(postcheck) 결과 파일 없음 — 운영 서버에서 apply 하면 생깁니다</span>}
        {isSuper && <> <button className="linkbtn" data-release-files-btn onClick={() => setFiles(!files)}>{files ? '결과 파일 닫기' : '결과 파일'}</button></>}
      </p>
      {isSuper && files && <OpsFiles />}
      {d.rows.length === 0 ? <p className="muted">적용 기록 없음 — 이 판(v10.244)부터 API 가 뜰 때 적습니다</p> : (
        <table className="tbl">
          <thead><tr><th>시각(한국)</th><th>판</th><th>무엇</th><th>앞 판</th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id} data-release-row={r.kind}>
                <td>{r.at}</td><td>{r.version}</td>
                <td className={r.kind === 'BACK' ? 'warn-text' : ''}>{REL_KO[r.kind]}</td>
                <td className="muted">{r.prev ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* v10.248 (D203 · docs/386) — 서버 자원 추세(하루 한 줄 · 최근 30일 · 기준까지 남은 날 · 읽기만) */
interface TrendData { rows: Array<{ day: string; disk: number | null; freeGB: number | null; mem: number }>; limit: number; slope: number | null; daysToLimit: number | null; points: number; last: number | null }
export function ServerTrend() {
  const q = useApi<TrendData>('/admin/launch-watch/server-trend', []);
  const d = q.data;
  if (!d) return null;
  const over = d.limit > 0 && d.last !== null && d.last >= d.limit;
  const soon = d.daysToLimit !== null && d.daysToLimit <= 30;
  return (
    <div className={`card${over || soon ? ' warn' : ''}`} data-server-trend data-server-trend-points={d.rows.length}
         data-server-trend-slope={d.slope ?? 'none'} data-server-trend-days={d.daysToLimit ?? 'none'}>
      <h3 className="sec">서버 자원 추세 <small className="dim">하루 한 줄(그날 처음 잰 값) · 최근 30일 · 막대 = 디스크 % · 기준 {d.limit}%</small></h3>
      <p className={over || soon ? 'warn-text' : ''}>
        {d.slope === null ? `기록 ${d.points}일 — 3일부터 늘어나는 빠르기를 계산합니다`
          : over ? `디스크 ${d.last}% — 이미 기준 ${d.limit}% 를 넘었습니다(옛 판 · 백업 묶음 정리 또는 디스크 늘리기)`
          : d.daysToLimit !== null ? `최근 ${d.points}일 디스크가 하루 ${d.slope > 0 ? '+' : ''}${d.slope}%p — 이대로면 약 ${d.daysToLimit}일 뒤 ${d.limit}%`
          : `최근 ${d.points}일 디스크가 하루 ${d.slope > 0 ? '+' : ''}${d.slope}%p — 늘지 않음`}
      </p>
      {d.rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, borderBottom: '1px solid var(--line)' }}>
          {d.rows.map((r) => (
            <div key={r.day} data-server-trend-day={r.day} title={`${r.day} · 디스크 ${r.disk ?? '–'}% · 남은 ${r.freeGB ?? '–'}GB · 메모리 ${r.mem}%`}
                 style={{ flex: 1, maxWidth: 18, height: `${Math.max(2, r.disk ?? 0) * 0.8}px`,
                          background: r.disk !== null && d.limit > 0 && r.disk >= d.limit ? 'var(--danger)' : 'var(--accent)' }} />
          ))}
        </div>
      )}
      {d.rows.length > 0 && <small className="dim">{d.rows[0]!.day} ~ {d.rows[d.rows.length - 1]!.day} · 막대에 마우스를 올리면 그날 디스크 · 남은 GB · 메모리</small>}
    </div>
  );
}
