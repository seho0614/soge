import { DatabaseService } from '../../db/database.service';
import { cashflow, CashItem } from './cashflow';
import { ratesOf } from './payroll';
import { deptPnl } from './depts';
import { corpDeadlines, corpTaxPreview } from './corptax';

/* ---------------------------------------------------------------------
 * v10.476 (D266 · docs/614) 12개월 자금 계획 — 대표 11/20 「㊱」 · 표 없음(원래 자료에서 그때그때 셈 · 따로 저장하지 않음)
 *   시작 잔액 = ⑫ 자금 흐름과 같음(직접 넣은 잔액 · 통장 CSV 중 최근 + 그 뒤 장부 보통예금)
 *   달마다
 *     ① 90일 안 확정된 돈 — ⑫ cashflow() 항목 그대로(광고 청구 · PG 정산 · 미지급금 · 카드 · 포인트 출금 · 입점 정산 · 직접 적은 예정)
 *        (부가세 · 원천세는 빼고 ⑤ 에서 한 번만 셈 · 계약에서 생긴 예정은 「계약 고정비」로 이름만 바꿈)
 *     ② 90일 뒤 — 직접 적은 예정(acct_cash_plans · 한 번 · 매달 · 계약 고정비 포함)
 *     ③ 계약 고정비 중 예정이 없는 것(⑯ acct_contracts · 달 금액 · 끝난 예정) — 다음 낼 날부터 만기까지 추정
 *     ④ 급여 — 그 달 급여가 지급(PAID)이면 없음(이미 통장에서 나감) · 확정 · 초안이면 줄 합(지급액 + 회사 4대보험) · 없으면
 *        그 달 재직 직원 월 기본급 × (1 + 회사 4대보험 요율 합) 추정 · 지급일 acct.pay_day
 *        (본인 원천세 · 4대보험은 지급액 안에 있어 같은 달에 셈 — 다음 달 10일보다 한 달 앞당겨 보수적으로)
 *     ⑤ 세금 기한 — 원천세(매월 10일 · 지난달 장부 WHT · 그 달 급여를 ④ 에서 이미 셌으면 빼고) · 부가세(acct.vat_months 25일 · 기간 장부 VAT_OUT − VAT_IN)
 *        · 법인세 중간예납 · 확정(추정 — 법인세 추정 화면과 같은 셈 · 세무조정 없음)
 *     ⑥ 예상 매출 — acct.cashplan_sales: TARGET ㉘ 매출 목표(회사 전체 · 이번 달은 목표 − 지금까지 매출) · CRM ㉝ 영업 기회 가중(상담 10 · 견적 30 · 계약 70% ·
 *        예상 마감 달) · NONE · acct.cashplan_collect_months 달 뒤 들어옴 · 공급가만(부가세 빼고 — 보수적)
 *   달 말 예상 잔액이 acct.cash_floor 밑인 달 = 모자라는 달 → 정기 작업 acct_cashplan(매일 09:35)이 첫 달 하나를 ACCT_CASHPLAN_SHORT(바뀌면 새로 · 넉넉해지면 풀림)
 *   ㉝ 영업 기회(sal_opps)가 없는 판에서도 돎(표가 없으면 CRM 은 0 · 안내).
 * ------------------------------------------------------------------- */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymAdd = (ym: string, k: number) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + k; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
const ymDay = (ym: string, d: number) => `${ym}-${String(Math.min(d, lastDay(Number(ym.slice(0, 4)), Number(ym.slice(5, 7))))).padStart(2, '0')}`;
const monthEnd = (ym: string) => ymDay(ym, 31);

export type PlanKind = 'AR_AD' | 'PG' | 'PLAN_IN' | 'SALES_EST' | 'AP' | 'CARD' | 'CASHOUT' | 'SELLER' | 'PLAN_OUT' | 'CONTRACT' | 'PAYROLL' | 'WHT' | 'VAT' | 'CORP';
export const PLAN_KIND_KO: Record<PlanKind, string> = {
  AR_AD: '광고 청구 받을 돈', PG: 'PG 정산', PLAN_IN: '예정(들어옴)', SALES_EST: '예상 매출',
  AP: '미지급금', CARD: '법인카드 대금', CASHOUT: '포인트 출금', SELLER: '입점 판매자 정산', PLAN_OUT: '예정(나감)', CONTRACT: '계약 고정비',
  PAYROLL: '급여 · 4대보험', WHT: '원천세', VAT: '부가세', CORP: '법인세',
};
export const CRM_WEIGHT: Record<string, number> = { LEAD: 0.1, QUOTE: 0.3, CONTRACT: 0.7 };   // ㉝ 영업 기회 화면 가중 매출과 같은 상수(세무 · 노무 값 아님)
export interface PlanItem { date: string; dir: 'IN' | 'OUT'; kind: PlanKind; amount: number; label: string; estimate?: boolean; source: 'CASHFLOW' | 'PLAN' | 'CONTRACT' | 'PAYROLL' | 'TAX' | 'SALES' }

