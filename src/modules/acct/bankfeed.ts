import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { envInt, envJson, FetchLike, getPath, httpJson } from '../../common/http-json';
import { KftcTransfer } from './transfer';

/* ---------------------------------------------------------------------
 * v10.467 (D264 · docs/605) 은행 거래내역 자동 조회 — ㉙ 금융결제원 오픈뱅킹 어댑터(FIRMBANK) 재사용
 *
 *   회사 계좌(이름 · 은행 표준코드 · 핀테크이용번호 · 끝 4자리)를 등록하면
 *   매일 06:40(정기 작업 acct_bank_feed) 또는 「지금 조회」로 거래내역조회 → ⑪ 은행 맞추기(acct_bank_uploads · acct_bank_txns)에 들여옴.
 *     같은 줄은 한 번 — row_hash = sha256('kftc|계좌|날짜|시각|입금|출금|잔액|내용|같은 줄 순번')(겹치는 기간을 다시 물어도 그대로)
 *     CSV 로 이미 올린 줄(날짜 · 입금 · 출금 · 잔액이 같은 줄)도 건너뜀 — 「이미 있음」으로 셈
 *   acct.bank_feed       on | off(처음 off)       — 꺼져 있으면 정기 작업 · 「지금 조회」 모두 안 함(계좌 등록은 됨)
 *   acct.bank_feed_mode  ASSUME | LIVE(처음 ASSUME) — ASSUME 은 금융결제원에 묻지 않고 간주 2줄(마지막 날 · 입금 1 · 출금 1 · 계좌마다 같은 값)
 *   acct.bank_feed_days  한 번에 묻는 날 수(오늘 포함 · 처음 3)
 *
 *   어댑터 KftcBankFeed — 금융결제원 오픈뱅킹 「거래내역조회(핀테크이용번호)」:
 *     GET {base}/v2.0/account/transaction_list/fin_num?bank_tran_id=…&fintech_use_num=…&inquiry_type=A&inquiry_base=D&from_date=…&to_date=…&sort_order=A&tran_dtime=…
 *     다음 쪽: next_page_yn = Y 이면 befor_inquiry_trace_info 로 이어서(최대 20쪽)
 *     토큰: 거래내역조회는 「사용자 인증」 토큰이 필요 → 외부 연동 › 연동 키 「FIRMBANK_USER_TOKEN」(회사 계좌를 오픈뱅킹에 등록할 때 받은 사용자 토큰 · 90일마다 다시)
 *     거래고유번호는 ㉙ 와 같은 시퀀스(fn_acct_transfer_tran_id · 이용기관코드 + U + 9자리)
 *   ★ 경로 · 칸 이름 · 토큰 방식은 「금융결제원 오픈뱅킹 v2.0 으로 알려진 값」 — 공식 가이드로 확인 필요(2026-11-20 확인 못 함) · .env FIRMBANK_FEED_MAP(JSON)로 바꿈.
 *     이용기관(일반 법인)이 자기 계좌 거래내역을 이 방식으로 볼 수 있는지 대표 확인 — 안 되면 은행 펌뱅킹 · 연동 업체를 같은 어댑터 자리에.
 *   LIVE 인데 키 · 이용기관코드가 없으면 422 BANK_FEED_NOT_READY(조용히 간주로 돌아가지 않음).
 *   핀테크이용번호는 암호문(pgp_sym_encrypt · fn_enc_key)으로만 저장 · 화면 · API 는 끝 4자리 · 은행 표준코드 · 이름만.
 * ------------------------------------------------------------------- */

const BANK_STD = /^[0-9]{3}$/;        // DB CHECK acct_bank_feed_accounts.bank_std 와 같음
const LAST4 = /^[0-9]{4}$/;           // DB CHECK acct_last4 와 같음
const FINTECH = /^[0-9]{20,30}$/;     // 핀테크이용번호(알려진 값 24자리 · 확인 필요라 20 ~ 30) — 암호문이라 DB CHECK 없음
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ORG = /^[A-Za-z0-9]{10}$/;
const ASSUME_ORG = 'SGBASSUME0';
const MAX_PAGES = 20;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstStamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const shift = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const num = (v: unknown) => { const t = String(v ?? '').replace(/[,\s]/g, ''); return /^-?\d+$/.test(t) ? Number(t) : NaN; };

