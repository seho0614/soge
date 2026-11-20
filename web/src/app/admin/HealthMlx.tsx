/* ===== v10.505 · 506 (D274 · docs/643 · 644) 소개몰 재입고 알림 · 현금영수증 — web/src/app/admin/HealthMlx.tsx 새 파일 =====
 * 대표 11/20 「㊹ ① ②」 — 「주문 받기」가 꺼진 지금은 운영 화면 먼저(회원 화면은 상품 상세 「입고되면 알림」 단추만 · 현금영수증 신청은 서버 준비)
 *   HealthRestock       소개몰 › 재입고 알림 — 스위치 · 기다리는 옵션 순위 · 최근 신청(이름 가림) · 「지금 보내기」(따라잡기)
 *   HealthCashReceipts  소개몰 › 현금영수증 — 방식(간주 · 실제) · 준비 · 상태별 수 · 이번 달 · 지난달 합 · 목록(가린 번호) · 운영 발급 · 다시 보내기 · 취소 · 지금 돌리기
 * 새 CSS 없음(기존 tbl · card · pad · btn-sm · btn-plain · muted · warn-text · num) — 어두운 테마 그대로
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const won = (v: number | string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));

interface RestockView {
  on: boolean; waiting: number; members: number; notified30: number; canceled30: number; expired30: number; keepDays: number; maxPerMember: number; note: string;
  options: Array<{ optionId: string; productCode: string; productName: string; label: string; stock: number; active: boolean; status: string; waiting: number; oldestAt: string }>;
  recent: Array<{ id: string; member: string; productCode: string; productName: string; label: string; state: string; createdAt: string; notifiedAt: string | null; expiresAt: string }>;
}
const RS_STATE: Record<string, string> = { WAITING: '기다림', NOTIFIED: '알림 보냄', CANCELED: '취소', EXPIRED: '기한 지남' };

export function HealthRestock() {
  const q = useApi<RestockView>('/admin/health/restock');
  const a = useAct();
  const d = q.data;
  if (!d) return <div className="card pad">{q.error ? '불러오지 못했습니다.' : '불러오는 중…'}</div>;
  return (
    <div data-hlt-restock={d.waiting}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <b>재입고 알림 {d.on ? '켜짐' : '꺼짐'}</b> <span className="muted">(설정 mall.restock_alert · 기다림 {d.keepDays}일 · 회원당 {d.maxPerMember}개)</span>
        <p className="muted">{d.note}</p>
        <p>기다림 <b className="num">{won(d.waiting)}</b>건(회원 {won(d.members)}명) · 최근 30일 알림 {won(d.notified30)} · 취소 {won(d.canceled30)} · 기한 지남 {won(d.expired30)}</p>
        <button className="btn-sm" disabled={!d.on || a.busy === 'run'} data-hlt-restock-run=""
          onClick={() => void a.run('run', () => api('/admin/health/restock/run', { method: 'POST', body: '{}' }), q.reload)}>지금 보내기(재고가 이미 돌아온 옵션)</button>
      </div>
      <h3>기다리는 옵션</h3>
      <table className="tbl"><thead><tr><th>상품</th><th>옵션</th><th>재고</th><th>상태</th><th className="num">기다림</th><th>가장 오래된 신청</th></tr></thead>
        <tbody>{d.options.length === 0 ? <tr><td colSpan={6} className="muted">기다리는 신청이 없습니다.</td></tr> : d.options.map((o) => (
          <tr key={o.optionId}><td>{o.productName} <span className="muted">{o.productCode}</span></td><td>{o.label}</td>
            <td className={o.stock > 0 && o.active ? '' : 'warn-text'}>{o.active ? won(o.stock) : '꺼짐'}</td><td>{o.status}</td><td className="num">{won(o.waiting)}</td><td>{ymdhm(o.oldestAt)}</td></tr>))}</tbody></table>
      <h3>최근 신청</h3>
      <table className="tbl"><thead><tr><th>회원</th><th>상품 · 옵션</th><th>상태</th><th>신청</th><th>알림</th><th>기한</th></tr></thead>
        <tbody>{d.recent.map((r) => (
          <tr key={r.id}><td>{r.member}</td><td>{r.productName} · {r.label}</td><td>{RS_STATE[r.state] ?? r.state}</td><td>{ymdhm(r.createdAt)}</td><td>{r.notifiedAt ? ymdhm(r.notifiedAt) : '—'}</td><td>{ymdhm(r.expiresAt)}</td></tr>))}</tbody></table>
    </div>
  );
}

interface CrRow { id: string; orderNo: string; purpose: string; idKind: string; idMask: string; amount: number | null; taxFree: number; supply: number | null; vat: number | null; state: string; source: string;
  docKey: string; approvalNo: string | null; adapter: string | null; attempts: number; lastError: string | null; cancelReason: string | null; issuedAt: string | null; canceledAt: string | null; createdAt: string; member?: string; reissueOf: string | null }
interface CrView { on: boolean; mode: string; ready: boolean; readyNote: string | null; self: boolean; selfMin: number; requestDays: number; keepYears: number; note: string;
  counts: Record<string, number>; months: Array<{ month: string; n: number; amount: number; supply: number; vat: number; taxFree: number; assumed: number }>; items: CrRow[] }
const CR_STATE: Record<string, string> = { REQUESTED: '결제 기다림', PENDING: '발급 대기', ISSUED: '발급', ASSUMED: '간주 발급', FAILED: '실패', CANCEL_PENDING: '취소 대기', CANCELED: '취소', SKIPPED: '대상 아님 · 닫음' };
const CR_PURPOSE: Record<string, string> = { INCOME: '소득공제', EXPENSE: '지출증빙' };

export function HealthCashReceipts() {
  const [st, setSt] = useState('');
  const q = useApi<CrView>(`/admin/health/cash-receipts${st ? `?state=${st}` : ''}`, [st]);
  const a = useAct();
  const [f, setF] = useState({ orderNo: '', purpose: 'INCOME', number: '', reason: '' });
  const d = q.data;
  if (!d) return <div className="card pad">{q.error ? '불러오지 못했습니다.' : '불러오는 중…'}</div>;
  const cancel = (r: CrRow) => {
    const reason = window.prompt(`주문 ${r.orderNo} 현금영수증을 취소할 사유`);
    if (reason && reason.trim().length >= 2) void a.run(`c${r.id}`, () => api(`/admin/health/cash-receipts/${r.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload);
  };
  return (
    <div data-hlt-cashrcpt={d.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <b>현금영수증 {d.on ? '켜짐' : '꺼짐'}</b> · 방식 <b>{d.mode === 'LIVE' ? '실제(토스페이먼츠)' : '간주(업체 호출 없음)'}</b>
        {!d.ready && <span className="warn-text"> · 준비 안 됨 — {d.readyNote}</span>}
        <p className="muted">자진발급 {d.self ? `켜짐(${won(d.selfMin)}원 이상)` : '꺼짐'} · 회원 신청 결제 뒤 {d.requestDays}일까지 · 번호 보관 {d.keepYears}년 · {d.note}</p>
        <p>{Object.entries(d.counts).map(([k, v]) => `${CR_STATE[k.toUpperCase()] ?? k} ${won(v)}`).join(' · ')}</p>
        <button className="btn-sm" disabled={a.busy === 'run'} data-hlt-cr-run=""
          onClick={() => void a.run('run', () => api('/admin/health/cash-receipts/run', { method: 'POST', body: '{}' }), q.reload,
            (r: any) => `발급 ${r?.issued ?? 0} · 간주 ${r?.assumed ?? 0} · 실패 ${r?.failed ?? 0} · 취소 ${r?.canceled ?? 0} · 다시 발급 ${r?.reissued ?? 0} · 준비 안 됨 ${r?.notReady ?? 0}`)}>지금 돌리기</button>
      </div>
      <h3>달마다 발급 합(부가세 신고 참고 · 간주 발급은 국세청 전송 없음)</h3>
      <table className="tbl"><thead><tr><th>달</th><th className="num">건수</th><th className="num">금액</th><th className="num">공급가액</th><th className="num">부가세</th><th className="num">면세</th><th className="num">간주</th></tr></thead>
        <tbody>{d.months.length === 0 ? <tr><td colSpan={7} className="muted">발급한 것이 없습니다.</td></tr> : d.months.map((m) => (
          <tr key={m.month}><td>{m.month}</td><td className="num">{won(m.n)}</td><td className="num">{won(m.amount)}</td><td className="num">{won(m.supply)}</td><td className="num">{won(m.vat)}</td><td className="num">{won(m.taxFree)}</td><td className="num">{won(m.assumed)}</td></tr>))}</tbody></table>
      <div className="card pad" data-hlt-cr-issue="">
        <b>운영 발급 신청</b> <span className="muted">(전화 요청 · 신청 기간이 지난 주문 — 직판 · 계좌이체 · 가상계좌만)</span>
        <p>
          <input placeholder="주문 번호" value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} />{' '}
          <select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}><option value="INCOME">소득공제(휴대폰)</option><option value="EXPENSE">지출증빙(사업자번호)</option></select>{' '}
          <input placeholder={f.purpose === 'INCOME' ? '010-0000-0000' : '000-00-00000'} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />{' '}
          <input placeholder="사유" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />{' '}
          <button className="btn-sm" disabled={a.busy === 'issue'}
            onClick={() => void a.run('issue', () => api('/admin/health/cash-receipts', { method: 'POST', body: JSON.stringify(f) }), () => { setF({ orderNo: '', purpose: 'INCOME', number: '', reason: '' }); q.reload(); })}>발급 대기로 넣기</button>
        </p>
      </div>
      <p>상태 <select value={st} onChange={(e) => setSt(e.target.value)} data-hlt-cr-state=""><option value="">모두</option>
        {Object.entries(CR_STATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></p>
      <table className="tbl"><thead><tr><th>문서</th><th>주문</th><th>회원</th><th>용도 · 번호</th><th className="num">금액</th><th>상태</th><th>승인번호</th><th>발급 · 취소</th><th>사유 · 오류</th><th /></tr></thead>
        <tbody>{d.items.map((r) => (
          <tr key={r.id}><td>{r.docKey}{r.reissueOf && <span className="muted"> (다시 발급)</span>}</td><td>{r.orderNo}</td><td>{r.member ?? '—'}</td>
            <td>{CR_PURPOSE[r.purpose] ?? r.purpose} · {r.idMask}{r.source === 'SELF' && <span className="muted"> 자진</span>}</td><td className="num">{won(r.amount)}</td>
            <td className={r.state === 'FAILED' ? 'warn-text' : ''}>{CR_STATE[r.state] ?? r.state}</td><td>{r.approvalNo ?? '—'}</td>
            <td>{r.issuedAt ? ymdhm(r.issuedAt) : '—'}{r.canceledAt && <> / {ymdhm(r.canceledAt)}</>}</td><td className="muted">{r.cancelReason ?? r.lastError ?? ''}</td>
            <td>{r.state === 'FAILED' && <button className="btn-sm btn-plain" onClick={() => void a.run(`r${r.id}`, () => api(`/admin/health/cash-receipts/${r.id}/retry`, { method: 'POST', body: '{}' }), q.reload)}>다시</button>}
              {['ISSUED', 'ASSUMED', 'REQUESTED', 'PENDING', 'FAILED'].includes(r.state) && <button className="btn-sm btn-plain" onClick={() => cancel(r)}>취소</button>}</td></tr>))}</tbody></table>
    </div>
  );
}
