import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.440 (D257 · docs/577) 장부 보관 · 내부통제 보고 — 대표 11/19 「다음개발」
 *   보관: 해 마감(⑭ fn_acct_year_closed) 뒤 그 해 전표 CSV · 증빙 파일 목록(파일 sha256)을 묶어 기록(acct_archives · 쌓기만 · 지우기 없음).
 *         같은 해를 다시 만들면 새 판 · 앞 판과 CSV sha256 이 다르면 「바뀜」 표시. 보관 기한 = 다음 해 1월 1일 + 5년(국세기본법) — 지나도 지우지 않음.
 *   내려받기: 승인 대상 ACCT_ARCHIVE(ExportGate) — 전표 CSV + 증빙 목록 CSV.
 *   내부통제 보고(달마다 · 계산만): 규칙 바꿈 · 해 마감 풀기 · 늦게 넣은 전표 · 수동 전표 · 큰 금액 전표 · 운영 권한 바뀜 · 회계 내려받기 · 세무사 접속 · 통장 맞출 것 없음.
 * ------------------------------------------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
const csv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const ymOk = (ym?: string) => (ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym) ? ym : new Date(Date.now() + 9 * 3600e3 - 28 * 86400e3).toISOString().slice(0, 7));

const JOURNAL_HEAD = ['일자', '전표번호', '근거', '근거 번호', '계정 역할', '계정코드', '계정명', '차변', '대변', '거래처', '적요', '증빙', '늦게 넣음'];

async function yearRows(db: DatabaseService, year: number) {
  return db.query<Record<string, unknown>>(
    `SELECT e.entry_date::text AS d, e.id::text AS id, e.source, e.source_key, l.role, a.ext_code, a.name, l.debit::bigint AS debit, l.credit::bigint AS credit,
            e.party, e.memo, e.evidence, e.late
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date >= make_date($1, 1, 1) AND e.entry_date < make_date($1 + 1, 1, 1)
      ORDER BY e.entry_date, e.id, l.id`, [year]);
}
const journalCsv = (rows: Array<Record<string, unknown>>) =>
  csv(JOURNAL_HEAD, rows.map((r) => [r.d, r.id, r.source, r.source_key, r.role, r.ext_code, r.name, r.debit, r.credit, r.party, r.memo, r.evidence, r.late ? 'Y' : '']));

/** 그 해 증빙 파일 — 매입 · 경비 청구 · 계약에 붙은 것(있는 표만 · 표마다 고정 SQL) */
type FileRow = { fid: string; src: string; ref: string; name: string; size: string; sha256: string | null; status: string };
const FILE_SQL: Array<[string, string]> = [
  ['acct_purchases', `SELECT x.fid::text AS fid, 'PURCHASE' AS src, x.ref, f.original_name AS name, f.size_bytes::text AS size, f.sha256, f.status
                        FROM (SELECT unnest(attachments) AS fid, id::text AS ref FROM acct_purchases WHERE extract(year FROM issued_on) = $1) x JOIN files f ON f.id = x.fid`],
  ['acct_expense_claims', `SELECT x.fid::text AS fid, 'EXPENSE' AS src, x.ref, f.original_name AS name, f.size_bytes::text AS size, f.sha256, f.status
                        FROM (SELECT unnest(attachments) AS fid, id::text AS ref FROM acct_expense_claims WHERE extract(year FROM spent_on) = $1) x JOIN files f ON f.id = x.fid`],
  ['acct_contracts', `SELECT x.fid::text AS fid, 'CONTRACT' AS src, x.ref, f.original_name AS name, f.size_bytes::text AS size, f.sha256, f.status
                        FROM (SELECT unnest(attachments) AS fid, id::text AS ref FROM acct_contracts
                               WHERE extract(year FROM start_on) <= $1 AND (end_on IS NULL OR extract(year FROM end_on) >= $1)) x JOIN files f ON f.id = x.fid`],
];
async function yearFiles(db: DatabaseService, year: number): Promise<FileRow[]> {
  const out: FileRow[] = [];
  for (const [t, sql] of FILE_SQL) {
    const [h] = await db.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, ['public.' + t]);
    if (h?.ok) out.push(...(await db.query<FileRow>(sql, [year])));
  }
  return out.sort((a, b) => a.src.localeCompare(b.src) || Number(a.ref) - Number(b.ref) || a.fid.localeCompare(b.fid));
}

