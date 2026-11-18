import { useEffect, useState } from 'react';
import { api, setToken, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.369 ~ 371 (D239 · docs/504 ~ 506)
 *   MyPassword       권한 계층 › 「내 비밀번호」 — 운영자 비밀번호 바꾸기(회원 역할 없어도)
 *   AlertMuteBox     위험감지 › 「운영 알림」 — 종류 잠시 끄기(SUPER) · 끈 목록 · 일찍 풀기
 *   MaintenanceBox   첫 화면 「공개 직후 지켜보기」 — 사이트 점검 예약 · 지우기(SUPER)
 * ------------------------------------------------------------------- */

export function MyPassword() {
  const a = useAct();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const short = nw.length > 0 && nw.length < 12;
  const diff = nw2.length > 0 && nw !== nw2;
  const save = () => void a.run('pw', async () => {
    const r = await api<{ note: string; accessToken: string; refreshToken: string }>('/admin/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
    setToken(r.accessToken, r.refreshToken);
    setCur(''); setNw(''); setNw2('');
    return r;
  }, undefined, (r) => r.note);
  return (
    <section className="card pad" data-my-password="">
      <Flash msg={a.msg} err={a.err} />
      <p className="muted">운영 역할 계정은 <b>12자 이상</b> · 영문 · 숫자 · 특수문자를 섞고, <b>최근 3개는 다시 쓸 수 없습니다</b>. 90일마다 바꾸기를 권합니다. 지금 비밀번호를 5번 틀리면 30분 잠깁니다. 바꾸면 다른 기기의 로그인은 모두 풀립니다(이 화면은 그대로).</p>
      <p><label>지금 비밀번호 <input type="password" name="pw-current" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label></p>
      <p><label>새 비밀번호 <input type="password" name="pw-new" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} /></label>
        {short && <small className="warn-text"> 12자 이상</small>}</p>
      <p><label>새 비밀번호 확인 <input type="password" name="pw-new2" autoComplete="new-password" value={nw2} onChange={(e) => setNw2(e.target.value)} /></label>
        {diff && <small className="warn-text"> 두 칸이 다릅니다</small>}</p>
      <p><button className="btn-ok" disabled={a.busy === 'pw' || !cur || nw.length < 12 || nw !== nw2} onClick={save} data-my-password-save="">비밀번호 바꾸기</button></p>
    </section>
  );
}

interface Mute { id: string; code: string; untilAt: string; reason: string; createdAt: string; by: string | null; liftedAt: string | null; liftReason: string | null; active: boolean; leftMin: number }

export function AlertMuteBox({ codes, name, pick }: { codes: string[]; name: Record<string, string>; pick?: string }) {
  const q = useApi<{ active: Mute[]; recent: Mute[]; canEdit: boolean }>('/admin/alert-mutes');
  const a = useAct();
  const [code, setCode] = useState('');
  const [hours, setHours] = useState(4);
  const [reason, setReason] = useState('');
  useEffect(() => { if (pick) setCode(pick); }, [pick]);
  if (q.error || !q.data) return null;
  const d = q.data;
  const mute = () => void a.run('mute', () => api('/admin/alert-mutes', { method: 'POST', body: JSON.stringify({ code, hours, reason }) }), () => { setReason(''); q.reload(); });
  const lift = (id: string) => {
    const r = prompt('다시 켭니다. 사유를 적으십시오(2 ~ 200자).');
    if (r) void a.run(`lift${id}`, () => api(`/admin/alert-mutes/${id}/lift`, { method: 'POST', body: JSON.stringify({ reason: r }) }), q.reload);
  };
  const can = codes.filter((c) => c !== 'AUDIT_CHAIN_BROKEN' && !d.active.some((m) => m.code === c));
  return (
    <div className="card" data-alert-mutes={d.active.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>잠시 끈 알림</b> <small className="dim">끄는 동안 그 종류는 텔레그램 · 슬랙 · 메일 · 당번으로 보내지 않습니다(알림 기록 · 이 화면은 그대로 · 끝나면 저절로 켜짐 · 감사 기록 위변조는 끌 수 없음)</small>
      {d.active.length === 0 ? <p className="muted">꺼진 알림이 없습니다.</p> : (
        <ul style={{ paddingLeft: 18 }}>
          {d.active.map((m) => (
            <li key={m.id} data-alert-muted={m.code}>
              <b>{name[m.code] ?? m.code}</b> <span className="badge">끔 · {ymdhm(m.untilAt)} 까지({m.leftMin}분)</span> {m.reason} <small className="dim">{m.by ?? ''}</small>{' '}
              {d.canEdit && <button className="btn-sm btn-plain" disabled={a.busy === `lift${m.id}`} onClick={() => lift(m.id)} data-alert-unmute={m.id}>다시 켜기</button>}
            </li>
          ))}
        </ul>
      )}
      {d.canEdit && (
        <p data-alert-mute-form="">
          <select name="mute-code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="알림 종류">
            <option value="">알림 종류 고르기</option>
            {can.map((c) => <option key={c} value={c}>{name[c] ?? c} ({c})</option>)}
          </select>{' '}
          <select name="mute-hours" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="시간">
            {[1, 4, 24].map((h) => <option key={h} value={h}>{h}시간</option>)}
          </select>{' '}
          <input name="mute-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="사유(꼭)" />{' '}
          <button className="btn-sm" disabled={a.busy === 'mute' || !code || reason.trim().length < 2} onClick={mute} data-alert-mute="">잠시 끄기</button>
        </p>
      )}
    </div>
  );
}

interface Maint { from: string | null; until: string | null; note: string; noteEn: string; on: boolean; soon: boolean; past: boolean; canEdit: boolean; notice?: { at: string; sent: number; mailed: boolean } | null; mail?: boolean }

export function MaintenanceBox() {
  const q = useApi<Maint>('/admin/maintenance');
  const a = useAct();
  const [f, setF] = useState({ from: '', until: '', note: '', noteEn: '', reason: '' });
  if (q.error || !q.data) return null;
  const d = q.data;
  const has = !!d.from && !d.past;
  const save = () => void a.run('maint', () => api('/admin/maintenance', { method: 'POST', body: JSON.stringify(f) }), () => { setF({ ...f, reason: '' }); q.reload(); });
  const clear = () => {
    const r = prompt(d.on ? '점검을 지금 끝냅니다(사용자 웹은 최대 5분 뒤 돌아옴). 사유를 적으십시오.' : '점검 예약을 지웁니다. 사유를 적으십시오.');
    if (r) void a.run('maintClear', () => api('/admin/maintenance/clear', { method: 'POST', body: JSON.stringify({ reason: r }) }), q.reload);
  };
  return (
    <div className="card" data-maintenance-box={d.on ? 'on' : d.soon ? 'soon' : has ? 'set' : 'none'}>
      <Flash msg={a.msg} err={a.err} />
      <b>사이트 점검 예약</b>{' '}
      {d.on ? <b className="warn-text">지금 점검 중 — 사용자 웹이 「점검 중」 화면({d.until?.replace('T', ' ')} 까지)</b>
        : has ? <span className={d.soon ? 'warn-text' : ''}>{d.from?.replace('T', ' ')} ~ {d.until?.replace('T', ' ')}{d.soon ? ' · 지금 사용자 웹에 안내 띠' : ''}</span>
        : <span className="muted">예약 없음</span>}
      {has && d.canEdit && <> <button className="btn-sm btn-plain" disabled={a.busy === 'maintClear'} onClick={clear} data-maintenance-clear="">{d.on ? '지금 끝내기' : '예약 지우기'}</button></>}
      {has && !d.on && (
        <p data-maintenance-notice={d.notice ? 'sent' : 'wait'}>
          {d.notice ? <>회원 알림 보냄 · {d.notice.at} · {d.notice.sent.toLocaleString()}명{d.notice.mailed ? ' · 메일 함께' : ' · 사이트 알림만'}</>
            : <span className="dim">회원 알림 — 시작 24시간 전에 쓰는 회원 모두에게 사이트 알림을 한 번 보냅니다{d.mail ? '(메일 함께)' : '(메일은 꺼짐 · 정책 › 전체 설정 site.maintenance_mail)'}.</span>}
        </p>
      )}
      <p className="muted">점검 시각 안에는 사용자 웹 모든 화면이 「점검 중」 안내로 바뀝니다(운영 화면 · API 는 그대로). 시작 24시간 전부터 안내 띠 · 끝 시각이 지나면 저절로 풀림 · 사용자 웹은 최대 5분 늦게 바뀝니다.</p>
      {d.canEdit && !d.on && (
        <p data-maintenance-form="">
          <label>시작 <input type="datetime-local" name="maint-from" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>{' '}
          <label>끝 <input type="datetime-local" name="maint-until" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></label>{' '}
          <input name="maint-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} placeholder="안내 글(선택)" />{' '}
          <input name="maint-note-en" value={f.noteEn} onChange={(e) => setF({ ...f, noteEn: e.target.value })} maxLength={200} placeholder="English note(optional)" />{' '}
          <input name="maint-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} placeholder="사유(꼭)" />{' '}
          <button className="btn-sm" disabled={a.busy === 'maint' || !f.from || !f.until || f.reason.trim().length < 2} onClick={save} data-maintenance-save="">점검 예약</button>
          <small className="dim"> 시각은 한국 시각 · 끝은 시작 뒤 12시간까지</small>
        </p>
      )}
    </div>
  );
}

export const isSuperNow = () => tokenRoles().includes('SUPER');
