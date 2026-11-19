import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { parseCsv, parseDate } from './bank';
import { assertStepsDone, recordFinal } from './approval';   // v10.424 (D253) 결재선
import type { Line, Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.393 (D245 · docs/530) 경비 청구 · 법인카드
 *   경비 청구 — 운영자가 개인 돈으로 쓴 경비를 올림(증빙 첨부 3개) → SUPER 승인(본인 청구 불가 · DB 가 막음) → 지급 처리(PAYOUT · 본인 불가)
 *     승인 때 전표 EXPENSE_APPROVED(차변 비용 · 부가세대급금 / 대변 미지급금) · 지급 때 EXPENSE_PAID(차변 미지급금 / 대변 보통예금)
 *     간이영수증(SIMPLE)은 매입세액 공제가 안 되어 부가세 0 · 카드 · 현금영수증 · 세금계산서는 부가세를 적으면 공제 쪽으로
 *   법인카드 — 카드사 「이용 내역」 CSV 를 올리면 머리줄 이름으로 칸을 찾고(이용일 · 가맹점 · 금액 · 승인번호 · 카드) 같은 줄은 한 번
 *     줄마다 계정 · 공제 여부를 고르고 「장부에 넣기」 → 전표 CARD_TXN(차변 계정 · 부가세대급금 / 대변 미지급금(법인카드)) · 음수(취소)는 반대
 *     카드 대금(통장에서 빠져나감)은 ⑪ 은행 맞추기에서 처리 — 여기서는 미지급금(법인카드)에 쌓기까지
 *   전표는 정기 작업 acct_journal(매시간) 또는 「지금 전표 만들기」가 만듭니다.
 * ------------------------------------------------------------------- */

export const CARD_MAX_CHARS = 95_000;
const MAX_ROWS = 3000;
const EVIDENCES = ['CARD', 'CASH', 'SIMPLE', 'TAX_INVOICE'] as const;
export type ExpenseEvidence = typeof EVIDENCES[number];
export const EXPENSE_EV_KO: Record<ExpenseEvidence, string> = { CARD: '카드 영수증(개인 카드)', CASH: '현금영수증(지출 증빙)', SIMPLE: '간이영수증(공제 안 됨)', TAX_INVOICE: '세금계산서' };

const n = (v: unknown) => Number(v ?? 0);
const dr = (role: string, v: number): Line => ({ role, debit: v, credit: 0 } as Line);
const cr = (role: string, v: number): Line => ({ role, debit: 0, credit: v } as Line);
/** 부가세 포함 금액에서 공제할 부가세(÷ 11 · 공급가 반올림과 같은 셈) */
export const vatOf = (total: number) => Math.abs(total) - Math.round(Math.abs(total) / 1.1);

/* ── 전표 규칙 ── */
export const EXPENSE_SOURCES: Source[] = [
  {
    name: 'EXPENSE_APPROVED', label: '경비 청구 승인',
    sql: `SELECT c.id::text AS key, c.decided_at AS at, c.amount::bigint AS amt, c.vat::bigint AS vat, c.account_role AS role, c.evidence AS ev, c.item, a.name AS party
            FROM acct_expense_claims c LEFT JOIN accounts a ON a.id = c.claimant
           WHERE c.state IN ('APPROVED', 'PAID') AND c.decided_at IS NOT NULL AND c.decided_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'EXPENSE_APPROVED' AND e.source_key = c.id::text)
           ORDER BY c.decided_at LIMIT 500`,
    build: (r) => ({ memo: `경비 ${r.item ?? ''}`.trim(), evidence: (r.ev === 'TAX_INVOICE' ? 'TAX_INVOICE' : r.ev) as never,
      lines: [dr(String(r.role ?? 'EXP_ETC'), n(r.amt) - n(r.vat)), ...(n(r.vat) > 0 ? [dr('VAT_IN', n(r.vat))] : []), cr('AP', n(r.amt))] }),
  },
  {
    name: 'EXPENSE_PAID', label: '경비 지급',
    sql: `SELECT c.id::text AS key, c.paid_at AS at, c.amount::bigint AS amt, c.item, a.name AS party
            FROM acct_expense_claims c LEFT JOIN accounts a ON a.id = c.claimant
           WHERE c.state = 'PAID' AND c.paid_at IS NOT NULL AND c.paid_at >= fn_acct_from()
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'EXPENSE_APPROVED' AND e.source_key = c.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'EXPENSE_PAID' AND e.source_key = c.id::text)
           ORDER BY c.paid_at LIMIT 500`,
    build: (r) => ({ memo: `경비 지급 ${r.item ?? ''}`.trim(), evidence: 'NONE', lines: [dr('AP', n(r.amt)), cr('CASH', n(r.amt))] }),
  },
  {
    name: 'CARD_TXN', label: '법인카드 사용',
    sql: `SELECT t.id::text AS key, t.booked_at AS at, t.amount::bigint AS amt, t.vat::bigint AS vat, t.account_role AS role, t.merchant AS party, t.used_on::text AS used
            FROM acct_card_txns t
           WHERE t.state = 'BOOKED' AND t.booked_at IS NOT NULL AND t.used_on >= (fn_acct_from() AT TIME ZONE 'Asia/Seoul')::date
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'CARD_TXN' AND e.source_key = t.id::text)
           ORDER BY t.booked_at LIMIT 500`,
    build: (r) => {
      const amt = Math.abs(n(r.amt)), vat = n(r.vat);
      const ls: Line[] = [dr(String(r.role ?? 'EXP_ETC'), amt - vat), ...(vat > 0 ? [dr('VAT_IN', vat)] : []), cr('CARD_AP', amt)];
      const cancel = n(r.amt) < 0;
      return { memo: `법인카드 ${cancel ? '취소 ' : ''}${r.used ?? ''}`.trim(), evidence: 'CARD' as never,
               lines: cancel ? ls.map((l) => ({ role: l.role, debit: l.credit, credit: l.debit })) : ls };
    },
  },
];

const reasonOk = (r: string | undefined, code: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return t;
};

/** 비용 계정 목록(경비 · 카드 고르기) — 카드는 자산(비품 등)도 */
export async function expenseAccounts(db: DatabaseService) {
  return db.query<{ role: string; name: string; kind: string; extCode: string | null }>(
    `SELECT role, name, kind, ext_code AS "extCode" FROM acct_accounts WHERE kind IN ('EXPENSE', 'ASSET') AND role NOT IN ('CASH', 'PG_RECV', 'AR', 'VAT_IN') ORDER BY kind DESC, sort, role`);
}

/* ── 경비 청구 ── */
export interface ExpenseInput { spentOn: string; accountRole: string; amount: number; vat?: number; evidence: string; item: string; memo?: string; attachments?: string[]; requisitionId?: string }   // v10.417 품의

export async function createExpense(db: DatabaseService, b: ExpenseInput, actor: string) {
  const spent = parseDate(b.spentOn);
  if (!spent) throw new PolicyViolation('ACCT_EXPENSE_INPUT', '쓴 날을 확인해 주십시오.');
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (spent > today) throw new PolicyViolation('ACCT_EXPENSE_INPUT', '앞날짜 경비는 청구할 수 없습니다.');
  if (!(EVIDENCES as readonly string[]).includes(b.evidence)) throw new PolicyViolation('ACCT_EXPENSE_INPUT', '증빙 종류를 골라 주십시오.');
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) throw new PolicyViolation('ACCT_EXPENSE_INPUT', '금액은 1 ~ 1억 원입니다.');
  const vat = b.evidence === 'SIMPLE' ? 0 : Math.max(0, Math.round(Number(b.vat ?? 0)));
  if (vat * 11 > amount + 10) throw new PolicyViolation('ACCT_EXPENSE_INPUT', '부가세가 금액의 11분의 1보다 큽니다.');
  const files = [...new Set((b.attachments ?? []).filter(Boolean))];
  if (files.length > 3) throw new PolicyViolation('TOO_MANY_FILES', '증빙 파일은 3개까지입니다.');
  if (files.some((x) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))) throw new PolicyViolation('FILE_INVALID', '증빙 파일을 확인해 주십시오(본인이 올린 증빙 · 올리기 끝난 것).');
  if (files.length) {
    const ok = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM files WHERE id = ANY($1::uuid[]) AND purpose = 'ACCT_EVIDENCE' AND status = 'READY' AND owner_account_id = $2`, [files, actor]);
    if (ok.length !== files.length) throw new PolicyViolation('FILE_INVALID', '증빙 파일을 확인해 주십시오(본인이 올린 증빙 · 올리기 끝난 것).');
  }
  const [acc] = await db.query(`SELECT 1 FROM acct_accounts WHERE role = $1 AND kind = 'EXPENSE'`, [b.accountRole]);
  if (!acc) throw new PolicyViolation('ACCT_EXPENSE_ROLE', '경비 청구 계정은 비용 계정이어야 합니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_expense_claims (claimant, spent_on, account_role, amount, vat, evidence, item, memo, attachments, requisition_id)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9::uuid[], $10::bigint) RETURNING id::text AS id`,
    [actor, spent, b.accountRole, amount, vat, b.evidence, b.item.trim().slice(0, 100), (b.memo ?? '').trim().slice(0, 400) || null, files,
     /^\d{1,18}$/.test(b.requisitionId ?? '') ? b.requisitionId : null]);
  return { ok: true, id: Number(r.id), note: '경비를 청구했습니다 — SUPER 가 승인하면 전표가 만들어집니다.' };
}