export interface FeedAccount { id: string; label: string; bankStd: string; last4: string; fintech: string }
export interface FeedRow { date: string; time: string; deposit: number; withdraw: number; balance: number | null; content: string | null; memo: string | null }
export interface FeedResult { ok: boolean; rows: FeedRow[]; bad: number; errorKind?: string; error?: string }
export interface BankFeedAdapter {
  readonly name: 'assume' | 'kftc';
  list(acc: FeedAccount, from: string, to: string, nextTranId: () => Promise<string>): Promise<FeedResult>;
}

/** 간주 — 금융결제원에 묻지 않음 · 마지막 날에 입금 1 · 출금 1(계좌 번호마다 같은 값 · 다시 물으면 「이미 있음」) */
export class AssumeBankFeed implements BankFeedAdapter {
  readonly name = 'assume' as const;
  async list(acc: FeedAccount, _from: string, to: string): Promise<FeedResult> {
    const k = Number(acc.id) % 10;
    const base = 1_000_000 + k * 10_000, dep = 10_000 + k * 1_000;
    return { ok: true, bad: 0, rows: [
      { date: to, time: '093000', deposit: dep, withdraw: 0, balance: base + dep, content: '(간주) 입금 시험', memo: '간주 조회' },
      { date: to, time: '150000', deposit: 0, withdraw: 3_000, balance: base + dep - 3_000, content: '(간주) 출금 시험', memo: '간주 조회' },
    ] };
  }
}

/** 경로 · 칸 — 금융결제원 오픈뱅킹 v2.0 으로 알려진 값(공식 가이드로 확인 필요) · .env FIRMBANK_FEED_MAP(JSON)로 고침 */
const FEED_MAP = {
  list: '/v2.0/account/transaction_list/fin_num', inquiryType: 'A', inquiryBase: 'D', sortOrder: 'A',
  rspCode: 'rsp_code', rspMessage: 'rsp_message', okCode: 'A0000', resList: 'res_list', nextPage: 'next_page_yn', trace: 'befor_inquiry_trace_info',
  date: 'tran_date', time: 'tran_time', inout: 'inout_type', depositWords: ['입금'], withdrawWords: ['출금', '지급'], amount: 'tran_amt', balance: 'after_balance_amt',
  content: 'print_content', memo: 'branch_name',
};
type FeedMap = typeof FEED_MAP;

/** 금융결제원 오픈뱅킹 거래내역조회 — 점검판에서는 부르지 않음(간주만) */
export class KftcBankFeed implements BankFeedAdapter {
  readonly name = 'kftc' as const;
  constructor(private readonly fetchFn?: FetchLike) {}
  static ready() { return !!(process.env.FIRMBANK_USER_TOKEN && process.env.FIRMBANK_CLIENT_ID && ORG.test(process.env.FIRMBANK_ORG_CODE ?? '')); }
  private map(): FeedMap { return { ...FEED_MAP, ...(envJson('FIRMBANK_FEED_MAP', FEED_MAP).value as Partial<FeedMap>) }; }
  async list(acc: FeedAccount, from: string, to: string, nextTranId: () => Promise<string>): Promise<FeedResult> {
    if (!KftcBankFeed.ready()) return { ok: false, rows: [], bad: 0, errorKind: 'NOT_CONFIGURED', error: '사용자 토큰 · 키 · 이용기관코드가 없습니다' };
    const m = this.map();
    const rows: FeedRow[] = []; let bad = 0; let trace = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ bank_tran_id: await nextTranId(), fintech_use_num: acc.fintech, inquiry_type: m.inquiryType, inquiry_base: m.inquiryBase,
        from_date: from.replace(/-/g, ''), to_date: to.replace(/-/g, ''), sort_order: m.sortOrder, tran_dtime: kstStamp(), ...(trace ? { befor_inquiry_trace_info: trace } : {}) });
      const r = await httpJson({ url: `${KftcTransfer.base()}${m.list}?${qs.toString()}`, method: 'GET', headers: { Authorization: `Bearer ${process.env.FIRMBANK_USER_TOKEN}` },
        timeoutMs: envInt('FIRMBANK_TIMEOUT_MS', 20000), fetchFn: this.fetchFn });
      if (!r.ok) return { ok: false, rows: [], bad: 0, errorKind: r.errorKind ?? 'UPSTREAM', error: `거래내역조회 ${r.error ?? ''}`.trim() };
      const code = String(getPath(r.body, m.rspCode) ?? '');
      if (code !== m.okCode) return { ok: false, rows: [], bad: 0, errorKind: 'REJECTED', error: `거래내역조회 거절(${code.slice(0, 20)} ${String(getPath(r.body, m.rspMessage) ?? '').slice(0, 120)})`.trim() };
      const list = getPath(r.body, m.resList);
      for (const x of Array.isArray(list) ? list : []) {
        const d = String(getPath(x, m.date) ?? ''), io = String(getPath(x, m.inout) ?? ''), amt = num(getPath(x, m.amount)), bal = num(getPath(x, m.balance));
        const date = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
        const dep = m.depositWords.some((w) => io.includes(w)), wd = m.withdrawWords.some((w) => io.includes(w));
        if (!date || Number.isNaN(amt) || amt <= 0 || dep === wd) { bad++; continue; }
        rows.push({ date, time: String(getPath(x, m.time) ?? '').replace(/[^0-9]/g, '').slice(0, 6), deposit: dep ? amt : 0, withdraw: wd ? amt : 0,
                    balance: Number.isNaN(bal) ? null : bal, content: String(getPath(x, m.content) ?? '').trim().slice(0, 120) || null, memo: String(getPath(x, m.memo) ?? '').trim().slice(0, 200) || null });
      }
      if (String(getPath(r.body, m.nextPage) ?? 'N') !== 'Y') break;
      trace = String(getPath(r.body, m.trace) ?? '');
      if (!trace) break;
    }
    return { ok: true, rows, bad };
  }
}

