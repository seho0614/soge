import { useState } from 'react';
import { ymdKst } from '../../lib/format';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { EtaxBanner, EtaxCell, useEtaxAssume, type EtaxRow } from '../../components/Etax';

interface Renewal { id: string; months: number; monthlyFee: number; supplyAmount: number; vatAmount: number; totalAmount: number; requestedAt: string; from: string; to: string }
interface Row {
  id: string; categoryCode: string; categoryName: string; displayName: string; contactPhone: string; sido: string;
  state: string; monthlyFee: number | null; paidFrom: string | null; paidTo: string | null; paymentRef: string | null;
  reason: string | null; company: string; bizRegNo: string | null; qualified: boolean; appliedAt: string;
  /* v10.33 — 최근 입금(부가세 별도) · 회차 · 열린 연장 신청 · 기간 지남 */
  months: number | null; supplyAmount: number | null; vatAmount: number | null; totalAmount: number | null;
  rounds: number; renewal: Renewal | null; lapsed: boolean;
}
/* v10.34 (D093) — 국세청 전송 칸(EtaxRow: 발행 방식 · 전송 상태 · 승인번호 · 실패 사유 · 시도)을 더함 */
interface Invoice extends EtaxRow {
  id: string; state: string; supply: number; vat: number; total: number; invoiceNo: string | null; issuedOn: string | null;
  supplierName: string; supplierBizNo: string; buyerName: string; buyerBizNo: string; requestedAt: string;
  seq: number; kind: string; from: string; to: string; months: number | null; displayName: string; categoryName: string;
}
interface History {
  periods: Array<{ id: string; seq: number; kind: string; from: string; to: string; months: number | null; monthlyFee: number | null;
                   supplyAmount: number | null; vatAmount: number | null; totalAmount: number | null; paymentRef: string | null; confirmedAt: string }>;
  renewals: Array<{ id: string; months: number; totalAmount: number; state: string; reason: string | null; requestedAt: string; decidedAt: string | null }>;
  invoices: Array<{ id: string; seq: number; total: number; state: string; invoiceNo: string | null; issuedOn: string | null; etaxMode?: string | null; etaxStatus?: string | null }>;
}
const STATE: Record<string, string> = { PENDING: '대기', ACTIVE: '노출 중', RENEW_REQUESTED: '연장 신청 · 노출 중', ENDED: '종료', REJECTED: '반려' };
const KIND: Record<string, string> = { INITIAL: '처음', RENEWAL: '연장', LEGACY: '이전 기록' };
const RSTATE: Record<string, string> = { REQUESTED: '입금 확인 대기', CONFIRMED: '입금 확인', REJECTED: '반려', CANCELED: '닫힘' };
interface Setting { key: string; value: string | null }
const BASE_KEY = 'directory.monthly_fee';
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** v10.33 — 부가세 = 공급가액 × 10% · 1원 미만 절사(DB fn_directory_vat 와 같은 규칙) */
const vatOf = (supply: number) => Math.floor(supply / 10);

/**
 * SB-ADM-PTN-080 확장 — 법률 · 세무 월 정액 노출 (서버 D019 · /admin/directory)
 * 입금을 확인한 뒤 금액 · 기간 · 입금 근거를 적고 노출을 켭니다. 자격 · 상담 축 입점 승인이 없으면 서버가 막습니다.
 * 노출료는 기간 정액입니다 — 연락 · 수임 건수와 잇지 않습니다(소개 대가 금지).
 *
 * 20261002 (D020 · 사장님 결정 「기준 금액은 관리자에서 등록 — 일단 월 30만원」)
 * 맨 위에서 **월 노출료 기준 금액**을 등록 · 변경합니다(설정 directory.monthly_fee). 노출을 켤 때 금액 칸을 비우면
 * 기준 금액으로 기록합니다. 기준 금액을 바꿔도 이미 켠 노출의 금액은 그대로입니다.
 *
 * v10.33 (D092 · 2026-10-11 대표 결정)
 *   ① 부가세 별도 — 금액은 「월 300,000원 (부가세 별도)」. 입금 확인 때 합계(= 월 노출료 × 개월수 + 부가세 10%)를 보여 줍니다.
 *   ② 기간 연장 A안 — 「연장 신청」 탭: 업체가 낸 연장 신청의 합계를 보고 입금 근거와 함께 「연장 입금 확인」(기존 종료일 다음 날부터)
 *      · 「연장 반려」(사유 5자). 노출 중인 항목을 여기서 다시 켜서 늘리지 않습니다.
 *   ③ 세금계산서 — 입금 확인(처음 · 연장)마다 발행 요청 1줄. 「세금계산서」 탭에서 발행 번호 · 발행일을 넣어 「발행됨」.
 *
 * v10.34 (D093) — 「세금계산서」 탭에 국세청 전송(어댑터): 전송 상태 · 승인번호 · 간주 표시 · 발행 · 다시 보내기 · 상태 조회 · 취소.
 *   업체(ASP) 연동 전에는 간주 모드(assume.etax on)라 「간주 발행」으로만 기록됩니다. 손으로 번호 넣기는 「연동 전 임시」로 접어 둡니다.
 */
