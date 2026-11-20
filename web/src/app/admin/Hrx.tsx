/* ===== v10.471 ~ 474 (D265 · docs/609 ~ 612) ㉟ 인사 4 — web/src/app/admin/Hrx.tsx 새 파일 =====
 * 대표 11/20 「㉟ 인사 4」.
 *   HrxOvertime   회계 › 인사 › 연장 근로        — 신청 목록 · 근태와 비교 · 승인 · 반려 · 승인 취소 · 대신 신청 · 주 합계 · 급여 대장 넘기기(SUPER) · 규칙(SUPER)
 *   HrxShifts     회계 › 인사 › 근무표           — 주 근무표(직원 × 7일) · 칸 고르기 · 저장 · 지난주 복사 · 근태와 다름 · 교대 유형(SUPER)
 *   HrxBooking    사무 › 회의실 · 장비 예약      — 날 · 자원별 예약 · 예약 · 취소 · 자원 넣기 · 고치기(ADMIN)
 *   HrxStocktake  회계 › 매입 · 경비 › 자산 실사 — 회차 · QR · 코드 읽기 · 찾음 · 없음 · 닫기 · 없어진 자산 처분(SUPER) · QR 라벨 인쇄
 *   MyHrx         사무 › 내 인사(아래)           — 내 연장 근로 신청 · 이번 주 합계 · 내 근무표 2주
 * (adminMenu · App.tsx 연결은 patches/1_wiring.md) · 글자 12 · 13 · 14px · 모서리 var(--r-sm) · # 색 없음(다크 모드 토큰 그대로)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { qrSvg } from '../../lib/qr';

const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const isSuper = () => tokenRoles().includes('SUPER');
const isMgr = () => tokenRoles().some((r) => r === 'SUPER' || r === 'ADMIN');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const won = (v: unknown) => `${Number(v ?? 0).toLocaleString('ko-KR')}원`;
const hm = (m: number) => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
const ST_OT: Record<string, string> = { REQUESTED: '신청', APPROVED: '승인', REJECTED: '반려', CANCELED: '취소' };
const DOW = ['월', '화', '수', '목', '금', '토', '일'];

/* ── v10.471 연장 근로 ── */
interface OtItem { id: string; employeeId: string; name: string; workOn: string; startHm: string; endHm: string; minutes: number; nightMin: number; dayKind: string; reason: string; state: string;
  decideNote: string | null; inHm: string | null; outHm: string | null; actualMin: number | null; flag: string; flagKo: string; pay: number; payMin: number; paidYm: string | null }
interface OtRules { rates: { OT: number; NIGHT: number; HOL: number; HOL8: number }; base: number; otMax: number; warn: number; stdHours: number; block: boolean; satHoliday: boolean; basis: string }
interface OtList { ym: string; rules: OtRules; items: OtItem[]; pending: number; employees: Array<{ id: string; name: string }>; kinds: Record<string, string>;
  weeks: Array<{ employeeId: string; name: string; monday: string; total: number; warn: boolean; over: boolean }>; note: string }
