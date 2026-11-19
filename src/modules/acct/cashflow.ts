import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.394 (D245 · docs/531) 자금 흐름 90일
 *   시작 잔액 — 직접 넣은 잔액(acct_cash_balances · SUPER · 쌓기만) 과 ⑪ 통장 CSV 마지막 잔액 중 더 최근 것
 *              + 그날 뒤 오늘까지 장부 보통예금(CASH) 줄의 들고 남
 *   들어올 돈(확정된 것만 · 반복 매출 추정 없음)
 *     ① 광고 청구 받을 돈(ad_invoices ISSUED · PARTIAL · OVERDUE · 남은 금액 · 납기일 · 지났으면 오늘 · 「납기 지남」)
 *     ② PG 정산 받을 돈(전표 PG_RECV 줄 · 결제일 + acct.pg_settle_days 영업일 · 시작 잔액 날 뒤에 들어올 것만)
 *     ③ 직접 적은 예정(acct_cash_plans IN)
 *   나갈 돈
 *     ④ 미지급금 AP · 법인카드 CARD_AP — 전표 잔액(대변 − 차변)을 최근 줄부터 남은 것으로 보고 ·
 *        AP 는 전표 날 + acct.ap_pay_days · 카드는 다음 달 acct.card_pay_day(영업일 아니면 다음 영업일)
 *     ⑤ 부가세(acct.vat_months 25일 · 그 기간 VAT_OUT − VAT_IN) · 원천세(매월 10일 · 지난달 WHT) — 주말 · 공휴일이면 다음 영업일
 *     ⑥ 포인트 출금 신청 · 확정(아직 지급 전 · 실지급액) — 오늘
 *     ⑦ 입점 판매자 정산 확정 · 미지급(net_amount · 확정일 + acct.seller_pay_days) — 판매자 돈이지만 통장에서 나감
 *     ⑧ 직접 적은 예정(acct_cash_plans OUT · 한 번 또는 매달)
 *   입점 수수료는 정산 때 판매 대금에서 빼고 주므로 따로 들어오는 돈이 아닙니다(⑦ 이 이미 뺀 금액).
 *   가장 낮은 날 잔액이 acct.cash_floor 밑이면 정기 작업 acct_cashflow(매일 09:20)가 운영 알림 ACCT_CASH_SHORT(하루 한 번 · 다시 넉넉해지면 풀림).
 * ------------------------------------------------------------------- */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => {
  const yy = y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, lastDay(yy, mm))).padStart(2, '0')}`;
};
const n = (v: unknown) => Number(v ?? 0);

export type CashKind = 'AR_AD' | 'PG' | 'PLAN_IN' | 'AP' | 'CARD' | 'VAT' | 'WHT' | 'CASHOUT' | 'SELLER' | 'PLAN_OUT';
export interface CashItem { date: string; dir: 'IN' | 'OUT'; kind: CashKind; amount: number; label: string; overdue?: boolean; partial?: boolean; ref?: string }

const KIND_KO: Record<CashKind, string> = {
  AR_AD: '광고 청구 받을 돈', PG: 'PG 정산', PLAN_IN: '예정(들어옴)', AP: '미지급금', CARD: '법인카드 대금',
  VAT: '부가세 납부', WHT: '원천세 납부', CASHOUT: '포인트 출금', SELLER: '입점 판매자 정산', PLAN_OUT: '예정(나감)',
};

async function settings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('acct.pg_settle_days','acct.card_pay_day','acct.ap_pay_days','acct.seller_pay_days','acct.cash_floor','acct.cash_alert','acct.vat_months')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const num = (k: string, d: number, lo: number, hi: number) => { const x = Number(v(k) ?? d); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.trunc(x))) : d; };
  const months = (v('acct.vat_months') ?? '1,4,7,10').split(',').map(Number).filter((x) => x >= 1 && x <= 12);
  return {
    pgDays: num('acct.pg_settle_days', 2, 0, 14), cardDay: num('acct.card_pay_day', 15, 1, 28), apDays: num('acct.ap_pay_days', 30, 0, 120),
    sellerDays: num('acct.seller_pay_days', 3, 0, 30), floor: num('acct.cash_floor', 0, 0, 1e12), alert: (v('acct.cash_alert') ?? 'on') === 'on',
    vatMonths: (months.length ? months : [1, 4, 7, 10]).sort((a, b) => a - b),
  };
}

/** 공휴일 표를 한 번 읽어 영업일 셈(토 · 일 · public_holidays) */
async function bizCal(db: DatabaseService, from: string, to: string) {
  const hs = await db.query<{ d: string }>(`SELECT day::text AS d FROM public_holidays WHERE day BETWEEN $1::date AND $2::date`, [addDays(from, -40), addDays(to, 40)]);
  const set = new Set(hs.map((h) => h.d));
  const isBiz = (d: string) => { const w = new Date(Date.parse(d)).getUTCDay(); return w !== 0 && w !== 6 && !set.has(d); };
  const nextBiz = (d: string) => { let x = d; for (let i = 0; i < 30 && !isBiz(x); i++) x = addDays(x, 1); return x; };
  const plusBiz = (d: string, k: number) => { let x = d; for (let i = 0; i < k; i++) x = nextBiz(addDays(x, 1)); return k === 0 ? nextBiz(x) : x; };
  return { isBiz, nextBiz, plusBiz };
}

/** 시작 잔액 — 직접 넣은 것 · 통장 CSV 마지막 잔액 중 더 최근(같은 날이면 직접 넣은 것) */
export async function cashBase(db: DatabaseService) {
  const [m] = await db.query<any>(
    `SELECT id::text AS id, as_of::text AS date, amount::bigint AS amount, note, created_at AS "createdAt" FROM acct_cash_balances ORDER BY as_of DESC, id DESC LIMIT 1`);
  const [b] = await db.query<any>(
    `SELECT tx_date::text AS date, balance::bigint AS amount FROM acct_bank_txns WHERE balance IS NOT NULL ORDER BY tx_date DESC, id DESC LIMIT 1`);
  const manual = m ? { date: m.date as string, amount: n(m.amount), source: 'MANUAL' as const, note: m.note as string | null } : null;
  const bank = b ? { date: b.date as string, amount: n(b.amount), source: 'BANK' as const, note: '통장 거래 내역 마지막 잔액' } : null;
  const pick = manual && bank ? (bank.date > manual.date ? bank : manual) : manual ?? bank;
  return { pick, manual, bank };
}

/** 전표 잔액(대변 − 차변)을 최근 줄부터 남은 것으로 — 갚은 것은 오래된 줄부터라고 봄 */
async function openCredits(db: DatabaseService, role: string) {
  const [t] = await db.query<{ bal: string }>(
    `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS bal FROM acct_lines l WHERE l.role = $1`, [role]);
  let left = n(t?.bal);
  if (left <= 0) return [] as Array<{ date: string; amount: number; memo: string | null; party: string | null; entryId: string }>;
  const rows = await db.query<any>(
    `SELECT e.id::text AS "entryId", e.entry_date::text AS date, l.credit::bigint AS amount, e.memo, e.party
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE l.role = $1 AND l.credit > 0 ORDER BY e.entry_date DESC, e.id DESC LIMIT 2000`, [role]);
  const out: Array<{ date: string; amount: number; memo: string | null; party: string | null; entryId: string }> = [];
  for (const r of rows) {
    if (left <= 0) break;
    const a = Math.min(left, n(r.amount));
    out.push({ date: r.date, amount: a, memo: r.memo, party: r.party, entryId: r.entryId });
    left -= a;
  }
  return out;
}

/** 역할별 (대변 − 차변) 합 — 전표 날짜 [from, to] */
async function roleSum(db: DatabaseService, role: string, from: string, to: string, sign: 1 | -1 = 1) {
  const [r] = await db.query<{ s: string }>(
    `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS s FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE l.role = $1 AND e.entry_date BETWEEN $2::date AND $3::date`, [role, from, to]);
  return sign * n(r?.s);
}

/** GET /admin/acct/cashflow?days= — 날마다 잔액 · 가장 낮은 날 */
export async function cashflow(db: DatabaseService, daysIn = 90, today = kstToday()) {
  const days = Math.min(180, Math.max(7, Math.trunc(daysIn) || 90));
  const end = addDays(today, days - 1);
  const s = await settings(db);
  const cal = await bizCal(db, today, end);
  const { pick: base } = await cashBase(db);
  const items: CashItem[] = [];
  const clamp = (d: string) => (d < today ? today : d);

  /* 시작 잔액 뒤 오늘까지 장부 보통예금 줄 */
  let bookAfter = 0;
  if (base && base.date < today) {
    const [r] = await db.query<{ s: string }>(
      `SELECT coalesce(sum(l.debit - l.credit), 0)::text AS s FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
        WHERE l.role = 'CASH' AND e.entry_date > $1::date AND e.entry_date <= $2::date`, [base.date, today]);
    bookAfter = n(r?.s);
  }
  const start = (base?.amount ?? 0) + bookAfter;

  /* ① 광고 청구 받을 돈 */
  const ar = await db.query<any>(
    `SELECT i.id::text AS id, i.invoice_no AS no, i.due_date::text AS due, (i.total - coalesce(i.paid_amount, 0))::bigint AS left, a.name AS party
       FROM ad_invoices i LEFT JOIN advertisers a ON a.id = i.advertiser_id
      WHERE i.status IN ('ISSUED', 'PARTIAL', 'OVERDUE') AND i.total - coalesce(i.paid_amount, 0) > 0 AND i.due_date <= $1::date
      ORDER BY i.due_date LIMIT 1000`, [end]);
  for (const r of ar) items.push({ date: clamp(r.due), dir: 'IN', kind: 'AR_AD', amount: n(r.left), label: `광고 청구 ${r.no ?? ''} ${r.party ?? ''}`.trim(), overdue: r.due < today, ref: r.id });

  /* ② PG 정산 받을 돈 — 결제일 + N 영업일이 시작 잔액 날 뒤인 것 */
  const since = base ? addDays(base.date, -40) : addDays(today, -40);
  const pg = await db.query<{ d: string; amt: string }>(
    `SELECT e.entry_date::text AS d, sum(l.debit - l.credit)::text AS amt FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE l.role = 'PG_RECV' AND e.entry_date >= $1::date GROUP BY e.entry_date ORDER BY e.entry_date`, [since]);
  const pgBy = new Map<string, number>();
  for (const r of pg) {
    const settle = cal.plusBiz(r.d, s.pgDays);
    if (base && settle <= base.date) continue;     // 이미 시작 잔액에 들어간 것
    if (!base && settle < today) continue;          // 시작 잔액이 없으면 지난 정산은 모름
    const d = clamp(settle);
    if (d > end) continue;
    pgBy.set(d, (pgBy.get(d) ?? 0) + n(r.amt));
  }
  for (const [d, a] of pgBy) if (a !== 0) items.push({ date: d, dir: a > 0 ? 'IN' : 'OUT', kind: 'PG', amount: Math.abs(a), label: a > 0 ? 'PG 정산 입금 예정' : 'PG 환불 차감 예정' });

  /* ④ 미지급금 · 법인카드 */
  for (const r of await openCredits(db, 'AP')) {
    const d = clamp(addDays(r.date, s.apDays));
    if (d <= end) items.push({ date: d, dir: 'OUT', kind: 'AP', amount: r.amount, label: `미지급금 ${r.party ?? r.memo ?? ''}`.trim(), overdue: addDays(r.date, s.apDays) < today, ref: r.entryId });
  }
  const card = new Map<string, number>();
  for (const r of await openCredits(db, 'CARD_AP')) {
    const [y, m] = r.date.split('-').map(Number);
    const due = cal.nextBiz(ymd(y!, m! + 1, s.cardDay));
    const d = clamp(due);
    if (d <= end) card.set(d, (card.get(d) ?? 0) + r.amount);
  }
  for (const [d, a] of card) items.push({ date: d, dir: 'OUT', kind: 'CARD', amount: a, label: `법인카드 결제일(매달 ${s.cardDay}일)` });

  /* ⑤ 부가세 · 원천세 */
  const [ty, tm] = today.split('-').map(Number);
  for (let k = 0; k <= Math.ceil(days / 28) + 1; k++) {
    const m = tm! + k;
    const base10 = ymd(ty!, m, 10), base25 = ymd(ty!, m, 25);
    const due10 = cal.nextBiz(base10);
    if (due10 >= today && due10 <= end) {
      const pf = ymd(ty!, m - 1, 1), pt = ymd(ty!, m - 1, 31);
      const amt = await roleSum(db, 'WHT', pf, pt);
      if (amt > 0) items.push({ date: due10, dir: 'OUT', kind: 'WHT', amount: amt, label: `원천세(${pf.slice(0, 7)} 지급분)`, partial: pt >= today });
    }
    const mon = Number(base25.slice(5, 7));
    const due25 = cal.nextBiz(base25);
    if (s.vatMonths.includes(mon) && due25 >= today && due25 <= end) {
      const idx = s.vatMonths.indexOf(mon);
      const prev = idx > 0 ? s.vatMonths[idx - 1]! : s.vatMonths[s.vatMonths.length - 1]! - 12;
      const span = mon - prev;                       // 1 · 4 · 7 · 10 이면 3달
      const pf = ymd(ty!, m - span, 1), pt = ymd(ty!, m - 1, 31);
      const amt = (await roleSum(db, 'VAT_OUT', pf, pt)) - (await roleSum(db, 'VAT_IN', pf, pt, -1));
      if (amt > 0) items.push({ date: due25, dir: 'OUT', kind: 'VAT', amount: amt, label: `부가세(${pf.slice(0, 7)} ~ ${pt.slice(0, 7)})`, partial: pt >= today });
    }
  }

  /* ⑥ 포인트 출금 — 신청 · 확정(지급 전) */
  const co = await db.query<{ st: string; n: number; amt: string }>(
    `SELECT status AS st, count(*)::int AS n, coalesce(sum(net_amount), 0)::text AS amt FROM point_cashouts WHERE status IN ('REQUESTED', 'CONFIRMED') GROUP BY status`);
  for (const r of co) if (n(r.amt) > 0) items.push({ date: today, dir: 'OUT', kind: 'CASHOUT', amount: n(r.amt), label: `포인트 출금 ${r.st === 'CONFIRMED' ? '확정' : '신청'} ${r.n}건(실지급액)`, partial: r.st === 'REQUESTED' });

  /* ⑦ 입점 판매자 정산 — 확정 · 미지급 */
  const st = await db.query<any>(
    `SELECT st.id::text AS id, (st.confirmed_at AT TIME ZONE 'Asia/Seoul')::date::text AS d, st.net_amount::bigint AS amt, s.name AS party
       FROM hlt_settlements st JOIN hlt_sellers s ON s.id = st.seller_id
      WHERE st.status = 'CONFIRMED' AND st.paid_at IS NULL AND st.net_amount > 0 AND st.confirmed_at IS NOT NULL LIMIT 1000`);
  for (const r of st) {
    const due = cal.nextBiz(addDays(r.d, s.sellerDays));
    const d = clamp(due);
    if (d <= end) items.push({ date: d, dir: 'OUT', kind: 'SELLER', amount: n(r.amt), label: `입점 정산 ${r.party ?? ''}`.trim(), overdue: due < today, ref: r.id });
  }

  /* ③ ⑧ 직접 적은 예정 */
  const plans = await db.query<any>(
    `SELECT id::text AS id, due_on::text AS due, direction AS dir, amount::bigint AS amount, memo, repeat, until_on::text AS until
       FROM acct_cash_plans WHERE state = 'ACTIVE' AND due_on <= $1::date AND (repeat = 'MONTHLY' OR due_on >= $2::date)`, [end, today]);
  for (const p of plans) {
    const push = (d: string) => items.push({ date: d, dir: p.dir, kind: p.dir === 'IN' ? 'PLAN_IN' : 'PLAN_OUT', amount: n(p.amount), label: `${p.memo}${p.repeat === 'MONTHLY' ? '(매달)' : ''}`, ref: p.id });
    if (p.repeat !== 'MONTHLY') { push(p.due); continue; }
    const [py, pm, pd] = p.due.split('-').map(Number);
    for (let k = 0; k < 240; k++) {
      const d = ymd(py!, pm! + k, pd!);
      if (d > end || (p.until && d > p.until)) break;
      if (d >= today) push(d);
    }
  }

  /* 날마다 잔액 */
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.dir === b.dir ? 0 : a.dir === 'IN' ? -1 : 1));
  const by = new Map<string, CashItem[]>();
  for (const it of items) { const a = by.get(it.date) ?? []; a.push(it); by.set(it.date, a); }
  let bal = start;
  const rows: Array<{ date: string; in: number; out: number; balance: number; biz: boolean; items: CashItem[] }> = [];
  let low = { date: today, balance: start };
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const its = by.get(d) ?? [];
    const inn = its.filter((x) => x.dir === 'IN').reduce((a, x) => a + x.amount, 0), out = its.filter((x) => x.dir === 'OUT').reduce((a, x) => a + x.amount, 0);
    bal += inn - out;
    if (bal < low.balance) low = { date: d, balance: bal };
    rows.push({ date: d, in: inn, out, balance: bal, biz: cal.isBiz(d), items: its });
  }
  const totals = Object.fromEntries((Object.keys(KIND_KO) as CashKind[]).map((k) => [k, items.filter((x) => x.kind === k).reduce((a, x) => a + x.amount, 0)]));
  return {
    today, days, end, base, bookAfter, start, floor: s.floor, hasBase: !!base,
    lowest: low, short: !!base && low.balance < s.floor,
    in: items.filter((x) => x.dir === 'IN').reduce((a, x) => a + x.amount, 0), out: items.filter((x) => x.dir === 'OUT').reduce((a, x) => a + x.amount, 0),
    totals, kinds: KIND_KO, rows, overdue: items.filter((x) => x.overdue).length,
    settings: s,
    note: base
      ? '시작 잔액(직접 넣은 것 · 통장 CSV 중 최근) + 그 뒤 장부 보통예금 줄입니다. 확정된 돈만 셉니다(앞으로 들어올 매출 추정 없음). 납기가 지난 것은 오늘 칸에 둡니다.'
      : '시작 잔액이 없습니다 — 「잔액 넣기」 또는 회계 › 은행 맞추기에서 잔액 칸이 있는 통장 CSV 를 올리십시오. 그때까지 잔액은 0 에서 셉니다(알림 없음).',
  };
}

/** POST /admin/acct/cashflow/balance — 잔액 직접 넣기(SUPER · 쌓기만) */
export async function addCashBalance(db: DatabaseService, b: { asOf: string; amount: number; note?: string }, actor: string | null, today = kstToday()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.asOf ?? '') || Number.isNaN(Date.parse(b.asOf))) throw new PolicyViolation('CASH_BALANCE', '잔액 날짜가 바르지 않습니다.');
  if (b.asOf > today || b.asOf < addDays(today, -366)) throw new PolicyViolation('CASH_BALANCE', '잔액 날짜는 오늘부터 1년 전까지입니다.');
  const amt = Number(b.amount);
  if (!Number.isInteger(amt) || Math.abs(amt) > 1e12) throw new PolicyViolation('CASH_BALANCE', '잔액은 원 단위 정수입니다.');
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_cash_balances (as_of, amount, source, note, created_by) VALUES ($1::date, $2, 'MANUAL', $3, $4) RETURNING id::text AS id`,
    [b.asOf, amt, note, actor]);
  return { ok: true, id: r!.id, note: '잔액을 넣었습니다 — 통장 CSV 잔액이 더 최근이면 그것을 씁니다.' };
}