export function DirectoryAdmin() {
  const [state, setState] = useState('PENDING');
  const isInv = state === 'INVOICES';
  const list = useApi<Row[]>(isInv ? '/admin/directory?state=PENDING' : `/admin/directory?state=${state}`);
  const [invState, setInvState] = useState('REQUESTED');
  const invoices = useApi<Invoice[]>(`/admin/directory/invoices?state=${invState}`);
  const [form, setForm] = useState<Record<string, { fee: string; from: string; months: string; ref: string; why: string; no: string; on: string }>>({});
  const [hist, setHist] = useState<Record<string, History | null>>({});
  const a = useAct();
  const etaxAssume = useEtaxAssume();  /* v10.34 — 간주 모드면 「발행(간주)」 */
  const settings = useApi<Setting[]>('/admin/site-settings');
  const base = settings.data?.find((s) => s.key === BASE_KEY)?.value ?? '';
  const baseOk = /^[1-9][0-9]{3,8}$/.test(base);
  const [baseInput, setBaseInput] = useState<string | null>(null);
  const get = (id: string) => form[id] ?? { fee: '', from: '', months: '1', ref: '', why: '', no: '', on: '' };

  async function saveBase() {
    const v = (baseInput ?? base).replace(/[^0-9]/g, '');
    if (!/^[1-9][0-9]{3,8}$/.test(v)) { a.setErr('기준 금액은 1,000원 이상의 숫자로 적어 주십시오.'); return; }
    await a.run('base', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: BASE_KEY, value: v }) }),
      () => { setBaseInput(null); settings.reload(); }, `월 노출료 기준 금액을 ${n(v)}원으로 등록했습니다(부가세 별도). 이미 켠 노출 · 이미 낸 연장 신청의 금액은 그대로입니다.`);
  }
  const put = (id: string, k: 'fee' | 'from' | 'months' | 'ref' | 'why' | 'no' | 'on', v: string) => setForm({ ...form, [id]: { ...get(id), [k]: v } });
  /* v10.33 — 처리한 줄의 입력은 비웁니다. 처음 켤 때 적은 입금 근거가 남아 있으면 연장 입금 확인에 그대로 들어갑니다 */
  const done = (id: string) => () => { setForm((cur) => { const c = { ...cur }; delete c[id]; return c; }); list.reload(); };

  /** 입금 확인 칸의 합계 미리 보기(서버가 같은 규칙으로 다시 계산해 기록합니다) */
  function quote(id: string) {
    const f = get(id);
    const fee = f.fee.trim() === '' ? (baseOk ? Number(base) : NaN) : Number(f.fee);
    const m = Number(f.months || 1);
    if (!(fee > 0) || !(m >= 1)) return null;
    const supply = fee * m, vat = vatOf(supply);
    return { fee, m, supply, vat, total: supply + vat };
  }

  async function activate(r: Row) {
    const f = get(r.id);
    /* 금액 칸을 비우면 기준 금액으로 — 기준 금액도 없으면 직접 적어야 합니다 */
    const fee = f.fee.trim() === '' ? null : Number(f.fee);
    if ((fee === null && !baseOk) || (fee !== null && !(fee > 0)) || !f.from || !f.ref.trim()) {
      a.setErr(baseOk ? '시작일 · 개월수 · 입금 근거를 모두 적어 주십시오(금액을 비우면 기준 금액).' : '금액 · 시작일 · 개월수 · 입금 근거를 모두 적어 주십시오.'); return;
    }
    const qt = quote(r.id);
    await a.run(r.id, () => api(`/admin/directory/${r.id}/activate`, {
      method: 'POST', body: JSON.stringify({ ...(fee === null ? {} : { monthlyFee: fee }), paidFrom: f.from, months: Number(f.months || 1), paymentRef: f.ref.trim() }),
    }), done(r.id), `${r.displayName} — 노출을 켰습니다(월 ${n(fee ?? base)}원 · 부가세 별도 · 입금 합계 ${n(qt?.total)}원). 세금계산서 발행 요청 1건이 생겼습니다.`);
  }
  async function close(r: Row, kind: 'reject' | 'end') {
    const why = get(r.id).why.trim();
    if (why.length < 5) { a.setErr('사유를 5자 이상 적어 주십시오 — 업체에게 그대로 보입니다.'); return; }
    await a.run(r.id, () => api(`/admin/directory/${r.id}/${kind}`, { method: 'POST', body: JSON.stringify({ reason: why }) }),
      done(r.id), kind === 'reject' ? '반려했습니다.' : '노출을 끝냈습니다.');
  }
  /* v10.33 — 연장 입금 확인 · 반려 */
  async function renewConfirm(r: Row) {
    const ref = get(r.id).ref.trim();
    if (!ref) { a.setErr('입금 근거(입금자 · 거래번호)를 적어 주십시오.'); return; }
    await a.run(r.id, () => api(`/admin/directory/${r.id}/renew/confirm`, { method: 'POST', body: JSON.stringify({ paymentRef: ref }) }),
      done(r.id), `${r.displayName} — 연장 입금(합계 ${n(r.renewal?.totalAmount)}원)을 확인했습니다. 노출이 ${r.renewal?.to ?? ''}까지 이어집니다. 세금계산서 발행 요청 1건이 생겼습니다.`);
  }
  async function renewReject(r: Row) {
    const why = get(r.id).why.trim();
    if (why.length < 5) { a.setErr('반려 사유를 5자 이상 적어 주십시오 — 업체에게 그대로 보입니다.'); return; }
    await a.run(r.id, () => api(`/admin/directory/${r.id}/renew/reject`, { method: 'POST', body: JSON.stringify({ reason: why }) }),
      done(r.id), `${r.displayName} — 연장 신청을 반려했습니다. 지금 노출은 ${ymdKst(r.paidTo)}까지 그대로입니다.`);
  }
  async function toggleHistory(id: string) {
    if (hist[id]) { setHist({ ...hist, [id]: null }); return; }
    try { setHist({ ...hist, [id]: await api<History>(`/admin/directory/${id}/history`) }); }
    catch { a.setErr('이력을 불러오지 못했습니다.'); }
  }
  async function issue(i: Invoice) {
    const f = get(i.id);
    if (!f.no.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(f.on)) { a.setErr('발행 번호와 발행일을 넣어 주십시오.'); return; }
    await a.run(i.id, () => api(`/admin/directory/invoices/${i.id}/issue`, { method: 'POST', body: JSON.stringify({ invoiceNo: f.no.trim(), issuedOn: f.on }) }),
      invoices.reload, `${i.buyerName} — 세금계산서 발행 번호 ${f.no.trim()}를 넣었습니다(발행됨).`);
  }

  const money = (r: { monthlyFee: number | null; months: number | null; totalAmount: number | null }) => r.monthlyFee != null ? (
    <span className="hint" data-dir-fee="">월 {n(r.monthlyFee)}원 (부가세 별도){r.months && r.totalAmount != null ? ` · 최근 입금 ${r.months}개월 합계 ${n(r.totalAmount)}원` : ''}</span>
  ) : null;

  return (
    <section data-directory-admin="1">
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <p className="lead">리드를 만들지 않는 업종입니다. 입금 확인 뒤 기간을 켜고, 기간이 지나면 자동으로 빠집니다. 노출료는 부가세 별도이고, 입금 확인마다 세금계산서 발행 요청이 1건 생깁니다.</p>
      <p className="card" data-base-fee={base}>
        <b>월 노출료 기준 금액</b>{' '}
        <input name="base-fee" aria-label="월 노출료 기준 금액" inputMode="numeric" style={{ width: 120 }}
               value={baseInput ?? base} onChange={(e) => setBaseInput(e.target.value)} /> 원 (부가세 별도){' '}
        <button data-act="save-base" disabled={a.busy === 'base' || settings.loading || (baseInput ?? base) === base} onClick={() => void saveBase()}>
          {a.busy === 'base' ? '저장 중…' : '기준 금액 등록'}
        </button>{' '}
        <span className="hint" data-vat-note="">
          {baseOk ? `지금 ${n(base)}원 — 「월 ${n(base)}원 (부가세 별도)」 · 입금 합계는 월 ${n(Number(base) + vatOf(Number(base)))}원 × 개월수. 노출을 켤 때 금액을 비우면 이 금액으로 기록합니다.` : '등록된 기준 금액이 없습니다 — 노출을 켤 때 금액을 직접 적어야 합니다.'}
          {' '}바꿔도 이미 켠 노출 · 이미 낸 연장 신청의 금액은 그대로입니다.
        </span>
      </p>
      <div className="row">
        {([['PENDING', '대기'], ['RENEW_REQUESTED', '연장 신청'], ['ACTIVE', '노출 중'], ['ENDED', '종료'], ['REJECTED', '반려'], ['INVOICES', '세금계산서']] as const).map(([k, t]) => (
          <button key={k} className={state === k ? 'on' : ''} data-dir-state={k}
                  onClick={() => { setState(k); if (k === 'INVOICES') invoices.reload(); /* 입금 확인 뒤 새로 생긴 발행 요청을 다시 읽음 */ }}>{t}</button>
        ))}
      </div>
      <Flash msg={a.msg} err={a.err} />

      {isInv ? (
        <div data-dir-invoices="1">
          <p className="hint">공급자 = 소개하는 자(운영 법인) · 공급받는 자 = 노출료를 낸 업체. 「발행」은 국세청 전자세금계산서 어댑터로 보냅니다(v10.34) — 업체 연동 전에는 간주 모드라 「간주 발행」으로만 기록되고 승인번호가 없습니다. 홈택스 등에서 따로 발행했다면 「손으로 번호」(연동 전 임시 방식)로 넣습니다.</p>
          <EtaxBanner />
          <div className="row">
            {([['REQUESTED', '발행 요청'], ['ISSUED', '발행됨']] as const).map(([k, t]) => (
              <button key={k} className={invState === k ? 'on' : ''} data-inv-state={k} onClick={() => setInvState(k)}>{t}</button>
            ))}
          </div>
          {invoices.error ? <ErrorView error={invoices.error} onRetry={invoices.reload} /> : null}
          {invoices.data && invoices.data.length === 0 ? <p className="empty">해당하는 세금계산서가 없습니다.</p> : null}
          {invoices.data && invoices.data.length > 0 ? (
            <table className="tbl">
              <thead><tr><th>공급받는 자</th><th>회차 · 기간</th><th>공급가액</th><th>부가세</th><th>합계</th><th>공급자</th><th>발행</th></tr></thead>
              <tbody>{invoices.data.map((i) => {
                const f = get(i.id);
                return (
                  <tr key={i.id} data-inv-row={i.id} data-inv-state={i.state}>
                    <td><b>{i.buyerName}</b><br /><span className="hint">{i.buyerBizNo} · {i.displayName}</span></td>
                    <td>{i.seq}회차({KIND[i.kind] ?? i.kind}){i.months ? ` · ${i.months}개월` : ''}<br /><span className="hint">{ymdKst(i.from)} ~ {ymdKst(i.to)}</span></td>
                    <td>{n(i.supply)}원</td><td>{n(i.vat)}원</td><td><b>{n(i.total)}원</b></td>
                    <td><span className="hint">{i.supplierName}<br />{i.supplierBizNo}</span></td>
                    <td>{i.state === 'ISSUED' ? <>발행됨 · {i.invoiceNo}<br /><span className="hint">{ymdKst(i.issuedOn)}</span></> : null}
                      {/* v10.34 — 국세청 전송 상태 · 승인번호 · 간주 표시 · 발행 · 다시 보내기 · 상태 조회 · 취소 */}
                      <EtaxCell kind="directory" row={i} act={a} reload={invoices.reload} assume={etaxAssume} />
                      {i.state === 'REQUESTED' && !i.etaxStatus ? (
                      <div data-manual-issue="">
                        <span className="hint">홈택스 발행 번호 넣기(업체 연동 전 발행 방법) — 홈택스에서 발행한 승인번호 · 발행일:</span><br />
                        <input aria-label="발행 번호" placeholder="홈택스 승인번호" value={f.no} onChange={(e) => put(i.id, 'no', e.target.value)} />
                        <input aria-label="발행일" type="date" value={f.on} onChange={(e) => put(i.id, 'on', e.target.value)} />
                        <button data-act="issue" disabled={a.busy === i.id} onClick={() => void issue(i)}>발행됨으로</button>
                      </div>
                    ) : null}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : null}
        </div>
      ) : (
        <>
          {list.error ? <ErrorView error={list.error} onRetry={list.reload} /> : null}
          {list.data && list.data.length === 0 ? <p className="empty">해당하는 항목이 없습니다.</p> : null}
          {list.data && list.data.length > 0 ? (
            <table className="tbl">
              <thead><tr><th>업체</th><th>업종</th><th>자격</th><th>상태 · 기간</th><th>처리</th></tr></thead>
              <tbody>{list.data.map((r) => {
                const f = get(r.id);
                const qt = quote(r.id);
                const h = hist[r.id];
                return (
                  <tr key={r.id} data-dir-row={r.id}>
                    <td><b>{r.displayName}</b><br /><span className="hint">{r.company} · {r.bizRegNo ?? '개인'} · {r.contactPhone}</span></td>
                    <td>{r.categoryName}</td>
                    <td>{r.qualified ? '확인' : '미확인 — 자격 심사 먼저'}</td>
                    <td>{STATE[r.state] ?? r.state}{r.lapsed ? <b className="hint"> · 기간 지남</b> : null}
                      {r.paidFrom ? <><br /><span className="hint">{ymdKst(r.paidFrom)} ~ {ymdKst(r.paidTo)}{r.rounds ? ` · ${r.rounds}회차` : ''}</span></> : null}
                      {r.monthlyFee != null ? <><br />{money(r)}</> : null}
                      {r.reason ? <span className="hint"> — {r.reason}</span> : null}
                      {r.rounds > 0 ? <><br /><button className="link" data-act="history" onClick={() => void toggleHistory(r.id)}>{h ? '이력 닫기' : '회차 이력'}</button></> : null}
                      {h ? (
                        <div data-dir-history={r.id} className="hint">
                          {h.periods.map((p) => <div key={p.id}>{p.seq}회차 {KIND[p.kind] ?? p.kind} · {ymdKst(p.from)} ~ {ymdKst(p.to)}{p.totalAmount != null ? ` · 합계 ${n(p.totalAmount)}원(공급가액 ${n(p.supplyAmount)} + 부가세 ${n(p.vatAmount)})` : p.monthlyFee != null ? ` · 월 ${n(p.monthlyFee)}원(이전 기록)` : ''}</div>)}
                          {h.renewals.map((x) => <div key={x.id}>연장 신청 {x.months}개월 · 합계 {n(x.totalAmount)}원 · {RSTATE[x.state] ?? x.state}{x.reason ? ` — ${x.reason}` : ''}</div>)}
                          {h.invoices.map((x) => <div key={x.id}>세금계산서 {x.seq}회차 · {n(x.total)}원 · {x.state === 'ISSUED' ? `발행됨 ${x.invoiceNo}` : '발행 요청'}{x.etaxStatus === 'ASSUMED' ? ' · 간주(국세청 전송 없음)' : x.etaxStatus === 'SENT' ? ' · 국세청 전송됨' : x.etaxStatus === 'FAILED' ? ' · 전송 실패' : x.etaxMode === 'MANUAL' ? ' · 손으로 번호' : ''}</div>)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {r.state === 'PENDING' ? (
                        <>
                          <input aria-label="월 노출료" placeholder={baseOk ? `기준 ${n(base)}원 (비우면 기준 금액)` : '월 노출료(원 · 부가세 별도)'} inputMode="numeric" value={f.fee} onChange={(e) => put(r.id, 'fee', e.target.value)} />
                          <input aria-label="시작일" type="date" value={f.from} onChange={(e) => put(r.id, 'from', e.target.value)} />
                          <select aria-label="개월수" value={f.months} onChange={(e) => put(r.id, 'months', e.target.value)}>
                            {MONTHS.map((m) => <option key={m} value={m}>{m}개월</option>)}
                          </select>
                          <input aria-label="입금 근거" placeholder="입금자 · 거래번호" value={f.ref} onChange={(e) => put(r.id, 'ref', e.target.value)} />
                          {qt ? <span className="hint" data-dir-quote={qt.total}> 입금 확인 금액: 공급가액 {n(qt.supply)}원 + 부가세 {n(qt.vat)}원 = <b>합계 {n(qt.total)}원</b></span> : null}
                          <button disabled={a.busy === r.id || !r.qualified} title={!r.qualified ? '자격 심사가 먼저입니다' : undefined}
                                  data-act="activate" onClick={() => void activate(r)}>입금 확인 · 노출 켜기</button>
                          <input aria-label="사유" placeholder="반려 사유 (5자 이상)" value={f.why} onChange={(e) => put(r.id, 'why', e.target.value)} />
                          <button disabled={a.busy === r.id} data-act="reject" onClick={() => void close(r, 'reject')}>반려</button>
                        </>
                      ) : r.state === 'RENEW_REQUESTED' && r.renewal ? (
                        <>
                          <span data-dir-renewal={r.renewal.totalAmount}>연장 신청 <b>{r.renewal.months}개월</b> · {ymdKst(r.renewal.from)} ~ {ymdKst(r.renewal.to)}<br />
                            <span className="hint">월 {n(r.renewal.monthlyFee)}원 (부가세 별도) × {r.renewal.months} = 공급가액 {n(r.renewal.supplyAmount)}원 + 부가세 {n(r.renewal.vatAmount)}원</span><br />
                            입금 확인 금액 <b>합계 {n(r.renewal.totalAmount)}원</b></span><br />
                          <input aria-label="입금 근거" placeholder="입금자 · 거래번호" value={f.ref} onChange={(e) => put(r.id, 'ref', e.target.value)} />
                          <button disabled={a.busy === r.id} data-act="renew-confirm" onClick={() => void renewConfirm(r)}>연장 입금 확인</button>
                          <input aria-label="사유" placeholder="반려 · 종료 사유 (5자 이상)" value={f.why} onChange={(e) => put(r.id, 'why', e.target.value)} />
                          <button disabled={a.busy === r.id} data-act="renew-reject" onClick={() => void renewReject(r)}>연장 반려</button>
                          <button disabled={a.busy === r.id} data-act="end" onClick={() => void close(r, 'end')}>종료</button>
                        </>
                      ) : r.state === 'ACTIVE' ? (
                        <>
                          <span className="hint">기간 연장은 업체의 「연장 신청」 → 「연장 신청」 탭에서 입금 확인합니다.</span><br />
                          <input aria-label="사유" placeholder="종료 사유 (5자 이상)" value={f.why} onChange={(e) => put(r.id, 'why', e.target.value)} />
                          <button disabled={a.busy === r.id} data-act="end" onClick={() => void close(r, 'end')}>종료</button>
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : null}
        </>
      )}
    </section>
  );
}
