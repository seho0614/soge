import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';

/* ---------------------------------------------------------------------
 * v10.381 ~ 384 (D242 · docs/517 ~ 520) 운영 화면 「회계」
 *   AcctJournal   전표 — 달 고르기 · 계정별 합 · 전표 목록 · 지금 만들기 · 월 마감 · CSV(내려받기 승인)
 *   AcctTax       신고 자료 — 부가세(분기) · 원천세(월) · 세금계산서 발행 대상 · CSV(내려받기 승인)
 *   AcctReport    경영 보고서 — 달마다 매출 · 비용 · 이익 · 현금
 *   AcctAccounts  계정 · 규칙 — 회계 프로그램 코드(SUPER) · 전표 규칙(초안) · 직판 상품 과세 · 면세 · v10.389 전표 CSV 양식
 *   ⑪ v10.388 ~ 391 (D244 · docs/525 ~ 528)
 *   AcctBank      은행 맞추기 — 통장 CSV 올리기 · 후보 전표 · 맞춤 · 맞출 것 없음 · 자동 맞춤 · 장부에만 있음
 *   AcctMonth     월 결산 — 그 달 숫자 · 마감 전 할 일 · 신고 기한
 *   AcctTax       + 광고 청구 · 입점 수수료 「발행 요청」 → 「발행」(전자세금계산서 · 간주)
 * ------------------------------------------------------------------- */

const won = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString('ko-KR')}`);
const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y!, m! - 2, 1)); return d.toISOString().slice(0, 7); };
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};
const isSuper = () => tokenRoles().includes('SUPER');

interface Line { role: string; debit: number; credit: number }
interface Entry { id: string; date: string; source: string; sourceKey: string; memo: string | null; party: string | null; evidence: string; late: boolean; lines: Line[] }
interface Journal { ym: string; entries: Entry[]; byRole: Array<{ role: string; name: string; extCode: string | null; debit: string; credit: string }>; bySource: Array<{ source: string; n: number }>;
  total: { entries: number; late: number; debit: number; credit: number }; closing: { ym: string; entries: number; debitSum: string; note: string | null; closedAt: string } | null }

export function AcctJournal() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<Journal>(`/admin/acct/journal?ym=${ym}`);
  const fm = useApi<Formats>('/admin/acct/formats');
  const [fmt, setFmt] = useState('');
  const a = useAct();
  const d = q.data;
  const nm: Record<string, string> = Object.fromEntries((d?.byRole ?? []).map((r) => [r.role, r.name]));
  const run = () => void a.run('run', () => api<{ total: number; failedCount: number }>('/admin/acct/journal/run', { method: 'POST' }), q.reload, (r) => `전표 ${r.total}장을 만들었습니다${r.failedCount ? ` · 실패 ${r.failedCount}건(운영 알림)` : ''}.`);
  const close = () => {
    const note = prompt(`${ym} 을 마감합니다. 마감한 달에는 전표가 더 들어가지 않습니다(늦게 온 돈 흐름은 오늘 날짜). 메모(선택)`);
    if (note === null) return;
    void a.run('close', () => api<{ note: string }>('/admin/acct/closings', { method: 'POST', body: JSON.stringify({ ym, note }) }), q.reload, (r) => r.note);
  };
  const csv = () => void a.run('csv', async () => {
    const t = await exportTicket('ACCT_JOURNAL');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ filename: string; csv: string; note: string }>(`/admin/acct/journal/export?ym=${ym}&ticket=${t}${fmt ? `&format=${fmt}` : ''}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r.note);
  return (
    <section data-acct-journal={d?.total.entries ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} data-acct-ym="" /></label>{' '}
        <button className="btn-sm btn-plain" onClick={() => setYm(prevYm(ym))}>지난달</button>{' '}
        {isSuper() && <button className="btn-sm" disabled={a.busy === 'run'} onClick={run} data-acct-run="">지금 전표 만들기</button>}{' '}
        {(fm.data?.items.length ?? 0) > 1 && <select value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="양식" data-acct-format=""><option value="">기본 양식</option>{fm.data!.items.map((f) => <option key={f.id} value={f.id}>{f.name}{f.isDefault ? '(기본)' : ''}</option>)}</select>}{' '}
        <button className="btn-sm" disabled={a.busy === 'csv' || !d?.total.entries} onClick={csv} data-acct-csv="">전표 CSV</button>{' '}
        {isSuper() && !d?.closing && ym < kstYm() && <button className="btn-sm btn-plain" disabled={a.busy === 'close'} onClick={close} data-acct-close="">{ym} 마감</button>}
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-total="">
            전표 <b>{d.total.entries}</b>장 · 차변 {won(d.total.debit)} · 대변 {won(d.total.credit)}{d.total.debit !== d.total.credit && <b className="warn-text"> · 차변 ≠ 대변</b>}
            {d.total.late > 0 && <> · 마감 뒤 들어온 전표 {d.total.late}장</>}
            {' · '}{d.closing ? <span className="badge" data-acct-closed="">마감 {ymdhm(d.closing.closedAt)}</span> : <span className="dim">마감 전</span>}
          </p>
          <p className="muted">전표는 정기 작업이 매시간 만듭니다(같은 돈 흐름은 한 번). 규칙 · 계정 코드는 초안입니다 — 회계 › 「계정 · 규칙」. 시험 결제(간주)는 `acct.include_stub` 이 off 면 빠집니다.</p>
          {d.byRole.length > 0 && (
            <table className="tbl" data-acct-byrole={d.byRole.length}><thead><tr><th>계정</th><th>회계 코드</th><th>차변</th><th>대변</th></tr></thead>
              <tbody>{d.byRole.map((r) => <tr key={r.role}><td>{r.name}</td><td>{r.extCode ?? '—'}</td><td>{won(Number(r.debit))}</td><td>{won(Number(r.credit))}</td></tr>)}</tbody></table>
          )}
          {d.entries.length === 0 ? <p className="muted">이 달 전표가 없습니다.</p> : (
            <table className="tbl" data-acct-entries={d.entries.length}><thead><tr><th>일자</th><th>번호</th><th>적요</th><th>거래처</th><th>줄(차변 / 대변)</th></tr></thead>
              <tbody>{d.entries.map((e) => (
                <tr key={e.id} data-acct-entry={e.source}>
                  <td>{e.date}{e.late && <small className="dim"> 늦게</small>}</td><td>{e.id}</td><td>{e.memo}</td><td>{e.party ?? ''}</td>
                  <td><small>{e.lines.map((l, i) => <span key={i}>{l.debit ? `차 ${nm[l.role] ?? l.role} ${won(l.debit)}` : `대 ${nm[l.role] ?? l.role} ${won(l.credit)}`}{i < e.lines.length - 1 ? ' · ' : ''}</span>)}</small></td>
                </tr>))}</tbody></table>
          )}
        </>
      )}
    </section>
  );
}

