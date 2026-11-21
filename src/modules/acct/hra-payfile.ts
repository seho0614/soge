import { createHash } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { hraSettings, textOk, YM_RE } from './hra-common';

/* ---------------------------------------------------------------------
 * v10.583 (docs/725) 급여 이체 파일 — 확정(FIXED) · 지급(PAID) 급여 → 은행 대량 이체 CSV
 *   급여 계좌 hra_pay_banks — 계좌는 암호문(pgp_sym_encrypt · fn_enc_key · 대량 이체 v10.454 와 같은 방식)만 · 화면 · API 는 끝 4자리(「****1234」)
 *     바꾸면 바뀐 기록(끝 4자리만 · 사유) + 운영 알림 HRA_PAY_BANK_CHANGED(INFO · 계좌 가로채기를 일찍 알아채려고)
 *   양식 hra_bank_formats — 칸(field) 순서 · 칸 이름 · 머리줄 · 날짜 모양(전표 CSV 양식 v10.389 formats.ts 와 같은 방식) · SUPER 가 은행 양식에 맞춤
 *   내려받기 — 스위치 hra.payfile_export(처음 off) + 내려받기 승인(ExportGate · HRA_PAY_FILE · 24시간 안 한 번) · 계좌 원문은 이 파일에만
 *     내려받은 기록 hra_payfile_logs(SHA-256 · 줄 수 · 합계 · 승인 번호 · 계좌 원문 없음) · 감사는 고른 칸만(pick)
 *   대량 이체(fin-transfer)로 넘기지 않음 — 급여 지급 전표(PAYROLL_PAID)와 이체 지급 전표(TRANSFER_PAID)가 겹쳐 같은 돈이 두 번 장부에 들 수 있음(문서 7절)
 * ------------------------------------------------------------------- */

export const PAY_FIELDS: Record<string, string> = {
  bank: '은행 코드', acct: '계좌번호', holder: '예금주', amount: '금액(실지급)', name: '직원 이름', emp: '직원 번호',
  memo: '받는 분 통장 표시', send_memo: '보내는 분 통장 표시', pay_day: '지급일', ym: '급여 달', blank: '빈 칸',
};
export const PAY_DATE_STYLES = ['YYYY-MM-DD', 'YYYYMMDD', 'YYYY/MM/DD', 'YYYY.MM.DD'] as const;
const BANK = /^[0-9]{3}$/;            // DB CHECK hra_pay_banks.bank 와 같음
const ACCT_IN = /^[0-9-]{6,24}$/;     // 입력 모양(하이픈 허용) — 숫자 6 ~ 20자리로 줄여 저장(대량 이체와 같음)
const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');

export interface PayFmt { id: string; name: string; columns: Array<{ field: string; title: string }>; header: boolean; dateStyle: string; isDefault: boolean; note: string | null }

export async function bankFormats(db: DatabaseService): Promise<PayFmt[]> {
  return db.query<PayFmt>(
    `SELECT id::text AS id, name, columns, header, date_style AS "dateStyle", is_default AS "isDefault", note FROM hra_bank_formats ORDER BY is_default DESC, id`);
}

