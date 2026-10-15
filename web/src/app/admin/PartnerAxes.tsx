import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface AxisRow {
  id: string; axis: 'EQUIP' | 'RE' | 'SOLAR' | 'CONSULT';
  state: string; source: string; reason: string | null; appliedAt: string;
  company: string; bizRegNo: string | null; ntsEnv: string | null; brokerVerified: boolean;
}
const AXIS: Record<string, string> = { EQUIP: '기계·설비·시설', RE: '부동산', SOLAR: '태양광', CONSULT: '생활·금융 상담' };
const NTS: Record<string, string> = { LIVE: '국세청 실연동', TEST: '시험 연동', STUB: '모의(연동 전)' };

/**
 * SB-ADM-PTN-020 입점 승인 — 안심소개 축별 판정 (서버 D018 · /admin/partner-axes)
 *
 * 축마다 따로 승인합니다. 부동산은 중개사 인증이 있어야 승인되고(서버가 막습니다),
 * 반려는 사유 5자 이상이 필요합니다 — 신청자에게 그대로 보입니다.
 * 국세청 확인 단계(LIVE · TEST · STUB)를 함께 보여 줍니다 — 일괄 이관은 LIVE 만 근거로 씁니다.
 */
export function PartnerAxes() {
  const [state, setState] = useState('PENDING');
  const list = useApi<AxisRow[]>(`/admin/partner-axes?state=${state}`);
  const [reason, setReason] = useState<Record<string, string>>({});
  const a = useAct();

  async function decide(r: AxisRow, approve: boolean) {
    const why = (reason[r.id] ?? '').trim();
    if (!approve && why.length < 5) { a.setErr('반려 사유를 5자 이상 적어 주십시오 — 신청자에게 그대로 보입니다.'); return; }
    await a.run(r.id, () => api(`/admin/partner-axes/${r.id}/decide`, {
      method: 'POST', body: JSON.stringify(approve ? { approve: true } : { approve: false, reason: why }),
    }), list.reload, approve ? `${r.company} — ${AXIS[r.axis]} 축을 승인했습니다.` : `${r.company} — ${AXIS[r.axis]} 축을 반려했습니다.`);
  }

  return (
    <section data-partner-axes="1">
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <p className="lead">부동산은 개업공인중개사 인증이 있어야 승인됩니다. 일괄 이관으로 들어온 건은 경위가 「일괄 이관」으로 남습니다.</p>
      <div className="row">
        {([['PENDING', '심사 대기'], ['APPROVED', '승인'], ['REJECTED', '반려']] as const).map(([k, t]) => (
          <button key={k} className={state === k ? 'on' : ''} data-axes-state={k} onClick={() => setState(k)}>{t}</button>
        ))}
      </div>
      <Flash msg={a.msg} err={a.err} />
      {list.error ? <ErrorView error={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <p>불러오는 중…</p> : null}
      {list.data && list.data.length === 0 ? <p className="empty">해당하는 신청이 없습니다.</p> : null}
      {list.data && list.data.length > 0 ? (
        <table className="tbl">
          <thead><tr><th>업체</th><th>축</th><th>국세청</th><th>중개사</th><th>경위</th><th>신청</th><th>판정</th></tr></thead>
          <tbody>
            {list.data.map((r) => (
              <tr key={r.id} data-axis-row={r.id} data-axis={r.axis}>
                <td><b>{r.company}</b><br /><span className="hint">{r.bizRegNo ?? '개인(본인인증)'}</span></td>
                <td>{AXIS[r.axis] ?? r.axis}</td>
                <td>{r.ntsEnv ? NTS[r.ntsEnv] ?? r.ntsEnv : '—'}</td>
                <td>{r.axis === 'RE' ? (r.brokerVerified ? '인증' : '미인증') : '—'}</td>
                <td>{r.source === 'BULK_MIGRATION' ? '일괄 이관' : r.source === 'ADMIN' ? '관리자' : '신청'}{r.reason ? <span className="hint"> — {r.reason}</span> : null}</td>
                <td>{ymdhm(r.appliedAt)}</td>
                <td>
                  {r.state === 'PENDING' ? (
                    <>
                      <button disabled={a.busy === r.id || (r.axis === 'RE' && !r.brokerVerified)}
                              title={r.axis === 'RE' && !r.brokerVerified ? '중개사 인증이 먼저입니다' : undefined}
                              data-act="approve" onClick={() => void decide(r, true)}>승인</button>
                      <input aria-label="반려 사유" placeholder="반려 사유 (5자 이상)"
                             value={reason[r.id] ?? ''} onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })} />
                      <button disabled={a.busy === r.id} data-act="reject" onClick={() => void decide(r, false)}>반려</button>
                    </>
                  ) : (r.state === 'APPROVED' ? '승인됨' : '반려됨')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
