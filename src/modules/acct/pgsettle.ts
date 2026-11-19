import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { nameLike, parseCsv, parseDate } from './bank';
import type { Line, Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.404 (D248 · docs/541) PG 정산 맞추기
 *   PG 사 가맹점 관리자 「정산 내역 → 엑셀(CSV) 저장」을 올리면
 *   ① 머리줄 이름으로 칸을 찾고(결제일 · 정산일 · 결제 금액 · 수수료 · 수수료 부가세 · 입금액 · 거래 번호) ② 같은 줄은 한 번만 넣고
 *   ③ 결제 한 건마다 전표의 「PG 정산 받을 돈」(PG_RECV) 줄과 같은 금액 · 결제일 ±N일(acct.pg_match_days) 후보를 보여 줍니다.
 *   맞춘 줄은 정기 작업 acct_journal 이 전표 PG_SETTLE 로 넣습니다:
 *     차변 보통예금(입금액) · 지급수수료(수수료 − 부가세) · 부가세대급금(수수료 부가세) / 대변 PG 정산 받을 돈(결제 금액) — 취소 줄은 반대.
 *   맞출 것 없음(시작일 전 결제 · 시험 결제 등 · 사유) 줄은 전표를 만들지 않습니다.
 *   PG 정산 받을 돈 전표가 acct.pg_unsettled_days 지나도 맞지 않으면 운영 알림 ACCT_PG_UNSETTLED(정기 작업 acct_pg_check).
 *   PG 사마다 머리줄이 달라 처음은 일반 형식 — 대표가 PG 이름 · 예시 한 줄을 주면 이름을 더합니다.
 * ------------------------------------------------------------------- */

export const PG_MAX_CHARS = 95_000;
const MAX_ROWS = 3000;

type PgField = 'paid' | 'settle' | 'gross' | 'fee' | 'feeVat' | 'net' | 'key' | 'method';
/* 앞에 있는 이름일수록 먼저 — 「수수료 부가세」를 「수수료」보다 먼저 찾음 */
const ORDER: PgField[] = ['feeVat', 'settle', 'paid', 'gross', 'fee', 'net', 'key', 'method'];
const HEADS: Record<PgField, RegExp[]> = {
  paid: [/^(승인|결제|거래)\s*(일자|일시|일)$/, /승인\s*일/, /결제\s*일/, /거래\s*일/, /^paid/i, /approv/i],
  settle: [/^(정산|입금|지급)\s*(예정)?\s*(일자|일)$/, /정산\s*일/, /입금\s*(예정)?\s*일/, /지급\s*일/, /settle/i, /deposit\s*date/i],
  gross: [/^(결제|승인|거래)\s*(금액|액)$/, /결제\s*금액/, /승인\s*금액/, /거래\s*금액/, /매출\s*금액/, /^amount$/i, /gross/i],
  feeVat: [/수수료\s*(부가세|vat)/i, /부가세/, /^vat$/i],
  fee: [/^(pg\s*)?수수료(\s*합계)?$/i, /수수료/, /^fee/i],
  net: [/^(정산|입금|지급)\s*(금액|액)$/, /정산\s*금액/, /입금\s*(액|금액)/, /지급\s*(액|금액)/, /^net/i],
  key: [/거래\s*번호|tid/i, /주문\s*번호/, /승인\s*번호/, /order/i],
  method: [/결제\s*수단/, /수단/, /method/i],
};

export function findPgColumns(rows: string[][]): { head: number; col: Partial<Record<PgField, number>> } | null {
  for (let h = 0; h < Math.min(15, rows.length); h++) {
    const names = rows[h].map((c) => c.trim());
    const col: Partial<Record<PgField, number>> = {};
    const used = new Set<number>();
    for (const f of ORDER) {
      for (const re of HEADS[f]) {
        const i = names.findIndex((nm, k) => !used.has(k) && re.test(nm));
        if (i >= 0) { col[f] = i; used.add(i); break; }
      }
    }
    if (col.paid != null && col.gross != null && (col.fee != null || col.net != null)) return { head: h, col };
  }
  return null;
}

const money = (v: string | undefined) => {
  const t = (v ?? '').replace(/[,\s원₩]/g, '');
  if (!t || t === '-') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t));
};