interface Vat { ok: boolean; q: string; rows: Array<{ evidenceKo: string; label: string; supply: number; vat: number; exempt: number; entries: number }>; byEvidence: Array<{ evidenceKo: string; supply: number; vat: number; exempt: number }>; total: { supply: number; vat: number; exempt: number }; note: string }
interface Wht { ym: string; month: { people: number; count: number; gross: number; incomeTax: number; localTax: number; net: number }; ytd: { count: number; gross: number; incomeTax: number; localTax: number }; note: string }
interface Inv { ym: string; items: Array<{ kind: string; kindKo: string; id: string; party: string | null; total: number; issued: boolean; assumed: boolean; no: string | null;
  reqId: string | null; reqState: string | null; etaxStatus: string | null; hasBizNo: boolean; canRequest: boolean }>; todo: number; assumed: number; where: Record<string, string>; note: string }

export function AcctTax() {
  const k = new Date(Date.now() + 9 * 3600e3);
  const [qv, setQv] = useState(`${k.getUTCFullYear()}-${Math.floor(k.getUTCMonth() / 3) + 1}`);
  const [ym, setYm] = useState(kstYm());
  const v = useApi<Vat>(`/admin/acct/tax/vat?q=${qv}`);
  const w = useApi<Wht>(`/admin/acct/tax/withholding?ym=${ym}`);
  const iv = useApi<Inv>(`/admin/acct/tax/invoices?ym=${ym}`);
  const a = useAct();
  const dl = (kind: 'VAT' | 'WHT_YEAR', period: string) => void a.run(`dl${kind}`, async () => {
    const t = await exportTicket('ACCT_TAX');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ filename: string; csv: string; note: string }>(`/admin/acct/tax/export?kind=${kind}&period=${period}&ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r.note);
  /* v10.391 — 광고 청구 · 입점 수수료: 발행 요청 → 발행(전자세금계산서 · 지금은 간주) · 보내기 전 요청 취소 */
  const slug = (k: string) => (k === 'AD' ? 'ad' : 'commission');
  const request = (kind: string, id: string) => void a.run(`rq${id}`, () => api<{ note: string }>('/admin/acct/tax/invoices/request', { method: 'POST', body: JSON.stringify({ kind, sourceId: id }) }), iv.reload, (r) => r.note);
  const send = (kind: string, reqId: string) => {
    if (!confirm('세금계산서를 발행합니다(간주 모드면 국세청에 보내지 않고 「간주 발행」으로 기록).')) return;
    void a.run(`sd${reqId}`, () => api<{ note: string }>(`/admin/etax/${slug(kind)}/${reqId}/send`, { method: 'POST' }), iv.reload, (r) => r.note);
  };
  const cancelReq = (reqId: string) => {
    const reason = prompt('발행 요청을 취소합니다. 사유를 적으십시오.');
    if (reason) void a.run(`cx${reqId}`, () => api<{ note: string }>(`/admin/acct/tax/invoices/${reqId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), iv.reload, (r) => r.note);
  };
  const canSend = tokenRoles().some((r) => r === 'SUPER' || r === 'ADMIN');
  return (
    <section data-acct-tax="">
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-acct-vat={v.data?.rows.length ?? ''}>
        <b>부가세</b>{' '}
        <select value={qv} onChange={(e) => setQv(e.target.value)} aria-label="분기">
          {[0, 1, 2, 3, 4].map((i) => { const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - i * 3, 1)); const s = `${d.getUTCFullYear()}-${Math.floor(d.getUTCMonth() / 3) + 1}`; return <option key={s} value={s}>{s.replace('-', '년 ')}분기</option>; })}
        </select>{' '}
        <button className="btn-sm" disabled={a.busy === 'dlVAT'} onClick={() => dl('VAT', qv)} data-acct-vat-csv="">CSV</button>
        {v.data && (
          <>
            <p>과세 공급가 <b>{won(v.data.total.supply)}</b> · 세액 <b>{won(v.data.total.vat)}</b> · 면세 매출 {won(v.data.total.exempt)}</p>
            {v.data.byEvidence.length > 0 && (
              <table className="tbl"><thead><tr><th>증빙</th><th>과세 공급가</th><th>세액</th><th>면세</th></tr></thead>
                <tbody>{v.data.byEvidence.map((r) => <tr key={r.evidenceKo}><td>{r.evidenceKo}</td><td>{won(r.supply)}</td><td>{won(r.vat)}</td><td>{won(r.exempt)}</td></tr>)}</tbody></table>
            )}
            <p className="muted">{v.data.note}</p>
          </>
        )}
      </div>
      <div className="card pad" data-acct-wht={w.data?.month.count ?? ''}>
        <b>원천세 · 세금계산서</b> <label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm" disabled={a.busy === 'dlWHT_YEAR'} onClick={() => dl('WHT_YEAR', ym.slice(0, 4))} data-acct-wht-csv="">{ym.slice(0, 4)}년 사람별 합 CSV</button>
        {w.data && <p>포인트 출금(사업소득) {w.data.month.people}명 · {w.data.month.count}건 · 지급 {won(w.data.month.gross)} · 소득세 {won(w.data.month.incomeTax)} · 지방소득세 {won(w.data.month.localTax)} · 실지급 {won(w.data.month.net)} <small className="dim">(올해 누계 {won(w.data.ytd.gross)})</small></p>}
        {w.data && <p className="muted">{w.data.note}</p>}
        {iv.data && (
          <div data-acct-invoices={iv.data.items.length}>
            <p>세금계산서 발행 대상 {iv.data.items.length}건 · <b className={iv.data.todo ? 'warn-text' : ''}>아직 {iv.data.todo}</b> · 간주 {iv.data.assumed}</p>
            {iv.data.items.length > 0 && (
              <table className="tbl"><thead><tr><th>종류</th><th>거래처</th><th>합계</th><th>상태</th><th>번호</th><th>발행하는 곳</th><th /></tr></thead>
                <tbody>{iv.data.items.map((x) => (
                  <tr key={x.kind + x.id} data-acct-invoice={x.issued ? 'issued' : 'todo'}>
                    <td>{x.kindKo}</td><td>{x.party ?? ''}</td><td>{won(x.total)}</td><td>{x.issued ? (x.assumed ? '간주 발행' : '발행') : <b className="warn-text">아직</b>}</td><td>{x.no ?? '—'}</td><td className="dim">{iv.data!.where[x.kind]}</td>
                    <td>
                      {x.canRequest && <button className="btn-sm" disabled={a.busy === `rq${x.id}`} onClick={() => request(x.kind, x.id)} data-acct-taxinv-request={x.kind}>발행 요청</button>}
                      {x.reqId && x.reqState === 'REQUESTED' && !x.etaxStatus && <>
                        {canSend && <button className="btn-sm" disabled={a.busy === `sd${x.reqId}` || !x.hasBizNo} title={x.hasBizNo ? '' : '사업자등록번호 없음 — 카드 · 현금영수증'} onClick={() => send(x.kind, x.reqId!)} data-acct-taxinv-send={x.kind}>발행</button>}{' '}
                        <button className="btn-sm btn-plain" disabled={a.busy === `cx${x.reqId}`} onClick={() => cancelReq(x.reqId!)} data-acct-taxinv-cancel="">요청 취소</button>
                      </>}
                    </td>
                  </tr>))}</tbody></table>
            )}
            <p className="muted">{iv.data.note}</p>
          </div>
        )}
      </div>
    </section>
  );
}