/** 목록 — SUPER · PAYOUT 은 모두, 나머지는 자기 것만 */
export async function listExpenses(db: DatabaseService, actor: string, opt: { state?: string; ym?: string }) {
  const [p] = await db.query<{ all: boolean }>(`SELECT fn_has_role($1::uuid, 'PAYOUT') AS "all"`, [actor]);
  const all = !!p?.all;
  const st = opt.state && ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELED'].includes(opt.state) ? opt.state : null;
  const ym = opt.ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(opt.ym) ? opt.ym : null;
  const items = await db.query(
    `SELECT c.id::text AS id, c.spent_on::text AS "spentOn", c.account_role AS "accountRole", ac.name AS "accountName", c.amount::bigint AS amount, c.vat::bigint AS vat,
            c.evidence, c.item, c.memo, c.attachments::text[] AS attachments, c.state, c.claimant::text AS claimant, a.name AS "claimantName",
            d.name AS "decidedBy", c.decided_at AS "decidedAt", c.reject_reason AS "rejectReason", pb.name AS "paidBy", c.paid_at AS "paidAt", c.created_at AS "createdAt",
            (c.claimant = $1::uuid) AS mine,
            (SELECT e.id::text FROM acct_entries e WHERE e.source = 'EXPENSE_APPROVED' AND e.source_key = c.id::text) AS "entryId"
       FROM acct_expense_claims c JOIN acct_accounts ac ON ac.role = c.account_role
       LEFT JOIN accounts a ON a.id = c.claimant LEFT JOIN accounts d ON d.id = c.decided_by LEFT JOIN accounts pb ON pb.id = c.paid_by
      WHERE ($2::boolean OR c.claimant = $1::uuid) AND ($3::text IS NULL OR c.state = $3) AND ($4::text IS NULL OR to_char(c.spent_on, 'YYYY-MM') = $4)
      ORDER BY (c.state = 'REQUESTED') DESC, c.id DESC LIMIT 300`, [actor, all, st, ym]);
  const [cnt] = await db.query<{ req: number; appr: number; owed: string }>(
    `SELECT count(*) FILTER (WHERE state = 'REQUESTED')::int AS req, count(*) FILTER (WHERE state = 'APPROVED')::int AS appr,
            coalesce(sum(amount) FILTER (WHERE state = 'APPROVED'), 0)::text AS owed
       FROM acct_expense_claims WHERE ($2::boolean OR claimant = $1::uuid)`, [actor, all]);
  const [me] = await db.query<{ sup: boolean }>(`SELECT fn_has_role($1::uuid, 'SUPER') AS sup`, [actor]);
  return { items, all, canDecide: !!me?.sup, canPay: all, accounts: await expenseAccounts(db), evidences: EXPENSE_EV_KO,
           count: { requested: Number(cnt?.req ?? 0), approved: Number(cnt?.appr ?? 0), owed: Number(cnt?.owed ?? 0) },
           note: '승인은 SUPER(본인 청구 불가) · 지급 처리는 지급 담당(본인 불가) · 간이영수증은 부가세 공제가 안 됩니다.' };
}