export async function listCashPlans(db: DatabaseService) {
  const items = await db.query(
    `SELECT id::text AS id, due_on::text AS "dueOn", direction, amount::bigint AS amount, memo, repeat, until_on::text AS "untilOn", state,
            cancel_note AS "cancelNote", created_at AS "createdAt", canceled_at AS "canceledAt"
       FROM acct_cash_plans ORDER BY (state = 'ACTIVE') DESC, due_on, id LIMIT 300`);
  const balances = await db.query(
    `SELECT id::text AS id, as_of::text AS "asOf", amount::bigint AS amount, source, note, created_at AS "createdAt" FROM acct_cash_balances ORDER BY as_of DESC, id DESC LIMIT 20`);
  return { items, balances };
}

/** POST /admin/acct/cashflow/plans — 예정 들고 남(한 번 · 매달) */
export async function addCashPlan(db: DatabaseService, b: { dueOn: string; direction: string; amount: number; memo: string; repeat?: string; untilOn?: string }, actor: string | null, today = kstToday()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dueOn ?? '') || Number.isNaN(Date.parse(b.dueOn))) throw new PolicyViolation('CASH_PLAN', '날짜가 바르지 않습니다.');
  const repeat = b.repeat === 'MONTHLY' ? 'MONTHLY' : 'NONE';
  if (repeat === 'NONE' && b.dueOn < today) throw new PolicyViolation('CASH_PLAN', '지난 날짜에는 예정을 넣지 않습니다.');
  if (b.dueOn > addDays(today, 366)) throw new PolicyViolation('CASH_PLAN', '예정은 1년 안 날짜만 넣습니다.');
  const amt = Number(b.amount);
  if (!Number.isInteger(amt) || amt <= 0 || amt > 1e12) throw new PolicyViolation('CASH_PLAN', '금액은 1원 이상 정수입니다.');
  const memo = (b.memo ?? '').replace(/\s+/g, ' ').trim();
  if (memo.length < 2 || memo.length > 100) throw new PolicyViolation('CASH_PLAN', '메모는 2 ~ 100자입니다.');
  const until = repeat === 'MONTHLY' && b.untilOn ? b.untilOn : null;
  if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < b.dueOn)) throw new PolicyViolation('CASH_PLAN', '반복 끝 날짜가 바르지 않습니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_cash_plans (due_on, direction, amount, memo, repeat, until_on, created_by) VALUES ($1::date, $2, $3, $4, $5, $6::date, $7) RETURNING id::text AS id`,
    [b.dueOn, b.direction === 'IN' ? 'IN' : 'OUT', amt, memo, repeat, until, actor]);
  return { ok: true, id: r!.id, note: repeat === 'MONTHLY' ? '매달 예정을 넣었습니다.' : '예정을 넣었습니다.' };
}