export interface PgRow { paidOn: string; settleOn: string; gross: number; fee: number; feeVat: number; net: number; key: string | null; method: string | null; hash: string }

/** CSV → 정산 줄 — 수수료가 없으면 결제 금액 − 입금액 · 입금액이 없으면 결제 금액 − 수수료 · 정산일이 없으면 결제일 */
export function readPgCsv(text: string): { rows: PgRow[]; bad: number; head: Partial<Record<PgField, number>> } {
  const all = parseCsv(text);
  const found = findPgColumns(all);
  if (!found) throw new PolicyViolation('PG_CSV_HEAD', '머리줄을 찾지 못했습니다 — 결제일 · 결제 금액 · 수수료(또는 입금액) 칸 이름이 있는 CSV 를 올려 주십시오.');
  const { head, col } = found;
  const seen = new Map<string, number>();
  const rows: PgRow[] = []; let bad = 0;
  for (const r of all.slice(head + 1)) {
    if (!r.some((c) => c.trim())) continue;
    const paidOn = parseDate(r[col.paid!]);
    const settleOn = col.settle != null ? parseDate(r[col.settle]) : paidOn;
    const gross = money(r[col.gross!]);
    let fee = col.fee != null ? money(r[col.fee]) : NaN;
    let net = col.net != null ? money(r[col.net]) : NaN;
    if (Number.isNaN(fee) && !Number.isNaN(net)) fee = gross - net;
    if (Number.isNaN(net) && !Number.isNaN(fee)) net = gross - fee;
    const feeVat = col.feeVat != null ? money(r[col.feeVat]) : 0;
    if (!paidOn || !settleOn || Number.isNaN(gross) || gross === 0 || Number.isNaN(fee) || Number.isNaN(net) || Number.isNaN(feeVat)
        || net !== gross - fee || Math.abs(feeVat) > Math.abs(fee)) { bad++; continue; }
    const key = col.key != null ? (r[col.key] ?? '').trim().slice(0, 80) || null : null;
    const method = col.method != null ? (r[col.method] ?? '').trim().slice(0, 40) || null : null;
    const base = [paidOn, settleOn, gross, fee, feeVat, net, key ?? ''].join('|');
    const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
    rows.push({ paidOn, settleOn, gross, fee, feeVat, net, key, method, hash: createHash('sha256').update(`pg|${base}|${k}`).digest('hex') });
    if (rows.length > MAX_ROWS) throw new PolicyViolation('PG_CSV_TOO_MANY', `한 번에 ${MAX_ROWS}줄까지입니다 — 기간을 나눠 올려 주십시오.`);
  }
  return { rows, bad, head: col };
}

