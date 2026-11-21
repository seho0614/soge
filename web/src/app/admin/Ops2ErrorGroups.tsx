import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.587 (docs/729) 14차 운영 ③ 서버 오류 묶음 — 위험감지 › 「서버 오류」 아래 상자(SB-ADM-OPS-020 · ADMIN · SUPER)
 *   지문(방법 · 주소 · 오류 종류 · 응답 · DB 오류 번호)마다 처음 · 마지막 · 횟수 · 상태. 30일 기록(D204)이 지워져도 남음.
 *   처음 보는 오류 · 「고침」으로 둔 오류가 다시 나면 운영 알림(SERVER_ERROR_NEW · SERVER_ERROR_REOPEN).
 * ------------------------------------------------------------------- */

interface Group { fp: string; method: string; path: string; code: string; status: number; pgCode: string | null; detail: string | null; requestId: string | null;
  firstAt: string; lastAt: string; total: number; daysSeen: number; state: 'OPEN' | 'ACK' | 'MUTED' | 'FIXED'; stateNote: string | null; stateAt: string | null;
  reopened: number; alertedAt: string | null; alertSkipped: boolean; backfilled: boolean; week: number }
interface View { rows: Group[]; days: number; state: string | null; counts: Record<string, number>; alertOn: boolean; note: string }

const ST: Record<string, string> = { OPEN: '열림', ACK: '확인함', MUTED: '알리지 않음', FIXED: '고침' };

export function Ops2ErrorGroups() {
  const [state, setState] = useState('');
  const [days, setDays] = useState('30');
  const q = useApi<View>(`/admin/ops2/error-groups?days=${days}${state ? `&state=${state}` : ''}`, [state, days]);
  const a = useAct();
  if (q.error || !q.data) return null;
  const d = q.data;
  const set = (g: Group, to: string) => {
    let note = '';
    if (to === 'MUTED') { note = window.prompt('알리지 않는 까닭(2자 이상)') ?? ''; if (note.trim().length < 2) return; }
    void a.run(`st-${g.fp}`, () => api(`/admin/ops2/error-groups/${g.fp}/state`, { method: 'POST', body: JSON.stringify({ state: to, note }) }), q.reload,
      `${g.method} ${g.path} — ${ST[to]}`);
  };
  return (
    <div className="card" style={{ marginTop: 12 }} data-ops2-error-groups={d.rows.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>오류 묶음</b>{' '}
      <small className="dim">{Object.entries(d.counts).map(([k, v]) => `${ST[k]} ${v}`).join(' · ')} · 새 오류 알림 {d.alertOn ? '켜짐' : '꺼짐(ops2.error_new_alert)'}</small>{' '}
      <select value={state} onChange={(e) => setState(e.target.value)} name="ops2-eg-state">
        <option value="">모든 상태</option>{Object.keys(ST).map((k) => <option key={k} value={k}>{ST[k]}</option>)}
      </select>{' '}
      <select value={days} onChange={(e) => setDays(e.target.value)} name="ops2-eg-days">
        {['1', '7', '30', '90', '365'].map((x) => <option key={x} value={x}>최근 {x}일</option>)}
      </select>
      {d.rows.length === 0 ? <p className="muted">이 기간에 난 서버 오류 묶음이 없습니다.</p> : (
        <table className="tbl" data-ops2-error-rows="">
          <thead><tr><th>요청</th><th>응답 · 종류</th><th>처음</th><th>마지막</th><th>모두</th><th>7일</th><th>날 수</th><th>상태</th><th>마지막 설명(값은 가림)</th><th></th></tr></thead>
          <tbody>{d.rows.map((g) => (
            <tr key={g.fp} data-ops2-error-fp={g.fp} data-ops2-error-state={g.state}>
              <td className="mono" style={{ fontSize: 12 }}>{g.method} {g.path}</td>
              <td>{g.status} {g.code}{g.pgCode ? ` [${g.pgCode}]` : ''}</td>
              <td className="muted">{ymdhm(g.firstAt)}{g.backfilled ? ' *' : ''}</td>
              <td className="muted">{ymdhm(g.lastAt)}</td>
              <td className="num-cell">{n(g.total)}</td><td className="num-cell">{n(g.week)}</td><td className="num-cell">{g.daysSeen}</td>
              <td>{g.state === 'OPEN' ? <b className="warn-text">{ST[g.state]}</b> : ST[g.state]}{g.reopened ? ` · 다시 남 ${g.reopened}` : ''}
                {g.stateNote ? <small className="dim"> {g.stateNote}</small> : null}{g.alertSkipped ? <small className="dim"> · 알림 못 함(한 시간 10건 넘음)</small> : null}</td>
              <td className="mono" style={{ fontSize: 12, maxWidth: 320 }}>{g.detail ?? '—'} <span className="dim">{g.requestId ?? ''}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {(['ACK', 'FIXED', 'MUTED', 'OPEN'] as const).filter((s) => s !== g.state).map((s) => (
                  <button key={s} className="btn-plain btn-sm" disabled={a.busy === `st-${g.fp}`} onClick={() => set(g, s)} data-ops2-error-set={s}>{s === 'OPEN' ? '다시 열기' : ST[s]}</button>
                ))}
              </td>
            </tr>))}</tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 12 }}>{d.note} * 표시는 v10.587 적용 때 30일 기록으로 처음 채운 묶음(그 전 처음 시각은 모름).</p>
    </div>
  );
}
