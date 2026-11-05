import { useState } from 'react';
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

interface AffPartner {
  id: string; companyName: string; personal: boolean; actorOk: boolean;
  affStatus: string; affAppliedAt: string | null; affApprovedAt: string | null; affReason: string | null; malStatus: string; links: number;
}
const AFF_ST: Record<string, string> = { APPLIED: '심사 대기', ACTIVE: '활동', SUSPENDED: '정지', WITHDRAWN: '탈퇴', REJECTED: '반려' };
const MAL_ST: Record<string, string> = { NONE: '신청 없음', APPLIED: '심사 대기', ACTIVE: '활동', SUSPENDED: '정지', WITHDRAWN: '탈퇴', REJECTED: '반려' };

/**
 * v10.194 (D173 · docs/304) — 제휴 파트너 현황 · 제휴 자격만 정지 · 다시 열기(안심소개 자격은 칸만 보여 줌 · 운영 화면 › 파트너사에서 따로).
 * 정지하면 그 파트너의 링크 클릭은 PARTNER_INACTIVE 로 막히고 파트너센터(/partners)가 닫힙니다.
 */
export function AffPartners() {
  const [st, setSt] = useState('ACTIVE');
  const r = useApi<AffPartner[]>(`/admin/affiliates/partners?status=${st}`);
  const a = useAct();
  const change = (x: AffPartner, to: 'suspend' | 'resume') => {
    const reason = prompt(to === 'suspend' ? `${x.companyName} 의 제휴 자격을 정지합니다. 사유(파트너에게 보입니다)` : `${x.companyName} 의 제휴 자격을 다시 엽니다. 사유`) ?? '';
    if (reason.trim().length < 2) { a.setErr('사유를 적어 주십시오.'); return; }
    void a.run(x.id, () => api(`/admin/affiliates/partners/${x.id}/${to}`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), r.reload);
  };
  return (
    <section data-aff-partners="">
      <h2>제휴 파트너 현황 <em>{r.data?.length ?? 0}</em></h2>
      <p className="lead">제휴 자격은 안심소개 입점 자격과 따로입니다 — 여기서 정지해도 안심소개는 그대로입니다.</p>
      <div className="row">
        {['ACTIVE', 'SUSPENDED', 'REJECTED', 'WITHDRAWN'].map((k) => (
          <button key={k} className={`btn-sm ${st === k ? 'on' : 'btn-plain'}`} onClick={() => setSt(k)}>{AFF_ST[k]}</button>
        ))}
      </div>
      <Flash msg={a.msg} err={a.err} />
      {r.error ? <ErrorView error={r.error} onRetry={r.reload} /> : !r.data ? <p className="muted">불러오는 중…</p> : r.data.length === 0 ? <p className="muted">해당하는 파트너가 없습니다.</p> : (
        <table className="tbl">
          <thead><tr><th>상호</th><th>제휴</th><th>안심소개</th><th>활성 링크</th><th>승인일</th><th>사유</th><th>처리</th></tr></thead>
          <tbody>
            {r.data.map((x) => (
              <tr key={x.id}>
                <td><b>{x.companyName}</b>{x.personal && <span className="muted"> (개인)</span>}</td>
                <td><span className={`st ${x.affStatus === 'ACTIVE' ? 'ok' : 'no'}`}>{AFF_ST[x.affStatus] ?? x.affStatus}</span></td>
                <td className="muted">{MAL_ST[x.malStatus] ?? x.malStatus}</td>
                <td className="num-cell">{x.links}</td>
                <td className="muted">{x.affApprovedAt ? ymd(x.affApprovedAt) : '—'}</td>
                <td className="muted">{x.affReason ?? '—'}</td>
                <td>
                  {x.affStatus === 'ACTIVE' && <button className="btn-no" disabled={a.busy === x.id} onClick={() => change(x, 'suspend')}>제휴 정지</button>}
                  {x.affStatus === 'SUSPENDED' && <button className="btn-sm" disabled={a.busy === x.id} onClick={() => change(x, 'resume')}>다시 열기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