async function runOf(db: DatabaseService, ym: string) {
  if (!YM_RE.test(ym ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const [r] = await db.query<{ id: string; state: string; payDay: string }>(`SELECT id::text AS id, state, pay_day::text AS "payDay" FROM acct_payroll_runs WHERE ym = $1`, [ym]);
  return r ?? null;
}

/** GET /admin/hra/payfile?ym= — 그 달 급여 줄 · 계좌(끝 4자리) · 빠진 계좌 · 양식 · 내려받은 기록 */
export async function payfileView(db: DatabaseService, ym: string) {
  const run = await runOf(db, ym);
  const lines = run ? await db.query<{ lineId: string; employeeId: string; name: string; net: number; bank: string | null; account: string | null; holder: string | null; bankUpdatedAt: string | null }>(
    `SELECT l.id::text AS "lineId", l.employee_id::text AS "employeeId", e.name, l.net::float8 AS net, b.bank,
            CASE WHEN b.acct_tail IS NULL THEN NULL ELSE '****' || b.acct_tail END AS account, b.holder, b.updated_at AS "bankUpdatedAt"
       FROM acct_payroll_lines l JOIN acct_employees e ON e.id = l.employee_id LEFT JOIN hra_pay_banks b ON b.employee_id = l.employee_id
      WHERE l.run_id = $1::bigint ORDER BY e.joined_on, e.id`, [run.id]) : [];
  const banks = await db.query(
    `SELECT e.id::text AS "employeeId", e.name, e.left_on::text AS "leftOn", b.bank, CASE WHEN b.acct_tail IS NULL THEN NULL ELSE '****' || b.acct_tail END AS account, b.holder, b.updated_at AS "updatedAt"
       FROM acct_employees e LEFT JOIN hra_pay_banks b ON b.employee_id = e.id ORDER BY (e.left_on IS NOT NULL), e.joined_on, e.id LIMIT 500`);
  const changes = await db.query(
    `SELECT c.id::text AS id, e.name, c.bank_before AS "bankBefore", CASE WHEN c.tail_before IS NULL THEN NULL ELSE '****' || c.tail_before END AS "before",
            c.bank_after AS "bankAfter", '****' || c.tail_after AS "after", c.reason, coalesce(a.name, a.email) AS "changedBy", c.changed_at AS "changedAt"
       FROM hra_pay_bank_changes c JOIN acct_employees e ON e.id = c.employee_id LEFT JOIN accounts a ON a.id = c.changed_by ORDER BY c.id DESC LIMIT 20`);
  const logs = run ? await db.query(
    `SELECT g.id::text AS id, g.format_name AS "formatName", g.lines, g.total::float8 AS total, g.sha256, g.ticket::text AS ticket, coalesce(a.name, a.email) AS "madeBy", g.made_at AS "madeAt"
       FROM hra_payfile_logs g LEFT JOIN accounts a ON a.id = g.made_by WHERE g.run_id = $1::bigint ORDER BY g.id DESC LIMIT 10`, [run.id]) : [];
  const s = await hraSettings(db);
  const pay = lines.filter((l) => Number(l.net) > 0);
  return {
    ym, run, lines, banks, changes, logs, formats: await bankFormats(db), fields: PAY_FIELDS, dateStyles: PAY_DATE_STYLES, exportOn: s.payfileExport,
    total: { people: pay.length, amount: pay.reduce((a, l) => a + Number(l.net), 0), missing: pay.filter((l) => !l.bank).length },
    ready: !!run && (run.state === 'FIXED' || run.state === 'PAID') && pay.length > 0 && pay.every((l) => !!l.bank) && s.payfileExport,
    note: '확정 · 지급한 급여의 실지급액으로 은행 대량 이체 파일을 만듭니다. 계좌는 끝 4자리만 보입니다 — 원문은 내려받기 승인 뒤 파일에만 들어갑니다. 은행에 올리기 전 합계 · 줄 수를 은행 화면과 맞춰 보십시오.',
  };
}

/** PUT /admin/hra/pay-banks/{employeeId} — 급여 계좌 넣기 · 바꾸기(사유 · 바뀐 기록 · 알림) */
export async function setPayBank(db: DatabaseService, employeeId: string, b: { bank?: string; acct?: string; holder?: string; reason?: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(employeeId ?? ''))) throw new NotFound('직원이 없습니다.');
  if (!BANK.test(String(b.bank ?? ''))) throw new PolicyViolation('HRA_PAY_BANK', '은행 코드는 숫자 3자리입니다.');
  const acc = digits(b.acct);
  if (!ACCT_IN.test(String(b.acct ?? '')) || acc.length < 6 || acc.length > 20) throw new PolicyViolation('HRA_PAY_ACCT', '계좌번호는 숫자 6 ~ 20자리입니다.');
  const holder = textOk(b.holder, 1, 40);
  if (!holder) throw new PolicyViolation('HRA_PAY_HOLDER', '예금주는 1 ~ 40자입니다.');
  const reason = textOk(b.reason, 2, 200);
  if (!reason) throw new PolicyViolation('HRA_REASON', '사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const [e] = await db.query<{ name: string }>(`SELECT name FROM acct_employees WHERE id = $1::bigint`, [employeeId]);
    if (!e) throw new NotFound('직원이 없습니다.');
    const [old] = await db.query<{ bank: string; tail: string }>(`SELECT bank, acct_tail AS tail FROM hra_pay_banks WHERE employee_id = $1::bigint FOR UPDATE`, [employeeId]);
    const tail = acc.slice(-4);
    await db.query(
      `INSERT INTO hra_pay_banks (employee_id, bank, acct_enc, acct_tail, holder, updated_by) VALUES ($1::bigint, $2, pgp_sym_encrypt($3::text, fn_enc_key()), $4, $5, $6::uuid)
       ON CONFLICT (employee_id) DO UPDATE SET bank = EXCLUDED.bank, acct_enc = EXCLUDED.acct_enc, acct_tail = EXCLUDED.acct_tail, holder = EXCLUDED.holder, updated_by = EXCLUDED.updated_by`,
      [employeeId, b.bank, acc, tail, holder, actor]);
    await db.query(
      `INSERT INTO hra_pay_bank_changes (employee_id, bank_before, tail_before, bank_after, tail_after, reason, changed_by) VALUES ($1::bigint, $2, $3, $4, $5, $6, $7::uuid)`,
      [employeeId, old?.bank ?? null, old?.tail ?? null, b.bank, tail, reason, actor]);
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('HRA_PAY_BANK_CHANGED', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`${e.name} 님 급여 계좌를 ${old ? '바꿨습니다' : '넣었습니다'}(****${tail}) — 본인이 요청한 것인지 확인하십시오(회계 › 인사 › 급여 이체 파일)`,
       JSON.stringify({ employeeId, before: old ? `****${old.tail}` : null, after: `****${tail}` })]);
    return { ok: true, employeeId, account: `****${tail}`, bank: b.bank, created: !old, note: old ? `${e.name} 님 급여 계좌를 바꿨습니다(****${tail}) — 바뀐 기록 · 운영 알림에 남았습니다.` : `${e.name} 님 급여 계좌를 넣었습니다(****${tail}) — 바뀐 기록 · 운영 알림에 남았습니다.` };
  });
}

