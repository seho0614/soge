/* ===== v10.494 ~ 496 (D271 · docs/632 ~ 634) ㊶ 구매 · 소개몰 품질 — web/src/app/admin/Quality.tsx 새 파일 =====
 *   QltSupEval  소개몰 › 협력사 평가(SB-ADM-QLT-010) — 분기 · 매입처마다 납기(자동) · 품질 · 가격 · 대응 · 등급 · 확정 · 발주 납기일
 *   QltLots     소개몰 › 로트 · 유통기한(SB-ADM-QLT-020) — 로트 관리 켜기 · 로트 등록(입고 줄 나누기 · 시작 재고) · 임박 · 상태 · 조정 · 나간 곳 · 발송 전 FEFO
 *   QltClaims   소개몰 › 품질 클레임(SB-ADM-QLT-030) — 접수 · 원인 · 조치 · 끝냄 · 반려 · 공급사 반품 · 집계 · 재발
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · CSS 는 기존 클래스만(tbl · card pad · btn-sm · muted · warn-text) — 새 색 없음
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const num = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const thisQ = () => { const d = kstDay(); return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`; };
const qList = () => {
  const out: string[] = []; let y = Number(kstDay().slice(0, 4)), q = Number(thisQ().slice(6));
  for (let i = 0; i < 8; i++) { out.push(`${y}-Q${q}`); q -= 1; if (q === 0) { q = 4; y -= 1; } }
  return out;
};
const post = (path: string, body: unknown, method = 'POST') => api(path, { method, body: JSON.stringify(body) });

/* ═════════════ 협력사 평가 ═════════════ */
interface Metric { poCount: number; onTime: number; lateAvg: number; recvQty: number; claims: number; delivery: number | null; quality: number }
interface EvalRow { id: string; delivery: number; quality: number; price: number; response: number; total: number; grade: string; state: string; memo: string | null }
interface SupRow { id: string; name: string; kind: string; state: string; bizStatus: string | null; metrics: Metric | null; eval: EvalRow | null }
interface SupView { period: string; items: SupRow[]; grades: Record<string, number>; weights: number[]; gradeCut: number[]; leadDays: number; note: string;
  openPos: Array<{ id: string; title: string; partyName: string; orderedOn: string; dueSet: string | null; due: string }> }

function EvalForm({ row, period, onDone }: { row: SupRow; period: string; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState({ price: String(row.eval?.price ?? 80), response: String(row.eval?.response ?? 80), quality: String(row.eval?.quality ?? row.metrics?.quality ?? 100),
    delivery: String(row.eval?.delivery ?? 100), memo: row.eval?.memo ?? '' });
  const auto = (row.metrics?.poCount ?? 0) > 0;
  const save = () => void a.run('s', () => post('/admin/qlt/suppliers/evals', { partyId: row.id, period, priceScore: Number(f.price), responseScore: Number(f.response),
    qualityScore: f.quality === '' ? undefined : Number(f.quality), deliveryScore: auto ? undefined : Number(f.delivery), memo: f.memo || undefined }), onDone);
  return (
    <span data-qlt-eval-form={row.id}>
      <Flash msg={a.msg} err={a.err} />
      {!auto && <><input type="number" value={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.value })} style={{ width: 56 }} aria-label="납기" title="그 분기 입고 발주가 없어 직접" />{' '}</>}
      <input type="number" value={f.quality} onChange={(e) => setF({ ...f, quality: e.target.value })} style={{ width: 56 }} aria-label="품질" />{' '}
      <input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} style={{ width: 56 }} aria-label="가격" />{' '}
      <input type="number" value={f.response} onChange={(e) => setF({ ...f, response: e.target.value })} style={{ width: 56 }} aria-label="대응" />{' '}
      <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" size={12} />{' '}
      <button className="btn-sm" disabled={a.busy === 's'} onClick={save} data-qlt-eval-save={row.id}>저장</button>
    </span>
  );
}