/** POST /admin/acct/pg/upload */
export async function uploadPg(db: DatabaseService, csv: string, filename: string | null, pgName: string | null, actor: string | null) {
  if (!csv || csv.length > PG_MAX_CHARS) throw new PolicyViolation('PG_CSV_SIZE', `CSV 는 1 ~ ${PG_MAX_CHARS.toLocaleString('ko-KR')}자입니다 — 크면 기간을 나눠 올려 주십시오.`);
  const { rows, bad, head } = readPgCsv(csv);
  if (!rows.length) throw new PolicyViolation('PG_CSV_EMPTY', `읽은 정산 줄이 없습니다(못 읽은 줄 ${bad}) — 날짜 · 금액 칸을 확인해 주십시오.`);
  const res = await db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_pg_upload'))`);
    const [had] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_pg_txns WHERE row_hash = ANY($1::text[])`, [rows.map((r) => r.hash)]);
    const dup = Number(had?.n ?? 0);
    const [u] = await db.query<{ id: string }>(
      `INSERT INTO acct_pg_uploads (filename, pg_name, rows_total, rows_added, rows_dup, rows_bad, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
      [filename?.slice(0, 200) || null, pgName?.slice(0, 40) || null, rows.length, rows.length - dup, dup, bad, actor]);
    const added = await db.query<{ id: string }>(
      `INSERT INTO acct_pg_txns (upload_id, paid_on, settle_on, gross, fee, fee_vat, net, pg_key, method, row_hash)
       SELECT $1::bigint, x."paidOn"::date, x."settleOn"::date, x.gross, x.fee, x."feeVat", x.net, x.key, x.method, x.hash
         FROM jsonb_to_recordset($2::jsonb) AS x("paidOn" text, "settleOn" text, gross bigint, fee bigint, "feeVat" bigint, net bigint, key text, method text, hash text)
       ON CONFLICT (row_hash) DO NOTHING RETURNING id::text AS id`, [u.id, JSON.stringify(rows)]);
    return { uploadId: Number(u.id), total: rows.length, added: added.length, dup: rows.length - added.length, bad, columns: head };
  });
  const auto = await pgAutoMatch(db, actor);
  return { ...res, autoMatched: auto.matched,
           note: `정산 ${res.total}줄 중 새로 ${res.added} · 이미 있음 ${res.dup}${bad ? ` · 못 읽음 ${bad}` : ''} · 자동 맞춤 ${auto.matched}.` };
}

export interface PgCand { entryId: string; date: string; source: string; memo: string | null; party: string | null; amount: number }
export interface PgTxn { id: string; paidOn: string; settleOn: string; gross: number; fee: number; feeVat: number; net: number; key: string | null; method: string | null;
  matchKind: string | null; entryId: string | null; matchNote: string | null; booked: boolean; candidates: PgCand[] }

async function matchDays(db: DatabaseService) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.pg_match_days'`);
  const n = Number(r?.v ?? 2);
  return Number.isInteger(n) && n >= 0 && n <= 7 ? n : 2;
}

/** 아직 맞추지 않은 PG 정산 받을 돈 전표(결제 = 차변 · 취소 = 대변) */
async function openRecv(db: DatabaseService, from: string, to: string): Promise<Array<PgCand & { side: 'D' | 'C' }>> {
  return db.query(
    `SELECT e.id::text AS "entryId", e.entry_date::text AS date, e.source, e.memo, e.party,
            CASE WHEN sum(l.debit) > 0 THEN sum(l.debit) ELSE sum(l.credit) END::bigint AS amount,
            CASE WHEN sum(l.debit) > 0 THEN 'D' ELSE 'C' END AS side
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id AND l.role = 'PG_RECV'
      WHERE e.entry_date BETWEEN $1::date AND $2::date AND e.source <> 'PG_SETTLE'
        AND NOT EXISTS (SELECT 1 FROM acct_pg_txns t WHERE t.entry_id = e.id)
      GROUP BY e.id ORDER BY e.entry_date, e.id`, [from, to]);
}

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);

function pgCandidates(t: { paidOn: string; gross: number; key: string | null }, pool: Array<PgCand & { side: 'D' | 'C' }>, days: number): PgCand[] {
  const side = t.gross > 0 ? 'D' : 'C', amt = Math.abs(t.gross);
  const lo = addDays(t.paidOn, -days), hi = addDays(t.paidOn, days);
  return pool.filter((c) => c.side === side && Number(c.amount) === amt && c.date >= lo && c.date <= hi)
    .map(({ side: _s, ...c }) => ({ ...c, amount: Number(c.amount) }))
    .sort((a, b) => Number(!!t.key && nameLike(b.memo, t.key)) - Number(!!t.key && nameLike(a.memo, t.key)) || Math.abs(Date.parse(a.date) - Date.parse(t.paidOn)) - Math.abs(Date.parse(b.date) - Date.parse(t.paidOn)))
    .slice(0, 5);
}

