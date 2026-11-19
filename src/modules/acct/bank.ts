import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.388 (D244 · docs/525) 은행 거래 내역 맞추기
 *   통장 거래 내역 CSV(은행 인터넷뱅킹 「거래내역 조회 → 엑셀 · CSV 저장」)를 올리면
 *   ① 머리줄 이름으로 칸을 찾고(거래일 · 입금 · 출금 · 잔액 · 내용 · 메모) ② 같은 줄은 한 번만 넣고
 *   ③ 전표의 보통예금(CASH) 줄과 금액이 같고 날짜가 ±N일(acct.bank_match_days) 안인 것을 후보로 보여 줍니다(이름이 비슷하면 위로).
 *   맞춤은 사람이 고르거나(「맞춤」) 후보가 하나뿐이고 이름도 맞는 것만 「자동 맞춤」. 맞출 것이 없는 줄(이자 · 수수료 등)은 「맞출 것 없음」 + 사유.
 *   은행마다 머리줄이 달라 처음은 일반 형식 — 대표가 은행 예시 한 줄을 주면 이름을 더합니다.
 * ------------------------------------------------------------------- */

export const BANK_MAX_CHARS = 95_000;   // Nest 본문 한도(100kb) 안 — 넘으면 기간을 나눠 올림
const MAX_ROWS = 3000;

type Field = 'date' | 'deposit' | 'withdraw' | 'balance' | 'counterparty' | 'memo';
/* 머리줄 이름 — 앞에 있는 이름일수록 먼저(은행 예시를 받으면 여기 더함) */
const HEADS: Record<Field, RegExp[]> = {
  date: [/^거래\s*일(자|시)?$/, /거래\s*일/, /^일자$/, /날짜/, /^date$/i],
  deposit: [/입금\s*(액|금액)?/, /맡기신/, /받으신/, /^deposit/i, /credit/i],
  withdraw: [/출금\s*(액|금액)?/, /찾으신/, /지급\s*(액|금액)/, /^withdraw/i, /debit/i],
  balance: [/잔액/, /balance/i],
  counterparty: [/의뢰인|보낸\s*분|받는\s*분|입금자|송금인/, /상대/, /기재\s*내용/, /거래\s*내용/, /^내용$/, /거래처/],
  memo: [/메모/, /비고/, /적요/, /^memo/i],
};

/** 따옴표 · 쉼표 · 줄바꿈을 지키는 CSV 읽기(엑셀 저장 CSV) */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) rows.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** 머리줄(처음 15줄 안 · 날짜 칸과 입금 또는 출금 칸이 있는 줄)과 칸 번호 */
export function findColumns(rows: string[][]): { head: number; col: Partial<Record<Field, number>> } | null {
  for (let h = 0; h < Math.min(15, rows.length); h++) {
    const names = rows[h].map((c) => c.trim());
    const col: Partial<Record<Field, number>> = {};
    const used = new Set<number>();
    for (const f of ['date', 'deposit', 'withdraw', 'balance', 'counterparty', 'memo'] as Field[]) {
      for (const re of HEADS[f]) {
        const i = names.findIndex((nm, k) => !used.has(k) && re.test(nm));
        if (i >= 0) { col[f] = i; used.add(i); break; }
      }
    }
    if (col.date != null && (col.deposit != null || col.withdraw != null)) return { head: h, col };
  }
  return null;
}

