import { DatabaseService } from '../../db/database.service';
import { bankMonth } from './bank';
import { taxInvoices } from './acct-reports';
import { agingLine } from './aging';   // v10.401 (D247)
import { corpDeadlines } from './corptax';   // v10.418 (D251) 법인세 기한을 신고 기한에

/* ---------------------------------------------------------------------
 * v10.390 (D244 · docs/527) 월 결산 요약 · 신고 기한 알림
 *   요약 — 그 달 전표 · 매출 · 비용 · 부가세 · 원천세 · 현금 · 마감 · 통장 맞춤 · 세금계산서 발행 남은 것 · 할 일 줄
 *   기한 — 원천세 매월 10일 · 부가세 acct.vat_months 의 25일(주말 · 공휴일이면 다음 영업일 · public_holidays)
 *          N일(acct.deadline_days_before) 전부터 기한 날까지 운영 알림 ACCT_DEADLINE(같은 기한은 한 번 · 지나면 풀림)
 *   마감 — acct.close_by_day 뒤에도 지난달을 마감하지 않았으면 ACCT_UNCLOSED(그 달 한 번 · 마감하면 풀림) · 전표 시작 달 전은 빼고
 *   기한 날짜는 세법 기본 — 세무사 확인(연장 · 특례가 있으면 설정으로 달을 바꿈).
 * ------------------------------------------------------------------- */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const nextYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

async function settings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('acct.deadline_alert','acct.deadline_days_before','acct.vat_months','acct.close_by_day','acct.start_on',
                                                       'acct.pay_day','acct.card_pay_day','acct.deadline_payday')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const months = (v('acct.vat_months') ?? '1,4,7,10').split(',').map(Number).filter((x) => x >= 1 && x <= 12);
  return { on: (v('acct.deadline_alert') ?? 'on') === 'on', before: Math.min(7, Math.max(1, Number(v('acct.deadline_days_before') ?? 3) || 3)),
           vatMonths: months.length ? months : [1, 4, 7, 10], closeBy: Math.min(28, Math.max(1, Number(v('acct.close_by_day') ?? 10) || 10)),
           startYm: (v('acct.start_on') ?? '2026-11-01').slice(0, 7),
           /* v10.418 (D251) — 급여 지급일(⑭) · 법인카드 대금일(⑫) · 그 둘의 알림(처음 꺼짐 · acct.deadline_payday) */
           payDay: Math.min(28, Math.max(1, Number(v('acct.pay_day') ?? 25) || 25)), cardDay: Math.min(28, Math.max(1, Number(v('acct.card_pay_day') ?? 15) || 15)),
           payAlert: (v('acct.deadline_payday') ?? 'off') === 'on' };
}

/** 주말 · 공휴일이면 다음 영업일(DB 함수 fn_is_business_day · 공휴일 표) */
async function bizDay(db: DatabaseService, d: string) {
  const [r] = await db.query<{ d: string }>(
    `WITH RECURSIVE x(d, n) AS (SELECT $1::date, 0 UNION ALL SELECT d + 1, n + 1 FROM x WHERE NOT fn_is_business_day(d) AND n < 30)
     SELECT d::text AS d FROM x ORDER BY n DESC LIMIT 1`, [d]);
  return r?.d ?? d;
}

export interface Deadline { key: string; kind: 'WHT' | 'VAT' | 'CORP' | 'PAY' | 'CARD'; label: string; due: string; base: string; daysLeft: number }   // v10.418 CORP · PAY · CARD

