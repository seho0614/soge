import { useApi } from '../../lib/useApi';
import { n } from '../../lib/act';

/* ---------------------------------------------------------------------
 * v10.571 (docs/713) 대표 한눈에 — 대시보드 › 대표 한눈에(opb-glance) · 읽기만 · SUPER
 *   위: 지금 상태 칸(확인 안 한 급한 알림 · 오픈 차단 · 열린 문의 · 정산 대기 · 소개몰 정산 지급 대기)
 *   가운데: 숫자 표(오늘 · 어제 · 그저께 · 어제 대 그저께 · 지난 7일 · 그 앞 7일 · 주 대 주)
 *   아래: 확인 안 한 급한 알림 5 · 오픈 차단 5 — 누르면 그 탭(운영 알림 · 오픈 체크리스트)
 * ------------------------------------------------------------------- */

interface Row {
  key: string; label: string; unit: '건' | '원'; group: string; good: 'up' | 'down' | 'none';
  today: number; yesterday: number; dayBefore: number; week: number; prevWeek: number; dayPct: number | null; weekPct: number | null;
}
interface Glance {
  today: string; range: Record<string, [string, string]>; rows: Row[];
  now: { openCritical: number; openAlerts7d: number; blockers: number; inquiriesOpen: number; inquiriesOverdue: number;
         stlRequested: number; stlRequestedAmt: number; stlHeld: number; hltConfirmed: number; hltConfirmedAmt: number; hltDraft: number };
  alerts: Array<{ id: string; code: string; title: string; at: string }>;
  blockers: Array<{ kind: string; item: string; reason: string }>;
  note: string;
}

function Pct({ v, good }: { v: number | null; good: Row['good'] }) {
  if (v === null) return <span className="muted">새로</span>;
  if (v === 0) return <span className="dim">같음</span>;
  const better = good === 'none' ? null : (good === 'up') === (v > 0);
  return <span className={better === false ? 'warn-text' : undefined} style={better ? { fontWeight: 700 } : undefined}>{v > 0 ? '▲' : '▼'} {Math.abs(v)}%</span>;
}

export function OpbGlance({ onGo }: { onGo?: (t: string) => void }) {
  const q = useApi<Glance>('/admin/opb/glance');
  if (q.error) return <p className="warn-text" data-opb-glance="err">대표 한눈에를 읽지 못했습니다(SUPER 만 볼 수 있습니다).</p>;
  if (!q.data) return <p className="muted">읽는 중…</p>;
  const d = q.data;
  const go = (t: string) => (e: { preventDefault: () => void }) => { e.preventDefault(); onGo?.(t); };
  const v = (r: Row, x: number) => (r.unit === '원' ? `${n(x)}원` : n(x));
  const box = (key: string, label: string, val: string, sub: string, warn: boolean, tab?: string) => (
    <div className="kpi" data-opb-now={key} key={key}>
      <div className="k">{label}</div>
      <div className={`v${warn ? ' warn-text' : ''}`}>{tab ? <a href={`#/${tab}`} onClick={go(tab)}>{val}</a> : val}</div>
      <div className="n">{sub}</div>
    </div>
  );
  return (
    <div data-opb-glance={d.rows.length}>
      <div className="int-grid" style={{ marginBottom: 14 }}>
        {box('critical', '확인 안 한 급한 알림', n(d.now.openCritical), `7일 안 확인 안 한 알림 ${n(d.now.openAlerts7d)}`, d.now.openCritical > 0, 'ops-alerts')}
        {box('blockers', '오픈 차단', n(d.now.blockers), '오픈 체크리스트', d.now.blockers > 0, 'checklist')}
        {box('inquiries', '열린 1:1 문의', n(d.now.inquiriesOpen), `기한 넘김 ${n(d.now.inquiriesOverdue)}`, d.now.inquiriesOverdue > 0, 'inquiries')}
        {box('stl', '소개비 정산 대기', n(d.now.stlRequested), `${n(d.now.stlRequestedAmt)}원 · 보류 ${n(d.now.stlHeld)}`, false, 'settlement')}
        {box('hlt', '소개몰 정산 지급 대기', n(d.now.hltConfirmed), `${n(d.now.hltConfirmedAmt)}원 · 작성 중 ${n(d.now.hltDraft)}`, false, 'hlt-settle')}
      </div>

      <table className="tbl" data-opb-rows="">
        <thead><tr>
          <th>무엇</th><th className="num-cell">오늘(지금까지)</th><th className="num-cell">어제</th><th className="num-cell">그저께</th><th className="num-cell">어제 대 그저께</th>
          <th className="num-cell">지난 7일</th><th className="num-cell">그 앞 7일</th><th className="num-cell">주 대 주</th>
        </tr></thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={r.key} data-opb-row={r.key}>
              <td>{(i === 0 || d.rows[i - 1]!.group !== r.group) && <small className="dim">{r.group} › </small>}{r.label}</td>
              <td className="num-cell">{v(r, r.today)}</td>
              <td className="num-cell"><b>{v(r, r.yesterday)}</b></td>
              <td className="num-cell">{v(r, r.dayBefore)}</td>
              <td className="num-cell"><Pct v={r.dayPct} good={r.good} /></td>
              <td className="num-cell"><b>{v(r, r.week)}</b></td>
              <td className="num-cell">{v(r, r.prevWeek)}</td>
              <td className="num-cell"><Pct v={r.weekPct} good={r.good} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{d.note} 지난 7일 {d.range.week?.[0]} ~ {d.range.week?.[1]} · 그 앞 7일 {d.range.prevWeek?.[0]} ~ {d.range.prevWeek?.[1]}</p>

      <div className="int-grid">
        <div className="card" data-opb-alerts={d.alerts.length}>
          <b>확인 안 한 급한 알림</b>
          {d.alerts.length === 0 ? <p className="muted">없습니다.</p> : (
            <ul>{d.alerts.map((a) => <li key={a.id}><small className="dim">{a.at}</small> {a.title} <small className="dim mono">{a.code}</small></li>)}</ul>
          )}
          <p><a href="#/ops-alerts" onClick={go('ops-alerts')}>운영 알림에서 보기 →</a></p>
        </div>
        <div className="card" data-opb-blockers={d.blockers.length}>
          <b>오픈 차단</b>
          {d.blockers.length === 0 ? <p className="muted">없습니다.</p> : (
            <ul>{d.blockers.map((b) => <li key={`${b.kind}:${b.item}`}><small className="dim">{b.kind}</small> {b.item} — {b.reason}</li>)}</ul>
          )}
          <p><a href="#/checklist" onClick={go('checklist')}>오픈 체크리스트에서 보기 →</a></p>
        </div>
      </div>
    </div>
  );
}