interface Report { months: Array<{ ym: string; revenue: number; byRevenue: Record<string, number>; expense: number; profit: number; vat: number; cashIn: number; cashOut: number }>; revenueNames: Record<string, string>; latest: { revenue: number; profit: number } | null; change: { revenue: number | null; profit: number | null }; note: string }

export function AcctReport() {
  const q = useApi<Report>('/admin/acct/report?months=12');
  if (q.error) return <p className="warn-text">{String(q.error)}</p>;
  if (!q.data) return null;
  const d = q.data;
  const roles = Object.keys(d.revenueNames);
  const pct = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
  return (
    <section data-acct-report={d.months.length}>
      <p data-acct-latest="">이번 달 매출 <b>{won(d.latest?.revenue)}</b>(지난달 대비 {pct(d.change.revenue)}) · 이익 <b>{won(d.latest?.profit)}</b>(지난달 대비 {pct(d.change.profit)})</p>
      {d.months.length === 0 ? <p className="muted">아직 전표가 없습니다 — 회계 › 전표에서 「지금 전표 만들기」.</p> : (
        <table className="tbl"><thead><tr><th>달</th><th>매출(공급가)</th>{roles.map((r) => <th key={r}>{d.revenueNames[r]}</th>)}<th>비용</th><th>이익</th><th>부가세</th><th>들어옴</th><th>나감</th></tr></thead>
          <tbody>{d.months.map((m) => (
            <tr key={m.ym} data-acct-month={m.ym}><td>{m.ym}</td><td><b>{won(m.revenue)}</b></td>{roles.map((r) => <td key={r}>{won(m.byRevenue[r] ?? 0)}</td>)}<td>{won(m.expense)}</td><td>{won(m.profit)}</td><td>{won(m.vat)}</td><td>{won(m.cashIn)}</td><td>{won(m.cashOut)}</td></tr>
          ))}</tbody></table>
      )}
      <p className="muted">{d.note}</p>
    </section>
  );
}