const money = (v: string | undefined) => {
  const t = (v ?? '').replace(/[,\s원₩]/g, '');
  if (!t || t === '-') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t));
};
export function parseDate(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  let m = t.match(/^(\d{4})[-./ ]?(\d{1,2})[-./ ]?(\d{1,2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface BankRow { date: string; deposit: number; withdraw: number; balance: number | null; counterparty: string | null; memo: string | null; hash: string }

/** CSV → 거래 줄(못 읽은 줄 수 따로) · 같은 내용이 한 파일에 여러 번이면 순번을 섞어 따로 셈 */
export function readBankCsv(text: string): { rows: BankRow[]; bad: number; head: Partial<Record<Field, number>> } {
  const all = parseCsv(text);
  const found = findColumns(all);
  if (!found) throw new PolicyViolation('BANK_CSV_HEAD', '머리줄을 찾지 못했습니다 — 거래일 · 입금(또는 출금) 칸 이름이 있는 CSV 를 올려 주십시오.');
  const { head, col } = found;
  const seen = new Map<string, number>();
  const rows: BankRow[] = []; let bad = 0;
  for (const r of all.slice(head + 1)) {
    const date = parseDate(r[col.date!]);
    const dep = col.deposit != null ? money(r[col.deposit]) : 0;
    const wd = col.withdraw != null ? money(r[col.withdraw]) : 0;
    const bal = col.balance != null ? money(r[col.balance]) : NaN;
    if (!date || Number.isNaN(dep) || Number.isNaN(wd) || (dep > 0) === (wd > 0) || dep < 0 || wd < 0) { bad++; continue; }
    const cp = col.counterparty != null ? (r[col.counterparty] ?? '').trim().slice(0, 120) || null : null;
    const memo = col.memo != null ? (r[col.memo] ?? '').trim().slice(0, 200) || null : null;
    const base = [date, dep, wd, Number.isNaN(bal) ? '' : bal, cp ?? '', memo ?? ''].join('|');
    const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
    rows.push({ date, deposit: dep, withdraw: wd, balance: Number.isNaN(bal) ? null : bal, counterparty: cp, memo,
                hash: createHash('sha256').update(`${base}|${k}`).digest('hex') });
    if (rows.length > MAX_ROWS) throw new PolicyViolation('BANK_CSV_TOO_MANY', `한 번에 ${MAX_ROWS}줄까지입니다 — 기간을 나눠 올려 주십시오.`);
  }
  return { rows, bad, head: col };
}

export async function uploadBank(db: DatabaseService, csv: string, filename: string | null, bank: string | null, actor: string | null) {
  if (!csv || csv.length > BANK_MAX_CHARS) throw new PolicyViolation('BANK_CSV_SIZE', `CSV 는 1 ~ ${BANK_MAX_CHARS.toLocaleString('ko-KR')}자입니다 — 크면 기간을 나눠 올려 주십시오.`);
  const { rows, bad, head } = readBankCsv(csv);
  if (!rows.length) throw new PolicyViolation('BANK_CSV_EMPTY', `읽은 거래가 없습니다(못 읽은 줄 ${bad}) — 날짜 · 금액 칸을 확인해 주십시오.`);
  return db.transaction(async () => {
    /* 올린 기록은 쌓기만이라 줄 수를 먼저 셉니다 — 동시에 두 번 올려도 셈이 맞게 한 번에 하나만 */
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_bank_upload'))`);
    const [had] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_bank_txns WHERE row_hash = ANY($1::text[])`, [rows.map((r) => r.hash)]);
    const dup = Number(had?.n ?? 0);
    const [u] = await db.query<{ id: string }>(
      `INSERT INTO acct_bank_uploads (filename, bank, rows_total, rows_added, rows_dup, rows_bad, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
      [filename?.slice(0, 200) || null, bank?.slice(0, 40) || null, rows.length, rows.length - dup, dup, bad, actor]);
    const added = await db.query<{ id: string }>(
      `INSERT INTO acct_bank_txns (upload_id, tx_date, deposit, withdraw, balance, counterparty, memo, row_hash)
       SELECT $1::bigint, x.date::date, x.deposit, x.withdraw, x.balance, x.counterparty, x.memo, x.hash
         FROM jsonb_to_recordset($2::jsonb) AS x(date text, deposit bigint, withdraw bigint, balance bigint, counterparty text, memo text, hash text)
       ON CONFLICT (row_hash) DO NOTHING RETURNING id::text AS id`, [u.id, JSON.stringify(rows)]);
    return { uploadId: Number(u.id), total: rows.length, added: added.length, dup: rows.length - added.length, bad, columns: head,
             note: `거래 ${rows.length}줄 중 새로 ${added.length} · 이미 있음 ${rows.length - added.length} · 못 읽음 ${bad}.` };   // v10.419 늘 같은 모양(번역 틀)
  });
}

/** 이름 견주기 — 띄어쓰기 · (주) · 주식회사 · 기호를 빼고 한쪽이 다른 쪽을 품으면 같다고 봄 */
export const normName = (v: unknown) => String(v ?? '').toLowerCase().replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|[\s().,·\-_/]/g, '');
export const nameLike = (a: unknown, b: unknown) => {
  const x = normName(a), y = normName(b);
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
};

export interface Txn { id: string; date: string; deposit: number; withdraw: number; balance: number | null; counterparty: string | null; memo: string | null;
  matchKind: string | null; entryId: string | null; matchNote: string | null; matchedAt: string | null }
export interface Cand { entryId: string; date: string; source: string; memo: string | null; party: string | null; amount: number; side: 'D' | 'C' }

async function matchDays(db: DatabaseService) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.bank_match_days'`);
  const d = Number(r?.v ?? 3);
  return Number.isInteger(d) && d >= 1 && d <= 14 ? d : 3;
}

/** 아직 맞추지 않은 보통예금 줄(전표) — 날짜 범위 안 */
async function openCash(db: DatabaseService, from: string, to: string): Promise<Cand[]> {
  const rows = await db.query<any>(
    `SELECT e.id::text AS "entryId", e.entry_date::text AS date, e.source, e.memo, e.party,
            CASE WHEN l.debit > 0 THEN l.debit ELSE l.credit END::bigint AS amount, CASE WHEN l.debit > 0 THEN 'D' ELSE 'C' END AS side
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id AND l.role = 'CASH'
      WHERE e.entry_date BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM acct_bank_txns t WHERE t.entry_id = e.id)
      ORDER BY e.entry_date, e.id LIMIT 3000`, [from, to]);
  return rows.map((r: any) => ({ ...r, amount: Number(r.amount) }));
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400e3;

/** 한 줄의 후보 — 같은 방향 · 같은 금액 · 날짜 ±days · 이름이 비슷하면 위로 */
function candidates(t: Txn, pool: Cand[], days: number) {
  const amt = t.deposit > 0 ? t.deposit : t.withdraw, side = t.deposit > 0 ? 'D' : 'C';
  return pool.filter((c) => c.side === side && c.amount === amt && dayDiff(c.date, t.date) <= days)
    .map((c) => ({ ...c, nameOk: nameLike(c.party ?? c.memo, t.counterparty ?? t.memo), days: dayDiff(c.date, t.date) }))
    .sort((a, b) => Number(b.nameOk) - Number(a.nameOk) || a.days - b.days)
    .slice(0, 5);
}

const ymRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const shift = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);

/** GET /admin/acct/bank?ym= — 그 달 통장 줄 · 후보 · 장부에만 있는 보통예금 줄 · 마지막 잔액 */
export async function bankMonth(db: DatabaseService, ym: string) {
  const { from, to } = ymRange(ym);
  const days = await matchDays(db);
  const txns = (await db.query<any>(
    `SELECT t.id::text AS id, t.tx_date::text AS date, t.deposit::bigint AS deposit, t.withdraw::bigint AS withdraw, t.balance::bigint AS balance,
            t.counterparty, t.memo, t.match_kind AS "matchKind", t.entry_id::text AS "entryId", t.match_note AS "matchNote", t.matched_at AS "matchedAt"
       FROM acct_bank_txns t WHERE t.tx_date BETWEEN $1::date AND $2::date ORDER BY t.tx_date, t.id LIMIT 3000`, [from, to]))
    .map((r: any) => ({ ...r, deposit: Number(r.deposit), withdraw: Number(r.withdraw), balance: r.balance == null ? null : Number(r.balance) })) as Txn[];
  const pool = await openCash(db, shift(from, -days), shift(to, days));
  const items = txns.map((t) => ({ ...t, candidates: t.matchKind ? [] : candidates(t, pool, days) }));
  const bookOnly = pool.filter((c) => c.date >= from && c.date <= to);
  const [bal] = await db.query<any>(
    `SELECT tx_date::text AS date, balance::bigint AS balance FROM acct_bank_txns WHERE balance IS NOT NULL ORDER BY tx_date DESC, id DESC LIMIT 1`);
  const uploads = await db.query(
    `SELECT id::text AS id, filename, bank, rows_total AS total, rows_added AS added, rows_dup AS dup, rows_bad AS bad, created_at AS "createdAt" FROM acct_bank_uploads ORDER BY id DESC LIMIT 10`);
  return {
    ym, days, items, bookOnly: bookOnly.slice(0, 300), uploads,
    count: { total: items.length, open: items.filter((x) => !x.matchKind).length, matched: items.filter((x) => x.matchKind === 'ENTRY').length,
             ignored: items.filter((x) => x.matchKind === 'IGNORE').length, autoReady: items.filter((x) => !x.matchKind && x.candidates.length === 1 && x.candidates[0].nameOk).length,
             bookOnly: bookOnly.length },
    lastBalance: bal ? { date: bal.date, balance: Number(bal.balance) } : null,
    note: `통장 줄과 전표의 보통예금 줄을 금액 · 날짜(±${days}일) · 이름으로 견줍니다. 「장부에만 있음」은 전표에는 있는데 통장에 아직 없는 줄입니다.`,
  };
}

/** POST /admin/acct/bank/{id}/match — 전표 하나와 맞춤(entryId) · 맞출 것 없음(ignore + 사유) · 풀기(clear) */
export async function bankMatch(db: DatabaseService, id: string, body: { entryId?: string; ignore?: boolean; clear?: boolean; note?: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('통장 거래 줄이 없습니다.');
  const [t] = await db.query<{ match_kind: string | null }>(`SELECT match_kind FROM acct_bank_txns WHERE id = $1::bigint`, [id]);
  if (!t) throw new NotFound('통장 거래 줄이 없습니다.');
  const note = (body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (body.clear) {
    if (note.length < 2) throw new PolicyViolation('BANK_REASON', '맞춤을 풀 때는 사유를 2자 이상 적어 주십시오.');
    await db.query(`UPDATE acct_bank_txns SET match_kind = NULL, entry_id = NULL, match_note = $2, matched_by = $3, matched_at = NULL WHERE id = $1::bigint`, [id, `풀기: ${note}`.slice(0, 200), actor]);
    return { ok: true, id, matchKind: null, note: '맞춤을 풀었습니다.' };
  }
  if (t.match_kind) throw new StateConflict('BANK_MATCHED', '이미 맞춘 줄입니다 — 먼저 풀어 주십시오.');
  if (body.ignore) {
    if (note.length < 2) throw new PolicyViolation('BANK_REASON', '맞출 것 없음은 사유(예: 예금 이자 · 이체 수수료)를 2자 이상 적어 주십시오.');
    await db.query(`UPDATE acct_bank_txns SET match_kind = 'IGNORE', match_note = $2, matched_by = $3, matched_at = now() WHERE id = $1::bigint`, [id, note, actor]);
    return { ok: true, id, matchKind: 'IGNORE', note: '맞출 것 없음으로 두었습니다.' };
  }
  if (!/^\d{1,18}$/.test(body.entryId ?? '')) throw new PolicyViolation('BANK_ENTRY', '맞출 전표 번호를 골라 주십시오.');
  const [used] = await db.query(`SELECT 1 FROM acct_bank_txns WHERE entry_id = $1::bigint`, [body.entryId]);
  if (used) throw new StateConflict('BANK_ENTRY_USED', '그 전표는 이미 다른 통장 줄과 맞췄습니다.');
  await db.query(`UPDATE acct_bank_txns SET match_kind = 'ENTRY', entry_id = $2::bigint, match_note = nullif($3, ''), matched_by = $4, matched_at = now() WHERE id = $1::bigint`,
    [id, body.entryId, note, actor]);
  return { ok: true, id, matchKind: 'ENTRY', entryId: body.entryId, note: `전표 ${body.entryId} 와 맞췄습니다.` };
}

/** POST /admin/acct/bank/auto-match?ym= — 후보가 하나뿐이고 이름도 맞는 줄만 */
export async function bankAutoMatch(db: DatabaseService, ym: string, actor: string | null) {
  const m = await bankMonth(db, ym);
  const used = new Set<string>(); let done = 0; const skipped: string[] = [];
  for (const t of m.items) {
    if (t.matchKind || t.candidates.length !== 1 || !t.candidates[0].nameOk) continue;
    const c = t.candidates[0];
    if (used.has(c.entryId)) { skipped.push(t.id); continue; }
    try {
      await db.query(`UPDATE acct_bank_txns SET match_kind = 'ENTRY', entry_id = $2::bigint, match_note = '자동 맞춤', matched_by = $3, matched_at = now() WHERE id = $1::bigint AND match_kind IS NULL`,
        [t.id, c.entryId, actor]);
      used.add(c.entryId); done++;
    } catch { skipped.push(t.id); }
  }
  return { ok: true, ym, matched: done, skipped: skipped.length, note: `자동으로 ${done}줄 맞췄습니다(후보가 하나이고 이름도 같은 줄만).` };
}
