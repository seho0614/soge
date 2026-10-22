import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { EtaxBanner, EtaxCell, useEtaxAssume, type EtaxRow } from '../../components/Etax';

/**
 * v10.31 — W5(파트너센터 · 리드 이용료 선불 충전 잔액)의 운영 쪽 화면.
 * API 이름은 /home/claude/work/v3/SHARED_NOTES.md 「W5 … 운영 API(w6 화면 이름)」 그대로입니다.
 *   GET  /admin/partner-center/cash · GET /admin/partner-center/cash/{partnerId} · POST …/cash/{partnerId}/adjust · POST …/cash/auto-run
 *   GET  /admin/partner-center/change-requests?state= · POST …/change-requests/{id}/decide
 *   GET  /admin/partner-center/lead-cash-invoices?ym= · POST …/lead-cash-invoices/run · POST …/lead-cash-invoices/{id}/issue
 *   v10.34 (D093) 국세청 전송 — POST /admin/etax/lead-cash/{id}/send · resend · refresh · cancel · GET /admin/etax/status (components/Etax)
 *   GET  /admin/partner-center/rules · PUT …/rules/bonus-rates/{grade} · PUT …/rules/grades/{grade}
 * v10.31 합침 — W5 API 와 연결됨. 서버가 404 를 주면(서버 판이 이 화면보다 옛 판) 안내만 보입니다.
 */