interface Acc { role: string; name: string; kind: string; extCode: string | null; extName: string | null; note: string | null }
interface Rules { accounts: Acc[]; rules: Array<{ source: string; label: string; evidence: string; lines: Line[] }>; settings: Array<{ key: string; value: string }>; canEdit: boolean; note: string }
interface Prod { items: Array<{ code: string; name: string; status: string; taxType: 'TAXABLE' | 'EXEMPT' }>; exempt: number }

export function AcctAccounts() {
  const q = useApi<Rules>('/admin/acct/accounts');
  const p = useApi<Prod>('/admin/acct/products');
  const a = useAct();
  const [ed, setEd] = useState<{ role: string; extCode: string; extName: string; reason: string } | null>(null);
  const names: Record<string, string> = Object.fromEntries((q.data?.accounts ?? []).map((x) => [x.role, x.name]));
  const saveAcc = () => ed && void a.run('acc', () => api(`/admin/acct/accounts/${ed.role}`, { method: 'PATCH', body: JSON.stringify({ extCode: ed.extCode, extName: ed.extName, reason: ed.reason }) }), () => { setEd(null); q.reload(); });
  const tax = (code: string, to: 'TAXABLE' | 'EXEMPT') => {
    const reason = prompt(`${code} 을 ${to === 'EXEMPT' ? '면세' : '과세'}로 바꿉니다(다음 주문부터). 사유를 적으십시오.`);
    if (reason) void a.run(`t${code}`, () => api(`/admin/acct/products/${encodeURIComponent(code)}/tax-type`, { method: 'PATCH', body: JSON.stringify({ taxType: to, reason }) }), p.reload);
  };
  return (
    <section data-acct-accounts={q.data?.accounts.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {q.data && (
        <>
          <p className="warn-text" data-acct-draft="">{q.data.note}</p>
          <table className="tbl"><thead><tr><th>계정</th><th>종류</th><th>회계 프로그램 코드 · 이름</th><th>쓰는 곳</th><th /></tr></thead>
            <tbody>{q.data.accounts.map((x) => (
              <tr key={x.role} data-acct-account={x.role}>
                <td>{x.name} <small className="dim">{x.role}</small></td><td>{({ ASSET: '자산', LIABILITY: '부채', REVENUE: '수익', EXPENSE: '비용' } as Record<string, string>)[x.kind]}</td>
                <td>{ed?.role === x.role ? (
                  <span><input value={ed.extCode} onChange={(e) => setEd({ ...ed, extCode: e.target.value })} size={8} aria-label="코드" /> <input value={ed.extName} onChange={(e) => setEd({ ...ed, extName: e.target.value })} size={12} aria-label="이름" /> <input value={ed.reason} onChange={(e) => setEd({ ...ed, reason: e.target.value })} placeholder="사유(꼭)" size={14} /> <button className="btn-sm" disabled={a.busy === 'acc' || ed.reason.trim().length < 2} onClick={saveAcc}>저장</button> <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button></span>
                ) : <>{x.extCode ?? '—'} {x.extName ?? ''}</>}</td>
                <td className="dim"><small>{x.note}</small></td>
                <td>{q.data!.canEdit && ed?.role !== x.role && <button className="btn-sm btn-plain" onClick={() => setEd({ role: x.role, extCode: x.extCode ?? '', extName: x.extName ?? '', reason: '' })} data-acct-account-edit={x.role}>고치기</button>}</td>
              </tr>))}</tbody></table>
          <h3>전표 규칙(11,000원 예 · 초안)</h3>
          <table className="tbl" data-acct-rules={q.data.rules.length}><thead><tr><th>돈 흐름</th><th>증빙</th><th>차변</th><th>대변</th></tr></thead>
            <tbody>{q.data.rules.map((r) => (
              <tr key={r.source}><td>{r.label}</td><td>{({ TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '—' } as Record<string, string>)[r.evidence]}</td>
                <td>{r.lines.filter((l) => l.debit).map((l) => `${names[l.role] ?? l.role} ${won(l.debit)}`).join(' · ')}</td>
                <td>{r.lines.filter((l) => l.credit).map((l) => `${names[l.role] ?? l.role} ${won(l.credit)}`).join(' · ')}</td></tr>))}</tbody></table>
          <p className="muted">설정: {q.data.settings.map((s) => `${s.key} = ${s.value}`).join(' · ')} — 정책 › 전체 설정에서 고침(SUPER).</p>
        </>
      )}
      <AcctFormats />
      {p.data && (
        <div className="card pad" data-acct-products={p.data.items.length}>
          <b>직판 상품 과세 · 면세</b> <small className="dim">면세 {p.data.exempt}개 · 다음 주문부터 · 지난 주문은 주문 때 값 그대로</small>
          <table className="tbl"><thead><tr><th>코드</th><th>상품</th><th>상태</th><th>부가세</th><th /></tr></thead>
            <tbody>{p.data.items.map((x) => (
              <tr key={x.code} data-acct-product={x.taxType}><td>{x.code}</td><td>{x.name}</td><td>{x.status}</td><td>{x.taxType === 'EXEMPT' ? <b>면세</b> : '과세'}</td>
                <td><button className="btn-sm btn-plain" disabled={a.busy === `t${x.code}`} onClick={() => tax(x.code, x.taxType === 'EXEMPT' ? 'TAXABLE' : 'EXEMPT')} data-acct-tax-type={x.code}>{x.taxType === 'EXEMPT' ? '과세로' : '면세로'}</button></td></tr>))}</tbody></table>
        </div>
      )}
    </section>
  );
}

/** v10.384 — 첫 화면 「이번 달 매출」 한 줄(SUPER · 전표가 있을 때만) */
export function AcctCard({ onGo }: { onGo?: (t: string) => void }) {
  const q = useApi<Report>('/admin/acct/report?months=2');   // 첫 화면은 SUPER 일 때만 이 상자를 그림(Dashboard)
  const d = q.data;
  if (!d?.latest) return null;
  const pct = (n: number | null) => (n == null ? '' : ` (지난달 대비 ${n > 0 ? '+' : ''}${n}%)`);
  return (
    <div className="card pad" data-acct-card="">
      <b>이번 달 매출</b> {won(d.latest.revenue)}{pct(d.change.revenue)} · 이익 {won(d.latest.profit)}{' '}
      {onGo && <button className="btn-sm btn-plain" onClick={() => onGo('acct-report')}>경영 보고서</button>}
      <small className="dim"> 전표 기준 · 공급가</small>
    </div>
  );
}

/* ── v10.389 (D244 · docs/526) 전표 CSV 양식 ── */
interface Fmt { id: string; name: string; columns: Array<{ field: string; title: string }>; dateStyle: string; dcStyle: 'SPLIT' | 'SIGN'; dcDebit: string; dcCredit: string; header: boolean; isDefault: boolean }
interface Formats { items: Fmt[]; fields: Record<string, string>; dateStyles: string[]; canEdit: boolean; note: string }
interface FmtEd { id: string | null; name: string; cols: string; dateStyle: string; dcStyle: 'SPLIT' | 'SIGN'; dcDebit: string; dcCredit: string; header: boolean; isDefault: boolean }

const colsText = (c: Fmt['columns']) => c.map((x) => `${x.field}=${x.title}`).join('\n');
const textCols = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [field, ...rest] = l.split('='); return { field: field!.trim(), title: rest.join('=').trim() }; });