async function settings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('acct.cashplan_sales', 'acct.cashplan_collect_months', 'acct.cashplan_alert', 'acct.pay_day', 'acct.vat_months')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const basis = ['TARGET', 'CRM', 'NONE'].includes(v('acct.cashplan_sales') ?? '') ? (v('acct.cashplan_sales') as 'TARGET' | 'CRM' | 'NONE') : 'TARGET';
  const collect = Math.min(3, Math.max(0, Math.trunc(Number(v('acct.cashplan_collect_months') ?? 1)) || 0));
  const months = (v('acct.vat_months') ?? '1,4,7,10').split(',').map(Number).filter((x) => x >= 1 && x <= 12).sort((a, b) => a - b);
  return { basis, collect, alert: (v('acct.cashplan_alert') ?? 'on') === 'on', payDay: Math.min(28, Math.max(1, Number(v('acct.pay_day') ?? 25) || 25)),
           vatMonths: months.length ? months : [1, 4, 7, 10] };
}

/** 주말 · 공휴일이면 다음 영업일(DB fn_is_business_day — month.ts 와 같은 방식) */
async function bizDay(db: DatabaseService, d: string) {
  const [r] = await db.query<{ d: string }>(
    `WITH RECURSIVE x(d, k) AS (SELECT $1::date, 0 UNION ALL SELECT d + 1, k + 1 FROM x WHERE NOT fn_is_business_day(d) AND k < 30)
     SELECT d::text AS d FROM x ORDER BY k DESC LIMIT 1`, [d]);
  return r?.d ?? d;
}

async function roleSum(db: DatabaseService, role: string, from: string, to: string) {
  const [r] = await db.query<{ s: string }>(
    `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS s FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE l.role = $1 AND e.entry_date BETWEEN $2::date AND $3::date`, [role, from, to]);
  return n(r?.s);
}

