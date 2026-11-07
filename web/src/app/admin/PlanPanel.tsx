import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

/**
 * v10.207 (D184 · docs/332) — 청구 현황(SB-ADM-BIL-010) › 「요금제 금액 · 한도」
 *   금액은 오픈 전에 대표가 정함(subscription-referral-code #13). 고치기는 SUPER · 사유 필수 · 감사 PLAN_SAVE.
 *   올리면 이용 중인 구독은 원래 금액으로 계속 결제(새 구독부터 새 금액) · 내리면 모두 다음 결제부터.
 *   무료 ↔ 유료 전환은 서버가 막음 · 무료 요금제 열람 한도는 운영 설정 request.view.free_monthly 를 따름.
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