export function AcctFormats() {
  const q = useApi<Formats>('/admin/acct/formats');
  const a = useAct();
  const [ed, setEd] = useState<FmtEd | null>(null);
  const [pv, setPv] = useState<{ head: string[]; rows: unknown[][] } | null>(null);
  const body = (e: FmtEd) => JSON.stringify({ name: e.name, columns: textCols(e.cols), dateStyle: e.dateStyle, dcStyle: e.dcStyle, dcDebit: e.dcDebit, dcCredit: e.dcCredit, header: e.header, isDefault: e.isDefault });
  const preview = () => ed && void a.run('pv', () => api<{ head: string[]; rows: unknown[][] }>('/admin/acct/formats/preview', { method: 'POST', body: body(ed) }), undefined, (r) => { setPv(r); return '미리보기(보기 전표 · 저장 안 함)'; });
  const saveFmt = () => ed && void a.run('fs', () => api<{ note: string }>(ed.id ? `/admin/acct/formats/${ed.id}` : '/admin/acct/formats', { method: ed.id ? 'PATCH' : 'POST', body: body(ed) }), () => { setEd(null); setPv(null); q.reload(); }, (r) => r.note);
  const d = q.data;
  if (!d) return null;
  const open = (f?: Fmt) => { setPv(null); setEd(f ? { id: f.id, name: f.name, cols: colsText(f.columns), dateStyle: f.dateStyle, dcStyle: f.dcStyle, dcDebit: f.dcDebit, dcCredit: f.dcCredit, header: f.header, isDefault: f.isDefault }
    : { id: null, name: `새 양식 ${d.items.length + 1}`, cols: colsText(d.items[0]?.columns ?? []), dateStyle: 'YYYY-MM-DD', dcStyle: 'SPLIT', dcDebit: '차변', dcCredit: '대변', header: true, isDefault: false }); };
  return (
    <div className="card pad" data-acct-formats={d.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>전표 CSV 양식</b> <small className="dim">{d.note}</small>{' '}
      {d.canEdit && !ed && <button className="btn-sm btn-plain" onClick={() => open()} data-acct-format-new="">새 양식</button>}
      <table className="tbl"><thead><tr><th>양식</th><th>칸</th><th>날짜</th><th>차변 · 대변</th><th /></tr></thead>
        <tbody>{d.items.map((f) => (
          <tr key={f.id} data-acct-format-row={f.isDefault ? 'default' : ''}>
            <td>{f.name}{f.isDefault && <span className="badge"> 기본</span>}</td><td><small>{f.columns.map((c) => c.title).join(' · ')}</small></td><td>{f.dateStyle}</td>
            <td>{f.dcStyle === 'SPLIT' ? '두 칸' : `구분(${f.dcDebit} · ${f.dcCredit}) + 금액`}</td>
            <td>{d.canEdit && <button className="btn-sm btn-plain" onClick={() => open(f)} data-acct-format-edit={f.id}>고치기</button>}</td></tr>))}</tbody></table>
      {ed && (
        <div data-acct-format-form="">
          <label>이름 <input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} size={16} /></label>{' '}
          <label>날짜 <select value={ed.dateStyle} onChange={(e) => setEd({ ...ed, dateStyle: e.target.value })}>{d.dateStyles.map((x) => <option key={x}>{x}</option>)}</select></label>{' '}
          <label>차변 · 대변 <select value={ed.dcStyle} onChange={(e) => setEd({ ...ed, dcStyle: e.target.value as 'SPLIT' | 'SIGN' })}><option value="SPLIT">두 칸(차변 · 대변)</option><option value="SIGN">구분 칸 + 금액</option></select></label>{' '}
          {ed.dcStyle === 'SIGN' && <><input value={ed.dcDebit} onChange={(e) => setEd({ ...ed, dcDebit: e.target.value })} size={4} aria-label="차변 글자" /> <input value={ed.dcCredit} onChange={(e) => setEd({ ...ed, dcCredit: e.target.value })} size={4} aria-label="대변 글자" /></>}{' '}
          <label><input type="checkbox" checked={ed.header} onChange={(e) => setEd({ ...ed, header: e.target.checked })} /> 머리줄</label>{' '}
          <label><input type="checkbox" checked={ed.isDefault} onChange={(e) => setEd({ ...ed, isDefault: e.target.checked })} /> 기본으로</label>
          <p className="muted">칸은 한 줄에 하나 「칸=칸 이름」 — 쓸 수 있는 칸: {Object.entries(d.fields).map(([k, v]) => `${k}(${v})`).join(' · ')}</p>
          <textarea value={ed.cols} onChange={(e) => setEd({ ...ed, cols: e.target.value })} rows={8} cols={40} aria-label="칸" data-acct-format-cols="" />
          <div className="acts">
            <button className="btn-sm btn-plain" disabled={a.busy === 'pv'} onClick={preview} data-acct-format-preview="">미리보기</button>{' '}
            <button className="btn-sm" disabled={a.busy === 'fs' || !ed.name.trim()} onClick={saveFmt} data-acct-format-save="">저장</button>{' '}
            <button className="btn-sm btn-plain" onClick={() => { setEd(null); setPv(null); }}>닫기</button>
          </div>
          {pv && <table className="tbl" data-acct-format-pv=""><thead><tr>{pv.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{pv.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c ?? '')}</td>)}</tr>)}</tbody></table>}
        </div>
      )}
    </div>
  );
}

