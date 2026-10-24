import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

interface Goal {
  id: string; partnerId: string | null; grade: string | null; periodYm: string;
  target: number | string; reward: number | string | null; scope: string; companyName: string | null;
}

interface Partner { id: string; company: string; grade: string; status: string }

/* ── SB-AFF-GOL-010 ──────────────────────────────────────────────── */
export function Goals() {
  const ymNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);   // 10/2 — 한국 기준 이번 달 (UTC 면 1일 0~9시에 지난달)
  const [ym, setYm] = useState('');
  const r = useApi<Goal[]>(ym ? `/admin/affiliates/goals?ym=${ym}` : '/admin/affiliates/goals');
  const partners = useApi<Partner[]>('/admin/partners');
  const [f, setF] = useState({ scope: 'grade', grade: 'A', partnerId: '', periodYm: ymNow, target: '', reward: '' });
  const a = useAct();

  const save = () => {
    const target = Number(f.target); const reward = f.reward ? Number(f.reward) : undefined;
    if (!/^\d{4}-\d{2}$/.test(f.periodYm)) { a.setErr('기간은 YYYY-MM 입니다.'); return; }
    if (!Number.isInteger(target) || target < 1) { a.setErr('목표 금액을 적으십시오.'); return; }
    if (f.scope === 'partner' && !f.partnerId) { a.setErr('파트너를 고르십시오.'); return; }
    void a.run('goal', () => api('/admin/affiliates/goals', {
      method: 'POST',
      body: JSON.stringify({
        periodYm: f.periodYm, target, reward,
        ...(f.scope === 'partner' ? { partnerId: f.partnerId } : { grade: f.grade.trim() }),
      }),
    }), () => { setF({ ...f, target: '', reward: '' }); r.reload(); });
  };

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data ?? [];
  return (
    <>
      <h2>목표 설정 · 지급 <em>{rows.length}</em></h2>
      <p className="card"><b>개인 목표가 등급 일괄보다 우선합니다.</b> 특별히 정해 준 것이 일반 규칙보다 앞섭니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="search-row">
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} aria-label="기간" style={{ maxWidth: 200 }} />
        {ym && <button className="btn-plain" onClick={() => setYm('')}>전체 기간</button>}
      </div>
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">정한 목표가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>범위</th><th>대상</th><th>기간</th><th>목표</th><th>달성 시 지급</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td>{g.scope === '개인' ? <span className="st ok">개인</span> : <span className="st">등급</span>}</td>
                <td>{g.companyName ?? g.grade}</td><td>{g.periodYm}</td>
                <td className="num-cell">{n(g.target)}원</td><td className="num-cell">{g.reward == null ? '—' : `${n(g.reward)}원`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">목표 설정</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>범위</span>
            <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="grade">등급 일괄</option><option value="partner">개인</option>
            </select>
          </label>
          {f.scope === 'grade'
            ? <label><span>등급</span><input value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} /></label>
            : <label><span>파트너</span>
                <select value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })}>
                  <option value="">고르십시오</option>
                  {(partners.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.company} ({p.grade})</option>)}
                </select>
              </label>}
          <label><span>기간 (YYYY-MM)</span><input value={f.periodYm} onChange={(e) => setF({ ...f, periodYm: e.target.value })} /></label>
          <label><span>목표 (원)</span><input type="number" min={1} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label><span>달성 시 지급 (원)</span><input type="number" min={0} value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'goal'} onClick={save}>목표 설정</button></div>
        <p className="hint">달성분 지급은 트랙별 정산에서 제휴수수료 트랙으로 나갑니다.</p>
      </div>
    </>
  );
}