export function QltSupEval() {
  const [period, setPeriod] = useState(thisQ());
  const q = useApi<SupView>(`/admin/qlt/suppliers?period=${period}`, [period]);
  const a = useAct();
  const [edit, setEdit] = useState<string | null>(null);
  const [due, setDue] = useState<Record<string, string>>({});
  const d = q.data;
  return (
    <section data-qlt-supeval={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="분기" data-qlt-period="">{qList().map((p) => <option key={p} value={p}>{p}</option>)}</select>{' '}
        {d && <span className="muted">가중치 납기 {d.weights[0]} · 품질 {d.weights[1]} · 가격 {d.weights[2]} · 대응 {d.weights[3]} · 등급 A ≥ {d.gradeCut[0]} · B ≥ {d.gradeCut[1]} · C ≥ {d.gradeCut[2]}
          · A {d.grades.A ?? 0} · B {d.grades.B ?? 0} · C {d.grades.C ?? 0} · D {d.grades.D ?? 0}</span>}
      </p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl"><thead><tr><th>매입처</th><th className="num">입고 발주</th><th className="num">제때</th><th className="num">늦은 날(평균)</th><th className="num">클레임</th>
          <th className="num">납기</th><th className="num">품질</th><th className="num">가격</th><th className="num">대응</th><th className="num">합계</th><th>등급</th><th /></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.id} data-qlt-sup-row={r.eval?.state ?? 'NONE'}>
              <td>{r.name}{r.state !== 'ACTIVE' && <small className="muted"> (닫음)</small>}{r.bizStatus && r.bizStatus !== 'ACTIVE' && <small className="warn-text"> {r.bizStatus}</small>}</td>
              <td className="num">{num(r.metrics?.poCount)}</td><td className="num">{num(r.metrics?.onTime)}</td><td className="num">{r.metrics?.lateAvg ?? 0}</td><td className="num">{num(r.metrics?.claims)}</td>
              <td className="num">{r.eval?.delivery ?? r.metrics?.delivery ?? '—'}</td><td className="num">{r.eval?.quality ?? r.metrics?.quality ?? '—'}</td>
              <td className="num">{r.eval?.price ?? '—'}</td><td className="num">{r.eval?.response ?? '—'}</td><td className="num">{r.eval ? r.eval.total : '—'}</td>
              <td>{r.eval ? <b>{r.eval.grade}</b> : '—'}{r.eval?.state === 'FINAL' && <small className="muted"> 확정</small>}</td>
              <td>{r.eval?.state === 'FINAL' ? null : edit === r.id
                ? <EvalForm row={r} period={period} onDone={() => { setEdit(null); q.reload(); }} />
                : <><button className="btn-sm btn-plain" onClick={() => setEdit(r.id)} data-qlt-eval-open={r.id}>평가</button>{' '}
                  {r.eval && <button className="btn-sm btn-plain" onClick={() => void a.run(`c${r.id}`, () => post(`/admin/qlt/suppliers/evals/${r.eval!.id}/confirm`, {}), q.reload)} data-qlt-eval-confirm={r.id}>확정</button>}</>}</td>
            </tr>))}</tbody></table>
      )}
      {d && !!d.openPos.length && (
        <div className="card pad" data-qlt-po-due={d.openPos.length}>
          <b>입고 전 발주 납기일</b> <small className="muted">(넣지 않으면 발주일 + {d.leadDays}일)</small>
          <table className="tbl"><thead><tr><th>발주</th><th>매입처</th><th>발주일</th><th>납기</th><th /></tr></thead>
            <tbody>{d.openPos.map((p) => (
              <tr key={p.id}><td>{p.id} · {p.title}</td><td>{p.partyName}</td><td>{p.orderedOn}</td>
                <td><input type="date" value={due[p.id] ?? p.due} min={p.orderedOn} onChange={(e) => setDue({ ...due, [p.id]: e.target.value })} aria-label="납기일" />{!p.dueSet && <small className="muted"> 기본</small>}</td>
                <td><button className="btn-sm btn-plain" onClick={() => void a.run(`d${p.id}`, () => post(`/admin/qlt/pos/${p.id}/due`, { dueOn: due[p.id] ?? p.due }, 'PUT'), q.reload)}>납기 저장</button></td></tr>))}</tbody></table>
        </div>
      )}
    </section>
  );
}