export async function cancelCashPlan(db: DatabaseService, id: string, reason: string, actor: string | null) {
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('CASH_PLAN', '사유는 2 ~ 200자입니다.');
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 예정입니다.');
  const r = await db.query(
    `UPDATE acct_cash_plans SET state = 'CANCELED', cancel_note = $2, canceled_at = now(), canceled_by = $3 WHERE id = $1::bigint AND state = 'ACTIVE' RETURNING id`, [id, t, actor]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM acct_cash_plans WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 예정입니다.');
    throw new PolicyViolation('CASH_PLAN', '이미 취소한 예정입니다.');
  }
  return { ok: true, note: '예정을 취소했습니다.' };
}

/** 정기 작업 acct_cashflow(매일 09:20) — 가장 낮은 날이 기준 밑이면 ACCT_CASH_SHORT(하루 한 번) · 넉넉해지면 풀림 */
export async function acctCashflowJob(db: DatabaseService, today = kstToday()) {
  const c = await cashflow(db, 90, today);
  const resolve = async (why: string) => (await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $1 WHERE alert_code = 'ACCT_CASH_SHORT' AND resolved_at IS NULL RETURNING id`, [why])).length;
  if (!c.settings.alert) return { on: false, made: 0, resolved: await resolve('알림 끔'), lowest: c.lowest, short: c.short };
  if (!c.short) return { on: true, made: 0, resolved: await resolve('잔액 넉넉함'), lowest: c.lowest, short: false, hasBase: c.hasBase };
  /* 오늘 이미 넣었으면 그대로 · 어제 것은 새 숫자로 바꿔 넣음 */
  const [todayOne] = await db.query(
    `SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_CASH_SHORT' AND resolved_at IS NULL AND (raised_at AT TIME ZONE 'Asia/Seoul')::date = $1::date`, [today]);
  if (todayOne) return { on: true, made: 0, resolved: 0, lowest: c.lowest, short: true };
  const resolved = await resolve('새 알림으로 바꿈');
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     VALUES ('ACCT_CASH_SHORT', $1, $2, $3::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING RETURNING id`,
    [c.lowest.balance < 0 ? 'CRITICAL' : 'WARN',
     `${c.lowest.date} 예상 잔액 ${c.lowest.balance.toLocaleString('ko-KR')}원 — 기준 ${c.floor.toLocaleString('ko-KR')}원 밑입니다(회계 › 자금 흐름)`,
     JSON.stringify({ day: today, lowest: c.lowest, floor: c.floor, start: c.start })]);
  return { on: true, made: r.length, resolved, lowest: c.lowest, short: true };
}
