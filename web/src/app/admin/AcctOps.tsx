/* ===== v10.475 ~ 478 (D266 · docs/613 ~ 616) 사무 · 자금 — web/src/app/admin/AcctOps.tsx 새 파일 =====
 * 대표 11/20 「㊱」.
 *   AcctVehicles        회계 › 업무용 차량   (매입 · 경비) — 차량 · 운행기록부 · 비용 · 해 셈(일반 원칙 · 세무사 확인) · 운행기록부 인쇄(PDF)
 *   AcctCashPlan        회계 › 자금 계획 12개월 (자금) — 달마다 들어옴 · 나감 · 달 말 예상 잔액 · 모자라는 달 · 펼치면 줄
 *   AcctExemptInvoices  회계 › 전자계산서(면세) (세무) — 요청할 거래명세서 · 요청 · 발행(간주) · 취소 · 매출처별 합계
 *   AcctReorder         회계 › 안전 재고 · 재주문 (매입 · 경비) — 옵션별 위치 · 규칙 · 지금 점검 · 재주문 초안 → 발주로 넣기 · 버림
 * 인쇄는 ㉝ 공용 인쇄 창(lib/printDoc.ts · openPrint)을 씀(앞 묶음 D264 에 기댐).
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { Fragment, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { openPrint } from '../../lib/printDoc';

const won = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/* ── v10.475 업무용 차량 ── */
interface VCalc { months: number; logKept: boolean; ratio: number; bizCost: number; depBiz: number; depLimit: number | null; depOver: number; allowed: number; disallowed: number; rule: string; note: string }
interface VRow { id: string; plate: string; name: string; carClass: string; classKo: string; ownership: string; ownershipKo: string; acquiredOn: string; disposedOn: string | null;
  bizInsurance: boolean; insuranceUntil: string | null; insuranceSoon: boolean; active: boolean; totalKm: number; bizKm: number; trips: number; cost: number; calc: VCalc }
interface VList { year: number; items: VRow[]; limits: { nolog: number; dep: number; basis: string }; kinds: Record<string, string>; purposes: Record<string, string>;
  classes: Record<string, string>; ownerships: Record<string, string>; total: { cost: number; allowed: number; disallowed: number }; note: string }
interface VDetail { vehicle: VRow; year: number; calc: VCalc; totalKm: number; bizKm: number; lastOdo: number | null;
  trips: Array<{ id: string; tripOn: string; driver: string; dept: string | null; purpose: string; purposeKo: string; fromPlace: string | null; toPlace: string | null; odoStart: number; odoEnd: number; distance: number; state: string; cancelNote: string | null }>;
  costs: Array<{ id: string; costOn: string; kind: string; kindKo: string; amount: number; liters: number | null; purchaseId: string | null; memo: string | null; state: string }>;
  byKind: Array<{ kind: string; label: string; amount: number; count: number }>; gaps: Array<{ tripId: string; prevEnd: number; start: number }>;
  log: Array<{ date: string; dept: string; driver: string; before: number; after: number; km: number; commute: number; business: number; note: string }> }
const EMPTY_V = { plate: '', name: '', carClass: 'PASSENGER', ownership: 'OWNED', acquiredOn: kstDay(), bizInsurance: true, insuranceUntil: '' };

