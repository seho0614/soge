import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

/**
 * v10.207 (D184 · docs/332) — 청구 현황(SB-ADM-BIL-010) › 「요금제 금액 · 한도」
 *   금액은 오픈 전에 대표가 정함(subscription-referral-code #13). 고치기는 SUPER · 사유 필수 · 감사 PLAN_SAVE.
 *   올리면 이용 중인 구독은 원래 금액으로 계속 결제(새 구독부터 새 금액) · 내리면 모두 다음 결제부터.
 *   무료 ↔ 유료 전환은 서버가 막음 · 무료 요금제 열람 한도는 운영 설정 request.view.free_monthly 를 따름.
 *   v10.269 (docs/397) 아래 「요금제 금액 시뮬레이션」 — 지금 금액을 불러와 가정(구독자 수 · 요금제별 비율 · 금액 · 기간 · 달마다 늚)으로
 *     한 달 · 기간 매출 · 부가세 포함 금액이면 공급가액 · 부가세. **계산만 — 저장하지 않음**.
 */
interface Plan {
  code: string; name: string; monthlyPrice: number; includedCodes: number; extraCodePrice: number;
  proposalLimit: number | null; requestViews: number | null; listingSlots: number | null;
  prioritySlots: number; successFee: number; subscribers: number; locked: number;
}
interface Change { id: string; planCode: string; at: string; by: string; reason: string; locked: number; lowered: number; diff: string | null }
interface PlanList { plans: Plan[]; changes: Change[] }

/** 화면 칸 → 서버 칸 · 비우면 무제한인 칸 */
const COLS: Array<{ k: keyof Plan; f: string; label: string; won?: boolean; nullable?: boolean }> = [
  { k: 'monthlyPrice', f: 'monthly_price', label: '월 요금', won: true },
  { k: 'includedCodes', f: 'included_codes', label: '포함 소개코드' },
  { k: 'extraCodePrice', f: 'extra_code_price', label: '추가 코드 금액', won: true },
  { k: 'proposalLimit', f: 'proposal_limit', label: '소개 제안 / 월', nullable: true },
  { k: 'requestViews', f: 'request_views_per_month', label: '열람 / 월', nullable: true },
  { k: 'listingSlots', f: 'listing_slots', label: '매물 슬롯', nullable: true },
  { k: 'prioritySlots', f: 'priority_slot_count', label: '우선노출' },
  { k: 'successFee', f: 'success_fee', label: '성사 수수료', won: true },
];
const show = (v: number | null, won?: boolean) => (v == null ? '무제한' : won ? `${v.toLocaleString('ko-KR')}원` : v.toLocaleString('ko-KR'));

