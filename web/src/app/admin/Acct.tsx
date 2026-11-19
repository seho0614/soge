import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';
import { fmtSize, openFile, uploadFile } from '../../lib/files';

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

interface Report { months: Array<{ ym: string; revenue: number; byRevenue: Record<string, number>; expense: number; profit: number; vat: number; cashIn: number; cashOut: number }>; revenueNames: Record<string, string>; latest: { revenue: number; profit: number } | null; change: { revenue: number | null; profit: number | null }; note: string; budget?: { text: string } | null }

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
      {d.budget && <p data-acct-report-budget="">{d.budget.text}</p>}
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

interface Acc { role: string; name: string; kind: string; extCode: string | null; extName: string | null; note: string | null; draft?: boolean; custom?: boolean }
interface Slot { role: string; kind: string; to: string; toName: string; changed: boolean }
interface Rule { source: string; label: string; evidence: string; baseEvidence?: string; lines: Line[]; slots?: Slot[]; changed?: boolean }
interface Rules { accounts: Acc[]; rules: Rule[]; settings: Array<{ key: string; value: string }>; canEdit: boolean; note: string;
  changes?: Array<{ id: string; source: string; slot: string; before: string | null; after: string | null; reason: string; createdAt: string; actor: string | null }>;
  evidences?: Array<{ code: string; label: string }> }
const KIND_KO: Record<string, string> = { ASSET: '자산', LIABILITY: '부채', REVENUE: '수익', EXPENSE: '비용', EQUITY: '자본' };
const EVK: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '—', CARD: '법인카드', SIMPLE: '간이영수증' };

/** v10.392 (D245) — 규칙 한 줄 고치기(계정 자리 · 증빙 · SUPER · 사유) */
function RuleEdit({ r, accounts, evidences, onDone }: { r: Rule; accounts: Acc[]; evidences: Array<{ code: string; label: string }>; onDone: () => void }) {
  const a = useAct();
  const [maps, setMaps] = useState<Record<string, string>>(Object.fromEntries((r.slots ?? []).map((x) => [x.role, x.to])));
  const [ev, setEv] = useState(r.evidence);
  const [reason, setReason] = useState('');
  const changed = (r.slots ?? []).filter((x) => maps[x.role] !== x.to).map((x) => ({ from: x.role, to: maps[x.role]! }));
  const save = () => void a.run('rule', () => api(`/admin/acct/rules/${r.source}`, { method: 'PATCH', body: JSON.stringify({ maps: changed, ...(ev !== r.evidence ? { evidence: ev } : {}), reason }) }), onDone);
  return (
    <div className="card pad" data-acct-rule-edit={r.source}>
      <Flash msg={a.msg} err={a.err} />
      <b>{r.label}</b> <small className="dim">{r.source} · 금액 계산은 그대로 · 바꾼 다음 전표부터</small>
      <table className="tbl"><thead><tr><th>계정 자리</th><th>쓸 계정(같은 종류)</th></tr></thead>
        <tbody>{(r.slots ?? []).map((x) => (
          <tr key={x.role}><td>{accounts.find((c) => c.role === x.role)?.name ?? x.role} <small className="dim">{KIND_KO[x.kind] ?? x.kind}</small></td>
            <td><select value={maps[x.role]} onChange={(e) => setMaps({ ...maps, [x.role]: e.target.value })} aria-label={`${x.role} 계정`}>
              {accounts.filter((c) => c.kind === x.kind).map((c) => <option key={c.role} value={c.role}>{c.name} {c.extCode ? `(${c.extCode})` : ''}{c.role === x.role ? ' — 원래' : ''}</option>)}
            </select></td></tr>))}</tbody></table>
      <label>증빙 <select value={ev} onChange={(e) => setEv(e.target.value)}>{evidences.map((e) => <option key={e.code} value={e.code}>{e.label}{e.code === r.baseEvidence ? ' — 원래' : ''}</option>)}</select></label>{' '}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(꼭 · 예: 세무사 확인)" size={24} />{' '}
      <button className="btn-sm" disabled={a.busy === 'rule' || reason.trim().length < 2 || (!changed.length && ev === r.evidence)} onClick={save}>저장</button>
    </div>
  );
}

/** v10.392 — 계정 더하기(SUPER · U_ · 지우지 않음) */
function AccountAdd({ onDone }: { onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState({ role: 'U_', name: '', kind: 'EXPENSE', extCode: '', extName: '', reason: '' });
  const ok = /^U_[A-Z][A-Z_]{1,30}$/.test(f.role) && f.name.trim() && f.reason.trim().length >= 2;
  return (
    <div className="card pad" data-acct-account-add="">
      <Flash msg={a.msg} err={a.err} />
      <b>계정 더하기</b> <small className="dim">역할은 U_ 로 시작하는 대문자 · 지우지 않음</small><br />
      <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value.toUpperCase() })} size={14} aria-label="역할" />{' '}
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름" size={14} />{' '}
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((k) => <option key={k} value={k}>{KIND_KO[k]}</option>)}</select>{' '}
      <input value={f.extCode} onChange={(e) => setF({ ...f, extCode: e.target.value })} placeholder="코드" size={6} />{' '}
      <input value={f.extName} onChange={(e) => setF({ ...f, extName: e.target.value })} placeholder="계정과목" size={10} />{' '}
      <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="사유(꼭)" size={14} />{' '}
      <button className="btn-sm" disabled={!ok || a.busy === 'add'} onClick={() => void a.run('add', () => api('/admin/acct/accounts', { method: 'POST', body: JSON.stringify(f) }), () => { setF({ role: 'U_', name: '', kind: 'EXPENSE', extCode: '', extName: '', reason: '' }); onDone(); })}>더하기</button>
    </div>
  );
}
interface Prod { items: Array<{ code: string; name: string; status: string; taxType: 'TAXABLE' | 'EXEMPT' }>; exempt: number }

export function AcctAccounts() {
  const q = useApi<Rules>('/admin/acct/accounts');
  const p = useApi<Prod>('/admin/acct/products');
  const a = useAct();
  const [ed, setEd] = useState<{ role: string; extCode: string; extName: string; reason: string } | null>(null);
  const [rEd, setREd] = useState<string | null>(null);
  const sheet = () => void a.run('sheet', () => api<{ csv: string; filename: string; count: number }>('/admin/acct/rules/sheet?csv=1'), undefined, (r) => `확인표 ${r?.count ?? 0}가지를 내려받았습니다.`)
    .then((r) => { if (r?.csv) save(r.filename, r.csv); });
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
                <td>{x.name} <small className="dim">{x.role}</small></td><td>{KIND_KO[x.kind] ?? x.kind}</td>
                <td>{ed?.role === x.role ? (
                  <span><input value={ed.extCode} onChange={(e) => setEd({ ...ed, extCode: e.target.value })} size={8} aria-label="코드" /> <input value={ed.extName} onChange={(e) => setEd({ ...ed, extName: e.target.value })} size={12} aria-label="이름" /> <input value={ed.reason} onChange={(e) => setEd({ ...ed, reason: e.target.value })} placeholder="사유(꼭)" size={14} /> <button className="btn-sm" disabled={a.busy === 'acc' || ed.reason.trim().length < 2} onClick={saveAcc}>저장</button> <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button></span>
                ) : <>{x.extCode ?? '—'} {x.extName ?? ''} {x.draft !== false && <small className="warn-text" data-acct-code-draft={x.role}>초안</small>}</>}</td>
                <td className="dim"><small>{x.note}</small></td>
                <td>{q.data!.canEdit && ed?.role !== x.role && <button className="btn-sm btn-plain" onClick={() => setEd({ role: x.role, extCode: x.extCode ?? '', extName: x.extName ?? '', reason: '' })} data-acct-account-edit={x.role}>고치기</button>}</td>
              </tr>))}</tbody></table>
          {q.data.canEdit && <AccountAdd onDone={q.reload} />}
          <h3>전표 규칙(11,000원 예 · 초안)</h3>
          <p><button className="btn-sm btn-plain" disabled={a.busy === 'sheet'} onClick={sheet} data-acct-rule-sheet="">확인표 CSV(세무사 확인용)</button> <small className="dim">규칙마다 예시 전표 · 계정 코드 · 초안 표시</small></p>
          <table className="tbl" data-acct-rules={q.data.rules.length}><thead><tr><th>돈 흐름</th><th>증빙</th><th>차변</th><th>대변</th><th /></tr></thead>
            <tbody>{q.data.rules.map((r) => (
              <tr key={r.source} data-acct-rule={r.source}><td>{r.label} {r.changed && <small className="warn-text" data-acct-rule-changed={r.source}>바꿈</small>}</td><td>{EVK[r.evidence] ?? r.evidence}</td>
                <td>{r.lines.filter((l) => l.debit).map((l) => `${names[l.role] ?? l.role} ${won(l.debit)}`).join(' · ')}</td>
                <td>{r.lines.filter((l) => l.credit).map((l) => `${names[l.role] ?? l.role} ${won(l.credit)}`).join(' · ')}</td>
                <td>{q.data!.canEdit && <button className="btn-sm btn-plain" onClick={() => setREd(rEd === r.source ? null : r.source)} data-acct-rule-open={r.source}>{rEd === r.source ? '닫기' : '고치기'}</button>}</td></tr>))}</tbody></table>
          {rEd && q.data.rules.find((r) => r.source === rEd) && (
            <RuleEdit key={rEd} r={q.data.rules.find((r) => r.source === rEd)!} accounts={q.data.accounts} evidences={q.data.evidences ?? []} onDone={() => { setREd(null); q.reload(); }} />
          )}
          {!!q.data.changes?.length && (
            <details data-acct-rule-changes={q.data.changes.length}><summary>규칙 바꾼 기록 {q.data.changes.length}</summary>
              <table className="tbl"><thead><tr><th>때</th><th>돈 흐름</th><th>자리</th><th>전 → 뒤</th><th>사유</th><th>누가</th></tr></thead>
                <tbody>{q.data.changes.map((c) => <tr key={c.id}><td>{ymdhm(c.createdAt)}</td><td>{c.source}</td><td>{c.slot === '@evidence' ? '증빙' : c.slot}</td><td>{c.before} → {c.after}</td><td>{c.reason}</td><td>{c.actor ?? ''}</td></tr>)}</tbody></table>
            </details>
          )}
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

interface PurFile { id: string; name: string; contentType: string; size: number }
interface Purchase { id: string; kind: string; issuedOn: string; supplierName: string; supplierBizNo: string | null; item: string; supply: number; vat: number; total: number;
  deductible: boolean; accountRole: string; accountName: string; payRole: string; memo: string | null; state: string; cancelReason: string | null; entryId: string | null; files: PurFile[] }
interface Purchases { ym: string; items: Purchase[]; count: { active: number; canceled: number }; total: { supply: number; vat: number; deductVat: number; total: number };
  accounts: Array<{ role: string; name: string; kind: string; extCode: string | null }>; kinds: Record<string, string>; pays: Record<string, string>; maxFiles: number; note: string }
interface PurVat { ok: boolean; q: string; byKind: Array<{ kind: string; kindKo: string; deductible: boolean; count: number; supply: number; vat: number }>;
  bySupplier: Array<{ bizNo: string; name: string; count: number; supply: number; vat: number }>; total: { supply: number; vat: number; deductVat: number; nonDeductVat: number; count: number }; note: string }

const kstQ = () => { const d = new Date(Date.now() + 9 * 3600e3); return `${d.getUTCFullYear()}-${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const PUR_EMPTY = { kind: 'TAX_INVOICE', issuedOn: '', supplierName: '', supplierBizNo: '', item: '', supply: '', vat: '', deductible: true, accountRole: 'EXP_SUPPLIES', payRole: 'AP', memo: '' };

export function AcctPurchases() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<Purchases>(`/admin/acct/purchases?ym=${ym}`);
  const [qq, setQq] = useState(kstQ());
  const v = useApi<PurVat>(`/admin/acct/tax/vat-purchase?q=${qq}`);
  const a = useAct();
  const [f, setF] = useState({ ...PUR_EMPTY, issuedOn: kstDay() });
  const [files, setFiles] = useState<PurFile[]>([]);
  const d = q.data;
  const simple = f.kind === 'SIMPLE';
  const set = (k: string, val: unknown) => setF({ ...f, [k]: val });
  /* 공급가를 넣으면 부가세 10% 를 먼저 채워 둠(고칠 수 있음) */
  const setSupply = (s: string) => setF({ ...f, supply: s, vat: simple || !s ? '' : String(Math.round(Number(s) * 0.1)) });
  const addFile = (fl: File | undefined) => fl && void a.run('file', async () => {
    const u = await uploadFile(fl, 'ACCT_EVIDENCE');
    setFiles((x) => [...x, { id: u.fileId, name: u.name, contentType: u.contentType, size: u.size }]);
    return { note: `증빙 파일을 올렸습니다(${u.name}).` };
  });
  const send = (force = false) => void a.run('add', () => api<{ note: string }>('/admin/acct/purchases', { method: 'POST', body: JSON.stringify({
    kind: f.kind, issuedOn: f.issuedOn, supplierName: f.supplierName, supplierBizNo: f.supplierBizNo || undefined, item: f.item,
    supply: Number(f.supply), vat: simple ? 0 : Number(f.vat || 0), deductible: simple ? false : f.deductible, accountRole: f.accountRole, payRole: f.payRole,
    memo: f.memo || undefined, attachments: files.map((x) => x.id), force }) }),
    () => { setF({ ...PUR_EMPTY, issuedOn: f.issuedOn, kind: f.kind, payRole: f.payRole }); setFiles([]); q.reload(); v.reload(); }, (r) => r.note);
  const cancel = (p: Purchase) => { const reason = prompt(`${p.id}번 매입(${p.supplierName} · ${won(p.total)}원)을 취소합니다 — 사유`); if (reason) void a.run(`c${p.id}`, () => api<{ note: string }>(`/admin/acct/purchases/${p.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), () => { q.reload(); v.reload(); }, (r) => r.note); };
  const dup = (a.err ?? '').includes('이미 있습니다');
  return (
    <section data-acct-purchase={d?.count.active ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <h3>매입 넣기</h3>
      <div className="acts" data-acct-purchase-form="">
        <label>종류 <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, vat: e.target.value === 'SIMPLE' ? '' : f.vat, payRole: e.target.value === 'CARD' && f.payRole === 'AP' ? 'CARD_AP' : f.payRole })} data-acct-purchase-kind="">
          {Object.entries(d?.kinds ?? { TAX_INVOICE: '매입 세금계산서', CARD: '카드', CASH: '현금영수증', SIMPLE: '간이영수증' }).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>{' '}
        <label>발행일 <input type="date" value={f.issuedOn} max={kstDay()} onChange={(e) => set('issuedOn', e.target.value)} /></label>{' '}
        <label>공급자 <input value={f.supplierName} maxLength={120} onChange={(e) => set('supplierName', e.target.value)} placeholder="(주)사무용품" /></label>{' '}
        <label>사업자번호 <input value={f.supplierBizNo} maxLength={12} onChange={(e) => set('supplierBizNo', e.target.value)} placeholder={f.kind === 'TAX_INVOICE' ? '필수 · 숫자 10자리' : '있으면'} /></label>{' '}
        <label>품목 <input value={f.item} maxLength={120} onChange={(e) => set('item', e.target.value)} placeholder="복사용지" /></label>
      </div>
      <div className="acts">
        <label>{simple ? '합계' : '공급가'} <input type="number" min={1} value={f.supply} onChange={(e) => setSupply(e.target.value)} data-acct-purchase-supply="" /></label>{' '}
        {!simple && <label>부가세 <input type="number" min={0} value={f.vat} onChange={(e) => set('vat', e.target.value)} /></label>}{' '}
        <label>계정 <select value={f.accountRole} onChange={(e) => set('accountRole', e.target.value)} data-acct-purchase-account="">
          {(d?.accounts ?? []).map((x) => <option key={x.role} value={x.role}>{x.name}{x.extCode ? ` (${x.extCode})` : ''}{x.kind === 'ASSET' ? ' · 자산' : ''}</option>)}</select></label>{' '}
        <label>낸 방법 <select value={f.payRole} onChange={(e) => set('payRole', e.target.value)}>
          {Object.entries(d?.pays ?? {}).filter(([k]) => !(f.kind === 'CARD' && k === 'AP')).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>{' '}
        {!simple && f.accountRole !== 'EXP_ENTERTAIN' && <label><input type="checkbox" checked={f.deductible} onChange={(e) => set('deductible', e.target.checked)} /> 부가세 공제</label>}
        {(simple || f.accountRole === 'EXP_ENTERTAIN') && <small className="dim">공제 안 됨(부가세까지 비용)</small>}
      </div>
      <div className="acts">
        <label>메모 <input value={f.memo} maxLength={200} onChange={(e) => set('memo', e.target.value)} /></label>{' '}
        <label className="btn-sm btn-plain">증빙 파일(JPG · PNG · PDF) <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden disabled={a.busy === 'file' || files.length >= (d?.maxFiles ?? 5)} onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ''; }} data-acct-purchase-file="" /></label>{' '}
        {files.map((x) => <small key={x.id} className="chip">{x.name} {fmtSize(x.size)} <button className="btn-sm btn-plain" onClick={() => setFiles(files.filter((y) => y.id !== x.id))} aria-label="빼기">×</button></small>)}{' '}
        <b>합계 {won(Number(f.supply || 0) + (simple ? 0 : Number(f.vat || 0)))}원</b>{' '}
        <button className="btn-sm" disabled={a.busy === 'add' || !f.supplierName || !f.item || !Number(f.supply)} onClick={() => send(false)} data-acct-purchase-add="">넣기</button>
        {dup && <> <button className="btn-sm btn-plain" disabled={a.busy === 'add'} onClick={() => send(true)}>그래도 넣기</button></>}
      </div>
      {d && <p className="muted">{d.note}</p>}

      <h3>매입 목록</h3>
      <div className="acts">
        <label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm btn-plain" onClick={() => setYm(prevYm(ym))}>지난달</button>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-purchase-total="">{d.count.active}건{d.count.canceled ? ` · 취소 ${d.count.canceled}` : ''} · 공급가 {won(d.total.supply)} · 부가세 {won(d.total.vat)}(공제 {won(d.total.deductVat)}) · 합계 <b>{won(d.total.total)}</b>원</p>
          {d.items.length > 0 && (
            <table className="tbl" data-acct-purchase-rows={d.items.length}><thead><tr><th>번호</th><th>발행일</th><th>종류</th><th>공급자</th><th>품목 · 계정</th><th>공급가</th><th>부가세</th><th>합계</th><th>증빙</th><th>전표</th><th></th></tr></thead>
              <tbody>{d.items.map((p) => (
                <tr key={p.id} className={p.state === 'CANCELED' ? 'dim' : ''} data-acct-purchase-row={p.state}>
                  <td>{p.id}</td><td>{p.issuedOn}</td><td>{d.kinds[p.kind] ?? p.kind}</td>
                  <td>{p.supplierName}{p.supplierBizNo ? <small className="dim"> {p.supplierBizNo}</small> : null}</td>
                  <td>{p.item} <small className="dim">{p.accountName} · {d.pays[p.payRole] ?? p.payRole}</small></td>
                  <td>{won(p.supply)}</td><td>{won(p.vat)}{p.vat > 0 && !p.deductible ? <small className="dim"> 불공제</small> : null}</td><td>{won(p.total)}</td>
                  <td>{p.files.map((x) => <button key={x.id} className="btn-sm btn-plain" onClick={() => void openFile(x.id)} title={x.name}>파일</button>)}</td>
                  <td>{p.entryId ?? <small className="dim">아직</small>}</td>
                  <td>{p.state === 'ACTIVE' ? <button className="btn-sm btn-plain" disabled={a.busy === `c${p.id}`} onClick={() => cancel(p)} data-acct-purchase-cancel="">취소</button>
                    : <small className="dim" title={p.cancelReason ?? ''}>취소함</small>}</td>
                </tr>))}</tbody></table>
          )}
        </>
      )}

      <h3>분기 매입 부가세</h3>
      <div className="acts"><label>분기 <input value={qq} onChange={(e) => setQq(e.target.value)} placeholder="2026-4" size={7} /></label></div>
      {v.data?.ok && (
        <div data-acct-purchase-vat={v.data.total.count}>
          <p>매입 {v.data.total.count}건 · 공급가 {won(v.data.total.supply)} · <b>공제 부가세 {won(v.data.total.deductVat)}</b> · 불공제 {won(v.data.total.nonDeductVat)}</p>
          {v.data.byKind.length > 0 && <table className="tbl"><thead><tr><th>종류</th><th>공제</th><th>건수</th><th>공급가</th><th>부가세</th></tr></thead>
            <tbody>{v.data.byKind.map((x) => <tr key={x.kind + String(x.deductible)}><td>{x.kindKo}</td><td>{x.deductible ? '공제' : '불공제'}</td><td>{x.count}</td><td>{won(x.supply)}</td><td>{won(x.vat)}</td></tr>)}</tbody></table>}
          {v.data.bySupplier.length > 0 && <details><summary>매입 세금계산서 공급자별 {v.data.bySupplier.length}곳</summary>
            <table className="tbl"><thead><tr><th>사업자번호</th><th>공급자</th><th>매수</th><th>공급가</th><th>부가세</th></tr></thead>
              <tbody>{v.data.bySupplier.map((x) => <tr key={x.bizNo}><td>{x.bizNo}</td><td>{x.name}</td><td>{x.count}</td><td>{won(x.supply)}</td><td>{won(x.vat)}</td></tr>)}</tbody></table></details>}
          <p className="muted">{v.data.note}</p>
        </div>
      )}
      {v.data && !v.data.ok && <p className="warn-text">분기는 YYYY-n(예 2026-4)입니다.</p>}
    </section>
  );
}

