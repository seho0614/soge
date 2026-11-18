import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.377 · 380 (D241 · docs/513 · 516)
 *   SettingScheduleBox   정책 › 「전체 설정」 위 — 설정 예약 변경(SUPER) · 기다리는 예약 · 최근 결과 · 취소
 *   MySessions           권한 계층 › 「내 비밀번호」 아래 — 내 로그인 기기 · 기기별 로그아웃(지금 이 기기는 여기서 못 끊음)
 * ------------------------------------------------------------------- */

interface Sched { id: string; key: string; value: string; runAt: string; reason: string; by: string | null; nowValue: string | null; state: 'WAITING' | 'APPLIED' | 'FAILED' | 'CANCELED'; doneAt: string | null; resultNote: string | null; canceledAt: string | null; cancelReason: string | null }
const ST: Record<Sched['state'], string> = { WAITING: '기다림', APPLIED: '바꿈', FAILED: '실패', CANCELED: '취소' };

export function SettingScheduleBox() {
  const q = useApi<{ waiting: Sched[]; recent: Sched[]; canEdit: boolean }>('/admin/setting-schedules');
  const a = useAct();
  const [f, setF] = useState({ key: '', value: '', at: '', reason: '' });
  if (q.error || !q.data) return null;
  const d = q.data;
  const save = () => void a.run('sched', () => api<{ note?: string }>('/admin/setting-schedules', { method: 'POST', body: JSON.stringify(f) }), () => { setF({ key: '', value: '', at: '', reason: '' }); q.reload(); }, (r) => r.note ?? '예약했습니다.');
  const cancel = (id: string) => {
    const r = prompt('이 예약을 취소합니다. 사유를 적으십시오(2 ~ 200자).');
    if (r) void a.run(`cancel${id}`, () => api(`/admin/setting-schedules/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: r }) }), q.reload);
  };
  return (
    <div className="card pad" data-setting-schedules={d.waiting.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>예약 변경</b> <small className="dim">정한 시각(한국)에 정기 작업이 이 화면과 같은 검사로 바꿉니다 — 최대 5분 늦을 수 있고, 그때 검사에 걸리면 바꾸지 않고 운영 알림(SETTING_SCHEDULE_FAIL). 바뀐 기록에는 예약한 사람 · 「예약 #번호」 사유로 남습니다. 비밀 값 · 주문 받기 · 사이트 점검은 예약할 수 없습니다.</small>
      {d.waiting.length === 0 ? <p className="muted">기다리는 예약이 없습니다.</p> : (
        <table className="tbl"><thead><tr><th>시각</th><th>키</th><th>지금 → 바꿀 값</th><th>사유</th><th>예약한 사람</th><th /></tr></thead>
          <tbody>{d.waiting.map((s) => (
            <tr key={s.id} data-setting-schedule={s.key}>
              <td>{s.runAt}</td><td><code>{s.key}</code></td><td>{s.nowValue ?? '—'} → <b>{s.value}</b></td><td>{s.reason}</td><td className="dim">{s.by ?? ''}</td>
              <td>{d.canEdit && <button className="btn-sm btn-plain" disabled={a.busy === `cancel${s.id}`} onClick={() => cancel(s.id)} data-setting-schedule-cancel={s.id}>취소</button>}</td>
            </tr>))}</tbody></table>
      )}
      {d.canEdit && (
        <p data-setting-schedule-form="">
          <input name="sched-key" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.trim() })} placeholder="키(예: member.withdraw_grace_days)" style={{ minWidth: 260 }} />{' '}
          <input name="sched-value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="바꿀 값" />{' '}
          <label>시각 <input type="datetime-local" name="sched-at" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>{' '}
          <input name="sched-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} placeholder="사유(꼭)" />{' '}
          <button className="btn-sm" disabled={a.busy === 'sched' || !f.key || !f.at || f.reason.trim().length < 2} onClick={save} data-setting-schedule-save="">예약</button>
          <small className="dim"> 10분 뒤 ~ 90일 안 · 키마다 하나</small>
        </p>
      )}
      {d.recent.length > 0 && (
        <details data-setting-schedule-recent={d.recent.length}><summary>최근 결과 {d.recent.length}줄</summary>
          <ul style={{ paddingLeft: 18 }}>{d.recent.map((s) => (
            <li key={s.id} data-setting-schedule-done={s.state}>
              <span className={s.state === 'FAILED' ? 'badge badge-urgent' : 'badge'}>{ST[s.state]}</span> {s.runAt} <code>{s.key}</code> → {s.value}{' '}
              <small className="dim">{s.state === 'CANCELED' ? `취소 ${s.canceledAt ? ymdhm(s.canceledAt) : ''} · ${s.cancelReason ?? ''}` : s.resultNote ?? ''}</small>
            </li>))}</ul>
        </details>
      )}
    </div>
  );
}

interface Sess { id: string; uaKind: string | null; ipMasked: string | null; createdAt: string; lastSeenAt: string; current: boolean }

export function MySessions() {
  const q = useApi<{ items: Sess[]; currentKnown: boolean; note: string | null }>('/me/sessions');
  const a = useAct();
  if (q.error || !q.data) return null;
  const d = q.data;
  const revoke = (s: Sess) => {
    if (!confirm(`${s.uaKind ?? '그 기기'} · ${s.ipMasked ?? ''} 에서 로그아웃합니다. 계속할까요?`)) return;
    void a.run(`rv${s.id}`, () => api<{ note?: string }>(`/me/sessions/${s.id}/revoke`, { method: 'POST' }), q.reload, (r) => r.note ?? '로그아웃했습니다.');
  };
  return (
    <section className="card pad" data-my-sessions={d.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>내 로그인 기기</b> <small className="dim">지금 로그인된 기기입니다(IP 앞 두 자리 · 브라우저 종류만). 모르는 기기가 있으면 로그아웃하고 비밀번호를 바꾸십시오.</small>
      {d.note && <p className="muted" data-my-sessions-note="">{d.note}</p>}
      {d.items.length === 0 ? <p className="muted">목록에 있는 기기가 없습니다.</p> : (
        <table className="tbl"><thead><tr><th>기기</th><th>IP</th><th>처음 로그인</th><th>마지막으로 씀</th><th /></tr></thead>
          <tbody>{d.items.map((s) => (
            <tr key={s.id} data-my-session={s.current ? 'current' : 'other'}>
              <td>{s.uaKind ?? '—'}{s.current && <> <span className="badge">지금 이 기기</span></>}</td><td>{s.ipMasked ?? '—'}</td><td>{ymdhm(s.createdAt)}</td><td>{ymdhm(s.lastSeenAt)}</td>
              <td>{!s.current && <button className="btn-sm btn-plain" disabled={a.busy === `rv${s.id}`} onClick={() => revoke(s)} data-my-session-revoke={s.id}>로그아웃</button>}</td>
            </tr>))}</tbody></table>
      )}
    </section>
  );
}