/** 오늘(한국) 기준 이번 달 · 다음 달 기한 — 지나지 않은 것만 */
export async function deadlines(db: DatabaseService, today = kstToday()) {
  const s = await settings(db);
  const ym = today.slice(0, 7);
  const out: Deadline[] = [];
  for (const m of [ym, nextYm(ym)]) {
    const mon = Number(m.slice(5, 7));
    const dd = (n: number) => String(n).padStart(2, '0');
    const cands: Array<{ kind: Deadline['kind']; base: string; label: string }> = [
      { kind: 'WHT', base: `${m}-10`, label: `원천세 신고 · 납부(${prevYm(m)} 지급분)` },
      /* v10.418 (D251) — 급여 지급일 · 법인카드 대금일(목록엔 늘 · 알림은 acct.deadline_payday 가 on 일 때만) */
      { kind: 'PAY', base: `${m}-${dd(s.payDay)}`, label: `급여 지급(${m} · 매달 ${s.payDay}일)` },
      { kind: 'CARD', base: `${m}-${dd(s.cardDay)}`, label: `법인카드 대금(${prevYm(m)} 사용분 · 매달 ${s.cardDay}일)` },
      ...(s.vatMonths.includes(mon) ? [{ kind: 'VAT' as const, base: `${m}-25`, label: `부가세 신고 · 납부(${m.slice(0, 4)}년 ${mon === 1 ? '지난해 2기 확정' : mon === 4 ? '1기 예정' : mon === 7 ? '1기 확정' : mon === 10 ? '2기 예정' : `${mon}월`})` }] : []),
    ];
    for (const c of cands) {
      const due = await bizDay(db, c.base);
      if (due < today) continue;
      out.push({ key: `${c.kind}:${c.base}`, kind: c.kind, label: c.label, due, base: c.base, daysLeft: Math.round((Date.parse(due) - Date.parse(today)) / 86400e3) });
    }
  }
  /* v10.418 (D251) — ⑮ 법인세 중간예납 · 확정 신고 기한(가까운 둘) */
  for (const c of await corpDeadlines(db, today).catch(() => [])) {
    if (!out.some((o) => o.key === c.key)) out.push({ key: c.key, kind: 'CORP', label: c.label, due: c.due, base: c.base, daysLeft: c.daysLeft });
  }
  return { list: out.sort((a, b) => a.due.localeCompare(b.due)), settings: s, today };
}

