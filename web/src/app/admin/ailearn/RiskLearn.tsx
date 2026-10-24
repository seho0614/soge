import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import type { LearnSet } from './shared';

/* ── SB-ADM-RSK-020 위험감지 학습 ────────────────────────────────── */
interface Exempt {
  id: string; rule: string; ruleName: string | null; subject: string; reason: string;
  signals: number | null; createdAt: string; expiresAt: string | null; expired: boolean;
}

export function RiskLearn() {
  const r = useApi<{ items: Exempt[]; note: string | null }>('/admin/risk/exemptions');
  const ls = useApi<LearnSet>('/admin/ai/learn-settings');
  const [f, setF] = useState({ ruleCode: 'RSK-06', subject: '', reason: '', days: '90' });
  const a = useAct();

  const learn = () => a.run('learn', () => api('/admin/risk/learn', { method: 'POST' }), r.reload);
  const add = () => {
    if (f.subject.trim().length < 2) { a.setErr('무엇을 예외로 둘지 적으십시오 (예: acct:U-4471).'); return; }
    if (f.reason.trim().length < 5) { a.setErr('왜 정상인지 다섯 자 이상 적으십시오.'); return; }
    void a.run('add', () => api('/admin/risk/exemptions', {
      method: 'POST', body: JSON.stringify({ ruleCode: f.ruleCode.trim().toUpperCase(), subject: f.subject.trim(), reason: f.reason.trim(), days: Number(f.days) || undefined }),
    }), () => { setF({ ...f, subject: '', reason: '' }); r.reload(); });
  };
  const revoke = (x: Exempt) => {
    if (!confirm(`${x.rule} · ${x.subject} 예외를 해제합니다. 다음부터 다시 경보가 뜹니다.`)) return;
    void a.run(x.id, () => api(`/admin/risk/exemptions/${x.id}`, { method: 'DELETE' }), r.reload);
  };

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data?.items ?? [];
  const live = rows.filter((x) => !x.expired);
  return (
    <>
      <h2>위험감지 학습</h2>
      <p className="lead">오탐을 예외로 둡니다.</p>
      {ls.data && <div className="kpi4">
        <div><b className={ls.data.risk.enabled ? 'good' : ''}>{ls.data.risk.enabled ? 'on' : 'off'}</b><span>학습</span></div>
        <div><b>{ls.data.risk.minSignals}</b><span>최소 신호</span></div>
        <div><b>{ls.data.risk.expireDays}일</b><span>예외 기한</span></div>
        <div><b className={ls.data.risk.lawExempted ? 'bad' : 'good'}>{ls.data.risk.lawExempted}</b><span>법 규칙 예외</span></div>
      </div>}
      <p className="card"><b>같은 것이 내일 또 뜨면</b> 사람이 경보를 안 보게 되고, 진짜 위험이 묻힙니다. 정상으로 3회 닫으면 예외로 둡니다.</p>
      <p className="card warn">
        <b>법이 정한 규칙은 예외를 둘 수 없습니다.</b> RSK-05 제한업종(대부업법 · 방문판매법) · RSK-07 광고 규제(의료법 27조) —
        운영이 &ldquo;정상&rdquo;이라고 해도 열 수 없습니다(서버가 거절).
      </p>
      {r.data?.note && <p className="card warn">{r.data.note}</p>}
      <Flash msg={a.msg} err={a.err} />
      <div className="acts"><button className="btn-ok" disabled={a.busy === 'learn'} onClick={() => void learn()}>학습 실행</button></div>

      <h3 className="sec">예외 목록 <em>{live.length}</em></h3>
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">둔 예외가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>규칙</th><th>대상</th><th>사유</th><th>기한</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className={x.expired ? 'off' : ''}>
                <td className="mono">{x.rule}{x.ruleName && <span className="dim"> {x.ruleName}</span>}</td>
                <td className="mono">{x.subject}</td><td>{x.reason}</td>
                <td className="muted">{x.expiresAt ? ymd(x.expiresAt) : '—'}{x.expired && ' (만료)'}</td>
                <td>{!x.expired && <button className="btn-no" disabled={a.busy === x.id} onClick={() => revoke(x)}>예외 해제</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {live.length > 20 && <p className="card warn"><b>예외가 20건 넘으면 규칙이 잘못된 것입니다.</b> 예외를 늘리지 말고 규칙의 조건을 고치십시오.</p>}

      <h3 className="sec">예외 추가</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>규칙</span><input value={f.ruleCode} onChange={(e) => setF({ ...f, ruleCode: e.target.value })} placeholder="RSK-06" /></label>
          <label><span>대상</span><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="acct:U-4471" /></label>
          <label><span>기한(일)</span><input type="number" min={1} max={3650} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>왜 정상인지 (다섯 자 이상)</span><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'add'} onClick={add}>예외 추가</button></div>
        <p className="hint"><b>기한을 반드시 두십시오.</b> 영구 예외는 시간이 지나면 왜 뒀는지 아무도 모르고, 그 사이 진짜 위험이 통과합니다.</p>
      </div>
    </>
  );
}
