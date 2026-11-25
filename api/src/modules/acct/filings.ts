/* e3 (docs/010) 소개뱅크 src/modules/acct/filings.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * ⑲ v10.420 ~ 422 (D252 · docs/557 ~ 559) 세무 · 노무 신고 자료 — 대표 11/19 「모두개발」 · 일반 원칙(docs/555)
 *   v10.420 원천세 이행상황신고서 미리보기 — 달(지급한 달) 근로소득(급여 확정 · 지급) · 사업소득(포인트 출금 3.3%) · 퇴직소득(지급 기록 없음 → 0)
 *           칸 이름은 일반 신고서 칸(A01 간이세액 · A20 퇴직소득 · A25 사업소득 · A99 총합계) · 납부 기한 = 다음 달 10일(주말 · 공휴일이면 다음 영업일)
 *   v10.421 근로소득 지급명세서 · 원천징수영수증 · 간이지급명세서 — 해 · 반기 · 달 직원별 지급 · 비과세 · 소득세 · 지방소득세 · 4대보험 본인 몫
 *           주민등록번호는 받지 않음 — 신고 때 회계 프로그램(홈택스)에서 번호를 채움.
 *   v10.422 4대보험 취득 · 상실 신고 자료 — 입사일(취득) · 퇴사일(상실) · 보수월액 · 기한 다음 달 15일 · 처리함 표시(SUPER · 쌓기만) · 기한 알림 ACCT_INSURANCE_DUE
 *   숫자는 일반 원칙 값으로 셈한 장부 값 — 실제 신고는 홈택스 · 4대보험 포털에서(세무사 확인은 선택).
 * ------------------------------------------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const nextYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`; };

/** 그날이 주말 · 공휴일이면 다음 영업일(fn_is_business_day · ⑪ month.ts 와 같은 셈) */
async function bizDay(db: DatabaseService, d: string) {
  const [r] = await db.query<{ d: string }>(
    `WITH RECURSIVE x(d, n) AS (SELECT $1::date, 0 UNION ALL SELECT d + 1, n + 1 FROM x WHERE NOT fn_is_business_day(d) AND n < 30)
     SELECT d::text AS d FROM x ORDER BY n DESC LIMIT 1`, [d]);
  return r?.d ?? d;
}

/* ── v10.420 원천세 이행상황신고서 ── */
export interface WhtRow { code: string; label: string; people: number; count: number; paid: number; incomeTax: number; localTax: number }

export async function whtReturn(db: DatabaseService, ym: string) {
  if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const [lab] = await db.query<{ people: number; paid: string; it: string; lt: string; runs: number }>(
    `SELECT count(DISTINCT l.employee_id)::int AS people, coalesce(sum(l.gross), 0)::text AS paid,
            coalesce(sum(l.income_tax), 0)::text AS it, coalesce(sum(l.local_tax), 0)::text AS lt, count(DISTINCT r.id)::int AS runs
       FROM acct_payroll_runs r JOIN acct_payroll_lines l ON l.run_id = r.id
      WHERE r.state IN ('FIXED', 'PAID') AND to_char(r.pay_day, 'YYYY-MM') = $1`, [ym]);
  const [biz] = await db.query<{ people: number; n: number; paid: string; it: string; lt: string }>(
    `SELECT count(DISTINCT account_id)::int AS people, count(*)::int AS n, coalesce(sum(points), 0)::text AS paid,
            coalesce(sum(income_tax), 0)::text AS it, coalesce(sum(local_tax), 0)::text AS lt
       FROM svc.point_cashouts WHERE status = 'PAID' AND to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1`, [ym]);
  const rows: WhtRow[] = [
    { code: 'A01', label: '근로소득 — 간이세액(매월 급여)', people: n(lab?.people), count: n(lab?.runs), paid: n(lab?.paid), incomeTax: n(lab?.it), localTax: n(lab?.lt) },
    { code: 'A20', label: '퇴직소득', people: 0, count: 0, paid: 0, incomeTax: 0, localTax: 0 },
    { code: 'A25', label: '사업소득 — 매월 징수(추천 보상 포인트 출금 3.3%)', people: n(biz?.people), count: n(biz?.n), paid: n(biz?.paid), incomeTax: n(biz?.it), localTax: n(biz?.lt) },
  ];
  const total: WhtRow = rows.reduce((a, r) => ({ ...a, people: a.people + r.people, count: a.count + r.count, paid: a.paid + r.paid, incomeTax: a.incomeTax + r.incomeTax, localTax: a.localTax + r.localTax }),
    { code: 'A99', label: '총합계', people: 0, count: 0, paid: 0, incomeTax: 0, localTax: 0 });
  const base = `${nextYm(ym)}-10`;
  const due = await bizDay(db, base);
  return {
    ym, rows, total, due, base, daysLeft: Math.round((Date.parse(due) - Date.parse(kstToday())) / 86400e3),
    note: '지급한 달 기준(급여는 지급일 · 포인트 출금은 지급 시각) 원천세입니다. 소득세는 홈택스 원천세 신고 · 지방소득세는 위택스로 냅니다. 퇴직소득은 퇴직금 지급 기록이 아직 없어 0 입니다.',
  };
}