/** GET /admin/acct/pg?ym= — 정산일 기준 그 달 PG 정산 줄 · 후보 · 합계 · 안 들어온 결제 */
export async function pgMonth(db: DatabaseService, ym: string) {
  const days = await matchDays(db);
  const from = `${ym}-01`;
  const to = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const rows = await db.query<Omit<PgTxn, 'candidates'>>(
    `SELECT t.id::text AS id, t.paid_on::text AS "paidOn", t.settle_on::text AS "settleOn", t.gross::bigint AS gross, t.fee::bigint AS fee, t.fee_vat::bigint AS "feeVat",
            t.net::bigint AS net, t.pg_key AS key, t.method, t.match_kind AS "matchKind", t.entry_id::text AS "entryId", t.match_note AS "matchNote",
            EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PG_SETTLE' AND e.source_key = t.id::text) AS booked
       FROM acct_pg_txns t WHERE t.settle_on BETWEEN $1::date AND $2::date ORDER BY t.settle_on, t.id LIMIT 3000`, [from, to]);
  const minPaid = rows.reduce((m, r) => (r.paidOn < m ? r.paidOn : m), from);
  const pool = await openRecv(db, addDays(minPaid, -days), addDays(to, days));
  const items: PgTxn[] = rows.map((r) => ({ ...r, gross: Number(r.gross), fee: Number(r.fee), feeVat: Number(r.feeVat), net: Number(r.net),
    candidates: r.matchKind ? [] : pgCandidates({ paidOn: r.paidOn, gross: Number(r.gross), key: r.key }, pool, days) }));
  const sum = (f: (t: PgTxn) => number) => items.reduce((a, t) => a + f(t), 0);
  const unsettled = await unsettledList(db);
  return {
    ym, days, items, unsettled: unsettled.slice(0, 50),
    total: { rows: items.length, gross: sum((t) => t.gross), fee: sum((t) => t.fee), feeVat: sum((t) => t.feeVat), net: sum((t) => t.net) },
    count: { total: items.length, matched: items.filter((t) => t.matchKind === 'ENTRY').length, ignored: items.filter((t) => t.matchKind === 'IGNORE').length,
             open: items.filter((t) => !t.matchKind).length, booked: items.filter((t) => t.booked).length, unsettled: unsettled.length,
             autoReady: items.filter((t) => !t.matchKind && t.candidates.length === 1).length },
    note: '정산일 기준입니다. 맞춘 줄은 다음 자동 전표(매시간 · 「지금 전표 만들기」) 때 PG 정산 전표(보통예금 · 지급수수료 · 부가세대급금 / PG 정산 받을 돈)가 됩니다. PG 사마다 머리줄이 달라 처음은 일반 형식입니다.',
  };
}

/** acct.pg_unsettled_days 지나도 맞지 않은 PG 정산 받을 돈 전표 */
export async function unsettledList(db: DatabaseService) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.pg_unsettled_days'`);
  const n = Math.min(60, Math.max(1, Number(r?.v ?? 7) || 7));
  const rows = await db.query<{ entryId: string; date: string; source: string; memo: string | null; amount: string }>(
    `SELECT e.id::text AS "entryId", e.entry_date::text AS date, e.source, e.memo, sum(l.debit)::text AS amount
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id AND l.role = 'PG_RECV' AND l.debit > 0
      WHERE e.entry_date < ((now() AT TIME ZONE 'Asia/Seoul')::date - $1::int) AND e.source <> 'PG_SETTLE'
        AND NOT EXISTS (SELECT 1 FROM acct_pg_txns t WHERE t.entry_id = e.id)
      GROUP BY e.id ORDER BY e.entry_date, e.id LIMIT 500`, [n]);
  return rows.map((x) => ({ ...x, amount: Number(x.amount), days: n }));
}

