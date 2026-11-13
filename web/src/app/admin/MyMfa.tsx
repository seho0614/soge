import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, setToken, tokenRoles } from '../../lib/api';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { ErrorView } from '../../components/ErrorView';
import { MfaSetup, type MfaStatus } from '../../components/MfaGate';

const MODE: Record<string, string> = { off: '쓰지 않음', SUPER: '최고 관리자만', ALL: '운영 역할 모두' };
/* v10.236 (docs/375) — 켜기 전 점검 */
interface TurnOn { mode: string; need: number; enrolled: number; notEnrolled: { name: string | null; email: string; roles: string[]; me: boolean }[]; meEnrolled: boolean; note: string }

/**
 * SB-ADM-MFA-010 내 2단계 인증 (v10.180 · D169 · docs/281)
 *
 * 설정이 꺼져 있어도 미리 등록할 수 있습니다(켜기 전 SUPER 가 먼저 등록해야 켜짐 — MFA_ENROLL_FIRST).
 * 다시 등록(휴대폰 바꿈 · 분실)은 최고 관리자가 회원 상세 「2단계 초기화」로 지운 뒤.
 * v10.203 (docs/324) — SUPER 는 여기서 설정(admin.mfa_required)을 바꿈(전에는 운영 화면 칸이 없어 서버 mfa-reset.sh 만) ·
 *   모든 운영 역할은 「모든 기기에서 로그아웃」(「운영자 낯선 로그인」이 본인이 아닐 때 — 비밀번호를 바꾼 뒤).
 * v10.236 (docs/375) — 설정에서 SUPER · ALL 을 고르면 저장 전에 「켜기 전 점검」(번호를 넣어야 하는 사람 · 등록 안 한 사람).
 */