function printLog(d: VDetail) {
  const rows = d.log.map((l) => `<tr><td>${esc(l.date)}</td><td>${esc(l.dept)}</td><td>${esc(l.driver)}</td><td class="r">${won(l.before)}</td><td class="r">${won(l.after)}</td><td class="r">${won(l.km)}</td><td class="r">${won(l.commute)}</td><td class="r">${won(l.business)}</td><td>${esc(l.note)}</td></tr>`).join('');
  const body = `<h1>업무용승용차 운행기록부</h1>
    <table class="meta"><tr><td>차량 번호 <b>${esc(d.vehicle.plate)}</b> · ${esc(d.vehicle.name)}</td><td class="r">${d.year}년(1 ~ 12월)</td></tr></table>
    <table><thead><tr><th>사용일자</th><th>부서</th><th>성명</th><th>주행 전 계기판(km)</th><th>주행 후 계기판(km)</th><th>주행거리(km)</th><th>출퇴근용(km)</th><th>일반 업무용(km)</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="total"><tr class="sum"><td>총 주행거리 ${won(d.totalKm)}km</td><td>업무용 사용거리 ${won(d.bizKm)}km</td><td class="r">업무사용비율 ${(d.calc.ratio * 100).toFixed(2)}%</td></tr></table>
    <p class="small">국세청 「업무용승용차 운행기록부」 칸 차례로 만든 사본입니다 — 서식 · 셈은 일반 원칙이며 세무사 확인이 필요합니다.</p>`;
  if (!openPrint({ title: `운행기록부_${d.vehicle.plate}_${d.year}`, body, kind: 'OTHER' })) alert('팝업이 막혀 인쇄 창을 열지 못했습니다 — 팝업 차단을 풀고 다시 누르십시오.');
}

