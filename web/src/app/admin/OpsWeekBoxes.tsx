import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.374 · 375 (D240 · docs/509 · 510)
 *   ApplyChecksBox   첫 화면 「지금 판」 아래 — 운영 적용 확인표(맞음 · 다름 · 메모 · 넣기 SUPER)
 *   AlertWeeklyBox   위험감지 › 「운영 알림」 — 지난주 알림 통계
 * ------------------------------------------------------------------- */

interface Item { id: string; no: number; item: string; result: 'OK' | 'NG' | null; memo: string | null; markedAt: string | null; by: string | null; marks: number }
interface Checks { version: string; items: Item[]; total: number; done: number; ng: number; versions: Array<{ version: string; n: number }>; canSet: boolean }

export function ApplyChecksBox() {
  const [ver, setVer] = useState('');
  const q = useApi<Checks>(`/admin/apply-checks${ver ? `?version=${ver}` : ''}`, [ver]);
  const a = useAct();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  if (q.error || !q.data) return null;
  const d = q.data;
  const mark = (it: Item, result: 'OK' | 'NG') => {
    const memo = result === 'NG' ? prompt('무엇이 다른지 적어 주십시오(300자까지 · 운영 알림에 남음).') : '';
    if (result === 'NG' && memo === null) return;
    void a.run(`m${it.id}`, () => api(`/admin/apply-checks/${it.id}/mark`, { method: 'POST', body: JSON.stringify({ result, memo: memo || undefined }) }), q.reload);
  };
  const set = () => void a.run('set', () => api('/admin/apply-checks', { method: 'POST', body: JSON.stringify({ version: d.version, text }) }), () => { setText(''); q.reload(); });
  return (
    <details className="card" open={open || (d.total > 0 && d.done < d.total)} onToggle={(e) => setOpen(e.currentTarget.open)} data-apply-checks={`${d.done}|${d.total}|${d.ng}`}>
      <summary><b>적용 확인표 {d.version}</b>{' '}
        {d.total ? <span className={d.ng ? 'warn-text' : d.done < d.total ? '' : 'dim'}>{d.done} / {d.total} 확인{d.ng ? ` · 다름 ${d.ng}` : ''}</span> : <span className="muted">항목 없음</span>}</summary>
      <Flash msg={a.msg} err={a.err} />
      {d.versions.length > 1 && (
        <p><select name="apply-ver" value={ver || d.version} onChange={(e) => setVer(e.target.value)} aria-label="판">
          {d.versions.map((v) => <option key={v.version} value={v.version}>{v.version} ({v.n})</option>)}
        </select></p>
      )}
      {d.items.length > 0 && (
        <table className="tbl"><tbody>
          {d.items.map((it) => (
            <tr key={it.id} data-apply-item={it.result ?? 'none'}>
              <td className="num-cell">{it.no}</td><td>{it.item}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{it.result === 'OK' ? <b>맞음</b> : it.result === 'NG' ? <b className="warn-text">다름</b> : <span className="muted">—</span>}
                {it.memo && <small className="dim"> {it.memo}</small>}{it.markedAt && <small className="dim"> {ymdhm(it.markedAt)}{it.by ? ` · ${it.by}` : ''}</small>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" disabled={a.busy === `m${it.id}`} onClick={() => mark(it, 'OK')} data-apply-ok={it.no}>맞음</button>{' '}
                <button className="btn-sm btn-plain" disabled={a.busy === `m${it.id}`} onClick={() => mark(it, 'NG')} data-apply-ng={it.no}>다름</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
      {d.canSet && d.total === 0 && (
        <div data-apply-set="">
          <p className="muted">운영 절차서 4-1 「화면 확인」 표를 그대로 붙여 넣으십시오(| # | 곳 | 맞으면 | 줄마다 한 항목 · 60개까지 · 넣은 뒤 고치기 없음).</p>
          <textarea name="apply-text" value={text} onChange={(e) => setText(e.target.value)} rows={6} style={{ width: '100%' }} />
          <p><button className="btn-ok" disabled={a.busy === 'set' || text.trim().length < 2} onClick={set} data-apply-save="">{d.version} 확인표 넣기</button></p>
        </div>
      )}
    </details>
  );
}

interface Weekly { from: string; to: string; total: number; critical: number; ackAvgMin: number | null; openNow: number; mutes: number; rows: Array<{ code: string; n: number; critical: number; open: number }>; line: string }

export function AlertWeeklyBox({ name }: { name: Record<string, string> }) {
  const q = useApi<Weekly>('/admin/ops-alerts/weekly');
  if (q.error || !q.data) return null;
  const d = q.data;
  return (
    <details className="card" data-alert-weekly={d.total}>
      <summary><b>지난주 운영 알림</b> <small className="dim">{d.from} ~ {d.to} · {n(d.total)}건 · 급함 {n(d.critical)} · 확인까지 평균 {d.ackAvgMin == null ? '—' : `${d.ackAvgMin}분`} · 잠시 끔 {d.mutes}</small></summary>
      {d.rows.length === 0 ? <p className="muted">지난주 알림이 없습니다.</p> : (
        <table className="tbl"><thead><tr><th>종류</th><th>수</th><th>급함</th><th>아직 확인 안 함</th></tr></thead><tbody>
          {d.rows.map((r) => <tr key={r.code} data-alert-weekly-row={r.code}><td>{name[r.code] ?? r.code} <small className="dim mono">{r.code}</small></td><td className="num-cell">{n(r.n)}</td><td className="num-cell">{n(r.critical)}</td><td className="num-cell">{n(r.open)}</td></tr>)}
        </tbody></table>
      )}
      <p className="muted">월요일 고객센터 주간 보고에도 한 줄로 갑니다: {d.line}</p>
    </details>
  );
}
