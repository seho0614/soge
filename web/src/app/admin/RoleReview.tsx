import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Op { id: string; name: string | null; email: string; status: string; roles: string[]; grantedAt: string; lastLoginAt: string | null; mfa: boolean; idle: boolean }
interface Change { id: string; role: string; action: 'GRANT' | 'REVOKE'; reason: string | null; changedAt: string; targetName: string | null; targetEmail: string | null; changedByName: string | null }
interface Quarter { quarter: string; reviewedAt: string | null; reviewedBy: string | null; note: string | null; current: boolean }
interface Data { idleDays: number; items: Op[]; total: number; idleCount: number; noMfa: number; changes: Change[]; quarters: Quarter[] }

const ROLE_NAME: Record<string, string> = { SUPER: '최고 관리자', ADMIN: '운영', REVIEWER: '검수 담당', PAYOUT: '지급 담당' };

/**
 * SB-ADM-ROLE-010 운영자 권한 정기 점검 (v10.180 · D169 · docs/281 · SUPER)
 *
 * 운영 역할 계정마다 역할 · 받은 날 · 마지막 로그인 · 2단계 등록. 오래 안 쓴 계정(ops.role_idle_days)은 「정지 권함」(자동 정지 없음).
 * 분기마다 메모를 남겨 「점검 완료」 — 분기에 한 번 · 고칠 수 없음. 분기 15일째부터 지난 분기 점검이 없으면 운영 알림 ROLE_REVIEW_DUE.
 */
export function RoleReview() {
  const q = useApi<Data>('/admin/role-review');
  const a = useAct();
  const [note, setNote] = useState('');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const open = d.quarters.filter((x) => !x.reviewedAt).slice(0, 2);
  const target = open[0]?.quarter ?? null;
  const save = (quarter: string) => {
    if (note.trim().length < 5) { a.setErr('점검 메모를 5자 이상 적어 주십시오 — 무엇을 보고 어떻게 판단했는지.'); return; }
    if (!confirm(`${quarter} 운영자 권한 점검 완료를 남깁니다. 고칠 수 없습니다.`)) return;
    void a.run('review', () => api('/admin/role-review', { method: 'POST', body: JSON.stringify({ quarter, note: note.trim() }) }), () => { setNote(''); q.reload(); }, '점검을 남겼습니다.');
  };
  return (
    <section data-role-review="">
      <Flash msg={a.msg} err={a.err} />
      <p className="muted" data-role-summary="">운영자 {d.total}명 · 오래 안 씀({d.idleDays}일) <b className={d.idleCount ? 'warn-text' : ''}>{d.idleCount}</b>명 · 2단계 미등록 <b className={d.noMfa ? 'warn-text' : ''}>{d.noMfa}</b>명</p>
      <table className="tbl" data-role-operators="">
        <thead><tr><th>운영자</th><th>역할</th><th>받은 날</th><th>마지막 로그인</th><th>2단계</th><th>상태</th></tr></thead>
        <tbody>{d.items.map((o) => (
          <tr key={o.id} data-idle={o.idle ? '1' : '0'}>
            <td>{o.name ?? '(이름 없음)'} <small className="dim">{o.email}</small></td>
            <td>{o.roles.map((r) => ROLE_NAME[r] ?? r).join(' · ')}</td>
            <td className="muted">{new Date(o.grantedAt).toLocaleDateString('ko-KR')}</td>
            <td className="muted">{o.lastLoginAt ? ymdhm(o.lastLoginAt) : '없음'}</td>
            <td>{o.mfa ? '등록' : <span className="warn-text">미등록</span>}</td>
            <td>{o.status !== 'ACTIVE' ? <span className="dim">{o.status}</span> : o.idle ? <b className="warn-text">정지 권함</b> : '사용 중'}</td>
          </tr>))}</tbody>
      </table>

      <h3 className="sec">분기 점검</h3>
      <table className="tbl" data-role-quarters="">
        <thead><tr><th>분기</th><th>점검</th></tr></thead>
        <tbody>{d.quarters.map((x) => (
          <tr key={x.quarter} data-role-quarter={x.quarter}>
            <td>{x.quarter}{x.current && <small className="dim"> 이번 분기</small>}</td>
            <td>{x.reviewedAt ? <span className="muted">{x.reviewedBy ?? '—'} · {ymdhm(x.reviewedAt)} · {x.note}</span> : <b className={x.current ? '' : 'warn-text'}>점검 안 함</b>}</td>
          </tr>))}</tbody>
      </table>
      {target && (
        <p data-role-review-form="">
          <label>{open.length > 1 ? '' : `${target} `}점검 메모(5자 이상 · 고칠 수 없음){' '}
            <input name="role-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ width: '50%' }}
              placeholder="예) 운영자 3명 · 오래 안 쓴 계정 없음 · 역할 업무 범위 확인" /></label>{' '}
          {open.map((x) => (
            <button key={x.quarter} className="btn-ok" disabled={a.busy === 'review'} onClick={() => save(x.quarter)} data-role-save={x.quarter}>{x.quarter} 점검 완료</button>
          ))}
        </p>
      )}

      <h3 className="sec">최근 권한 변경</h3>
      {d.changes.length === 0 ? <p className="muted">권한 변경 기록이 없습니다.</p> : (
        <table className="tbl" data-role-changes="">
          <thead><tr><th>때</th><th>대상</th><th>역할</th><th>변경</th><th>사유</th><th>처리자</th></tr></thead>
          <tbody>{d.changes.map((c) => (
            <tr key={c.id}>
              <td className="muted">{ymdhm(c.changedAt)}</td>
              <td>{c.targetName ?? '—'} <small className="dim">{c.targetEmail}</small></td>
              <td>{ROLE_NAME[c.role] ?? c.role}</td>
              <td>{c.action === 'GRANT' ? '부여' : '회수'}</td>
              <td className="muted">{c.reason ?? '—'}</td>
              <td className="muted">{c.changedByName ?? '—'}</td>
            </tr>))}</tbody>
        </table>
      )}
      <div className="ad-nt info">오래 안 쓴 계정은 표시만 합니다 — 정지 · 권한 회수는 회원 상세에서 사유를 남겨 하십시오. 권한 점검 주기는 최신 고시로 확인이 필요합니다(docs/281).</div>
    </section>
  );
}