async function loadClaim(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 경비 청구입니다.');
  const [c] = await db.query<{ id: string; claimant: string; state: string }>(
    `SELECT id::text AS id, claimant::text AS claimant, state FROM acct_expense_claims WHERE id = $1::bigint FOR UPDATE`, [id]);
  if (!c) throw new NotFound('없는 경비 청구입니다.');
  return c;
}

export async function decideExpense(db: DatabaseService, id: string, decision: 'approve' | 'reject', reason: string | undefined, actor: string) {
  return db.transaction(async () => {
    const c = await loadClaim(db, id);
    if (c.claimant === actor) throw new PolicyViolation('EXPENSE_SELF', '본인 경비 청구는 승인 · 반려할 수 없습니다.');
    if (c.state !== 'REQUESTED') throw new StateConflict('ACCT_EXPENSE_STATE', '청구 상태인 것만 승인 · 반려합니다.');
    if (decision === 'reject') {
      const why = reasonOk(reason, 'ACCT_REASON');
      await db.query(`UPDATE acct_expense_claims SET state = 'REJECTED', decided_by = $2, decided_at = now(), reject_reason = $3 WHERE id = $1::bigint`, [id, actor, why]);
      await recordFinal(db, 'EXPENSE', id, actor, false, why);   // v10.424 (D253)
      return { ok: true, id: Number(id), state: 'REJECTED', note: '반려했습니다.' };
    }
    await assertStepsDone(db, 'EXPENSE', id);   // v10.424 (D253) — 결재선이 있으면 앞 단계가 끝나야 승인
    await db.query(`UPDATE acct_expense_claims SET state = 'APPROVED', decided_by = $2, decided_at = now() WHERE id = $1::bigint`, [id, actor]);
    await recordFinal(db, 'EXPENSE', id, actor, true);
    return { ok: true, id: Number(id), state: 'APPROVED', note: '승인했습니다 — 다음 전표 작업(매시간 · 「지금 전표 만들기」)에서 전표가 만들어집니다.' };
  });
}