/** GET /admin/acct/cash-plan?months= — 달마다 들어올 돈 · 나갈 돈 · 달 말 예상 잔액 · 모자라는 달 */
export async function cashPlan(db: DatabaseService, monthsIn = 12, today = kstToday()) {
  const months = Math.min(18, Math.max(3, Math.trunc(monthsIn) || 12));
  const s = await settings(db);
  const ym0 = today.slice(0, 7);
  const yms = Array.from({ length: months }, (_, i) => ymAdd(ym0, i));
  const end = monthEnd(yms[yms.length - 1]!);
  const items: PlanItem[] = [];
  const clamp = (d: string) => (d < today ? today : d);

  /* ① 90일 확정(⑫ 그대로 · 세금은 ⑤ 에서) */
  const cf = await cashflow(db, 90, today);
  const contractPlans = new Set((await db.query<{ id: string }>(
    `SELECT cash_plan_id::text AS id FROM acct_contracts WHERE cash_plan_id IS NOT NULL`)).map((r) => r.id));
  for (const row of cf.rows) for (const it of row.items as CashItem[]) {
    if (it.kind === 'VAT' || it.kind === 'WHT') continue;
    const kind: PlanKind = it.kind === 'PLAN_OUT' && it.ref && contractPlans.has(it.ref) ? 'CONTRACT' : it.kind;
    items.push({ date: it.date, dir: it.dir, kind, amount: it.amount, label: it.label, source: 'CASHFLOW' });
  }

  /* ② 90일 뒤 예정(한 번 · 매달) */
  const plans = await db.query<{ id: string; due: string; dir: 'IN' | 'OUT'; amount: string; memo: string; repeat: string; until: string | null }>(
    `SELECT id::text AS id, due_on::text AS due, direction AS dir, amount::bigint AS amount, memo, repeat, until_on::text AS until
       FROM acct_cash_plans WHERE state = 'ACTIVE' AND due_on <= $1::date AND (repeat = 'MONTHLY' OR due_on > $2::date)`, [end, cf.end]);
  for (const p of plans) {
    const kind: PlanKind = p.dir === 'IN' ? 'PLAN_IN' : contractPlans.has(p.id) ? 'CONTRACT' : 'PLAN_OUT';
    const push = (d: string) => items.push({ date: d, dir: p.dir, kind, amount: n(p.amount), label: `${p.memo}${p.repeat === 'MONTHLY' ? '(매달)' : ''}`, source: 'PLAN' });
    if (p.repeat !== 'MONTHLY') { if (p.due > cf.end && p.due <= end) push(p.due); continue; }
    const day = Number(p.due.slice(8, 10));
    for (let k = 0; k < 240; k++) {
      const d = ymDay(ymAdd(p.due.slice(0, 7), k), day);
      if (d > end || (p.until && d > p.until)) break;
      if (d > cf.end) push(d);
    }
  }

  /* ③ 계약 고정비 중 예정이 없는 것(예정을 취소했거나 처음부터 없음) */
  const lone = await db.query<{ id: string; title: string; amt: string; pay_day: number; start_on: string; end_on: string | null }>(
    `SELECT c.id::text AS id, c.title, c.monthly_amount::bigint AS amt, c.pay_day, c.start_on::text AS start_on, c.end_on::text AS end_on
       FROM acct_contracts c LEFT JOIN acct_cash_plans p ON p.id = c.cash_plan_id
      WHERE c.state = 'ACTIVE' AND c.monthly_amount > 0 AND c.pay_day IS NOT NULL AND (p.id IS NULL OR p.state <> 'ACTIVE')`);
  for (const c of lone) {
    for (const ym of yms) {
      const d = ymDay(ym, c.pay_day);
      if (d < today || d < c.start_on || (c.end_on && d > c.end_on)) continue;
      items.push({ date: d, dir: 'OUT', kind: 'CONTRACT', amount: n(c.amt), label: `계약 ${c.title}(예정 없음 · 추정)`, estimate: true, source: 'CONTRACT' });
    }
  }

  /* ④ 급여 */
  const runs = await db.query<{ ym: string; state: string; pay_day: string; total: string }>(
    `SELECT r.ym, r.state, r.pay_day::text AS pay_day,
            coalesce((SELECT sum(l.gross + l.company_np + l.company_hi + l.company_ltc + l.company_ei) FROM acct_payroll_lines l WHERE l.run_id = r.id), 0)::text AS total
       FROM acct_payroll_runs r WHERE r.ym = ANY($1::text[])`, [yms.concat([ymAdd(ym0, -1)])]);
  const runOf = (ym: string) => runs.find((r) => r.ym === ym);
  const payrollCounted = new Set<string>();
  for (const ym of yms) {
    const r = runOf(ym);
    if (r?.state === 'PAID') continue;
    if (r) {
      if (n(r.total) > 0) items.push({ date: clamp(r.pay_day), dir: 'OUT', kind: 'PAYROLL', amount: n(r.total), label: `급여 ${ym}(${r.state === 'FIXED' ? '확정' : '초안'} · 회사 4대보험 포함)`, source: 'PAYROLL' });
      payrollCounted.add(ym);
      continue;
    }
    const [e] = await db.query<{ base: string; cnt: number }>(
      `SELECT coalesce(sum(monthly_base), 0)::text AS base, count(*)::int AS cnt FROM acct_employees
        WHERE joined_on <= $2::date AND (left_on IS NULL OR left_on >= $1::date)`, [`${ym}-01`, monthEnd(ym)]);
    if (n(e?.base) <= 0) continue;
    const rt = (await ratesOf(db, Number(ym.slice(0, 4)))).rates;
    const hi = n(rt.hi_rate);
    const companyPct = n(rt.np_rate) + hi + hi * n(rt.ltc_rate) / 100 + n(rt.ei_company_rate) + n(rt.ia_company_rate);
    const amt = Math.round(n(e!.base) * (1 + companyPct / 100));
    items.push({ date: clamp(ymDay(ym, s.payDay)), dir: 'OUT', kind: 'PAYROLL', amount: amt,
                 label: `급여 ${ym} 추정(직원 ${e!.cnt}명 기본급 + 회사 4대보험 ${Math.round(companyPct * 100) / 100}%)`, estimate: true, source: 'PAYROLL' });
    payrollCounted.add(ym);
  }

  /* ⑤ 세금 기한 */
  for (const ym of yms) {
    const src = ymAdd(ym, -1);
    const due10 = await bizDay(db, `${ym}-10`);
    if (due10 >= today && due10 <= end && !payrollCounted.has(src)) {
      const amt = await roleSum(db, 'WHT', `${src}-01`, monthEnd(src));
      if (amt > 0) items.push({ date: due10, dir: 'OUT', kind: 'WHT', amount: amt, label: `원천세(${src} 지급분 · 장부)`, estimate: monthEnd(src) >= today, source: 'TAX' });
    }
    const mon = Number(ym.slice(5, 7));
    if (s.vatMonths.includes(mon)) {
      const due25 = await bizDay(db, `${ym}-25`);
      if (due25 >= today && due25 <= end) {
        const idx = s.vatMonths.indexOf(mon);
        const prev = idx > 0 ? s.vatMonths[idx - 1]! : s.vatMonths[s.vatMonths.length - 1]! - 12;
        const pf = `${ymAdd(ym, -(mon - prev))}-01`, pt = monthEnd(ymAdd(ym, -1));
        const amt = (await roleSum(db, 'VAT_OUT', pf, pt)) + (await roleSum(db, 'VAT_IN', pf, pt));   // VAT_IN 은 차변 잔액이라 (대변 − 차변) 이 음수 → 더하면 빼는 셈
        if (amt > 0) items.push({ date: due25, dir: 'OUT', kind: 'VAT', amount: amt, label: `부가세(${pf.slice(0, 7)} ~ ${pt.slice(0, 7)} · 장부)`, estimate: pt >= today, source: 'TAX' });
      }
    }
  }
  const corp = await corpTaxPreview(db, today).catch(() => null);
  for (const c of await corpDeadlines(db, today).catch(() => [])) {
    if (c.due > end || !corp) continue;
    const amt = c.key.startsWith('CORP_MID') ? n(corp.interim?.total) : Math.max(0, n(corp.annualized?.total) - n(corp.interim?.total));
    if (amt > 0) items.push({ date: c.due, dir: 'OUT', kind: 'CORP', amount: amt, label: `${c.label}(추정 · 세무조정 없음)`, estimate: true, source: 'TAX' });
  }

  /* ⑥ 예상 매출 */
  let salesNote = '';
  if (s.basis === 'TARGET') {
    const tg = await db.query<{ ym: string; amount: string }>(
      `SELECT ym, amount::text AS amount FROM acct_sales_targets WHERE axis = 'TOTAL' AND ym = ANY($1::text[])`, [yms]);
    const actual = (await deptPnl(db, `${ym0}-01`, today, 'dept').catch(() => null))?.total?.revenue ?? 0;
    for (const t of tg) {
      const amt = t.ym === ym0 ? Math.max(0, n(t.amount) - n(actual)) : n(t.amount);
      const inYm = ymAdd(t.ym, s.collect);
      if (amt <= 0 || !yms.includes(inYm)) continue;
      items.push({ date: clamp(monthEnd(inYm)), dir: 'IN', kind: 'SALES_EST', amount: amt, label: `매출 목표 ${t.ym}${t.ym === ym0 ? '(남은 몫)' : ''} · ${s.collect}달 뒤 들어옴`, estimate: true, source: 'SALES' });
    }
    salesNote = tg.length ? '' : '매출 목표(회사 전체)가 없어 예상 매출은 0 입니다 — 회계 › 매출 목표에서 넣으십시오.';
  } else if (s.basis === 'CRM') {
    const [ex] = await db.query<{ ok: boolean }>(`SELECT to_regclass('public.sal_opps') IS NOT NULL AS ok`);
    if (!ex?.ok) salesNote = '영업 기회(CRM) 표가 이 판에 없어 예상 매출은 0 입니다.';
    else {
      const opps = await db.query<{ ym: string; stage: string; amt: string }>(
        `SELECT to_char(greatest(expected_close_on, $1::date), 'YYYY-MM') AS ym, stage, sum(expected_amount)::text AS amt
           FROM sal_opps WHERE stage IN ('LEAD', 'QUOTE', 'CONTRACT') AND expected_close_on IS NOT NULL GROUP BY 1, 2`, [today]);
      const by = new Map<string, number>();
      for (const o of opps) by.set(o.ym, (by.get(o.ym) ?? 0) + Math.round(n(o.amt) * (CRM_WEIGHT[o.stage] ?? 0)));
      for (const [ym, amt] of by) {
        const inYm = ymAdd(ym, s.collect);
        if (amt > 0 && yms.includes(inYm)) items.push({ date: clamp(monthEnd(inYm)), dir: 'IN', kind: 'SALES_EST', amount: amt, label: `영업 기회 가중 ${ym} 마감분 · ${s.collect}달 뒤 들어옴`, estimate: true, source: 'SALES' });
      }
      salesNote = opps.length ? '' : '예상 마감일이 있는 열린 영업 기회가 없어 예상 매출은 0 입니다.';
    }
  }

  /* 달마다 */
  let bal = cf.start;
  const rows = yms.map((ym) => {
    const its = items.filter((x) => x.date.slice(0, 7) === ym).sort((a, b) => a.date.localeCompare(b.date));
    const sum = (dir: 'IN' | 'OUT') => its.filter((x) => x.dir === dir).reduce((a, x) => a + x.amount, 0);
    const byKind: Partial<Record<PlanKind, number>> = {};
    for (const it of its) byKind[it.kind] = (byKind[it.kind] ?? 0) + (it.dir === 'IN' ? it.amount : -it.amount);
    const inn = sum('IN'), out = sum('OUT');
    bal += inn - out;
    return { ym, in: inn, out, net: inn - out, endBalance: bal, short: cf.hasBase && bal < cf.floor, byKind, items: its, estimates: its.filter((x) => x.estimate).length };
  });
  const shortMonths = rows.filter((r) => r.short).map((r) => r.ym);
  const kindTotals = Object.fromEntries((Object.keys(PLAN_KIND_KO) as PlanKind[]).map((k) => [k, items.filter((x) => x.kind === k).reduce((a, x) => a + (x.dir === 'IN' ? x.amount : -x.amount), 0)]));
  return {
    today, months, from: `${ym0}-01`, end, start: cf.start, base: cf.base, hasBase: cf.hasBase, floor: cf.floor,
    rows, shortMonths, firstShort: rows.find((r) => r.short) ?? null, lowest: rows.reduce((a, r) => (r.endBalance < a.endBalance ? r : a), rows[0]!),
    kinds: PLAN_KIND_KO, kindTotals, settings: s, salesNote,
    note: (cf.hasBase ? '' : '시작 잔액이 없어 0 에서 셉니다(알림 없음) — 회계 › 자금 흐름에서 잔액을 넣으십시오. ')
      + '앞 90일은 자금 흐름(확정된 돈)과 같고, 그 뒤는 예정 · 계약 고정비 · 급여(추정) · 세금 기한 · 예상 매출로 셉니다. 「추정」 줄은 실제와 다를 수 있습니다. 예상 매출은 공급가만(부가세 빼고) 넣습니다.',
  };
}