/* ── v10.388 (D244 · docs/525) 은행 맞추기 ── */
interface Cand { entryId: string; date: string; source: string; memo: string | null; party: string | null; amount: number; nameOk: boolean; days: number }
interface Txn { id: string; date: string; deposit: number; withdraw: number; balance: number | null; counterparty: string | null; memo: string | null; matchKind: string | null; entryId: string | null; matchNote: string | null; candidates: Cand[] }
interface Bank { ym: string; days: number; items: Txn[]; bookOnly: Array<Omit<Cand, 'nameOk' | 'days'> & { side: 'D' | 'C' }>; uploads: Array<{ id: string; filename: string | null; bank: string | null; total: number; added: number; dup: number; bad: number; createdAt: string }>;
  count: { total: number; open: number; matched: number; ignored: number; autoReady: number; bookOnly: number }; lastBalance: { date: string; balance: number } | null; note: string }

/** 은행 CSV 는 EUC-KR(CP949)인 경우가 많음 — UTF-8 로 읽어 깨지면 EUC-KR 로 */
const readText = async (f: File) => {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('euc-kr').decode(buf); }
};

export function AcctBank() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<Bank>(`/admin/acct/bank?ym=${ym}`);
  const a = useAct();
  const [pick, setPick] = useState<Record<string, string>>({});
  const upload = (f: File | undefined) => f && void a.run('up', async () => {
    const csv = await readText(f);
    return api<{ note: string }>('/admin/acct/bank/upload', { method: 'POST', body: JSON.stringify({ csv, filename: f.name }) });
  }, q.reload, (r) => r.note);
  const match = (id: string, b: Record<string, unknown>) => void a.run(`m${id}`, () => api<{ note: string }>(`/admin/acct/bank/${id}/match`, { method: 'POST', body: JSON.stringify(b) }), q.reload, (r) => r.note);
  const ignore = (id: string) => { const note = prompt('맞출 것 없음 — 사유(예: 예금 이자 · 이체 수수료)'); if (note) match(id, { ignore: true, note }); };
  const clear = (id: string) => { const note = prompt('맞춤을 풉니다 — 사유'); if (note) match(id, { clear: true, note }); };
  const auto = () => void a.run('auto', () => api<{ note: string }>('/admin/acct/bank/auto-match', { method: 'POST', body: JSON.stringify({ ym }) }), q.reload, (r) => r.note);
  const d = q.data;
  return (
    <section data-acct-bank={d?.count.total ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm btn-plain" onClick={() => setYm(prevYm(ym))}>지난달</button>{' '}
        <label className="btn-sm">거래 내역 CSV 올리기 <input type="file" accept=".csv,.txt,text/csv" hidden disabled={a.busy === 'up'} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} data-acct-bank-file="" /></label>{' '}
        <button className="btn-sm" disabled={a.busy === 'auto' || !d?.count.autoReady} onClick={auto} data-acct-bank-auto="">자동 맞춤{d?.count.autoReady ? ` ${d.count.autoReady}` : ''}</button>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-bank-count="">통장 줄 <b>{d.count.total}</b> · 맞춤 {d.count.matched} · 맞출 것 없음 {d.count.ignored} · <b className={d.count.open ? 'warn-text' : ''}>남음 {d.count.open}</b> · 장부에만 있음 {d.count.bookOnly}
            {d.lastBalance && <> · 마지막 잔액 {won(d.lastBalance.balance)}원({d.lastBalance.date})</>}</p>
          <p className="muted">{d.note} 인터넷뱅킹 「거래내역 조회 → 엑셀(CSV) 저장」 파일을 그대로 올리십시오(같은 줄은 한 번만 들어감).</p>
          {d.items.length > 0 && (
            <table className="tbl" data-acct-bank-rows={d.items.length}><thead><tr><th>날짜</th><th>입금</th><th>출금</th><th>내용</th><th>맞춤</th></tr></thead>
              <tbody>{d.items.map((t) => (
                <tr key={t.id} data-acct-bank-row={t.matchKind ?? 'open'}>
                  <td>{t.date}</td><td>{t.deposit ? won(t.deposit) : ''}</td><td>{t.withdraw ? won(t.withdraw) : ''}</td><td>{t.counterparty ?? ''} <small className="dim">{t.memo ?? ''}</small></td>
                  <td>{t.matchKind === 'ENTRY' ? <>전표 {t.entryId} <button className="btn-sm btn-plain" onClick={() => clear(t.id)}>풀기</button></>
                    : t.matchKind === 'IGNORE' ? <>맞출 것 없음 <small className="dim">{t.matchNote}</small> <button className="btn-sm btn-plain" onClick={() => clear(t.id)}>풀기</button></>
                    : <>
                      {t.candidates.length > 0 ? (
                        <select value={pick[t.id] ?? t.candidates[0]!.entryId} onChange={(e) => setPick({ ...pick, [t.id]: e.target.value })} aria-label="후보 전표" data-acct-bank-cand={t.candidates.length}>
                          {t.candidates.map((c) => <option key={c.entryId} value={c.entryId}>{c.date} 전표 {c.entryId} · {c.party ?? c.memo ?? c.source}{c.nameOk ? ' ✓이름' : ''}</option>)}
                        </select>) : <small className="dim">후보 없음 </small>}{' '}
                      {t.candidates.length > 0 && <button className="btn-sm" disabled={a.busy === `m${t.id}`} onClick={() => match(t.id, { entryId: pick[t.id] ?? t.candidates[0]!.entryId })} data-acct-bank-match="">맞춤</button>}{' '}
                      <button className="btn-sm btn-plain" disabled={a.busy === `m${t.id}`} onClick={() => ignore(t.id)} data-acct-bank-ignore="">맞출 것 없음</button>
                    </>}</td>
                </tr>))}</tbody></table>
          )}
          {d.bookOnly.length > 0 && (
            <details data-acct-bank-bookonly={d.bookOnly.length}><summary>장부에만 있음 {d.bookOnly.length}줄 — 전표에는 있는데 통장에 아직 없는 보통예금 줄</summary>
              <table className="tbl"><thead><tr><th>날짜</th><th>전표</th><th>적요</th><th>들어옴</th><th>나감</th></tr></thead>
                <tbody>{d.bookOnly.map((c) => <tr key={c.entryId + c.side}><td>{c.date}</td><td>{c.entryId}</td><td>{c.party ?? ''} {c.memo ?? ''}</td><td>{c.side === 'D' ? won(c.amount) : ''}</td><td>{c.side === 'C' ? won(c.amount) : ''}</td></tr>)}</tbody></table>
            </details>
          )}
          {d.uploads.length > 0 && <p className="muted">최근 올림: {d.uploads.slice(0, 3).map((u) => `${ymdhm(u.createdAt)} ${u.filename ?? ''} 새로 ${u.added} · 있음 ${u.dup}${u.bad ? ` · 못 읽음 ${u.bad}` : ''}`).join(' / ')}</p>}
        </>
      )}
    </section>
  );
}