async function settings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('acct.bank_feed', 'acct.bank_feed_mode', 'acct.bank_feed_days')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const d = Number(v('acct.bank_feed_days') ?? 3);
  return { on: v('acct.bank_feed') === 'on', mode: v('acct.bank_feed_mode') === 'LIVE' ? 'LIVE' as const : 'ASSUME' as const, days: Number.isInteger(d) && d >= 1 && d <= 31 ? d : 3 };
}

export function bankFeedAdapter(mode: 'ASSUME' | 'LIVE', fetchFn?: FetchLike): BankFeedAdapter {
  if (mode !== 'LIVE') return new AssumeBankFeed();
  if (!KftcBankFeed.ready()) throw new PolicyViolation('BANK_FEED_NOT_READY', '금융결제원 사용자 토큰(FIRMBANK_USER_TOKEN) · 키 · 이용기관코드가 없습니다 — 외부 연동 › 연동 키와 .env 를 넣거나 간주(ASSUME)로 두십시오.');
  return new KftcBankFeed(fetchFn);
}

/** 거래 줄 → 은행 맞추기 줄(같은 줄은 한 번 · CSV 로 이미 올린 줄은 건너뜀) — CSV 올리기와 같은 잠금으로 한 번에 하나 */
export async function importFeedRows(db: DatabaseService, acc: FeedAccount, rows: FeedRow[], bad: number, from: string, to: string) {
  const seen = new Map<string, number>();
  const withHash = rows.map((r) => {
    const base = ['kftc', acc.id, r.date, r.time, r.deposit, r.withdraw, r.balance ?? '', r.content ?? ''].join('|');
    const k = (seen.get(base) ?? 0) + 1; seen.set(base, k);
    return { ...r, hash: createHash('sha256').update(`${base}|${k}`).digest('hex') };
  });
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_bank_upload'))`);
    if (!withHash.length) return { uploadId: null as string | null, total: 0, added: 0, dup: 0 };
    /* 이미 있는 줄 — 같은 지문 · 또는 CSV 로 올린 같은 날짜 · 금액 · 잔액(잔액이 있을 때만) */
    const had = await db.query<{ hash: string }>(
      `SELECT x.hash FROM jsonb_to_recordset($1::jsonb) AS x(date text, deposit bigint, withdraw bigint, balance bigint, hash text)
        WHERE EXISTS (SELECT 1 FROM acct_bank_txns t WHERE t.row_hash = x.hash)
           OR (x.balance IS NOT NULL AND EXISTS (SELECT 1 FROM acct_bank_txns t WHERE t.tx_date = x.date::date AND t.deposit = x.deposit AND t.withdraw = x.withdraw AND t.balance = x.balance))`,
      [JSON.stringify(withHash)]);
    const dupSet = new Set(had.map((h) => h.hash));
    const fresh = withHash.filter((r) => !dupSet.has(r.hash));
    const [u] = await db.query<{ id: string }>(
      `INSERT INTO acct_bank_uploads (filename, bank, rows_total, rows_added, rows_dup, rows_bad) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
      [`금융결제원 자동 조회 ${acc.label} ${from} ~ ${to}`.slice(0, 200), `자동 ${acc.bankStd} ****${acc.last4}`.slice(0, 40), withHash.length, fresh.length, withHash.length - fresh.length, bad]);
    const added = fresh.length ? await db.query<{ id: string }>(
      `INSERT INTO acct_bank_txns (upload_id, tx_date, deposit, withdraw, balance, counterparty, memo, row_hash)
       SELECT $1::bigint, x.date::date, x.deposit, x.withdraw, x.balance, x.content, x.memo, x.hash
         FROM jsonb_to_recordset($2::jsonb) AS x(date text, deposit bigint, withdraw bigint, balance bigint, content text, memo text, hash text)
       ON CONFLICT (row_hash) DO NOTHING RETURNING id::text AS id`, [u!.id, JSON.stringify(fresh)]) : [];
    return { uploadId: u!.id, total: withHash.length, added: added.length, dup: withHash.length - added.length };
  });
}

async function loadAccounts(db: DatabaseService, onlyId?: string) {
  return db.query<FeedAccount>(
    `SELECT id::text AS id, label, bank_std AS "bankStd", acct_last4 AS last4, pgp_sym_decrypt(fintech_enc, fn_enc_key()) AS fintech
       FROM acct_bank_feed_accounts WHERE active AND ($1::text = '' OR id::text = $1::text) ORDER BY id`, [onlyId ?? '']);
}

export interface RunOut { accountId: string; label: string; ok: boolean; error?: string; total: number; added: number; dup: number; bad?: number }

/** 계좌 하나 조회 → 들여옴 → 기록(실패도 기록) */
async function runOne(db: DatabaseService, ad: BankFeedAdapter, mode: 'ASSUME' | 'LIVE', acc: FeedAccount, from: string, to: string, actor: string | null): Promise<RunOut> {
  const org = mode === 'LIVE' ? KftcTransfer.orgCode() : ASSUME_ORG;
  const nextTranId = async () => { const [r] = await db.query<{ id: string }>(`SELECT fn_acct_transfer_tran_id($1) AS id`, [org]); return r!.id; };
  let res: FeedResult;
  try { res = await ad.list(acc, from, to, nextTranId); } catch (e) { res = { ok: false, rows: [], bad: 0, errorKind: 'ERROR', error: String((e as Error)?.message ?? e).slice(0, 200) }; }
  if (!res.ok) {
    await db.query(`INSERT INTO acct_bank_feed_runs (account_id, from_date, to_date, mode, result, error, run_by) VALUES ($1::bigint, $2::date, $3::date, $4, 'FAIL', $5, $6::uuid)`,
      [acc.id, from, to, mode, (res.error ?? '실패').slice(0, 300), actor]);
    await db.query(`UPDATE acct_bank_feed_accounts SET last_run_at = now(), last_result = 'FAIL', last_error = $2 WHERE id = $1::bigint`, [acc.id, (res.error ?? '실패').slice(0, 300)]);
    return { accountId: acc.id, label: acc.label, ok: false, error: res.error ?? '실패', total: 0, added: 0, dup: 0 };
  }
  const imp = await importFeedRows(db, acc, res.rows, res.bad, from, to);
  await db.query(
    `INSERT INTO acct_bank_feed_runs (account_id, from_date, to_date, mode, result, rows_total, rows_added, rows_dup, upload_id, run_by)
     VALUES ($1::bigint, $2::date, $3::date, $4, 'OK', $5::int, $6::int, $7::int, $8::bigint, $9::uuid)`,
    [acc.id, from, to, mode, imp.total, imp.added, imp.dup, imp.uploadId, actor]);
  await db.query(`UPDATE acct_bank_feed_accounts SET last_run_at = now(), last_result = 'OK', last_error = NULL WHERE id = $1::bigint`, [acc.id]);
  return { accountId: acc.id, label: acc.label, ok: true, total: imp.total, added: imp.added, dup: imp.dup, bad: res.bad };
}

/** GET /admin/acct/bank-feed — 설정 · 등록 계좌(끝 4자리) · 최근 기록 30 */
export async function bankFeedView(db: DatabaseService) {
  const s = await settings(db);
  const accounts = await db.query(
    `SELECT id::text AS id, label, bank_std AS "bankStd", '****' || acct_last4 AS account, active, last_run_at AS "lastRunAt", last_result AS "lastResult", last_error AS "lastError", created_at AS "createdAt"
       FROM acct_bank_feed_accounts ORDER BY active DESC, id`);
  const runs = await db.query(
    `SELECT r.id::text AS id, a.label, '****' || a.acct_last4 AS account, r.from_date::text AS "from", r.to_date::text AS "to", r.mode, r.result,
            r.rows_total AS total, r.rows_added AS added, r.rows_dup AS dup, r.upload_id::text AS "uploadId", r.error, w.name AS "runBy", r.created_at AS "createdAt"
       FROM acct_bank_feed_runs r JOIN acct_bank_feed_accounts a ON a.id = r.account_id LEFT JOIN accounts w ON w.id = r.run_by ORDER BY r.id DESC LIMIT 30`);
  return { on: s.on, mode: s.mode, days: s.days, ready: s.mode === 'ASSUME' || KftcBankFeed.ready(), provider: 'KFTC', accounts, runs,
    note: s.on ? (s.mode === 'ASSUME' ? '간주(ASSUME) — 금융결제원에 묻지 않고 계좌마다 간주 2줄을 들여옵니다.' : 'LIVE — 매일 06:40 금융결제원 거래내역조회로 들여옵니다.')
               : '자동 조회 꺼짐(acct.bank_feed off) — 계좌 등록은 할 수 있습니다.' };
}

/** POST /admin/acct/bank-feed/accounts — 회사 계좌 등록(SUPER · 핀테크이용번호는 암호문 · 같은 번호 두 번 안 됨) */
export async function addFeedAccount(db: DatabaseService, b: { label: string; bankStd: string; fintechNum: string; last4: string }, actor: string | null) {
  const label = String(b.label ?? '').replace(/\s+/g, ' ').trim();
  if (label.length < 1 || label.length > 40) throw new PolicyViolation('BANK_FEED_LABEL', '계좌 이름은 1 ~ 40자입니다.');
  if (!BANK_STD.test(String(b.bankStd ?? ''))) throw new PolicyViolation('BANK_FEED_BANK', '은행 표준코드는 숫자 3자리입니다.');
  const fin = String(b.fintechNum ?? '').replace(/[\s-]/g, '');
  if (!FINTECH.test(fin)) throw new PolicyViolation('BANK_FEED_FINTECH', '핀테크이용번호는 숫자 20 ~ 30자리입니다(오픈뱅킹 계좌 등록 때 받은 번호).');
  if (!LAST4.test(String(b.last4 ?? ''))) throw new PolicyViolation('BANK_FEED_LAST4', '계좌 끝 4자리는 숫자 4자리입니다.');
  const hash = createHash('sha256').update(`fintech|${fin}`).digest('hex');
  const [dup] = await db.query(`SELECT 1 FROM acct_bank_feed_accounts WHERE fintech_hash = $1`, [hash]);
  if (dup) throw new PolicyViolation('BANK_FEED_DUP', '이미 등록한 계좌입니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_bank_feed_accounts (label, bank_std, fintech_enc, fintech_hash, acct_last4, created_by, updated_by)
     VALUES ($1, $2, pgp_sym_encrypt($3::text, fn_enc_key()), $4, $5, $6::uuid, $6::uuid) RETURNING id::text AS id`, [label, b.bankStd, fin, hash, b.last4, actor]);
  return { ok: true, id: r!.id, note: `계좌 「${label}」(****${b.last4})를 등록했습니다.` };
}

