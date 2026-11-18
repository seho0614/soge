import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.365 ~ 368 (D238 · docs/500 ~ 503)
 *   MemberActivityBox  회원 › 회원 상세 — 활동 한 줄 기록(최근 100 · 종류 거르기)
 *   exportTicket()     내려받기 단추 4곳 — 승인 번호 받기(없으면 사유 물어 요청)
 *   ExportApprovalBox  위험감지 › 「감사」 — 내려받기 승인(기다림 · 승인 · 거절 · 내 요청)
 *   RestoreDrillBox    관 관리 › 「업무 안내」 — DB 복원 시험 기록 · 적기(SUPER)
 * ------------------------------------------------------------------- */

interface Act { rows: Array<{ at: string; kind: string; label: string; text: string }>; kind: string | null; kinds: Array<{ kind: string; label: string }>; counts: Record<string, number> }

export function MemberActivityBox({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="card" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-member-activity="">
      <summary><b>활동 기록</b> <small className="dim">가입 · 본인인증 · 로그인 · 문의 · 신고 · 정지 · 메모 · 권한 · 탈퇴 — 최근 100줄 · 열면 개인정보 접속기록에 남음</small></summary>
      {open && <ActivityList accountId={accountId} />}
    </details>
  );
}

function ActivityList({ accountId }: { accountId: string }) {
  const [kind, setKind] = useState('');
  const q = useApi<Act>(`/admin/accounts/${accountId}/activity${kind ? `?kind=${kind}` : ''}`, [accountId, kind]);
  return (
    <div data-activity-list={q.data ? q.data.rows.length : ''}>
      {q.error ? <p className="warn-text">활동 기록을 읽지 못했습니다.</p> : null}
      {q.data && (
        <>
          <p>
            <select name="activity-kind" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류">
              <option value="">모두</option>
              {q.data.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}{q.data!.counts[k.kind] != null ? ` (${q.data!.counts[k.kind]})` : ''}</option>)}
            </select>
          </p>
          {q.data.rows.length === 0 ? <p className="muted">기록이 없습니다.</p> : (
            <table className="tbl"><tbody>
              {q.data.rows.map((r, i) => (
                <tr key={i} data-activity-row={r.kind}><td style={{ whiteSpace: 'nowrap' }}>{ymdhm(r.at)}</td><td><span className="badge">{r.label}</span></td><td>{r.text}</td></tr>
              ))}
            </tbody></table>
          )}
        </>
      )}
    </div>
  );
}

/** 내려받기 단추 — 승인 번호를 돌려줌(없으면 사유를 물어 요청 · 기다려야 하면 null) */
export async function exportTicket(target: 'POINT_REPORT' | 'AUDIT_EXPORT' | 'NOTICE_READS' | 'RATE_READS' | 'ACCT_JOURNAL' | 'ACCT_TAX'): Promise<string | null> {
  const r = await api<{ id: string | null; pendingId: string | null }>(`/admin/export-requests/ready?target=${target}`);
  if (r.id) return r.id;
  if (r.pendingId) { alert('이 자료의 내려받기 요청이 승인을 기다리고 있습니다(위험감지 › 감사 › 「내려받기 승인」).'); return null; }
  const reason = prompt('개인정보가 든 자료입니다. 내려받는 사유를 적으십시오(2 ~ 200자). 승인 뒤 24시간 안 한 번 내려받을 수 있습니다.');
  if (!reason || reason.trim().length < 2) return null;
  const x = await api<{ id: string; state: string; note: string }>('/admin/export-requests', { method: 'POST', body: JSON.stringify({ target, reason }) });
  if (x.state === 'APPROVED') return x.id;
  alert(x.note);
  return null;
}

interface Req { id: string; target: string; targetLabel: string; reason: string; state: string; solo: boolean; requestedAt: string; decidedAt: string | null; decideNote: string | null; usedAt: string | null; ready: boolean; requestedBy: string; decidedBy: string | null; mine?: boolean }
const ST_KO: Record<string, string> = { PENDING: '기다림', APPROVED: '승인', REJECTED: '거절' };