export function AcctVehicles() {
  const [year, setYear] = useState(kstDay().slice(0, 4));
  const q = useApi<VList>(`/admin/acct/vehicles?year=${year}`, [year]);
  const [sel, setSel] = useState<string | null>(null);
  const det = useApi<VDetail | null>(sel ? `/admin/acct/vehicles/${sel}?year=${year}` : `/admin/acct/vehicles?year=${year}`, [sel, year]);
  const a = useAct();
  const [nv, setNv] = useState<typeof EMPTY_V | null>(null);
  const [tr, setTr] = useState({ tripOn: kstDay(), driver: '', dept: '', purpose: 'BUSINESS', fromPlace: '', toPlace: '', odoStart: '', odoEnd: '' });
  const [co, setCo] = useState({ costOn: kstDay(), kind: 'FUEL', amount: '', liters: '', purchaseId: '', memo: '' });
  const d = q.data, v = sel ? (det.data as VDetail | null) : null;
  const reload = () => { q.reload(); det.reload(); };
  const cancelLine = (what: 'trips' | 'costs', id: string) => {
    const reason = prompt('취소 사유(2자 이상)'); if (!reason || reason.trim().length < 2 || !sel) return;
    void a.run('cx', () => api(`/admin/acct/vehicles/${sel}/${what}/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), reload);
  };
  return (
    <section data-veh={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <input type="number" value={year} onChange={(e) => e.target.value.length === 4 && setYear(e.target.value)} aria-label="해" style={{ width: 90 }} />{' '}
        <button className="btn-sm" onClick={() => setNv({ ...EMPTY_V })} data-veh-new="">차량 넣기</button>
      </div>
      {d && (
        <>
          <p className="muted">한도(일반 원칙 · 세무사 확인) — 운행기록부 없을 때 비용 {won(d.limits.nolog)}원 · 감가상각비 연 {won(d.limits.dep)}원 · 정책 › 전체 설정(SUPER) · 합계 비용 <b>{won(d.total.cost)}</b> · 인정 {won(d.total.allowed)} · 불인정 <b className={d.total.disallowed > 0 ? 'warn-text' : ''}>{won(d.total.disallowed)}</b></p>
          <table className="tbl"><thead><tr><th>번호</th><th>이름</th><th>구분</th><th>보험</th><th className="num">전체 km</th><th className="num">업무 km</th><th className="num">비율</th><th className="num">비용</th><th className="num">인정</th><th className="num">불인정</th></tr></thead>
            <tbody>{d.items.map((r) => (
              <tr key={r.id} className={sel === r.id ? 'on' : ''} onClick={() => setSel(r.id)} style={{ cursor: 'pointer' }} data-veh-row={r.calc.rule}>
                <td>{r.plate}{!r.active && <small className="dim"> (끔)</small>}</td><td>{r.name}</td><td>{r.classKo} · {r.ownershipKo}</td>
                <td>{r.bizInsurance ? (r.insuranceSoon ? <b className="warn-text">만기 {r.insuranceUntil}</b> : '가입') : <b className="warn-text">없음</b>}</td>
                <td className="num">{won(r.totalKm)}</td><td className="num">{won(r.bizKm)}</td><td className="num">{(r.calc.ratio * 100).toFixed(1)}%{!r.calc.logKept && <small className="dim"> (기록부 없음)</small>}</td>
                <td className="num">{won(r.cost)}</td><td className="num">{won(r.calc.allowed)}</td><td className="num">{won(r.calc.disallowed)}</td></tr>))}</tbody></table>
          {nv && (
            <div className="card pad" data-veh-form="">
              <input value={nv.plate} onChange={(e) => setNv({ ...nv, plate: e.target.value.replace(/\s+/g, '') })} placeholder="번호(12가3456)" size={12} />{' '}
              <input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} placeholder="이름 · 차종" size={14} />{' '}
              <select value={nv.carClass} onChange={(e) => setNv({ ...nv, carClass: e.target.value })} aria-label="구분">{Object.entries(d.classes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
              <select value={nv.ownership} onChange={(e) => setNv({ ...nv, ownership: e.target.value })} aria-label="소유">{Object.entries(d.ownerships).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
              <input type="date" value={nv.acquiredOn} onChange={(e) => setNv({ ...nv, acquiredOn: e.target.value })} aria-label="취득일" />{' '}
              <label><input type="checkbox" checked={nv.bizInsurance} onChange={(e) => setNv({ ...nv, bizInsurance: e.target.checked })} /> 업무전용 자동차보험</label>{' '}
              <input type="date" value={nv.insuranceUntil} onChange={(e) => setNv({ ...nv, insuranceUntil: e.target.value })} aria-label="보험 만기" />{' '}
              <button className="btn-sm" disabled={!nv.plate || !nv.name || a.busy === 'nv'} onClick={() => void a.run('nv', () => api('/admin/acct/vehicles', { method: 'POST', body: JSON.stringify(nv) }), () => { setNv(null); q.reload(); })} data-veh-save="">저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setNv(null)}>닫기</button>
            </div>
          )}
          {v && v.vehicle && (
            <div className="card pad" data-veh-detail={v.vehicle.id}>
              <b>{v.vehicle.plate} · {v.vehicle.name}</b> — {v.year}년 · 보유 {v.calc.months}달 · 전체 {won(v.totalKm)}km · 업무 {won(v.bizKm)}km{' '}
              <button className="btn-sm btn-plain" onClick={() => printLog(v)} data-veh-print="">운행기록부 인쇄 · PDF</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => void a.run('act', () => api(`/admin/acct/vehicles/${v.vehicle.id}`, { method: 'PUT', body: JSON.stringify({ active: !v.vehicle.active }) }), reload)}>{v.vehicle.active ? '끄기' : '다시 쓰기'}</button>
              <p className={v.calc.disallowed > 0 ? 'warn-text' : 'muted'} data-veh-calc={v.calc.rule}>업무 사용 비율 {(v.calc.ratio * 100).toFixed(2)}% · 업무 사용 금액 {won(v.calc.bizCost)} · 감가상각비 {won(v.calc.depBiz)} / 한도 {won(v.calc.depLimit)}{v.calc.depOver > 0 && ` · 이월 ${won(v.calc.depOver)}`} · 인정 {won(v.calc.allowed)} · 불인정 {won(v.calc.disallowed)} — {v.calc.note}</p>
              {v.gaps.length > 0 && <p className="warn-text" data-veh-gaps={v.gaps.length}>계기판이 이어지지 않는 곳 {v.gaps.length}군데 — 빠진 운행을 확인하십시오.</p>}
              {v.vehicle.active && (
                <div className="acts" data-veh-trip-form="">
                  <b>운행</b> <input type="date" value={tr.tripOn} onChange={(e) => setTr({ ...tr, tripOn: e.target.value })} aria-label="운행일" />{' '}
                  <input value={tr.driver} onChange={(e) => setTr({ ...tr, driver: e.target.value })} placeholder="운전자" size={8} />{' '}
                  <input value={tr.dept} onChange={(e) => setTr({ ...tr, dept: e.target.value })} placeholder="부서" size={8} />{' '}
                  <select value={tr.purpose} onChange={(e) => setTr({ ...tr, purpose: e.target.value })} aria-label="목적">{Object.entries(d.purposes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
                  <input value={tr.fromPlace} onChange={(e) => setTr({ ...tr, fromPlace: e.target.value })} placeholder="출발" size={8} />{' '}
                  <input value={tr.toPlace} onChange={(e) => setTr({ ...tr, toPlace: e.target.value })} placeholder="도착" size={8} />{' '}
                  <input type="number" value={tr.odoStart} onChange={(e) => setTr({ ...tr, odoStart: e.target.value })} placeholder={v.lastOdo != null ? `전 ${v.lastOdo}` : '주행 전 km'} style={{ width: 110 }} />{' '}
                  <input type="number" value={tr.odoEnd} onChange={(e) => setTr({ ...tr, odoEnd: e.target.value })} placeholder="주행 후 km" style={{ width: 110 }} />{' '}
                  <button className="btn-sm" disabled={!tr.driver || !tr.odoEnd || a.busy === 'tr'} onClick={() => void a.run('tr', () => api(`/admin/acct/vehicles/${v.vehicle.id}/trips`, { method: 'POST', body: JSON.stringify({ ...tr, odoStart: Number(tr.odoStart || v.lastOdo || 0), odoEnd: Number(tr.odoEnd) }) }), () => { setTr({ ...tr, odoStart: '', odoEnd: '', fromPlace: '', toPlace: '' }); reload(); })} data-veh-trip-save="">넣기</button>
                </div>
              )}
              <div className="acts" data-veh-cost-form="">
                <b>비용</b> <input type="date" value={co.costOn} onChange={(e) => setCo({ ...co, costOn: e.target.value })} aria-label="비용 날짜" />{' '}
                <select value={co.kind} onChange={(e) => setCo({ ...co, kind: e.target.value })} aria-label="종류">{Object.entries(d.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
                <input type="number" value={co.amount} onChange={(e) => setCo({ ...co, amount: e.target.value })} placeholder="금액" style={{ width: 110 }} />{' '}
                {co.kind === 'FUEL' && <><input type="number" value={co.liters} onChange={(e) => setCo({ ...co, liters: e.target.value })} placeholder="L" style={{ width: 70 }} />{' '}</>}
                <input value={co.purchaseId} onChange={(e) => setCo({ ...co, purchaseId: e.target.value })} placeholder="매입 번호(선택)" size={10} />{' '}
                <button className="btn-sm" disabled={!Number(co.amount) || a.busy === 'co'} onClick={() => void a.run('co', () => api(`/admin/acct/vehicles/${v.vehicle.id}/costs`, { method: 'POST', body: JSON.stringify({ costOn: co.costOn, kind: co.kind, amount: Number(co.amount), liters: co.liters ? Number(co.liters) : undefined, purchaseId: co.purchaseId || undefined, memo: co.memo || undefined }) }), () => { setCo({ ...co, amount: '', liters: '', purchaseId: '' }); reload(); })} data-veh-cost-save="">넣기</button>
              </div>
              <table className="tbl"><thead><tr><th>날짜</th><th>운전자</th><th>목적</th><th>구간</th><th className="num">전</th><th className="num">후</th><th className="num">km</th><th /></tr></thead>
                <tbody>{v.trips.map((t) => (
                  <tr key={t.id} className={t.state === 'CANCELED' ? 'dim' : ''} data-veh-trip={t.state}><td>{t.tripOn}</td><td>{t.driver}{t.dept && <small className="dim"> {t.dept}</small>}</td><td>{t.purposeKo}</td>
                    <td>{[t.fromPlace, t.toPlace].filter(Boolean).join(' → ')}</td><td className="num">{won(t.odoStart)}</td><td className="num">{won(t.odoEnd)}</td><td className="num">{won(t.distance)}</td>
                    <td>{t.state === 'ACTIVE' ? <button className="btn-sm btn-plain" onClick={() => cancelLine('trips', t.id)}>취소</button> : <small className="dim">취소 · {t.cancelNote}</small>}</td></tr>))}</tbody></table>
              <table className="tbl"><thead><tr><th>날짜</th><th>종류</th><th className="num">금액</th><th>매입</th><th /></tr></thead>
                <tbody>{v.costs.map((c) => (
                  <tr key={c.id} className={c.state === 'CANCELED' ? 'dim' : ''} data-veh-cost={c.state}><td>{c.costOn}</td><td>{c.kindKo}{c.liters != null && <small className="dim"> {c.liters}L</small>}</td><td className="num">{won(c.amount)}</td><td>{c.purchaseId ?? '—'}</td>
                    <td>{c.state === 'ACTIVE' ? <button className="btn-sm btn-plain" onClick={() => cancelLine('costs', c.id)}>취소</button> : <small className="dim">취소</small>}</td></tr>))}</tbody></table>
            </div>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.476 12개월 자금 계획 ── */
interface PItem { date: string; dir: 'IN' | 'OUT'; kind: string; amount: number; label: string; estimate?: boolean }
interface PRow { ym: string; in: number; out: number; net: number; endBalance: number; short: boolean; estimates: number; byKind: Record<string, number>; items: PItem[] }
interface PView { months: number; start: number; hasBase: boolean; floor: number; rows: PRow[]; shortMonths: string[]; kinds: Record<string, string>; kindTotals: Record<string, number>;
  settings: { basis: string; collect: number; alert: boolean }; salesNote: string; note: string }
const BASIS_KO: Record<string, string> = { TARGET: '매출 목표', CRM: '영업 기회 가중', NONE: '넣지 않음' };

export function AcctCashPlan() {
  const [months, setMonths] = useState(12);
  const q = useApi<PView>(`/admin/acct/cash-plan?months=${months}`, [months]);
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  return (
    <section data-cashplan={d?.rows.length ?? ''}>
      <div className="acts">
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="달 수">{[6, 12, 18].map((m) => <option key={m} value={m}>{m}개월</option>)}</select>{' '}
        <button className="btn-sm btn-plain" onClick={q.reload}>다시 셈</button>
      </div>
      {d && (
        <>
          <p className={d.shortMonths.length ? 'warn-text' : ''} data-cashplan-short={d.shortMonths.length}>시작 잔액 <b>{won(d.start)}</b>{!d.hasBase && ' (잔액 없음 — 0 에서 셈)'} · 기준 {won(d.floor)}원 · 모자라는 달 <b>{d.shortMonths.length ? d.shortMonths.join(' · ') : '없음'}</b> · 예상 매출 {BASIS_KO[d.settings.basis] ?? d.settings.basis}({d.settings.collect}달 뒤 들어옴) · 알림 {d.settings.alert ? '켜짐(매일 09:35)' : '꺼짐'}</p>
          {d.salesNote && <p className="muted">{d.salesNote}</p>}
          <table className="tbl"><thead><tr><th>달</th><th className="num">들어옴</th><th className="num">나감</th><th className="num">차이</th><th className="num">달 말 잔액</th><th>추정 줄</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <Fragment key={r.ym}>
                <tr onClick={() => setOpen(open === r.ym ? null : r.ym)} style={{ cursor: 'pointer' }} data-cashplan-row={r.short ? 'short' : 'ok'}>
                  <td>{r.ym}</td><td className="num">{won(r.in)}</td><td className="num">{won(r.out)}</td><td className="num">{won(r.net)}</td>
                  <td className="num">{r.short ? <b className="warn-text">{won(r.endBalance)}</b> : won(r.endBalance)}</td><td>{r.estimates > 0 ? `${r.estimates}줄` : '—'}</td></tr>
                {open === r.ym && (
                  <tr><td colSpan={6}>
                    {Object.entries(r.byKind).map(([k, amt]) => <span key={k} className="dim">{d.kinds[k] ?? k} {won(amt)} · </span>)}
                    <ul>{r.items.map((it, i) => <li key={i}>{it.date} · {it.dir === 'IN' ? '들어옴' : '나감'} {won(it.amount)} · {it.label}{it.estimate && <small className="dim"> (추정)</small>}</li>)}</ul>
                  </td></tr>
                )}
              </Fragment>))}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.477 전자계산서(면세) ── */
interface XCand { id: string; docNo: string; title: string; party: string; hasBizNo: boolean; acceptedOn: string; exemptSupply: number; supply: number; taxInvoiceNo: string | null }
interface XItem { id: string; docNo: string | null; state: string; supply: number; buyer: string; buyerBizNo: string | null; invoiceNo: string | null; issuedOn: string | null; etaxStatus: string | null; etaxError: string | null; assumed: boolean; cancelReason: string | null; createdAt: string }
interface XView { ym: string; on: boolean; assume: boolean; candidates: XCand[]; items: XItem[]; byBuyer: Array<{ bizNo: string; buyer: string; count: number; supply: number }>;
  totals: { issuedCount: number; issuedSupply: number; requested: number }; note: string }

export function AcctExemptInvoices() {
  const [ym, setYm] = useState(kstDay().slice(0, 7));
  const q = useApi<XView>(`/admin/acct/exempt-invoices?ym=${ym}`, [ym]);
  const a = useAct();
  const d = q.data;
  return (
    <section data-exempt={d?.on ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts"><input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="달" /></div>
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'}>전자계산서 {d.on ? '켜짐' : '꺼짐(acct.exempt_invoice)'} · {d.assume ? '간주 모드(국세청 전송 없음)' : '업체 전송'} · 이 달 발행 {d.totals.issuedCount}건 {won(d.totals.issuedSupply)}원 · 요청 대기 {d.totals.requested}건</p>
          <h4>요청할 거래명세서(면세 품목)</h4>
          <table className="tbl"><thead><tr><th>문서</th><th>거래처</th><th>확정일</th><th className="num">면세 공급가</th><th className="num">전체 공급가</th><th /></tr></thead>
            <tbody>{d.candidates.map((c) => (
              <tr key={c.id} data-exempt-cand=""><td>{c.docNo} {c.title}</td><td>{c.party}{!c.hasBizNo && <small className="warn-text"> 사업자번호 없음</small>}</td><td>{c.acceptedOn}</td>
                <td className="num">{won(c.exemptSupply)}</td><td className="num">{won(c.supply)}</td>
                <td><button className="btn-sm" disabled={!d.on || a.busy === c.id} onClick={() => void a.run(c.id, () => api('/admin/acct/exempt-invoices', { method: 'POST', body: JSON.stringify({ docId: c.id }) }), q.reload)} data-exempt-req="">계산서 요청</button></td></tr>))}</tbody></table>
          <h4>요청 · 발행</h4>
          <table className="tbl"><thead><tr><th>문서</th><th>공급받는 자</th><th className="num">공급가</th><th>상태</th><th>번호</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-exempt-row={x.state}><td>{x.docNo ?? '—'}</td><td>{x.buyer} <small className="dim">{x.buyerBizNo ?? ''}</small></td><td className="num">{won(x.supply)}</td>
                <td>{x.state === 'ISSUED' ? (x.assumed ? '간주 발행' : '발행') : x.state === 'CANCELED' ? `취소 · ${x.cancelReason ?? ''}` : x.etaxStatus === 'FAILED' ? <b className="warn-text">실패 · {x.etaxError}</b> : '요청'}</td>
                <td>{x.invoiceNo ?? '—'}{x.issuedOn && <small className="dim"> {x.issuedOn}</small>}</td>
                <td>{x.state === 'REQUESTED' && !x.etaxStatus && (
                  <>
                    <button className="btn-sm" disabled={!d.on || a.busy === `s${x.id}`} onClick={() => void a.run(`s${x.id}`, () => api(`/admin/acct/exempt-invoices/${x.id}/send`, { method: 'POST' }), q.reload)} data-exempt-send="">발행</button>{' '}
                    <button className="btn-sm btn-plain" onClick={() => { const reason = prompt('취소 사유(2자 이상)'); if (reason && reason.trim().length >= 2) void a.run(`c${x.id}`, () => api(`/admin/acct/exempt-invoices/${x.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload); }}>취소</button>
                  </>)}<small className="dim"> {ymdhm(x.createdAt)}</small></td></tr>))}</tbody></table>
          <h4>매출처별 계산서 합계({d.ym} 발행)</h4>
          <table className="tbl"><thead><tr><th>사업자번호</th><th>상호</th><th className="num">매수</th><th className="num">공급가</th></tr></thead>
            <tbody>{d.byBuyer.map((b) => <tr key={b.bizNo} data-exempt-buyer=""><td>{b.bizNo}</td><td>{b.buyer}</td><td className="num">{b.count}</td><td className="num">{won(b.supply)}</td></tr>)}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.478 안전 재고 · 재주문 ── */
