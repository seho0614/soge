import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { n } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';

/* ---------------------------------------------------------------------
 * SB-ADM-OPS-040 화면 속도 (v10.588 · docs/730 · 14차 운영 ④ · ADMIN · SUPER · 위험감지 › 서버 오류 뒤)
 *   사용자 웹이 잰 LCP(큰 그림 · 글이 보이기까지) · INP(누르고 반응까지) · CLS(화면 밀림) · FCP · TTFB — 75번째 값 · 좋음 · 나쁨 비율.
 *   화면 주소 묶음 · 지표 · 값만(누가 · IP · 브라우저 정보 · 방문자 키 없음). 처음 꺼짐(ops2.web_vitals · 켜기 SUPER · 처리방침 1.2 게시 뒤).
 * ------------------------------------------------------------------- */

interface Metric { metric: string; n: number; p75: string | number; goodPct: string | number; poorPct: string | number }
interface PathRow { path: string; n: number; lcp: string | null; inp: string | null; cls: string | null; ttfb: string | null; poorPct: string | number }
interface Day { day: string; n: number; lcp: string | null; inp: string | null }
interface View { on: boolean; days: number; from: string; settings: Record<string, string | null>; thresholds: Record<string, [number, number]>;
  metrics: Metric[]; paths: PathRow[]; daily: Day[]; note: string }

const NAME: Record<string, string> = { LCP: '큰 그림 · 글 보이기(LCP)', INP: '누르고 반응(INP)', CLS: '화면 밀림(CLS)', FCP: '첫 글자(FCP)', TTFB: '서버 첫 응답(TTFB)' };
const unit = (m: string) => (m === 'CLS' ? '' : 'ms');
/* 기준보다 나쁘면 경고색(좋음 기준 넘음 · 나쁨 기준 넘음) */
function cls(m: string, v: string | number | null, th: Record<string, [number, number]>) {
  if (v == null) return '';
  const t = th[m]; const x = Number(v);
  return !t ? '' : x > t[1] ? 'warn-text' : x > t[0] ? 'dim' : '';
}

export function Ops2WebVitals() {
  const [days, setDays] = useState('7');
  const q = useApi<View>(`/admin/ops2/web-vitals?days=${days}`, [days]);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  return (
    <section data-ops2-vitals={d.metrics.reduce((s, m) => s + m.n, 0)} data-ops2-vitals-on={d.on ? 'on' : 'off'}>
      <p className="muted">
        {d.on ? <>재는 중 · 표본 {d.settings['ops2.web_vitals_sample'] ?? '10'}퍼센트 · 보관 {d.settings['ops2.web_vitals_keep_days'] ?? '30'}일</>
              : <b className="warn-text">꺼져 있습니다 — 정책 › 전체 설정 ops2.web_vitals(켜기 SUPER · 처리방침 1.2 게시 뒤)</b>}{' '}
        <select value={days} onChange={(e) => setDays(e.target.value)} name="ops2-vitals-days">
          {['1', '7', '30'].map((x) => <option key={x} value={x}>최근 {x}일</option>)}
        </select>{' '}
        <button className="btn-plain btn-sm" onClick={q.reload}>새로 보기</button>
      </p>
      {d.metrics.length === 0 ? <p className="muted">이 기간에 잰 값이 없습니다.</p> : (
        <table className="tbl" data-ops2-vitals-metrics="">
          <thead><tr><th>지표</th><th>표본</th><th>75번째 값</th><th>좋음</th><th>나쁨</th><th>기준(좋음 · 나쁨)</th></tr></thead>
          <tbody>{d.metrics.map((m) => (
            <tr key={m.metric}><td>{NAME[m.metric] ?? m.metric}</td><td className="num-cell">{n(m.n)}</td>
              <td className={`num-cell ${cls(m.metric, m.p75, d.thresholds)}`}>{m.p75}{unit(m.metric)}</td>
              <td className="num-cell">{m.goodPct}%</td><td className="num-cell">{m.poorPct}%</td>
              <td className="dim">{d.thresholds[m.metric]?.join(' · ')}{unit(m.metric)}</td></tr>))}</tbody>
        </table>
      )}
      {d.paths.length > 0 && (
        <table className="tbl" style={{ marginTop: 12 }} data-ops2-vitals-paths="">
          <thead><tr><th>화면(주소 묶음)</th><th>표본</th><th>LCP</th><th>INP</th><th>CLS</th><th>TTFB</th><th>나쁨</th></tr></thead>
          <tbody>{d.paths.map((p) => (
            <tr key={p.path}><td className="mono" style={{ fontSize: 12 }}>{p.path}</td><td className="num-cell">{n(p.n)}</td>
              <td className={`num-cell ${cls('LCP', p.lcp, d.thresholds)}`}>{p.lcp ?? '—'}</td>
              <td className={`num-cell ${cls('INP', p.inp, d.thresholds)}`}>{p.inp ?? '—'}</td>
              <td className={`num-cell ${cls('CLS', p.cls, d.thresholds)}`}>{p.cls ?? '—'}</td>
              <td className={`num-cell ${cls('TTFB', p.ttfb, d.thresholds)}`}>{p.ttfb ?? '—'}</td>
              <td className="num-cell">{p.poorPct}%</td></tr>))}</tbody>
        </table>
      )}
      {d.daily.length > 0 && <p className="muted" data-ops2-vitals-daily="">날마다 LCP · INP 75번째 값 — {d.daily.map((x) => `${x.day.slice(5)} ${x.lcp ?? '—'} · ${x.inp ?? '—'}ms`).join(' / ')}</p>}
      <div className="ad-nt info">{d.note}</div>
    </section>
  );
}