/** 양식 검사 — 칸 1 ~ 20 · 아는 field 만 · 은행 코드 · 계좌 · 금액은 꼭 */
export function checkBankFormat(b: { name?: string; columns?: Array<{ field?: string; title?: string }>; header?: boolean; dateStyle?: string; note?: string }) {
  const name = textOk(b.name, 1, 40);
  if (!name) throw new PolicyViolation('HRA_BANK_FORMAT', '양식 이름은 1 ~ 40자입니다.');
  const cols = Array.isArray(b.columns) ? b.columns : [];
  if (cols.length < 1 || cols.length > 20) throw new PolicyViolation('HRA_BANK_FORMAT', '칸은 1 ~ 20개입니다.');
  const out = cols.map((c) => {
    const f = String(c?.field ?? '');
    if (!(f in PAY_FIELDS)) throw new PolicyViolation('HRA_BANK_FORMAT', `모르는 칸입니다: ${f}`);
    return { field: f, title: String(c?.title ?? PAY_FIELDS[f]).trim().slice(0, 30) || PAY_FIELDS[f]! };
  });
  for (const must of ['bank', 'acct', 'amount']) if (!out.some((c) => c.field === must)) throw new PolicyViolation('HRA_BANK_FORMAT', `「${PAY_FIELDS[must]}」 칸이 있어야 합니다.`);
  const dateStyle = (PAY_DATE_STYLES as readonly string[]).includes(b.dateStyle ?? '') ? b.dateStyle! : 'YYYYMMDD';
  return { name, columns: out, header: b.header !== false, dateStyle, note: textOk(b.note, 0, 200) || null };
}

/** POST /admin/hra/bank-formats · PUT /admin/hra/bank-formats/{id} (SUPER) — 기본으로 두면 다른 양식의 기본은 풂 */
export async function saveBankFormat(db: DatabaseService, id: string | null, b: Parameters<typeof checkBankFormat>[0] & { isDefault?: boolean }, actor: string | null) {
  const f = checkBankFormat(b);
  if (id !== null && !/^\d{1,18}$/.test(id)) throw new NotFound('없는 양식입니다.');
  return db.transaction(async () => {
    if (b.isDefault === true) await db.query(`UPDATE hra_bank_formats SET is_default = false WHERE is_default AND ($1::bigint IS NULL OR id <> $1::bigint)`, [id]);
    try {
      if (id === null) {
        const [r] = await db.query<{ id: string }>(
          `INSERT INTO hra_bank_formats (name, columns, header, date_style, is_default, note, updated_by) VALUES ($1, $2::jsonb, $3::boolean, $4, $5::boolean, $6, $7::uuid) RETURNING id::text AS id`,
          [f.name, JSON.stringify(f.columns), f.header, f.dateStyle, b.isDefault === true, f.note, actor]);
        return { ok: true, id: r!.id, note: `양식 「${f.name}」을 만들었습니다.` };
      }
      const r = await db.query(
        `UPDATE hra_bank_formats SET name = $2, columns = $3::jsonb, header = $4::boolean, date_style = $5, is_default = CASE WHEN $6::boolean THEN true ELSE is_default END,
                note = $7, updated_by = $8::uuid, updated_at = now() WHERE id = $1::bigint RETURNING id`,
        [id, f.name, JSON.stringify(f.columns), f.header, f.dateStyle, b.isDefault === true, f.note, actor]);
      if (!r.length) throw new NotFound('없는 양식입니다.');
      return { ok: true, id, note: `양식 「${f.name}」을 고쳤습니다.` };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new StateConflict('HRA_BANK_FORMAT_NAME', '같은 이름의 양식이 있습니다.');
      throw e;
    }
  });
}