export async function payExpense(db: DatabaseService, id: string, actor: string) {
  return db.transaction(async () => {
    const c = await loadClaim(db, id);
    if (c.claimant === actor) throw new PolicyViolation('EXPENSE_SELF', '본인 경비는 본인이 지급 처리할 수 없습니다.');
    if (c.state !== 'APPROVED') throw new StateConflict('ACCT_EXPENSE_STATE', '승인된 것만 지급 처리합니다.');
    await db.query(`UPDATE acct_expense_claims SET state = 'PAID', paid_by = $2, paid_at = now() WHERE id = $1::bigint`, [id, actor]);
    return { ok: true, id: Number(id), state: 'PAID', note: '지급 처리했습니다 — 통장 출금은 은행 맞추기에서 이 전표와 맞춥니다.' };
  });
}

export async function cancelExpense(db: DatabaseService, id: string, actor: string) {
  return db.transaction(async () => {
    const c = await loadClaim(db, id);
    if (c.claimant !== actor) throw new PolicyViolation('ACCT_EXPENSE_OWNER', '본인 청구만 취소할 수 있습니다.');
    if (c.state !== 'REQUESTED') throw new StateConflict('ACCT_EXPENSE_STATE', '청구 상태인 것만 취소합니다.');
    await db.query(`UPDATE acct_expense_claims SET state = 'CANCELED', canceled_at = now() WHERE id = $1::bigint`, [id]);
    return { ok: true, id: Number(id), state: 'CANCELED', note: '취소했습니다.' };
  });
}

/* ── 법인카드 CSV ── */
type CField = 'date' | 'merchant' | 'amount' | 'approval' | 'card' | 'cancel';
const CHEADS: Record<CField, RegExp[]> = {
  date: [/^이용\s*일(자|시)?$/, /이용\s*일/, /승인\s*일/, /거래\s*일/, /^일자$/, /날짜/, /^date$/i],
  merchant: [/가맹점\s*명?/, /이용\s*(처|하신\s*곳)/, /상호/, /^merchant/i],
  amount: [/이용\s*금액/, /승인\s*금액/, /결제\s*(예정\s*)?금액/, /^금액$/, /amount/i],
  approval: [/승인\s*번호/, /^approval/i],
  card: [/카드\s*번호/, /^카드$/, /card/i],
  cancel: [/취소\s*(여부|구분)?/, /^구분$/, /상태/],
};
function findCardColumns(rows: string[][]) {
  for (let h = 0; h < Math.min(15, rows.length); h++) {
    const names = rows[h].map((c) => c.trim());
    const col: Partial<Record<CField, number>> = {}; const used = new Set<number>();
    for (const f of ['date', 'approval', 'merchant', 'amount', 'card', 'cancel'] as CField[]) {
      for (const re of CHEADS[f]) {
        const i = names.findIndex((nm, k) => !used.has(k) && re.test(nm));
        if (i >= 0) { col[f] = i; used.add(i); break; }
      }
    }
    if (col.date != null && col.amount != null) return { head: h, col };
  }
  return null;
}
const money = (v: string | undefined) => {
  const t = (v ?? '').replace(/[,\s원₩]/g, '');
  if (!t || t === '-') return NaN;
  return /^-?\d+(\.\d+)?$/.test(t) ? Math.round(Number(t)) : NaN;
};

