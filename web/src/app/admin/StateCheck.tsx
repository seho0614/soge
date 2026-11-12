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
 */
interface TodoRow { key: string; label: string; done: boolean | null; now: string; go: string; manual?: boolean }
export function OwnerTodo({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const q = useApi<{ rows: TodoRow[]; done: number; total: number }>('/admin/launch-watch/owner-todo', []);
  const a = useAct();
  const [edit, setEdit] = useState<string | null>(null);
  const [note, setNote] = useState('');
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
              </td>
              <td>{canGo(r.go) && <button className="linkbtn" onClick={() => onGo(r.go)} data-owner-go={r.go}>보러 가기</button>}
                {r.manual && isSuper && edit !== r.key && <button className="linkbtn" onClick={() => { setEdit(r.key); setNote(''); a.clear(); }} data-owner-mark={r.key}>적기</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