/** GET /admin/acct/archives — 보관 기록 · 마감한 해 */
export async function archiveList(db: DatabaseService) {
  const items = await db.query(
    `SELECT a.id::text AS id, a.year, a.entries, a.lines, a.debit_sum::bigint AS "debitSum", a.files, a.csv_sha256 AS "csvSha256", a.manifest_sha256 AS "manifestSha256",
            a.keep_until::text AS "keepUntil", a.note, a.created_at AS "createdAt", ac.email AS actor,
            lag(a.csv_sha256) OVER (PARTITION BY a.year ORDER BY a.id) AS "prevCsvSha256"
       FROM acct_archives a LEFT JOIN accounts ac ON ac.id = a.actor_id ORDER BY a.year DESC, a.id DESC LIMIT 50`);
  const closed = await db.query<{ year: number }>(
    `SELECT DISTINCT year FROM acct_year_closings y WHERE public.fn_acct_year_closed(y.year) ORDER BY year DESC`).catch(() => []);
  return { items: items.map((x: Record<string, unknown>) => ({ ...x, changed: x.prevCsvSha256 != null && x.prevCsvSha256 !== x.csvSha256 })),
           closedYears: closed.map((c) => c.year),
           note: '해 마감 뒤 그 해 전표 CSV 와 증빙 파일 목록의 지문(sha256)을 남깁니다. 지우지 않으며 보관 기한(5년)이 지나도 그대로 둡니다. 같은 해를 다시 만들면 새 판이고 앞 판과 다르면 「바뀜」입니다.' };
}

/** POST /admin/acct/archives — 그 해 묶음 만들기(SUPER · 해 마감 뒤) */
export async function makeArchive(db: DatabaseService, year: number, note: string | undefined, actor: string | null) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new PolicyViolation('ARCHIVE_YEAR', '해가 바르지 않습니다.');
  const [c] = await db.query<{ ok: boolean }>(`SELECT public.fn_acct_year_closed($1) AS ok`, [year]);
  if (!c?.ok) throw new StateConflict('ARCHIVE_NOT_CLOSED', '해 마감을 한 해만 보관합니다(회계 › 해 마감).');
  const rows = await yearRows(db, year);
  const text = journalCsv(rows);
  const files = await yearFiles(db, year);
  const manifest = { year, entries: new Set(rows.map((r) => r.id)).size, lines: rows.length, files: files.map((f) => ({ id: f.fid, src: f.src, ref: f.ref, name: f.name, size: n(f.size), sha256: f.sha256, status: f.status })) };
  const mtext = JSON.stringify(manifest);
  const debit = rows.reduce((a, r) => a + n(r.debit), 0);
  const [a] = await db.query<{ id: string }>(
    `INSERT INTO acct_archives (year, entries, lines, debit_sum, files, csv_sha256, manifest, manifest_sha256, keep_until, note, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, make_date($1 + 6, 1, 1), nullif($9, ''), $10) RETURNING id::text AS id`,
    [year, manifest.entries, manifest.lines, debit, files.length, sha(text), mtext, sha(mtext), (note ?? '').trim().slice(0, 200), actor]);
  return { ok: true, id: a!.id, year, entries: manifest.entries, lines: manifest.lines, files: files.length, csvSha256: sha(text),
           note: `${year}년 장부를 보관 기록으로 남겼습니다(전표 ${manifest.entries} · 증빙 ${files.length}).` };
}

/** GET /admin/acct/archives/{id}/export?ticket= — 전표 CSV + 증빙 목록 CSV(승인 ACCT_ARCHIVE) · 지금 다시 만든 CSV 의 sha256 이 기록과 같은지 */
export async function archiveExport(db: DatabaseService, id: string) {
  const [a] = await db.query<{ year: number; csv_sha256: string; manifest: { files: Array<Record<string, unknown>> } }>(
    `SELECT year, csv_sha256, manifest FROM acct_archives WHERE id = $1::bigint`, [id]);
  if (!a) throw new NotFound('없는 보관 기록입니다.');
  const text = journalCsv(await yearRows(db, a.year));
  const filesCsv = csv(['출처', '번호', '파일', '이름', '크기', 'sha256', '상태'],
    (a.manifest?.files ?? []).map((f) => [f.src, f.ref, f.id, f.name, f.size, f.sha256, f.status]));
  const same = sha(text) === a.csv_sha256;
  return { year: a.year, csv: text, filesCsv, filename: `장부보관_${a.year}_전표.csv`, filesFilename: `장부보관_${a.year}_증빙목록.csv`, same,
           note: same ? '보관 때와 같은 장부입니다.' : '보관 뒤 장부가 바뀌었습니다(해 마감 풀기 · 늦은 전표) — 새 보관 판을 만드십시오.' };
}