/** 정기 작업 acct_deadline — 알림 넣기 · 풀기 */
export async function acctDeadlineJob(db: DatabaseService, today = kstToday()) {
  const { list, settings: s } = await deadlines(db, today);
  const made: string[] = []; let resolved = 0;
  /* 지난 기한 · 마감한 달 알림은 풀어 둠 */
  const r1 = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '기한 지남'
      WHERE alert_code = 'ACCT_DEADLINE' AND resolved_at IS NULL AND coalesce(detail->>'due', '9999') < $1 RETURNING id`, [today]);
  const r2 = await db.query(
    `UPDATE ops_alerts a SET resolved_at = now(), resolve_note = '마감함'
      WHERE a.alert_code = 'ACCT_UNCLOSED' AND a.resolved_at IS NULL AND EXISTS (SELECT 1 FROM acct_closings c WHERE c.ym = a.detail->>'ym') RETURNING id`);
  resolved = r1.length + r2.length;
  if (!s.on) return { on: false, made, resolved, upcoming: list };

  const soon = list.filter((d) => d.daysLeft <= s.before && ((d.kind !== 'PAY' && d.kind !== 'CARD') || s.payAlert));   // v10.418 급여 · 카드 알림은 켰을 때만
  for (const d of soon) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_DEADLINE', $1, $2, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_DEADLINE' AND detail->>'key' = $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [d.daysLeft <= 1 ? 'CRITICAL' : 'WARN', `${d.label} 기한 ${d.due}${d.daysLeft === 0 ? '(오늘)' : ` · ${d.daysLeft}일 남음`} — 회계 › 월 결산 · 신고 자료`,
       JSON.stringify({ key: d.key, due: d.due, kind: d.kind }), d.key]);
    if (r.length) made.push(d.key);
  }

  /* 지난달 마감 */
  const ym = today.slice(0, 7), pm = prevYm(ym);
  if (Number(today.slice(8, 10)) > s.closeBy && pm >= s.startYm) {
    const [c] = await db.query(`SELECT 1 FROM acct_closings WHERE ym = $1`, [pm]);
    if (!c) {
      const r = await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT 'ACCT_UNCLOSED', 'WARN', $1, $2::jsonb, clock_timestamp()
          WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_UNCLOSED' AND detail->>'ym' = $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [`${pm} 회계 마감을 아직 하지 않았습니다(매달 ${s.closeBy}일까지) — 회계 › 월 결산`, JSON.stringify({ ym: pm }), pm]);
      if (r.length) made.push(`UNCLOSED:${pm}`);
    }
  }
  return { on: true, made, resolved, upcoming: list };
}

/** GET /admin/acct/month?ym= — 월 결산 요약 */
export async function monthSummary(db: DatabaseService, ym: string) {
  const roles = await db.query<{ role: string; name: string; kind: string; d: string; c: string }>(
    `SELECT l.role, a.name, a.kind, sum(l.debit)::text AS d, sum(l.credit)::text AS c
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role
      WHERE e.ym = $1 AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')   -- v10.402 해 마감 전표는 손익에서 뺌
      GROUP BY l.role, a.name, a.kind, a.sort ORDER BY a.sort`, [ym]);
  const sum = (f: (r: typeof roles[number]) => boolean, g: (d: number, c: number) => number) => roles.filter(f).reduce((a, r) => a + g(Number(r.d), Number(r.c)), 0);
  const revenue = sum((r) => r.kind === 'REVENUE', (d, c) => c - d), expense = sum((r) => r.kind === 'EXPENSE', (d, c) => d - c);
  const vatOut = sum((r) => r.role === 'VAT_OUT', (d, c) => c - d), wht = sum((r) => r.role === 'WHT', (d, c) => c - d);
  const cashIn = sum((r) => r.role === 'CASH' || r.role === 'PG_RECV', (d) => d), cashOut = sum((r) => r.role === 'CASH' || r.role === 'PG_RECV', (_d, c) => c);
  const [t] = await db.query<{ n: number; late: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE late)::int AS late FROM acct_entries WHERE ym = $1`, [ym]);
  const [cl] = await db.query(`SELECT ym, entries, debit_sum::text AS "debitSum", note, closed_at AS "closedAt" FROM acct_closings WHERE ym = $1`, [ym]);
  const bank = await bankMonth(db, ym);
  const inv = await taxInvoices(db, ym);
  const dl = await deadlines(db);
  const [fail] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'ACCT_JOURNAL_FAIL' AND resolved_at IS NULL`);
  const now = kstToday().slice(0, 7);
  const checks = [
    { key: 'journal', label: '자동 전표 실패 없음', ok: Number(fail?.n ?? 0) === 0, detail: Number(fail?.n ?? 0) ? '운영 알림 ACCT_JOURNAL_FAIL 이 있습니다' : '', where: '회계 › 전표' },
    { key: 'bank', label: '통장 줄 모두 맞춤', ok: bank.count.total > 0 && bank.count.open === 0, detail: bank.count.total ? `남은 줄 ${bank.count.open} · 장부에만 있음 ${bank.count.bookOnly}` : '이 달 통장 거래 내역을 아직 올리지 않았습니다', where: '회계 › 은행 맞추기' },
    { key: 'invoices', label: '세금계산서 발행 끝', ok: inv.todo === 0, detail: inv.todo ? `발행 남음 ${inv.todo}건` : '', where: '회계 › 신고 자료 › 세금계산서' },
    { key: 'close', label: '월 마감', ok: !!cl, detail: cl ? '' : ym >= now ? '달이 끝난 뒤 마감합니다' : '아직 마감하지 않았습니다', where: '회계 › 전표 › 월 마감' },
  ];
  return {
    ym, closing: cl ?? null, entries: Number(t?.n ?? 0), late: Number(t?.late ?? 0),
    money: { revenue, expense, profit: revenue - expense, vatOut, wht, cashIn, cashOut },
    byRole: roles.map((r) => ({ role: r.role, name: r.name, kind: r.kind, debit: Number(r.d), credit: Number(r.c) })),
    bank: bank.count, lastBalance: bank.lastBalance, invoicesTodo: inv.todo,
    deadlines: dl.list.slice(0, 6), checks, aging: await agingLine(db).catch(() => null),   // v10.401 (D247) 기간 분석 한 줄(마감 조건 아님 · checks 밖) ready: checks.filter((c) => c.key !== 'close').every((c) => c.ok),
    note: '마감 전에 할 일 — 전표 실패 없음 · 통장 맞춤 · 세금계산서 발행. 신고 기한은 세법 기본 날짜(주말 · 공휴일이면 다음 영업일)이며 세무사 확인이 필요합니다.',
  };
}
