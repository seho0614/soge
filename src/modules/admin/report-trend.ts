import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { addDays, kstToday } from './report-day';
import { mondayOf } from './report-period';

/* ---------------------------------------------------------------------
 * v10.429 (D254 · docs/566) 경영 대시보드 그래프 — 운영 화면 › 보고 › 추세
 *   12달(MONTH) 또는 13주(WEEK · 월요일 시작) 동안: 매출 · 비용 · 이익(전표 · 계정 종류 · 해 마감 전표 뺌 — ⑰ 일보와 같은 셈) ·
 *   기간 끝 현금(보통예금 CASH 잔액 · ⑬ 확정 기초 잔액 판 + 그 뒤 전표) · 가입 · 소개몰 결제 주문 수 · 결제 금액.
 *   기간마다 한 번에 묶어 셈(GROUP BY) — ⑰ 보고 기록이 없어도 그림. 그래프는 화면이 SVG 로 그림(라이브러리 없음).
 * ------------------------------------------------------------------- */

export type TrendUnit = 'MONTH' | 'WEEK';

function buckets(unit: TrendUnit, today = kstToday()) {
  const out: Array<{ key: string; from: string; to: string; label: string }> = [];
  if (unit === 'WEEK') {
    let mo = mondayOf(today);
    for (let i = 0; i < 13; i++) { out.unshift({ key: mo, from: mo, to: addDays(mo, 6), label: mo.slice(5) }); mo = addDays(mo, -7); }
  } else {
    let [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
    for (let i = 0; i < 12; i++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      out.unshift({ key: ym, from: `${ym}-01`, to: last, label: ym.slice(2) });
      m -= 1; if (m === 0) { m = 12; y -= 1; }
    }
  }
  return out;
}

/** GET /admin/work-reports/trend?unit=MONTH|WEEK */
export async function trend(db: DatabaseService, unitIn?: string) {
  const unit: TrendUnit = unitIn === 'WEEK' ? 'WEEK' : unitIn === 'MONTH' || !unitIn ? 'MONTH' : (() => { throw new PolicyViolation('REPORT_PERIOD', '단위는 MONTH 또는 WEEK 입니다.'); })();
  const bs = buckets(unit);
  const from = bs[0]!.from, to = bs[bs.length - 1]!.to;
  const money = await db.query<{ k: string; rev: string; exp: string }>(
    `SELECT CASE WHEN $3 = 'WEEK' THEN to_char(date_trunc('week', e.entry_date)::date, 'YYYY-MM-DD') ELSE to_char(e.entry_date, 'YYYY-MM') END AS k,
            coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0)::text AS rev,
            coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0)::text AS exp
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date BETWEEN $1::date AND $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')
      GROUP BY 1`, [from, to, unit]).catch(() => [] as Array<{ k: string; rev: string; exp: string }>);
  /* 현금 — 기간 끝마다 누적(가장 늦은 확정 기초 잔액 판의 CASH + 그 기준일 뒤 CASH 줄) */
  const cash = await db.query<{ k: string; bal: string }>(
    `WITH base AS (SELECT s.id, s.as_of FROM acct_opening_sets s WHERE s.state = 'FIXED' AND s.as_of <= $1::date ORDER BY s.as_of DESC LIMIT 1),
          op AS (SELECT coalesce(sum(o.debit - o.credit), 0) AS v FROM acct_opening o WHERE o.set_id = (SELECT id FROM base) AND o.role = 'CASH'),
          ends AS (SELECT unnest($2::date[]) AS d)
     SELECT CASE WHEN $3 = 'WEEK' THEN to_char(date_trunc('week', ends.d)::date, 'YYYY-MM-DD') ELSE to_char(ends.d, 'YYYY-MM') END AS k,
            ((SELECT v FROM op) + coalesce((SELECT sum(l.debit - l.credit) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
                                            WHERE l.role = 'CASH' AND e.entry_date <= ends.d
                                              AND e.entry_date >= coalesce((SELECT as_of FROM base), '0001-01-01'::date)), 0))::text AS bal
       FROM ends`, [to, bs.map((b) => b.to), unit])   // 쓰는 값만(안 쓰는 $ 가 있으면 PostgreSQL 이 형을 못 정해 오류).catch(() => [] as Array<{ k: string; bal: string }>);
  /* 가입 · 소개몰 결제 — 기간마다 한 번에 묶어 셈 */
  const signupRows = await db.query<{ k: string; n: number }>(
    `SELECT CASE WHEN $3 = 'WEEK' THEN to_char(date_trunc('week', (a.created_at AT TIME ZONE 'Asia/Seoul')::date)::date, 'YYYY-MM-DD') ELSE to_char((a.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM') END AS k, count(*)::int AS n
       FROM accounts a WHERE (a.created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date GROUP BY 1`, [from, to, unit]).catch(() => [] as Array<{ k: string; n: number }>);
  const orderRows = await db.query<{ k: string; n: number; paid: string }>(
    `SELECT CASE WHEN $3 = 'WEEK' THEN to_char(date_trunc('week', (o.created_at AT TIME ZONE 'Asia/Seoul')::date)::date, 'YYYY-MM-DD') ELSE to_char((o.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM') END AS k, count(*)::int AS n, coalesce(sum(o.total), 0)::text AS paid
       FROM hlt_orders o WHERE o.status IN ('PAID', 'PREPARING', 'SHIPPED', 'DELIVERED') AND (o.created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date
      GROUP BY 1`, [from, to, unit]).catch(() => [] as Array<{ k: string; n: number; paid: string }>);
  const sumBy = <T extends { k: string }>(rows: T[], k: string, f: (r: T) => number) => rows.filter((r) => r.k === k).reduce((a, r) => a + f(r), 0);
  const points = bs.map((b) => {
    const revenue = sumBy(money, b.key, (r) => Number(r.rev)), expense = sumBy(money, b.key, (r) => Number(r.exp));
    return {
      key: b.key, label: b.label, from: b.from, to: b.to,
      revenue, expense, profit: revenue - expense,
      cash: Number(cash.find((c) => c.k === b.key)?.bal ?? 0),
      signups: sumBy(signupRows, b.key, (r) => Number(r.n)), orders: sumBy(orderRows, b.key, (r) => Number(r.n)), mallPaid: sumBy(orderRows, b.key, (r) => Number(r.paid)),
    };
  });
  const last = points[points.length - 1]!, prev = points[points.length - 2];
  const pct = (a: number, b?: number) => (b == null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
  return { unit, from, to, points,
           change: prev ? { revenue: pct(last.revenue, prev.revenue), profit: pct(last.profit, prev.profit), signups: pct(last.signups, prev.signups), orders: pct(last.orders, prev.orders) } : null,
           note: '매출 · 비용 · 이익은 전표 기준(공급가 · 해 마감 전표 뺌) · 현금은 기간 끝 보통예금 잔액(확정 기초 잔액 판 + 그 뒤 전표)입니다. 이번 기간은 오늘까지입니다.' };
}
