import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { trialBalance } from './statements';

/* ---------------------------------------------------------------------
 * v10.402 (D247 · docs/539) 해 마감 · 다음 해 이월
 *   마감(SUPER): 그 해 수익 · 비용 계정을 0 으로 만드는 전표 YEAR_CLOSE(12-31) · 차액(순이익)은 이월이익잉여금(RETAINED · ⑬)
 *     조건 — 해가 끝남 · 그 해 달(전표 시작 달부터 12월까지) 모두 월 마감 · 지금 마감 상태가 아님
 *   마감한 해는 전표를 넣지 못함(DB fn_acct_entries_closed · ACCT_YEAR_CLOSED)
 *   풀기(SUPER · 사유): 마감 전표의 반대 전표 YEAR_REOPEN · 다시 마감하면 새 YEAR_CLOSE
 *     ※ 월 마감은 그대로라 풀어도 그 해 날짜로 전표를 더 넣을 수는 없음(늦게 온 것은 오늘 날짜 · late) — 고칠 것은 세무사와 다음 해 전표로.
 *   다음 해 기초 잔액: 마감 뒤 ⑬ trialBalance 로 자산 · 부채 · 자본 잔액을 ⑬ acct_opening_sets(DRAFT) · acct_opening 에 「초안」 — 확정은 ⑬ 재무제표 화면.
 * ------------------------------------------------------------------- */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);

interface ELine { role: string; debit: number; credit: number }

async function lastAction(db: DatabaseService, year: number) {
  const [r] = await db.query<{ action: string; entry_id: string | null }>(
    `SELECT action, entry_id::text AS entry_id FROM acct_year_closings WHERE year = $1 ORDER BY id DESC LIMIT 1`, [year]);
  return r ?? null;
}

/** 해마다 상태 — 전표 시작 해부터 올해까지 */
export async function yearClosings(db: DatabaseService) {
  const [st] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.start_on'`);
  const startYm = (st?.v ?? '2026-11-01').slice(0, 7), y0 = Number(startYm.slice(0, 4)), yNow = Number(kstToday().slice(0, 4));
  const out = [];
  for (let y = y0; y <= yNow; y++) {
    const months = monthsOf(y, startYm);
    const closed = await db.query<{ ym: string }>(`SELECT ym FROM acct_closings WHERE ym = ANY($1::text[])`, [months]);
    const hist = await db.query(
      `SELECT c.id::text AS id, c.action, c.net_income AS "netIncome", c.revenue, c.expense, c.entry_id::text AS "entryId",
              c.reason, c.created_at AS "createdAt", a.email AS actor
         FROM acct_year_closings c LEFT JOIN accounts a ON a.id = c.actor_id WHERE c.year = $1 ORDER BY c.id DESC LIMIT 10`, [y]);
    const last = hist[0] as { action?: string } | undefined;
    const pl = await yearPl(db, y);
    out.push({ year: y, months: months.length, monthsClosed: closed.length, missing: months.filter((m) => !closed.some((c) => c.ym === m)),
      ended: kstToday() >= `${y + 1}-01-01`, closed: last?.action === 'CLOSE', revenue: pl.revenue, expense: pl.expense, netIncome: pl.revenue - pl.expense, history: hist });
  }
  return { years: out.reverse(), canEdit: false,
    note: '해 마감은 그 해 모든 달을 월 마감한 뒤 SUPER 가 합니다 — 수익 · 비용을 이월이익잉여금으로 넘기고, 다음 해 기초 잔액 초안을 만듭니다. 마감한 해에는 전표를 넣을 수 없습니다.' };
}

function monthsOf(y: number, startYm: string) {
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) { const ym = `${y}-${String(m).padStart(2, '0')}`; if (ym >= startYm) out.push(ym); }
  return out;
}

/** 그 해 수익 · 비용(마감 · 풀기 전표 빼고) */
async function yearPl(db: DatabaseService, y: number) {
  const [r] = await db.query<{ rev: string; exp: string }>(
    `SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0)::text AS rev,
            coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0)::text AS exp
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date >= $1::date AND e.entry_date < $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')`, [`${y}-01-01`, `${y + 1}-01-01`]);
  return { revenue: n(r?.rev), expense: n(r?.exp) };
}