/** POST /admin/acct/pg/{id}/match — 맞춤(전표) · 맞출 것 없음(사유) · 풀기(사유 · 전표가 아직 없을 때만) */
export async function pgMatch(db: DatabaseService, id: string, body: { entryId?: string; ignore?: boolean; clear?: boolean; note?: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('PG 정산 줄이 없습니다.');
  const [t] = await db.query<{ match_kind: string | null; booked: boolean }>(
    `SELECT match_kind, EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PG_SETTLE' AND e.source_key = t.id::text) AS booked FROM acct_pg_txns t WHERE id = $1::bigint`, [id]);
  if (!t) throw new NotFound('PG 정산 줄이 없습니다.');
  const note = (body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (body.clear) {
    if (note.length < 2) throw new PolicyViolation('PG_REASON', '맞춤을 풀 때는 사유를 2자 이상 적어 주십시오.');
    if (t.booked) throw new StateConflict('PG_BOOKED', '이미 PG 정산 전표가 만들어진 줄은 풀지 못합니다 — 수동 전표로 바로잡으십시오.');
    await db.query(`UPDATE acct_pg_txns SET match_kind = NULL, entry_id = NULL, match_note = $2, matched_by = $3, matched_at = NULL WHERE id = $1::bigint`, [id, `풀기: ${note}`.slice(0, 200), actor]);
    return { ok: true, id, matchKind: null, note: '맞춤을 풀었습니다.' };
  }
  if (t.match_kind) throw new StateConflict('PG_MATCHED', '이미 맞춘 줄입니다 — 먼저 풀어 주십시오.');
  if (body.ignore) {
    if (note.length < 2) throw new PolicyViolation('PG_REASON', '맞출 것 없음은 사유(예: 회계 시작일 전 결제 · 시험 결제)를 2자 이상 적어 주십시오.');
    await db.query(`UPDATE acct_pg_txns SET match_kind = 'IGNORE', match_note = $2, matched_by = $3, matched_at = now() WHERE id = $1::bigint`, [id, note, actor]);
    return { ok: true, id, matchKind: 'IGNORE', note: '맞출 것 없음으로 두었습니다(전표를 만들지 않음).' };
  }
  if (!/^\d{1,18}$/.test(body.entryId ?? '')) throw new PolicyViolation('PG_ENTRY', '맞출 전표 번호를 골라 주십시오.');
  const [used] = await db.query(`SELECT 1 FROM acct_pg_txns WHERE entry_id = $1::bigint`, [body.entryId]);
  if (used) throw new StateConflict('PG_ENTRY_USED', '그 전표는 이미 다른 PG 정산 줄과 맞췄습니다.');
  await db.query(`UPDATE acct_pg_txns SET match_kind = 'ENTRY', entry_id = $2::bigint, match_note = nullif($3, ''), matched_by = $4, matched_at = now() WHERE id = $1::bigint`,
    [id, body.entryId, note, actor]);
  return { ok: true, id, matchKind: 'ENTRY', entryId: body.entryId, note: `전표 ${body.entryId} 와 맞췄습니다 — 다음 자동 전표 때 PG 정산 전표가 됩니다.` };
}

/** 후보가 하나뿐인 줄만 자동 맞춤(전체 · 올리기 직후에도 부름) */
export async function pgAutoMatch(db: DatabaseService, actor: string | null) {
  const days = await matchDays(db);
  const open = await db.query<{ id: string; paidOn: string; gross: string; key: string | null }>(
    `SELECT id::text AS id, paid_on::text AS "paidOn", gross::text AS gross, pg_key AS key FROM acct_pg_txns WHERE match_kind IS NULL ORDER BY paid_on, id LIMIT 3000`);
  if (!open.length) return { matched: 0, skipped: 0 };
  const lo = open.reduce((m, r) => (r.paidOn < m ? r.paidOn : m), open[0].paidOn), hi = open.reduce((m, r) => (r.paidOn > m ? r.paidOn : m), open[0].paidOn);
  const pool = await openRecv(db, addDays(lo, -days), addDays(hi, days));
  const used = new Set<string>(); let matched = 0, skipped = 0;
  for (const t of open) {
    const c = pgCandidates({ paidOn: t.paidOn, gross: Number(t.gross), key: t.key }, pool.filter((p) => !used.has(p.entryId)), days);
    if (c.length !== 1) continue;
    try {
      const r = await db.query(`UPDATE acct_pg_txns SET match_kind = 'ENTRY', entry_id = $2::bigint, match_note = '자동 맞춤', matched_by = $3, matched_at = now() WHERE id = $1::bigint AND match_kind IS NULL RETURNING id`,
        [t.id, c[0].entryId, actor]);
      if (r.length) { used.add(c[0].entryId); matched++; }
    } catch { skipped++; }
  }
  return { matched, skipped, note: `자동 맞춤 ${matched}${skipped ? ` · 건너뜀 ${skipped}` : ''}.` };
}

/** 정기 작업 acct_pg_check — 안 들어온 결제가 있으면 하루 한 번 운영 알림 · 없으면 풀기 */
export async function acctPgCheckJob(db: DatabaseService) {
  const list = await unsettledList(db);
  if (!list.length) {
    const r = await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '모두 맞춤' WHERE alert_code = 'ACCT_PG_UNSETTLED' AND resolved_at IS NULL RETURNING id`);
    return { unsettled: 0, made: false, resolved: r.length };
  }
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const total = list.reduce((a, x) => a + x.amount, 0);
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'ACCT_PG_UNSETTLED', 'WARN', $1, $2::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_PG_UNSETTLED' AND detail->>'day' = $3)
     ON CONFLICT DO NOTHING RETURNING id`,
    [`PG 정산이 안 들어온 결제 ${list.length}건 · ${total.toLocaleString('ko-KR')}원(${list[0].days}일 넘음) — 회계 › PG 정산`,
     JSON.stringify({ day: today, count: list.length, total, oldest: list[0].date }), today]);
  return { unsettled: list.length, made: r.length > 0, resolved: 0 };
}

/* ── 전표 — 맞춘(ENTRY) 줄만 ──
 *   부호 그대로 셈: 차변 보통예금(입금액) · 지급수수료(수수료 − 부가세) · 부가세대급금(수수료 부가세) / 대변 PG 정산 받을 돈(결제 금액).
 *   입금액 + 수수료 = 결제 금액이라 늘 맞음 · 음수 금액은 반대쪽 줄(취소 · 수수료 돌려받음 · 입금액 음수). */
export function pgSettleLines(gross: number, fee: number, feeVat: number, net: number): Line[] {
  const side = (role: string, debitAmt: number): Line | null =>
    debitAmt > 0 ? { role, debit: debitAmt, credit: 0 } : debitAmt < 0 ? { role, debit: 0, credit: -debitAmt } : null;
  return [side('CASH', net), side('EXP_FEE', fee - feeVat), side('VAT_IN', feeVat), side('PG_RECV', -gross)].filter((l): l is Line => !!l);
}

export const PG_SOURCES: Source[] = [
  {
    name: 'PG_SETTLE', label: 'PG 정산 입금',
    sql: `SELECT t.id::text AS key, (t.settle_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at, t.gross::bigint AS gross, t.fee::bigint AS fee, t.fee_vat::bigint AS fee_vat,
                 t.net::bigint AS net, u.pg_name AS party, t.pg_key AS no
            FROM acct_pg_txns t JOIN acct_pg_uploads u ON u.id = t.upload_id
           WHERE t.match_kind = 'ENTRY' AND t.settle_on >= fn_acct_from()::date
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PG_SETTLE' AND e.source_key = t.id::text)
           ORDER BY t.settle_on, t.id LIMIT 500`,
    build: (r) => ({ memo: `PG 정산 ${r.no ?? ''}`.trim(), evidence: 'CARD_PG',
      lines: pgSettleLines(Number(r.gross ?? r.amt ?? 0), Number(r.fee ?? 0), Number(r.fee_vat ?? 0), Number(r.net ?? (Number(r.gross ?? r.amt ?? 0) - Number(r.fee ?? 0)))) }),
  },
];
