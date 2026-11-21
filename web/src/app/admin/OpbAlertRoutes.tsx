import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.572 (docs/714) 운영 알림 받을 사람 규칙 — 위험감지 › 알림 받을 사람 규칙(opb-alert-routes) · SUPER
 *   위: 스위치 두 개(규칙 쓰기 · 권한그룹 메일) — 처음 꺼짐(지금 동작)
 *   규칙 표: 종류 · 텔레그램 · 메일 · 슬랙 · 게시판 · 급함 기준 · 묶음 간격 · 받을 권한그룹 · 처음 값과 같음 — 고치기 · 빼기
 *   최근 30일 종류: 수 · 「지금 동작」 길 · 「규칙」 길(다르면 칠함) · 「규칙 더하기」
 *   바꾼 기록 30줄
 * ------------------------------------------------------------------- */

interface Rule { code: string; toTelegram: boolean; toMail: boolean; toSlack: boolean; toBoard: boolean; minSeverity: string; throttleMin: number; groups: string[]; note: string | null; updatedAt: string; by: string | null; initial: boolean }
interface Seen { code: string; n: number; critical: number; warn: number; last: string; rule: string; sev: string; channels: string[]; nowChannels: string[]; differs: boolean }
interface View {
  on: boolean; groupMail: boolean; rules: Rule[]; lockedCodes: string[]; defaultCodes: string[]; sevs: string[];
  codes: Seen[]; groups: Array<{ key: string; name: string; members: number }>;
  log: Array<{ id: string; code: string; action: string; reason: string; at: string; by: string | null }>; note: string;
}
type Edit = { code: string; toTelegram: boolean; toMail: boolean; toSlack: boolean; toBoard: boolean; minSeverity: string; throttleMin: number; groups: string[]; note: string; expectedUpdatedAt?: string };

const CH: Record<string, string> = { telegram: '텔레그램', mail: '메일', slack: '슬랙', board: '게시판' };
const chText = (l: string[]) => (l.length ? l.map((c) => CH[c] ?? c).join(' · ') : '안 보냄(화면 목록만)');