interface ExpAcc { role: string; name: string; kind: string; extCode: string | null }
interface Expense { id: string; spentOn: string; accountRole: string; accountName: string; amount: number; vat: number; evidence: string; item: string; memo: string | null;
  attachments: string[]; state: string; claimant: string; claimantName: string | null; decidedBy: string | null; decidedAt: string | null; rejectReason: string | null;
  paidBy: string | null; paidAt: string | null; createdAt: string; mine: boolean; entryId: string | null }
interface Expenses { items: Expense[]; all: boolean; canDecide: boolean; canPay: boolean; accounts: ExpAcc[]; evidences: Record<string, string>;
  count: { requested: number; approved: number; owed: number }; note: string }
const EXP_STATE: Record<string, string> = { REQUESTED: '청구', APPROVED: '승인(지급 전)', REJECTED: '반려', PAID: '지급함', CANCELED: '취소' };
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export function AcctExpenses() {
  const [state, setState] = useState('');
  const q = useApi<Expenses>(`/admin/acct/expenses${state ? `?state=${state}` : ''}`, [state]);
  const a = useAct();
  const blank = { spentOn: kstToday(), accountRole: 'EXP_TRAVEL', amount: '', vat: '', evidence: 'CARD', item: '', memo: '' };
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState<Array<{ fileId: string; name: string }>>([]);
  const d = q.data;
  const expAccounts = (d?.accounts ?? []).filter((x) => x.kind === 'EXPENSE');
  const addFile = (file: File | undefined) => file && void a.run('file', async () => {
    if (files.length >= 3) throw new Error('증빙 파일은 3개까지입니다.');
    const u = await uploadFile(file, 'ACCT_EVIDENCE');
    setFiles((v) => [...v, { fileId: u.fileId, name: u.name }]);
    return { note: `${u.name} 올림` };
  }, undefined, (r) => r.note);
  const autoVat = () => { const amt = Number(f.amount || 0); if (amt > 0 && f.evidence !== 'SIMPLE') setF({ ...f, vat: String(amt - Math.round(amt / 1.1)) }); };
  const submit = () => void a.run('new', () => api<{ note: string }>('/admin/acct/expenses', { method: 'POST', body: JSON.stringify({
    spentOn: f.spentOn, accountRole: f.accountRole, amount: Number(f.amount || 0), vat: f.evidence === 'SIMPLE' ? 0 : Number(f.vat || 0),
    evidence: f.evidence, item: f.item, memo: f.memo || undefined, attachments: files.map((x) => x.fileId) }) }),
    () => { setF(blank); setFiles([]); q.reload(); }, (r) => r.note);
  const act = (id: string, path: string, body: Record<string, unknown> = {}) =>
    void a.run(`${path}${id}`, () => api<{ note: string }>(`/admin/acct/expenses/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }), q.reload, (r) => r.note);
  const reject = (id: string) => { const reason = prompt('반려 사유(2 ~ 200자)'); if (reason) act(id, 'decide', { decision: 'reject', reason }); };
  return (
    <section data-acct-expenses={d?.items.length ?? ''}>
      <h3>경비 청구</h3>
      <Flash msg={a.msg} err={a.err} />
      <div className="card" data-acct-expense-form="">
        <div className="acts">
          <label>쓴 날 <input type="date" value={f.spentOn} max={kstToday()} onChange={(e) => setF({ ...f, spentOn: e.target.value })} /></label>{' '}
          <label>계정 <select value={f.accountRole} onChange={(e) => setF({ ...f, accountRole: e.target.value })} data-acct-expense-role="">
            {expAccounts.map((x) => <option key={x.role} value={x.role}>{x.name}{x.extCode ? ` (${x.extCode})` : ''}</option>)}</select></label>{' '}
          <label>증빙 <select value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value, vat: e.target.value === 'SIMPLE' ? '' : f.vat })} data-acct-expense-ev="">
            {Object.entries(d?.evidences ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <div className="acts">
          <label>금액(부가세 포함) <input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} onBlur={() => !f.vat && autoVat()} data-acct-expense-amount="" /></label>{' '}
          <label>공제 부가세 <input type="number" min={0} value={f.evidence === 'SIMPLE' ? '' : f.vat} disabled={f.evidence === 'SIMPLE'} placeholder={f.evidence === 'SIMPLE' ? '간이영수증 — 공제 안 됨' : '0'} onChange={(e) => setF({ ...f, vat: e.target.value })} /></label>{' '}
          {f.evidence !== 'SIMPLE' && <button className="btn-sm btn-plain" onClick={autoVat}>÷ 11 채우기</button>}
        </div>
        <div className="acts">
          <label>내용 <input value={f.item} maxLength={100} placeholder="예: 거래처 방문 택시비" onChange={(e) => setF({ ...f, item: e.target.value })} data-acct-expense-item="" /></label>{' '}
          <label>메모 <input value={f.memo} maxLength={400} onChange={(e) => setF({ ...f, memo: e.target.value })} /></label>{' '}
          <label className="btn-sm">증빙 올리기({files.length}/3) <input type="file" accept=".jpg,.jpeg,.png,.pdf" hidden disabled={a.busy === 'file' || files.length >= 3} onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ''; }} /></label>{' '}
          {files.map((x) => <small key={x.fileId} className="dim">{x.name} <button className="btn-sm btn-plain" onClick={() => setFiles(files.filter((y) => y.fileId !== x.fileId))}>빼기</button> </small>)}
          <button className="btn-sm" disabled={a.busy === 'new' || !f.item.trim() || !(Number(f.amount) > 0)} onClick={submit} data-acct-expense-submit="">청구</button>
        </div>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-expense-count="">청구 <b className={d.count.requested ? 'warn-text' : ''}>{d.count.requested}</b> · 승인(지급 전) {d.count.approved}건 {won(d.count.owed)}원
            {' '}<label>상태 <select value={state} onChange={(e) => setState(e.target.value)}><option value="">모두</option>{Object.entries(EXP_STATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></p>
          <p className="muted">{d.note}{d.all ? '' : ' 내가 올린 청구만 보입니다.'}</p>
          {d.items.length > 0 && (
            <table className="tbl" data-acct-expense-rows={d.items.length}><thead><tr><th>쓴 날</th><th>청구한 사람</th><th>계정</th><th>내용</th><th>금액</th><th>부가세</th><th>증빙</th><th>상태</th><th></th></tr></thead>
              <tbody>{d.items.map((x) => (
                <tr key={x.id} data-acct-expense-row={x.state}>
                  <td>{x.spentOn}</td><td>{x.claimantName ?? ''}{x.mine ? ' (나)' : ''}</td><td>{x.accountName}</td>
                  <td>{x.item} <small className="dim">{x.memo ?? ''}</small></td><td>{won(x.amount)}</td><td>{x.vat ? won(x.vat) : ''}</td>
                  <td>{d.evidences[x.evidence] ?? x.evidence} {x.attachments.map((id, i) => <button key={id} className="btn-sm btn-plain" onClick={() => void openFile(id).catch((e) => alert(String(e)))}>파일 {i + 1}</button>)}</td>
                  <td>{EXP_STATE[x.state] ?? x.state}{x.rejectReason ? <small className="dim"> {x.rejectReason}</small> : ''}{x.entryId ? <small className="dim"> 전표 {x.entryId}</small> : ''}</td>
                  <td>
                    {x.state === 'REQUESTED' && d.canDecide && !x.mine && <><button className="btn-sm" disabled={a.busy === `decide${x.id}`} onClick={() => act(x.id, 'decide', { decision: 'approve' })} data-acct-expense-approve="">승인</button>{' '}
                      <button className="btn-sm btn-plain" disabled={a.busy === `decide${x.id}`} onClick={() => reject(x.id)} data-acct-expense-reject="">반려</button></>}
                    {x.state === 'APPROVED' && d.canPay && !x.mine && <button className="btn-sm" disabled={a.busy === `paid${x.id}`} onClick={() => confirm(`${x.claimantName ?? ''}님에게 ${won(x.amount)}원을 보냈습니까?`) && act(x.id, 'paid')} data-acct-expense-pay="">지급함</button>}
                    {x.state === 'REQUESTED' && x.mine && <button className="btn-sm btn-plain" disabled={a.busy === `cancel${x.id}`} onClick={() => confirm('청구를 취소합니까?') && act(x.id, 'cancel')} data-acct-expense-cancel="">취소</button>}
                  </td>
                </tr>))}</tbody></table>
          )}
        </>
      )}
    </section>
  );
}

interface CardTxn { id: string; usedOn: string; merchant: string | null; amount: number; approvalNo: string | null; cardTail: string | null; state: string;
  accountRole: string | null; accountName: string | null; deductible: boolean; vat: number; note: string | null; bookedAt: string | null; bookedBy: string | null; entryId: string | null }
interface Cards { ym: string; items: CardTxn[]; count: { total: number; open: number; booked: number; ignored: number; sum: number };
  uploads: Array<{ id: string; filename: string | null; total: number; added: number; dup: number; bad: number; createdAt: string }>; accounts: ExpAcc[]; cardPayable: number; note: string }

/** 법인카드 상자는 SUPER · PAYOUT 만(API 도 같은 권한) */
export function AcctCards() {
  return tokenRoles().some((r) => r === 'SUPER' || r === 'PAYOUT') ? <AcctCardsBox /> : null;
}
function AcctCardsBox() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<Cards>(`/admin/acct/cards?ym=${ym}`);
  const a = useAct();
  const [pick, setPick] = useState<Record<string, { role: string; ded: boolean }>>({});
  const d = q.data;
  const upload = (f: File | undefined) => f && void a.run('cup', async () => {
    const csv = await readText(f);
    return api<{ note: string }>('/admin/acct/cards/upload', { method: 'POST', body: JSON.stringify({ csv, filename: f.name }) });
  }, q.reload, (r) => r.note);
  const sel = (t: CardTxn) => pick[t.id] ?? { role: 'EXP_WELFARE', ded: true };
  const book = (t: CardTxn) => void a.run(`b${t.id}`, () => api<{ note: string }>(`/admin/acct/cards/${t.id}/book`, { method: 'POST', body: JSON.stringify({ accountRole: sel(t).role, deductible: sel(t).ded }) }), q.reload, (r) => r.note);
  const ignore = (t: CardTxn) => { const note = prompt('장부에 넣지 않음 — 사유(예: 개인 사용 · 본인 부담)'); if (note) void a.run(`b${t.id}`, () => api<{ note: string }>(`/admin/acct/cards/${t.id}/book`, { method: 'POST', body: JSON.stringify({ ignore: true, note }) }), q.reload, (r) => r.note); };
  return (
    <section data-acct-cards={d?.count.total ?? ''}>
      <h3>법인카드</h3>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm btn-plain" onClick={() => setYm(prevYm(ym))}>지난달</button>{' '}
        <label className="btn-sm">이용 내역 CSV 올리기 <input type="file" accept=".csv,.txt,text/csv" hidden disabled={a.busy === 'cup'} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} data-acct-card-file="" /></label>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-card-count="">이용 <b>{d.count.total}</b>줄 · 합 {won(d.count.sum)}원 · <b className={d.count.open ? 'warn-text' : ''}>남음 {d.count.open}</b> · 장부에 넣음 {d.count.booked} · 넣지 않음 {d.count.ignored} · 미지급금(법인카드) 잔액 {won(d.cardPayable)}원</p>
          <p className="muted">{d.note}</p>
          {d.items.length > 0 && (
            <table className="tbl" data-acct-card-rows={d.items.length}><thead><tr><th>이용일</th><th>가맹점</th><th>금액</th><th>계정 · 공제</th><th></th></tr></thead>
              <tbody>{d.items.map((t) => (
                <tr key={t.id} data-acct-card-row={t.state}>
                  <td>{t.usedOn}</td><td>{t.merchant ?? ''} <small className="dim">{t.approvalNo ?? ''}{t.cardTail ? ` · ${t.cardTail}` : ''}</small></td>
                  <td className={t.amount < 0 ? 'warn-text' : ''}>{won(t.amount)}{t.amount < 0 ? ' 취소' : ''}</td>
                  <td>{t.state === 'BOOKED' ? <>{t.accountName}{t.vat ? ` · 공제 ${won(t.vat)}` : ' · 공제 안 함'}{t.entryId ? <small className="dim"> 전표 {t.entryId}</small> : ''}</>
                    : <>
                      <select value={sel(t).role} onChange={(e) => setPick({ ...pick, [t.id]: { ...sel(t), role: e.target.value } })} aria-label="계정" data-acct-card-role="">
                        {d.accounts.map((x) => <option key={x.role} value={x.role}>{x.kind === 'ASSET' ? '[자산] ' : ''}{x.name}</option>)}</select>{' '}
                      <label><input type="checkbox" checked={sel(t).ded} onChange={(e) => setPick({ ...pick, [t.id]: { ...sel(t), ded: e.target.checked } })} /> 공제</label>
                      {t.state === 'IGNORED' && <small className="dim"> 넣지 않음 — {t.note}</small>}
                    </>}</td>
                  <td>{t.state !== 'BOOKED' && <><button className="btn-sm" disabled={a.busy === `b${t.id}`} onClick={() => book(t)} data-acct-card-book="">장부에 넣기</button>{' '}
                    {t.state === 'OPEN' && <button className="btn-sm btn-plain" disabled={a.busy === `b${t.id}`} onClick={() => ignore(t)} data-acct-card-ignore="">넣지 않음</button>}</>}</td>
                </tr>))}</tbody></table>
          )}
          {d.uploads.length > 0 && <p className="muted">최근 올림: {d.uploads.slice(0, 3).map((u) => `${ymdhm(u.createdAt)} ${u.filename ?? ''} 새로 ${u.added} · 있음 ${u.dup}${u.bad ? ` · 못 읽음 ${u.bad}` : ''}`).join(' / ')}</p>}
        </>
      )}
    </section>
  );
}

interface CashItem { date: string; dir: 'IN' | 'OUT'; kind: string; amount: number; label: string; overdue?: boolean; partial?: boolean }
interface CashFlow {
  today: string; days: number; end: string; start: number; bookAfter: number; floor: number; hasBase: boolean; short: boolean; overdue: number;
  base: { date: string; amount: number; source: 'MANUAL' | 'BANK'; note: string | null } | null;
  lowest: { date: string; balance: number }; in: number; out: number; totals: Record<string, number>; kinds: Record<string, string>;
  rows: Array<{ date: string; in: number; out: number; balance: number; biz: boolean; items: CashItem[] }>; note: string;
}
interface CashPlans {
  items: Array<{ id: string; dueOn: string; direction: 'IN' | 'OUT'; amount: number; memo: string; repeat: 'NONE' | 'MONTHLY'; untilOn: string | null; state: 'ACTIVE' | 'CANCELED'; cancelNote: string | null }>;
  balances: Array<{ id: string; asOf: string; amount: number; source: string; note: string | null; createdAt: string }>;
}

export function AcctCashflow() {
  const [days, setDays] = useState(90);
  const [all, setAll] = useState(false);
  const q = useApi<CashFlow>(`/admin/acct/cashflow?days=${days}`);
  const p = useApi<CashPlans>('/admin/acct/cashflow/plans');
  const a = useAct();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [bal, setBal] = useState({ asOf: today, amount: '', note: '' });
  const [pl, setPl] = useState({ dueOn: today, direction: 'OUT' as 'IN' | 'OUT', amount: '', memo: '', repeat: 'NONE' as 'NONE' | 'MONTHLY', untilOn: '' });
  const reload = () => { q.reload(); p.reload(); };
  const saveBal = () => void a.run('bal', () => api<{ note: string }>('/admin/acct/cashflow/balance', { method: 'POST', body: JSON.stringify({ asOf: bal.asOf, amount: Number(bal.amount.replace(/[,\s]/g, '')), note: bal.note }) }),
    () => { setBal({ ...bal, amount: '', note: '' }); reload(); }, (r) => r.note);
  const savePlan = () => void a.run('plan', () => api<{ note: string }>('/admin/acct/cashflow/plans', { method: 'POST', body: JSON.stringify({ ...pl, amount: Number(pl.amount.replace(/[,\s]/g, '')), untilOn: pl.repeat === 'MONTHLY' && pl.untilOn ? pl.untilOn : undefined }) }),
    () => { setPl({ ...pl, amount: '', memo: '' }); reload(); }, (r) => r.note);
  const cancel = (id: string) => { const reason = prompt('예정을 취소합니다 — 사유'); if (reason) void a.run(`c${id}`, () => api<{ note: string }>(`/admin/acct/cashflow/plans/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), reload, (r) => r.note); };
  const d = q.data;
  const rows = (d?.rows ?? []).filter((r) => all || r.items.length > 0 || r.date === d?.lowest.date || r.date === d?.today);
  return (
    <section data-acct-cash={d ? d.rows.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <label>기간 <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 60, 90, 180].map((x) => <option key={x} value={x}>{x}일</option>)}</select></label>{' '}
        <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 움직임 없는 날도</label>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <div className={`card pad${d.short ? ' warn' : ''}`} data-acct-cash-low={d.lowest.balance}>
            <p>시작 잔액 <b>{won(d.start)}</b>{d.base ? <span className="dim"> ({d.base.date} {d.base.source === 'BANK' ? '통장 CSV' : '직접 넣음'} {won(d.base.amount)}{d.bookAfter ? ` · 그 뒤 장부 ${d.bookAfter > 0 ? '+' : ''}${won(d.bookAfter)}` : ''})</span> : <b className="warn-text"> · 시작 잔액 없음</b>}
              {' · '}들어올 돈 {won(d.in)} · 나갈 돈 {won(d.out)} · {d.end} 잔액 <b>{won(d.rows[d.rows.length - 1]?.balance)}</b></p>
            <p>가장 낮은 날 <b className={d.short ? 'warn-text' : ''}>{d.lowest.date} · {won(d.lowest.balance)}원</b> (기준 {won(d.floor)}원{d.short ? ' 밑 — 운영 알림' : ''}){d.overdue ? <span className="warn-text"> · 납기 지난 것 {d.overdue}건(오늘 칸)</span> : null}</p>
            <p className="dim">{Object.entries(d.totals).filter(([, v]) => v).map(([k, v]) => `${d.kinds[k] ?? k} ${won(v)}`).join(' · ')}</p>
          </div>
          <table className="tbl" data-acct-cash-rows={rows.length}>
            <thead><tr><th>날짜</th><th>들어옴</th><th>나감</th><th>잔액</th><th>내용</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.date} data-acct-cash-lowest={r.date === d.lowest.date ? '' : undefined} className={r.date === d.lowest.date ? 'hl' : r.balance < d.floor ? 'warn' : ''}>
                <td>{r.date}{r.biz ? '' : <span className="dim"> (쉬는 날)</span>}</td>
                <td>{r.in ? won(r.in) : ''}</td><td>{r.out ? won(r.out) : ''}</td>
                <td>{r.date === d.lowest.date ? <b className={d.short ? 'warn-text' : ''}>{won(r.balance)}</b> : won(r.balance)}</td>
                <td className="dim">{r.items.map((x, i) => <span key={i}>{i ? ' · ' : ''}{x.dir === 'IN' ? '＋' : '－'}{x.label} {won(x.amount)}{x.overdue ? <b className="warn-text"> 납기 지남</b> : ''}{x.partial ? ' (지금까지)' : ''}</span>)}</td>
              </tr>))}</tbody>
          </table>
          <p className="muted">{d.note}</p>
        </>
      )}
      <div className="card pad">
        <b>예정 넣기</b> <span className="dim">임대료 · 대출 상환 · 투자금처럼 장부에 아직 없는 확정 들고 남</span>
        <div className="acts">
          <input type="date" value={pl.dueOn} onChange={(e) => setPl({ ...pl, dueOn: e.target.value })} />{' '}
          <select value={pl.direction} onChange={(e) => setPl({ ...pl, direction: e.target.value as 'IN' | 'OUT' })}><option value="OUT">나감</option><option value="IN">들어옴</option></select>{' '}
          <input inputMode="numeric" placeholder="금액" value={pl.amount} onChange={(e) => setPl({ ...pl, amount: e.target.value })} />{' '}
          <input placeholder="메모(2 ~ 100자)" value={pl.memo} onChange={(e) => setPl({ ...pl, memo: e.target.value })} />{' '}
          <select value={pl.repeat} onChange={(e) => setPl({ ...pl, repeat: e.target.value as 'NONE' | 'MONTHLY' })}><option value="NONE">한 번</option><option value="MONTHLY">매달</option></select>{' '}
          {pl.repeat === 'MONTHLY' && <label>끝 <input type="date" value={pl.untilOn} onChange={(e) => setPl({ ...pl, untilOn: e.target.value })} /></label>}{' '}
          <button className="btn-sm" disabled={a.busy === 'plan' || !pl.amount || pl.memo.trim().length < 2} onClick={savePlan} data-acct-cash-plan-add="">넣기</button>
        </div>
        <table className="tbl" data-acct-cash-plans={(p.data?.items ?? []).filter((x) => x.state === 'ACTIVE').length}>
          <thead><tr><th>날짜</th><th>들고 남</th><th>금액</th><th>메모</th><th>상태</th><th></th></tr></thead>
          <tbody>{(p.data?.items ?? []).map((x) => (
            <tr key={x.id} className={x.state === 'CANCELED' ? 'dim' : ''}>
              <td>{x.dueOn}{x.repeat === 'MONTHLY' ? ` 부터 매달${x.untilOn ? ` ~ ${x.untilOn}` : ''}` : ''}</td><td>{x.direction === 'IN' ? '들어옴' : '나감'}</td><td>{won(x.amount)}</td><td>{x.memo}</td>
              <td>{x.state === 'ACTIVE' ? '진행' : `취소 — ${x.cancelNote ?? ''}`}</td>
              <td>{x.state === 'ACTIVE' && <button className="btn-sm btn-plain" disabled={a.busy === `c${x.id}`} onClick={() => cancel(x.id)}>취소</button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {isSuper() && (
        <div className="card pad">
          <b>잔액 직접 넣기</b> <span className="dim">(SUPER · 그날 끝 통장 잔액 · 여러 통장이면 합 · 틀리면 새로 넣음)</span>
          <div className="acts">
            <input type="date" value={bal.asOf} max={today} onChange={(e) => setBal({ ...bal, asOf: e.target.value })} />{' '}
            <input inputMode="numeric" placeholder="잔액(원)" value={bal.amount} onChange={(e) => setBal({ ...bal, amount: e.target.value })} />{' '}
            <input placeholder="메모(선택)" value={bal.note} onChange={(e) => setBal({ ...bal, note: e.target.value })} />{' '}
            <button className="btn-sm" disabled={a.busy === 'bal' || !bal.amount} onClick={saveBal} data-acct-cash-balance="">넣기</button>
          </div>
          <ul className="dim">{(p.data?.balances ?? []).slice(0, 5).map((b) => <li key={b.id}>{b.asOf} {won(b.amount)}원 {b.note ?? ''}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

interface StockItem { code: string; name: string; optionId: string; label: string; active: boolean; shopQty: number; qty: number; avgCost: number; amount: number; lastMove: string | null; zeroCost: number; diff: number }
interface Stock { items: StockItem[]; total: { amount: number; qty: number; zeroCost: number }; note: string }
interface Move { id: string; date: string; kind: string; label: string; qty: number; unitCost: number; amount: number; qtyAfter: number; amountAfter: number; avgAfter: number; zeroCost: boolean; purchaseId: string | null; note: string | null }
const STOCK_KIND_KO: Record<string, string> = { IN: '입고', OUT_SALE: '판매 출고', RETURN: '취소 · 반품 반입', ADJUST: '실사 조정' };

export function AcctStock() {
  const q = useApi<Stock>('/admin/acct/stock');
  const a = useAct();
  const [form, setForm] = useState({ optionId: '', qty: '', unitCost: '', movedOn: '', purchaseId: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const d = q.data;
  const reload = () => { q.reload(); setTick(tick + 1); };
  const addIn = () => void a.run('in', () => api<{ note: string }>('/admin/acct/stock/in', { method: 'POST', body: JSON.stringify({
    optionId: form.optionId, qty: Number(form.qty), unitCost: Number(form.unitCost), ...(form.movedOn ? { movedOn: form.movedOn } : {}), ...(form.purchaseId ? { purchaseId: form.purchaseId } : {}) }) }),
    () => { setForm({ ...form, qty: '', unitCost: '', purchaseId: '' }); reload(); }, (r) => r.note);
  const adjust = (it: StockItem) => {
    const s = prompt(`${it.name} ${it.label} — 실사 조정 수량(늘림 +3 · 줄임 -2) · 지금 ${it.qty}개`); if (!s) return;
    const qty = Number(s); if (!Number.isInteger(qty) || !qty) return a.setErr('수량은 0이 아닌 정수입니다.');
    let unitCost: number | undefined;
    if (qty > 0 && it.qty <= 0) { const c = prompt('재고가 없어 단가가 필요합니다 — 한 개 단가(원)'); if (!c) return; unitCost = Number(c); }
    const reason = prompt('사유(예: 11월 실사 — 파손 2개)'); if (!reason) return;
    void a.run(`adj${it.optionId}`, () => api<{ note: string }>('/admin/acct/stock/adjust', { method: 'POST', body: JSON.stringify({ optionId: it.optionId, qty, reason, ...(unitCost ? { unitCost } : {}) }) }), reload, (r) => r.note);
  };
  return (
    <section data-acct-stock={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-stock-total="">재고 금액 <b>{won(d.total.amount)}</b>원 · 수량 {won(d.total.qty)}개
            {d.total.zeroCost > 0 && <> · <b className="warn-text">원가 0 으로 나간 줄 {d.total.zeroCost}</b></>}</p>
          <p className="muted">{d.note}</p>
          <div className="acts" data-acct-stock-in="">
            <select value={form.optionId} onChange={(e) => setForm({ ...form, optionId: e.target.value })} aria-label="상품 옵션">
              <option value="">입고할 상품 고르기</option>
              {d.items.filter((it) => it.active).map((it) => <option key={it.optionId} value={it.optionId}>{it.name} · {it.label}</option>)}
            </select>{' '}
            <input type="number" min={1} placeholder="수량" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={{ width: 80 }} />{' '}
            <input type="number" min={1} placeholder="단가(공급가)" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} style={{ width: 120 }} />{' '}
            <input type="date" value={form.movedOn} onChange={(e) => setForm({ ...form, movedOn: e.target.value })} aria-label="입고 날짜" />{' '}
            <input placeholder="매입 번호(있으면)" value={form.purchaseId} onChange={(e) => setForm({ ...form, purchaseId: e.target.value.replace(/\D/g, '') })} style={{ width: 120 }} />{' '}
            <button className="btn-sm" disabled={a.busy === 'in' || !form.optionId || !(Number(form.qty) > 0) || !(Number(form.unitCost) > 0)} onClick={addIn}>입고 적기</button>
          </div>
          <table className="tbl" data-acct-stock-rows={d.items.length}>
            <thead><tr><th>상품</th><th>옵션</th><th>수량</th><th>평균 단가</th><th>재고 금액</th><th>판매용</th><th>차이</th><th></th></tr></thead>
            <tbody>{d.items.map((it) => (
              <tr key={it.optionId} data-acct-stock-row={it.code}>
                <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === it.code ? null : it.code)}>{it.name}</button> <small className="dim">{it.code}</small></td>
                <td>{it.label}{!it.active && <small className="dim"> (꺼짐)</small>}</td>
                <td>{won(it.qty)}</td><td>{won(Math.round(it.avgCost))}</td><td>{won(it.amount)}</td><td>{won(it.shopQty)}</td>
                <td className={it.diff ? 'warn-text' : ''}>{it.diff ? won(it.diff) : ''}</td>
                <td>{isSuper() && <button className="btn-sm btn-plain" disabled={a.busy === `adj${it.optionId}`} onClick={() => adjust(it)} data-acct-stock-adjust="">실사 조정</button>}</td>
              </tr>))}</tbody>
          </table>
          {open && <StockMoves code={open} tick={tick} />}
        </>
      )}
    </section>
  );
}

function StockMoves({ code, tick }: { code: string; tick: number }) {
  const [ym, setYm] = useState(kstYm());
  const mv = useApi<{ moves: Move[]; name: string }>(`/admin/acct/stock/${encodeURIComponent(code)}/moves?ym=${ym}`, [tick]);
  return (
    <div data-acct-stock-moves={mv.data?.moves.length ?? ''}>
      <h4>{mv.data?.name ?? code} 수불 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="달" /></h4>
      {mv.data && (mv.data.moves.length === 0 ? <p className="muted">이 달 수불이 없습니다.</p> : (
        <table className="tbl"><thead><tr><th>날짜</th><th>종류</th><th>옵션</th><th>수량</th><th>단가</th><th>금액</th><th>남은 수량</th><th>남은 금액</th><th>평균</th></tr></thead>
          <tbody>{mv.data.moves.map((m) => (
            <tr key={m.id}><td>{m.date}</td><td>{STOCK_KIND_KO[m.kind] ?? m.kind}{m.zeroCost && <small className="warn-text"> 원가 0</small>}{m.purchaseId && <small className="dim"> 매입 {m.purchaseId}</small>}</td>
              <td>{m.label}</td><td>{m.qty > 0 ? `+${m.qty}` : m.qty}</td><td>{won(Math.round(m.unitCost))}</td><td>{won(m.amount)}</td><td>{won(m.qtyAfter)}</td><td>{won(m.amountAfter)}</td><td>{won(Math.round(m.avgAfter))}</td></tr>))}</tbody></table>))}
    </div>
  );
}

interface TbRowW { role: string; name: string; kind: string; code: string | null; opening: number; debit: number; credit: number; closing: number }
interface TbW { from: string; to: string; openingSet: { id: string; asOf: string } | null; rows: TbRowW[]; total: { debit: number; credit: number }; balanced: boolean }
interface IsW { from: string; to: string; revenue: Array<{ role: string; name: string; amount: number }>; expense: Array<{ role: string; name: string; amount: number }>;
  total: { revenue: number; cogs: number; grossProfit: number; expense: number; profit: number }; note: string }
interface BsItem { role: string; name: string; amount: number }
interface BsW { asOf: string; assets: BsItem[]; liabilities: BsItem[]; equity: BsItem[]; unclosedProfit: number; total: { assets: number; liabilitiesAndEquity: number }; balanced: boolean; warnings: string[]; note: string }
interface OpLine { role: string; debit: number; credit: number; memo?: string | null }
interface OpSet { id: string; asOf: string; state: string; note: string | null; debit: number; credit: number; n: number; lines: Array<OpLine & { id: string; name: string; kind: string }> }
interface OpW { sets: OpSet[]; startOn: string; note: string }
const KIND_W: Record<string, string> = { ASSET: '자산', LIABILITY: '부채', EQUITY: '자본', REVENUE: '매출', EXPENSE: '비용' };

export function AcctStatements() {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [view, setView] = useState<'bs' | 'is' | 'tb' | 'op'>('bs');
  const tb = useApi<TbW>(`/admin/acct/statements/trial?from=${from}&to=${to}`);
  const is = useApi<IsW>(`/admin/acct/statements/income?from=${from}&to=${to}`);
  const bs = useApi<BsW>(`/admin/acct/statements/balance?asOf=${to}`);
  return (
    <section data-acct-statements={view}>
      <div className="acts">
        <label>기간 <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label> ~ <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="끝일" />{' '}
        {(['bs', 'is', 'tb', 'op'] as const).map((v) => <button key={v} className={`btn-sm ${view === v ? '' : 'btn-plain'}`} onClick={() => setView(v)} data-acct-stmt-tab={v}>{({ bs: '재무상태표', is: '손익계산서', tb: '시산표', op: '기초 잔액' } as Record<string, string>)[v]}</button>)}
      </div>
      {view === 'bs' && bs.data && (
        <div data-acct-bs={bs.data.balanced ? 'ok' : 'diff'}>
          {bs.data.warnings.map((w, i) => <p key={i} className="warn-text">{w}</p>)}
          <div className="grid2">
            <table className="tbl"><thead><tr><th>자산</th><th>{bs.data.asOf}</th></tr></thead>
              <tbody>{bs.data.assets.map((x) => <tr key={x.role}><td>{x.name}</td><td>{won(x.amount)}</td></tr>)}<tr><th>합계</th><th>{won(bs.data.total.assets)}</th></tr></tbody></table>
            <table className="tbl"><thead><tr><th>부채 · 자본</th><th /></tr></thead>
              <tbody>{bs.data.liabilities.map((x) => <tr key={x.role}><td>{x.name}</td><td>{won(x.amount)}</td></tr>)}
                {bs.data.equity.map((x) => <tr key={x.role}><td>{x.name}</td><td>{won(x.amount)}</td></tr>)}
                <tr><td>마감 전 손익</td><td>{won(bs.data.unclosedProfit)}</td></tr>
                <tr><th>합계</th><th>{won(bs.data.total.liabilitiesAndEquity)}</th></tr></tbody></table>
          </div>
          <p className="muted">{bs.data.note}</p>
        </div>
      )}
      {view === 'is' && is.data && (
        <div data-acct-is={is.data.total.profit}>
          <table className="tbl"><tbody>
            <tr><th colSpan={2}>매출 · 수익</th></tr>{is.data.revenue.map((x) => <tr key={x.role}><td>{x.name}</td><td>{won(x.amount)}</td></tr>)}
            <tr><th>매출 합계</th><th>{won(is.data.total.revenue)}</th></tr>
            <tr><td>매출원가</td><td>{won(is.data.total.cogs)}</td></tr><tr><th>매출총이익</th><th>{won(is.data.total.grossProfit)}</th></tr>
            <tr><th colSpan={2}>비용</th></tr>{is.data.expense.filter((x) => x.role !== 'COGS').map((x) => <tr key={x.role}><td>{x.name}</td><td>{won(x.amount)}</td></tr>)}
            <tr><th>순이익</th><th>{won(is.data.total.profit)}</th></tr></tbody></table>
          <p className="muted">{is.data.note}</p>
        </div>
      )}
      {view === 'tb' && tb.data && (
        <div data-acct-tb={tb.data.rows.length}>
          <p>{tb.data.balanced ? '차변 합 = 대변 합' : <b className="warn-text">차변 합 ≠ 대변 합</b>} · 기초 잔액 {tb.data.openingSet ? `${tb.data.openingSet.asOf} 판` : '없음'}</p>
          <table className="tbl"><thead><tr><th>계정</th><th>종류</th><th>코드</th><th>기초</th><th>차변</th><th>대변</th><th>기말</th></tr></thead>
            <tbody>{tb.data.rows.map((r) => <tr key={r.role}><td>{r.name}</td><td>{KIND_W[r.kind]}</td><td>{r.code ?? '—'}</td><td>{won(r.opening)}</td><td>{won(r.debit)}</td><td>{won(r.credit)}</td><td>{won(r.closing)}</td></tr>)}
              <tr><th colSpan={4}>합계</th><th>{won(tb.data.total.debit)}</th><th>{won(tb.data.total.credit)}</th><th /></tr></tbody></table>
        </div>
      )}
      {view === 'op' && <AcctOpening />}
    </section>
  );
}

/** 기초 잔액 — 판 만들기 · 줄 넣기(DRAFT) · 확정(SUPER) */
function AcctOpening() {
  const q = useApi<OpW>('/admin/acct/opening');
  const acc = useApi<{ accounts: Array<{ role: string; name: string; kind: string }> }>('/admin/acct/accounts');
  const a = useAct();
  const [asOf, setAsOf] = useState('');
  const [rows, setRows] = useState<OpLine[] | null>(null);
  const draft = q.data?.sets.find((s) => s.state === 'DRAFT');
  const lines = rows ?? draft?.lines.map((l) => ({ role: l.role, debit: l.debit, credit: l.credit, memo: l.memo ?? '' })) ?? [];
  const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const create = () => void a.run('new', () => api('/admin/acct/opening', { method: 'POST', body: JSON.stringify({ asOf: asOf || q.data?.startOn }) }), q.reload);
  const saveLines = () => draft && void a.run('lines', () => api(`/admin/acct/opening/${draft.id}/lines`, { method: 'PUT', body: JSON.stringify({ lines: lines.filter((l) => l.role && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0)).map((l) => ({ role: l.role, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo ?? '' })) }) }), () => { setRows(null); q.reload(); });
  const fix = () => {
    if (!draft) return;
    const reason = prompt(`${draft.asOf} 기초 잔액을 확정합니다. 확정 뒤로는 고칠 수 없습니다. 사유를 적으십시오.`);
    if (reason) void a.run('fix', () => api(`/admin/acct/opening/${draft.id}/fix`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload);
  };
  const set = (i: number, k: keyof OpLine, v: string) => setRows(lines.map((l, j) => (j === i ? { ...l, [k]: k === 'role' || k === 'memo' ? v : Number(v.replace(/[^0-9]/g, '')) || 0 } : l)));
  return (
    <div className="card pad" data-acct-opening={q.data?.sets.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {q.data && <p className="muted">{q.data.note}</p>}
      {q.data?.sets.filter((s) => s.state === 'FIXED').map((s) => <p key={s.id} data-acct-opening-fixed={s.asOf}><b>{s.asOf}</b> 확정 · 줄 {s.n} · 차변 = 대변 {won(s.debit)}</p>)}
      {isSuper() && !draft && (
        <p><input type="date" value={asOf || q.data?.startOn || ''} onChange={(e) => setAsOf(e.target.value)} aria-label="기준일" /> <button className="btn-sm" disabled={a.busy === 'new'} onClick={create} data-acct-opening-new="">기초 잔액 판 만들기</button></p>
      )}
      {draft && (
        <>
          <b>{draft.asOf} 기초 잔액(작성 중)</b>
          <table className="tbl"><thead><tr><th>계정</th><th>차변</th><th>대변</th><th>메모</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}><td><select value={l.role} onChange={(e) => set(i, 'role', e.target.value)} aria-label="계정"><option value="">계정</option>{(acc.data?.accounts ?? []).filter((x) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(x.kind)).map((x) => <option key={x.role} value={x.role}>{x.name}({KIND_W[x.kind]})</option>)}</select></td>
                <td><input value={l.debit || ''} onChange={(e) => set(i, 'debit', e.target.value)} size={12} inputMode="numeric" aria-label="차변" /></td>
                <td><input value={l.credit || ''} onChange={(e) => set(i, 'credit', e.target.value)} size={12} inputMode="numeric" aria-label="대변" /></td>
                <td><input value={l.memo ?? ''} onChange={(e) => set(i, 'memo', e.target.value)} size={14} aria-label="메모" /></td>
                <td><button className="btn-sm btn-plain" onClick={() => setRows(lines.filter((_, j) => j !== i))}>빼기</button></td></tr>))}
              <tr><th>합계</th><th>{won(d)}</th><th>{won(c)}</th><th colSpan={2}>{d === c ? '맞음' : <span className="warn-text">차이 {won(d - c)}</span>}</th></tr></tbody></table>
          {isSuper() && (
            <p><button className="btn-sm btn-plain" onClick={() => setRows([...lines, { role: '', debit: 0, credit: 0, memo: '' }])}>줄 더하기</button>{' '}
              <button className="btn-sm" disabled={a.busy === 'lines'} onClick={saveLines} data-acct-opening-save="">저장</button>{' '}
              <button className="btn-sm" disabled={a.busy === 'fix' || rows !== null || d !== c || d === 0} onClick={fix} data-acct-opening-fix="">확정</button>
              <small className="dim"> 저장한 뒤 차변 = 대변이면 확정</small></p>
          )}
        </>
      )}
    </div>
  );
}

interface LedgerW { account: { role: string; name: string; code: string | null }; from: string; to: string; opening: number; closing: number; total: { debit: number; credit: number };
  rows: Array<{ date: string; entryId: string; source: string; memo: string; party: string; debit: number; credit: number; balance: number; late: boolean }>; note: string }
interface BookW { kind: string; items: Array<{ date: string; entryId: string; source: string; party: string; evidence: string; supply: number; vat: number; exempt: number; total: number; deductible: boolean | null }>;
  parties: Array<{ party: string; count: number; supply: number; vat: number; exempt: number; total: number }>; total: { count: number; supply: number; vat: number; exempt: number; total: number }; note: string }

export function AcctLedger() {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [role, setRole] = useState('CASH');
  const [mode, setMode] = useState<'ledger' | 'SALES' | 'PURCHASE'>('ledger');
  const acc = useApi<{ accounts: Array<{ role: string; name: string; kind: string }> }>('/admin/acct/accounts');
  const lg = useApi<LedgerW>(mode === 'ledger' ? `/admin/acct/ledger?role=${role}&from=${from}&to=${to}` : `/admin/acct/books?kind=${mode}&from=${from}&to=${to}`);
  const a = useAct();
  const csv = () => void a.run('csv', async () => {
    const t = await exportTicket('ACCT_LEDGER');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const p = mode === 'ledger' ? `/admin/acct/ledger/export?role=${role}&from=${from}&to=${to}` : `/admin/acct/books/export?kind=${mode}&from=${from}&to=${to}`;
    const r = await api<{ filename: string; csv: string; note: string }>(`${p}&ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r.note);
  const L = mode === 'ledger' ? (lg.data as LedgerW | null) : null;
  const B = mode !== 'ledger' ? (lg.data as unknown as BookW | null) : null;
  return (
    <section data-acct-ledger={mode}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        {(['ledger', 'SALES', 'PURCHASE'] as const).map((m) => <button key={m} className={`btn-sm ${mode === m ? '' : 'btn-plain'}`} onClick={() => setMode(m)} data-acct-ledger-mode={m}>{({ ledger: '계정별 원장', SALES: '매출장', PURCHASE: '매입장' } as Record<string, string>)[m]}</button>)}{' '}
        {mode === 'ledger' && <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="계정">{(acc.data?.accounts ?? []).map((x) => <option key={x.role} value={x.role}>{x.name}</option>)}</select>}{' '}
        <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="시작일" /> ~ <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="끝일" />{' '}
        <button className="btn-sm" disabled={a.busy === 'csv'} onClick={csv} data-acct-ledger-csv="">CSV</button>
      </div>
      {!!lg.error && <p className="warn-text">{String(lg.error)}</p>}
      {L?.rows && (
        <table className="tbl" data-acct-ledger-rows={L.rows.length}><thead><tr><th>일자</th><th>전표</th><th>적요</th><th>거래처</th><th>차변</th><th>대변</th><th>잔액</th></tr></thead>
          <tbody><tr><td>{L.from}</td><td /><td>기초 잔액</td><td /><td /><td /><td>{won(L.opening)}</td></tr>
            {L.rows.map((r, i) => <tr key={i}><td>{r.date}{r.late && <small className="dim"> 늦게</small>}</td><td>{r.entryId}</td><td>{r.memo}</td><td>{r.party}</td><td>{won(r.debit)}</td><td>{won(r.credit)}</td><td>{won(r.balance)}</td></tr>)}
            <tr><th colSpan={4}>합계 · 기말</th><th>{won(L.total.debit)}</th><th>{won(L.total.credit)}</th><th>{won(L.closing)}</th></tr></tbody></table>
      )}
      {B?.parties && (
        <>
          <p data-acct-book-total={B.total.count}>{B.total.count}건 · 공급가 {won(B.total.supply)} · 세액 {won(B.total.vat)}{B.kind === 'SALES' ? ` · 면세 ${won(B.total.exempt)}` : ''} · 합계 {won(B.total.total)}</p>
          <table className="tbl"><thead><tr><th>거래처</th><th>건수</th><th>공급가</th><th>세액</th><th>합계</th></tr></thead>
            <tbody>{B.parties.map((p) => <tr key={p.party}><td>{p.party}</td><td>{p.count}</td><td>{won(p.supply)}</td><td>{won(p.vat)}</td><td>{won(p.total)}</td></tr>)}</tbody></table>
          <details><summary>전표별 {B.items.length}줄</summary>
            <table className="tbl"><thead><tr><th>일자</th><th>전표</th><th>거래처</th><th>공급가</th><th>세액</th>{B.kind === 'PURCHASE' && <th>공제</th>}</tr></thead>
              <tbody>{B.items.map((x) => <tr key={x.entryId}><td>{x.date}</td><td>{x.entryId}</td><td>{x.party}</td><td>{won(x.supply)}</td><td>{won(x.vat)}</td>{B.kind === 'PURCHASE' && <td>{x.deductible ? '공제' : '불공제'}</td>}</tr>)}</tbody></table>
          </details>
          <p className="muted">{B.note}</p>
        </>
      )}
    </section>
  );
}

interface AssetW { id: string; name: string; category: string | null; acquired_on: string; cost: number; residual: number; life_months: number; method: string; state: string; payRole: string;
  purchaseId: string | null; accumulated: number; book: number; next: { ym: string; amount: number } | null; warn: string; disposedOn: string | null }
interface AssetsW { items: AssetW[]; total: { count: number; cost: number; accumulated: number; book: number }; note: string }

export function AcctAssets() {
  const q = useApi<AssetsW>('/admin/acct/assets');
  const a = useAct();
  const blank = { name: '', category: '', acquiredOn: '', cost: '', residual: '0', lifeMonths: '60', method: 'STRAIGHT', payRole: 'AP', purchaseId: '', priorDepr: '0', priorMonths: '0' };
  const [f, setF] = useState(blank);
  const add = () => void a.run('add', () => api('/admin/acct/assets', { method: 'POST', body: JSON.stringify({
    name: f.name, category: f.category, method: f.method, lifeMonths: Number(f.lifeMonths), residual: Number(f.residual) || 0,
    ...(f.purchaseId ? { purchaseId: f.purchaseId } : { acquiredOn: f.acquiredOn, cost: Number(f.cost) || 0, payRole: f.payRole, priorDepr: Number(f.priorDepr) || 0, priorMonths: Number(f.priorMonths) || 0 }) }) }), () => { setF(blank); q.reload(); });
  const dispose = (x: AssetW) => {
    const day = prompt(`${x.name} 처분일(YYYY-MM-DD)`); if (!day) return;
    const amt = prompt('받은 돈(폐기는 0)', '0'); if (amt === null) return;
    const reason = prompt('사유(꼭) — 처분은 되돌리지 않습니다'); if (!reason) return;
    void a.run(`d${x.id}`, () => api(`/admin/acct/assets/${x.id}/dispose`, { method: 'POST', body: JSON.stringify({ disposedOn: day, amount: Number(amt) || 0, reason }) }), q.reload);
  };
  const run = () => void a.run('dep', () => api<{ made: number }>('/admin/acct/assets/depreciate', { method: 'POST' }), q.reload, (r) => `상각 ${r.made}줄을 만들었습니다(전표는 다음 전표 작업에서).`);
  const d = q.data;
  return (
    <section data-acct-assets={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className="warn-text">{d.note}</p>}
      {d && <p>쓰는 자산 {d.total.count} · 취득가 {won(d.total.cost)} · 누계액 {won(d.total.accumulated)} · 장부가 {won(d.total.book)} {isSuper() && <button className="btn-sm btn-plain" disabled={a.busy === 'dep'} onClick={run} data-acct-depreciate="">지금 상각</button>}</p>}
      {d && (
        <table className="tbl"><thead><tr><th>자산</th><th>취득</th><th>취득가</th><th>방법 · 연수</th><th>누계액</th><th>장부가</th><th>다음 상각</th><th /></tr></thead>
          <tbody>{d.items.map((x) => (
            <tr key={x.id} data-acct-asset={x.state}><td>{x.name}{x.purchaseId && <small className="dim"> 매입 {x.purchaseId}</small>}{x.warn && <><br /><small className="warn-text">{x.warn}</small></>}</td>
              <td>{x.acquired_on}</td><td>{won(x.cost)}</td><td>{x.method === 'DECLINING' ? '정률' : '정액'} · {x.life_months}달</td><td>{won(x.accumulated)}</td><td>{won(x.book)}</td>
              <td>{x.state === 'DISPOSED' ? `처분 ${x.disposedOn}` : x.next ? `${x.next.ym} ${won(x.next.amount)}` : '끝'}</td>
              <td>{isSuper() && x.state === 'ACTIVE' && <button className="btn-sm btn-plain" disabled={a.busy === `d${x.id}`} onClick={() => dispose(x)} data-acct-asset-dispose={x.id}>처분</button>}</td></tr>))}</tbody></table>
      )}
      {isSuper() && (
        <div className="card pad" data-acct-asset-add="">
          <b>고정자산 넣기</b> <small className="dim">매입 번호를 넣으면 날짜 · 금액은 매입 값</small><br />
          <input value={f.purchaseId} onChange={(e) => setF({ ...f, purchaseId: e.target.value.replace(/\D/g, '') })} placeholder="⑫ 매입 번호(선택)" size={12} />{' '}
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름" size={14} />{' '}
          {!f.purchaseId && <><input type="date" value={f.acquiredOn} onChange={(e) => setF({ ...f, acquiredOn: e.target.value })} aria-label="취득일" />{' '}
            <input value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/\D/g, '') })} placeholder="취득가" size={10} inputMode="numeric" />{' '}
            <select value={f.payRole} onChange={(e) => setF({ ...f, payRole: e.target.value })} aria-label="낸 방법"><option value="AP">미지급금</option><option value="CASH">보통예금</option><option value="NONE">기초 잔액에 있음</option></select>{' '}</>}
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} aria-label="방법"><option value="STRAIGHT">정액</option><option value="DECLINING">정률</option></select>{' '}
          <input value={f.lifeMonths} onChange={(e) => setF({ ...f, lifeMonths: e.target.value.replace(/\D/g, '') })} size={4} aria-label="내용연수(달)" />달{' '}
          <input value={f.residual} onChange={(e) => setF({ ...f, residual: e.target.value.replace(/\D/g, '') })} size={8} aria-label="잔존가치" placeholder="잔존" />{' '}
          <button className="btn-sm" disabled={a.busy === 'add' || !f.lifeMonths || (!f.purchaseId && (!f.name || !f.acquiredOn || !f.cost))} onClick={add}>넣기</button>
        </div>
      )}
    </section>
  );
}

interface BudgetW { ym: string; items: Array<{ role: string; name: string; kind: string; budget: number | null; actual: number; diff: number | null; pct: number | null; over: boolean; short: boolean }>;
  total: { expenseBudget: number; expenseActual: number; overCount: number }; note: string }

export function AcctBudget() {
  const [ym, setYm] = useState(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7));
  const q = useApi<BudgetW>(`/admin/acct/budget?ym=${ym}`);
  const a = useAct();
  const [ed, setEd] = useState<Record<string, string>>({});
  const prev = (() => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`; })();
  const items = Object.entries(ed).map(([role, v]) => ({ role, amount: Number(v.replace(/\D/g, '')) || 0 }));
  const save = (copy?: boolean) => {
    const reason = prompt(copy ? `${prev} 예산을 ${ym} 로 옮깁니다(이미 넣은 계정은 그대로). 사유` : `${ym} 예산 ${items.length}줄을 저장합니다. 사유`);
    if (reason) void a.run('save', () => api('/admin/acct/budget', { method: 'PUT', body: JSON.stringify({ ym, reason, ...(copy ? { copyFrom: prev, items: [] } : { items }) }) }), () => { setEd({}); q.reload(); });
  };
  const d = q.data;
  return (
    <section data-acct-budget={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts"><label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        {isSuper() && <><button className="btn-sm btn-plain" disabled={a.busy === 'save'} onClick={() => save(true)} data-acct-budget-copy="">지난달 예산 옮기기</button>{' '}
          <button className="btn-sm" disabled={a.busy === 'save' || !items.length} onClick={() => save()} data-acct-budget-save="">저장</button></>}</div>
      {d && <p>비용 예산 {won(d.total.expenseBudget)} · 실적 {won(d.total.expenseActual)}{d.total.overCount > 0 && <b className="warn-text"> · 넘은 계정 {d.total.overCount}</b>}</p>}
      {d && (
        <table className="tbl"><thead><tr><th>계정</th><th>예산</th><th>실적</th><th>차이</th><th>쓴 비율</th></tr></thead>
          <tbody>{d.items.map((x) => (
            <tr key={x.role} data-acct-budget-row={x.over ? 'over' : 'ok'}><td>{x.name} <small className="dim">{x.kind === 'REVENUE' ? '매출' : '비용'}</small></td>
              <td>{isSuper() ? <input value={ed[x.role] ?? (x.budget ?? '')} onChange={(e) => setEd({ ...ed, [x.role]: e.target.value })} size={10} inputMode="numeric" aria-label={`${x.name} 예산`} /> : won(x.budget)}</td>
              <td>{won(x.actual)}</td><td className={x.over ? 'warn-text' : ''}>{won(x.diff)}</td><td>{x.pct == null ? '—' : `${x.pct}%`}</td></tr>))}</tbody></table>
      )}
      {d && <p className="muted">{d.note}</p>}
    </section>
  );
}

/* ── v10.400 부가세 신고서 미리보기 ── */
interface VatForm { q: string; label: string; from: string; to: string; final: boolean; exempt: number; payable: number; efile: number; due: number; note: string;
  lines: Array<{ no: string; group: string; label: string; supply: number; vat: number }> }
export function AcctVatForm() {
  const k = new Date(Date.now() + 9 * 3600e3);
  const [qv, setQv] = useState(`${k.getUTCFullYear()}-${Math.floor(k.getUTCMonth() / 3) + 1}`);
  const q = useApi<VatForm>(`/admin/acct/tax/vat-form?q=${qv}`);
  const a = useAct();
  const dl = () => void a.run('dlvf', async () => {
    const t = await exportTicket('ACCT_TAX');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ filename: string; csv: string; rows: number }>(`/admin/acct/tax/vat-form/export?q=${qv}&ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => `${r?.rows ?? 0}줄을 내려받았습니다.`);
  const d = q.data;
  return (
    <section data-acct-vatform={d?.lines.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <select value={qv} onChange={(e) => setQv(e.target.value)} aria-label="분기">
          {[0, 1, 2, 3, 4, 5].map((i) => { const x = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - i * 3, 1)); const s = `${x.getUTCFullYear()}-${Math.floor(x.getUTCMonth() / 3) + 1}`; return <option key={s} value={s}>{s.replace('-', '년 ')}분기</option>; })}
        </select>{' '}
        <button className="btn-sm" disabled={a.busy === 'dlvf'} onClick={dl} data-acct-vatform-csv="">CSV</button>{' '}
        {d && <b>{d.label}</b>} {d && <small className="dim">{d.from} ~ {d.to}</small>}
      </p>
      {d && (
        <>
          <table className="tbl"><thead><tr><th>칸</th><th>나눔</th><th>항목</th><th className="num">금액(공급가)</th><th className="num">세액</th></tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.no + l.label} data-vatform-line={l.no} className={['9', '15', '마'].includes(l.no) ? 'strong' : undefined}>
                <td>{l.no}</td><td>{l.group}</td><td>{l.label}</td><td className="num">{l.group === '납부' ? '' : won(l.supply)}</td><td className="num">{won(l.vat)}</td></tr>))}</tbody></table>
          <p>면세 수입금액(소개몰 면세 상품) {won(d.exempt)} · <b data-acct-vat-due="">{d.due >= 0 ? `납부할 세액 ${won(d.due)}` : `환급 예상 ${won(-d.due)}`}</b></p>
          <p className="warn-text">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.401 기간 분석 ── */
interface AgingT { asOf: string; overDays: number; alertOn: boolean; note: string;
  rows: Array<{ role: string; roleKo: string; party: string; open: number; b30: number; b60: number; b90: number; over: number; oldest: string | null; oldestDays: number }>;
  total: Record<string, { open: number; b30: number; b60: number; b90: number; over: number; parties: number }> }
export function AcctAging() {
  const [asOf, setAsOf] = useState('');
  const q = useApi<AgingT>(`/admin/acct/aging${asOf ? `?asOf=${asOf}` : ''}`);
  const d = q.data;
  const ROLE: Record<string, string> = { AR: '받을 돈(외상매출금)', AP: '갚을 돈(미지급금)', CARD_AP: '법인카드 미지급금' };
  return (
    <section data-acct-aging={d?.rows.length ?? ''}>
      <p>기준일 <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="기준일" /> {d && <small className="dim">{d.asOf} 까지 전표 · 알림 {d.alertOn ? `켜짐(${d.overDays}일 넘음)` : '꺼짐'}</small>}</p>
      {d && (
        <>
          <table className="tbl"><thead><tr><th>계정</th><th className="num">남은 돈</th><th className="num">30일 안</th><th className="num">31 ~ 60</th><th className="num">61 ~ {d.overDays}</th><th className="num">{d.overDays}일 넘음</th><th>거래처</th></tr></thead>
            <tbody>{Object.entries(d.total).map(([r, t]) => (
              <tr key={r} data-aging-total={r}><td>{ROLE[r] ?? r}</td><td className="num">{won(t.open)}</td><td className="num">{won(t.b30)}</td><td className="num">{won(t.b60)}</td><td className="num">{won(t.b90)}</td>
                <td className="num">{t.over ? <b className="warn-text">{won(t.over)}</b> : won(0)}</td><td>{t.parties}곳</td></tr>))}</tbody></table>
          <h3>거래처별</h3>
          {d.rows.length === 0 ? <p className="muted">남은 받을 돈 · 갚을 돈이 없습니다.</p> : (
            <table className="tbl"><thead><tr><th>계정</th><th>거래처</th><th className="num">남은 돈</th><th className="num">30일 안</th><th className="num">31 ~ 60</th><th className="num">61 ~ {d.overDays}</th><th className="num">넘음</th><th>가장 오래된 날</th></tr></thead>
              <tbody>{d.rows.map((x) => (
                <tr key={x.role + x.party} data-aging-row={x.role}><td>{x.roleKo}</td><td>{x.party}</td><td className="num">{won(x.open)}</td><td className="num">{won(x.b30)}</td><td className="num">{won(x.b60)}</td><td className="num">{won(x.b90)}</td>
                  <td className="num">{x.over ? <b className="warn-text">{won(x.over)}</b> : ''}</td><td>{x.oldest} <small className="dim">{x.oldestDays}일</small></td></tr>))}</tbody></table>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.402 해 마감 ── */
interface YearT { canEdit: boolean; note: string;
  years: Array<{ year: number; months: number; monthsClosed: number; missing: string[]; ended: boolean; closed: boolean; revenue: number; expense: number; netIncome: number;
    history: Array<{ id: string; action: string; netIncome: number | null; entryId: string | null; reason: string | null; createdAt: string; actor: string | null }> }> }
export function AcctYearClose() {
  const q = useApi<YearT>('/admin/acct/year-closings');
  const a = useAct();
  const close = (year: number) => {
    if (!confirm(`${year}년을 마감합니다 — 수익 · 비용을 이월이익잉여금으로 넘기고 ${year}년 날짜로는 전표를 넣을 수 없게 됩니다.`)) return;
    void a.run(`c${year}`, () => api<{ note: string }>('/admin/acct/year-closings', { method: 'POST', body: JSON.stringify({ year }) }), q.reload, (r) => r.note);
  };
  const reopen = (year: number) => {
    const reason = prompt(`${year}년 해 마감을 풉니다(마감 전표의 반대 전표). 사유를 적으십시오.`);
    if (reason) void a.run(`r${year}`, () => api<{ note: string }>(`/admin/acct/year-closings/${year}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload, (r) => r.note);
  };
  return (
    <section data-acct-yearclose={q.data?.years.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {q.data && (
        <>
          <table className="tbl"><thead><tr><th>해</th><th>월 마감</th><th className="num">수익</th><th className="num">비용</th><th className="num">순이익</th><th>상태</th><th /></tr></thead>
            <tbody>{q.data.years.map((y) => (
              <tr key={y.year} data-year={y.year} data-year-closed={y.closed ? '1' : '0'}>
                <td>{y.year}</td><td>{y.monthsClosed} / {y.months}{y.missing.length > 0 && <small className="dim"> 남음 {y.missing.join(' · ')}</small>}</td>
                <td className="num">{won(y.revenue)}</td><td className="num">{won(y.expense)}</td><td className="num"><b>{won(y.netIncome)}</b></td>
                <td>{y.closed ? <b>마감함</b> : !y.ended ? '해가 끝나지 않음' : y.missing.length ? '월 마감 먼저' : '마감할 수 있음'}</td>
                <td>{q.data!.canEdit && (y.closed
                  ? <button className="btn-sm btn-plain" disabled={a.busy === `r${y.year}`} onClick={() => reopen(y.year)} data-year-reopen={y.year}>풀기</button>
                  : <button className="btn-sm" disabled={!y.ended || y.missing.length > 0 || a.busy === `c${y.year}`} onClick={() => close(y.year)} data-year-close={y.year}>해 마감</button>)}</td>
              </tr>))}</tbody></table>
          {q.data.years.some((y) => y.history.length) && (
            <details><summary>마감 · 풀기 기록</summary>
              <table className="tbl"><thead><tr><th>때</th><th>해</th><th>무엇</th><th className="num">순이익</th><th>사유</th><th>누가</th></tr></thead>
                <tbody>{q.data.years.flatMap((y) => y.history.map((h) => (
                  <tr key={h.id}><td>{ymdhm(h.createdAt)}</td><td>{y.year}</td><td>{h.action === 'CLOSE' ? '마감' : '풀기'}</td><td className="num">{h.netIncome == null ? '' : won(h.netIncome)}</td><td>{h.reason ?? ''}</td><td>{h.actor ?? ''}</td></tr>)))}</tbody></table>
            </details>
          )}
          <p className="muted">{q.data.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.403 급여 ── */
interface Emp { id: string; name: string; joinedOn: string; leftOn: string | null; monthlyBase: number; nontax: number; dependents: number; memo: string | null; active: boolean }
interface PayLine { id: string; employeeId: string; name: string; dependents: number; gross: number; nontax: number; incomeTax: number; localTax: number; np: number; hi: number; ltc: number; ei: number; net: number;
  companyNp: number; companyHi: number; companyLtc: number; companyEi: number; whtMissing: boolean }
interface PayT { ym: string; run: { id: string; state: 'DRAFT' | 'FIXED' | 'PAID'; payDay: string; fixedAt: string | null; paidAt: string | null } | null; lines: PayLine[];
  total: { gross: number; incomeTax: number; localTax: number; employeeIns: number; companyIns: number; net: number; people: number };
  rates: { year: number; draft: boolean; missing: string[]; whtRows: number; rows: Array<{ year: number; key: string; value: number; draft: boolean; label: string }> }; note: string }
export function AcctPayroll() {
  const [ym, setYm] = useState(kstYm());
  const p = useApi<PayT>(`/admin/acct/payroll?ym=${ym}`);
  const e = useApi<{ items: Emp[]; canEdit: boolean; note: string }>('/admin/acct/employees');
  const a = useAct();
  const sup = isSuper();
  const [f, setF] = useState({ name: '', joinedOn: '', monthlyBase: '', nontax: '200000', dependents: '1' });
  const addEmp = () => void a.run('emp', () => api<{ note: string }>('/admin/acct/employees', { method: 'POST', body: JSON.stringify({ name: f.name, joinedOn: f.joinedOn, monthlyBase: Number(f.monthlyBase), nontax: Number(f.nontax || 0), dependents: Number(f.dependents || 1) }) }),
    () => { setF({ name: '', joinedOn: '', monthlyBase: '', nontax: '200000', dependents: '1' }); e.reload(); }, (r) => r.note);
  const leave = (x: Emp) => {
    const d = prompt(`${x.name} 퇴사일(YYYY-MM-DD)`, kstYm() + '-28');
    if (d) void a.run(`l${x.id}`, () => api<{ note: string }>(`/admin/acct/employees/${x.id}`, { method: 'PATCH', body: JSON.stringify({ leftOn: d }) }), e.reload, (r) => r.note);
  };
  const create = () => void a.run('run', () => api<{ note: string }>('/admin/acct/payroll/runs', { method: 'POST', body: JSON.stringify({ ym }) }), p.reload, (r) => r.note);
  const editGross = (l: PayLine) => {
    const v = prompt(`${l.name} 지급액(원)`, String(l.gross));
    if (v && /^\d+$/.test(v)) void a.run(`g${l.id}`, () => api<{ note: string }>(`/admin/acct/payroll/lines/${l.id}`, { method: 'PATCH', body: JSON.stringify({ gross: Number(v) }) }), p.reload, (r) => r.note);
  };
  const fix = () => { if (p.data?.run && confirm(`${ym} 급여를 확정합니다 — 줄을 더 고칠 수 없고 급여 전표가 생깁니다.`)) void a.run('fix', () => api<{ note: string }>(`/admin/acct/payroll/runs/${p.data!.run!.id}/fix`, { method: 'POST' }), p.reload, (r) => r.note); };
  const paid = () => { if (p.data?.run && confirm(`${ym} 급여를 지급 처리합니다(통장 출금 뒤).`)) void a.run('paid', () => api<{ note: string }>(`/admin/acct/payroll/runs/${p.data!.run!.id}/paid`, { method: 'POST' }), p.reload, (r) => r.note); };
  const year = Number(ym.slice(0, 4));
  const setRate = (key: string, cur: number) => {
    const v = prompt(`${year}년 ${key} 값(현재 ${cur})`, String(cur)); if (v == null || !/^\d+(\.\d+)?$/.test(v)) return;
    const reason = prompt('사유(예: 공단 고시)'); if (!reason) return;
    void a.run(`rt${key}`, () => api<{ note: string }>('/admin/acct/payroll/rates', { method: 'POST', body: JSON.stringify({ year, key, value: Number(v), reason }) }), p.reload, (r) => r.note);
  };
  const upWht = async (fl: File) => {
    const buf = await fl.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf); if (text.includes('\uFFFD')) text = new TextDecoder('euc-kr').decode(buf);
    const reason = prompt(`${year}년 간이세액표를 바꿉니다(그 해 전체). 사유를 적으십시오.`); if (!reason) return;
    if (text.length > 95000) { a.setErr('파일이 큽니다(95,000자까지) — 나눠 올리십시오(두 번째부터 이어 넣기).'); return; }
    void a.run('wht', () => api<{ note: string }>('/admin/acct/payroll/wht-table', { method: 'POST', body: JSON.stringify({ year, csv: text, unit: 'THOUSAND', reason }) }), p.reload, (r) => r.note);
  };
  const d = p.data;
  return (
    <section data-acct-payroll={d?.lines.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><input type="month" value={ym} onChange={(x) => setYm(x.target.value)} aria-label="달" />{' '}
        {d?.run ? <b data-payroll-state={d.run.state}>{({ DRAFT: '초안', FIXED: '확정', PAID: '지급함' } as Record<string, string>)[d.run.state]} · 지급일 {d.run.payDay}</b> : <span className="muted">이 달 급여 대장이 없습니다.</span>}{' '}
        {sup && !d?.run && <button className="btn-sm" disabled={a.busy === 'run'} onClick={create} data-payroll-create="">급여 대장 만들기</button>}
        {sup && d?.run?.state === 'DRAFT' && <button className="btn-sm" disabled={a.busy === 'fix'} onClick={fix} data-payroll-fix="">확정</button>}
        {d?.run?.state === 'FIXED' && <button className="btn-sm" disabled={a.busy === 'paid'} onClick={paid} data-payroll-paid="">지급 처리</button>}
      </p>
      {d && (d.rates.draft || d.rates.missing.length > 0 || d.rates.whtRows === 0) && (
        <p className="warn-text" data-payroll-rate-warn="">{d.rates.year}년 요율 {d.rates.draft ? '초안(공단 고시로 확인 필요)' : ''}{d.rates.missing.length ? ` · 빠진 요율 ${d.rates.missing.join(', ')}` : ''}{d.rates.whtRows === 0 ? ' · 간이세액표 없음(소득세 0 으로 셈 — 국세청 표를 올리십시오)' : ''}</p>
      )}
      {d && d.lines.length > 0 && (
        <table className="tbl"><thead><tr><th>직원</th><th className="num">지급액</th><th className="num">비과세</th><th className="num">소득세</th><th className="num">지방소득세</th><th className="num">국민연금</th><th className="num">건강</th><th className="num">장기요양</th><th className="num">고용</th><th className="num">실지급</th><th className="num">회사 4대보험</th></tr></thead>
          <tbody>{d.lines.map((l) => (
            <tr key={l.id} data-payroll-line={l.employeeId}>
              <td>{l.name} <small className="dim">가족 {l.dependents}</small></td>
              <td className="num">{sup && d.run?.state === 'DRAFT' ? <button className="btn-sm btn-plain" onClick={() => editGross(l)} data-payroll-gross={l.id}>{won(l.gross)}</button> : won(l.gross)}</td>
              <td className="num">{won(l.nontax)}</td><td className="num">{won(l.incomeTax)}{l.whtMissing && <small className="warn-text"> 표 없음</small>}</td><td className="num">{won(l.localTax)}</td>
              <td className="num">{won(l.np)}</td><td className="num">{won(l.hi)}</td><td className="num">{won(l.ltc)}</td><td className="num">{won(l.ei)}</td><td className="num"><b>{won(l.net)}</b></td>
              <td className="num">{won(l.companyNp + l.companyHi + l.companyLtc + l.companyEi)}</td></tr>))}
            <tr className="strong"><td>합계 {d.total.people}명</td><td className="num">{won(d.total.gross)}</td><td /><td className="num">{won(d.total.incomeTax)}</td><td className="num">{won(d.total.localTax)}</td>
              <td className="num" colSpan={4}>{won(d.total.employeeIns)}</td><td className="num"><b>{won(d.total.net)}</b></td><td className="num">{won(d.total.companyIns)}</td></tr></tbody></table>
      )}
      {d && <p className="muted">{d.note}</p>}
      <h3>직원</h3>
      {e.data && (
        <table className="tbl" data-acct-employees={e.data.items.length}><thead><tr><th>이름</th><th>입사</th><th>퇴사</th><th className="num">월 기본급</th><th className="num">비과세</th><th>가족</th><th /></tr></thead>
          <tbody>{e.data.items.map((x) => (
            <tr key={x.id} className={x.active ? undefined : 'dim'}><td>{x.name}</td><td>{x.joinedOn}</td><td>{x.leftOn ?? ''}</td><td className="num">{won(x.monthlyBase)}</td><td className="num">{won(x.nontax)}</td><td>{x.dependents}</td>
              <td>{e.data!.canEdit && !x.leftOn && <button className="btn-sm btn-plain" onClick={() => leave(x)}>퇴사</button>}</td></tr>))}</tbody></table>
      )}
      {e.data?.canEdit && (
        <p data-acct-employee-add="">
          <input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} placeholder="이름" size={8} />{' '}
          <input type="date" value={f.joinedOn} onChange={(x) => setF({ ...f, joinedOn: x.target.value })} aria-label="입사일" />{' '}
          <input value={f.monthlyBase} onChange={(x) => setF({ ...f, monthlyBase: x.target.value.replace(/\D/g, '') })} placeholder="월 기본급" size={9} />{' '}
          <input value={f.nontax} onChange={(x) => setF({ ...f, nontax: x.target.value.replace(/\D/g, '') })} placeholder="비과세" size={7} aria-label="비과세" />{' '}
          <input value={f.dependents} onChange={(x) => setF({ ...f, dependents: x.target.value.replace(/\D/g, '') })} size={2} aria-label="부양가족 수" />{' '}
          <button className="btn-sm" disabled={!f.name.trim() || !f.joinedOn || !f.monthlyBase || a.busy === 'emp'} onClick={addEmp}>직원 넣기</button>
        </p>
      )}
      {e.data && <p className="muted">{e.data.note}</p>}
      {d && (
        <details><summary>{d.rates.year}년 요율 · 간이세액표 {d.rates.whtRows}줄</summary>
          <table className="tbl"><tbody>{d.rates.rows.map((r) => <tr key={r.key} data-payroll-rate={r.key}><td>{r.label}</td><td className="num">{r.value}</td><td>{r.year}년{r.draft && <small className="warn-text"> 초안</small>}</td>
            <td>{sup && <button className="btn-sm btn-plain" onClick={() => setRate(r.key, r.value)}>고치기</button>}</td></tr>)}</tbody></table>
          {sup && <p>간이세액표 CSV(국세청 · 이상 · 미만 칸은 천원) <input type="file" accept=".csv,text/csv" onChange={(x) => { const fl = x.target.files?.[0]; if (fl) upWht(fl); x.target.value = ''; }} data-payroll-wht-upload="" /></p>}
        </details>
      )}
    </section>
  );
}

interface PgCand { entryId: string; date: string; source: string; memo: string | null; party: string | null; amount: number }
interface PgTxn { id: string; paidOn: string; settleOn: string; gross: number; fee: number; feeVat: number; net: number; key: string | null; method: string | null;
  matchKind: string | null; entryId: string | null; matchNote: string | null; booked: boolean; candidates: PgCand[] }
interface PgMonth { ym: string; days: number; items: PgTxn[]; unsettled: Array<{ entryId: string; date: string; source: string; memo: string | null; amount: number; days: number }>;
  total: { rows: number; gross: number; fee: number; feeVat: number; net: number };
  count: { total: number; matched: number; ignored: number; open: number; booked: number; unsettled: number; autoReady: number }; note: string }

/** v10.404 — PG 정산 맞추기 */
export function AcctPg() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<PgMonth>(`/admin/acct/pg?ym=${ym}`);
  const a = useAct();
  const [pick, setPick] = useState<Record<string, string>>({});
  const upload = (f: File | undefined) => f && void a.run('up', async () => {
    const csv = await readText(f);
    return api<{ note: string }>('/admin/acct/pg/upload', { method: 'POST', body: JSON.stringify({ csv, filename: f.name }) });
  }, q.reload, (r) => r.note);
  const match = (id: string, b: Record<string, unknown>) => void a.run(`m${id}`, () => api<{ note: string }>(`/admin/acct/pg/${id}/match`, { method: 'POST', body: JSON.stringify(b) }), q.reload, (r) => r.note);
  const ignore = (id: string) => { const note = prompt('맞출 것 없음 — 사유(예: 회계 시작일 전 결제 · 시험 결제)'); if (note) match(id, { ignore: true, note }); };
  const clear = (id: string) => { const note = prompt('맞춤을 풉니다 — 사유'); if (note) match(id, { clear: true, note }); };
  const auto = () => void a.run('auto', () => api<{ note: string }>('/admin/acct/pg/auto-match', { method: 'POST' }), q.reload, (r) => r.note);
  const d = q.data;
  return (
    <section data-acct-pg={d?.count.total ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <label>정산 달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        <button className="btn-sm btn-plain" onClick={() => setYm(prevYm(ym))}>지난달</button>{' '}
        <label className="btn-sm">PG 정산 내역 CSV 올리기 <input type="file" accept=".csv,.txt,text/csv" hidden disabled={a.busy === 'up'} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} data-acct-pg-file="" /></label>{' '}
        <button className="btn-sm" disabled={a.busy === 'auto' || !d?.count.autoReady} onClick={auto} data-acct-pg-auto="">자동 맞춤{d?.count.autoReady ? ` ${d.count.autoReady}` : ''}</button>
      </div>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p data-acct-pg-count="">정산 줄 <b>{d.count.total}</b> · 맞춤 {d.count.matched} · 맞출 것 없음 {d.count.ignored} · <b className={d.count.open ? 'warn-text' : ''}>남음 {d.count.open}</b> · 전표 {d.count.booked}
            {' '}· 결제 {won(d.total.gross)} · 수수료 {won(d.total.fee)}(부가세 {won(d.total.feeVat)}) · 입금 {won(d.total.net)}</p>
          {d.count.unsettled > 0 && <p className="warn-text" data-acct-pg-unsettled={d.count.unsettled}>PG 정산이 안 들어온 결제 {d.count.unsettled}건({d.unsettled[0]?.days}일 넘음) — 가장 오래된 것 {d.unsettled[0]?.date} 전표 {d.unsettled[0]?.entryId}</p>}
          <p className="muted">{d.note}</p>
          {d.items.length > 0 && (
            <table className="tbl" data-acct-pg-rows={d.items.length}><thead><tr><th>결제일</th><th>정산일</th><th>결제</th><th>수수료</th><th>입금</th><th>거래 번호</th><th>맞춤</th></tr></thead>
              <tbody>{d.items.map((t) => (
                <tr key={t.id} data-acct-pg-row={t.matchKind ?? 'open'}>
                  <td>{t.paidOn}</td><td>{t.settleOn}</td><td>{won(t.gross)}</td><td>{won(t.fee)}</td><td>{won(t.net)}</td><td><small>{t.key ?? ''} {t.method ?? ''}</small></td>
                  <td>{t.matchKind === 'ENTRY' ? <>전표 {t.entryId} {t.booked ? <small className="dim">정산 전표 있음</small> : <button className="btn-sm btn-plain" onClick={() => clear(t.id)}>풀기</button>}</>
                    : t.matchKind === 'IGNORE' ? <>맞출 것 없음 <small className="dim">{t.matchNote}</small> <button className="btn-sm btn-plain" onClick={() => clear(t.id)}>풀기</button></>
                    : <>
                      {t.candidates.length > 0 ? (
                        <select value={pick[t.id] ?? t.candidates[0]!.entryId} onChange={(e) => setPick({ ...pick, [t.id]: e.target.value })} aria-label="후보 전표" data-acct-pg-cand={t.candidates.length}>
                          {t.candidates.map((c) => <option key={c.entryId} value={c.entryId}>{c.date} 전표 {c.entryId} · {c.memo ?? c.source}</option>)}
                        </select>) : <small className="dim">후보 없음 </small>}{' '}
                      {t.candidates.length > 0 && <button className="btn-sm" disabled={a.busy === `m${t.id}`} onClick={() => match(t.id, { entryId: pick[t.id] ?? t.candidates[0]!.entryId })}>맞춤</button>}{' '}
                      <button className="btn-sm btn-plain" onClick={() => ignore(t.id)}>맞출 것 없음</button>
                    </>}</td>
                </tr>))}</tbody></table>
          )}
        </>
      )}
    </section>
  );
}

interface MLine { role: string; debit: number; credit: number; memo?: string | null }
interface Manual { items: Array<{ id: string; entryDate: string; memo: string; party: string | null; evidence: string; lines: MLine[]; total: number; state: string; createdBy: string;
  createdByEmail: string | null; createdAt: string; decidedByEmail: string | null; decidedAt: string | null; decideNote: string | null; entryId: string | null }>; waiting: number; note: string }
const M_STATE: Record<string, string> = { REQUESTED: '승인 기다림', APPROVED: '승인(장부)', REJECTED: '반려', CANCELED: '취소' };

/** v10.405 — 수동 전표 쓰기 · 결재 */
export function AcctManual() {
  const q = useApi<Manual>('/admin/acct/manual');
  const acc = useApi<{ accounts: Array<{ role: string; name: string; kind: string; extCode: string | null }> }>('/admin/acct/accounts');
  const a = useAct();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const blank = () => ({ entryDate: today, memo: '', party: '', evidence: 'NONE', lines: [{ role: '', debit: 0, credit: 0 }, { role: '', debit: 0, credit: 0 }] as MLine[] });
  const [f, setF] = useState(blank());
  const dSum = f.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), cSum = f.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const okForm = f.memo.trim().length >= 2 && f.lines.length >= 2 && f.lines.every((l) => l.role && ((l.debit > 0) !== (l.credit > 0))) && dSum === cSum && dSum > 0;
  const setLine = (i: number, p: Partial<MLine>) => setF({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const submit = () => void a.run('add', () => api<{ note: string }>('/admin/acct/manual', { method: 'POST', body: JSON.stringify({ ...f, party: f.party || undefined }) }), () => { setF(blank()); q.reload(); });
  const decide = (id: string, approve: boolean) => {
    const note = approve ? (prompt('승인 메모(선택)') ?? '') : prompt('반려 사유(2자 이상)');
    if (!approve && !note) return;
    void a.run(`d${id}`, () => api<{ note: string }>(`/admin/acct/manual/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve, note }) }), q.reload, (r) => r.note);
  };
  const cancel = (id: string) => confirm('이 요청을 취소합니까?') && void a.run(`c${id}`, () => api<{ note: string }>(`/admin/acct/manual/${id}/cancel`, { method: 'POST' }), q.reload, (r) => r.note);
  const names: Record<string, string> = Object.fromEntries((acc.data?.accounts ?? []).map((x) => [x.role, x.name]));
  return (
    <section data-acct-manual={q.data?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-acct-manual-form="">
        <b>수동 전표 쓰기</b> <small className="dim">요청 → 쓴 사람이 아닌 SUPER 승인 → 장부 · 마감한 달 · 해는 안 됨</small><br />
        <input type="date" value={f.entryDate} onChange={(e) => setF({ ...f, entryDate: e.target.value })} aria-label="전표 날짜" />{' '}
        <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="적요(예: 11월 사무실 임대료)" size={28} />{' '}
        <input value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} placeholder="거래처(선택)" size={14} />{' '}
        <select value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} aria-label="증빙">
          {['NONE', 'TAX_INVOICE', 'CARD', 'CASH', 'SIMPLE', 'CARD_PG'].map((k) => <option key={k} value={k}>{({ NONE: '증빙 없음', TAX_INVOICE: '세금계산서', CARD: '법인카드', CASH: '현금영수증', SIMPLE: '간이영수증', CARD_PG: '카드 · PG' } as Record<string, string>)[k]}</option>)}
        </select>
        <table className="tbl"><thead><tr><th>계정</th><th>차변</th><th>대변</th><th>줄 메모</th><th /></tr></thead>
          <tbody>{f.lines.map((l, i) => (
            <tr key={i} data-acct-manual-line={i}>
              <td><select value={l.role} onChange={(e) => setLine(i, { role: e.target.value })} aria-label={`${i + 1}번째 줄 계정`}>
                <option value="">계정 고르기</option>
                {(acc.data?.accounts ?? []).map((x) => <option key={x.role} value={x.role}>{x.name}{x.extCode ? ` (${x.extCode})` : ''}</option>)}
              </select></td>
              <td><input type="number" min={0} value={l.debit || ''} onChange={(e) => setLine(i, { debit: Math.max(0, Math.floor(Number(e.target.value) || 0)), credit: 0 })} size={10} aria-label="차변" /></td>
              <td><input type="number" min={0} value={l.credit || ''} onChange={(e) => setLine(i, { credit: Math.max(0, Math.floor(Number(e.target.value) || 0)), debit: 0 })} size={10} aria-label="대변" /></td>
              <td><input value={l.memo ?? ''} onChange={(e) => setLine(i, { memo: e.target.value })} size={14} /></td>
              <td>{f.lines.length > 2 && <button className="btn-sm btn-plain" onClick={() => setF({ ...f, lines: f.lines.filter((_x, k) => k !== i) })}>빼기</button>}</td>
            </tr>))}</tbody></table>
        <button className="btn-sm btn-plain" disabled={f.lines.length >= 30} onClick={() => setF({ ...f, lines: [...f.lines, { role: '', debit: 0, credit: 0 }] })}>줄 더하기</button>{' '}
        <span data-acct-manual-sum={dSum === cSum ? 'ok' : 'diff'} className={dSum === cSum ? '' : 'warn-text'}>차변 {won(dSum)} · 대변 {won(cSum)}{dSum !== cSum ? ` · 차이 ${won(dSum - cSum)}` : ''}</span>{' '}
        <button className="btn-sm" disabled={!okForm || a.busy === 'add'} onClick={submit} data-acct-manual-submit="">요청 올리기</button>
      </div>
      {q.data && (
        <>
          <p className="muted">승인 기다림 <b>{q.data.waiting}</b> · {q.data.note}</p>
          <table className="tbl" data-acct-manual-rows={q.data.items.length}><thead><tr><th>번호</th><th>날짜</th><th>적요</th><th>줄</th><th>금액</th><th>상태</th><th>쓴 사람</th><th /></tr></thead>
            <tbody>{q.data.items.map((m) => (
              <tr key={m.id} data-acct-manual-row={m.state}>
                <td>{m.id}</td><td>{m.entryDate}</td><td>{m.memo} <small className="dim">{m.party ?? ''}</small></td>
                <td><small>{m.lines.map((l) => `${names[l.role] ?? l.role} ${l.debit ? `차 ${won(l.debit)}` : `대 ${won(l.credit)}`}`).join(' · ')}</small></td>
                <td>{won(m.total)}</td>
                <td>{M_STATE[m.state] ?? m.state}{m.entryId && <small className="dim"> 전표 {m.entryId}</small>}{m.decideNote && <small className="dim"> · {m.decideNote}</small>}</td>
                <td><small>{m.createdByEmail ?? ''} {ymdhm(m.createdAt)}</small></td>
                <td>{m.state === 'REQUESTED' && <>
                  {isSuper() && <><button className="btn-sm" disabled={a.busy === `d${m.id}`} onClick={() => decide(m.id, true)} data-acct-manual-approve={m.id}>승인</button>{' '}
                    <button className="btn-sm btn-plain" disabled={a.busy === `d${m.id}`} onClick={() => decide(m.id, false)}>반려</button>{' '}</>}
                  <button className="btn-sm btn-plain" onClick={() => cancel(m.id)}>취소</button></>}</td>
              </tr>))}</tbody></table>
        </>
      )}
    </section>
  );
}

interface Sev { ym: string; asOf: string; rows: Array<{ employeeId: string; name: string; joinedOn: string; serviceDays: number; eligible: boolean; dailyAvg: number; estimate: number; basis: string }>;
  total: number; allTotal: number; book: number; diff: number; done: { id: string; estimate: number; diff: number; entryId: string | null; createdAt: string } | null; hasEmployees: boolean; note: string }
interface Leave { year: number; rows: Array<{ employeeId: string; name: string; joinedOn: string; granted: number; used: number; remaining: number; suggest: number }>;
  recent: Array<{ kind: string; id: string; employeeId: string; day: string; days: number; note: string | null; createdAt: string }>; hasEmployees: boolean; note: string }

/** v10.406 — 퇴직금 추계 · 연차 대장 */
export function AcctSeverance() {
  const [ym, setYm] = useState(prevYm(kstYm()));
  const [year, setYear] = useState(Number(kstYm().slice(0, 4)));
  const s = useApi<Sev>(`/admin/acct/severance?ym=${ym}`);
  const l = useApi<Leave>(`/admin/acct/leave?year=${year}`);
  const a = useAct();
  const run = () => confirm(`${ym} 퇴직금 추계 전표를 넣습니까?(그 달 한 번 · 차이만)`) && void a.run('run', () => api<{ note: string }>('/admin/acct/severance/run', { method: 'POST', body: JSON.stringify({ ym }) }), s.reload, (r) => r.note);
  const grant = (empId: string, suggest: number) => {
    const days = prompt(`${year}년 연차 생긴 날(제안 ${suggest}일 · 0.5 단위)`, String(suggest)); if (!days) return;
    const note = prompt('사유(예: 입사 1년 · 2026년 연차)'); if (!note) return;
    void a.run(`g${empId}`, () => api<{ note: string }>('/admin/acct/leave/grant', { method: 'POST', body: JSON.stringify({ employeeId: empId, year, days: Number(days), note }) }), l.reload, (r) => r.note);
  };
  const use = (empId: string) => {
    const usedOn = prompt('쓴 날(YYYY-MM-DD)', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)); if (!usedOn) return;
    const days = prompt('일수(0.5 단위 · 취소는 음수)', '1'); if (!days) return;
    const note = prompt('메모(취소면 사유 필수)') ?? '';
    void a.run(`u${empId}`, () => api<{ note: string }>('/admin/acct/leave/use', { method: 'POST', body: JSON.stringify({ employeeId: empId, usedOn, days: Number(days), note }) }), l.reload, (r) => r.note);
  };
  return (
    <section data-acct-severance={s.data?.rows.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <h3>퇴직금 추계</h3>
      <div className="acts"><label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label>{' '}
        {isSuper() && <button className="btn-sm" disabled={a.busy === 'run' || !!s.data?.done || !s.data?.hasEmployees} onClick={run} data-acct-severance-run="">이 달 추계 전표</button>}</div>
      {s.data && (
        <>
          {!s.data.hasEmployees && <p className="warn-text">직원 표(급여 · v10.403)가 아직 없습니다.</p>}
          <p data-acct-severance-sum="">추계액(1년 이상) <b>{won(s.data.total)}</b> · 전체 {won(s.data.allTotal)} · 장부 잔액 {won(s.data.book)} · 차이 <b>{won(s.data.diff)}</b>
            {s.data.done && <> · <small className="dim">이 달 추계함(전표 {s.data.done.entryId ?? '없음'})</small></>}</p>
          <table className="tbl"><thead><tr><th>직원</th><th>입사</th><th>재직일</th><th>1일 평균임금</th><th>추계액</th><th>기준</th></tr></thead>
            <tbody>{s.data.rows.map((r) => (
              <tr key={r.employeeId} data-acct-severance-row={r.eligible ? 'y' : 'n'}><td>{r.name}</td><td>{r.joinedOn}</td><td>{r.serviceDays}</td><td>{won(r.dailyAvg)}</td>
                <td>{won(r.estimate)}{!r.eligible && <small className="dim"> (1년 미만 · 합계 뺌)</small>}</td><td><small>{({ PAYROLL: '최근 3개월 급여', BASE: '월 기본급', NONE: '급여 없음' } as Record<string, string>)[r.basis]}</small></td></tr>))}</tbody></table>
          <p className="muted">{s.data.note}</p>
        </>
      )}
      <h3>연차 대장</h3>
      <div className="acts"><label>해 <input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ width: 90 }} /></label></div>
      {l.data && (
        <>
          <table className="tbl" data-acct-leave={l.data.rows.length}><thead><tr><th>직원</th><th>입사</th><th>생긴 날</th><th>쓴 날</th><th>남은 날</th><th>제안</th><th /></tr></thead>
            <tbody>{l.data.rows.map((r) => (
              <tr key={r.employeeId}><td>{r.name}</td><td>{r.joinedOn}</td><td>{r.granted}</td><td>{r.used}</td><td><b className={r.remaining < 0 ? 'warn-text' : ''}>{r.remaining}</b></td><td>{r.suggest}</td>
                <td>{isSuper() && <button className="btn-sm btn-plain" onClick={() => grant(r.employeeId, r.suggest)} data-acct-leave-grant={r.employeeId}>생긴 날</button>}{' '}
                  <button className="btn-sm btn-plain" onClick={() => use(r.employeeId)}>쓴 날</button></td></tr>))}</tbody></table>
          <p className="muted">{l.data.note}</p>
        </>
      )}
    </section>
  );
}

interface Corp { fiscalYear: { start: string; end: string }; asOf: string; months: number;
  ytd: { revenue: number; expense: number; profit: number; base: number; tax: number; local: number; total: number };
  annualized: { profit: number; base: number; tax: number; local: number; total: number }; interim: { base: number; tax: number; total: number }; firstHalfComplete: boolean;
  brackets: Array<{ upTo: number | null; rate: number }>; localRate: number; deadlines: Array<{ key: string; label: string; due: string; daysLeft: number }>; note: string }

/** v10.407 — 법인세 추정 미리보기 */
export function AcctCorpTax() {
  const q = useApi<Corp>('/admin/acct/corptax');
  const d = q.data;
  return (
    <section data-acct-corptax={d ? d.months : ''}>
      {!!q.error && <p className="warn-text">{String(q.error)}</p>}
      {d && (
        <>
          <p>사업연도 {d.fiscalYear.start} ~ {d.fiscalYear.end} · {d.asOf} 까지 {d.months}개월</p>
          <table className="tbl"><thead><tr><th /><th>이익(과세표준)</th><th>법인세</th><th>지방소득세</th><th>합계</th></tr></thead>
            <tbody>
              <tr data-acct-corptax-ytd=""><td>지금까지</td><td>{won(d.ytd.profit)} <small className="dim">매출 {won(d.ytd.revenue)} · 비용 {won(d.ytd.expense)}</small></td><td>{won(d.ytd.tax)}</td><td>{won(d.ytd.local)}</td><td>{won(d.ytd.total)}</td></tr>
              <tr data-acct-corptax-annual=""><td>1년으로 늘리면</td><td>{won(d.annualized.profit)}</td><td>{won(d.annualized.tax)}</td><td>{won(d.annualized.local)}</td><td><b>{won(d.annualized.total)}</b></td></tr>
              <tr><td>중간예납(가결산 추정)</td><td>{won(d.interim.base)} <small className="dim">상반기{d.firstHalfComplete ? '' : ' · 아직 안 끝남'}</small></td><td>{won(d.interim.tax)}</td><td>—</td><td>{won(d.interim.total)}</td></tr>
            </tbody></table>
          <p>세율 구간(초안): {d.brackets.map((b) => `${b.upTo == null ? '그 위' : `${won(b.upTo)}원까지`} ${b.rate}%`).join(' · ')} · 지방소득세 {d.localRate}%</p>
          {d.deadlines.length > 0 && <p data-acct-corptax-deadlines={d.deadlines.length}>기한: {d.deadlines.map((x) => `${x.label} ${x.due}(${x.daysLeft}일 남음)`).join(' · ')}</p>}
          <p className="warn-text">{d.note}</p>
        </>
      )}
    </section>
  );
}

interface Party { id: string; kind: string; name: string; bizNo: string | null; contactName: string | null; contactPhone: string | null; contactEmail: string | null;
  bankName: string | null; accountLast4: string | null; advertiserId: string | null; advertiserName: string | null; sellerId: string | null; sellerName: string | null;
  memo: string | null; state: string; purchaseTotal: number; adTotal: number }
interface Parties { items: Party[]; kinds: Record<string, string>; note: string }
interface PartyOne { party: Party; purchases: Array<{ id: string; issuedOn: string; item: string; total: number; state: string }>;
  ads: Array<{ id: string; invoiceNo: string | null; total: number; paid: number; status: string }>; settlements: Array<{ id: string; periodFrom: string; periodTo: string; commission: number; status: string }>;
  contracts: Array<{ id: string; title: string; endOn: string | null; state: string }>; imports: Array<{ id: string; title: string; state: string }>;
  total: { purchase: number; ad: number; adPaid: number; commission: number } }
const PARTY_EMPTY = { id: '', kind: 'SUPPLIER', name: '', bizNo: '', contactName: '', contactPhone: '', contactEmail: '', bankName: '', accountLast4: '', advertiserId: '', sellerId: '', memo: '', state: 'ACTIVE' };

export function AcctParties() {
  const [q, setQ] = useState(''), [kind, setKind] = useState(''), [st, setSt] = useState('ACTIVE');
  const l = useApi<Parties>(`/admin/acct/parties?q=${encodeURIComponent(q)}&kind=${kind}&state=${st}`);
  const a = useAct();
  const [f, setF] = useState<typeof PARTY_EMPTY | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const save = () => f && void a.run('save', () => api(f.id ? `/admin/acct/parties/${f.id}` : '/admin/acct/parties', { method: f.id ? 'PATCH' : 'POST',
    body: JSON.stringify({ ...f, id: undefined, state: f.id ? f.state : undefined }) }), () => { setF(null); l.reload(); });
  const imp = () => void a.run('imp', () => api('/admin/acct/parties/import', { method: 'POST' }), l.reload);
  const edit = (p: Party) => setF({ id: p.id, kind: p.kind, name: p.name, bizNo: p.bizNo ?? '', contactName: p.contactName ?? '', contactPhone: p.contactPhone ?? '', contactEmail: p.contactEmail ?? '',
    bankName: p.bankName ?? '', accountLast4: p.accountLast4 ?? '', advertiserId: p.advertiserId ?? '', sellerId: p.sellerId ?? '', memo: p.memo ?? '', state: p.state });
  const d = l.data;
  return (
    <section data-acct-parties={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 사업자번호" size={18} aria-label="찾기" />{' '}
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류"><option value="">모든 종류</option>{Object.entries(d?.kinds ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
        <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태"><option value="ACTIVE">거래 중</option><option value="CLOSED">닫음</option><option value="">모두</option></select>{' '}
        <button className="btn-sm" onClick={() => setF({ ...PARTY_EMPTY })} data-acct-party-new="">거래처 넣기</button>{' '}
        {isSuper() && <button className="btn-sm btn-plain" disabled={a.busy === 'imp'} onClick={imp} data-acct-party-import="">가져오기(광고주 · 입점 판매자 · 매입)</button>}
      </p>
      {f && (
        <div className="card pad" data-acct-party-form="">
          <b>{f.id ? `거래처 ${f.id}번 고치기` : '거래처 넣기'}</b><br />
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{Object.entries(d?.kinds ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름(꼭)" size={18} />{' '}
          <input value={f.bizNo} onChange={(e) => setF({ ...f, bizNo: e.target.value })} placeholder="사업자번호" size={12} />{' '}
          <input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="담당" size={8} />{' '}
          <input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="전화" size={12} />{' '}
          <input value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} placeholder="메일" size={16} />{' '}
          <input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} placeholder="은행" size={8} />{' '}
          <input value={f.accountLast4} onChange={(e) => setF({ ...f, accountLast4: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} placeholder="계좌 끝 4자리" size={8} />{' '}
          <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" size={16} />{' '}
          {f.id && <label><input type="checkbox" checked={f.state === 'CLOSED'} onChange={(e) => setF({ ...f, state: e.target.checked ? 'CLOSED' : 'ACTIVE' })} /> 닫기</label>}{' '}
          <button className="btn-sm" disabled={a.busy === 'save' || !f.name.trim()} onClick={save}>저장</button> <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button>
          <p className="muted"><small>계좌는 끝 4자리만 적습니다(통장 사본 · 전체 번호는 받지 않음).</small></p>
        </div>
      )}
      {d && (
        <table className="tbl"><thead><tr><th>거래처</th><th>종류</th><th>사업자번호</th><th>담당</th><th>연결</th><th>매입 합계</th><th>광고 청구</th><th /></tr></thead>
          <tbody>{d.items.map((p) => (
            <tr key={p.id} data-acct-party-row={p.state}>
              <td>{p.name} {p.state === 'CLOSED' && <small className="dim">닫음</small>}</td><td>{d.kinds[p.kind] ?? p.kind}</td><td>{p.bizNo ?? '—'}</td>
              <td><small>{[p.contactName, p.contactPhone, p.contactEmail].filter(Boolean).join(' · ')}{p.bankName ? ` · ${p.bankName} ****${p.accountLast4 ?? ''}` : ''}</small></td>
              <td><small>{[p.advertiserName && `광고주 ${p.advertiserName}`, p.sellerName && `판매자 ${p.sellerName}`].filter(Boolean).join(' · ') || '—'}</small></td>
              <td>{won(p.purchaseTotal)}</td><td>{won(p.adTotal)}</td>
              <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === p.id ? null : p.id)} data-acct-party-open={p.id}>{open === p.id ? '닫기' : '보기'}</button> <button className="btn-sm btn-plain" onClick={() => edit(p)}>고치기</button></td>
            </tr>))}</tbody></table>
      )}
      {open && <PartyDetail key={open} id={open} />}
      {d && <p className="muted">{d.note}</p>}
    </section>
  );
}

/** 거래처 한 곳 — 매입 · 광고 청구 · 입점 정산 · 계약 · 수입 */
function PartyDetail({ id }: { id: string }) {
  const one = useApi<PartyOne>(`/admin/acct/parties/${id}`);
  const o = one.data;
  if (!o) return null;
  return (
    <div className="card pad" data-acct-party-detail={id}>
      <b>{o.party.name}</b> <small className="dim">매입 {won(o.total.purchase)} · 광고 청구 {won(o.total.ad)}(입금 {won(o.total.adPaid)}) · 입점 수수료 {won(o.total.commission)}</small>
      {!!o.purchases.length && <p><small>매입: {o.purchases.slice(0, 10).map((x) => `${x.issuedOn} ${x.item} ${won(x.total)}${x.state === 'CANCELED' ? '(취소)' : ''}`).join(' · ')}</small></p>}
      {!!o.ads.length && <p><small>광고 청구: {o.ads.slice(0, 10).map((x) => `${x.invoiceNo ?? x.id} ${won(x.total)} / 입금 ${won(x.paid)}`).join(' · ')}</small></p>}
      {!!o.settlements.length && <p><small>입점 정산: {o.settlements.slice(0, 10).map((x) => `${x.periodFrom} ~ ${x.periodTo} 수수료 ${won(x.commission)}`).join(' · ')}</small></p>}
      {!!o.contracts.length && <p><small>계약: {o.contracts.map((x) => `${x.title}(${x.endOn ?? '기한 없음'})`).join(' · ')}</small></p>}
      {!!o.imports.length && <p><small>수입: {o.imports.map((x) => `${x.title}(${x.state})`).join(' · ')}</small></p>}
      {!o.purchases.length && !o.ads.length && !o.settlements.length && !o.contracts.length && !o.imports.length && <p className="muted"><small>아직 거래 기록이 없습니다.</small></p>}
    </div>
  );
}

interface CFile { id: string; name: string; size: number }
interface Contract { id: string; partyId: string | null; partyName: string | null; title: string; kind: string; startOn: string; endOn: string | null; autoRenew: boolean;
  noticeDays: number; monthlyAmount: number; payDay: number | null; cashPlanId: string | null; memo: string | null; state: string; endNote: string | null;
  files: CFile[]; daysLeft: number | null; due: boolean }
interface Contracts { items: Contract[]; kinds: Record<string, string>; maxFiles: number; count: { active: number; due: number; overdue: number }; monthlyTotal: number; note: string }
const CON_EMPTY = { partyId: '', title: '', kind: 'RENT', startOn: '', endOn: '', autoRenew: false, noticeDays: '30', monthlyAmount: '', payDay: '25', memo: '' };

export function AcctContracts() {
  const [st, setSt] = useState('ACTIVE');
  const l = useApi<Contracts>(`/admin/acct/contracts?state=${st}`);
  const parties = useApi<{ items: Array<{ id: string; name: string }> }>('/admin/acct/parties?state=ACTIVE');
  const a = useAct();
  const [f, setF] = useState({ ...CON_EMPTY, startOn: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) });
  const [files, setFiles] = useState<CFile[]>([]);
  const [show, setShow] = useState(false);
  const d = l.data;
  const addFile = (fl: File | undefined) => fl && void a.run('file', async () => {
    const u = await uploadFile(fl, 'ACCT_EVIDENCE');
    setFiles((x) => [...x, { id: u.fileId, name: u.name, size: u.size }]);
    return { note: `계약서 파일을 올렸습니다(${u.name}).` };
  });
  const send = () => void a.run('add', () => api('/admin/acct/contracts', { method: 'POST', body: JSON.stringify({
    partyId: f.partyId || undefined, title: f.title, kind: f.kind, startOn: f.startOn, endOn: f.endOn || undefined, autoRenew: f.autoRenew, noticeDays: Number(f.noticeDays || 30),
    monthlyAmount: Number(f.monthlyAmount || 0), payDay: Number(f.monthlyAmount || 0) > 0 ? Number(f.payDay) : undefined, memo: f.memo || undefined, attachments: files.map((x) => x.id) }) }),
    () => { setF({ ...CON_EMPTY, startOn: f.startOn }); setFiles([]); setShow(false); l.reload(); });
  const renew = (c: Contract) => {
    const endOn = prompt(`「${c.title}」 새 만기일(YYYY-MM-DD · 지금 ${c.endOn ?? '없음'})`); if (!endOn) return;
    const reason = prompt('연장 사유'); if (reason) void a.run(`r${c.id}`, () => api(`/admin/acct/contracts/${c.id}/renew`, { method: 'POST', body: JSON.stringify({ endOn, reason }) }), l.reload);
  };
  const end = (c: Contract) => {
    const reason = prompt(`「${c.title}」 계약을 끝냅니다(자금 흐름 예정도 취소). 사유를 적으십시오.`);
    if (reason) void a.run(`e${c.id}`, () => api(`/admin/acct/contracts/${c.id}/end`, { method: 'POST', body: JSON.stringify({ reason }) }), l.reload);
  };
  return (
    <section data-acct-contracts={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p><b>거래 중 {d.count.active}</b> · 만기 알림 대상 <b className={d.count.due ? 'warn-text' : ''} data-acct-contract-due={d.count.due}>{d.count.due}</b> · 만기 지남 {d.count.overdue} · 달 고정비 합 {won(d.monthlyTotal)}{' '}
        <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태"><option value="ACTIVE">거래 중</option><option value="ENDED">끝냄</option><option value="">모두</option></select>{' '}
        <button className="btn-sm" onClick={() => setShow(!show)} data-acct-contract-new="">{show ? '닫기' : '계약 넣기'}</button></p>}
      {show && (
        <div className="card pad" data-acct-contract-form="">
          <select value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })} aria-label="거래처"><option value="">거래처 없음</option>{(parties.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{' '}
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="계약 이름(꼭)" size={16} />{' '}
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{Object.entries(d?.kinds ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
          <label>시작 <input type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></label>{' '}
          <label>만기 <input type="date" value={f.endOn} onChange={(e) => setF({ ...f, endOn: e.target.value })} /></label>{' '}
          <label><input type="checkbox" checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} /> 자동 갱신</label>{' '}
          <label>알림 <input value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value.replace(/\D/g, '') })} size={3} />일 전</label><br />
          <label>달 금액 <input value={f.monthlyAmount} onChange={(e) => setF({ ...f, monthlyAmount: e.target.value.replace(/\D/g, '') })} size={10} placeholder="0 = 없음" /></label>{' '}
          {Number(f.monthlyAmount || 0) > 0 && <label>낼 날 <input value={f.payDay} onChange={(e) => setF({ ...f, payDay: e.target.value.replace(/\D/g, '') })} size={3} />일</label>}{' '}
          <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" size={16} />{' '}
          <label className="btn-sm btn-plain" data-acct-contract-file="">계약서 파일 <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden disabled={files.length >= (d?.maxFiles ?? 5)} onChange={(e) => addFile(e.target.files?.[0])} /></label>{' '}
          {files.map((x) => <small key={x.id} className="dim">{x.name}({fmtSize(x.size)}) </small>)}
          <button className="btn-sm" disabled={a.busy === 'add' || f.title.trim().length < 2 || !f.startOn} onClick={send}>저장</button>
        </div>
      )}
      {d && (
        <table className="tbl"><thead><tr><th>계약</th><th>거래처</th><th>기간</th><th>남은 날</th><th>달 금액</th><th>계약서</th><th /></tr></thead>
          <tbody>{d.items.map((c) => (
            <tr key={c.id} data-acct-contract-row={c.due ? 'due' : c.state}>
              <td>{c.title} <small className="dim">{d.kinds[c.kind] ?? c.kind}{c.autoRenew ? ' · 자동 갱신' : ''}</small></td><td>{c.partyName ?? '—'}</td>
              <td>{c.startOn} ~ {c.endOn ?? '기한 없음'}</td>
              <td>{c.state === 'ENDED' ? <small className="dim">끝냄 · {c.endNote}</small> : c.daysLeft == null ? '—' : c.daysLeft < 0 ? <b className="warn-text">{-c.daysLeft}일 지남</b> : c.due ? <b className="warn-text">{c.daysLeft}일</b> : `${c.daysLeft}일`}</td>
              <td>{c.monthlyAmount ? `${won(c.monthlyAmount)} · ${c.payDay}일` : '—'}</td>
              <td>{c.files.map((x) => <small key={x.id}>{x.name} </small>)}</td>
              <td>{c.state === 'ACTIVE' && <><button className="btn-sm btn-plain" disabled={a.busy === `r${c.id}`} onClick={() => renew(c)}>연장</button> <button className="btn-sm btn-plain" disabled={a.busy === `e${c.id}`} onClick={() => end(c)}>끝내기</button></>}</td>
            </tr>))}</tbody></table>
      )}
      {d && <p className="muted">{d.note}</p>}
    </section>
  );
}

interface Req { id: string; requesterId: string; requester: string; requesterName: string | null; title: string; amount: number; accountRole: string; accountName: string; reason: string;
  neededOn: string | null; state: string; decidedBy: string | null; decideNote: string | null; usedKind: string | null; usedRef: string | null; usedAmount: number | null; createdAt: string }
interface Reqs { items: Req[]; accounts: Array<{ role: string; name: string; kind: string }>; states: Record<string, string>; all: boolean; canDecide: boolean; me: string | null;
  tolerancePct: number; waiting: number; note: string }
const REQ_EMPTY = { title: '', amount: '', accountRole: 'EXP_SUPPLIES', reason: '', neededOn: '' };

export function AcctRequisitions() {
  const [st, setSt] = useState('');
  const l = useApi<Reqs>(`/admin/acct/requisitions?state=${st}`);
  const a = useAct();
  const [f, setF] = useState(REQ_EMPTY);
  const d = l.data;
  const send = () => void a.run('add', () => api('/admin/acct/requisitions', { method: 'POST', body: JSON.stringify({
    title: f.title, amount: Number(f.amount), accountRole: f.accountRole, reason: f.reason, neededOn: f.neededOn || undefined }) }), () => { setF(REQ_EMPTY); l.reload(); });
  const decide = (r: Req, approve: boolean) => {
    const note = approve ? (prompt(`「${r.title}」 ${won(r.amount)}원 승인 — 메모(비워도 됨)`) ?? null) : prompt(`「${r.title}」 반려 사유`);
    if (note === null || (!approve && !note.trim())) return;
    void a.run(`d${r.id}`, () => api(`/admin/acct/requisitions/${r.id}/decide`, { method: 'POST', body: JSON.stringify({ approve, note }) }), l.reload);
  };
  const use = (r: Req) => {
    const kind = prompt('연결할 것: PURCHASE(매입) 또는 EXPENSE(경비 청구)', 'PURCHASE'); if (!kind) return;
    const refId = prompt(`${kind === 'EXPENSE' ? '경비 청구' : '매입'} 번호`); if (!refId) return;
    void a.run(`u${r.id}`, () => api(`/admin/acct/requisitions/${r.id}/use`, { method: 'POST', body: JSON.stringify({ kind: kind.trim().toUpperCase(), refId: refId.trim() }) }), l.reload);
  };
  const cancel = (r: Req) => confirm(`「${r.title}」 품의를 취소할까요?`) && void a.run(`c${r.id}`, () => api(`/admin/acct/requisitions/${r.id}/cancel`, { method: 'POST' }), l.reload);
  return (
    <section data-acct-requisitions={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-acct-req-form="">
        <b>품의 올리기</b><br />
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목(꼭)" size={18} />{' '}
        <input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} placeholder="금액(원)" size={10} />{' '}
        <select value={f.accountRole} onChange={(e) => setF({ ...f, accountRole: e.target.value })} aria-label="계정">{(d?.accounts ?? []).map((x) => <option key={x.role} value={x.role}>{x.name}</option>)}</select>{' '}
        <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="사유(꼭)" size={24} />{' '}
        <label>쓸 날 <input type="date" value={f.neededOn} onChange={(e) => setF({ ...f, neededOn: e.target.value })} /></label>{' '}
        <button className="btn-sm" disabled={a.busy === 'add' || f.title.trim().length < 2 || !Number(f.amount) || f.reason.trim().length < 2} onClick={send}>올리기</button>
      </div>
      {d && (
        <>
          <p>결재 기다림 <b data-acct-req-waiting={d.waiting}>{d.waiting}</b> · 허용 {d.tolerancePct}% {d.all ? '· 모든 품의' : '· 내 품의만'}{' '}
            <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태"><option value="">모든 상태</option>{Object.entries(d.states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></p>
          <table className="tbl"><thead><tr><th>품의</th><th>올린 사람</th><th>금액</th><th>계정</th><th>상태</th><th /></tr></thead>
            <tbody>{d.items.map((r) => (
              <tr key={r.id} data-acct-req-row={r.state}>
                <td>{r.title} <small className="dim">{r.reason}{r.neededOn ? ` · ${r.neededOn}` : ''}</small></td><td><small>{r.requesterName ?? r.requester}</small></td>
                <td>{won(r.amount)}</td><td>{r.accountName}</td>
                <td>{d.states[r.state] ?? r.state}{r.decideNote ? <small className="dim"> · {r.decideNote}</small> : ''}{r.usedRef ? <small className="dim"> · {r.usedKind === 'EXPENSE' ? '경비' : '매입'} {r.usedRef}번 {won(r.usedAmount)}</small> : ''}</td>
                <td>
                  {r.state === 'REQUESTED' && d.canDecide && r.requesterId !== d.me && <><button className="btn-sm" disabled={a.busy === `d${r.id}`} onClick={() => decide(r, true)}>승인</button> <button className="btn-sm btn-plain" disabled={a.busy === `d${r.id}`} onClick={() => decide(r, false)}>반려</button> </>}
                  {r.state === 'APPROVED' && d.all && <button className="btn-sm btn-plain" disabled={a.busy === `u${r.id}`} onClick={() => use(r)}>연결</button>}{' '}
                  {['REQUESTED', 'APPROVED'].includes(r.state) && (r.requesterId === d.me || d.canDecide) && <button className="btn-sm btn-plain" disabled={a.busy === `c${r.id}`} onClick={() => cancel(r)}>취소</button>}
                </td>
              </tr>))}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

interface Imp { id: string; partyName: string | null; title: string; currency: string; fxRate: number | null; duty: number; importVat: number; freight: number; otherCost: number;
  goodsKrw: number | null; blNo: string | null; brokerName: string | null; declNo: string | null; state: string; orderedOn: string; shippedOn: string | null; customsOn: string | null;
  receivedOn: string | null; memo: string | null; cancelNote: string | null; foreignTotal: number; lines: number; vatEntryId: string | null }
interface Imps { items: Imp[]; options: Array<{ id: string; label: string }>; states: Record<string, string>; count: { open: number; customs: number }; note: string }
const NEXT: Record<string, string> = { ORDERED: 'SHIPPED', SHIPPED: 'CUSTOMS', CUSTOMS: 'RECEIVED' };

export function AcctImports() {
  const [st, setSt] = useState('');
  const l = useApi<Imps>(`/admin/acct/imports?state=${st}`);
  const parties = useApi<{ items: Array<{ id: string; name: string }> }>('/admin/acct/parties?state=ACTIVE');
  const a = useAct();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [f, setF] = useState({ partyId: '', title: '', currency: 'USD', orderedOn: today, memo: '' });
  const [lines, setLines] = useState<Array<{ optionId: string; qty: string; foreignAmount: string }>>([{ optionId: '', qty: '', foreignAmount: '' }]);
  const [adv, setAdv] = useState<{ id: string; to: string; date: string; blNo: string; fxRate: string; duty: string; importVat: string; brokerName: string; declNo: string; freight: string; otherCost: string } | null>(null);
  const d = l.data;
  const okLines = lines.filter((x) => x.optionId && Number(x.qty) > 0);
  const send = () => void a.run('add', () => api('/admin/acct/imports', { method: 'POST', body: JSON.stringify({ ...f, partyId: f.partyId || undefined, memo: f.memo || undefined,
    lines: okLines.map((x) => ({ optionId: x.optionId, qty: Number(x.qty), foreignAmount: Number(x.foreignAmount || 0) })) }) }),
    () => { setF({ ...f, title: '', memo: '' }); setLines([{ optionId: '', qty: '', foreignAmount: '' }]); l.reload(); });
  const go = () => adv && void a.run('adv', () => api(`/admin/acct/imports/${adv.id}/advance`, { method: 'POST', body: JSON.stringify({
    to: adv.to, date: adv.date, blNo: adv.blNo || undefined, brokerName: adv.brokerName || undefined, declNo: adv.declNo || undefined,
    ...(adv.to === 'CUSTOMS' ? { fxRate: Number(adv.fxRate), duty: Number(adv.duty || 0), importVat: Number(adv.importVat || 0) } : {}),
    ...(adv.to === 'RECEIVED' ? { freight: Number(adv.freight || 0), otherCost: Number(adv.otherCost || 0) } : {}) }) }), () => { setAdv(null); l.reload(); });
  const cancel = (x: Imp) => { const reason = prompt(`「${x.title}」 수입 건 취소 사유`); if (reason) void a.run(`c${x.id}`, () => api(`/admin/acct/imports/${x.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), l.reload); };
  const setA = (k: string, v: string) => adv && setAdv({ ...adv, [k]: v });
  return (
    <section data-acct-imports={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-acct-import-form="">
        <b>발주 넣기</b><br />
        <select value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })} aria-label="거래처"><option value="">거래처 없음</option>{(parties.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{' '}
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목(꼭)" size={18} />{' '}
        <input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().slice(0, 3) })} size={4} aria-label="통화" />{' '}
        <label>발주일 <input type="date" value={f.orderedOn} onChange={(e) => setF({ ...f, orderedOn: e.target.value })} /></label>{' '}
        <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모(조건 · 항구)" size={16} />
        {lines.map((x, i) => (
          <div key={i} data-acct-import-line={i}>
            <select value={x.optionId} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, optionId: e.target.value } : y)))} aria-label="상품 옵션"><option value="">직판 상품 옵션</option>{(d?.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>{' '}
            <input value={x.qty} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, qty: e.target.value.replace(/\D/g, '') } : y)))} placeholder="수량" size={6} />{' '}
            <input value={x.foreignAmount} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, foreignAmount: e.target.value.replace(/[^0-9.]/g, '') } : y)))} placeholder={`금액(${f.currency})`} size={10} />
          </div>
        ))}
        <button className="btn-sm btn-plain" disabled={lines.length >= 50} onClick={() => setLines([...lines, { optionId: '', qty: '', foreignAmount: '' }])}>줄 더하기</button>{' '}
        <button className="btn-sm" disabled={a.busy === 'add' || f.title.trim().length < 2 || !okLines.length} onClick={send}>발주 넣기</button>
      </div>
      {adv && (
        <div className="card pad" data-acct-import-advance={adv.to}>
          <b>{adv.id}번 → {d?.states[adv.to]}</b>{' '}
          <label>날짜 <input type="date" value={adv.date} onChange={(e) => setA('date', e.target.value)} /></label>{' '}
          {adv.to === 'SHIPPED' && <input value={adv.blNo} onChange={(e) => setA('blNo', e.target.value)} placeholder="B/L 번호" size={14} />}
          {adv.to === 'CUSTOMS' && <>
            <input value={adv.fxRate} onChange={(e) => setA('fxRate', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="과세 환율(꼭)" size={8} />{' '}
            <input value={adv.duty} onChange={(e) => setA('duty', e.target.value.replace(/\D/g, ''))} placeholder="관세(원)" size={10} />{' '}
            <input value={adv.importVat} onChange={(e) => setA('importVat', e.target.value.replace(/\D/g, ''))} placeholder="수입 부가세(원)" size={10} />{' '}
            <input value={adv.brokerName} onChange={(e) => setA('brokerName', e.target.value)} placeholder="관세사" size={12} />{' '}
            <input value={adv.declNo} onChange={(e) => setA('declNo', e.target.value)} placeholder="수입신고번호" size={14} />
          </>}
          {adv.to === 'RECEIVED' && <>
            <input value={adv.freight} onChange={(e) => setA('freight', e.target.value.replace(/\D/g, ''))} placeholder="운임(원)" size={10} />{' '}
            <input value={adv.otherCost} onChange={(e) => setA('otherCost', e.target.value.replace(/\D/g, ''))} placeholder="기타 비용(원)" size={10} />
            <small className="dim"> 입고 원가 = 물품(외화 × 환율) + 관세 + 운임 + 기타 → 재고 수불부</small>
          </>}{' '}
          <button className="btn-sm" disabled={a.busy === 'adv' || !adv.date || (adv.to === 'CUSTOMS' && !Number(adv.fxRate))} onClick={go}>넘기기</button> <button className="btn-sm btn-plain" onClick={() => setAdv(null)}>닫기</button>
        </div>
      )}
      {d && (
        <>
          <p>진행 중 <b>{d.count.open}</b> · 통관 {d.count.customs}{' '}
            <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태"><option value="">모든 상태</option>{Object.entries(d.states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></p>
          <table className="tbl"><thead><tr><th>수입 건</th><th>거래처</th><th>상태</th><th>외화</th><th>환율 · 관세 · 수입 부가세</th><th>입고 물품(원)</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-acct-import-row={x.state}>
                <td>{x.title} <small className="dim">{x.lines}줄{x.blNo ? ` · B/L ${x.blNo}` : ''}{x.declNo ? ` · 신고 ${x.declNo}` : ''}</small></td><td>{x.partyName ?? '—'}</td>
                <td>{d.states[x.state] ?? x.state} <small className="dim">{x.receivedOn ?? x.customsOn ?? x.shippedOn ?? x.orderedOn}</small>{x.cancelNote ? <small className="dim"> · {x.cancelNote}</small> : ''}</td>
                <td>{x.foreignTotal.toLocaleString('ko-KR')} {x.currency}</td>
                <td>{x.fxRate ? `${x.fxRate} · ${won(x.duty)} · ${won(x.importVat)}` : '—'}{x.vatEntryId ? <small className="dim"> · 전표 {x.vatEntryId}</small> : ''}</td>
                <td>{won(x.goodsKrw)}</td>
                <td>{NEXT[x.state] && <button className="btn-sm btn-plain" onClick={() => setAdv({ id: x.id, to: NEXT[x.state]!, date: today, blNo: '', fxRate: '', duty: '', importVat: '', brokerName: '', declNo: '', freight: '', otherCost: '' })} data-acct-import-next={x.id}>{d.states[NEXT[x.state]!]}</button>}{' '}
                  {['ORDERED', 'SHIPPED'].includes(x.state) && <button className="btn-sm btn-plain" disabled={a.busy === `c${x.id}`} onClick={() => cancel(x)}>취소</button>}</td>
              </tr>))}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
