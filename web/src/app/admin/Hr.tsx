/* ===== v10.445 ~ 448 (D259 · docs/582 ~ 585) ㉖ 인사 2 — web/src/app/admin/Hr.tsx 새 파일 =====
 * 대표 11/20 「다음개발」.
 *   HrAttend      회계 › 인사 › 근태          — 직원 ↔ 계정 연결(SUPER) · 달 근태 · 집계 · 시각 고침 · 빠진 날 · 달 확인
 *   HrLeave       회계 › 인사 › 휴가 신청     — 신청 목록 · 승인 · 반려 · 승인 취소
 *   AcctPayslip   회계 › 인사 › 급여명세서    — 달 목록 · 한 장 인쇄 · 알림 메일(SUPER · 처음 꺼짐)
 *   AcctYearend   회계 › 인사 › 연말정산 자료 — 해 합계 · 달별 · 서류 받음 표시 · CSV(승인)
 *   MyHr          사무 › 내 인사              — 출근 · 퇴근 · 이번 달 · 남은 연차 · 휴가 신청 · 내 명세서
 * (adminMenu · App.tsx 연결은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';
import { openPrint } from '../../lib/printDoc';   // v10.468 (D264) 문서 PDF(인쇄)

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const isSuper = () => tokenRoles().includes('SUPER');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hm = (m: number | null | undefined) => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
const HALF_KO: Record<string, string> = { FULL: '종일', AM: '오전 반차', PM: '오후 반차' };
const ST_KO: Record<string, string> = { REQUESTED: '신청', APPROVED: '승인', REJECTED: '반려', CANCELED: '취소' };
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};

/* ── 급여명세서 인쇄(새 창) ── */
interface Line { label: string; amount: number }
interface Slip { company: string; slip: { name: string; ym: string; payDay: string; joinedOn: string }; pay: Line[]; deductions: Line[]; companyShare: Line[]; net: number; totalDeductions: number; note: string }
function printSlip(s: Slip) {
  /* v10.468 (D264 · docs/606) — 공용 인쇄 창(A4 · 「PDF 로 저장」 안내) · 지급 · 공제를 나란히(좁으면 아래로) · 파일 이름 「급여명세서_YYYY-MM_이름」 */
  const rows = (ls: Line[]) => ls.map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${won(l.amount)}</td></tr>`).join('');
  const body = `<h1>급 여 명 세 서</h1>
    <table class="meta"><tr><td><b>${esc(s.company)}</b></td><td class="r">${esc(s.slip.ym)} · 지급일 ${esc(s.slip.payDay)}</td></tr><tr><td>성명 <b>${esc(s.slip.name)}</b></td><td class="r">입사일 ${esc(s.slip.joinedOn)}</td></tr></table>
    <div class="cols"><table><thead><tr><th colspan="2">지급</th></tr></thead><tbody>${rows(s.pay)}</tbody></table>
    <table><thead><tr><th colspan="2">공제</th></tr></thead><tbody>${rows(s.deductions)}<tr class="sum"><td>공제 합계</td><td class="r">${won(s.totalDeductions)}</td></tr></tbody></table></div>
    <table class="total"><tr class="sum"><td>실지급액</td><td class="r">${won(s.net)}원</td></tr></table>
    <table><thead><tr><th colspan="2">회사 부담(참고)</th></tr></thead><tbody>${rows(s.companyShare)}</tbody></table>
    <p class="small">${esc(s.note)}</p>`;
  if (!openPrint({ title: `급여명세서_${s.slip.ym}_${s.slip.name}`, body, kind: 'PAYSLIP' })) alert('팝업이 막혀 명세서 창을 열지 못했습니다 — 팝업 차단을 풀고 다시 누르십시오.');
}

/* ── v10.445 근태 ── */
interface AttRow { id: string; employeeId: string; name: string; workOn: string; inHm: string; outHm: string | null; minutes: number | null; late: boolean; fixed: boolean; confirmed: boolean; memo: string | null }
interface AttSum { employeeId: string; name: string; days: number; minutes: number; hours: number; late: number; open: number; confirmed: number; leaveDays: number }
interface AttMonth { ym: string; workStart: string; rows: AttRow[]; summary: AttSum[]; note: string;
  employees: Array<{ id: string; name: string; accountId: string | null; email: string | null }>;
  fixes: Array<{ id: string; name: string; workOn: string; beforeIn: string | null; beforeOut: string | null; afterIn: string; afterOut: string | null; reason: string; createdAt: string }> }
export function HrAttend() {
  const [ym, setYm] = useState(kstDay().slice(0, 7));
  const q = useApi<AttMonth>(`/admin/hr/attendance?ym=${ym}`, [ym]);
  const a = useAct();
  const [fx, setFx] = useState<{ id: string; inAt: string; outAt: string; reason: string } | null>(null);
  const [ad, setAd] = useState({ employeeId: '', workOn: kstDay(-1), inAt: '09:00', outAt: '18:00', reason: '' });
  const [link, setLink] = useState<Record<string, string>>({});
  const d = q.data;
  const post = (key: string, path: string, body: unknown, after?: () => void) =>
    void a.run(key, () => api(path, { method: 'POST', body: JSON.stringify(body) }), () => { after?.(); q.reload(); });
  return (
    <section data-hr-attend={d ? d.rows.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm" disabled={a.busy === 'cf'} onClick={() => { if (confirm(`${ym} 근태를 확인할까요? 확인한 줄은 고치지 못합니다(본인 줄 빼고).`)) post('cf', '/admin/hr/attendance/confirm', { ym }); }} data-hr-confirm="">달 확인</button></p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl" data-hr-summary={d.summary.length}><thead><tr><th>직원</th><th>일한 날</th><th>시간</th><th>늦음</th><th>퇴근 없음</th><th>확인</th><th>휴가</th><th>계정 연결</th></tr></thead>
          <tbody>{d.summary.map((s) => {
            const e = d.employees.find((x) => x.id === s.employeeId);
            return <tr key={s.employeeId}><td>{s.name}</td><td>{s.days}</td><td>{s.hours}</td><td>{s.late || ''}</td><td>{s.open ? <span className="warn-text">{s.open}</span> : ''}</td>
              <td>{s.confirmed}/{s.days}</td><td>{s.leaveDays || ''}</td>
              <td>{e?.email ?? <span className="dim">없음</span>}{isSuper() && <span>{' '}<input value={link[s.employeeId] ?? ''} onChange={(ev) => setLink({ ...link, [s.employeeId]: ev.target.value })} placeholder="운영 계정 메일(비우면 풂)" size={22} />{' '}
                <button className="btn-sm" disabled={a.busy === `l${s.employeeId}`} data-hr-link={s.employeeId}
                  onClick={() => void a.run(`l${s.employeeId}`, () => api(`/admin/hr/employees/${s.employeeId}/account`, { method: 'PUT', body: JSON.stringify({ email: link[s.employeeId] ?? '' }) }), () => q.reload())}>연결</button></span>}</td></tr>;
          })}</tbody></table>
      )}
      {d && (
        <details open data-hr-rows={d.rows.length}><summary>날마다 {d.rows.length}줄</summary>
          <table className="tbl"><thead><tr><th>날</th><th>직원</th><th>출근</th><th>퇴근</th><th>일한 시간</th><th>표시</th><th></th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.id}><td>{r.workOn}</td><td>{r.name}</td><td>{r.inHm}{r.late && <span className="warn-text"> 늦음</span>}</td><td>{r.outHm ?? '—'}</td><td>{hm(r.minutes)}</td>
              <td>{r.fixed && <small className="dim">고침 </small>}{r.confirmed && <small>확인</small>}</td>
              <td>{!r.confirmed && <button className="btn-sm btn-plain" onClick={() => setFx({ id: r.id, inAt: r.inHm, outAt: r.outHm ?? '', reason: '' })}>고침</button>}</td></tr>)}</tbody></table>
        </details>
      )}
      {fx && (
        <div className="card pad" data-hr-fix={fx.id}><b>시각 고침</b>{' '}
          <input type="time" value={fx.inAt} onChange={(e) => setFx({ ...fx, inAt: e.target.value })} aria-label="출근" /> ~ <input type="time" value={fx.outAt} onChange={(e) => setFx({ ...fx, outAt: e.target.value })} aria-label="퇴근" />{' '}
          <input value={fx.reason} onChange={(e) => setFx({ ...fx, reason: e.target.value })} placeholder="사유(2 ~ 200자)" size={30} />{' '}
          <button className="btn-sm" disabled={a.busy === 'fx' || fx.reason.trim().length < 2} onClick={() => post('fx', `/admin/hr/attendance/${fx.id}/fix`, { inAt: fx.inAt, ...(fx.outAt ? { outAt: fx.outAt } : {}), reason: fx.reason }, () => setFx(null))}>고치기</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setFx(null)}>닫기</button></div>
      )}
      {d && (
        <div className="card pad" data-hr-add=""><b>빠진 날 넣기</b>{' '}
          <select value={ad.employeeId} onChange={(e) => setAd({ ...ad, employeeId: e.target.value })} aria-label="직원"><option value="">직원</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>{' '}
          <input type="date" value={ad.workOn} max={kstDay()} onChange={(e) => setAd({ ...ad, workOn: e.target.value })} aria-label="날" />{' '}
          <input type="time" value={ad.inAt} onChange={(e) => setAd({ ...ad, inAt: e.target.value })} aria-label="출근" /> ~ <input type="time" value={ad.outAt} onChange={(e) => setAd({ ...ad, outAt: e.target.value })} aria-label="퇴근" />{' '}
          <input value={ad.reason} onChange={(e) => setAd({ ...ad, reason: e.target.value })} placeholder="사유" size={20} />{' '}
          <button className="btn-sm" disabled={a.busy === 'ad' || !ad.employeeId || ad.reason.trim().length < 2} onClick={() => post('ad', '/admin/hr/attendance/add', { ...ad, ...(ad.outAt ? {} : { outAt: undefined }) })}>넣기</button></div>
      )}
      {d && !!d.fixes.length && (
        <details data-hr-fixes={d.fixes.length}><summary>고침 기록 {d.fixes.length}</summary>
          <table className="tbl"><tbody>{d.fixes.map((f) => <tr key={f.id}><td>{ymdhm(f.createdAt)}</td><td>{f.name} · {f.workOn}</td><td>{f.beforeIn ?? '—'} ~ {f.beforeOut ?? '—'} → {f.afterIn} ~ {f.afterOut ?? '—'}</td><td>{f.reason}</td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}

/* ── v10.446 휴가 신청(관리자) ── */
interface LeaveReq { id: string; employeeId: string; name: string; startOn: string; endOn: string; half: string; days: number; note: string | null; state: string; decideNote: string | null; decidedBy: string | null; remaining: number }
export function HrLeave() {
  const [st, setSt] = useState('REQUESTED');
  const q = useApi<{ items: LeaveReq[]; pending: number; allowNegative: boolean; note: string }>(`/admin/hr/leave${st ? `?state=${st}` : ''}`, [st]);
  const a = useAct();
  const [nt, setNt] = useState<Record<string, string>>({});
  const d = q.data;
  const go = (key: string, path: string, body: unknown) => void a.run(key, () => api(path, { method: 'POST', body: JSON.stringify(body) }), () => q.reload());
  return (
    <section data-hr-leave={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>상태 <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">모두</option>{Object.entries(ST_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {d && <small className="dim"> 기다리는 신청 {d.pending} · 남은 연차보다 많이 승인 {d.allowNegative ? '허용' : '막음'}</small>}</p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl"><thead><tr><th>직원</th><th>기간</th><th>일수</th><th>남은 연차</th><th>사유</th><th>상태</th><th></th></tr></thead>
          <tbody>{d.items.map((r) => <tr key={r.id} data-hr-leave-row={r.state}><td>{r.name}</td><td>{r.startOn}{r.endOn !== r.startOn ? ` ~ ${r.endOn}` : ''} · {HALF_KO[r.half] ?? r.half}</td>
            <td>{r.days}</td><td className={r.remaining < r.days && r.state === 'REQUESTED' ? 'warn-text' : ''}>{r.remaining}</td><td>{r.note ?? ''}</td>
            <td>{ST_KO[r.state] ?? r.state}{r.decideNote ? <small className="dim"> · {r.decideNote}</small> : ''}</td>
            <td>{(r.state === 'REQUESTED' || r.state === 'APPROVED') && <input value={nt[r.id] ?? ''} onChange={(e) => setNt({ ...nt, [r.id]: e.target.value })} placeholder="메모 · 사유" size={14} />}{' '}
              {r.state === 'REQUESTED' && <>
                <button className="btn-sm" disabled={a.busy === `a${r.id}`} onClick={() => go(`a${r.id}`, `/admin/hr/leave/${r.id}/decide`, { decision: 'APPROVE', ...(nt[r.id] ? { note: nt[r.id] } : {}) })}>승인</button>{' '}
                <button className="btn-sm btn-plain" disabled={a.busy === `r${r.id}` || (nt[r.id] ?? '').trim().length < 2} onClick={() => go(`r${r.id}`, `/admin/hr/leave/${r.id}/decide`, { decision: 'REJECT', note: nt[r.id] })}>반려</button></>}
              {r.state === 'APPROVED' && <button className="btn-sm btn-plain" disabled={a.busy === `v${r.id}` || (nt[r.id] ?? '').trim().length < 2}
                onClick={() => { if (confirm('승인을 취소하고 연차를 되돌릴까요?')) go(`v${r.id}`, `/admin/hr/leave/${r.id}/revoke`, { reason: nt[r.id] }); }}>승인 취소</button>}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

/* ── v10.447 급여명세서 ── */
interface SlipRow { id: string; name: string; gross: number; deductions: number; net: number; linked: boolean; mail: { result: string; at: string } | null }
export function AcctPayslip() {
  const [ym, setYm] = useState('');
  const q = useApi<{ ym: string | null; runs: Array<{ ym: string; state: string; payDay: string }>; items: SlipRow[]; mailOn: boolean; note: string }>(`/admin/acct/payslips${ym ? `?ym=${ym}` : ''}`, [ym]);
  const a = useAct();
  const d = q.data;
  const open = (id: string) => void a.run(`p${id}`, async () => { const s = await api<Slip>(`/admin/acct/payslips/${id}`); printSlip(s); return s; }, undefined, () => '명세서를 새 창에 열었습니다.');
  return (
    <section data-acct-payslip={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>달 <select value={ym || d?.ym || ''} onChange={(e) => setYm(e.target.value)}>{(d?.runs ?? []).map((r) => <option key={r.ym} value={r.ym}>{r.ym} · 지급 {r.payDay}</option>)}</select></label>{' '}
        {isSuper() && d?.ym && <button className="btn-sm" disabled={a.busy === 'n' || !d.mailOn} title={d.mailOn ? '' : '정책 › 전체 설정 acct.payslip_mail 을 켜야 합니다'} data-acct-payslip-notify=""
          onClick={() => { if (confirm(`${d.ym} 명세서 알림 메일을 보낼까요? (금액 없음 · 이미 보낸 사람은 빼고)`)) void a.run('n', () => api('/admin/acct/payslips/notify', { method: 'POST', body: JSON.stringify({ ym: d.ym }) }), () => q.reload()); }}>알림 메일 보내기</button>}
        {d && !d.mailOn && <small className="dim"> 알림 메일 꺼짐</small>}</p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl"><thead><tr><th>직원</th><th>총급여</th><th>공제</th><th>실지급</th><th>계정</th><th>메일</th><th></th></tr></thead>
          <tbody>{d.items.map((x) => <tr key={x.id}><td>{x.name}</td><td>{won(x.gross)}</td><td>{won(x.deductions)}</td><td><b>{won(x.net)}</b></td><td>{x.linked ? '연결' : <span className="dim">없음</span>}</td>
            <td>{x.mail ? `${x.mail.result} · ${ymdhm(x.mail.at)}` : ''}</td><td><button className="btn-sm btn-plain" onClick={() => open(x.id)}>명세서</button></td></tr>)}</tbody></table>
      )}
    </section>
  );
}

/* ── v10.448 연말정산 자료 ── */
interface YeRow { employeeId: string; name: string; dependents: number; gross: number; nontax: number; taxable: number; incomeTax: number; localTax: number; np: number; hi: number; ltc: number; ei: number;
  months: Array<{ month: number; gross: number; incomeTax: number }>; checks: Record<string, { done: boolean; note: string | null; at: string } | null>; missing: string[] }
export function AcctYearend() {
  const [year, setYear] = useState(String(Number(kstDay().slice(0, 4)) - (Number(kstDay().slice(5, 7)) <= 2 ? 1 : 0)));
  const q = useApi<{ year: string; items: YeRow[]; itemsKo: Record<string, string>; ready: number; note: string }>(`/admin/acct/yearend?year=${year}`, [year]);
  const a = useAct();
  const d = q.data;
  const mark = (e: string, item: string, done: boolean) => void a.run(`${e}${item}`, () => api('/admin/acct/yearend/checks', { method: 'POST', body: JSON.stringify({ employeeId: e, year: Number(year), item, done }) }), () => q.reload());
  const exp = () => void a.run('x', async () => {
    const t = await exportTicket('ACCT_TAX');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ csv: string; filename: string; note: string }>(`/admin/acct/yearend/export?year=${year}&ticket=${t}`); save(r.filename, r.csv); return r;
  }, undefined, (r) => r?.note ?? '');
  const items = ['SIMPLE_PDF', 'DEDUCTION_FORM', 'DEPENDENT', 'PREV_JOB'];
  return (
    <section data-acct-yearend={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>해 <input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} style={{ width: '6em' }} /></label>{' '}
        <button className="btn-sm" disabled={a.busy === 'x'} onClick={exp} data-acct-yearend-export="">CSV 내려받기(승인)</button>
        {d && <small className="dim"> 서류 다 받음 {d.ready} / {d.items.length}</small>}</p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl"><thead><tr><th>직원</th><th>부양</th><th>총급여</th><th>비과세</th><th>기납부 소득세</th><th>지방소득세</th><th>4대보험</th>{items.map((k) => <th key={k}>{d.itemsKo[k]}</th>)}</tr></thead>
          <tbody>{d.items.map((x) => <tr key={x.employeeId}><td>{x.name}</td><td>{x.dependents}</td><td>{won(x.gross)}</td><td>{won(x.nontax)}</td><td>{won(x.incomeTax)}</td><td>{won(x.localTax)}</td><td>{won(x.np + x.hi + x.ltc + x.ei)}</td>
            {items.map((k) => { const c = x.checks[k]; return <td key={k}><label><input type="checkbox" checked={!!c?.done} disabled={a.busy === `${x.employeeId}${k}`} onChange={(e) => mark(x.employeeId, k, e.target.checked)} /> {c?.done ? '받음' : ''}</label></td>; })}</tr>)}</tbody></table>
      )}
    </section>
  );
}

/* ── 사무 › 내 인사 ── */
interface Mine { linked: boolean; note: string; employee?: { id: string; name: string; joinedOn: string };
  today?: AttRow | null; month?: { ym: string; workStart: string; rows: AttRow[]; summary: AttSum };
  leave?: { granted: number; used: number; remaining: number };
  requests?: Array<{ id: string; startOn: string; endOn: string; half: string; days: number; note: string | null; state: string; decideNote: string | null }>;
  payslips?: Array<{ id: string; ym: string; payDay: string; gross: number; net: number }> }
export function MyHr() {
  const q = useApi<Mine>('/admin/me/hr', []);
  const a = useAct();
  const [lv, setLv] = useState({ startOn: kstDay(1), endOn: kstDay(1), half: 'FULL', note: '' });
  const d = q.data;
  const post = (key: string, path: string, body: unknown) => void a.run(key, () => api(path, { method: 'POST', body: JSON.stringify(body) }), () => q.reload());
  if (d && !d.linked) return <section data-my-hr="none"><p className="muted">{d.note}</p></section>;
  return (
    <section data-my-hr={d?.employee?.id ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d?.employee && <p><b>{d.employee.name}</b> <small className="dim">입사 {d.employee.joinedOn}</small></p>}
      {d && (
        <div className="card pad" data-my-hr-today={d.today ? (d.today.outHm ? 'out' : 'in') : 'none'}>
          <b>오늘</b> 출근 {d.today?.inHm ?? '—'} · 퇴근 {d.today?.outHm ?? '—'}{' '}
          <button className="btn-sm" disabled={a.busy === 'in' || !!d.today} onClick={() => post('in', '/admin/me/hr/clock', { kind: 'IN' })} data-my-clock-in="">출근</button>{' '}
          <button className="btn-sm" disabled={a.busy === 'out' || !d.today || !!d.today.outHm} onClick={() => post('out', '/admin/me/hr/clock', { kind: 'OUT' })} data-my-clock-out="">퇴근</button>
          <small className="dim"> 기준 {d.month?.workStart}</small>
        </div>
      )}
      {d?.month && (
        <details data-my-hr-month={d.month.rows.length}><summary>{d.month.ym} — 일한 날 {d.month.summary.days} · {d.month.summary.hours}시간 · 늦음 {d.month.summary.late} · 휴가 {d.month.summary.leaveDays}</summary>
          <table className="tbl"><tbody>{d.month.rows.map((r) => <tr key={r.id}><td>{r.workOn}</td><td>{r.inHm}{r.late && <span className="warn-text"> 늦음</span>}</td><td>{r.outHm ?? '—'}</td><td>{hm(r.minutes)}</td><td>{r.confirmed ? '확인' : ''}</td></tr>)}</tbody></table>
        </details>
      )}
      {d?.leave && (
        <div className="card pad" data-my-leave={d.leave.remaining}>
          <b>연차</b> 생김 {d.leave.granted} · 씀 {d.leave.used} · <b>남음 {d.leave.remaining}</b>
          <p><input type="date" value={lv.startOn} onChange={(e) => setLv({ ...lv, startOn: e.target.value, endOn: lv.endOn < e.target.value ? e.target.value : lv.endOn })} aria-label="시작" />
            {lv.half === 'FULL' && <> ~ <input type="date" value={lv.endOn} min={lv.startOn} onChange={(e) => setLv({ ...lv, endOn: e.target.value })} aria-label="끝" /></>}{' '}
            <select value={lv.half} onChange={(e) => setLv({ ...lv, half: e.target.value })}>{Object.entries(HALF_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
            <input value={lv.note} onChange={(e) => setLv({ ...lv, note: e.target.value })} placeholder="사유(선택)" size={16} />{' '}
            <button className="btn-sm" disabled={a.busy === 'lv'} onClick={() => post('lv', '/admin/me/hr/leave', { startOn: lv.startOn, half: lv.half, ...(lv.half === 'FULL' ? { endOn: lv.endOn } : {}), ...(lv.note ? { note: lv.note } : {}) })} data-my-leave-req="">휴가 신청</button></p>
          {!!d.requests?.length && (
            <table className="tbl"><tbody>{d.requests.map((r) => <tr key={r.id}><td>{r.startOn}{r.endOn !== r.startOn ? ` ~ ${r.endOn}` : ''} · {HALF_KO[r.half] ?? r.half}</td><td>{r.days}일</td>
              <td>{ST_KO[r.state] ?? r.state}{r.decideNote ? <small className="dim"> · {r.decideNote}</small> : ''}</td>
              <td>{r.state === 'REQUESTED' && <button className="btn-sm btn-plain" disabled={a.busy === `c${r.id}`} onClick={() => post(`c${r.id}`, `/admin/me/hr/leave/${r.id}/cancel`, {})}>취소</button>}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
      {!!d?.payslips?.length && (
        <div className="card pad" data-my-payslips={d.payslips.length}><b>급여명세서</b>
          <table className="tbl"><tbody>{d.payslips.map((p) => <tr key={p.id}><td>{p.ym}</td><td>지급 {p.payDay}</td><td>실지급 {won(p.net)}</td>
            <td><button className="btn-sm btn-plain" onClick={() => void a.run(`s${p.id}`, async () => { const s = await api<Slip>(`/admin/me/hr/payslips/${p.id}`); printSlip(s); return s; }, undefined, () => '명세서를 새 창에 열었습니다.')}>보기 · 인쇄</button></td></tr>)}</tbody></table>
        </div>
      )}
      {d && <p className="muted"><small>{d.note}</small></p>}
    </section>
  );
}