/* ═════════════ 로트 · 유통기한 ═════════════ */
interface Lot { id: string; lotNo: string; madeOn: string | null; expiresOn: string; daysLeft: number; inKind: string; inQty: number; qty: number; state: string; stateNote: string | null;
  optionId: string; code: string; name: string; label: string; partyName: string | null; poId: string | null }
interface LotView { items: Lot[]; products: Array<{ productId: string; code: string; name: string; tracked: boolean; ledgerQty: number; lotQty: number; unassignedQty: number }>;
  unassigned: Array<{ moveId: string; date: string; kind: string; qty: number; optionId: string; code: string; name: string; label: string; assigned: number; sourceKey: string }>;
  states: Record<string, string>; counts: { soon: number; expired: number; recall: number; short: number }; expiryDays: number; expiryAlert: boolean; note: string }
interface Trace { lot: { lotNo: string; name: string; label: string }; items: Array<{ kind: string; date: string; qty: number; orderNo: string | null; orderStatus: string | null; member: string | null; phoneTail: string | null; exportTitle: string | null; partyName: string | null; sourceKey: string }>;
  count: { orders: number; exports: number; qty: number }; note: string }
interface Queue { items: Array<{ itemId: string; orderId: string; orderNo: string; status: string; code: string; name: string; label: string; qty: number;
  picks: Array<{ lotId: string; lotNo: string; qty: number }>; suggest: Array<{ lotId: string; lotNo: string; expiresOn: string; qty: number }>; short: number }>; note: string }

const LOT_EMPTY = { optionId: '', lotNo: '', madeOn: '', expiresOn: kstDay(365), qty: '', moveId: '', memo: '' };