export interface CardRow { date: string; merchant: string | null; amount: number; approval: string | null; tail: string | null; hash: string }
export function readCardCsv(text: string) {
  const all = parseCsv(text);
  const found = findCardColumns(all);
  if (!found) throw new PolicyViolation('CARD_CSV_HEAD', '머리줄을 찾지 못했습니다 — 이용일 · 이용 금액 칸 이름이 있는 CSV 를 올려 주십시오.');
  const { head, col } = found;
  const seen = new Map<string, number>(); const rows: CardRow[] = []; let bad = 0;
  for (const r of all.slice(head + 1)) {
    const date = parseDate(r[col.date!]);
    let amt = money(r[col.amount!]);
    if (!date || Number.isNaN(amt) || amt === 0) { bad++; continue; }
    if (col.cancel != null && /취소/.test(r[col.cancel] ?? '') && amt > 0) amt = -amt;
    const merchant = col.merchant != null ? (r[col.merchant] ?? '').trim().slice(0, 120) || null : null;
    const approval = col.approval != null ? (r[col.approval] ?? '').trim().slice(0, 40) || null : null;
    const tail = col.card != null ? ((r[col.card] ?? '').replace(/[^0-9*]/g, '').slice(-4) || null) : null;
    const base = [date, merchant ?? '', amt, approval ?? '', tail ?? ''].join('|');
    const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
    rows.push({ date, merchant, amount: amt, approval, tail, hash: createHash('sha256').update(`card|${base}|${k}`).digest('hex') });
    if (rows.length > MAX_ROWS) throw new PolicyViolation('CARD_CSV_TOO_MANY', `한 번에 ${MAX_ROWS}줄까지입니다 — 기간을 나눠 올려 주십시오.`);
  }
  return { rows, bad, head: col };
}

export async function uploadCard(db: DatabaseService, csv: string, filename: string | null, card: string | null, actor: string | null) {
  if (!csv || csv.length > CARD_MAX_CHARS) throw new PolicyViolation('CARD_CSV_SIZE', `CSV 는 1 ~ ${CARD_MAX_CHARS.toLocaleString('ko-KR')}자입니다 — 크면 기간을 나눠 올려 주십시오.`);
  const { rows, bad, head } = readCardCsv(csv);
  if (!rows.length) throw new PolicyViolation('CARD_CSV_EMPTY', `읽은 이용 내역이 없습니다(못 읽은 줄 ${bad}) — 날짜 · 금액 칸을 확인해 주십시오.`);
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_card_upload'))`);
    const [had] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_card_txns WHERE row_hash = ANY($1::text[])`, [rows.map((r) => r.hash)]);
    const dup = Number(had?.n ?? 0);
    const [u] = await db.query<{ id: string }>(
      `INSERT INTO acct_card_uploads (filename, card, rows_total, rows_added, rows_dup, rows_bad, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
      [filename?.slice(0, 200) || null, card?.slice(0, 40) || null, rows.length, rows.length - dup, dup, bad, actor]);
    const added = await db.query<{ id: string }>(
      `INSERT INTO acct_card_txns (upload_id, used_on, merchant, amount, approval_no, card_tail, row_hash)
       SELECT $1::bigint, x.date::date, x.merchant, x.amount, x.approval, x.tail, x.hash
         FROM jsonb_to_recordset($2::jsonb) AS x(date text, merchant text, amount bigint, approval text, tail text, hash text)
       ON CONFLICT (row_hash) DO NOTHING RETURNING id::text AS id`, [u.id, JSON.stringify(rows)]);
    return { uploadId: Number(u.id), total: rows.length, added: added.length, dup: rows.length - added.length, bad, columns: head,
             note: `이용 ${rows.length}줄 중 새로 ${added.length} · 이미 있음 ${rows.length - added.length}${bad ? ` · 못 읽음 ${bad}` : ''}.` };
  });
}