/** PUT /admin/acct/bank-feed/accounts/{id} — 이름 · 쓰는지(SUPER) */
export async function setFeedAccount(db: DatabaseService, idIn: string, b: { label?: string; active?: boolean }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(idIn ?? ''))) throw new NotFound('없는 계좌입니다.');
  const [cur] = await db.query<{ label: string; active: boolean }>(`SELECT label, active FROM acct_bank_feed_accounts WHERE id = $1::bigint`, [idIn]);
  if (!cur) throw new NotFound('없는 계좌입니다.');
  const label = b.label === undefined ? cur.label : String(b.label).replace(/\s+/g, ' ').trim();
  if (label.length < 1 || label.length > 40) throw new PolicyViolation('BANK_FEED_LABEL', '계좌 이름은 1 ~ 40자입니다.');
  const active = b.active === undefined ? cur.active : !!b.active;
  await db.query(`UPDATE acct_bank_feed_accounts SET label = $2, active = $3, updated_by = $4::uuid WHERE id = $1::bigint`, [idIn, label, active, actor]);
  return { ok: true, id: String(idIn), active, note: active ? '고쳤습니다.' : '자동 조회를 껐습니다(기록은 그대로).' };
}

/** POST /admin/acct/bank-feed/run — 지금 조회(SUPER · PAYOUT · acct.bank_feed on 일 때만 · 기간 31일까지) */
export async function runBankFeed(db: DatabaseService, b: { accountId?: string; from?: string; to?: string }, actor: string | null) {
  const s = await settings(db);
  if (!s.on) throw new PolicyViolation('BANK_FEED_OFF', '은행 거래내역 자동 조회가 꺼져 있습니다 — 정책 › 전체 설정 acct.bank_feed 를 켜십시오(SUPER).');
  const today = kstToday();
  const to = b.to && YMD.test(b.to) ? b.to : today;
  const from = b.from && YMD.test(b.from) ? b.from : shift(to, -(s.days - 1));
  if (to > today || from > to || days(from, to) > 30) throw new PolicyViolation('BANK_FEED_RANGE', '기간은 오늘까지 · 31일 안입니다.');
  if (b.accountId && !/^\d{1,18}$/.test(b.accountId)) throw new NotFound('없는 계좌입니다.');
  const accs = await loadAccounts(db, b.accountId);
  if (!accs.length) throw new PolicyViolation('BANK_FEED_NO_ACCOUNT', b.accountId ? '쓰는 계좌가 아닙니다.' : '등록한(쓰는) 계좌가 없습니다.');
  const ad = bankFeedAdapter(s.mode);
  const out: RunOut[] = [];
  for (const a of accs) out.push(await runOne(db, ad, s.mode, a, from, to, actor));
  const added = out.reduce((n, x) => n + x.added, 0), dup = out.reduce((n, x) => n + x.dup, 0), failed = out.filter((x) => !x.ok).length;
  return { ok: true, mode: s.mode, from, to, results: out, added, dup, failed,
           note: `${from} ~ ${to} 계좌 ${out.length}개 — 새로 ${added} · 이미 있음 ${dup} · 실패 ${failed}.` };
}