export function QltLots() {
  const [filter, setFilter] = useState({ state: '', soon: false, q: '' });
  const q = useApi<LotView>(`/admin/qlt/lots?state=${filter.state}&soon=${filter.soon ? '1' : ''}&q=${encodeURIComponent(filter.q)}`, [filter.state, filter.soon, filter.q]);
  const a = useAct();
  const [f, setF] = useState({ ...LOT_EMPTY });
  const [trace, setTrace] = useState<Trace | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const d = q.data;
  const add = () => void a.run('add', () => post('/admin/qlt/lots', { optionId: f.optionId, lotNo: f.lotNo.trim(), madeOn: f.madeOn || undefined, expiresOn: f.expiresOn, qty: Number(f.qty),
    moveId: f.moveId || undefined, memo: f.memo || undefined }), () => { setF({ ...LOT_EMPTY }); q.reload(); });
  const state = (l: Lot, s: string) => {
    const reason = s === 'HOLD' || s === 'RECALL' ? (window.prompt(`로트 ${l.lotNo} — ${s === 'RECALL' ? '회수' : '보류'} 사유(2자 이상)`) ?? '') : '';
    if ((s === 'HOLD' || s === 'RECALL') && reason.trim().length < 2) return;
    void a.run(`st${l.id}`, () => post(`/admin/qlt/lots/${l.id}/state`, { state: s, reason: reason || undefined }), q.reload);
  };
  const adjust = (l: Lot) => {
    const v = Number(window.prompt(`로트 ${l.lotNo} 조정 수량(늘림 + · 줄임 − · 남은 ${l.qty}개 · SUPER)`) ?? '');
    if (!Number.isInteger(v) || v === 0) return;
    const reason = window.prompt('조정 사유(2자 이상 · 예: 유통기한 지남 폐기)') ?? '';
    if (reason.trim().length < 2) return;
    void a.run(`aj${l.id}`, () => post(`/admin/qlt/lots/${l.id}/adjust`, { qty: v, reason }), q.reload);
  };
  return (
    <section data-qlt-lots={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p data-qlt-lot-counts="">임박({d.expiryDays}일) <b>{d.counts.soon}</b> · 지남 <b className={d.counts.expired ? 'warn-text' : ''}>{d.counts.expired}</b> · 회수 {d.counts.recall} · 로트 모자란 출고 {d.counts.short}
            {!d.expiryAlert && <span className="warn-text"> · 임박 알림 꺼짐(qlt.expiry_alert)</span>}</p>
          <p className="muted">{d.note}</p>
          <details data-qlt-lot-products="">
            <summary>로트 관리 상품 ({d.products.filter((p) => p.tracked).length} 켬)</summary>
            <table className="tbl"><thead><tr><th>상품</th><th className="num">원가 장부</th><th className="num">로트 합</th><th className="num">로트 없음</th><th /></tr></thead>
              <tbody>{d.products.map((p) => (
                <tr key={p.productId}><td>{p.code} · {p.name}</td><td className="num">{num(p.ledgerQty)}</td><td className="num">{p.tracked ? num(p.lotQty) : '—'}</td>
                  <td className="num">{p.tracked ? <span className={p.unassignedQty ? 'warn-text' : ''}>{num(p.unassignedQty)}</span> : '—'}</td>
                  <td><button className="btn-sm btn-plain" onClick={() => void a.run(`p${p.productId}`, () => post(`/admin/qlt/lot-products/${p.productId}`, { on: !p.tracked }, 'PUT'), q.reload)} data-qlt-lot-track={p.tracked ? 'on' : 'off'}>
                    {p.tracked ? '로트 관리 끄기' : '로트 관리 켜기'}</button></td></tr>))}</tbody></table>
          </details>
          <div className="card pad" data-qlt-lot-new="">
            <b>로트 등록</b>{' '}
            <select value={f.moveId} onChange={(e) => { const m = d.unassigned.find((x) => x.moveId === e.target.value); setF({ ...f, moveId: e.target.value, optionId: m?.optionId ?? f.optionId, qty: m ? String(m.qty - m.assigned) : f.qty }); }} aria-label="입고 줄">
              <option value="">시작 재고(입고 줄 없음)</option>
              {d.unassigned.map((m) => <option key={m.moveId} value={m.moveId}>{m.date} {m.name} {m.label} {m.kind === 'IN' ? '입고' : '실사'} {m.qty}개(남은 {m.qty - m.assigned}) · {m.sourceKey.slice(0, 16)}</option>)}
            </select>{' '}
            {!f.moveId && <input value={f.optionId} onChange={(e) => setF({ ...f, optionId: e.target.value.trim() })} placeholder="옵션 번호(uuid)" size={20} />}{' '}
            <input value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} placeholder="로트 번호" size={12} maxLength={40} />{' '}
            제조 <input type="date" value={f.madeOn} onChange={(e) => setF({ ...f, madeOn: e.target.value })} aria-label="제조일" />{' '}
            유통기한 <input type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} aria-label="유통기한" />{' '}
            <input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} placeholder="수량" style={{ width: 80 }} />{' '}
            <button className="btn-sm" disabled={!f.optionId || !f.lotNo.trim() || !f.qty || a.busy === 'add'} onClick={add} data-qlt-lot-save="">등록</button>
          </div>
          <p>
            <select value={filter.state} onChange={(e) => setFilter({ ...filter, state: e.target.value })} aria-label="상태"><option value="">모든 상태</option>{Object.entries(d.states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
            <label><input type="checkbox" checked={filter.soon} onChange={(e) => setFilter({ ...filter, soon: e.target.checked })} /> 임박 · 지남만</label>{' '}
            <input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="로트 · 상품 찾기" size={14} />{' '}
            <button className="btn-sm btn-plain" onClick={() => void a.run('qq', async () => { const r = await api<Queue>('/admin/qlt/ship-queue'); setQueue(r); return r; }, undefined, () => '발송 전 FEFO 제안을 열었습니다.')} data-qlt-ship-open="">발송 전 FEFO 제안</button>
          </p>
          <table className="tbl"><thead><tr><th>로트</th><th>상품</th><th>제조</th><th>유통기한</th><th className="num">들어옴</th><th className="num">남음</th><th>공급사</th><th>상태</th><th /></tr></thead>
            <tbody>{d.items.map((l) => (
              <tr key={l.id} data-qlt-lot-row={l.state}>
                <td>{l.lotNo}{l.inKind === 'OPEN' && <small className="muted"> 시작</small>}</td><td>{l.name} {l.label}</td><td>{l.madeOn ?? '—'}</td>
                <td className={l.qty > 0 && l.daysLeft <= d.expiryDays && l.state !== 'CLOSED' ? 'warn-text' : ''}>{l.expiresOn} ({l.daysLeft < 0 ? `${-l.daysLeft}일 지남` : `D-${l.daysLeft}`})</td>
                <td className="num">{num(l.inQty)}</td><td className="num">{num(l.qty)}</td><td>{l.partyName ?? '—'}{l.poId && <small className="muted"> 발주 {l.poId}</small>}</td>
                <td>{d.states[l.state] ?? l.state}{l.stateNote && <small className="muted"> · {l.stateNote}</small>}</td>
                <td>{l.state === 'OK' && <button className="btn-sm btn-plain" onClick={() => state(l, 'HOLD')}>보류</button>}
                  {l.state === 'HOLD' && <button className="btn-sm btn-plain" onClick={() => state(l, 'OK')}>정상</button>}{' '}
                  {(l.state === 'OK' || l.state === 'HOLD') && <button className="btn-sm btn-plain" onClick={() => state(l, 'RECALL')} data-qlt-lot-recall={l.id}>회수</button>}{' '}
                  {l.state !== 'CLOSED' && l.qty === 0 && <button className="btn-sm btn-plain" onClick={() => state(l, 'CLOSED')}>끝</button>}{' '}
                  {l.state !== 'CLOSED' && <button className="btn-sm btn-plain" onClick={() => adjust(l)}>조정</button>}{' '}
                  <button className="btn-sm btn-plain" onClick={() => void a.run(`t${l.id}`, async () => { const r = await api<Trace>(`/admin/qlt/lots/${l.id}/trace`); setTrace(r); return r; }, undefined, () => '나간 곳을 열었습니다(감사 기록에 남음).')} data-qlt-lot-trace={l.id}>나간 곳</button></td>
              </tr>))}</tbody></table>
          {trace && (
            <div className="card pad" data-qlt-trace={trace.items.length}>
              <b>로트 {trace.lot.lotNo} · {trace.lot.name} {trace.lot.label} — 나간 곳</b> 주문 {trace.count.orders} · 수출 {trace.count.exports} · {num(trace.count.qty)}개{' '}
              <button className="btn-sm btn-plain" onClick={() => setTrace(null)}>닫기</button>
              <p className="muted">{trace.note}</p>
              <table className="tbl"><thead><tr><th>날짜</th><th>구분</th><th>주문 · 수출</th><th>회원 · 거래처</th><th className="num">수량</th></tr></thead>
                <tbody>{trace.items.map((t) => <tr key={t.sourceKey}><td>{t.date}</td><td>{t.kind === 'ORDER' ? '주문' : t.kind === 'EXPORT' ? '수출' : '그 밖'}</td>
                  <td>{t.orderNo ? `${t.orderNo} (${t.orderStatus ?? ''})` : t.exportTitle ?? t.sourceKey}</td><td>{t.member ? `${t.member} · ${t.phoneTail ? `끝 ${t.phoneTail}` : '전화 없음'}` : t.partyName ?? '—'}</td>
                  <td className="num">{num(t.qty)}</td></tr>)}</tbody></table>
            </div>
          )}
          {queue && (
            <div className="card pad" data-qlt-ship={queue.items.length}>
              <b>발송 전 FEFO 제안</b> <button className="btn-sm btn-plain" onClick={() => setQueue(null)}>닫기</button>
              <p className="muted">{queue.note}</p>
              <table className="tbl"><thead><tr><th>주문</th><th>상품</th><th className="num">수량</th><th>확정한 로트</th><th>제안(먼저 끝나는 것부터)</th><th /></tr></thead>
                <tbody>{queue.items.map((it) => (
                  <tr key={it.itemId}><td>{it.orderNo}</td><td>{it.name} {it.label}</td><td className="num">{it.qty}</td>
                    <td>{it.picks.map((p) => `${p.lotNo}×${p.qty}`).join(' · ') || '—'}</td>
                    <td>{it.suggest.map((s) => `${s.lotNo}(${s.expiresOn})×${s.qty}`).join(' · ') || '—'}{it.short > 0 && <span className="warn-text"> 모자람 {it.short}</span>}</td>
                    <td>{!!it.suggest.length && <button className="btn-sm btn-plain" onClick={() => void a.run(`k${it.itemId}`, () => post('/admin/qlt/picks', { orderId: it.orderId,
                      picks: [...queue.items.filter((x) => x.orderId === it.orderId && x.itemId !== it.itemId).flatMap((x) => x.picks.map((p) => ({ itemId: x.itemId, lotId: p.lotId, qty: p.qty }))),
                              ...it.picks.map((p) => ({ itemId: it.itemId, lotId: p.lotId, qty: p.qty })), ...it.suggest.map((s) => ({ itemId: it.itemId, lotId: s.lotId, qty: s.qty }))] }),
                      () => setQueue(null))} data-qlt-pick={it.itemId}>제안대로 확정</button>}</td></tr>))}</tbody></table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ═════════════ 품질 클레임 ═════════════ */
interface Claim { id: string; receivedOn: string; source: string; defectType: string; title: string; qty: number; state: string; supReturnQty: number; code: string; name: string; label: string | null;
  lotNo: string | null; lotId: string | null; partyName: string | null; orderNo: string | null }
interface ClaimView { items: Claim[]; counts: Record<string, number>; states: Record<string, string>; sources: Record<string, string>; defects: Record<string, string>; note: string }
interface ClaimDetail { claim: Claim & { detail: string | null; cause: string | null; action: string | null; closeNote: string | null; partyId: string | null; optionId: string | null };
  logs: Array<{ kind: string; note: string | null; createdAt: string }>; returns: Array<{ id: string; date: string; qty: number; amount: number }> }
interface Stats { months: number; byDefect: Array<{ key: string; n: number; qty: number }>; byProduct: Array<{ key: string; name: string; n: number }>; bySupplier: Array<{ key: string; n: number; returned: number }>;
  repeats: Array<{ code: string; name: string; defectType: string; n: number; last: string }>; defects: Record<string, string> }

const CLAIM_EMPTY = { source: 'CUSTOMER', productId: '', optionId: '', lotId: '', partyId: '', orderNo: '', qty: '1', defectType: 'DAMAGE', title: '', detail: '' };

function ClaimBox({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useApi<ClaimDetail>(`/admin/qlt/claims/${id}`, [id]);
  const a = useAct();
  const [f, setF] = useState<{ cause: string; action: string } | null>(null);
  const c = q.data?.claim;
  if (!c) return null;
  const open = !['CLOSED', 'REJECTED'].includes(c.state);
  const cur = f ?? { cause: c.cause ?? '', action: c.action ?? '' };
  const reload = () => { q.reload(); onDone(); };
  return (
    <div className="card pad" data-qlt-claim-view={c.state}>
      <Flash msg={a.msg} err={a.err} />
      <b>클레임 {c.id} · {c.title}</b> — {c.name} {c.label ?? ''} · {c.qty}개 · 로트 {c.lotNo ?? '—'} · 공급사 {c.partyName ?? '—'} · 공급사 반품 {c.supReturnQty}개
      {c.detail && <p>{c.detail}</p>}
      <p>
        <textarea value={cur.cause} onChange={(e) => setF({ ...cur, cause: e.target.value })} rows={2} cols={40} placeholder="원인" disabled={!open} aria-label="원인" />{' '}
        <textarea value={cur.action} onChange={(e) => setF({ ...cur, action: e.target.value })} rows={2} cols={40} placeholder="조치" disabled={!open} aria-label="조치" />
      </p>
      {open && (
        <p>
          <button className="btn-sm" onClick={() => void a.run('e', () => post(`/admin/qlt/claims/${id}`, { cause: cur.cause, action: cur.action }, 'PUT'), () => { setF(null); reload(); })} data-qlt-claim-save="">원인 · 조치 저장</button>{' '}
          {c.state !== 'CHECKING' && <button className="btn-sm btn-plain" onClick={() => void a.run('s1', () => post(`/admin/qlt/claims/${id}`, { state: 'CHECKING' }, 'PUT'), reload)}>확인 중</button>}{' '}
          {c.state !== 'ACTION' && <button className="btn-sm btn-plain" onClick={() => void a.run('s2', () => post(`/admin/qlt/claims/${id}`, { state: 'ACTION' }, 'PUT'), reload)}>조치</button>}{' '}
          <button className="btn-sm btn-plain" onClick={() => {
            const v = Number(window.prompt(`공급사 반품 수량(남은 ${c.qty - c.supReturnQty}개 · SUPER · 지급 담당)`) ?? '');
            if (Number.isInteger(v) && v > 0) void a.run('r', () => post(`/admin/qlt/claims/${id}/supplier-return`, { qty: v }), reload);
          }} data-qlt-claim-return="">공급사 반품</button>{' '}
          <button className="btn-sm" onClick={() => void a.run('c', () => post(`/admin/qlt/claims/${id}/close`, { result: 'CLOSED' }), reload)} data-qlt-claim-close="">끝냄</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => { const why = window.prompt('반려 사유(2자 이상)') ?? ''; if (why.trim().length >= 2) void a.run('j', () => post(`/admin/qlt/claims/${id}/close`, { result: 'REJECTED', note: why }), reload); }}>반려</button>
        </p>
      )}
      {!!q.data?.returns.length && <p className="muted">공급사 반품: {q.data.returns.map((r) => `${r.date} ${Math.abs(r.qty)}개 · 원가 ${num(Math.abs(r.amount))}원`).join(' / ')}</p>}
      <ul className="muted">{(q.data?.logs ?? []).map((l, i) => <li key={i}>{ymdhm(l.createdAt)} · {l.kind} · {l.note ?? ''}</li>)}</ul>
    </div>
  );
}

export function QltClaims() {
  const [st, setSt] = useState('OPENALL');
  const q = useApi<ClaimView>(`/admin/qlt/claims?state=${st}`, [st]);
  const a = useAct();
  const [f, setF] = useState({ ...CLAIM_EMPTY });
  const [sel, setSel] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const d = q.data;
  const add = () => void a.run('n', () => post('/admin/qlt/claims', { source: f.source, productId: f.productId || undefined, optionId: f.optionId || undefined, lotId: f.lotId || undefined,
    partyId: f.partyId || undefined, orderNo: f.orderNo || undefined, qty: Number(f.qty), defectType: f.defectType, title: f.title, detail: f.detail || undefined }),
    () => { setF({ ...CLAIM_EMPTY }); q.reload(); });
  return (
    <section data-qlt-claims={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className="muted">{d.note}</p>
          <div className="card pad" data-qlt-claim-new="">
            <b>클레임 접수</b>{' '}
            <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} aria-label="경로">{Object.entries(d.sources).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
            <select value={f.defectType} onChange={(e) => setF({ ...f, defectType: e.target.value })} aria-label="불량">{Object.entries(d.defects).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
            <input value={f.lotId} onChange={(e) => setF({ ...f, lotId: e.target.value.trim() })} placeholder="로트 번호(목록 번호)" size={10} />{' '}
            <input value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value.trim() })} placeholder="상품 uuid(로트 없으면)" size={16} />{' '}
            <input value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} placeholder="주문 번호" size={14} />{' '}
            <input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={{ width: 60 }} aria-label="수량" />{' '}
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" size={18} />{' '}
            <button className="btn-sm" disabled={f.title.trim().length < 2 || (!f.lotId && !f.productId) || a.busy === 'n'} onClick={add} data-qlt-claim-add="">접수</button>
          </div>
          <p>
            {['OPENALL', 'OPEN', 'CHECKING', 'ACTION', 'CLOSED', 'REJECTED', ''].map((k) => (
              <button key={k || 'ALL'} className={`btn-sm ${st === k ? '' : 'btn-plain'}`} onClick={() => setSt(k)} data-qlt-claim-tab={k || 'ALL'}>
                {k === 'OPENALL' ? '열린 것' : k ? d.states[k] : '모두'}{k && k !== 'OPENALL' ? ` ${d.counts[k] ?? 0}` : ''}</button>))}{' '}
            <button className="btn-sm btn-plain" onClick={() => void a.run('st', async () => { const r = await api<Stats>('/admin/qlt/claims/stats?months=6'); setStats(r); return r; }, undefined, () => '집계를 열었습니다.')} data-qlt-claim-stats="">집계 · 재발</button>
          </p>
          <table className="tbl"><thead><tr><th>번호</th><th>접수</th><th>경로</th><th>불량</th><th>제목</th><th>상품</th><th>로트</th><th>공급사</th><th className="num">수량</th><th className="num">반품</th><th>상태</th></tr></thead>
            <tbody>{d.items.map((c) => (
              <tr key={c.id} className={sel === c.id ? 'on' : ''} onClick={() => setSel(c.id)} style={{ cursor: 'pointer' }} data-qlt-claim-row={c.state}>
                <td>{c.id}</td><td>{c.receivedOn}</td><td>{d.sources[c.source] ?? c.source}</td><td>{d.defects[c.defectType] ?? c.defectType}</td><td>{c.title}</td>
                <td>{c.name} {c.label ?? ''}</td><td>{c.lotNo ?? '—'}</td><td>{c.partyName ?? '—'}</td><td className="num">{c.qty}</td><td className="num">{c.supReturnQty || ''}</td><td>{d.states[c.state] ?? c.state}</td>
              </tr>))}</tbody></table>
          {sel && <ClaimBox id={sel} onDone={q.reload} />}
          {stats && (
            <div className="card pad" data-qlt-stats={stats.repeats.length}>
              <b>최근 {stats.months}달 집계</b> <button className="btn-sm btn-plain" onClick={() => setStats(null)}>닫기</button>
              <p>불량 유형: {stats.byDefect.map((x) => `${stats.defects[x.key] ?? x.key} ${x.n}건`).join(' · ') || '없음'}</p>
              <p>상품: {stats.byProduct.map((x) => `${x.name} ${x.n}`).join(' · ') || '없음'}</p>
              <p>공급사: {stats.bySupplier.map((x) => `${x.key} ${x.n}(반품 ${x.returned})`).join(' · ') || '없음'}</p>
              <p className={stats.repeats.length ? 'warn-text' : 'muted'}>재발(90일 2건 이상): {stats.repeats.map((x) => `${x.name} ${stats.defects[x.defectType] ?? x.defectType} ${x.n}건`).join(' · ') || '없음'}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