/* ── v10.390 (D244 · docs/527) 월 결산 ── */
interface Month { ym: string; closing: { closedAt: string } | null; entries: number; late: number;
  money: { revenue: number; expense: number; profit: number; vatOut: number; wht: number; cashIn: number; cashOut: number };
  bank: Bank['count']; lastBalance: Bank['lastBalance']; invoicesTodo: number;
  deadlines: Array<{ key: string; label: string; due: string; daysLeft: number }>; checks: Array<{ key: string; label: string; ok: boolean; detail: string; where: string }>; ready: boolean; note: string }

export function AcctMonth() {
  const [ym, setYm] = useState(prevYm(kstYm()));
  const q = useApi<Month>(`/admin/acct/month?ym=${ym}`);
  const d = q.data;
  return (
    <section data-acct-month-sum={d?.entries ?? ''}>
      <div className="acts">
        <label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm btn-plain" onClick={() => setYm(prevYm(ym))}>그 전 달</button>{' '}
        <button className="btn-sm btn-plain" onClick={() => setYm(kstYm())}>이번 달</button>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          {d.deadlines.length > 0 && (
            <div className="card pad" data-acct-deadlines={d.deadlines.length}>
              <b>다가오는 신고 기한</b>
              <ul>{d.deadlines.map((x) => <li key={x.key} className={x.daysLeft <= 3 ? 'warn-text' : ''}>{x.due} {x.label} — {x.daysLeft === 0 ? '오늘' : `${x.daysLeft}일 남음`}</li>)}</ul>
            </div>
          )}
          <p data-acct-month-money="">{d.ym} 전표 <b>{d.entries}</b>장{d.late ? ` (늦게 ${d.late})` : ''} · 매출 <b>{won(d.money.revenue)}</b> · 비용 {won(d.money.expense)} · 이익 <b>{won(d.money.profit)}</b> · 부가세 {won(d.money.vatOut)} · 원천세 {won(d.money.wht)} · 들어옴 {won(d.money.cashIn)} · 나감 {won(d.money.cashOut)}
            {' · '}{d.closing ? <span className="badge">마감 {ymdhm(d.closing.closedAt)}</span> : <span className="dim">마감 전</span>}</p>
          <table className="tbl" data-acct-checks={d.checks.filter((c) => c.ok).length}><thead><tr><th>마감 전 할 일</th><th>상태</th><th>어디서</th></tr></thead>
            <tbody>{d.checks.map((c) => <tr key={c.key} data-acct-check={c.ok ? 'ok' : 'todo'}><td>{c.label}</td><td>{c.ok ? '끝' : <b className="warn-text">{c.detail || '아직'}</b>}</td><td className="dim">{c.where}</td></tr>)}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