export function OpbAlertRoutes() {
  const q = useApi<View>('/admin/opb/alert-routes');
  const a = useAct();
  const [ed, setEd] = useState<Edit | null>(null);
  if (q.error) return <p className="warn-text" data-opb-routes="err">규칙을 읽지 못했습니다(SUPER 만 볼 수 있습니다).</p>;
  if (!q.data) return <p className="muted">읽는 중…</p>;
  const d = q.data;
  const ask = (what: string) => prompt(`${what} 사유(2 ~ 200자 · 기록에 남음)`);

  const toggle = (k: 'on' | 'groupMail', v: boolean) => {
    const reason = ask(k === 'on' ? (v ? '규칙 쓰기 켜기' : '규칙 쓰기 끄기(지금 동작으로)') : (v ? '권한그룹 메일 켜기' : '권한그룹 메일 끄기'));
    if (!reason) return;
    void a.run(`sw-${k}`, () => api('/admin/opb/alert-route-settings', { method: 'PUT', body: JSON.stringify({ [k]: v, reason }) }), q.reload);
  };
  const open = (code: string) => {
    const r = d.rules.find((x) => x.code === code) ?? d.rules.find((x) => x.code === '*');
    setEd({ code, toTelegram: r?.toTelegram ?? true, toMail: r?.toMail ?? true, toSlack: r?.toSlack ?? true, toBoard: r?.toBoard ?? true,
      minSeverity: r?.minSeverity ?? 'CRITICAL', throttleMin: r?.throttleMin ?? 60, groups: r?.code === code ? r.groups : [], note: r?.code === code ? (r.note ?? '') : '',
      expectedUpdatedAt: d.rules.find((x) => x.code === code)?.updatedAt });
  };
  const save = () => {
    if (!ed) return;
    const reason = ask(`${ed.code} 규칙 저장`);
    if (!reason) return;
    const { code, ...body } = ed;
    void a.run('save', () => api(`/admin/opb/alert-routes/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify({ ...body, reason }) }), () => { setEd(null); q.reload(); });
  };
  const remove = (code: string) => {
    const reason = ask(`${code} 규칙 빼기(기본 줄을 따르게)`);
    if (!reason) return;
    void a.run(`rm-${code}`, () => api(`/admin/opb/alert-routes/${encodeURIComponent(code)}/remove`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload);
  };
  const yes = (b: boolean) => (b ? '●' : <span className="dim">—</span>);
  const differs = d.codes.filter((c) => c.differs).length;

  return (
    <div data-opb-routes={d.rules.length} data-opb-on={d.on ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card">
        <p><b>규칙 쓰기</b> <span className={d.on ? 'warn-text' : 'dim'} data-opb-switch="on">{d.on ? '켜짐' : '꺼짐(지금 동작)'}</span>{' '}
          <button className="btn-sm" disabled={a.busy === 'sw-on'} onClick={() => toggle('on', !d.on)} data-opb-toggle="on">{d.on ? '끄기' : '켜기'}</button>
          {' · '}<b>권한그룹 사람에게 따로 메일</b> <span className="dim" data-opb-switch="groupMail">{d.groupMail ? '켜짐' : '꺼짐'}</span>{' '}
          <button className="btn-sm btn-plain" disabled={a.busy === 'sw-groupMail'} onClick={() => toggle('groupMail', !d.groupMail)} data-opb-toggle="groupMail">{d.groupMail ? '끄기' : '켜기'}</button></p>
        <p className="muted">{d.note} 늘 지키는 것: 감사 기록 위변조 의심({d.lockedCodes.join(' · ')})은 늘 네 길 · 급함(CRITICAL)은 늘 게시판 · 「알림 잠시 끄기」는 그대로 먹음. 권한그룹 메일은 대표 메일(ops.digest_to) 한 통 뒤 그룹 사람(20명까지)에게 따로 갑니다.</p>
      </div>

      <h3>규칙</h3>
      <table className="tbl" data-opb-rule-table="">
        <thead><tr><th>종류</th><th>텔레그램</th><th>메일</th><th>슬랙</th><th>게시판</th><th>급함 기준(이상)</th><th className="num-cell">묶음 간격</th><th>받을 권한그룹</th><th>처음 값</th><th /></tr></thead>
        <tbody>
          {d.rules.map((r) => (
            <tr key={r.code} data-opb-rule={r.code}>
              <td>{r.code === '*' ? <b>기본(목록에 없는 종류)</b> : <span className="mono">{r.code}</span>}{r.note && <small className="dim"> {r.note}</small>}</td>
              <td>{yes(r.toTelegram)}</td><td>{yes(r.toMail)}</td><td>{yes(r.toSlack)}</td><td>{yes(r.toBoard)}</td>
              <td>{r.minSeverity}</td><td className="num-cell">{r.throttleMin}분</td>
              <td>{r.groups.length ? r.groups.join(' · ') : <span className="dim">—</span>}</td>
              <td>{r.initial ? <span className="dim">같음</span> : <b>바뀜</b>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" onClick={() => open(r.code)} data-opb-edit={r.code}>고치기</button>{' '}
                {r.code !== '*' && <button className="btn-sm btn-plain" disabled={a.busy === `rm-${r.code}`} onClick={() => remove(r.code)} data-opb-remove={r.code}>빼기</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {ed && (
        <div className="card" data-opb-editor={ed.code}>
          <p><b>{ed.code === '*' ? '기본 줄' : ed.code}</b> {ed.expectedUpdatedAt ? '고치기' : '새 규칙(기본 줄을 바탕으로)'}</p>
          <p>
            {(['toTelegram', 'toMail', 'toSlack', 'toBoard'] as const).map((k) => (
              <label key={k} style={{ marginRight: 12 }}><input type="checkbox" name={`opb-${k}`} checked={ed[k]} onChange={(e) => setEd({ ...ed, [k]: e.target.checked })} />{' '}
                {CH[k.slice(2).toLowerCase()] ?? k}</label>
            ))}
          </p>
          <p>
            <label>급함 기준 <select name="opb-sev" value={ed.minSeverity} onChange={(e) => setEd({ ...ed, minSeverity: e.target.value })}>
              {d.sevs.map((s) => <option key={s} value={s}>{s} 이상</option>)}</select></label>{' '}
            <label>묶음 간격(분) <input name="opb-throttle" type="number" min={0} max={1440} value={ed.throttleMin} onChange={(e) => setEd({ ...ed, throttleMin: Number(e.target.value) })} style={{ width: 90 }} /></label>
          </p>
          <p>받을 권한그룹:{' '}
            {d.groups.map((g) => (
              <label key={g.key} style={{ marginRight: 10 }}><input type="checkbox" name={`opb-g-${g.key}`} checked={ed.groups.includes(g.key)}
                onChange={(e) => setEd({ ...ed, groups: e.target.checked ? [...ed.groups, g.key] : ed.groups.filter((x) => x !== g.key) })} />{' '}
                {g.name} <small className="dim">{g.key} · {g.members}명</small></label>
            ))}
          </p>
          <p><label>메모 <input name="opb-note" value={ed.note} maxLength={200} onChange={(e) => setEd({ ...ed, note: e.target.value })} style={{ width: '60%' }} /></label></p>
          <p><button className="btn-ok" disabled={a.busy === 'save'} onClick={save} data-opb-save="">저장</button>{' '}
            <button className="btn-plain" onClick={() => setEd(null)}>닫기</button></p>
        </div>
      )}

      <h3>최근 30일 알림 종류 <small className="dim">지금 동작과 다른 종류 {differs}</small></h3>
      {d.codes.length === 0 ? <p className="muted">최근 30일 알림이 없습니다.</p> : (
        <table className="tbl" data-opb-codes={d.codes.length}>
          <thead><tr><th>종류</th><th className="num-cell">수</th><th className="num-cell">급함</th><th>마지막</th><th>따르는 줄</th><th>지금 동작</th><th>규칙대로면</th><th /></tr></thead>
          <tbody>
            {d.codes.map((c) => (
              <tr key={c.code} data-opb-code={c.code} data-opb-differs={c.differs ? '1' : '0'}>
                <td className="mono">{c.code}</td><td className="num-cell">{n(c.n)}</td><td className="num-cell">{n(c.critical)}</td><td><small>{c.last}</small></td>
                <td>{c.rule === '*' ? <span className="dim">기본</span> : '전용'}</td>
                <td><small>{chText(c.nowChannels)}</small></td>
                <td>{c.differs ? <b className="warn-text">{chText(c.channels)}</b> : <small>{chText(c.channels)}</small>}</td>
                <td>{c.rule === '*' && !d.lockedCodes.includes(c.code) && <button className="btn-sm btn-plain" onClick={() => open(c.code)} data-opb-add={c.code}>규칙 더하기</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">「지금 동작」 · 「규칙대로면」은 그 종류의 가장 높은 급함으로 셈합니다.</p>

      <details className="card" data-opb-log={d.log.length}>
        <summary><b>바꾼 기록</b> <small className="dim">{d.log.length}줄</small></summary>
        {d.log.length === 0 ? <p className="muted">아직 없습니다.</p> : (
          <table className="tbl"><tbody>
            {d.log.map((l) => <tr key={l.id}><td><small>{l.at}</small></td><td className="mono">{l.code}</td><td>{l.action}</td><td>{l.reason}</td><td><small className="dim">{l.by ?? ''}</small></td></tr>)}
          </tbody></table>
        )}
      </details>
    </div>
  );
}