export function whtReturnCsv(r: Awaited<ReturnType<typeof whtReturn>>) {
  const head = ['귀속 · 지급 달', '코드', '소득 구분', '인원', '건수', '총지급액', '소득세', '지방소득세', '납부 기한'];
  const body = [...r.rows, r.total].map((x) => [r.ym, x.code, x.label, x.people, x.count, x.paid, x.incomeTax, x.localTax, r.due]);
  return { head, body };
}

/* ── v10.421 근로소득 지급명세서 · 원천징수영수증 · 간이지급명세서 ── */
/** 기간 — YYYY(해) · YYYY-H1 · YYYY-H2(반기 · 간이지급명세서) · YYYY-MM(달) → [시작 달, 끝 달] */
export function periodRange(p: string): { from: string; to: string; label: string } {
  if (/^\d{4}$/.test(p ?? '')) return { from: `${p}-01`, to: `${p}-12`, label: `${p}년` };
  const h = /^(\d{4})-H([12])$/.exec(p ?? '');
  if (h) return h[2] === '1' ? { from: `${h[1]}-01`, to: `${h[1]}-06`, label: `${h[1]}년 상반기` } : { from: `${h[1]}-07`, to: `${h[1]}-12`, label: `${h[1]}년 하반기` };
  if (YM.test(p ?? '')) return { from: p, to: p, label: `${p}` };
  throw new PolicyViolation('ACCT_PERIOD', '기간은 YYYY · YYYY-H1 · YYYY-H2 · YYYY-MM 입니다.');
}

export interface WageRow { employeeId: string; name: string; joinedOn: string; leftOn: string | null; months: number; gross: number; nontax: number; taxable: number;
  incomeTax: number; localTax: number; np: number; hi: number; ltc: number; ei: number; net: number }

export async function wageStatements(db: DatabaseService, period: string) {
  const r = periodRange(period);
  const items = await db.query<WageRow>(
    `SELECT e.id::text AS "employeeId", e.name, e.joined_on::text AS "joinedOn", e.left_on::text AS "leftOn",
            count(DISTINCT pr.id)::int AS months, sum(l.gross)::float8 AS gross, sum(l.nontax)::float8 AS nontax, sum(l.gross - l.nontax)::float8 AS taxable,
            sum(l.income_tax)::float8 AS "incomeTax", sum(l.local_tax)::float8 AS "localTax",
            sum(l.np)::float8 AS np, sum(l.hi)::float8 AS hi, sum(l.ltc)::float8 AS ltc, sum(l.ei)::float8 AS ei, sum(l.net)::float8 AS net
       FROM acct_payroll_runs pr JOIN acct_payroll_lines l ON l.run_id = pr.id JOIN acct_employees e ON e.id = l.employee_id
      WHERE pr.state IN ('FIXED', 'PAID') AND to_char(pr.pay_day, 'YYYY-MM') BETWEEN $1 AND $2
      GROUP BY e.id, e.name, e.joined_on, e.left_on ORDER BY e.joined_on, e.id`, [r.from, r.to]);
  const sum = (k: keyof WageRow) => items.reduce((a, x) => a + n(x[k]), 0);
  return {
    period, ...r, items,
    total: { people: items.length, gross: sum('gross'), nontax: sum('nontax'), taxable: sum('taxable'), incomeTax: sum('incomeTax'), localTax: sum('localTax'),
             ins: sum('np') + sum('hi') + sum('ltc') + sum('ei'), net: sum('net') },
    kind: /^\d{4}$/.test(period) ? 'YEAR' : /H[12]$/.test(period) ? 'HALF' : 'MONTH',
    note: '확정 · 지급한 급여(지급일 기준) 합계입니다. 주민등록번호는 받지 않아 칸이 비어 있습니다 — 신고 때 회계 프로그램(홈택스)에서 채웁니다. 연말정산 결과(결정세액)는 들어 있지 않습니다.',
  };
}

