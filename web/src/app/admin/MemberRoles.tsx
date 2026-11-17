import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { GRANTABLE, ROLE_LABEL } from './RoleAdmin';

/**
 * v10.333 (docs/464) — 회원 상세에서 권한 주기 · 거두기
 *
 * 대표 11/17 「회원 권한을 관리자 · 수퍼 권한을 지정할 수 있도록」. 전에는 회원 상세에 권한이 보이기만 하고
 * 주기는 「권한 계층 › 권한 관리 › 역할 주기」에서만 됐습니다. 같은 API(POST /admin/reports/roles · SUPER · 사유 필수)를 씁니다.
 * 서버 규칙 그대로 — 자기 권한은 못 바꿈(SELF_GRANT) · 마지막 SUPER 는 못 거둠 · 지급 담당(PAYOUT)은 주지 않음 · 기록은 고칠 수 없음.
 */
export function MemberRoles({ accountId, name, roles, onDone }: { accountId: string; name: string; roles: string[]; onDone: () => void }) {
  const isSuper = tokenRoles().includes('SUPER');
  const can = GRANTABLE.filter((r) => !roles.includes(r));
  const [role, setRole] = useState(can.includes('ADMIN') ? 'ADMIN' : (can[0] ?? ''));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  if (!isSuper) return <p className="muted" data-member-roles="read">권한 주기 · 거두기는 최고 관리자(SUPER)만 합니다.</p>;

  async function send(r: string, grant: boolean) {
    if (!reason.trim()) { setMsg({ ok: false, t: '사유를 먼저 적어 주십시오(기록에 남습니다).' }); return; }
    const ask = grant
      ? `${name} 님에게 「${ROLE_LABEL[r] ?? r}」 권한을 줍니다.${r === 'SUPER' ? ' 최고 관리자는 모든 권한(권한 주기 · 약관 게시 · 중요 설정)을 가집니다.' : ''}`
      : `${name} 님의 「${ROLE_LABEL[r] ?? r}」 권한을 거둡니다.`;
    if (!confirm(ask)) return;
    setBusy(true); setMsg(null);
    try {
      await api('/admin/reports/roles', { method: 'POST', body: JSON.stringify({ accountId, role: r, grant, reason: reason.trim() }) });
      setMsg({ ok: true, t: `${ROLE_LABEL[r] ?? r} 권한을 ${grant ? '주었습니다' : '거두었습니다'}.` });
      setReason(''); onDone();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.' });
    } finally { setBusy(false); }
  }

  return (
    <div className="card" data-member-roles="super">
      <h3 className="sec">권한 주기 · 거두기</h3>
      <p>
        {roles.filter((r) => r !== 'MEMBER' && r !== 'BIZ_OWNER' && r !== 'BIZ_STAFF').length === 0 && <span className="muted">운영 권한 없음 </span>}
        {roles.filter((r) => GRANTABLE.includes(r)).map((r) => (
          <span key={r} style={{ marginRight: 8 }}>
            <span className={`badge ${r === 'SUPER' ? 'badge-urgent' : 'badge-verified'}`}>{ROLE_LABEL[r] ?? r}</span>{' '}
            <button className="btn-plain btn-sm" disabled={busy} onClick={() => void send(r, false)} data-member-role-revoke={r}>거두기</button>
          </span>
        ))}
      </p>
      <div className="row">
        {can.length > 0 && (
          <select name="member-role" value={role} onChange={(e) => setRole(e.target.value)} aria-label="줄 권한">
            {can.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} ({r})</option>)}
          </select>
        )}
        <input name="member-role-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="사유(꼭 · 기록에 남습니다)" aria-label="사유" />
        {can.length > 0 && <button className="btn-ok" disabled={busy || !role || !reason.trim()} onClick={() => void send(role, true)} data-member-role-grant="">권한 주기</button>}
      </div>
      {msg && <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.t}</p>}
      <p className="muted">자기 권한은 바꿀 수 없고, 마지막 최고 관리자는 거둘 수 없습니다. 지급 담당(PAYOUT)은 여기서 주지 않습니다(운영과 함께 가질 수 없음).
        주고 거둔 기록은 「권한 계층 › 권한 관리」의 변경 이력에 남고 고칠 수 없습니다.</p>
    </div>
  );
}