/** 정기 작업 acct_cashplan(매일 09:35) — 모자라는 첫 달 하나 ACCT_CASHPLAN_SHORT · 달이 바뀌면 새로 · 넉넉해지면 · 끄면 풀림 */
export async function acctCashPlanJob(db: DatabaseService, today = kstToday()) {
  const p = await cashPlan(db, 12, today);
  const resolve = async (why: string, keepYm: string | null) => (await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $1
      WHERE alert_code = 'ACCT_CASHPLAN_SHORT' AND resolved_at IS NULL AND ($2::text IS NULL OR coalesce(detail->>'ym', '') <> $2::text) RETURNING id`, [why, keepYm])).length;
  if (!p.settings.alert) return { on: false, made: 0, resolved: await resolve('알림 끔', null), shortMonths: p.shortMonths };
  const f = p.firstShort;
  if (!f) return { on: true, made: 0, resolved: await resolve('모자라는 달 없음', null), shortMonths: p.shortMonths, hasBase: p.hasBase };
  const resolved = await resolve('모자라는 첫 달이 바뀜', f.ym);
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'ACCT_CASHPLAN_SHORT', $1, $2, $3::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_CASHPLAN_SHORT' AND resolved_at IS NULL AND detail->>'ym' = $4)
     ON CONFLICT DO NOTHING RETURNING id`,
    [f.endBalance < 0 ? 'CRITICAL' : 'WARN',
     `${f.ym} 달 말 예상 잔액 ${f.endBalance.toLocaleString('ko-KR')}원 — 기준 ${p.floor.toLocaleString('ko-KR')}원 밑입니다(회계 › 자금 계획 12개월 · 모자라는 달 ${p.shortMonths.length}개)`,
     JSON.stringify({ ym: f.ym, endBalance: f.endBalance, floor: p.floor, shortMonths: p.shortMonths, day: today }), f.ym]);
  return { on: true, made: r.length, resolved, shortMonths: p.shortMonths, firstShort: f.ym };
}