/** GET /admin/acct/control?ym= — 내부통제 보고(계산만) */
export async function controlReport(db: DatabaseService, ymIn?: string) {
  const ym = ymOk(ymIn);
  const one = async (sql: string, args: unknown[] = []) => {
    try { const [r] = await db.query<{ n: number }>(sql, args); return n(r?.n); } catch { return 0; }
  };
  const [bs] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'acct.control_big_amount'`);
  const big = n(bs?.value ?? 10000000) || 10000000;
  const items = [
    { key: 'rule', label: '전표 규칙 바꿈', n: await one(`SELECT count(*)::int AS n FROM acct_rule_changes WHERE created_at >= ($1 || '-01')::date AND created_at < ($1 || '-01')::date + interval '1 month'`, [ym]), where: '회계 › 계정 · 규칙' },
    { key: 'reopen', label: '해 마감 풀기', n: await one(`SELECT count(*)::int AS n FROM acct_year_closings WHERE action = 'REOPEN' AND created_at >= ($1 || '-01')::date AND created_at < ($1 || '-01')::date + interval '1 month'`, [ym]), where: '회계 › 해 마감' },
    { key: 'late', label: '마감한 달에 늦게 넣은 전표', n: await one(`SELECT count(*)::int AS n FROM acct_entries WHERE late AND ym = $1`, [ym]), where: '회계 › 전표' },
    { key: 'manual', label: '수동 전표', n: await one(`SELECT count(*)::int AS n FROM acct_entries WHERE source = 'MANUAL' AND ym = $1`, [ym]), where: '회계 › 수동 전표' },
    { key: 'big', label: `큰 금액 전표(${big.toLocaleString('ko-KR')}원 이상)`, n: await one(
        `SELECT count(*)::int AS n FROM (SELECT e.id FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.ym = $1 GROUP BY e.id HAVING sum(l.debit) >= $2) x`, [ym, big]), where: '회계 › 전표' },
    { key: 'role', label: '운영 권한 주기 · 거두기', n: await one(
        `SELECT count(*)::int AS n FROM role_changes WHERE changed_at >= ($1 || '-01')::date AND changed_at < ($1 || '-01')::date + interval '1 month'`, [ym]), where: '권한 계층 › 권한 관리' },
    { key: 'export', label: '회계 자료 내려받기 요청', n: await one(`SELECT count(*)::int AS n FROM export_requests WHERE target LIKE 'ACCT_%' AND requested_at >= ($1 || '-01')::date AND requested_at < ($1 || '-01')::date + interval '1 month'`, [ym]), where: '운영 안전 › 내려받기 승인' },
    { key: 'accountant', label: '세무사 계정 접속', n: await one(
        `SELECT count(*)::int AS n FROM acct_accountant_access WHERE at >= ($1 || '-01')::date AND at < ($1 || '-01')::date + interval '1 month'`, [ym]), where: '회계 › 세무사' },
    { key: 'bankIgnore', label: '통장 줄 「맞출 것 없음」', n: await one(
        `SELECT count(*)::int AS n FROM acct_bank_txns WHERE match_kind = 'IGNORE' AND to_char(tx_date, 'YYYY-MM') = $1`, [ym]), where: '회계 › 은행 맞추기' },
  ];
  const exceptions = items.filter((x) => ['rule', 'reopen', 'late', 'big'].includes(x.key)).reduce((a, x) => a + x.n, 0);
  return { ym, items, exceptions, big,
           text: `내부통제 ${ym} — 예외 ${exceptions}건(규칙 바꿈 ${items[0]!.n} · 해 마감 풀기 ${items[1]!.n} · 늦은 전표 ${items[2]!.n} · 큰 금액 ${items[4]!.n}) · 수동 전표 ${items[3]!.n} · 권한 바뀜 ${items[5]!.n} · 세무사 접속 ${items[7]!.n}`,
           note: '그 달에 생긴 「다시 볼 일」을 숫자로 모았습니다. 본인 결재 시도는 DB 가 막기만 하고 기록하지 않아 셈에 없습니다.' };
}

/** ⑰ 월보 한 줄 */
export async function controlLine(db: DatabaseService, ym: string) {
  const r = await controlReport(db, ym);
  return { text: r.text, exceptions: r.exceptions };
}