export function wageCsv(w: Awaited<ReturnType<typeof wageStatements>>) {
  const head = ['기간', '직원', '주민등록번호(신고 때 채움)', '입사일', '퇴사일', '달 수', '총급여', '비과세', '과세 급여', '소득세', '지방소득세', '국민연금', '건강보험', '장기요양', '고용보험', '실지급'];
  const body = w.items.map((x) => [w.label, x.name, '', x.joinedOn, x.leftOn ?? '', x.months, x.gross, x.nontax, x.taxable, x.incomeTax, x.localTax, x.np, x.hi, x.ltc, x.ei, x.net]);
  return { head, body };
}

/** 원천징수영수증 한 장(직원 · 해) — 인쇄용 */
export async function wageReceipt(db: DatabaseService, employeeId: string, year: string) {
  if (!/^\d{4}$/.test(year ?? '')) throw new PolicyViolation('ACCT_PERIOD', '해는 YYYY 입니다.');
  const w = await wageStatements(db, year);
  const row = w.items.find((x) => x.employeeId === String(employeeId));
  if (!row) throw new NotFound('그 해 확정한 급여가 없는 직원입니다.');
  const [co] = await db.query<{ v: string | null }>(`SELECT value AS v FROM erp_site_settings WHERE key = 'footer.company_name'`);
  return { year, company: co?.v ?? '(주)한국바이오헬스케어 소개뱅크 사업부', employee: row,
           note: '근로소득 원천징수영수증(장부 값) — 주민등록번호 · 연말정산 결정세액은 신고 때 회계 프로그램에서 채웁니다.' };
}

/* ── v10.422 4대보험 취득 · 상실 신고 자료 ── */
export interface InsRow { employeeId: string; name: string; kind: 'ACQ' | 'LOSS'; eventOn: string; monthlyWage: number; reason: string; due: string; daysLeft: number;
  done: boolean; doneAt: string | null; doneBy: string | null; note: string | null }

const due15 = (d: string) => `${nextYm(d.slice(0, 7))}-15`;

export async function insuranceFilings(db: DatabaseService, opts: { pendingOnly?: boolean } = {}) {
  const emps = await db.query<{ id: string; name: string; joined_on: string; left_on: string | null; monthly_base: string; nontax: string }>(
    `SELECT id::text AS id, name, joined_on::text AS joined_on, left_on::text AS left_on, monthly_base::text AS monthly_base, nontax::text AS nontax FROM acct_employees ORDER BY joined_on, id`);
  const done = await db.query<{ employee_id: string; kind: string; created_at: string; who: string | null; note: string | null }>(
    `SELECT DISTINCT ON (d.employee_id, d.kind) d.employee_id::text AS employee_id, d.kind, d.created_at::text AS created_at, a.email::text AS who, d.note
       FROM acct_insurance_done d LEFT JOIN svc.accounts a ON a.id = d.created_by ORDER BY d.employee_id, d.kind, d.id DESC`);
  const key = (e: string, k: string) => `${e}:${k}`;
  const dm = new Map(done.map((d) => [key(d.employee_id, d.kind), d]));
  const today = kstToday();
  const rows: InsRow[] = [];
  for (const e of emps) {
    const wage = Math.max(0, n(e.monthly_base) - n(e.nontax));
    const evs: Array<['ACQ' | 'LOSS', string, string]> = [['ACQ', e.joined_on, '입사(취득)']];
    if (e.left_on) evs.push(['LOSS', e.left_on, '퇴사(상실) — 상실일은 퇴사 다음 날']);
    for (const [kind, on, reason] of evs) {
      const d = dm.get(key(e.id, kind));
      const due = due15(on);
      rows.push({ employeeId: e.id, name: e.name, kind, eventOn: kind === 'LOSS' ? new Date(Date.parse(on) + 86400e3).toISOString().slice(0, 10) : on, monthlyWage: wage, reason, due,
                  daysLeft: Math.round((Date.parse(due) - Date.parse(today)) / 86400e3), done: !!d, doneAt: d?.created_at ?? null, doneBy: d?.who ?? null, note: d?.note ?? null });
    }
  }
  const list = opts.pendingOnly ? rows.filter((r) => !r.done) : rows;
  list.sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due));
  return { items: list, pending: rows.filter((r) => !r.done).length, overdue: rows.filter((r) => !r.done && r.daysLeft < 0).length,
           note: '취득 · 상실 신고 기한은 다음 달 15일(일반 원칙 · 건강보험은 14일 안 권장)입니다. 신고는 4대 사회보험 정보연계센터에서 하고, 하고 나면 「처리함」을 누릅니다. 보수월액 = 월 기본급 − 비과세.' };
}

