import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { ChangeRequests } from '../PartnerCash';
import { bizNo, type Partner } from './shared';

/* ── SB-ADM-PTN-020 입점 신청 승인 · 반려 (T-01) ─────────────────── */
export function Apply() {
  const list = useApi<Partner[]>('/admin/partners');
  const a = useAct();
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const rows = list.data.filter((p) => p.status === 'APPLIED');
  const rejected = list.data.filter((p) => p.status === 'REJECTED');

  const approve = (p: Partner) => a.run(p.id, () => api(`/admin/partners/${p.id}/approve`, { method: 'POST' }),
    list.reload, `${p.company} 승인했습니다. 파트너센터 온보딩이 열립니다.`);
  const reject = (p: Partner) => {
    const reason = prompt(`${p.company} 입점 반려 사유 — 무엇을 갖춰야 다시 신청할 수 있는지까지 적어 주십시오`) ?? '';
    if (!reason.trim()) return;
    void a.run(p.id, () => api(`/admin/partners/${p.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
      list.reload);
  };

  return (
    <>
      <h2>입점 신청 승인 <em>{rows.length}</em></h2>
      <p className="lead">신청은 심사 대기로 저장되고, 여기서 승인 또는 반려합니다 (T-01).</p>
      <p className="card warn">
        <b>국세청(NTS) 서비스키가 아직 발급되지 않아 사업자 상태가 항상 &ldquo;계속사업자&rdquo;로 옵니다(T-07).</b>{' '}
        PASS 본인인증도 스텁입니다(T-18). 두 값은 지금 판단 근거로 쓰지 마십시오.
      </p>
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">대기 중인 입점 신청이 없습니다.</p>}
      {rows.map((p) => (
        <div key={p.id} className="card row" data-partner={p.id}>
          <div className="row-main">
            <strong>{p.company}</strong>
            <span className="dim">{bizNo(p.bizRegNo)} · {p.personal ? (p.actorOk ? '본인인증 완료' : '본인인증 전') : p.bizVerified ? '사업자 인증 완료' : '사업자 미인증'} · 신청 {ymdhm(p.appliedAt)}</span>
          </div>
          <div className="row-act">
            <button className="btn-ok" disabled={a.busy === p.id} onClick={() => void approve(p)}>승인</button>{' '}
            <button className="btn-no" disabled={a.busy === p.id} onClick={() => reject(p)}>반려</button>
          </div>
        </div>
      ))}
      <p className="card">
        <b>승인하면 열리는 것</b> — PASS 인증 · 첫 로그인 · 서비스 등록 게이트 · 정산 계좌 등록.
        인증되지 않은 사업자는 DB 가 승인을 막습니다. <b>반려 사유는 신청자에게 그대로 보이고</b>, 신청자는 고쳐서 다시 신청할 수 있습니다.
      </p>
      {rejected.length > 0 && (
        <>
          <h3 className="sec">반려한 신청 <em>{rejected.length}</em></h3>
          <table className="tbl">
            <thead><tr><th>파트너</th><th>사유</th><th>신청</th></tr></thead>
            <tbody>
              {rejected.map((p) => (
                <tr key={p.id}><td><b>{p.company}</b></td><td className="muted">{p.rejectReason ?? '—'}</td><td className="muted">{ymdhm(p.appliedAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3 className="sec">사업자 정보 변경 요청 <small className="dim">파트너센터 › 회사 정보에서 낸 것 — 승인하면 바로 반영</small></h3>
      <ChangeRequests />
    </>
  );
}