/** 정기 작업 acct_bank_feed(매일 06:40) — 켜져 있을 때만 · 계좌마다 · 실패는 운영 알림 ACCT_BANK_FEED_FAIL(계좌 · 날마다 한 번) */
export async function acctBankFeedJob(db: DatabaseService) {
  const s = await settings(db);
  if (!s.on) return { on: false, runs: [] as RunOut[], alerts: 0 };
  let ad: BankFeedAdapter;
  try { ad = bankFeedAdapter(s.mode); } catch (e) {
    const key = `ready|${kstToday()}`;
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_BANK_FEED_FAIL', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_BANK_FEED_FAIL' AND detail->>'key' = $3) ON CONFLICT DO NOTHING`,
      ['은행 거래내역 자동 조회 — 금융결제원 사용자 토큰 · 키 · 이용기관코드가 없습니다(LIVE) — 회계 › 은행 자동 조회', JSON.stringify({ key }), key]);
    return { on: true, runs: [] as RunOut[], alerts: 1, error: (e as Error)?.message };
  }
  const to = kstToday(), from = shift(to, -(s.days - 1));
  const runs: RunOut[] = [];
  let alerts = 0;
  for (const a of await loadAccounts(db)) {
    const r = await runOne(db, ad, s.mode, a, from, to, null);
    runs.push(r);
    if (!r.ok) {
      const key = `${a.id}|${to}`;
      const ins = await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT 'ACCT_BANK_FEED_FAIL', 'WARN', $1, $2::jsonb, clock_timestamp()
          WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_BANK_FEED_FAIL' AND detail->>'key' = $3) ON CONFLICT DO NOTHING RETURNING id`,
        [`은행 거래내역 자동 조회 실패 — ${a.label}(****${a.last4}) · ${String(r.error ?? '').slice(0, 120)} — 회계 › 은행 자동 조회`, JSON.stringify({ key, account: a.id }), key]);
      alerts += ins.length;
    }
  }
  return { on: true, mode: s.mode, from, to, runs, alerts };
}
