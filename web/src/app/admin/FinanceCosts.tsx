import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { label } from '../../lib/codes';

/**
 * v10.31 (10/10 시안 · 대시보드 「활주로」) — 활주로 계산에 쓰는 월 비용 · 시작 현금 입력.
 * 매출은 DB 에 실제로 들어온 돈(v_monthly_revenue)이고, 비용은 여기서 운영이 넣은 값(ops_monthly_costs)입니다 — 숫자를 지어내지 않습니다.
 *   GET /admin/finance/runway · GET /admin/finance/costs · PUT /admin/finance/costs{month, category, amount, memo}
 *   시작 현금 = 사이트 설정 finance.opening_cash (PATCH /admin/site-settings)
 */
interface Row { month: string; revenue: number; cost: number; net: number; cum: number; hasCost: boolean }
interface Runway { months: Row[]; breakEven: { label: string }; avgCost: number | null; openingCash: number | null; notes: string[]; basis: string }
interface Cost { month: string; category: string; categoryLabel: string; amount: number | string; memo: string | null; enteredBy: string | null }
const CATS = ['PAYROLL', 'RENT', 'INFRA', 'MARKETING', 'PG_FEE', 'OUTSOURCE', 'TAX', 'ETC'];

export function FinanceCosts() {
  const rw = useApi<Runway>('/admin/finance/runway');
  const cur = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(cur);
  const costs = useApi<Cost[]>(`/admin/finance/costs?month=${month}`);
  const a = useAct();
  const [cat, setCat] = useState('PAYROLL');
  const [amt, setAmt] = useState('');
  const [memo, setMemo] = useState('');
  const [open, setOpen] = useState('');

  const save = () => a.run('cost', () => api('/admin/finance/costs', { method: 'PUT', body: JSON.stringify({ month, category: cat, amount: Number(amt.replace(/,/g, '')), memo: memo || undefined }) }),
    () => { setAmt(''); setMemo(''); costs.reload(); rw.reload(); }, `${month} ${label('finance.cost', cat)} 비용을 저장했습니다 — 활주로가 다시 계산됩니다.`);
  const saveOpen = () => a.run('open', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'finance.opening_cash', value: open.replace(/,/g, '') }) }),
    () => { setOpen(''); rw.reload(); }, '시작 현금을 저장했습니다.');

  if (rw.error) return <ErrorView error={rw.error} onRetry={rw.reload} />;
  const r = rw.data;
  const list = costs.data ?? [];
  const sum = list.reduce((s, c) => s + Number(c.amount || 0), 0);
  return (
    <section data-finance-costs>
      <h2>월 비용 · 활주로</h2>
      {r?.notes.map((x) => <div key={x} className="ad-nt warn">{x}</div>)}
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-form">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="비용 달" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="비용 항목">
          {CATS.map((c) => <option key={c} value={c}>{label('finance.cost', c)}</option>)}
        </select>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="금액(원)" inputMode="numeric" aria-label="비용 금액" />
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모(선택)" aria-label="비용 메모" />
        <button className="btn-ok" disabled={!/^[0-9,]+$/.test(amt.trim()) || a.busy === 'cost'} onClick={save}>저장</button>
      </div>
      <p className="dim" style={{ fontSize: 12 }}>같은 달 · 같은 항목을 다시 넣으면 그 값으로 바뀝니다(누가 · 언제 넣었는지 남음).</p>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>{month} 항목</th><th className="num-cell">금액</th><th>메모</th><th>입력</th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={4} className="muted">이 달 비용이 아직 없습니다.</td></tr>}
          {list.map((c) => <tr key={c.category}><td>{c.categoryLabel}</td><td className="num-cell">{n(c.amount)}원</td><td>{c.memo ?? '—'}</td><td className="dim">{c.enteredBy ?? '—'}</td></tr>)}
        </tbody>
        {list.length > 0 && <tfoot><tr><td><b>합계</b></td><td className="num-cell"><b>{n(sum)}원</b></td><td colSpan={2} /></tr></tfoot>}
      </table></div>

      <div className="ad-form">
        <span>시작 현금 <b>{r?.openingCash != null ? `${n(r.openingCash)}원` : '미입력'}</b></span>
        <input value={open} onChange={(e) => setOpen(e.target.value)} placeholder="첫 기록 달의 시작 현금(원)" inputMode="numeric" aria-label="시작 현금" />
        <button className="btn-plain" disabled={!/^[0-9,]+$/.test(open.trim()) || a.busy === 'open'} onClick={saveOpen}>바꾸기</button>
      </div>

      {r && r.months.length > 0 && (
        <div className="ad-tw"><table className="tbl" data-runway-months>
          <thead><tr><th>달</th><th className="num-cell">매출(실제)</th><th className="num-cell">비용(입력)</th><th className="num-cell">손익</th><th className="num-cell">누적</th></tr></thead>
          <tbody>{r.months.slice(-12).map((m) => (
            <tr key={m.month} className={m.net < 0 ? 'hl' : undefined}>
              <td className="mono">{m.month}</td><td className="num-cell">{n(m.revenue)}원</td>
              <td className="num-cell">{m.hasCost ? `${n(m.cost)}원` : <span className="dim">미입력</span>}</td>
              <td className="num-cell">{n(m.net)}원</td><td className="num-cell">{n(m.cum)}원</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {r && <p className="dim" style={{ fontSize: 12 }}>손익분기 {r.breakEven.label} · {r.basis}</p>}
    </section>
  );
}
