import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.353 ~ 356 (D235 · docs/487 ~ 490) — 감사 · 감시 빈 곳 채우기
 *   AuditChainBox     위험감지 › 「감사」 — 감사 기록 위변조 확인(사슬) · 지금 확인(SUPER) · 월간 보안 보고 미리 보기(SUPER)
 *   StaffActivityBox  위험감지 › 「운영자 권한」 — 운영자별 30일 한 일 · 개인정보 열람 · 90일 쉼 「거둘 후보」(SUPER)
 *   DeniedBox         권한 계층 › 「접속 인증」 — 막힌 접속(Nginx 403) · 「허용에 더하기」(SUPER)
 * ------------------------------------------------------------------- */

interface Chain { last: { at: string; ok: boolean; rows: number; brokenId: string | null; reason: string | null } | null; chained: number; before: number; checks24: number; bad30: number }

export function AuditChainBox() {
  const q = useApi<Chain>('/admin/security/audit-chain');
  const a = useAct();
  const sup = tokenRoles().includes('SUPER');
  const [month, setMonth] = useState<string | null>(null);
  if (q.error || !q.data) return null;
  const d = q.data;
  const toggleMonth = () => {
    if (month !== null) { setMonth(null); return; }
    void api<{ text: string }>('/admin/security/monthly').then((r) => setMonth(r.text)).catch(() => setMonth('월간 보안 보고를 읽지 못했습니다.'));
  };
  const state = !d.last ? 'none' : d.last.ok ? 'ok' : 'broken';
  return (
    <div className={`ad-nt ${state === 'broken' ? 'warn' : 'info'}`} data-audit-chain={state}>
      <Flash msg={a.msg} err={a.err} />
      <b>감사 기록 위변조 확인</b>{' '}
      {state === 'none' ? '아직 확인 전(정기 작업이 매시간 확인)' : state === 'ok'
        ? <>사슬 <b>온전</b> · 마지막 확인 {ymdhm(d.last!.at)}</>
        : <><b className="warn-text">끊김 — 줄 {d.last!.brokenId}</b> · {d.last!.reason} · {ymdhm(d.last!.at)}</>}
      {' '}· 사슬에 든 줄 {d.chained.toLocaleString('ko-KR')} · 사슬 전 줄 {d.before.toLocaleString('ko-KR')} · 24시간 확인 {d.checks24}번{d.bad30 ? <> · <b className="warn-text">30일 끊김 {d.bad30}번</b></> : null}
      {sup && <>{' '}<button className="btn-sm" disabled={a.busy === 'chk'} onClick={() => void a.run('chk', () => api('/admin/security/audit-chain/check', { method: 'POST' }), q.reload, (r: unknown) => ((r as { ok: boolean }).ok ? '온전합니다.' : '끊긴 곳이 있습니다 — 위 줄을 보십시오.'))} data-audit-chain-check="">지금 확인</button>{' '}
        <button className="linkbtn" onClick={toggleMonth} data-sec-monthly-toggle="">{month === null ? '월간 보안 보고 미리 보기' : '월간 보안 보고 닫기'}</button></>}
      {month !== null && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6 }} data-sec-monthly="">{month}</pre>}
    </div>
  );
}

interface Act { id: string; email: string; roles: string[]; lastLogin: string | null; acts: number; lastAct: string | null; pii: number; groups: Array<{ grp: string; n: number }>; idle90: boolean }

