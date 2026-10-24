import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

interface AppRow {
  id: string; grade: string; status: string; appliedAt: string;
  companyName: string; ceoName: string; bizRegNo: string | null; bizVerified: boolean; personal?: boolean; actorOk?: boolean;
}

/* ── SB-AFF-APL-010 ──────────────────────────────────────────────── */
export function Applications() {
  const r = useApi<{ items: AppRow[]; note: string | null }>('/admin/affiliates/applications');
  const a = useAct();
  const decide = (x: AppRow, ok: boolean) => {
    const reason = ok ? undefined : prompt('거절 사유 — 안 적으면 같은 신청이 다시 올라옵니다') ?? '';
    if (!ok && (!reason || reason.trim().length < 2)) { a.setErr('거절하실 때는 사유를 적으십시오.'); return; }
    void a.run(x.id, () => api(`/admin/affiliates/applications/${x.id}/decide`, {
      method: 'POST', body: JSON.stringify({ state: ok ? 'APPROVED' : 'REJECTED', reason: reason?.trim() }),
    }), r.reload);
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const rows = r.data.items;
  return (
    <>
      <h2>파트너 입점 심사 <em>{rows.length}</em></h2>
      <p className="lead">관리자가 승인해야 링크를 발급할 수 있습니다.</p>
      <p className="card warn"><b>사업자 인증이 끝난 곳인지 먼저 보십시오.</b> 인증 안 된 곳을 승인하면 정산할 때 세금계산서를 받을 수 없습니다.</p>
      {r.data.note && <p className="card">{r.data.note}</p>}
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">심사를 기다리는 신청이 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>상호</th><th>대표</th><th>사업자</th><th>인증</th><th>신청일</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td><b>{x.companyName}</b></td><td>{x.ceoName}</td><td className="muted">{x.personal ? '개인' : x.bizRegNo}</td>
                <td>{(x.actorOk ?? x.bizVerified) ? <span className="st ok">{x.personal ? '본인인증' : '완료'}</span> : <span className="st no">미인증</span>}</td>
                <td className="muted">{ymd(x.appliedAt)}</td>
                <td>
                  {/* v10.38 (D096 · P2P) — 사업자는 사업자 인증, 개인은 본인인증이면 승인합니다 */}
                  {(x.actorOk ?? x.bizVerified)
                    ? <button className="btn-sm" disabled={a.busy === x.id} onClick={() => decide(x, true)}>승인</button>
                    : <span className="st no">{x.personal ? '본인인증 먼저' : '사업자 인증 먼저'}</span>}{' '}
                  <button className="btn-no" disabled={a.busy === x.id} onClick={() => decide(x, false)}>거절</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card"><b>거절하실 때는 사유를 적으십시오.</b> 안 적으면 같은 신청이 다시 올라옵니다.</p>
    </>
  );
}
