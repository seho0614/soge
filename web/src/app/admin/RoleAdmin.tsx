import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { Acl } from './Acl';

interface Holder {
  accountId: string; email: string; name: string;
  roles: string; lastChange: string | null;
}
interface Change {
  id: number; email: string; role: string; action: string;
  reason: string | null; changedBy: string | null; changedAt: string;
}

/**
 * 권한 관리.
 *
 * 관리자 역할을 주면 **검수·정산·제재 권한이 함께 갑니다.**
 * 사유를 남기게 하는 것은 사고가 났을 때 첫 질문이
 * "누가 왜 줬는가"이기 때문입니다.
 */
type View = 'holders' | 'acl';
const TABS: SubTab<View>[] = [
  { key: 'holders', label: '권한 보유자', screen: 'SB-ADM-USR-010' },
  { key: 'acl', label: '권한 계층', screen: 'SB-ADM-ACL-010' },
];

/** 권한 관리 탭 — 보유자 · 부여 이력과 권한 계층(SB-ADM-ACL-010)을 나눠 봅니다. */
export function RoleAdmin() {
  const [view, setView] = useState<View>('holders');
  return (
    <section>
      <SubTabs tabs={TABS} value={view} onChange={setView} />
      {view === 'holders' ? <RoleHolders /> : <Acl />}
    </section>
  );
}

function RoleHolders() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const holders = useApi<Holder[]>('/admin/reports/roles');
  const changes = useApi<Change[]>('/admin/reports/roles/changes');

  async function revoke(h: Holder, role: string) {
    const reason = prompt(`${h.email} 의 ${role} 권한을 회수합니다.\n사유를 적어 주십시오`);
    if (!reason?.trim()) return;
    setErr(null); setMsg(null);
    try {
      await api('/admin/reports/roles', {
        method: 'POST',
        body: JSON.stringify({ accountId: h.accountId, role, grant: false, reason }),
      });
      setMsg(`${h.email} 의 ${role} 권한을 회수했습니다.`);
      holders.reload(); changes.reload();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
    }
  }

  if (holders.error) return <ErrorView error={holders.error} onRetry={holders.reload} />;

  const rows = holders.data ?? [];
  const supers = rows.filter(h => h.roles.includes('SUPER'));

  return (
    <section>
      <h2>권한 보유자 <em>{rows.length}</em></h2>

      {supers.length === 1 && (
        <p className="card warn">
          <b>SUPER 가 한 명뿐입니다.</b> 그 계정을 잃으면 권한을 줄 사람이
          없습니다 — 한 명 더 두시는 편이 안전합니다.
        </p>
      )}
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="card warn">{err}</p>}

      <table className="tbl">
        <thead><tr><th>계정</th><th>역할</th><th>최근 변경</th><th>처리</th></tr></thead>
        <tbody>
          {rows.map(h => (
            <tr key={h.accountId}>
              <td><b>{h.name}</b><span className="muted"> {h.email}</span></td>
              <td>
                {h.roles.split(',').map(r => (
                  <span key={r} className={`badge ${r === 'SUPER' ? 'badge-urgent' : 'badge-verified'}`}>
                    {r}{' '}
                  </span>
                ))}
              </td>
              <td className="muted">
                {h.lastChange
                  ? new Date(h.lastChange).toLocaleDateString('ko-KR')
                  : '—'}
              </td>
              <td>
                {h.roles.split(',').map(r => (
                  <button key={r} className="btn-no" onClick={() => revoke(h, r)}>
                    {r} 회수
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card warn">
        <b>마지막 SUPER 는 회수되지 않습니다.</b> 다 지우면 아무도 권한을 줄 수
        없어 복구가 막힙니다 — DB 가 막습니다.
      </p>
      <p className="card">
        <b>자기 권한은 바꿀 수 없습니다.</b> 스스로 올릴 수 있으면 승인 절차가
        무의미해집니다.
      </p>

      <h2>변경 이력</h2>
      <table className="tbl">
        <thead><tr><th>계정</th><th>역할</th><th>동작</th><th>사유</th><th>처리자</th><th>일시</th></tr></thead>
        <tbody>
          {(changes.data ?? []).map(c => (
            <tr key={c.id}>
              <td className="muted">{c.email}</td>
              <td>{c.role}</td>
              <td>
                <span className={`badge ${c.action === 'GRANT' ? 'badge-verified' : 'badge-urgent'}`}>
                  {c.action === 'GRANT' ? '부여' : '회수'}
                </span>
              </td>
              <td className="muted">{c.reason ?? '—'}</td>
              <td className="muted">{c.changedBy ?? '—'}</td>
              <td className="muted">{new Date(c.changedAt).toLocaleString('ko-KR')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card">
        <b>이 기록은 수정·삭제할 수 없습니다.</b> 사고가 나면 여기가 유일한
        근거입니다.
      </p>
    </section>
  );
}