const fmtDate = (d: string, style: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-');
  return style === 'YYYYMMDD' ? `${y}${m}${dd}` : style === 'YYYY/MM/DD' ? `${y}/${m}/${dd}` : style === 'YYYY.MM.DD' ? `${y}.${m}.${dd}` : `${y}-${m}-${dd}`;
};
/** CSV 칸 — 따옴표 · 줄바꿈 · 셈식 앞머리(= + - @) 막기(acct.controller csvCell 과 같은 규칙) */
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

/** GET /admin/hra/payfile/export?ym=&formatId=&ticket= — 스위치 · 승인 뒤 · 계좌 원문이 든 CSV(UTF-8 BOM) · 기록 */
export async function exportPayfile(db: DatabaseService, ym: string, formatId: string | undefined, ticket: unknown, actor: string | null) {
  const s = await hraSettings(db);
  if (!s.payfileExport) throw new PolicyViolation('HRA_PAYFILE_OFF', '급여 이체 파일 내려받기가 꺼져 있습니다(hra.payfile_export · SUPER).');
  const run = await runOf(db, ym);
  if (!run) throw new NotFound('그 달 급여 대장이 없습니다.');
  if (run.state !== 'FIXED' && run.state !== 'PAID') throw new StateConflict('HRA_PAYFILE_STATE', '확정한 급여만 이체 파일을 만듭니다.');
  const all = await bankFormats(db);
  const f = formatId ? all.find((x) => x.id === String(formatId)) : all.find((x) => x.isDefault) ?? all[0];
  if (!f) throw new NotFound('이체 파일 양식이 없습니다.');
  const rows = await db.query<{ employeeId: string; name: string; net: string; bank: string | null; acct: string | null; holder: string | null }>(
    `SELECT l.employee_id::text AS "employeeId", e.name, l.net::text AS net, b.bank, pgp_sym_decrypt(b.acct_enc, fn_enc_key()) AS acct, b.holder
       FROM acct_payroll_lines l JOIN acct_employees e ON e.id = l.employee_id LEFT JOIN hra_pay_banks b ON b.employee_id = l.employee_id
      WHERE l.run_id = $1::bigint AND l.net > 0 ORDER BY e.joined_on, e.id`, [run.id]);
  if (!rows.length) throw new PolicyViolation('HRA_PAYFILE_EMPTY', '실지급액이 있는 줄이 없습니다.');
  const missing = rows.filter((r) => !r.bank || !r.acct);
  if (missing.length) throw new PolicyViolation('HRA_PAY_BANK_MISSING', `급여 계좌가 없는 직원이 있습니다: ${missing.map((m) => m.name).join(', ')}`);
  const month = Number(ym.slice(5, 7));
  const body = rows.map((r) => f.columns.map((c) => {
    switch (c.field) {
      case 'bank': return r.bank;
      case 'acct': return r.acct;
      case 'holder': return r.holder ?? r.name;
      case 'amount': return Number(r.net);
      case 'name': return r.name;
      case 'emp': return r.employeeId;
      case 'memo': return `${month}월급여`;
      case 'send_memo': return r.name;
      case 'pay_day': return fmtDate(run.payDay, f.dateStyle);
      case 'ym': return ym;
      default: return '';
    }
  }));
  const csv = '﻿' + [...(f.header ? [f.columns.map((c) => c.title)] : []), ...body].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
  const total = rows.reduce((a, r) => a + Number(r.net), 0);
  const t = Number(ticket);
  await db.query(
    `INSERT INTO hra_payfile_logs (run_id, ym, format_id, format_name, lines, total, sha256, ticket, made_by) VALUES ($1::bigint, $2, $3::bigint, $4, $5::int, $6::bigint, $7, $8::bigint, $9::uuid)`,
    [run.id, ym, f.id, f.name, rows.length, total, sha256, Number.isInteger(t) && t > 0 ? t : null, actor]);
  return { ok: true, ym, formatName: f.name, lines: rows.length, total, sha256, filename: `급여이체_${ym}_${f.name.replace(/[^0-9A-Za-z가-힣]+/g, '')}.csv`, csv,
           note: `${ym} 급여 이체 파일 ${rows.length}줄 · ${total.toLocaleString('ko-KR')}원을 만들었습니다 — 은행에 올린 뒤 이 파일은 지우십시오(계좌 원문).` };
}
