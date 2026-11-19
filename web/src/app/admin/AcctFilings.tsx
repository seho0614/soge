import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';

/* ---------------------------------------------------------------------
 * ⑲ v10.420 ~ 422 (D252 · docs/557 ~ 559) 운영 화면 회계 › 세무 · 인사 — 신고 자료
 *   AcctWhtReturn       원천세 신고서 — 달 고르기 · A01 · A20 · A25 · A99 · 납부 기한 · CSV(내려받기 승인)
 *   AcctWageStatements  지급명세서 — 해 · 반기 · 달 · 직원별 · CSV · 원천징수영수증 한 장(인쇄)
 *   AcctInsurance       4대보험 신고 — 취득 · 상실 · 보수월액 · 기한 · 처리함(SUPER)
 * ------------------------------------------------------------------- */

const won = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString('ko-KR')}`);
const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7); };
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};
const NEED = '내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.';

interface WhtRow { code: string; label: string; people: number; count: number; paid: number; incomeTax: number; localTax: number }
interface WhtR { ym: string; rows: WhtRow[]; total: WhtRow; due: string; daysLeft: number; note: string }

export function AcctWhtReturn() {
  const [ym, setYm] = useState(prevYm(kstYm()));
  const q = useApi<WhtR>(`/admin/acct/tax/wht-return?ym=${ym}`, [ym]);
  const a = useAct();
  const dl = () => void a.run('dl', async () => {
    const t = await exportTicket('ACCT_TAX');
    if (!t) throw new Error(NEED);
    const r = await api<{ filename: string; csv: string; note: string }>(`/admin/acct/tax/wht-return/export?ym=${ym}&ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r?.note ?? '');
  const d = q.data;
  return (
    <section data-acct-whtreturn={d?.rows.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>지급한 달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm btn-plain" disabled={a.busy === 'dl'} onClick={dl} data-acct-whtreturn-dl="">CSV(내려받기 승인)</button></p>
      {q.error ? <p className="warn-text">{String(q.error)}</p> : null}
      {d && (
        <>
          <p data-acct-whtreturn-due=""><b>납부 기한 {d.due}</b> {d.daysLeft >= 0 ? `· ${d.daysLeft}일 남음` : <span className="warn-text">· 지남</span>}</p>
          <table className="tbl"><thead><tr><th>코드</th><th>소득 구분</th><th className="num">인원</th><th className="num">건수</th><th className="num">총지급액</th><th className="num">소득세</th><th className="num">지방소득세</th></tr></thead>
            <tbody>{[...d.rows, d.total].map((r) => (
              <tr key={r.code} className={r.code === 'A99' ? 'strong' : ''} data-acct-whtreturn-row={r.code}><td>{r.code}</td><td>{r.label}</td><td className="num">{r.people}</td><td className="num">{r.count}</td>
                <td className="num">{won(r.paid)}</td><td className="num">{won(r.incomeTax)}</td><td className="num">{won(r.localTax)}</td></tr>))}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

interface WageRow { employeeId: string; name: string; joinedOn: string; leftOn: string | null; months: number; gross: number; nontax: number; taxable: number;
  incomeTax: number; localTax: number; np: number; hi: number; ltc: number; ei: number; net: number }
interface WageR { period: string; label: string; items: WageRow[]; total: { people: number; gross: number; nontax: number; taxable: number; incomeTax: number; localTax: number; ins: number; net: number }; note: string }
interface Receipt { year: string; company: string; employee: WageRow; note: string }

export function AcctWageStatements() {
  const y = kstYm().slice(0, 4);
  const [period, setPeriod] = useState(y);
  const q = useApi<WageR>(`/admin/acct/payroll/statements?period=${period}`, [period]);
  const a = useAct();
  const [rc, setRc] = useState<Receipt | null>(null);
  const dl = () => void a.run('dl', async () => {
    const t = await exportTicket('ACCT_TAX');
    if (!t) throw new Error(NEED);
    const r = await api<{ filename: string; csv: string; note: string }>(`/admin/acct/payroll/statements/export?period=${period}&ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r?.note ?? '');
  const receipt = (id: string) => void a.run(`r${id}`, async () => { const r = await api<Receipt>(`/admin/acct/payroll/statements/${id}/receipt?year=${period.slice(0, 4)}`); setRc(r); return r; }, undefined, () => '영수증을 열었습니다 — 브라우저 인쇄(Ctrl + P)로 뽑으십시오.');
  const d = q.data;
  const opts = [y, `${y}-H1`, `${y}-H2`, String(Number(y) - 1), `${Number(y) - 1}-H2`];
  return (
    <section data-acct-wagestmt={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>기간 <select value={period} onChange={(e) => setPeriod(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o.includes('H') ? `${o.slice(0, 4)}년 ${o.endsWith('1') ? '상반기' : '하반기'}(간이지급명세서)` : `${o}년(지급명세서)`}</option>)}</select></label>{' '}
        <button className="btn-sm btn-plain" disabled={a.busy === 'dl'} onClick={dl} data-acct-wagestmt-dl="">CSV(내려받기 승인)</button></p>
      {q.error ? <p className="warn-text">{String(q.error)}</p> : null}
      {d && (
        <>
          <table className="tbl"><thead><tr><th>직원</th><th className="num">달</th><th className="num">총급여</th><th className="num">비과세</th><th className="num">과세 급여</th><th className="num">소득세</th><th className="num">지방소득세</th><th className="num">4대보험(본인)</th><th className="num">실지급</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.employeeId} data-acct-wagestmt-row={x.employeeId}><td>{x.name} <small className="dim">{x.joinedOn}{x.leftOn ? ` ~ ${x.leftOn}` : ''}</small></td><td className="num">{x.months}</td>
                <td className="num">{won(x.gross)}</td><td className="num">{won(x.nontax)}</td><td className="num">{won(x.taxable)}</td><td className="num">{won(x.incomeTax)}</td><td className="num">{won(x.localTax)}</td>
                <td className="num">{won(x.np + x.hi + x.ltc + x.ei)}</td><td className="num">{won(x.net)}</td>
                <td>{!period.includes('-') && <button className="btn-sm btn-plain" onClick={() => receipt(x.employeeId)} data-acct-wagestmt-receipt={x.employeeId}>영수증</button>}</td></tr>))}
              <tr className="strong"><td>합계 {d.total.people}명</td><td /><td className="num">{won(d.total.gross)}</td><td className="num">{won(d.total.nontax)}</td><td className="num">{won(d.total.taxable)}</td>
                <td className="num">{won(d.total.incomeTax)}</td><td className="num">{won(d.total.localTax)}</td><td className="num">{won(d.total.ins)}</td><td className="num">{won(d.total.net)}</td><td /></tr></tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
      {rc && (
        <div className="card pad print-block" data-acct-wage-receipt={rc.employee.employeeId}>
          <b>근로소득 원천징수영수증 · {rc.year}년</b> <button className="btn-sm btn-plain" onClick={() => setRc(null)}>닫기</button>
          <table className="tbl"><tbody>
            <tr><th>원천징수의무자</th><td>{rc.company}</td></tr>
            <tr><th>소득자</th><td>{rc.employee.name} <small className="dim">(주민등록번호 — 신고 때 채움)</small></td></tr>
            <tr><th>근무 기간</th><td>{rc.employee.joinedOn} ~ {rc.employee.leftOn ?? `${rc.year}-12-31`}</td></tr>
            <tr><th>총급여 · 비과세</th><td>{won(rc.employee.gross)} · {won(rc.employee.nontax)}</td></tr>
            <tr><th>기납부 소득세 · 지방소득세</th><td>{won(rc.employee.incomeTax)} · {won(rc.employee.localTax)}</td></tr>
            <tr><th>국민연금 · 건강 · 장기요양 · 고용</th><td>{won(rc.employee.np)} · {won(rc.employee.hi)} · {won(rc.employee.ltc)} · {won(rc.employee.ei)}</td></tr>
          </tbody></table>
          <p className="muted">{rc.note}</p>
        </div>
      )}
    </section>
  );
}

interface InsRow { employeeId: string; name: string; kind: 'ACQ' | 'LOSS'; eventOn: string; monthlyWage: number; reason: string; due: string; daysLeft: number; done: boolean; doneAt: string | null; doneBy: string | null; note: string | null }
interface InsR { items: InsRow[]; pending: number; overdue: number; note: string }

export function AcctInsurance() {
  const q = useApi<InsR>('/admin/acct/payroll/insurance');
  const a = useAct();
  const sup = tokenRoles().includes('SUPER');
  const done = (r: InsRow) => {
    const note = prompt(`${r.name} ${r.kind === 'ACQ' ? '취득' : '상실'} 신고를 처리함으로 표시합니다(지우지 않음). 메모(접수번호 등 · 비워도 됨)`);
    if (note !== null) void a.run(`d${r.employeeId}${r.kind}`, () => api('/admin/acct/payroll/insurance/done', { method: 'POST', body: JSON.stringify({ employeeId: r.employeeId, kind: r.kind, note }) }), q.reload);
  };
  const d = q.data;
  return (
    <section data-acct-insurance={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p>처리 안 함 <b>{d.pending}</b>{d.overdue ? <span className="warn-text"> · 기한 지남 {d.overdue}</span> : null}</p>
          <table className="tbl"><thead><tr><th>직원</th><th>신고</th><th>취득 · 상실일</th><th className="num">보수월액</th><th>기한</th><th>상태</th><th /></tr></thead>
            <tbody>{d.items.map((r) => (
              <tr key={`${r.employeeId}${r.kind}`} data-acct-insurance-row={r.done ? 'done' : 'todo'}><td>{r.name}</td><td>{r.kind === 'ACQ' ? '취득' : '상실'} <small className="dim">{r.reason}</small></td><td>{r.eventOn}</td>
                <td className="num">{won(r.monthlyWage)}</td><td>{r.due}{!r.done && (r.daysLeft < 0 ? <span className="warn-text"> 지남</span> : <small className="dim"> {r.daysLeft}일</small>)}</td>
                <td>{r.done ? <>처리함 <small className="dim">{r.doneAt ? ymdhm(r.doneAt) : ''} {r.doneBy ?? ''} {r.note ?? ''}</small></> : <span className="warn-text">처리 안 함</span>}</td>
                <td>{sup && !r.done && <button className="btn-sm btn-plain" disabled={a.busy === `d${r.employeeId}${r.kind}`} onClick={() => done(r)} data-acct-insurance-done={`${r.employeeId}-${r.kind}`}>처리함</button>}</td></tr>))}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