interface OtPay { ym: string; run: { id: string; state: string } | null; basis: string; byEmployee: Array<{ employeeId: string; name: string; count: number; minutes: number; amount: number }>; total: number; done: OtItem[]; note: string }
export function HrxOvertime() {
  const [ym, setYm] = useState(kstDay().slice(0, 7));
  const [st, setSt] = useState('');
  const q = useApi<OtList>(`/admin/hrx/overtime?ym=${ym}${st ? `&state=${st}` : ''}`, [ym, st]);
  const p = useApi<OtPay>(`/admin/hrx/overtime/payroll?ym=${ym}`, [ym]);
  const a = useAct();
  const [f, setF] = useState({ employeeId: '', workOn: kstDay(), startHm: '18:00', endHm: '21:00', reason: '' });
  const [rs, setRs] = useState<Record<string, string>>({});
  const [rl, setRl] = useState<{ rates: string; weekLimits: string; stdHours: string; block: boolean; satHoliday: boolean; basis: string; reason: string } | null>(null);
  const d = q.data;
  const reload = () => { q.reload(); p.reload(); };
  const post = (key: string, path: string, body: unknown) => void a.run(key, () => api(path, { method: 'POST', body: JSON.stringify(body) }), reload);
  return (
    <section data-hrx-overtime={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>{' '}
        <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태"><option value="">모두</option>{Object.entries(ST_OT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl" data-hrx-ot-list={d.items.length}><thead><tr><th>직원</th><th>날</th><th>시간</th><th>종류</th><th>근태</th><th>예상 수당</th><th>상태</th><th></th></tr></thead>
          <tbody>{d.items.map((x) => <tr key={x.id} data-hrx-ot={x.state}>
            <td>{x.name}</td><td>{x.workOn}</td><td>{x.startHm} ~ {x.endHm}<br /><small className="dim">{hm(x.minutes)}{x.nightMin ? ` · 야간 ${hm(x.nightMin)}` : ''}</small></td>
            <td>{d.kinds[x.dayKind] ?? x.dayKind}</td>
            <td className={x.flag === 'OK' || x.flag === 'FUTURE' ? '' : 'warn-text'}>{x.inHm ? `${x.inHm} ~ ${x.outHm ?? '—'}` : '—'}<br /><small>{x.flagKo}{x.actualMin != null ? ` · 겹침 ${hm(x.actualMin)}` : ''}</small></td>
            <td>{won(x.pay)}{x.paidYm && <><br /><small className="dim">{x.paidYm} 급여에 넘김</small></>}</td>
            <td>{ST_OT[x.state] ?? x.state}{x.decideNote ? <small className="dim"> · {x.decideNote}</small> : ''}<br /><small className="dim">{x.reason}</small></td>
            <td>{x.state === 'REQUESTED' && <>
                <button className="btn-sm" disabled={a.busy === `a${x.id}`} data-hrx-ot-approve={x.id} onClick={() => post(`a${x.id}`, `/admin/hrx/overtime/${x.id}/decide`, { decision: 'APPROVE' })}>승인</button>{' '}
                <input value={rs[x.id] ?? ''} onChange={(e) => setRs({ ...rs, [x.id]: e.target.value })} placeholder="반려 사유" size={10} />{' '}
                <button className="btn-sm btn-plain" disabled={a.busy === `r${x.id}` || (rs[x.id] ?? '').trim().length < 2} onClick={() => post(`r${x.id}`, `/admin/hrx/overtime/${x.id}/decide`, { decision: 'REJECT', note: rs[x.id] })}>반려</button></>}
              {x.state === 'APPROVED' && !x.paidYm && <button className="btn-sm btn-plain" disabled={a.busy === `v${x.id}`}
                onClick={() => { const why = prompt('승인 취소 사유(2자 이상)'); if (why && why.trim().length >= 2) post(`v${x.id}`, `/admin/hrx/overtime/${x.id}/revoke`, { reason: why }); }}>승인 취소</button>}</td>
          </tr>)}</tbody></table>
      )}
      {d && !!d.weeks.length && (
        <details data-hrx-ot-weeks={d.weeks.filter((w) => w.warn).length}><summary>직원별 주 합계(신청 + 승인 · 경고 {d.weeks.filter((w) => w.warn).length})</summary>
          <table className="tbl"><tbody>{d.weeks.map((w) => <tr key={`${w.employeeId}${w.monday}`}><td>{w.name}</td><td>{w.monday} 주</td>
            <td className={w.over || w.warn ? 'warn-text' : ''}>{hm(w.total)}{w.over ? ` · 한도 ${d.rules.otMax}시간 넘음` : w.warn ? ` · 주 ${d.rules.warn}시간 넘음` : ''}</td></tr>)}</tbody></table>
        </details>
      )}
      {d && (
        <div className="card pad" data-hrx-ot-for=""><b>대신 신청(본인 것은 내 인사에서)</b>
          <p><select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} aria-label="직원"><option value="">직원</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>{' '}
            <input type="date" value={f.workOn} onChange={(e) => setF({ ...f, workOn: e.target.value })} aria-label="일한 날" />{' '}
            <input type="time" value={f.startHm} onChange={(e) => setF({ ...f, startHm: e.target.value })} aria-label="시작" /> ~ <input type="time" value={f.endHm} onChange={(e) => setF({ ...f, endHm: e.target.value })} aria-label="끝" />{' '}
            <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="사유" size={16} />{' '}
            <button className="btn-sm" disabled={a.busy === 'for' || !f.employeeId || f.reason.trim().length < 2} onClick={() => post('for', '/admin/hrx/overtime', f)}>신청</button></p>
        </div>
      )}
      {p.data && (
        <div className="card pad" data-hrx-ot-payroll={p.data.run?.state ?? 'NONE'}><b>{p.data.ym} 급여 대장으로(기준 {p.data.basis === 'MIN' ? '승인 · 근태 중 작은 시간' : '승인 시간'})</b>
          <p className="muted">{p.data.note}</p>
          {!!p.data.byEmployee.length && <table className="tbl"><tbody>{p.data.byEmployee.map((g) => <tr key={g.employeeId}><td>{g.name}</td><td>{g.count}건 · {hm(g.minutes)}</td><td>{won(g.amount)}</td></tr>)}</tbody></table>}
          <p>넘길 합계 {won(p.data.total)} · 넘긴 것 {p.data.done.length}건{' '}
            {isSuper() && p.data.run?.state === 'DRAFT' && <>
              <button className="btn-sm" disabled={a.busy === 'push' || !p.data.byEmployee.length} data-hrx-ot-push="" onClick={() => post('push', '/admin/hrx/overtime/payroll', { ym })}>급여 대장에 넘기기</button>{' '}
              <button className="btn-sm btn-plain" disabled={a.busy === 'undo' || !p.data.done.length} onClick={() => { if (confirm('넘긴 연장 근로 수당을 급여 대장에서 뺄까요?')) post('undo', '/admin/hrx/overtime/payroll/undo', { ym }); }}>되돌리기</button></>}</p>
        </div>
      )}
      {d && (
        <details data-hrx-ot-rules=""><summary>가산율 · 주 한도(일반 원칙 값{isSuper() ? ' · SUPER 고침' : ''} · 노무사 확인)</summary>
          <p>연장 {d.rules.rates.OT}% · 야간 {d.rules.rates.NIGHT}% · 휴일 {d.rules.rates.HOL}% · 휴일 8시간 넘음 {d.rules.rates.HOL8}% · 주 {d.rules.base} + {d.rules.otMax}시간 · 경고 {d.rules.warn}시간 · 통상시급 = 월 기본급 ÷ {d.rules.stdHours}
            · 한도 넘는 승인 {d.rules.block ? '막음' : '허용'} · 토요일 {d.rules.satHoliday ? '휴일' : '휴무일(연장)'}</p>
          {isSuper() && !rl && <button className="btn-sm btn-plain" onClick={() => setRl({ rates: `OT:${d.rules.rates.OT},NIGHT:${d.rules.rates.NIGHT},HOL:${d.rules.rates.HOL},HOL8:${d.rules.rates.HOL8}`,
            weekLimits: `BASE:${d.rules.base},OT:${d.rules.otMax},WARN:${d.rules.warn}`, stdHours: String(d.rules.stdHours), block: d.rules.block, satHoliday: d.rules.satHoliday, basis: d.rules.basis, reason: '' })}>고치기</button>}
          {rl && (
            <div className="card pad" data-hrx-ot-rules-edit="">
              <input value={rl.rates} onChange={(e) => setRl({ ...rl, rates: e.target.value })} size={30} aria-label="가산율" />{' '}
              <input value={rl.weekLimits} onChange={(e) => setRl({ ...rl, weekLimits: e.target.value })} size={22} aria-label="주 한도" />{' '}
              <input type="number" min={100} max={249} value={rl.stdHours} onChange={(e) => setRl({ ...rl, stdHours: e.target.value })} style={{ width: 70 }} aria-label="통상시급 나눗수" />{' '}
              <label><input type="checkbox" checked={rl.block} onChange={(e) => setRl({ ...rl, block: e.target.checked })} /> 한도 넘는 승인 막기</label>{' '}
              <label><input type="checkbox" checked={rl.satHoliday} onChange={(e) => setRl({ ...rl, satHoliday: e.target.checked })} /> 토요일 휴일</label>{' '}
              <select value={rl.basis} onChange={(e) => setRl({ ...rl, basis: e.target.value })} aria-label="수당 기준"><option value="MIN">승인 · 근태 중 작은 시간</option><option value="REQUEST">승인 시간</option></select>{' '}
              <input value={rl.reason} onChange={(e) => setRl({ ...rl, reason: e.target.value })} placeholder="사유" size={14} />{' '}
              <button className="btn-sm" disabled={a.busy === 'rl' || rl.reason.trim().length < 2} onClick={() => void a.run('rl', () => api('/admin/hrx/overtime/rules', { method: 'PUT',
                body: JSON.stringify({ rates: rl.rates, weekLimits: rl.weekLimits, stdHours: Number(rl.stdHours), block: rl.block, satHoliday: rl.satHoliday, basis: rl.basis, reason: rl.reason }) }), () => { setRl(null); reload(); })}>저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setRl(null)}>닫기</button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

/* ── v10.472 근무표 ── */
interface ShType { code: string; name: string; kind: string; startHm: string | null; endHm: string | null; breakMin: number; active: boolean; sort: number }
interface ShCell { day: string; inRange: boolean; shift: { code: string; name: string; kind: string; startHm: string | null; endHm: string | null } | null; att: { inHm: string; outHm: string | null } | null; flags: string[]; flagsKo: string[] }
interface ShWeek { monday: string; days: string[]; today: string; lockBefore: string; types: ShType[]; rows: Array<{ employeeId: string; name: string; cells: ShCell[]; plannedHours: number; overBase: boolean; overLimit: boolean }>; diffs: number; note: string }
export function HrxShifts() {
  const [week, setWeek] = useState(kstDay());
  const q = useApi<ShWeek>(`/admin/hrx/shifts?week=${week}`, [week]);
  const a = useAct();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [ty, setTy] = useState<ShType | null>(null);
  const d = q.data;
  const changed = Object.entries(edit);
  const move = (n: number) => d && setWeek(new Date(Date.parse(d.monday) + n * 7 * 86400e3).toISOString().slice(0, 10));
  return (
    <section data-hrx-shifts={d ? d.rows.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><button className="btn-sm btn-plain" onClick={() => move(-1)}>지난주</button>{' '}<input type="date" value={week} onChange={(e) => setWeek(e.target.value)} aria-label="주" />{' '}
        <button className="btn-sm btn-plain" onClick={() => move(1)}>다음 주</button>{' '}
        {d && <button className="btn-sm btn-plain" disabled={a.busy === 'cp'} data-hrx-shift-copy="" onClick={() => void a.run('cp', () => api('/admin/hrx/shifts/copy', { method: 'POST', body: JSON.stringify({ week: d.monday }) }), () => q.reload())}>지난주 복사</button>}{' '}
        <button className="btn-sm" disabled={a.busy === 'sv' || !changed.length} data-hrx-shift-save={changed.length}
          onClick={() => void a.run('sv', () => api('/admin/hrx/shifts', { method: 'PUT', body: JSON.stringify({ cells: changed.map(([k, v]) => { const [employeeId, day] = k.split('|'); return { employeeId, day, type: v || null }; }) }) }), () => { setEdit({}); q.reload(); })}>
          저장{changed.length ? ` ${changed.length}칸` : ''}</button></p>
      {d && <p className="muted">{d.note} 다른 칸 {d.diffs}.</p>}
      {d && (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" data-hrx-shift-grid={d.rows.length}><thead><tr><th>직원</th>{d.days.map((x, i) => <th key={x}>{DOW[i]} {x.slice(5)}</th>)}<th>계획</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.employeeId}><td>{r.name}</td>
              {r.cells.map((c) => {
                const k = `${r.employeeId}|${c.day}`, locked = c.day < d.lockBefore || !c.inRange;
                const val = edit[k] ?? c.shift?.code ?? '';
                return <td key={c.day} data-hrx-cell={c.flags.join(' ') || 'ok'} style={{ fontSize: 12 }}>
                  <select value={val} disabled={locked} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} aria-label={`${r.name} ${c.day}`}>
                    <option value="">—</option>{d.types.filter((t) => t.active || t.code === c.shift?.code).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
                  {c.att && <div className="dim">{c.att.inHm} ~ {c.att.outHm ?? '—'}</div>}
                  {!!c.flagsKo.length && <div className={c.flags.every((x) => x === 'LEAVE') ? 'dim' : 'warn-text'}>{c.flagsKo.join(' · ')}</div>}
                </td>;
              })}
              <td className={r.overLimit || r.overBase ? 'warn-text' : ''}>{r.plannedHours}시간</td></tr>)}</tbody></table>
        </div>
      )}
      {d && (
        <details data-hrx-shift-types={d.types.length}><summary>교대 유형{isSuper() ? '(SUPER 고침)' : ''}</summary>
          <table className="tbl"><tbody>{d.types.map((t) => <tr key={t.code}><td>{t.code}</td><td>{t.name}</td><td>{t.kind === 'OFF' ? '휴무' : `${t.startHm} ~ ${t.endHm} · 휴게 ${t.breakMin}분`}</td><td>{t.active ? '씀' : '안 씀'}</td>
            <td>{isSuper() && <button className="btn-sm btn-plain" onClick={() => setTy({ ...t })}>고침</button>}</td></tr>)}</tbody></table>
          {isSuper() && <p><button className="btn-sm btn-plain" onClick={() => setTy({ code: '', name: '', kind: 'WORK', startHm: '09:00', endHm: '18:00', breakMin: 60, active: true, sort: 100 })}>유형 더하기</button></p>}
          {ty && (
            <div className="card pad">
              <input value={ty.code} onChange={(e) => setTy({ ...ty, code: e.target.value.toUpperCase() })} placeholder="코드" size={10} />{' '}
              <input value={ty.name} onChange={(e) => setTy({ ...ty, name: e.target.value })} placeholder="이름" size={10} />{' '}
              <select value={ty.kind} onChange={(e) => setTy({ ...ty, kind: e.target.value })}><option value="WORK">근무</option><option value="OFF">휴무</option></select>{' '}
              {ty.kind === 'WORK' && <><input type="time" value={ty.startHm ?? ''} onChange={(e) => setTy({ ...ty, startHm: e.target.value })} /> ~ <input type="time" value={ty.endHm ?? ''} onChange={(e) => setTy({ ...ty, endHm: e.target.value })} />{' '}
                휴게 <input type="number" min={0} max={240} value={ty.breakMin} onChange={(e) => setTy({ ...ty, breakMin: Number(e.target.value) })} style={{ width: 64 }} />분{' '}</>}
              <label><input type="checkbox" checked={ty.active} onChange={(e) => setTy({ ...ty, active: e.target.checked })} /> 씀</label>{' '}
              <button className="btn-sm" disabled={a.busy === 'ty' || !ty.code} onClick={() => void a.run('ty', () => api(`/admin/hrx/shifts/types/${encodeURIComponent(ty.code)}`, { method: 'PUT',
                body: JSON.stringify({ name: ty.name, kind: ty.kind, active: ty.active, sort: ty.sort, ...(ty.kind === 'WORK' ? { startHm: ty.startHm, endHm: ty.endHm, breakMin: ty.breakMin } : {}) }) }), () => { setTy(null); q.reload(); })}>저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setTy(null)}>닫기</button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

/* ── v10.473 회의실 · 장비 예약 ── */
interface Res { id: string; kind: string; name: string; location: string | null; capacity: number | null; note: string | null; active: boolean; sort: number }
interface Bk { id: string; resourceId: string; resource: string; title: string; memo: string | null; day: string; startHm: string; endHm: string; who: string; mine: boolean; canCancel: boolean; past: boolean }
export function HrxBooking() {
  const [day, setDay] = useState(kstDay());
  const q = useApi<{ resources: Res[]; items: Bk[]; canManage: boolean; rules: { aheadDays: number; maxHours: number }; note: string }>(`/admin/hrx/booking?from=${day}`, [day]);
  const a = useAct();
  const [f, setF] = useState({ resourceId: '', startHm: '10:00', endHm: '11:00', title: '', memo: '' });
  const [rf, setRf] = useState<Res | null>(null);
  const d = q.data;
  return (
    <section data-hrx-booking={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>날 <input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label></p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl" data-hrx-book-board={d.resources.length}><thead><tr><th>자원</th><th>예약</th></tr></thead>
          <tbody>{d.resources.filter((r) => r.active).map((r) => <tr key={r.id}><td>{r.kind === 'ROOM' ? '회의실' : '장비'} · <b>{r.name}</b><br /><small className="dim">{[r.location, r.capacity ? `${r.capacity}명` : ''].filter(Boolean).join(' · ')}</small></td>
            <td>{d.items.filter((b) => b.resourceId === r.id).map((b) => <div key={b.id} data-hrx-book={b.mine ? 'mine' : 'other'}>
              {b.startHm} ~ {b.endHm} {b.title} <small className="dim">{b.who}</small>{' '}
              {b.canCancel && <button className="btn-sm btn-plain" disabled={a.busy === `c${b.id}`} onClick={() => {
                const why = b.mine ? '' : prompt('남의 예약 취소 사유(2자 이상)') ?? '';
                if (!b.mine && why.trim().length < 2) return;
                void a.run(`c${b.id}`, () => api(`/admin/hrx/booking/${b.id}/cancel`, { method: 'POST', body: JSON.stringify(why ? { reason: why } : {}) }), () => q.reload());
              }}>취소</button>}
            </div>)}{!d.items.some((b) => b.resourceId === r.id) && <span className="dim">비어 있음</span>}</td></tr>)}</tbody></table>
      )}
      {d && (
        <div className="card pad" data-hrx-book-new=""><b>예약하기</b>
          <p><select value={f.resourceId} onChange={(e) => setF({ ...f, resourceId: e.target.value })} aria-label="자원"><option value="">자원</option>{d.resources.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>{' '}
            <input type="time" value={f.startHm} step={600} onChange={(e) => setF({ ...f, startHm: e.target.value })} aria-label="시작" /> ~ <input type="time" value={f.endHm} step={600} onChange={(e) => setF({ ...f, endHm: e.target.value })} aria-label="끝" />{' '}
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" size={16} />{' '}
            <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" size={12} />{' '}
            <button className="btn-sm" disabled={a.busy === 'bk' || !f.resourceId || !f.title.trim()} data-hrx-book-go=""
              onClick={() => void a.run('bk', () => api('/admin/hrx/booking', { method: 'POST', body: JSON.stringify({ resourceId: f.resourceId, day, startHm: f.startHm, endHm: f.endHm, title: f.title, ...(f.memo ? { memo: f.memo } : {}) }) }),
                () => { setF({ ...f, title: '', memo: '' }); q.reload(); })}>예약</button></p>
        </div>
      )}
      {d && (d.canManage || isMgr()) && (
        <details data-hrx-resources={d.resources.length}><summary>자원 관리(ADMIN)</summary>
          <table className="tbl"><tbody>{d.resources.map((r) => <tr key={r.id}><td>{r.kind === 'ROOM' ? '회의실' : '장비'}</td><td>{r.name}</td><td>{r.location ?? ''}</td><td>{r.capacity ?? ''}</td><td>{r.active ? '씀' : '안 씀'}</td>
            <td><button className="btn-sm btn-plain" onClick={() => setRf({ ...r })}>고침</button></td></tr>)}</tbody></table>
          <p><button className="btn-sm btn-plain" onClick={() => setRf({ id: '', kind: 'ROOM', name: '', location: '', capacity: null, note: '', active: true, sort: 100 })}>자원 더하기</button></p>
          {rf && (
            <div className="card pad">
              {!rf.id && <><select value={rf.kind} onChange={(e) => setRf({ ...rf, kind: e.target.value })}><option value="ROOM">회의실</option><option value="EQUIP">장비</option></select>{' '}</>}
              <input value={rf.name} onChange={(e) => setRf({ ...rf, name: e.target.value })} placeholder="이름" size={14} />{' '}
              <input value={rf.location ?? ''} onChange={(e) => setRf({ ...rf, location: e.target.value })} placeholder="위치" size={10} />{' '}
              <input type="number" min={1} max={500} value={rf.capacity ?? ''} onChange={(e) => setRf({ ...rf, capacity: e.target.value ? Number(e.target.value) : null })} placeholder="인원" style={{ width: 70 }} />{' '}
              {!!rf.id && <label><input type="checkbox" checked={rf.active} onChange={(e) => setRf({ ...rf, active: e.target.checked })} /> 씀</label>}{' '}
              <button className="btn-sm" disabled={a.busy === 'rf' || !rf.name.trim()} onClick={() => void a.run('rf', () => rf.id
                ? api(`/admin/hrx/booking/resources/${rf.id}`, { method: 'PUT', body: JSON.stringify({ name: rf.name, location: rf.location || null, capacity: rf.capacity, active: rf.active }) })
                : api('/admin/hrx/booking/resources', { method: 'POST', body: JSON.stringify({ kind: rf.kind, name: rf.name, ...(rf.location ? { location: rf.location } : {}), ...(rf.capacity ? { capacity: rf.capacity } : {}) }) }),
                () => { setRf(null); q.reload(); })}>저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setRf(null)}>닫기</button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

/* ── v10.474 자산 실사 · QR 라벨 ── */
interface StRow { id: string; title: string; asOf: string; state: string; total: number; found: number; missing: number; pending: number; disposed: number }
interface StLine { assetId: string; code: string; name: string; category: string | null; acquiredOn: string; assetState: string; result: string; resultKo: string; location: string | null; note: string | null; disposedAt: string | null }
interface StOne { stocktake: { id: string; title: string; asOf: string; state: string }; lines: StLine[]; counts: { total: number; found: number; missing: number; pending: number; disposed: number }; disposable: number }

/** QR 라벨 인쇄 창 — 칸마다 QR · 코드 · 이름 · 취득일(금액 없음) · 팝업이 막히면 false */
function printLabels(items: Array<{ code: string; name: string; category: string | null; acquiredOn: string }>) {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  const cells = items.map((x) => `<div class="lb">${qrSvg(x.code, 3)}<div class="tx"><b>${esc(x.code)}</b><br>${esc(x.name)}<br><span>${esc(x.category ?? '')} ${esc(x.acquiredOn)}</span></div></div>`).join('');
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>고정자산 QR 라벨</title><style>
    @page { size: A4; margin: 10mm; } body { font-family: 'Pretendard', 'Noto Sans KR', sans-serif; margin: 0; color: black; background: white; }
    .bar { padding: 8px; border-bottom: 1px solid lightgray; font-size: 13px; } .bar button { font-size: 14px; padding: 6px 12px; border-radius: 7px; border: 1px solid dimgray; background: white; }
    .grid { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; } .lb { width: 62mm; border: 1px dashed gray; border-radius: 7px; display: flex; gap: 6px; align-items: center; padding: 4px; page-break-inside: avoid; }
    .tx { font-size: 12px; line-height: 1.4; } .tx span { color: dimgray; } @media print { .bar { display: none; } }</style></head><body>
    <div class="bar"><button onclick="window.print()">인쇄</button> 라벨 ${items.length}장 — QR 에는 자산 코드만 들어 있습니다(금액 · 사람 이름 없음). 못 읽히면 코드를 실사 화면에 적습니다.</div>
    <div class="grid">${cells}</div></body></html>`);
  w.document.close(); w.focus();
  return true;
}

export function HrxStocktake() {
  const q = useApi<{ items: StRow[]; activeAssets: number; note: string }>('/admin/hrx/stocktakes', []);
  const a = useAct();
  const [sel, setSel] = useState('');
  const one = useApi<StOne | null>(sel ? `/admin/hrx/stocktakes/${sel}` : '/admin/hrx/stocktakes', [sel]);
  const [nf, setNf] = useState({ title: '', asOf: kstDay() });
  const [scan, setScan] = useState({ code: '', location: '' });
  const d = q.data, s = sel ? (one.data as StOne | null) : null;
  const reload = () => { q.reload(); one.reload(); };
  const labels = (ids: string[]) => void a.run('lb', async () => {
    const r = await api<{ items: Array<{ code: string; name: string; category: string | null; acquiredOn: string }>; count: number }>(`/admin/hrx/asset-labels${ids.length ? `?ids=${ids.join(',')}` : ''}`);
    if (!printLabels(r.items)) return { ok: false, note: '팝업이 막혀 인쇄 창을 열지 못했습니다 — 이 사이트의 팝업을 허용하십시오.' };
    return { ok: true, note: `라벨 ${r.count}장 인쇄 창을 열었습니다.` };
  });
  return (
    <section data-hrx-stocktake={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className="muted">{d.note} 쓰는 고정자산 {d.activeAssets}개.</p>}
      <p><button className="btn-sm btn-plain" disabled={a.busy === 'lb'} data-hrx-labels="" onClick={() => labels([])}>QR 라벨 인쇄(쓰는 자산 모두)</button></p>
      {d && (
        <table className="tbl" data-hrx-st-list={d.items.length}><thead><tr><th>회차</th><th>기준일</th><th>상태</th><th>찾음 · 없음 · 확인 전</th><th></th></tr></thead>
          <tbody>{d.items.map((x) => <tr key={x.id}><td>{x.title}</td><td>{x.asOf}</td><td>{x.state === 'OPEN' ? '열림' : '닫음'}</td><td>{x.found} · {x.missing} · {x.pending} / {x.total}{x.disposed ? ` · 처분 ${x.disposed}` : ''}</td>
            <td><button className="btn-sm btn-plain" onClick={() => setSel(x.id)}>열기</button></td></tr>)}</tbody></table>
      )}
      <div className="card pad" data-hrx-st-new=""><b>새 회차</b>{' '}
        <input value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} placeholder="회차 이름" size={18} />{' '}
        <input type="date" value={nf.asOf} max={kstDay()} onChange={(e) => setNf({ ...nf, asOf: e.target.value })} aria-label="기준일" />{' '}
        <button className="btn-sm" disabled={a.busy === 'op' || nf.title.trim().length < 2} onClick={() => void a.run('op', () => api<{ id: string }>('/admin/hrx/stocktakes', { method: 'POST', body: JSON.stringify(nf) }),
          () => { setNf({ ...nf, title: '' }); q.reload(); })}>열기</button>
      </div>
      {s && s.stocktake && (
        <div className="card pad" data-hrx-st-one={s.stocktake.state}>
          <b>{s.stocktake.title}</b> <small className="dim">기준일 {s.stocktake.asOf} · 찾음 {s.counts.found} · 없음 {s.counts.missing} · 확인 전 {s.counts.pending} / {s.counts.total}</small>
          {s.stocktake.state === 'OPEN' && (
            <p><input value={scan.code} autoFocus onChange={(e) => setScan({ ...scan, code: e.target.value })} placeholder="QR · 코드 읽기(SGB-AST-…)" size={22} data-hrx-scan=""
                onKeyDown={(e) => { if (e.key === 'Enter' && scan.code.trim()) void a.run('sc', () => api(`/admin/hrx/stocktakes/${sel}/scan`, { method: 'POST', body: JSON.stringify({ code: scan.code, ...(scan.location ? { location: scan.location } : {}) }) }), () => { setScan({ ...scan, code: '' }); reload(); }); }} />{' '}
              <input value={scan.location} onChange={(e) => setScan({ ...scan, location: e.target.value })} placeholder="둔 곳(같이 적힘)" size={12} />{' '}
              <button className="btn-sm btn-plain" disabled={a.busy === 'cl'} onClick={() => { const all = s.counts.pending > 0 && confirm(`확인 전 ${s.counts.pending}개를 「없음」으로 바꾸고 닫을까요?`);
                if (s.counts.pending > 0 && !all) return; void a.run('cl', () => api(`/admin/hrx/stocktakes/${sel}/close`, { method: 'POST', body: JSON.stringify({ pendingAsMissing: !!all }) }), reload); }}>회차 닫기</button></p>
          )}
          {s.stocktake.state === 'CLOSED' && isSuper() && s.disposable > 0 && (
            <p><button className="btn-sm" disabled={a.busy === 'dp'} data-hrx-dispose="" onClick={() => { if (confirm(`없어진 자산 ${s.disposable}개를 처분할까요? 처분 손실 전표가 생기고 되돌리지 않습니다.`))
              void a.run('dp', () => api(`/admin/hrx/stocktakes/${sel}/dispose`, { method: 'POST', body: '{}' }), reload); }}>없어진 자산 처분 {s.disposable}개</button></p>
          )}
          <table className="tbl" data-hrx-st-lines={s.lines.length}><tbody>{s.lines.map((l) => <tr key={l.assetId} data-hrx-st-line={l.result}>
            <td>{l.code}</td><td>{l.name}<br /><small className="dim">{l.category ?? ''} {l.acquiredOn}</small></td>
            <td className={l.result === 'MISSING' ? 'warn-text' : l.result === 'PENDING' ? 'dim' : ''}>{l.resultKo}{l.disposedAt ? ' · 처분함' : ''}</td><td>{l.location ?? ''}</td>
            <td>{s.stocktake.state === 'OPEN' && ['FOUND', 'MISSING', 'PENDING'].filter((r) => r !== l.result).map((r) => <button key={r} className="btn-sm btn-plain" disabled={a.busy === `m${l.assetId}`}
                onClick={() => void a.run(`m${l.assetId}`, () => api(`/admin/hrx/stocktakes/${sel}/lines/${l.assetId}`, { method: 'PUT', body: JSON.stringify({ result: r }) }), reload)}>{r === 'FOUND' ? '찾음' : r === 'MISSING' ? '없음' : '확인 전'}</button>)}{' '}
              <button className="btn-sm btn-plain" onClick={() => labels([l.assetId])}>라벨</button></td></tr>)}</tbody></table>
        </div>
      )}
    </section>
  );
}

/* ── 사무 › 내 인사(아래) — 내 연장 근로 · 근무표 ── */
interface MyHrxData { linked: boolean; overtime: { items: OtItem[]; week: { monday: string; approved: number; requested: number; warnHours: number; limitHours: number; warning: string | null } | null };
  shifts: { days: Array<{ day: string; shift: { name: string; kind: string; startHm: string | null; endHm: string | null } | null }> } }
export function MyHrx() {
  const q = useApi<MyHrxData>('/admin/me/hrx', []);
  const a = useAct();
  const [f, setF] = useState({ workOn: kstDay(), startHm: '18:00', endHm: '20:00', reason: '' });
  const d = q.data;
  if (!d || !d.linked) return null;
  const w = d.overtime.week;
  return (
    <section data-my-hrx={d.overtime.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad"><b>연장 · 야간 · 휴일 근로</b>
        {w && <p className={w.warning ? 'warn-text' : 'muted'}>이번 주({w.monday} ~) 승인 {hm(w.approved)} · 신청 중 {hm(w.requested)} — 경고 주 {w.warnHours}시간 · 한도 주 {w.limitHours}시간{w.warning ? ` · ${w.warning}` : ''}</p>}
        <p><input type="date" value={f.workOn} onChange={(e) => setF({ ...f, workOn: e.target.value })} aria-label="일한 날" />{' '}
          <input type="time" value={f.startHm} onChange={(e) => setF({ ...f, startHm: e.target.value })} aria-label="시작" /> ~ <input type="time" value={f.endHm} onChange={(e) => setF({ ...f, endHm: e.target.value })} aria-label="끝" />{' '}
          <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="사유" size={16} />{' '}
          <button className="btn-sm" disabled={a.busy === 'ot' || f.reason.trim().length < 2} data-my-ot-go="" onClick={() => void a.run('ot', () => api<{ note?: string; warning?: string | null }>('/admin/me/hrx/overtime', { method: 'POST', body: JSON.stringify(f) }),
            () => { setF({ ...f, reason: '' }); q.reload(); }, (r: { note?: string; warning?: string | null }) => `${r.note ?? ''}${r.warning ? ` ${r.warning}` : ''}`)}>신청</button></p>
        {!!d.overtime.items.length && <table className="tbl"><tbody>{d.overtime.items.slice(0, 10).map((x) => <tr key={x.id}><td>{x.workOn}</td><td>{x.startHm} ~ {x.endHm}</td><td>{hm(x.minutes)}</td>
          <td>{ST_OT[x.state] ?? x.state}{x.decideNote ? <small className="dim"> · {x.decideNote}</small> : ''}</td>
          <td>{x.state === 'REQUESTED' && <button className="btn-sm btn-plain" disabled={a.busy === `c${x.id}`} onClick={() => void a.run(`c${x.id}`, () => api(`/admin/me/hrx/overtime/${x.id}/cancel`, { method: 'POST' }), () => q.reload())}>취소</button>}</td></tr>)}</tbody></table>}
      </div>
      {d.shifts.days.some((x) => x.shift) && (
        <div className="card pad" data-my-shifts=""><b>내 근무표(이번 주 · 다음 주)</b>
          <p style={{ fontSize: 13 }}>{d.shifts.days.filter((x) => x.shift).map((x) => `${x.day.slice(5)} ${x.shift!.name}${x.shift!.kind === 'WORK' ? `(${x.shift!.startHm} ~ ${x.shift!.endHm})` : ''}`).join(' · ')}</p>
        </div>
      )}
    </section>
  );
}