export async function markInsuranceDone(db: DatabaseService, employeeId: string, kind: string, note: string | undefined, actor: string | null) {
  if (kind !== 'ACQ' && kind !== 'LOSS') throw new PolicyViolation('ACCT_INSURANCE', '종류는 ACQ(취득) · LOSS(상실)입니다.');
  const [e] = await db.query<{ left_on: string | null }>(`SELECT left_on::text AS left_on FROM acct_employees WHERE id = $1::bigint`, [employeeId]);
  if (!e) throw new NotFound('없는 직원입니다.');
  if (kind === 'LOSS' && !e.left_on) throw new PolicyViolation('ACCT_INSURANCE', '퇴사일이 없는 직원은 상실 신고가 없습니다.');
  const [dup] = await db.query(`SELECT 1 FROM acct_insurance_done WHERE employee_id = $1::bigint AND kind = $2`, [employeeId, kind]);
  if (dup) throw new StateConflict('ACCT_INSURANCE_DONE', '이미 처리함으로 표시했습니다.');
  await db.query(`INSERT INTO acct_insurance_done (employee_id, kind, note, created_by) VALUES ($1::bigint, $2, nullif($3, ''), $4)`,
    [employeeId, kind, (note ?? '').trim().slice(0, 200), actor]);
  await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '처리함' WHERE alert_code = 'ACCT_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'key' = $1`,
    [`${employeeId}:${kind}`]);
  return { ok: true, employeeId, kind, note: '처리함으로 표시했습니다(지우지 않음).' };
}

/** 정기 작업 acct_insurance — 기한 3일 전부터 · 지난 것 ACCT_INSURANCE_DUE(같은 건 한 번 · 처리하면 풀림) · 직원이 있을 때만 */
export async function acctInsuranceJob(db: DatabaseService) {
  const [s] = await db.query<{ v: string | null }>(`SELECT value AS v FROM erp_site_settings WHERE key = 'acct.insurance_alert'`);
  if ((s?.v ?? 'on') !== 'on') return { on: false, made: [] as string[], pending: 0 };
  const f = await insuranceFilings(db, { pendingOnly: true });
  const made: string[] = [];
  for (const r of f.items.filter((x) => x.daysLeft <= 3)) {
    const k = `${r.employeeId}:${r.kind}`;
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_INSURANCE_DUE', $1, $2, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_INSURANCE_DUE' AND detail->>'key' = $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [r.daysLeft < 0 ? 'CRITICAL' : 'WARN', `4대보험 ${r.kind === 'ACQ' ? '취득' : '상실'} 신고 — ${r.name} · 기한 ${r.due}${r.daysLeft < 0 ? ' 지남' : ` · ${r.daysLeft}일 남음`} — 회계 › 4대보험 신고`,
       JSON.stringify({ key: k, employeeId: r.employeeId, kind: r.kind, due: r.due }), k]);
    if (ins.length) made.push(k);
  }
  return { on: true, made, pending: f.pending };
}