interface ROpt { optionId: string; code: string; name: string; label: string | null; active: boolean; shopQty: number; onOrder: number; position: number; below: boolean; need: number;
  minQty: number | null; reorderQty: number | null; partyId: string | null; partyName: string | null; unitPrice: number | null; avgCost: number | null; ruleOn: boolean }
interface RDraft { id: string; partyId: string | null; partyName: string | null; state: string; poId: string | null; dismissNote: string | null; createdAt: string; doneAt: string | null; doneBy: string | null; total: number;
  lines: Array<{ optionId: string; name: string; label: string | null; qty: number; unitPrice: number; amount: number; positionQty: number; minQty: number }> }
interface RView { on: boolean; items: ROpt[]; below: number; rules: number; drafts: RDraft[]; done: RDraft[]; parties: Array<{ id: string; name: string }>; note: string }

export function AcctReorder() {
  const q = useApi<RView>('/admin/acct/reorder');
  const a = useAct();
  const [ed, setEd] = useState<{ optionId: string; minQty: string; reorderQty: string; partyId: string; unitPrice: string; active: boolean } | null>(null);
  const [conv, setConv] = useState<Record<string, string>>({});
  const d = q.data;
  return (
    <section data-reorder={d?.rules ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'} data-reorder-below={d.below}>재주문 {d.on ? '켜짐(매시간)' : '꺼짐(acct.reorder)'} · 규칙 {d.rules}개 · 최소 밑 <b className={d.below ? 'warn-text' : ''}>{d.below}</b>개{' '}
            <button className="btn-sm" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ below: number; made: number; lines: number }>('/admin/acct/reorder/run', { method: 'POST' }), q.reload, (r) => `점검했습니다 — 모자람 ${r?.below ?? 0} · 새 알림 ${r?.made ?? 0} · 초안 줄 ${r?.lines ?? 0}`)} data-reorder-run="">지금 점검</button></p>
          {d.drafts.map((dr) => (
            <div key={dr.id} className="card pad" data-reorder-draft={dr.id}>
              <b>재주문 초안 {dr.id}번</b> · 매입처 {dr.partyName ?? <b className="warn-text">정하지 않음</b>} · 합계 {won(dr.total)}원 · <small className="dim">{ymdhm(dr.createdAt)}</small>
              <table className="tbl"><thead><tr><th>상품</th><th className="num">위치</th><th className="num">최소</th><th className="num">수량</th><th className="num">단가</th><th className="num">금액</th><th /></tr></thead>
                <tbody>{dr.lines.map((l) => (
                  <tr key={l.optionId}><td>{l.name} {l.label ?? ''}</td><td className="num">{l.positionQty}</td><td className="num">{l.minQty}</td><td className="num">{l.qty}</td><td className="num">{won(l.unitPrice)}</td><td className="num">{won(l.amount)}</td>
                    <td><button className="btn-sm btn-plain" onClick={() => { const v = prompt('수량(0 = 빼기)', String(l.qty)); if (v != null && /^\d+$/.test(v)) void a.run('ln', () => api(`/admin/acct/reorder/drafts/${dr.id}/lines`, { method: 'PUT', body: JSON.stringify({ lines: [{ optionId: l.optionId, qty: Number(v) }] }) }), q.reload); }}>수량</button></td></tr>))}</tbody></table>
              {!dr.partyId && <select value={conv[dr.id] ?? ''} onChange={(e) => setConv({ ...conv, [dr.id]: e.target.value })} aria-label="매입처"><option value="">매입처 고르기</option>{d.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}{' '}
              <button className="btn-sm" disabled={(!dr.partyId && !conv[dr.id]) || !dr.lines.length || a.busy === `v${dr.id}`} onClick={() => void a.run(`v${dr.id}`, () => api(`/admin/acct/reorder/drafts/${dr.id}/convert`, { method: 'POST', body: JSON.stringify({ partyId: conv[dr.id] || undefined }) }), q.reload)} data-reorder-convert="">발주로 넣기</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => { const reason = prompt('버리는 사유(2자 이상)'); if (reason && reason.trim().length >= 2) void a.run(`x${dr.id}`, () => api(`/admin/acct/reorder/drafts/${dr.id}/dismiss`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload); }}>버림</button>
              <small className="dim"> 발주로 넣어도 거래처에 보내지 않습니다 — 회계 › 국내 발주에서 발주서 인쇄.</small>
            </div>
          ))}
          <table className="tbl"><thead><tr><th>상품</th><th className="num">판매용</th><th className="num">발주 중</th><th className="num">위치</th><th className="num">최소</th><th className="num">재주문</th><th>매입처</th><th className="num">단가</th><th /></tr></thead>
            <tbody>{d.items.map((o) => (
              <tr key={o.optionId} data-reorder-row={o.below ? 'below' : o.ruleOn ? 'ok' : 'none'}><td>{o.name} {o.label ?? ''} <small className="dim">{o.code}</small></td>
                <td className="num">{o.shopQty}</td><td className="num">{o.onOrder}</td><td className="num">{o.below ? <b className="warn-text">{o.position}</b> : o.position}</td>
                <td className="num">{o.ruleOn ? o.minQty : '—'}</td><td className="num">{o.ruleOn ? o.reorderQty : '—'}</td><td>{o.partyName ?? '—'}</td><td className="num">{won(o.unitPrice ?? o.avgCost)}</td>
                <td><button className="btn-sm btn-plain" onClick={() => setEd({ optionId: o.optionId, minQty: String(o.minQty ?? ''), reorderQty: String(o.reorderQty ?? ''), partyId: o.partyId ?? '', unitPrice: o.unitPrice == null ? '' : String(o.unitPrice), active: o.ruleOn || o.minQty == null })}>규칙</button></td></tr>))}</tbody></table>
          {ed && (
            <div className="card pad" data-reorder-edit="">
              <input type="number" value={ed.minQty} onChange={(e) => setEd({ ...ed, minQty: e.target.value })} placeholder="최소 재고" style={{ width: 100 }} />{' '}
              <input type="number" value={ed.reorderQty} onChange={(e) => setEd({ ...ed, reorderQty: e.target.value })} placeholder="재주문 수량" style={{ width: 100 }} />{' '}
              <select value={ed.partyId} onChange={(e) => setEd({ ...ed, partyId: e.target.value })} aria-label="매입처"><option value="">매입처 정하지 않음</option>{d.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{' '}
              <input type="number" value={ed.unitPrice} onChange={(e) => setEd({ ...ed, unitPrice: e.target.value })} placeholder="단가(비우면 평균)" style={{ width: 120 }} />{' '}
              <label><input type="checkbox" checked={ed.active} onChange={(e) => setEd({ ...ed, active: e.target.checked })} /> 씀</label>{' '}
              <button className="btn-sm" disabled={ed.minQty === '' || !Number(ed.reorderQty) || a.busy === 'rule'} onClick={() => void a.run('rule', () => api(`/admin/acct/reorder/rules/${ed.optionId}`, { method: 'PUT', body: JSON.stringify({ minQty: Number(ed.minQty), reorderQty: Number(ed.reorderQty), partyId: ed.partyId || undefined, unitPrice: ed.unitPrice === '' ? undefined : Number(ed.unitPrice), active: ed.active }) }), () => { setEd(null); q.reload(); })} data-reorder-save="">저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button>
            </div>
          )}
          {d.done.length > 0 && <details><summary>끝난 초안 {d.done.length}</summary>{d.done.map((x) => <p key={x.id}><small className="dim">{ymdhm(x.doneAt)}</small> {x.id}번 · {x.state === 'CONVERTED' ? `발주 ${x.poId}번` : `버림 · ${x.dismissNote ?? ''}`} · {x.partyName ?? '—'} · {won(x.total)} · {x.doneBy ?? ''}</p>)}</details>}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
