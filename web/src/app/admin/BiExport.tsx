/**
 * v10.535 (D282 · docs/673) 통계 내보내기 BI — 통합 현황 › 통계 내보내기(BI) · SB-ADM-DTX-010
 *   기간 · 지표 고르기 → 일별 집계 표(운영 화면 안 정확한 숫자) · CSV(내려받기 승인 BI_DAILY · 작은 칸 가림) · 다시 셈(31일)
 *   BI 도구 연결 — bi 스키마 보기 · 칸 목록 · 개인 식별 칸 감시(늘 0) · 읽기 계정은 운영 서버에서 사람이(docs/673 5절)
 *   설정(SUPER) — 작은 칸 가림 bi.min_cell · 보관 bi.keep_days · 사유
 * (adminMenu · App.tsx 연결은 patches/1_wiring.md) · 글자 12 · 13 · 14px · 모서리 var(--r-sm) · # 색 없음
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';

interface Def { metric: string; labelKo: string; unit: string; dimLabel: string | null; sourceKo: string }
interface Overview {
  defs: Def[]; settings: { minCell: number; keepDays: number }; lastDay: string | null; firstDay: string | null; builtAt: string | null; rowCount: number;
  views: Array<{ name: string; columns: Array<{ name: string; type: string }> }>; piiColumns: Array<{ viewName: string; columnName: string }>;
  runMaxDays: number; viewMaxDays: number; note: string;
}
interface Daily { from: string; to: string; metrics: string[]; items: Array<{ day: string; metric: string; dim: string; value: number }>; totals: Record<string, number>; byDim: Record<string, Record<string, number>>; truncated: boolean }

const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const num = (v: number | null | undefined, unit?: string) => (v == null ? '—' : `${Number(v).toLocaleString('ko-KR')}${unit === 'KRW' ? '원' : ''}`);
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};
const isSuper = () => tokenRoles().includes('SUPER');

export function BiExport() {
  const o = useApi<Overview>('/admin/bi');
  const a = useAct();
  const [from, setFrom] = useState(kstDay(-30));
  const [to, setTo] = useState(kstDay(-1));
  const [sel, setSel] = useState<string[]>([]);
  const [d, setD] = useState<Daily | null>(null);
  const [st, setSt] = useState({ minCell: '', keepDays: '', reason: '' });
  const qs = () => `from=${from}&to=${to}${sel.length ? `&metrics=${encodeURIComponent(sel.join(','))}` : ''}`;
  const load = () => void a.run('load', async () => { const r = await api<Daily>(`/admin/bi/daily?${qs()}`); setD(r); return { note: '' }; }, undefined, () => '');
  const csv = () => void a.run('csv', async () => {
    const t = await exportTicket(('BI_DAILY' as string) as Parameters<typeof exportTicket>[0]);   // v10.535 — OpsSafetyBoxes 의 대상 글자 목록은 고치지 않음(서버 EXPORT_TARGETS 에 BI_DAILY)
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ csv: string; filename: string; note: string }>(`/admin/bi/export?${qs()}&ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r?.note ?? '');
  const run = () => {
    if (!confirm(`${from} ~ ${to} 를 다시 셀까요? (${o.data?.runMaxDays ?? 31}일까지 · 원본 표에서 다시 셈)`)) return;
    void a.run('run', () => api('/admin/bi/run', { method: 'POST', body: JSON.stringify({ from, to }) }), () => { o.reload(); if (d) load(); });
  };
  const saveSt = () => void a.run('st', () => api('/admin/bi/settings', { method: 'PUT', body: JSON.stringify({
    minCell: st.minCell === '' ? undefined : Number(st.minCell), keepDays: st.keepDays === '' ? undefined : Number(st.keepDays), reason: st.reason }) }),
    () => { setSt({ minCell: '', keepDays: '', reason: '' }); o.reload(); });
  const ov = o.data;
  const defOf = (m: string) => ov?.defs.find((x) => x.metric === m);
  const days = d ? [...new Set(d.items.map((x) => x.day))] : [];
  const shownMetrics = d ? (d.metrics?.length ? d.metrics : (ov?.defs ?? []).map((x) => x.metric)) : [];
  const cell = (day: string, m: string) => d?.items.filter((x) => x.day === day && x.metric === m).reduce((s, x) => s + x.value, 0) ?? 0;
  return (
    <section data-bi={ov?.rowCount ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {ov && (
        <div className="card pad">
          <b>집계 상태</b> {ov.firstDay ? `${ov.firstDay} ~ ${ov.lastDay}` : '아직 셈 없음'} · 줄 {num(ov.rowCount)} · 마지막 셈 {ymdhm(ov.builtAt)} ·
          작은 칸 가림 {ov.settings.minCell} · 보관 {ov.settings.keepDays}일
          <p className="muted">{ov.note}</p>
        </div>
      )}
      <div className="card pad" data-bi-filter="">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="시작일" /> ~{' '}
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="끝날" />{' '}
        <button className="btn-sm" disabled={a.busy === 'load'} onClick={load} data-bi-load="">보기</button>{' '}
        <button className="btn-sm btn-plain" disabled={a.busy === 'csv'} onClick={csv} data-bi-csv="">CSV 내려받기(승인)</button>{' '}
        <button className="btn-sm btn-plain" disabled={a.busy === 'run'} onClick={run} data-bi-run="">다시 셈</button>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {(ov?.defs ?? []).map((x) => (
            <label key={x.metric} style={{ marginRight: 12, display: 'inline-block' }}>
              <input type="checkbox" checked={sel.includes(x.metric)} onChange={() => setSel(sel.includes(x.metric) ? sel.filter((m) => m !== x.metric) : [...sel, x.metric])} data-bi-metric={x.metric} /> {x.labelKo}
            </label>
          ))}
          <small className="dim">(고르지 않으면 모두)</small>
        </div>
      </div>
      {d && (
        <div className="card pad" data-bi-table={d.items.length}>
          <b>{d.from} ~ {d.to} 합</b>
          <table className="tbl"><thead><tr><th>지표</th><th>합</th><th>나눔</th></tr></thead>
            <tbody>
              {shownMetrics.map((m) => (
                <tr key={m}><td>{defOf(m)?.labelKo ?? m}</td><td>{num(d.totals[m] ?? 0, defOf(m)?.unit)}</td>
                  <td style={{ fontSize: 12 }}>{d.byDim[m] ? Object.entries(d.byDim[m]!).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k} ${num(v)}`).join(' · ') : ''}</td></tr>
              ))}
            </tbody>
          </table>
          {days.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table className="tbl"><thead><tr><th>날짜</th>{shownMetrics.map((m) => <th key={m} style={{ fontSize: 12 }}>{defOf(m)?.labelKo ?? m}</th>)}</tr></thead>
                <tbody>{days.slice(-62).reverse().map((day) => <tr key={day}><td>{day}</td>{shownMetrics.map((m) => <td key={m}>{num(cell(day, m), defOf(m)?.unit)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {d.truncated && <p className="muted">줄이 많아 앞 20,000줄만 보였습니다 — 기간을 줄이십시오.</p>}
          <p className="muted">운영 화면 안에서는 정확한 숫자입니다. CSV · BI 보기는 나눔 줄의 작은 칸(작은 칸 가림 미만)을 비웁니다.</p>
        </div>
      )}
      {ov && (
        <div className="card pad" data-bi-views={ov.views.length}>
          <b>BI 도구 연결(읽기 전용)</b>{' '}
          <span className={ov.piiColumns.length ? 'pill-danger' : 'dim'} data-bi-pii={ov.piiColumns.length}>개인 식별처럼 보이는 칸 {ov.piiColumns.length}</span>
          <ul style={{ fontSize: 13, margin: '6px 0' }}>
            {ov.views.map((v) => <li key={v.name}><code>{v.name}</code> — {v.columns.map((c) => c.name).join(', ') || '(아직 없음)'}</li>)}
          </ul>
          <p className="muted">메타베이스 · 태블로 · 엑셀 파워 쿼리 같은 도구는 이 보기만 읽는 계정으로 연결합니다. 계정 · 권한은 운영 서버에서 사람이 만들고(docs/673 5절), 운영 화면은 계정을 만들지 않습니다.</p>
        </div>
      )}
      {ov && isSuper() && (
        <div className="card pad" data-bi-settings="">
          <b>설정(SUPER)</b>{' '}
          <input value={st.minCell} onChange={(e) => setSt({ ...st, minCell: e.target.value })} placeholder={`작은 칸 가림 ${ov.settings.minCell}`} size={14} aria-label="작은 칸 가림" />{' '}
          <input value={st.keepDays} onChange={(e) => setSt({ ...st, keepDays: e.target.value })} placeholder={`보관 ${ov.settings.keepDays}일`} size={12} aria-label="보관 일수" />{' '}
          <input value={st.reason} onChange={(e) => setSt({ ...st, reason: e.target.value })} placeholder="사유" size={20} aria-label="사유" />{' '}
          <button className="btn-sm" disabled={st.reason.trim().length < 2 || (st.minCell === '' && st.keepDays === '')} onClick={saveSt} data-bi-save="">바꾸기</button>
        </div>
      )}
      {ov && (
        <details className="card pad"><summary>지표 설명</summary>
          <table className="tbl"><tbody>{ov.defs.map((x) => <tr key={x.metric}><td><code>{x.metric}</code></td><td>{x.labelKo}</td><td>{x.unit}</td><td>{x.dimLabel ?? ''}</td><td style={{ fontSize: 12 }}>{x.sourceKo}</td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}