export function StaffActivityBox() {
  const [days, setDays] = useState(30);
  const q = useApi<{ days: number; rows: Act[]; idle90: number }>(`/admin/security/staff-activity?days=${days}`, [days]);
  if (q.error || !q.data) return null;
  const d = q.data;
  return (
    <div className="card" data-staff-activity={d.rows.length}>
      <h3 className="sec">운영자 활동 요약 <small className="dim">최근 {d.days}일 · 감사 기록 기준 · 「거둘 후보」= 90일 동안 로그인도 한 일도 없음 — 거두기는 회원 › 회원 상세 「권한 주기 · 거두기」</small></h3>
      <p>
        {[7, 30, 90].map((n) => <button key={n} className={`btn-sm ${days === n ? 'btn-ok' : 'btn-plain'}`} onClick={() => setDays(n)}>{n}일</button>)}
        {d.idle90 > 0 && <b className="warn-text" data-staff-idle={d.idle90}> 거둘 후보 {d.idle90}명</b>}
      </p>
      <table className="tbl"><thead><tr><th>운영자</th><th>역할</th><th>마지막 로그인</th><th>한 일</th><th>묶음</th><th>개인정보 열람</th><th>마지막 한 일</th></tr></thead><tbody>
        {d.rows.map((r) => (
          <tr key={r.id} data-staff-row={r.idle90 ? 'idle' : 'on'}>
            <td>{r.email}{r.idle90 && <span className="badge badge-urgent"> 거둘 후보</span>}</td>
            <td>{r.roles.join(' · ')}</td>
            <td>{r.lastLogin ? ymdhm(r.lastLogin) : <span className="dim">없음</span>}</td>
            <td>{r.acts}</td>
            <td className="dim">{r.groups.map((g) => `${g.grp} ${g.n}`).join(' · ') || '—'}</td>
            <td>{r.pii}</td>
            <td>{r.lastAct ? ymdhm(r.lastAct) : <span className="dim">없음</span>}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

interface Denied { installed: boolean; at: string | null; total7: number; full: boolean; rows: Array<{ ip: string; n7: number; n24: number; last: string; paths: string[]; allowed: boolean }> }

export function DeniedBox({ onPick }: { onPick?: (ip: string) => void }) {
  const q = useApi<Denied>('/admin/staff-access/denied');
  if (q.error || !q.data) return null;
  const d = q.data;
  return (
    <div className="card" data-denied={d.installed ? d.rows.length : 'off'}>
      <h3 className="sec">막힌 접속 <small className="dim">허용 IP 밖에서 운영 화면에 들어오려다 Nginx 가 막은 기록 · 최근 7일 · 10분마다 요약{d.at ? ` · ${ymdhm(d.at)} 기준` : ''}</small></h3>
      {!d.installed ? <p className="muted">아직 기록이 없습니다 — 운영 서버에 감시 서비스(v10.353 판)를 설치한 뒤 나옵니다(nginx-allow-watch-install.sh).</p>
        : d.rows.length === 0 ? <p className="muted">최근 7일 막힌 접속이 없습니다.</p> : (
          <>
            <p>7일 동안 <b>{d.total7}</b>번 · IP {d.rows.length}곳{d.full ? '' : ' · IP 는 가려서 보임(SUPER 만 전부)'}</p>
            <table className="tbl"><thead><tr><th>IP</th><th>7일</th><th>24시간</th><th>마지막</th><th>주소</th><th /></tr></thead><tbody>
              {d.rows.map((r) => (
                <tr key={r.ip} data-denied-row={r.ip}>
                  <td>{r.ip}{r.allowed && <span className="badge"> 지금 허용됨</span>}</td>
                  <td>{r.n7}</td><td className={r.n24 >= 100 ? 'warn-text' : undefined}>{r.n24}</td><td>{ymdhm(r.last)}</td>
                  <td className="dim">{r.paths.join(' · ')}</td>
                  <td>{d.full && onPick && !r.allowed && <button className="btn-sm btn-plain" onClick={() => onPick(r.ip)} data-denied-pick={r.ip}>허용에 더하기</button>}</td>
                </tr>
              ))}
            </tbody></table>
            <p className="dim">우리 쪽 IP 가 바뀌어 막힌 것이면 「허용에 더하기」 → 메모 · 기한을 넣고 더한 뒤 「Nginx 반영」 › 「적용」. 모르는 IP 가 많이 두드리면 그대로 두면 됩니다(계속 막힘).</p>
          </>
        )}
    </div>
  );
}