const PC = '/admin/partner-center';
export const missing = (e: unknown) => e instanceof ApiFailure && e.status === 404;
/** 사업자번호 가운데 가림 — 서버가 원문을 주더라도 화면에는 가려서(규칙 3) */
export const maskBiz = (v?: string | null) => {
  if (!v) return '—';
  const d = v.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-**-***${d.slice(8)}` : v.replace(/\d(?=\d{2})/g, '*');
};
function Pending({ what, api: path }: { what: string; api: string }) {
  return (
    <div className="ad-nt info" data-merge-pending={path}>
      <b>서버에 이 기능이 없습니다 — {what}.</b> 이 화면은 <span className="mono">{path}</span> 를 씁니다. 서버(API)가 운영 화면과 같은 판(v10.31 이상)인지 확인하십시오.
    </div>
  );
}

interface Wallet {
  partnerId: string; company: string; grade: string; status: string; paid: number; bonus: number;
  autoOn: boolean; autoBelow: number | null; autoAmount: number | null; autoFailReason: string | null;
  charged: number; refunded: number; unknownCharges: number;
}
interface Wallets { items: Wallet[]; totals: { paid: number; bonus: number }; invariants: { ok: boolean; items: Array<{ code: string; partnerId: string; ref: string; detail: string }> }; note: string }
interface Ledger {
  partner: { id: string; company: string; grade: string };
  entries: Array<{ id: number; kind: string; memo: string | null; at: string; createdBy: string | null; lines: Array<{ account: string; amount: number }> }>;
  charges: Array<{ id: string; orderId: string; amount: number; bonus: number; source: string; state: string; stub: boolean; approvedAt: string | null; refunded: number; failReason: string | null; createdAt: string }>;
  refunds: Array<{ id: string; amount: number; refunded: number; state: string; reason: string; createdAt: string }>;
  invariants: Array<{ code: string; ref: string; detail: string }>;
}
const CHARGE_ST: Record<string, [string, string]> = {
  DONE: ['충전 완료', 'ok'], PENDING: ['결제 대기', 'wait'], UNKNOWN: ['확인 필요', 'no'], FAILED: ['실패', ''], CANCELED: ['취소', ''],
};

/** SB-ADM-PTN-080 위 구역 — 선불 충전 잔액(파트너별) · 원장 · 조정 */
export function CashWallets() {
  const w = useApi<Wallets>(`${PC}/cash`);
  const a = useAct();
  const [open, setOpen] = useState<string | null>(null);
  if (w.error && missing(w.error)) return <Pending what="리드 이용료 선불 충전 잔액" api={`${PC}/cash`} />;
  if (w.error) return <ErrorView error={w.error} onRetry={w.reload} />;
  if (!w.data) return <p className="muted">불러오는 중…</p>;
  const d = w.data;
  const unknown = d.items.reduce((s, i) => s + Number(i.unknownCharges || 0), 0);
  return (
    <>
      <div className="ad-rw" data-cash-totals>
        <div className="ad-rc"><span>유상 잔액 합계</span><b>{n(d.totals.paid)}원</b><small>선불로 보관 중(자사 이용료 선납 한정)</small></div>
        <div className="ad-rc"><span>보너스 잔액</span><b>{n(d.totals.bonus)}원</b><small>등급 할인 — 환불 대상 아님</small></div>
        <div className={`ad-rc${unknown ? ' warn' : ''}`}><span>입금 확인 대기</span><b>{unknown}</b><small>결제 결과 확인 필요</small></div>
        <div className={`ad-rc${d.invariants.ok ? '' : ' no'}`}><span>원장 불변식</span><b>{d.invariants.ok ? '정상' : `${d.invariants.items.length}줄`}</b><small>0줄이어야 정상</small></div>
      </div>
      {!d.invariants.ok && (
        <div className="ad-nt warn"><b>원장 점검이 먼저입니다.</b> {d.invariants.items.slice(0, 5).map((i) => `${i.code} ${i.detail}`).join(' · ')}</div>
      )}
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-tw"><table className="tbl" data-cash-wallets>
        <thead><tr><th>파트너사</th><th>등급</th><th className="num-cell">유상 잔액</th><th className="num-cell">보너스</th>
          <th className="num-cell">충전 누계</th><th className="num-cell">환불</th><th>자동 청구</th><th /></tr></thead>
        <tbody>
          {d.items.length === 0 && <tr><td colSpan={8} className="muted">충전한 파트너가 없습니다.</td></tr>}
          {d.items.map((i) => (
            <tr key={i.partnerId} className={i.unknownCharges ? 'hl' : undefined}>
              <td><b>{i.company}</b>{i.unknownCharges > 0 && <span className="ad-ls" style={{ color: 'var(--danger)' }}>확인 필요 결제 {i.unknownCharges}건</span>}</td>
              <td>{i.grade}</td>
              <td className="num-cell money-cell">{n(i.paid)}원</td><td className="num-cell">{n(i.bonus)}원</td>
              <td className="num-cell">{n(i.charged)}원</td><td className="num-cell">{n(i.refunded)}원</td>
              <td>{i.autoOn ? <>켜짐 <span className="ad-ls">{n(i.autoBelow)}원 미만이면 {n(i.autoAmount)}원</span></> : <span className="dim">꺼짐</span>}
                {i.autoFailReason && <span className="ad-ls" style={{ color: 'var(--danger)' }}>{i.autoFailReason}</span>}</td>
              <td><button className="btn-plain btn-sm" onClick={() => setOpen(open === i.partnerId ? null : i.partnerId)}>{open === i.partnerId ? '닫기' : '원장'}</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-dact">
        <button className="btn-plain" disabled={a.busy === 'auto'} onClick={() => a.run('auto', () => api(`${PC}/cash/auto-run`, { method: 'POST', body: '{}' }), w.reload, '자동 청구를 한 번 돌렸습니다.')}>자동 청구 지금 돌리기</button>
      </div>
      {open && <CashLedger id={open} onDone={w.reload} />}
      <p className="dim" style={{ fontSize: 12 }}>{d.note}</p>
    </>
  );
}

function CashLedger({ id, onDone }: { id: string; onDone: () => void }) {
  const l = useApi<Ledger>(`${PC}/cash/${id}`);
  const a = useAct();
  const [acc, setAcc] = useState<'PAID' | 'BONUS'>('BONUS');
  const [amt, setAmt] = useState('');
  const [why, setWhy] = useState('');
  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  if (!l.data) return <p className="muted">불러오는 중…</p>;
  const d = l.data;
  const adjust = () => a.run('adj', () => api(`${PC}/cash/${id}/adjust`, { method: 'POST', body: JSON.stringify({ account: acc, amount: Number(amt), reason: why }) }),
    () => { setAmt(''); setWhy(''); l.reload(); onDone(); }, '조정했습니다 — 원장에 반대 기입으로 남습니다.');
  return (
    <section className="ad-panel" data-cash-ledger={id}>
      <h3 className="sec">{d.partner.company} — 원장 · 충전 · 환불</h3>
      <h4>입금 확인 대기 · 충전</h4>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>번호</th><th>구분</th><th className="num-cell">금액</th><th>일자</th><th>상태</th></tr></thead>
        <tbody>{d.charges.length === 0 ? <tr><td colSpan={5} className="muted">충전 기록이 없습니다.</td></tr> : d.charges.map((c) => {
          const s = CHARGE_ST[c.state] ?? [c.state, ''];
          return <tr key={c.id}><td className="mono">{c.orderId}</td><td>{c.source}{c.stub ? ' · 시험 결제' : ''}</td>
            <td className="num-cell">{n(c.amount)}원{c.bonus ? <span className="ad-ls">보너스 {n(c.bonus)}원</span> : null}</td>
            <td>{ymdhm(c.approvedAt ?? c.createdAt)}</td><td><span className={`ad-bg ${s[1]}`}>{s[0]}</span>{c.failReason && <span className="ad-ls">{c.failReason}</span>}</td></tr>;
        })}</tbody>
      </table></div>
      <h4>원장(최근 300줄 · 고치기/지우기 없음)</h4>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>일시</th><th>종류</th><th>줄</th><th>메모</th></tr></thead>
        <tbody>{d.entries.map((e) => <tr key={e.id}><td>{ymdhm(e.at)}</td><td className="mono">{e.kind}</td>
          <td className="mono" style={{ fontSize: 12 }}>{e.lines.map((x) => `${x.account} ${x.amount > 0 ? '+' : ''}${n(x.amount)}`).join(' / ')}</td>
          <td>{e.memo ?? '—'}{e.createdBy && <span className="ad-ls">{e.createdBy}</span>}</td></tr>)}</tbody>
      </table></div>
      <h4>잔액 조정</h4>
      <div className="ad-form">
        <select value={acc} onChange={(e) => setAcc(e.target.value as 'PAID' | 'BONUS')} aria-label="조정할 잔액"><option value="BONUS">보너스</option><option value="PAID">유상</option></select>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="+ 늘림 · − 줄임 (원)" aria-label="조정 금액" inputMode="numeric" />
        <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="조정 사유(다섯 글자 이상 · 원장에 남음)" aria-label="조정 사유" />
        <button className="btn-ok" disabled={!amt.trim() || why.trim().length < 5 || a.busy === 'adj'} onClick={adjust}>조정</button>
      </div>
      <Flash msg={a.msg} err={a.err} />
    </section>
  );
}

/** 사업자 정보 변경 요청(파트너센터 › 회사 정보) — 승인하면 사업자 정보에 바로 반영 */
interface Change { id: string; field: string; beforeValue: string | null; afterValue: string; reason: string | null; state: string; decisionReason: string | null; createdAt: string; decidedAt: string | null; company: string; bizRegNo: string }
const CH_ST: Record<string, [string, string]> = { REQUESTED: ['대기', 'wait'], APPROVED: ['승인', 'ok'], REJECTED: ['반려', 'no'] };
export function ChangeRequests() {
  const [st, setSt] = useState('REQUESTED');
  const l = useApi<Change[]>(`${PC}/change-requests?state=${st}`);
  const a = useAct();
  const [why, setWhy] = useState<Record<string, string>>({});
  if (l.error && missing(l.error)) return <Pending what="사업자 정보 변경 요청" api={`${PC}/change-requests`} />;
  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  const rows = l.data ?? [];
  const decide = (c: Change, approve: boolean) => a.run(c.id, () => api(`${PC}/change-requests/${c.id}/decide`, { method: 'POST', body: JSON.stringify({ approve, reason: why[c.id] ?? '' }) }),
    l.reload, approve ? `${c.company} 변경을 승인했습니다 — 사업자 정보에 반영됩니다.` : `${c.company} 변경 요청을 반려했습니다.`);
  return (
    <>
      <div className="ad-chk">
        {[['REQUESTED', '대기'], ['APPROVED', '승인'], ['REJECTED', '반려'], ['ALL', '전체']].map(([k, t]) => (
          <button key={k} className={st === k ? 'btn-ok btn-sm' : 'btn-plain btn-sm'} onClick={() => setSt(k!)}>{t}</button>))}
      </div>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-tw"><table className="tbl" data-change-requests>
        <thead><tr><th>파트너사</th><th>항목</th><th>전 → 후</th><th>사유</th><th>상태</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">{st === 'REQUESTED' ? '처리할 변경 요청이 없습니다.' : '해당하는 요청이 없습니다.'}</td></tr>}
          {rows.map((c) => { const s = CH_ST[c.state] ?? [c.state, '']; return (
            <tr key={c.id}>
              <td><b>{c.company}</b><span className="ad-ls mono">{maskBiz(c.bizRegNo)} · {ymdhm(c.createdAt)}</span></td>
              <td>{c.field}</td><td>{c.beforeValue ?? '—'} → <b>{c.afterValue}</b></td><td>{c.reason ?? '—'}{c.decisionReason && <span className="ad-ls">처리 사유: {c.decisionReason}</span>}</td>
              <td><span className={`ad-bg ${s[1]}`}>{s[0]}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>{c.state === 'REQUESTED' && <>
                <button className="btn-ok btn-sm" disabled={a.busy === c.id} onClick={() => decide(c, true)}>승인</button>{' '}
                <input style={{ width: 120 }} value={why[c.id] ?? ''} onChange={(e) => setWhy((w) => ({ ...w, [c.id]: e.target.value }))} placeholder="반려 사유" aria-label="반려 사유" />{' '}
                <button className="btn-no btn-sm" disabled={!(why[c.id] ?? '').trim() || a.busy === c.id} onClick={() => decide(c, false)}>반려</button></>}</td>
            </tr>); })}
        </tbody>
      </table></div>
    </>
  );
}

/** 리드 이용료 세금계산서 발행 요청(월 단위) — v10.34 「발행」은 국세청 전자세금계산서 어댑터(연동 전 간주) · 손으로 번호는 연동 전 임시 방식 */
interface Inv extends EtaxRow { id: string; ym: string; total: number; supply: number; vat: number; state: string; invoiceNo: string | null; issuedOn: string | null; company: string; bizRegNo: string }
export function CashInvoices() {
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [ym, setYm] = useState(lastMonth);
  const l = useApi<Inv[]>(`${PC}/lead-cash-invoices?ym=${ym}`);
  const a = useAct();
  const [no, setNo] = useState<Record<string, string>>({});
  const today = new Date().toISOString().slice(0, 10);
  const etaxAssume = useEtaxAssume();  /* v10.34 */
  if (l.error && missing(l.error)) return <Pending what="리드 이용료 세금계산서 발행 요청" api={`${PC}/lead-cash-invoices`} />;
  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  const rows = l.data ?? [];
  return (
    <>
      <div className="ad-chk">
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} aria-label="발행 월" />
        <button className="btn-plain btn-sm" disabled={a.busy === 'run'} onClick={() => a.run('run', () => api(`${PC}/lead-cash-invoices/run`, { method: 'POST', body: JSON.stringify({ ym }) }), l.reload)}>이 달 발행 요청 만들기</button>
      </div>
      <Flash msg={a.msg} err={a.err} />
      <EtaxBanner />
      <div className="ad-tw"><table className="tbl" data-cash-invoices>
        <thead><tr><th>파트너사</th><th className="num-cell">공급가</th><th className="num-cell">부가세</th><th className="num-cell">합계</th><th>발행</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="muted">{ym} 발행 요청이 없습니다.</td></tr>}
          {rows.map((i) => (
            <tr key={i.id}>
              <td><b>{i.company}</b><span className="ad-ls mono">{maskBiz(i.bizRegNo)}</span></td>
              <td className="num-cell">{n(i.supply)}원</td><td className="num-cell">{n(i.vat)}원</td><td className="num-cell money-cell">{n(i.total)}원</td>
              <td>{i.state === 'ISSUED' ? <><span className="ad-bg ok">발행</span> <span className="mono">{i.invoiceNo}</span> · {i.issuedOn}<br /></> : null}
                {/* v10.34 — 국세청 전송 상태 · 승인번호 · 간주 표시 · 발행 · 다시 보내기 · 상태 조회 · 취소 */}
                <EtaxCell kind="lead-cash" row={i} act={a} reload={l.reload} assume={etaxAssume} />
                {i.state === 'REQUESTED' && !i.etaxStatus ? <div data-manual-issue=""><span className="dim">홈택스 발행 번호 넣기(업체 연동 전) — 승인번호:</span>{' '}
                <input style={{ width: 140 }} value={no[i.id] ?? ''} onChange={(e) => setNo((x) => ({ ...x, [i.id]: e.target.value }))} placeholder="발행 번호" aria-label="발행 번호" />{' '}
                <button className="btn-ok btn-sm" disabled={!(no[i.id] ?? '').trim() || a.busy === i.id}
                        onClick={() => a.run(i.id, () => api(`${PC}/lead-cash-invoices/${i.id}/issue`, { method: 'POST', body: JSON.stringify({ invoiceNo: no[i.id], issuedOn: today }) }), l.reload, '발행으로 표시했습니다.')}>발행 표시</button></div> : null}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

/** 등급 할인(보너스) 비율 · 파트너 등급 기준 */
interface Rules { bonusRates: Array<{ grade: string; rate: number | string; note: string | null }>; gradeRules: Array<{ grade: string; rank: number; minMonthEarned: number | null; note: string | null }> }
export function CashRules() {
  const r = useApi<Rules>(`${PC}/rules`);
  const a = useAct();
  const [v, setV] = useState<Record<string, string>>({});
  if (r.error && missing(r.error)) return <Pending what="등급 할인 비율 · 파트너 등급 기준" api={`${PC}/rules`} />;
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  return (
    <div className="ad-tw"><table className="tbl" data-cash-rules>
      <thead><tr><th>구분</th><th>등급</th><th>지금</th><th>바꾸기</th></tr></thead>
      <tbody>
        {r.data.bonusRates.map((b) => (
          <tr key={`b${b.grade}`}><td>충전 보너스 비율</td><td><b>{b.grade}</b></td><td className="num-cell">{Math.round(Number(b.rate) * 1000) / 10}%</td>
            <td><input style={{ width: 80 }} value={v[`b${b.grade}`] ?? ''} onChange={(e) => setV((x) => ({ ...x, [`b${b.grade}`]: e.target.value }))} placeholder="%" aria-label={`${b.grade} 보너스 비율`} />{' '}
              <button className="btn-plain btn-sm" disabled={!(v[`b${b.grade}`] ?? '').trim()} onClick={() => a.run(`b${b.grade}`, () => api(`${PC}/rules/bonus-rates/${b.grade}`, { method: 'PUT', body: JSON.stringify({ rate: Number(v[`b${b.grade}`]) / 100 }) }), r.reload)}>저장</button></td></tr>
        ))}
        {r.data.gradeRules.map((g) => (
          <tr key={`g${g.grade}`}><td>파트너 등급 기준(월 확정 수수료)</td><td><b>{g.grade}</b></td><td className="num-cell">{g.minMonthEarned == null ? <span className="dim">미정</span> : `${n(g.minMonthEarned)}원`}</td>
            <td><input style={{ width: 110 }} value={v[`g${g.grade}`] ?? ''} onChange={(e) => setV((x) => ({ ...x, [`g${g.grade}`]: e.target.value }))} placeholder="원" aria-label={`${g.grade} 등급 기준`} />{' '}
              <button className="btn-plain btn-sm" disabled={!(v[`g${g.grade}`] ?? '').trim()} onClick={() => a.run(`g${g.grade}`, () => api(`${PC}/rules/grades/${g.grade}`, { method: 'PUT', body: JSON.stringify({ minMonthEarned: Number(v[`g${g.grade}`]) }) }), r.reload)}>저장</button></td></tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={4}><Flash msg={a.msg} err={a.err} /></td></tr></tfoot>
    </table></div>
  );
}
