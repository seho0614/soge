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
  const ok = /^U_[A-Z][A-Z0-9_]{1,30}$/.test(f.role) && f.name.trim() && f.reason.trim().length >= 2;
  return (
    <div className="card pad" data-acct-account-add="">
      <Flash msg={a.msg} err={a.err} />
      <b>계정 더하기</b> <small className="dim">역할은 U_ 로 시작하는 대문자 · 지우지 않음</small><br />
      <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value.toUpperCase() })} size={14} aria-label="역할" />{' '}
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름" size={14} />{' '}
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE'].map((k) => <option key={k} value={k}>{KIND_KO[k]}</option>)}</select>{' '}
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