export async function cardMonth(db: DatabaseService, ym: string) {
  const items = await db.query(
    `SELECT t.id::text AS id, t.used_on::text AS "usedOn", t.merchant, t.amount::bigint AS amount, t.approval_no AS "approvalNo", t.card_tail AS "cardTail",
            t.state, t.account_role AS "accountRole", a.name AS "accountName", t.deductible, t.vat::bigint AS vat, t.note, t.booked_at AS "bookedAt", b.name AS "bookedBy",
            (SELECT e.id::text FROM acct_entries e WHERE e.source = 'CARD_TXN' AND e.source_key = t.id::text) AS "entryId"
       FROM acct_card_txns t LEFT JOIN acct_accounts a ON a.role = t.account_role LEFT JOIN accounts b ON b.id = t.booked_by
      WHERE to_char(t.used_on, 'YYYY-MM') = $1 ORDER BY t.used_on, t.id LIMIT 3000`, [ym]);
  const count = { total: items.length, open: 0, booked: 0, ignored: 0, sum: 0 };
  for (const t of items as Array<{ state: string; amount: string | number }>) {
    if (t.state === 'OPEN') count.open++; else if (t.state === 'BOOKED') count.booked++; else count.ignored++;
    count.sum += Number(t.amount);
  }
  const uploads = await db.query(
    `SELECT u.id::text AS id, u.filename, u.card, u.rows_total AS total, u.rows_added AS added, u.rows_dup AS dup, u.rows_bad AS bad, a.name AS "uploadedBy", u.created_at AS "createdAt"
       FROM acct_card_uploads u LEFT JOIN accounts a ON a.id = u.uploaded_by ORDER BY u.id DESC LIMIT 10`);
  const [owed] = await db.query<{ v: string }>(
    `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS v FROM acct_lines l WHERE l.role = 'CARD_AP'`);
  return { ym, items, count, uploads, accounts: await expenseAccounts(db), cardPayable: Number(owed?.v ?? 0),
           note: '줄마다 계정 · 공제 여부를 고르고 「장부에 넣기」. 카드 대금(통장 출금)은 은행 맞추기에서 처리합니다. 간이과세자 · 면세 가맹점 · 접대비는 공제하지 않습니다.' };
}

export async function bookCard(db: DatabaseService, id: string, b: { accountRole?: string; deductible?: boolean; ignore?: boolean; note?: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 카드 이용 줄입니다.');
  return db.transaction(async () => {
    const [t] = await db.query<{ amount: string; state: string }>(`SELECT amount::text AS amount, state FROM acct_card_txns WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!t) throw new NotFound('없는 카드 이용 줄입니다.');
    if (t.state === 'BOOKED') throw new StateConflict('ACCT_CARD_BOOKED', '장부에 넣은 줄은 바꾸지 않습니다(바로잡기는 수동 전표).');
    if (b.ignore) {
      const why = reasonOk(b.note, 'ACCT_REASON');
      await db.query(`UPDATE acct_card_txns SET state = 'IGNORED', note = $2, booked_by = $3, booked_at = now() WHERE id = $1::bigint`, [id, why, actor]);
      return { ok: true, id: Number(id), state: 'IGNORED', note: '장부에 넣지 않음으로 두었습니다.' };
    }
    const [acc] = await db.query(`SELECT 1 FROM acct_accounts WHERE role = $1 AND kind IN ('EXPENSE', 'ASSET')`, [b.accountRole ?? '']);
    if (!acc) throw new PolicyViolation('ACCT_CARD_ROLE', '카드 이용은 비용 또는 자산 계정으로만 넣습니다.');
    const vat = b.deductible ? vatOf(Number(t.amount)) : 0;
    await db.query(
      `UPDATE acct_card_txns SET state = 'BOOKED', account_role = $2, deductible = $3, vat = $4, note = nullif($5, ''), booked_by = $6, booked_at = now() WHERE id = $1::bigint`,
      [id, b.accountRole, !!b.deductible, vat, (b.note ?? '').trim().slice(0, 200), actor]);
    return { ok: true, id: Number(id), state: 'BOOKED', vat, note: '장부에 넣었습니다 — 다음 전표 작업에서 전표가 만들어집니다.' };
  });
}