export function ExportApprovalBox() {
  const q = useApi<{ pending: Req[]; mine: Req[]; recent: Req[]; today: number; dailyMax: number; canDecide: boolean; superOthers: number | null }>('/admin/export-requests');
  const a = useAct();
  if (q.error || !q.data) return null;
  const d = q.data;
  const decide = (id: string, approve: boolean) => {
    const note = approve ? '' : prompt('거절 사유(선택)') ?? '';
    void a.run(`d${id}`, () => api(`/admin/export-requests/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve, note }) }), q.reload);
  };
  const line = (r: Req) => (
    <li key={r.id} data-export-req={r.state}>
      <b>{r.targetLabel}</b> <span className="badge">{ST_KO[r.state] ?? r.state}{r.solo ? ' · 혼자 승인' : ''}{r.usedAt ? ' · 내려받음' : r.ready ? ' · 내려받기 가능' : ''}</span>{' '}
      {r.reason} <small className="dim">{ymdhm(r.requestedAt)} · {r.requestedBy}{r.decidedBy ? ` → ${r.decidedBy}` : ''}{r.decideNote ? ` · ${r.decideNote}` : ''}</small>
    </li>
  );
  return (
    <div className="card" data-export-approval={d.pending.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>내려받기 승인</b> <small className="dim">개인정보가 든 CSV 4곳(원천징수 신고 자료 · 감사 기록 · 공지 읽음 · 요율 공지 읽음) — 요청 → 다른 SUPER 승인 → 24시간 안 한 번 · 오늘 내 요청 {d.today} / {d.dailyMax}
        {d.canDecide && d.superOthers === 0 ? ' · SUPER 가 한 명이라 SUPER 요청은 스스로 승인(「혼자 승인」으로 남음)' : ''}</small>
      {d.canDecide && (d.pending.length === 0 ? <p className="muted">기다리는 요청이 없습니다.</p> : (
        <ul style={{ paddingLeft: 18 }}>
          {d.pending.map((r) => (
            <li key={r.id} data-export-pending={r.id}>
              <b>{r.targetLabel}</b> {r.reason} <small className="dim">{ymdhm(r.requestedAt)} · {r.requestedBy}</small>{' '}
              <button className="btn-sm btn-ok" disabled={!!r.mine && d.superOthers !== 0} onClick={() => decide(r.id, true)} data-export-approve={r.id}>승인</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => decide(r.id, false)} data-export-reject={r.id}>거절</button>
              {r.mine && d.superOthers !== 0 && <small className="dim"> 자기 요청은 다른 SUPER 가</small>}
            </li>
          ))}
        </ul>
      ))}
      {d.mine.length > 0 && <><p className="muted">내 요청</p><ul style={{ paddingLeft: 18 }}>{d.mine.slice(0, 10).map(line)}</ul></>}
      {d.canDecide && d.recent.length > 0 && <><p className="muted">최근 결정</p><ul style={{ paddingLeft: 18 }}>{d.recent.slice(0, 10).map(line)}</ul></>}
    </div>
  );
}

interface Drill { id: string; drillDate: string; snapshot: string; minutes: number; rowsMatch: boolean; ok: boolean; note: string | null; createdAt: string; by: string | null }

export function RestoreDrillBox() {
  const q = useApi<{ rows: Drill[]; last: Drill | null; daysSince: number | null; dueDays: number; overdue: boolean; canEdit: boolean }>('/admin/restore-drills');
  const a = useAct();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [f, setF] = useState({ drillDate: today, snapshot: '', minutes: '', rowsMatch: true, ok: true, note: '' });
  if (q.error || !q.data) return null;
  const d = q.data;
  const save = () => void a.run('save', () => api('/admin/restore-drills', { method: 'POST', body: JSON.stringify({ ...f, minutes: Number(f.minutes) }) }),
    () => { setF({ ...f, snapshot: '', minutes: '', note: '' }); q.reload(); });
  return (
    <div className="card" data-restore-drills={`${d.rows.length}|${d.overdue ? 'over' : 'ok'}`}>
      <Flash msg={a.msg} err={a.err} />
      <b>DB 복원 시험 기록</b>{' '}
      <span className={d.overdue ? 'warn-text' : 'dim'}>{d.last ? `마지막 ${d.last.drillDate} (${d.daysSince}일 전)` : '아직 기록 없음'} · 주기 {d.dueDays}일{d.overdue ? ' — 할 때가 지났습니다' : ''}</span>
      <p className="muted">순서는 위 「DB 복원 시험(월 1회)」 업무 안내를 따릅니다. 운영 DB 는 건드리지 않고, 시험용으로 만든 DB 는 끝나면 지웁니다.</p>
      {d.rows.length > 0 && (
        <table className="tbl"><thead><tr><th>날</th><th>스냅샷</th><th>분</th><th>행 수</th><th>결과</th><th>메모</th></tr></thead><tbody>
          {d.rows.map((r) => (
            <tr key={r.id} data-restore-drill={r.ok ? 'ok' : 'bad'}><td>{r.drillDate}</td><td>{r.snapshot}</td><td>{r.minutes}</td><td>{r.rowsMatch ? '맞음' : '다름'}</td>
              <td>{r.ok ? '이상 없음' : <b className="warn-text">이상 있음</b>}</td><td>{r.note ?? ''} <small className="dim">{r.by ?? ''}</small></td></tr>
          ))}
        </tbody></table>
      )}
      {d.canEdit && (
        <p data-restore-drill-form="">
          <label>날 <input type="date" name="drill-date" value={f.drillDate} max={today} onChange={(e) => setF({ ...f, drillDate: e.target.value })} /></label>{' '}
          <label>스냅샷 <input name="drill-snapshot" value={f.snapshot} onChange={(e) => setF({ ...f, snapshot: e.target.value })} maxLength={100} placeholder="rds:sgb-db-2026-11-18-03-10" /></label>{' '}
          <label>걸린 분 <input name="drill-minutes" inputMode="numeric" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value.replace(/\D/g, '') })} style={{ width: 70 }} /></label>{' '}
          <label><input type="checkbox" name="drill-rows" checked={f.rowsMatch} onChange={(e) => setF({ ...f, rowsMatch: e.target.checked })} /> 행 수 맞음</label>{' '}
          <label><input type="checkbox" name="drill-ok" checked={f.ok} onChange={(e) => setF({ ...f, ok: e.target.checked })} /> 이상 없음</label>{' '}
          <input name="drill-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} placeholder="메모(선택)" />{' '}
          <button className="btn-sm btn-ok" disabled={a.busy === 'save' || f.snapshot.trim().length < 2 || !f.minutes} onClick={save} data-restore-drill-save="">적기</button>
        </p>
      )}
    </div>
  );
}
