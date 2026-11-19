/* ===== v10.449 ~ 452 (D260 · docs/586 ~ 589) 장부 보강 — web/src/app/admin/AcctBooks.tsx 새 파일 =====
 * 대표 11/20 03:30 「다음개발」 ㉗.
 *   AcctDaybook   회계 › 장부 › 분개장       — 기간 전표 줄째 · 합계 차변 = 대변 · CSV(내려받기 승인 ACCT_LEDGER)
 *   AcctCashbook  회계 › 장부 › 현금출납장   — 보통예금 · 현금(시재) · 날짜별 들어옴 · 나감 · 잔액 · 줄 · CSV(ACCT_LEDGER)
 *   AcctFxReval   회계 › 장부 › 외화 환산    — 못 받은 외화 받을 돈 · 기말 환율 · 미리보기 · 넣기(SUPER · 달마다 한 번)
 *   (반대 전표 단추는 회계 › 장부 › 수동 전표 — patches/1_wiring.md)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const isSuper = () => tokenRoles().includes('SUPER');
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};
function useRange() {
  const today = kstDay();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const box = (
    <><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="시작일" /> ~ <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="끝일" /></>
  );
  return { from, to, box };
}

/* ── v10.449 분개장 ── */
interface DayLine { role: string; name: string; code: string | null; debit: number; credit: number }
interface DayEntry { entryId: string; date: string; source: string; memo: string; party: string; evidence: string; late: boolean; lines: DayLine[]; debit: number; credit: number }
interface DayW { from: string; to: string; entries: DayEntry[]; total: { entries: number; lines: number; debit: number; credit: number }; balanced: boolean; truncated: boolean; note: string }
export function AcctDaybook() {
  const r = useRange();
  const q = useApi<DayW>(`/admin/acct/daybook?from=${r.from}&to=${r.to}`);
  const a = useAct();
  const csv = () => void a.run('csv', async () => {
    const t = await exportTicket('ACCT_LEDGER');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const x = await api<{ filename: string; csv: string; note: string }>(`/admin/acct/daybook/export?from=${r.from}&to=${r.to}&ticket=${t}`);
    save(x.filename, x.csv); return x;
  }, undefined, (x) => x.note);
  const d = q.data;
  return (
    <section data-acct-daybook={d?.total.entries ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">{r.box}{' '}<button className="btn-sm" disabled={a.busy === 'csv'} onClick={csv} data-acct-daybook-csv="" data-perm="export">CSV</button></div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-daybook-balanced={d.balanced ? 'ok' : 'diff'} className={d.balanced ? '' : 'warn-text'}>전표 {d.total.entries}장 · {d.total.lines}줄 · 차변 {won(d.total.debit)} · 대변 {won(d.total.credit)}{d.balanced ? '' : ' — 맞지 않음'}</p>
          <table className="tbl"><thead><tr><th>일자</th><th>전표</th><th>적요</th><th>계정</th><th>차변</th><th>대변</th></tr></thead>
            <tbody>{d.entries.map((e) => e.lines.map((l, i) => (
              <tr key={`${e.entryId}-${i}`} data-acct-daybook-entry={i === 0 ? e.entryId : undefined}>
                {i === 0 && <><td rowSpan={e.lines.length}>{e.date}{e.late && <small className="dim"> 늦게</small>}</td><td rowSpan={e.lines.length}>{e.entryId}<br /><small className="dim">{e.source}</small></td>
                  <td rowSpan={e.lines.length}>{e.memo} <small className="dim">{e.party}</small></td></>}
                <td>{l.name}{l.code && <small className="dim"> {l.code}</small>}</td><td>{l.debit ? won(l.debit) : ''}</td><td>{l.credit ? won(l.credit) : ''}</td>
              </tr>)))}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.450 현금출납장 ── */
interface CashRow { date: string; entryId: string; source: string; memo: string; party: string; debit: number; credit: number; balance: number }
interface CashW { role: string; account: { name: string }; roles: Array<{ role: string; name: string }>; from: string; to: string; opening: number;
  days: Array<{ date: string; in: number; out: number; count: number; balance: number }>; rows: CashRow[]; total: { in: number; out: number }; closing: number; warn: string; note: string }
export function AcctCashbook() {
  const r = useRange();
  const [role, setRole] = useState('CASH');
  const [rows, setRows] = useState(false);
  const q = useApi<CashW>(`/admin/acct/cashbook?role=${role}&from=${r.from}&to=${r.to}`);
  const a = useAct();
  const csv = () => void a.run('csv', async () => {
    const t = await exportTicket('ACCT_LEDGER');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const x = await api<{ filename: string; csv: string; note: string }>(`/admin/acct/cashbook/export?role=${role}&from=${r.from}&to=${r.to}&ticket=${t}`);
    save(x.filename, x.csv); return x;
  }, undefined, (x) => x.note);
  const d = q.data;
  return (
    <section data-acct-cashbook={d?.role ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="계정">{(d?.roles ?? [{ role: 'CASH', name: '보통예금' }, { role: 'CASH_HAND', name: '현금(시재)' }]).map((x) => <option key={x.role} value={x.role}>{x.name}</option>)}</select>{' '}
        {r.box}{' '}<button className="btn-sm" disabled={a.busy === 'csv'} onClick={csv} data-acct-cashbook-csv="" data-perm="export">CSV</button>{' '}
        <label><input type="checkbox" checked={rows} onChange={(e) => setRows(e.target.checked)} /> 줄째 보기</label>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          {d.warn && <p className="warn-text">{d.warn}</p>}
          <p data-acct-cashbook-closing={d.closing}>기초 {won(d.opening)} · 들어옴 {won(d.total.in)} · 나감 {won(d.total.out)} · 기말 <b>{won(d.closing)}</b></p>
          {!rows && (
            <table className="tbl" data-acct-cashbook-days={d.days.length}><thead><tr><th>일자</th><th>건수</th><th>들어옴</th><th>나감</th><th>잔액</th></tr></thead>
              <tbody><tr><td>{d.from}</td><td /><td /><td>기초</td><td>{won(d.opening)}</td></tr>
                {d.days.map((x) => <tr key={x.date}><td>{x.date}</td><td>{x.count}</td><td>{won(x.in)}</td><td>{won(x.out)}</td><td>{won(x.balance)}</td></tr>)}</tbody></table>
          )}
          {rows && (
            <table className="tbl"><thead><tr><th>일자</th><th>전표</th><th>적요</th><th>거래처</th><th>들어옴</th><th>나감</th><th>잔액</th></tr></thead>
              <tbody>{d.rows.map((x, i) => <tr key={i}><td>{x.date}</td><td>{x.entryId}</td><td>{x.memo}</td><td>{x.party}</td><td>{x.debit ? won(x.debit) : ''}</td><td>{x.credit ? won(x.credit) : ''}</td><td>{won(x.balance)}</td></tr>)}</tbody></table>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.452 외화 환산 평가 ── */
interface FxItem { exportId: string; title: string; party: string | null; currency: string; foreign: number; bookKrw: number; shippedOn: string; rate?: number | null; evalKrw?: number | null; diff?: number | null }
interface FxRun { id: string; ym: string; asOf: string; rates: Record<string, number>; items: FxItem[]; gain: number; loss: number; entryId: string | null; reverseEntryId: string | null; note: string | null; createdBy: string | null; createdAt: string }
interface FxW { ym: string; asOf: string; run: FxRun | null; open: FxItem[]; currencies: string[]; history: Array<{ ym: string; asOf: string; gain: number; loss: number; entryId: string | null; createdAt: string }>; note: string }
interface FxPre { ym: string; asOf: string; items: FxItem[]; gain: number; loss: number; net: number; missing: string[]; warn: string }
export function AcctFxReval() {
  const [ym, setYm] = useState(kstDay().slice(0, 7));
  const q = useApi<FxW>(`/admin/acct/fx-reval?ym=${ym}`);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [pre, setPre] = useState<FxPre | null>(null);
  const a = useAct();
  const rateStr = () => Object.entries(rates).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}:${Number(v)}`).join(',');
  const preview = () => void a.run('pre', async () => {
    const x = await api<FxPre>(`/admin/acct/fx-reval/preview?ym=${ym}&rates=${encodeURIComponent(rateStr())}`);
    setPre(x); return x;
  }, undefined, (x) => x.warn || '미리보기를 만들었습니다(저장 안 함).');
  const post = () => {
    if (!pre || pre.missing.length) return;
    if (!confirm(`${ym} 환산 평가를 넣습니까? 이익 ${won(pre.gain)} · 손실 ${won(pre.loss)} — 달마다 한 번이고 되돌릴 수 없습니다(다음 달 첫날 되돌림 전표는 함께 들어갑니다).`)) return;
    const body = { ym, rates: Object.fromEntries(Object.entries(rates).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])) };
    void a.run('post', () => api<{ note: string }>('/admin/acct/fx-reval', { method: 'POST', body: JSON.stringify(body) }), () => { setPre(null); q.reload(); }, (x) => x.note);
  };
  const d = q.data;
  return (
    <section data-acct-fxreval={d?.run ? 'done' : (d?.open.length ?? '')}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts"><input type="month" value={ym} onChange={(e) => { if (e.target.value) { setYm(e.target.value); setPre(null); } }} aria-label="달" /> {d && <small className="dim">평가일 {d.asOf}</small>}</div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d?.run && (
        <div className="card pad" data-acct-fxreval-run={d.run.ym}>
          <b>{d.run.ym} 평가함</b> — 이익 {won(d.run.gain)} · 손실 {won(d.run.loss)} · 환율 {Object.entries(d.run.rates).map(([k, v]) => `${k} ${v}`).join(' · ')}
          {d.run.entryId ? <> · 평가 전표 {d.run.entryId} · 되돌림 {d.run.reverseEntryId}</> : ' · 차이 없음(기록만)'}<br />
          <small className="dim">{d.run.createdBy ?? ''} {ymdhm(d.run.createdAt)} {d.run.note ?? ''}</small>
        </div>
      )}
      {d && !d.run && (
        <>
          <p>말일까지 못 받은 외화 받을 돈 <b>{d.open.length}</b>건</p>
          {d.open.length > 0 && (
            <>
              <p>{d.currencies.map((c) => (
                <label key={c}>{c} 기말 환율 <input type="number" min={0} step="0.0001" value={rates[c] ?? ''} onChange={(e) => setRates({ ...rates, [c]: e.target.value })} size={8} data-acct-fxreval-rate={c} /> </label>))}
                <button className="btn-sm btn-plain" disabled={a.busy === 'pre'} onClick={preview} data-acct-fxreval-preview="">미리보기</button>{' '}
                {isSuper() && <button className="btn-sm" disabled={!pre || pre.missing.length > 0 || a.busy === 'post'} onClick={post} data-acct-fxreval-post="" data-perm="approve">평가 넣기</button>}</p>
              <table className="tbl"><thead><tr><th>수출</th><th>거래처</th><th>선적</th><th>외화</th><th>선적 원화</th><th>기말 원화</th><th>차이</th></tr></thead>
                <tbody>{(pre?.items ?? d.open).map((x) => (
                  <tr key={x.exportId}><td>{x.exportId} {x.title}</td><td>{x.party ?? ''}</td><td>{x.shippedOn}</td><td>{x.currency} {x.foreign.toLocaleString('ko-KR')}</td><td>{won(x.bookKrw)}</td>
                    <td>{x.evalKrw == null ? '—' : won(x.evalKrw)}</td><td className={x.diff != null && x.diff < 0 ? 'warn-text' : ''}>{x.diff == null ? '—' : won(x.diff)}</td></tr>))}</tbody></table>
              {pre && <p data-acct-fxreval-net={pre.net}>이익 {won(pre.gain)} · 손실 {won(pre.loss)} · 순 {won(pre.net)}{pre.warn && <span className="warn-text"> · {pre.warn}</span>}</p>}
            </>
          )}
          {isSuper() && d.open.length === 0 && <p className="muted">평가할 외화 받을 돈이 없습니다 — 「평가 넣기」 없이 그대로 두면 됩니다.</p>}
        </>
      )}
      {d && <p className="muted">{d.note}</p>}
      {d && d.history.length > 0 && (
        <details><summary>지난 평가 {d.history.length}</summary>
          <table className="tbl"><thead><tr><th>달</th><th>이익</th><th>손실</th><th>전표</th><th>넣은 때</th></tr></thead>
            <tbody>{d.history.map((h) => <tr key={h.ym}><td>{h.ym}</td><td>{won(h.gain)}</td><td>{won(h.loss)}</td><td>{h.entryId ?? '—'}</td><td>{ymdhm(h.createdAt)}</td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}
