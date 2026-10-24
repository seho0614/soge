import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

interface Settle {
  id: string; track: string; from: string; to: string; gross: number | string; net: number | string;
  state: string; companyName: string; accountReady: boolean;
}

const SST: Record<string, string> = { DRAFT: '확정 대기', CONFIRMED: '확정', PAID: '지급', HELD: '보류' };

const TRACK: Record<string, string> = { AFFILIATE: '제휴수수료', REFERRAL: '소개비' };

/* ── SB-AFF-STL-010 ──────────────────────────────────────────────── */
export function Settlements({ onGo }: { onGo?: (tab: string) => void }) {
  const r = useApi<Settle[]>('/admin/affiliates/settlements');
  const [track, setTrack] = useState('AFFILIATE');
  /* v10.31 — 시안처럼 기간을 지난달로 채워 둡니다(바꿀 수 있음) */
  const lastMonth = (() => { const t = new Date(); const f = new Date(t.getFullYear(), t.getMonth() - 1, 1); const e = new Date(t.getFullYear(), t.getMonth(), 0);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [iso(f), iso(e)]; })();
  const [from, setFrom] = useState(lastMonth[0]!);
  const [to, setTo] = useState(lastMonth[1]!);
  const a = useAct();
  const run = () => {
    if (!from || !to || from > to) { a.setErr('기간을 바르게 고르십시오.'); return; }
    if (!confirm(`${TRACK[track]} 트랙 ${from} ~ ${to} 정산 배치를 실행합니다.`)) return;
    void a.run('run', () => api('/admin/affiliates/settlements/run', {
      method: 'POST', body: JSON.stringify({ track, periodFrom: from, periodTo: to }),
    }), r.reload);
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data ?? [];
  return (
    <>
      <h2>트랙별 정산 배치</h2>
      <p className="card warn">
        <b>트랙을 반드시 고르십시오.</b> 소개비와 제휴수수료는 성격이 달라 세금계산서도 따로 나갑니다.
        섞으면 소개비에서 공제한 것이 되어 <b>INV-9</b>가 깨집니다.
      </p>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <div className="form-grid">
          <div><span className="dim" style={{ fontSize: 12 }}>트랙</span>
            <div className="ad-flt sm" role="radiogroup" aria-label="트랙" style={{ margin: '4px 0 0' }}>
              {Object.entries(TRACK).map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={track === k} className={track === k ? 'on' : ''} onClick={() => setTrack(k)}>{t}</button>
              ))}
            </div>
          </div>
          <label><span>시작일</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span>종료일</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="acts">
          <button className="btn-ok" disabled={a.busy === 'run'} onClick={run}>배치 실행</button>
          {onGo && <button className="btn-plain" onClick={() => onGo('payouts')}>확정 · 지급은 지급 탭에서</button>}
        </div>
      </div>

      <h3 className="sec">정산서 <em>{rows.length}</em></h3>
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">만든 정산서가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>파트너</th><th>트랙</th><th>기간</th><th>총액</th><th>실지급</th><th>계좌</th><th>상태</th></tr></thead>
          <tbody>
            {rows.slice(0, 100).map((s) => (
              <tr key={s.id}>
                <td>{s.companyName}</td><td>{TRACK[s.track] ?? s.track}</td>
                <td className="muted">{ymd(s.from)} ~ {ymd(s.to)}</td>
                <td className="num-cell">{n(s.gross)}원</td><td className="num-cell">{n(s.net)}원</td>
                <td>{s.accountReady ? <span className="st ok">인증</span> : <span className="st no">미등록</span>}</td>
                <td>{SST[s.state] ?? s.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card warn"><b>계좌가 인증되지 않으면 지급할 수 없습니다.</b> 돈을 보낼 곳이 없습니다.</p>
      <p className="card">
        <b>확정 없이 바로 지급할 수 없습니다.</b> 초안 → 확정 → 지급 순서이고, 지급한 것은 되돌릴 수 없습니다 —
        다음 회차에서 조정하십시오. 원천징수 3.3% 는 사업소득세입니다.
      </p>
    </>
  );
}
