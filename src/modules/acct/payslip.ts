import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { myEmployee } from './hr';

/* ---------------------------------------------------------------------
 * ㉖ v10.447 (D259 · docs/584) 급여명세서 — ⑭ 급여 대장 줄(확정 · 지급만)을 한 장으로
 *   지급: 총급여 · 비과세 · 과세 급여 / 공제: 소득세 · 지방소득세 · 국민연금 · 건강 · 장기요양 · 고용 / 실지급
 *   회사 부담(국민연금 · 건강 · 장기요양 · 고용 · 산재)은 참고로 따로.
 *   보기: SUPER · 지급 담당(세무사는 읽기) · 직원 본인은 운영 화면 › 사무 › 내 인사(자기 줄만).
 *   알림 메일: acct.payslip_mail(처음 off) · SUPER 가 「알림 보내기」 · 메일에는 금액을 넣지 않음 · 같은 줄은 한 번만(acct_payslip_mails).
 * ------------------------------------------------------------------- */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const n = (v: unknown) => Number(v ?? 0);
const mask = (e: string) => { const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`; };
export interface SlipMailer { ready(): Promise<boolean>; send(m: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }> }

const SLIP_SQL =
  `SELECT l.id::text AS id, l.employee_id::text AS "employeeId", e.name, e.joined_on::text AS "joinedOn", r.ym, r.pay_day::text AS "payDay", r.state AS "runState",
          l.gross::float8 AS gross, l.nontax::float8 AS nontax, (l.gross - l.nontax)::float8 AS taxable,
          l.income_tax::float8 AS "incomeTax", l.local_tax::float8 AS "localTax", l.np::float8 AS np, l.hi::float8 AS hi, l.ltc::float8 AS ltc, l.ei::float8 AS ei,
          (l.income_tax + l.local_tax + l.np + l.hi + l.ltc + l.ei)::float8 AS deductions, l.net::float8 AS net,
          l.company_np::float8 AS "companyNp", l.company_hi::float8 AS "companyHi", l.company_ltc::float8 AS "companyLtc", l.company_ei::float8 AS "companyEi",
          coalesce(l.company_ia, 0)::float8 AS "companyIa", l.wht_missing AS "whtMissing", (e.account_id IS NOT NULL) AS linked
     FROM acct_payroll_lines l JOIN acct_payroll_runs r ON r.id = l.run_id JOIN acct_employees e ON e.id = l.employee_id
    WHERE r.state IN ('FIXED', 'PAID')`;

/** GET /admin/acct/payslips?ym= */
export async function payslips(db: DatabaseService, ymIn?: string) {
  const runs = await db.query<{ ym: string; state: string; payDay: string }>(
    `SELECT ym, state, pay_day::text AS "payDay" FROM acct_payroll_runs WHERE state IN ('FIXED', 'PAID') ORDER BY ym DESC LIMIT 24`);
  const ym = ymIn && YM.test(ymIn) ? ymIn : runs[0]?.ym ?? null;
  const items = ym ? await db.query<Record<string, unknown>>(`${SLIP_SQL} AND r.ym = $1 ORDER BY e.joined_on, e.id`, [ym]) : [];
  const sent = ym ? await db.query<{ line: string; result: string; at: string }>(
    `SELECT DISTINCT ON (m.line_id) m.line_id::text AS line, m.result, m.created_at AS at
       FROM acct_payslip_mails m JOIN acct_payroll_lines l ON l.id = m.line_id JOIN acct_payroll_runs r ON r.id = l.run_id
      WHERE r.ym = $1 ORDER BY m.line_id, (m.result = 'SENT') DESC, m.id DESC`, [ym]) : [];
  const sm = new Map(sent.map((s) => [s.line, s]));
  const [mail] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.payslip_mail'`);
  return { ym, runs, items: items.map((x) => ({ ...x, mail: sm.get(String(x.id)) ?? null })), mailOn: mail?.v === 'on',
           note: '확정 · 지급한 급여만 명세서가 됩니다. 직원 본인은 운영 화면 › 사무 › 내 인사에서 자기 명세서만 봅니다.' };
}

async function company(db: DatabaseService) {
  const [co] = await db.query<{ v: string | null }>(`SELECT nullif(btrim(value), '') AS v FROM site_settings WHERE key = 'footer.company_name'`);
  return co?.v ?? '(주)한국바이오헬스케어 소개뱅크 사업부';
}
function shape(x: Record<string, unknown>, co: string) {
  const pay = [{ label: '총급여', amount: n(x.gross) }, { label: '비과세(식대 등)', amount: n(x.nontax) }, { label: '과세 급여', amount: n(x.taxable) }];
  const ded = [{ label: '소득세', amount: n(x.incomeTax) }, { label: '지방소득세', amount: n(x.localTax) }, { label: '국민연금', amount: n(x.np) },
               { label: '건강보험', amount: n(x.hi) }, { label: '장기요양보험', amount: n(x.ltc) }, { label: '고용보험', amount: n(x.ei) }];
  const co_ = [{ label: '국민연금', amount: n(x.companyNp) }, { label: '건강보험', amount: n(x.companyHi) }, { label: '장기요양보험', amount: n(x.companyLtc) },
               { label: '고용보험', amount: n(x.companyEi) }, { label: '산재보험', amount: n(x.companyIa) }];
  return { company: co, slip: x, pay, deductions: ded, companyShare: co_, net: n(x.net), totalDeductions: n(x.deductions),
           note: '급여 대장(확정) 값입니다. 소득세는 간이세액(일반 원칙) 기준이며 연말정산에서 다시 맞춥니다.' };
}