/** 마감 전표 줄 — 수익 · 비용 계정마다 반대로 · 차액은 RETAINED */
async function closingLines(db: DatabaseService, y: number): Promise<ELine[]> {
  const rows = await db.query<{ role: string; kind: string; bal: string }>(
    `SELECT l.role, a.kind, sum(l.debit - l.credit)::text AS bal
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date >= $1::date AND e.entry_date < $2::date AND a.kind IN ('REVENUE', 'EXPENSE')
      GROUP BY l.role, a.kind HAVING sum(l.debit - l.credit) <> 0 ORDER BY a.kind DESC, l.role`, [`${y}-01-01`, `${y + 1}-01-01`]);
  const lines: ELine[] = [];
  let sum = 0;   // 차변 − 대변 합
  for (const r of rows) {
    const b = n(r.bal);   // 차변 잔액(+) · 대변 잔액(−)
    if (b > 0) { lines.push({ role: r.role, debit: 0, credit: b }); sum -= b; }
    else { lines.push({ role: r.role, debit: -b, credit: 0 }); sum += -b; }
  }
  if (sum > 0) lines.push({ role: 'RETAINED', debit: 0, credit: sum });       // 순이익
  else if (sum < 0) lines.push({ role: 'RETAINED', debit: -sum, credit: 0 }); // 순손실
  return lines;
}

async function insertEntry(db: DatabaseService, y: number, source: 'YEAR_CLOSE' | 'YEAR_REOPEN', memo: string, lines: ELine[]) {
  const [cnt] = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM acct_entries WHERE source = $1 AND source_key LIKE $2`, [source, `${y}#%`]);
  await db.query(`SELECT set_config('sgb.acct_year_close', 'on', true)`);   // 이 거래 안에서만 — 마감한 달 · 해 막기를 마감 전표만 지나감
  const [e] = await db.query<{ id: string }>(
    `INSERT INTO acct_entries (entry_date, source, source_key, memo, party, evidence, late)
     VALUES ($1::date, $2, $3, $4, NULL, 'NONE', false) RETURNING id::text AS id`, [`${y}-12-31`, source, `${y}#${n(cnt?.c) + 1}`, memo]);
  await db.query(
    `INSERT INTO acct_lines (entry_id, role, debit, credit)
     SELECT $1::bigint, x.role, x.debit, x.credit FROM jsonb_to_recordset($2::jsonb) AS x(role text, debit bigint, credit bigint)`,
    [e!.id, JSON.stringify(lines.filter((l) => l.debit > 0 || l.credit > 0))]);
  await db.query(`SELECT set_config('sgb.acct_year_close', 'off', true)`);
  return e!.id;
}