export function PlanPanel() {
  const r = useApi<PlanList>('/admin/billing/plans');
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const sup = tokenRoles().includes('SUPER');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  const d = r.data;

  function open(p: Plan) {
    setEdit(p.code); setReason(''); setRes(null);
    setDraft(Object.fromEntries(COLS.map((c) => [c.f, p[c.k] == null ? '' : String(p[c.k])])));
  }
  async function save(p: Plan) {
    const body: Record<string, number | null | string> = { reason };
    for (const c of COLS) {
      const raw = (draft[c.f] ?? '').trim();
      const now = p[c.k] == null ? '' : String(p[c.k]);
      if (raw === now) continue;
      body[c.f] = raw === '' ? null : Number(raw);
    }
    if (Object.keys(body).length === 1) { setRes({ ok: false, text: '바꾼 칸이 없습니다.' }); return; }
    const np = body.monthly_price;
    const line = typeof np === 'number' && np !== p.monthlyPrice
      ? (np > p.monthlyPrice
        ? `월 요금을 올립니다(${show(p.monthlyPrice, true)} → ${show(np, true)}). 이용 중인 구독 ${p.subscribers}명은 원래 금액으로 계속 결제되고, 새 구독부터 새 금액입니다.`
        : `월 요금을 내립니다(${show(p.monthlyPrice, true)} → ${show(np, true)}). 이용 중인 구독 ${p.subscribers}명은 다음 결제부터 새 금액입니다.`)
      : '월 요금은 그대로입니다. 한도만 바뀝니다(이용 중인 구독에도 바로 적용).';
    if (!window.confirm(`${p.name} 요금제를 바꿀까요?\n\n${line}\n\n사유: ${reason}`)) return;
    try {
      const x = await api<{ locked: number; lowered: number }>(`/admin/billing/plans/${p.code}`, { method: 'PUT', body: JSON.stringify(body) });
      setRes({ ok: true, text: `${p.name} — 바꿨습니다${x.locked ? ` · 원래 금액을 묶은 구독 ${x.locked}명` : ''}${x.lowered ? ` · 다음 결제부터 내린 금액 ${x.lowered}명` : ''}` });
      setEdit(null); r.reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '바꾸지 못했습니다.' });
    }
  }

  return (
    <div className="card" data-plans>
      <h3 className="sec">요금제 금액 · 한도</h3>
      <p className="hint">금액을 올리면 이용 중인 구독은 원래 금액으로 계속 결제되고 새 구독부터 새 금액입니다. 내리면 모두 다음 결제부터 적용됩니다. 무료 요금제는 유료로 바꿀 수 없고, 무료 요금제의 열람 한도는 운영 설정 <code>request.view.free_monthly</code> 를 따릅니다. 빈칸은 무제한입니다.</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>요금제</th>{COLS.map((c) => <th key={c.f}>{c.label}</th>)}<th>이용 중</th>{sup && <th />}</tr></thead>
          <tbody>
            {d.plans.map((p) => (
              <tr key={p.code} data-plan={p.code}>
                <td>{p.name} <span className="dim">{p.code}</span></td>
                {COLS.map((c) => (
                  <td key={c.f}>
                    {edit === p.code
                      ? <input value={draft[c.f] ?? ''} inputMode="numeric" style={{ width: 90 }}
                          placeholder={c.nullable ? '무제한' : ''} onChange={(e) => setDraft((x) => ({ ...x, [c.f]: e.target.value }))} data-plan-field={c.f} />
                      : <span data-plan-val={c.f}>{show(p[c.k] as number | null, c.won)}</span>}
                  </td>
                ))}
                <td>{p.subscribers}{p.locked > 0 && <span className="dim" data-plan-locked> · 원래 금액 {p.locked}</span>}</td>
                {sup && (
                  <td>{edit === p.code
                    ? <button className="btn-plain" onClick={() => setEdit(null)}>취소</button>
                    : <button className="btn-plain" onClick={() => open(p)} data-plan-edit>고치기</button>}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sup && edit && (
        <div className="ad-dact">
          <input value={reason} maxLength={200} placeholder="바꾸는 사유(예: 오픈 요금 확정)" onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} data-plan-reason />
          <button className="btn-ok" disabled={reason.trim().length < 2} onClick={() => save(d.plans.find((p) => p.code === edit)!)} data-plan-save>저장</button>
        </div>
      )}
      {res && <p className={res.ok ? 'hint' : 'form-error'} data-plan-res>{res.text}</p>}
      <PlanSim plans={d.plans} />
      {d.changes.length > 0 && (
        <>
          <h4>최근 변경</h4>
          <table className="tbl" data-plan-changes>
            <thead><tr><th style={{ width: 130 }}>언제</th><th>요금제</th><th>바뀐 것</th><th>사유</th><th>누가</th></tr></thead>
            <tbody>
              {d.changes.map((c) => (
                <tr key={c.id}>
                  <td>{c.at}</td><td>{c.planCode}</td>
                  <td>{c.diff ?? '—'}{c.locked ? ` · 원래 금액 묶음 ${c.locked}` : ''}{c.lowered ? ` · 내림 적용 ${c.lowered}` : ''}</td>
                  <td>{c.reason}</td><td>{c.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** v10.269 (docs/397) — 요금제 금액 시뮬레이션 · 계산만(서버에 보내지 않음) */
function planSim(n: number, rows: Array<{ pct: number; price: number }>, months: number, grow: number) {
  const per = rows.map((r) => { const subs = Math.floor((n * r.pct) / 100); return { subs, amt: subs * r.price }; });
  const month = per.reduce((a, x) => a + x.amt, 0);
  let period = 0;
  for (let m = 0; m < months; m += 1) period += Math.floor(month * Math.pow(1 + grow / 100, m));
  const supply = Math.floor(month / 1.1);
  return { per, month, period, supply, vat: month - supply };
}

function PlanSim({ plans }: { plans: Plan[] }) {
  const paid = plans.filter((p) => p.monthlyPrice > 0).length;
  const [n, setN] = useState('100');
  const [months, setMonths] = useState('12');
  const [grow, setGrow] = useState('0');
  const [pct, setPct] = useState<Record<string, string>>(() => Object.fromEntries(plans.map((p) => [p.code, p.monthlyPrice > 0 ? String(paid ? Math.floor(30 / paid) : 0) : '70'])));
  const [price, setPrice] = useState<Record<string, string>>(() => Object.fromEntries(plans.map((p) => [p.code, String(p.monthlyPrice)])));
  const num = (v: string | undefined) => Math.max(0, Number((v ?? '').replace(/[^0-9.]/g, '')) || 0);
  const r = planSim(Math.floor(num(n)), plans.map((p) => ({ pct: num(pct[p.code]), price: Math.floor(num(price[p.code])) })), Math.min(60, Math.floor(num(months))), num(grow));
  const sumPct = plans.reduce((a, p) => a + num(pct[p.code]), 0);
  const won = (v: number) => `${v.toLocaleString('ko-KR')}원`;
  return (
    <div className="card pad" data-plan-sim={`${r.month}|${r.period}`} style={{ marginTop: 10 }}>
      <b>요금제 금액 시뮬레이션</b> <span className="dim">— 계산만 · 저장하지 않음 · 금액은 위 표에서 불러옴(바꿔 넣어 볼 수 있음)</span>
      <p style={{ margin: '6px 0' }}>
        <label>구독하는 회원 수 <input value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" style={{ width: 80 }} data-plan-sim-in="n" /></label>{' '}
        <label>기간(달) <input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" style={{ width: 50 }} data-plan-sim-in="months" /></label>{' '}
        <label>달마다 늚(%) <input value={grow} onChange={(e) => setGrow(e.target.value)} inputMode="decimal" style={{ width: 50 }} data-plan-sim-in="grow" /></label>
      </p>
      <table className="tbl">
        <thead><tr><th>요금제</th><th>비율(%)</th><th>월 금액</th><th>구독자</th><th>한 달 매출</th></tr></thead>
        <tbody>
          {plans.map((p, i) => (
            <tr key={p.code} data-plan-sim-row={p.code}>
              <td>{p.name}</td>
              <td><input value={pct[p.code] ?? ''} onChange={(e) => setPct((x) => ({ ...x, [p.code]: e.target.value }))} inputMode="decimal" style={{ width: 60 }} data-plan-sim-pct={p.code} /></td>
              <td><input value={price[p.code] ?? ''} onChange={(e) => setPrice((x) => ({ ...x, [p.code]: e.target.value }))} inputMode="numeric" style={{ width: 90 }} data-plan-sim-price={p.code} /></td>
              <td>{r.per[i]!.subs.toLocaleString('ko-KR')}명</td>
              <td>{won(r.per[i]!.amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sumPct !== 100 && <p className="warn-text" data-plan-sim-pctwarn={sumPct}>비율 합계 {sumPct}% — 100% 가 되게 맞추십시오</p>}
      <table className="tbl" style={{ marginTop: 6 }}><tbody>
        <tr><th>한 달 매출</th><td data-plan-sim-out="month"><b>{won(r.month)}</b></td></tr>
        <tr><th>기간 합계({Math.min(60, Math.floor(num(months)))}달)</th><td data-plan-sim-out="period"><b>{won(r.period)}</b></td></tr>
        <tr><th>금액이 부가세 포함이면</th><td data-plan-sim-out="vat">한 달 공급가액 {won(r.supply)} · 부가세 {won(r.vat)}</td></tr>
      </tbody></table>
      <p className="dim" style={{ marginTop: 4 }}>추가 소개코드 · 성사 수수료 · 결제 수수료 · 환불은 넣지 않은 어림입니다. 요금제 금액에 부가세가 들어 있는지는 세무 확인이 필요합니다.</p>
    </div>
  );
}