/** GET /admin/acct/payslips/{lineId} — 한 장(관리 쪽) */
export async function payslipOne(db: DatabaseService, lineId: string) {
  if (!/^\d{1,18}$/.test(String(lineId ?? ''))) throw new NotFound('없는 명세서입니다.');
  const [x] = await db.query<Record<string, unknown>>(`${SLIP_SQL} AND l.id = $1::bigint`, [lineId]);
  if (!x) throw new NotFound('없는 명세서입니다(확정 전 급여는 명세서가 없습니다).');
  return shape(x, await company(db));
}

/** GET /admin/me/hr/payslips/{lineId} — 본인 것만 */
export async function myPayslip(db: DatabaseService, actor: string | null, lineId: string) {
  const me = await myEmployee(db, actor);
  if (!me) throw new PolicyViolation('HR_NOT_LINKED', '이 계정에 연결된 직원이 없습니다.');
  if (!/^\d{1,18}$/.test(String(lineId ?? ''))) throw new NotFound('없는 명세서입니다.');
  const [x] = await db.query<Record<string, unknown>>(`${SLIP_SQL} AND l.id = $1::bigint AND l.employee_id = $2::bigint`, [lineId, me.id]);
  if (!x) throw new NotFound('없는 명세서입니다.');
  return shape(x, await company(db));
}

/** POST /admin/acct/payslips/notify {ym} — 알림 메일(SUPER · 스위치 on · 금액 없음 · 줄마다 한 번) */
export async function notifyPayslips(db: DatabaseService, mail: SlipMailer, ym: string, actor: string | null) {
  if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const [sw] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.payslip_mail'`);
  if (sw?.v !== 'on') throw new PolicyViolation('PAYSLIP_MAIL_OFF', '급여명세서 알림 메일이 꺼져 있습니다 — 정책 › 전체 설정 acct.payslip_mail 을 켜십시오(SUPER).');
  const lines = await db.query<{ id: string; name: string; email: string | null; sent: boolean }>(
    `SELECT l.id::text AS id, e.name, a.email, EXISTS (SELECT 1 FROM acct_payslip_mails m WHERE m.line_id = l.id AND m.result = 'SENT') AS sent
       FROM acct_payroll_lines l JOIN acct_payroll_runs r ON r.id = l.run_id JOIN acct_employees e ON e.id = l.employee_id LEFT JOIN accounts a ON a.id = e.account_id
      WHERE r.ym = $1 AND r.state IN ('FIXED', 'PAID') ORDER BY l.id`, [ym]);
  if (!lines.length) throw new PolicyViolation('PAYSLIP_NO_RUN', '그 달 확정한 급여가 없습니다.');
  const log = (id: string, to: string | null, result: string, error: string | null) => db.query(
    `INSERT INTO acct_payslip_mails (line_id, to_masked, result, error, created_by) VALUES ($1::bigint, $2, $3, $4, $5::uuid)`, [id, to, result, error, actor]);
  const ready = await mail.ready();
  let sent = 0, skipped = 0, noAccount = 0, failed = 0;
  for (const l of lines) {
    if (l.sent) { skipped++; continue; }
    if (!l.email) { noAccount++; await log(l.id, null, 'NO_ACCOUNT', null); continue; }
    if (!ready) { failed++; await log(l.id, mask(l.email), 'NOT_READY', null); continue; }
    const res = await mail.send({ to: l.email, subject: `[소개뱅크] ${ym} 급여명세서가 나왔습니다`,
      text: `${l.name} 님,\n\n${ym} 급여명세서가 나왔습니다. 운영 화면 › 사무 › 내 인사에서 보십시오.\n(보안을 위해 메일에는 금액을 넣지 않습니다.)\n` });
    if (res.ok) { sent++; await log(l.id, mask(l.email), 'SENT', null); }
    else { failed++; await log(l.id, mask(l.email), 'FAILED', (res.error ?? '').slice(0, 300) || null); }
  }
  return { ok: true, ym, sent, skipped, noAccount, failed, ready,
           note: ready ? `${ym} 명세서 알림 ${sent}통을 보냈습니다(이미 보냄 ${skipped} · 계정 없음 ${noAccount} · 실패 ${failed}).`
                       : '메일 준비가 되지 않아 보내지 않았습니다(보내는 주소 · 설정).' };
}