/** 해 마감(SUPER) */
export async function closeYear(db: DatabaseService, year: number, note: string | undefined, actor: string | null) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new PolicyViolation('ACCT_YEAR', '해는 2000 ~ 2100 입니다.');
  if (kstToday() < `${year + 1}-01-01`) throw new PolicyViolation('ACCT_YEAR_FUTURE', '해가 끝난 뒤 마감합니다.');
  const [st] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.start_on'`);
  const months = monthsOf(year, (st?.v ?? '2026-11-01').slice(0, 7));
  if (!months.length) throw new PolicyViolation('ACCT_YEAR', '전표 시작 전의 해입니다.');
  const closed = await db.query<{ ym: string }>(`SELECT ym FROM acct_closings WHERE ym = ANY($1::text[])`, [months]);
  const missing = months.filter((m) => !closed.some((c) => c.ym === m));
  if (missing.length) throw new PolicyViolation('ACCT_YEAR_OPEN_MONTHS', `월 마감하지 않은 달이 있습니다: ${missing.join(', ')}`);
  const pl = await yearPl(db, year);
  const res = await db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_year_close'), $1)`, [year]);
    const last = await lastAction(db, year);
    if (last?.action === 'CLOSE') throw new PolicyViolation('ACCT_YEAR_CLOSED', '이미 마감한 해입니다.');
    const lines = await closingLines(db, year);
    const entryId = lines.length >= 2 ? await insertEntry(db, year, 'YEAR_CLOSE', `${year}년 해 마감(손익 → 이월이익잉여금)`, lines) : null;
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO acct_year_closings (year, action, net_income, revenue, expense, entry_id, reason, actor_id)
       VALUES ($1, 'CLOSE', $2, $3, $4, $5::bigint, nullif($6, ''), $7) RETURNING id::text AS id`,
      [year, pl.revenue - pl.expense, pl.revenue, pl.expense, entryId, (note ?? '').trim().slice(0, 200) || null, actor]);
    return { closingId: row!.id, entryId };
  });
  /* 다음 해 기초 잔액 초안 — ⑬ 표가 없거나 실패해도 마감은 그대로(결과에 적음) */
  let opening: { setId: string | null; lines: number; error?: string } = { setId: null, lines: 0 };
  try { opening = await makeOpening(db, year); }
  catch (e) { opening = { setId: null, lines: 0, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  return { ok: true, year, netIncome: pl.revenue - pl.expense, entryId: res.entryId, opening,
           note: `${year}년을 마감했습니다 — 순이익 ${(pl.revenue - pl.expense).toLocaleString('ko-KR')}원을 이월이익잉여금으로 넘겼고, ${year + 1}년 기초 잔액 초안을 만들었습니다(재무제표 › 기초 잔액에서 확정).` };
}

/** ⑬ trialBalance(그 해 1/1 ~ 12/31 · 마감 전표 포함) → 자산 · 부채 · 자본 잔액을 다음 해 기초 잔액 초안으로 */
async function makeOpening(db: DatabaseService, year: number) {
  const tb: unknown = await trialBalance(db, null, `${year}-12-31`);   // 가장 늦은 확정 기초 잔액 판부터 그 해 끝까지(누적 잔액)
  const rows = (Array.isArray(tb) ? tb : (tb as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;
  const bal = rows
    .filter((r) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(String(r.kind)))
    .map((r) => ({ role: String(r.role), b: String(r.kind) === 'ASSET' ? n(r.closing) : -n(r.closing) }))   // ⑬ closing 은 정상 쪽 + (자산 = 차변 − 대변 · 부채 · 자본 = 대변 − 차변) → 차변 잔액 + 로 바꿈
    .filter((x) => x.b !== 0);
  const asOf = `${year + 1}-01-01`;
  return db.transaction(async () => {
    const [set] = await db.query<{ id: string }>(
      `INSERT INTO acct_opening_sets (as_of, state) VALUES ($1::date, 'DRAFT') RETURNING id::text AS id`, [asOf]);
    for (const x of bal) await db.query(
      `INSERT INTO acct_opening (set_id, role, debit, credit, memo) VALUES ($1::bigint, $2, $3, $4, '해 마감 이월')`,
      [set!.id, x.role, x.b > 0 ? x.b : 0, x.b < 0 ? -x.b : 0]);
    return { setId: set!.id, lines: bal.length };
  });
}

/** 풀기(SUPER · 사유) — 마감 전표 반대 YEAR_REOPEN */
export async function reopenYear(db: DatabaseService, year: number, reason: string, actor: string | null) {
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_year_close'), $1)`, [year]);
    const last = await lastAction(db, year);
    if (last?.action !== 'CLOSE') throw new PolicyViolation('ACCT_YEAR_NOT_CLOSED', '마감하지 않은 해입니다.');
    let entryId: string | null = null;
    if (last.entry_id) {
      const ls = await db.query<{ role: string; debit: string; credit: string }>(`SELECT role, debit::text, credit::text FROM acct_lines WHERE entry_id = $1::bigint`, [last.entry_id]);
      entryId = await insertEntry(db, year, 'YEAR_REOPEN', `${year}년 해 마감 풀기 — ${t}`.slice(0, 200), ls.map((l) => ({ role: l.role, debit: n(l.credit), credit: n(l.debit) })));
    }
    await db.query(`INSERT INTO acct_year_closings (year, action, entry_id, reason, actor_id) VALUES ($1, 'REOPEN', $2::bigint, $3, $4)`, [year, entryId, t, actor]);
    return { ok: true, year, entryId, note: `${year}년 해 마감을 풀었습니다 — 마감 전표의 반대 전표를 넣었습니다. 다음 해 기초 잔액 초안은 다시 마감할 때 새로 만듭니다.` };
  });
}