export function MyMfa() {
  const q = useApi<MfaStatus>('/auth/mfa');
  const [setup, setSetup] = useState(false);
  const [mode, setMode] = useState('');
  const [pw, setPw] = useState('');
  const a = useAct();
  const isSuper = tokenRoles().includes('SUPER');
  const [pv, setPv] = useState<TurnOn | null>(null);
  const pick = mode && mode !== 'off' && mode !== q.data?.mode ? mode : '';
  useEffect(() => {
    setPv(null);
    if (!isSuper || !pick) return;
    let live = true;
    api<TurnOn>(`/admin/mfa/turn-on-preview?mode=${pick}`).then((r) => { if (live) setPv(r); }, () => { /* 점검만 못 보임 — 저장은 서버가 다시 봄 */ });
    return () => { live = false; };
  }, [pick, isSuper]);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const s = q.data;
  /* v10.266 (docs/395) — 켜기 흐름: ① 내 등록 → ② 켜기 전 점검(먼저 「최고 관리자만」) → ③ 켜기. 이미 켜져 있으면 「모두」로 넓히기 안내 */
  const step1 = s.enrolled;
  const target = s.mode === 'off' ? 'SUPER' : s.mode === 'SUPER' ? 'ALL' : '';
  const step2 = !!pv && pv.mode === target && pv.notEnrolled.length === 0;
  const step3 = target === '' || (target === 'SUPER' ? s.mode !== 'off' : s.mode === 'ALL');
  const STEP = (done: boolean, now: boolean) => (done ? <span className="st ok">됨</span> : now ? <b>지금</b> : <span className="dim">—</span>);
  return (
    <section data-my-mfa="">
      {isSuper && target && (
        <div className="card pad" data-mfa-flow={`${step1 ? 1 : 0}${step2 ? 1 : 0}${step3 ? 1 : 0}`} data-mfa-target={target}>
          <b>{target === 'SUPER' ? '2단계 인증 켜는 순서' : '「운영 역할 모두」로 넓히는 순서'}</b>
          <table className="tbl" style={{ marginTop: 6 }}><tbody>
            <tr data-mfa-flow-step="1"><td>① 내 등록</td><td>{STEP(step1, !step1)}</td>
              <td className="dim">{step1 ? '등록함' : <>인증 앱으로 등록 — 켜려면 내 등록이 먼저입니다(MFA_ENROLL_FIRST) <button className="btn-sm" onClick={() => setSetup(true)} data-mfa-flow-enroll="">등록 시작</button></>}</td></tr>
            <tr data-mfa-flow-step="2"><td>② 켜기 전 점검</td><td>{STEP(step2, step1 && !step2)}</td>
              <td className="dim">{pv && pv.mode === target ? (pv.notEnrolled.length ? `등록 안 한 사람 ${pv.notEnrolled.length}명 — 아래 목록 · 먼저 등록하도록 알리기` : `번호를 넣을 사람 ${pv.need}명 모두 등록함`)
                : <>「{MODE[target]}」로 켤 때 번호를 넣어야 할 사람 보기 <button className="btn-sm" disabled={!step1} onClick={() => setMode(target)} data-mfa-flow-check="">점검 보기</button></>}</td></tr>
            <tr data-mfa-flow-step="3"><td>③ 켜기</td><td>{STEP(step3, step1 && step2 && !step3)}</td>
              <td className="dim">아래 「설정 바꾸기」에서 「{MODE[target]}」 → 저장(운영 알림 「중요 설정 바뀜」이 남음){target === 'SUPER' ? ' · 익숙해지면 「운영 역할 모두」로 넓힘' : ''}</td></tr>
          </tbody></table>
        </div>
      )}
      <table className="tbl"><tbody>
        <tr><th>지금 설정</th><td data-mfa-mode={s.mode}>{MODE[s.mode] ?? s.mode} · 번호를 넣으면 {s.hours}시간 동안 다시 묻지 않음</td></tr>
        <tr><th>나에게 필요</th><td>{s.required ? '예' : '아니오'}</td></tr>
        <tr><th>내 등록</th><td data-mfa-enrolled={s.enrolled ? '1' : '0'}>{s.enrolled ? `등록함 · 남은 예비 번호 ${s.backupLeft ?? 0}개` : '등록 안 함'}</td></tr>
        {s.lockedUntil && <tr><th>잠금</th><td className="warn-text">번호가 여러 번 틀려 {ymdhm(s.lockedUntil)} 까지 막힘</td></tr>}
      </tbody></table>
      {!s.enrolled && (setup
        ? <div className="card pad" style={{ maxWidth: 520 }}><MfaSetup onDone={() => { setSetup(false); q.reload(); }} /></div>
        : <p><button className="btn-ok" onClick={() => setSetup(true)} data-mfa-start="">2단계 인증 등록</button></p>)}
      {s.enrolled && (s.backupLeft ?? 0) <= 3 && <p className="warn-text">예비 번호가 {s.backupLeft ?? 0}개 남았습니다 — 최고 관리자에게 초기화를 요청해 다시 등록하면 새 예비 번호 10개를 받습니다.</p>}
      {isSuper && (
        <p data-mfa-setting="">
          <label>설정 바꾸기(최고 관리자){' '}
            <select name="mfa-mode" value={mode || s.mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODE).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>{' '}
          <button className="btn-sm" disabled={a.busy === 'mode' || !mode || mode === s.mode} data-mfa-save=""
            onClick={() => {
              if (!confirm(`운영자 2단계 인증을 「${MODE[mode] ?? mode}」로 바꿉니다. 켜면 해당 운영자는 다음 요청부터 번호를 넣어야 운영 화면을 씁니다.${pv && pv.mode === mode && pv.notEnrolled.length ? `\n아직 등록 안 한 운영자 ${pv.notEnrolled.length}명은 다음 로그인 때 등록부터 해야 합니다.` : ''}`)) return;
              void a.run('mode', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'admin.mfa_required', value: mode }) }), () => { setMode(''); q.reload(); });
            }}>저장</button>
          <small className="dim"> 켜려면 먼저 내 등록이 있어야 합니다 · 바꾸면 운영 알림 「중요 설정 바뀜」</small>
        </p>
      )}
      {isSuper && pv && pick === pv.mode && (
        <div className={`ad-nt ${pv.notEnrolled.length ? 'warn' : 'info'}`} data-mfa-turnon={pv.notEnrolled.length}>
          <b>켜기 전 점검 — 「{MODE[pv.mode]}」</b> {pv.note}
          {pv.notEnrolled.length > 0 && (
            <ul data-mfa-turnon-list="">
              {pv.notEnrolled.map((x) => <li key={x.email}>{x.name ?? '(이름 없음)'} · <span className="mono">{x.email}</span> · {x.roles.join(' · ')}{x.me ? ' · 나' : ''}</li>)}
            </ul>
          )}
          {pv.notEnrolled.length > 0 && <small className="dim">등록 안 한 사람에게 먼저 「내 2단계 인증」에서 등록하도록 알리면 켠 뒤 바로 들어올 수 있습니다.</small>}
        </div>
      )}
      <h3 className="sec">모든 기기에서 로그아웃</h3>
      <p data-logout-all="">
        <input type="password" name="logout-all-pw" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="지금 비밀번호" autoComplete="current-password" />{' '}
        <button className="btn-no" disabled={a.busy === 'logout-all' || pw.length < 1} data-logout-all-btn=""
          onClick={() => {
            if (!confirm('이 계정의 다른 기기 로그인을 모두 풉니다. 이 브라우저는 그대로 씁니다.')) return;
            void a.run('logout-all', async () => {
              const r = await api<{ ok: boolean; note: string; accessToken: string; refreshToken: string }>('/me/logout-all', { method: 'POST', body: JSON.stringify({ password: pw }) });
              setToken(r.accessToken, r.refreshToken);
              setPw('');
              return r;
            });
          }}>모든 기기에서 로그아웃</button>
        <small className="dim"> 「운영자 낯선 로그인」이 본인이 아니면 비밀번호를 바꾼 뒤 누릅니다.</small>
      </p>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-nt info">휴대폰을 바꾸거나 잃어버렸으면 최고 관리자가 회원 상세 「2단계 초기화」로 지운 뒤 다시 등록합니다. 아무도 들어오지 못할 때는 서버에서 deploy/aws/mfa-reset.sh(docs/281).</div>
    </section>
  );
}
