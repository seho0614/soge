import { DatabaseService } from '../../db/database.service';
import { AppError, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { envInt, envJson, FetchLike, getPath, httpJson, normName } from '../../common/http-json';
import { Source, cr, dr } from './journal';

/* ---------------------------------------------------------------------
 * v10.454 (D261 · docs/591) 대량 이체 — 금융결제원 오픈뱅킹(대표 11/20 「금융결제원을 이용한다」)
 *
 *   어댑터 KftcTransfer(provider 'KFTC') — 금융결제원 오픈뱅킹 「이용기관」 API:
 *     ① 토큰   POST {base}/oauth/2.0/token (form · client_credentials · scope oob) — 만료 60초 전까지 메모리에 둠
 *     ② 수취조회 POST {base}/v2.0/inquiry/receive — 줄마다 받는 분 이름 확인 · 이름이 다르거나 계좌 오류면 그 줄 HOLD(보내지 않음)
 *     ③ 입금이체 POST {base}/v2.0/transfer/deposit/acnt_num — 약정 출금계좌(FIRMBANK_CNTR_ACCOUNT) · 한 번에 한 줄
 *        거래고유번호(bank_tran_id) = 이용기관코드(10자) + 'U' + 9자리 — DB 시퀀스로 만들고 줄에 저장(UNIQUE · 다시 쓰지 않음)
 *     ④ 결과조회 POST {base}/v2.0/transfer/result — 처리 중 · 응답 없음(PENDING)은 다시 보내지 않고 「결과 조회」로만 확정(이중 이체 막기)
 *   ★ 주소 · 경로 · 칸 이름은 「금융결제원 오픈뱅킹 v2.0 으로 알려진 값」 — 공식 개발자 가이드로 확인 필요(2026-11-20 확인 못 함).
 *     모두 .env FIRMBANK_MAP(JSON) 으로 바꿀 수 있음. 이용기관 등록(보안 점검 · 약정계좌 · 수수료)은 대표가 금융결제원에 확인.
 *
 *     acct.transfer       on | off(처음 off)          — 「보내기」만 막음(만들기 · 승인 · 결과 조회는 꺼져도 됨)
 *     acct.transfer_mode  ASSUME | LIVE(처음 ASSUME)   — ASSUME 은 금융결제원에 묻지 않고 간주 결과 · 전표 없음
 *     acct.transfer_max   한 묶음 합계 상한(처음 5천만 원)
 *   키: 외부 연동 › 연동 키 「FIRMBANK_CLIENT_ID」 · 「FIRMBANK_CLIENT_SECRET」(SUPER · 암호화)
 *   .env: FIRMBANK_ORG_CODE(이용기관코드) · FIRMBANK_CNTR_ACCOUNT(약정 출금계좌) · FIRMBANK_ENV(TEST 처음 · PROD) ·
 *         FIRMBANK_API_BASE(운영 주소) · FIRMBANK_TEST_BASE(시험 주소) · FIRMBANK_REQ_NAME(요청 고객 이름) · FIRMBANK_MAP · FIRMBANK_TIMEOUT_MS
 *   LIVE 인데 키 · 이용기관코드 · 약정계좌가 없으면 422 TRANSFER_NOT_READY(조용히 간주로 돌아가지 않음).
 *
 *   흐름: 묶음(DRAFT) → 줄 → 만든 사람이 아닌 2명 승인(APPROVED) → 보내기: 수취조회(돈 안 나감 · 실패면 묶음 그대로 APPROVED)
 *         → 거래고유번호 저장 + CHECKING(보냄 · 결과 확인 중) → 줄마다 입금이체 → 모두 확정이면 SENT · PARTIAL · FAILED
 *         → PENDING · 결과 없는 줄이 있으면 CHECKING 그대로 → 「결과 조회」(다시 보내지 않음)
 *   계좌번호는 암호문(pgp_sym_encrypt · fn_enc_key)으로만 저장 · 화면 · API 는 끝 4자리만 · 보낼 때만 풀어 넘김.
 *   LIVE 로 OK 난 줄만 전표 TRANSFER_PAID(차변 낸 계정(처음 AP 미지급금) / 대변 CASH 보통예금 · 거래처 = 받는 분) — 간주는 전표 없음.
 * ------------------------------------------------------------------- */

export const TRANSFER_STATES = ['DRAFT', 'APPROVED', 'CHECKING', 'SENT', 'PARTIAL', 'FAILED', 'CANCELED'] as const;
export const TRANSFER_STATE_KO: Record<string, string> = { DRAFT: '승인 기다림', APPROVED: '승인됨(보내기 전)', CHECKING: '보냄 · 결과 확인 중', SENT: '보냄', PARTIAL: '일부 실패', FAILED: '실패', CANCELED: '취소' };
export const TRANSFER_RESULT_KO: Record<string, string> = { OK: '성공', FAIL: '실패', ASSUMED: '간주', HOLD: '보내지 않음(수취조회)', PENDING: '처리 중(결과 조회)' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const BANK = /^[0-9]{3}$/;                 // DB CHECK acct_transfer_items.bank_code 와 같음
const ACCT_NO = /^[0-9-]{6,24}$/;          // 입력 모양(하이픈 허용) — 숫자만 6 ~ 20자리로 줄여 저장
const ORG = /^[A-Za-z0-9]{10}$/;           // 이용기관코드 10자 — DB CHECK bank_tran_id(^[A-Za-z0-9]{10}U[0-9]{9}$) 와 같음
const ASSUME_ORG = 'SGBASSUME0';           // 간주 때 거래고유번호 앞 10자
const MAX_ITEMS = 200;                      // DB CHECK item_count 와 같음
const PAY_ROLES = ['AP', 'CARD_AP', 'ACCRUED', 'WAGE_AP', 'EXP_ETC'];   // 낸 계정 기본 후보(실제는 acct_accounts 에 있는 것만)
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstStamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[^0-9]/g, '').slice(0, 14);   // yyyyMMddHHmmss
const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');
const mask = (n: string) => (n.length <= 1 ? '*' : n.length === 2 ? n.charAt(0) + '*' : n.charAt(0) + '*'.repeat(n.length - 2) + n.charAt(n.length - 1));
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id))) throw new NotFound('없는 이체 묶음입니다.'); return String(id); };
const reasonOk = (r?: string, code = 'ACCT_REASON') => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return t;
};

export interface TransferOrder { id: string; payee: string; bankCode: string; accountNo: string; amount: number; memo: string | null; tranId?: string; tranDate?: string }
export type TransferResult = 'OK' | 'FAIL' | 'ASSUMED' | 'HOLD' | 'PENDING';
export interface TransferOutcome { id: string; result: TransferResult; code?: string; bankCode?: string; message?: string; txId?: string }
export interface TransferAdapter {
  readonly name: 'assume' | 'kftc';
  /** 수취조회 — 돈이 나가지 않음 · ok=false 면 아무 줄도 보내지 않음 · holds 는 그 줄만 보내지 않음 */
  prepare(orders: TransferOrder[], nextTranId: () => Promise<string>): Promise<{ ok: boolean; holds: TransferOutcome[]; errorKind?: string; error?: string }>;
  /** 입금이체 한 줄 — 응답이 없거나 처리 중이면 PENDING(다시 보내지 않음) */
  deposit(order: TransferOrder): Promise<TransferOutcome>;
  /** 결과조회 한 줄 — 아직 모르면 PENDING */
  check(order: TransferOrder): Promise<TransferOutcome>;
}

/** 간주 — 금융결제원에 묻지 않음. 받는 분 이름 앞머리로 시험: 「(간주 실패)」 실패 · 「(간주 이름다름)」 HOLD · 「(간주 처리중)」 PENDING → 결과 조회 때 간주 */
export class AssumeTransfer implements TransferAdapter {
  readonly name = 'assume' as const;
  async prepare(orders: TransferOrder[]) {
    return { ok: true, holds: orders.filter((o) => o.payee.startsWith('(간주 이름다름)'))
      .map((o): TransferOutcome => ({ id: o.id, result: 'HOLD', code: 'ASSUME_NAME', message: '(간주) 받는 분 이름이 은행과 다릅니다 — 보내지 않았습니다' })) };
  }
  async deposit(o: TransferOrder): Promise<TransferOutcome> {
    if (o.payee.startsWith('(간주 실패)')) return { id: o.id, result: 'FAIL', code: 'ASSUME_FAIL', message: '(간주) 받는 계좌 확인 실패', txId: o.tranId };
    if (o.payee.startsWith('(간주 처리중)')) return { id: o.id, result: 'PENDING', code: 'ASSUME_PENDING', message: '(간주) 처리 중 — 결과 조회로 확정합니다', txId: o.tranId };
    return { id: o.id, result: 'ASSUMED', code: 'ASSUME', message: '(간주) 은행에 보내지 않았습니다', txId: o.tranId };
  }
  async check(o: TransferOrder): Promise<TransferOutcome> {
    return { id: o.id, result: 'ASSUMED', code: 'ASSUME', message: '(간주) 결과 조회 — 간주로 확정', txId: o.tranId };
  }
}

/** 경로 · 칸 · 코드 — 금융결제원 오픈뱅킹 v2.0 으로 알려진 값(공식 가이드로 확인 필요) · .env FIRMBANK_MAP(JSON)로 고침 */
const MAP_DEFAULT = {
  token: '/oauth/2.0/token', scope: 'oob', receive: '/v2.0/inquiry/receive', deposit: '/v2.0/transfer/deposit/acnt_num', result: '/v2.0/transfer/result',
  rspCode: 'rsp_code', rspMessage: 'rsp_message', okCode: 'A0000', pendingCodes: ['A0007'],
  holder: 'account_holder_name', resList: 'res_list', bankRspCode: 'bank_rsp_code', bankRspMessage: 'bank_rsp_message', bankOk: ['000'], bankPending: ['400'],
  checkType: '2', cntrType: 'N', purpose: 'TR',
};
type KftcMap = typeof MAP_DEFAULT;
let tokenCache: { key: string; token: string; exp: number } | null = null;

/** 금융결제원 오픈뱅킹 — 점검판에서는 부르지 않음(간주만). 실제 주소 · 칸은 계약 · 공식 가이드로 확인 뒤 FIRMBANK_MAP 만 고치면 됨 */
export class KftcTransfer implements TransferAdapter {
  readonly name = 'kftc' as const;
  constructor(private readonly fetchFn?: FetchLike) {}
  static ready() {
    return !!(process.env.FIRMBANK_CLIENT_ID && process.env.FIRMBANK_CLIENT_SECRET && ORG.test(process.env.FIRMBANK_ORG_CODE ?? '') && digits(process.env.FIRMBANK_CNTR_ACCOUNT).length >= 6);
  }
  static orgCode() { return String(process.env.FIRMBANK_ORG_CODE ?? ''); }
  static base() {
    const prod = String(process.env.FIRMBANK_ENV ?? 'TEST').toUpperCase() === 'PROD';
    const b = prod ? (process.env.FIRMBANK_API_BASE || 'https://openapi.openbanking.or.kr') : (process.env.FIRMBANK_TEST_BASE || 'https://testapi.openbanking.or.kr');
    return b.replace(/\/+$/, '');
  }
  private map(): KftcMap { return { ...MAP_DEFAULT, ...(envJson('FIRMBANK_MAP', MAP_DEFAULT).value as Partial<KftcMap>) }; }
  private timeout() { return envInt('FIRMBANK_TIMEOUT_MS', 20000); }

  /** ① 토큰 — form-urlencoded · 만료 60초 전까지 다시 쓰기 */
  private async token(m: KftcMap): Promise<{ ok: boolean; token?: string; error?: string }> {
    const base = KftcTransfer.base(), id = String(process.env.FIRMBANK_CLIENT_ID);
    const key = `${base}|${id}`;
    if (tokenCache && tokenCache.key === key && tokenCache.exp - 60_000 > Date.now()) return { ok: true, token: tokenCache.token };
    const f = this.fetchFn ?? (fetch as unknown as FetchLike);
    try {
      const res = await f(`${base}${m.token}`, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: id, client_secret: String(process.env.FIRMBANK_CLIENT_SECRET), scope: m.scope, grant_type: 'client_credentials' }).toString(),
        signal: AbortSignal.timeout(this.timeout()),
      });
      const text = await res.text();
      let body: any = null; try { body = JSON.parse(text); } catch { body = null; }
      const tok = body?.access_token;
      if (!res.ok || !tok) return { ok: false, error: `토큰 실패(HTTP ${res.status} ${String(body?.rsp_code ?? '')})`.trim() };
      tokenCache = { key, token: String(tok), exp: Date.now() + Math.max(60, Number(body?.expires_in) || 3600) * 1000 };
      return { ok: true, token: tokenCache.token };
    } catch (e) {
      return { ok: false, error: `토큰 실패(${(e as Error)?.name === 'TimeoutError' ? '시간 넘음' : '연결 안 됨'})` };
    }
  }
  private reqName() { return String(process.env.FIRMBANK_REQ_NAME || '한국바이오헬스케어').slice(0, 20); }

  /** ② 수취조회 — 줄마다(돈 안 나감) · 토큰 · 연결 실패면 ok=false(아무 줄도 안 보냄) */
  async prepare(orders: TransferOrder[], nextTranId: () => Promise<string>) {
    if (!KftcTransfer.ready()) return { ok: false, holds: [], errorKind: 'NOT_CONFIGURED', error: '키 · 이용기관코드 · 약정계좌가 없습니다' };
    const m = this.map();
    const t = await this.token(m);
    if (!t.ok) return { ok: false, holds: [], errorKind: 'AUTH', error: t.error };
    const holds: TransferOutcome[] = [];
    for (const o of orders) {
      const r = await httpJson({
        url: `${KftcTransfer.base()}${m.receive}`, method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, timeoutMs: this.timeout(), fetchFn: this.fetchFn,
        body: { bank_tran_id: await nextTranId(), cntr_account_type: m.cntrType, cntr_account_num: digits(process.env.FIRMBANK_CNTR_ACCOUNT),
                bank_code_std: o.bankCode, account_num: o.accountNo, print_content: (o.memo ?? '').slice(0, 20), tran_amt: String(o.amount),
                req_client_name: this.reqName(), req_client_num: `SGB${o.id}`.slice(0, 20), transfer_purpose: m.purpose, tran_dtime: kstStamp() },
      });
      if (!r.ok) return { ok: false, holds: [], errorKind: r.errorKind ?? 'UPSTREAM', error: `수취조회 ${r.error ?? ''}`.trim() };
      const code = String(getPath(r.body, m.rspCode) ?? '');
      const holder = String(getPath(r.body, m.holder) ?? '');
      if (code !== m.okCode) {
        holds.push({ id: o.id, result: 'HOLD', code: code.slice(0, 40) || 'RECEIVE_FAIL', bankCode: String(getPath(r.body, m.bankRspCode) ?? '').slice(0, 10) || undefined,
                     message: `수취조회 실패 — ${String(getPath(r.body, m.rspMessage) ?? '').slice(0, 120)} · 보내지 않았습니다` });
      } else if (!holder || normName(holder) !== normName(o.payee)) {
        holds.push({ id: o.id, result: 'HOLD', code: 'NAME_MISMATCH', message: `받는 분 이름이 은행과 다릅니다(은행: ${mask(holder.trim())}) — 보내지 않았습니다` });
      }
    }
    return { ok: true, holds };
  }

  private outcome(o: TransferOrder, r: Awaited<ReturnType<typeof httpJson>>, m: KftcMap, what: string): TransferOutcome {
    /* 응답이 없거나 서버 쪽 오류 — 돈이 나갔는지 모름 → PENDING(다시 보내지 않음 · 결과 조회) */
    if (!r.ok && ['TIMEOUT', 'NETWORK', 'UPSTREAM', 'BAD_RESPONSE'].includes(String(r.errorKind))) {
      return { id: o.id, result: 'PENDING', code: String(r.errorKind), message: `${what} 응답 없음(${r.error ?? ''}) — 결과 조회로 확정합니다`.slice(0, 200), txId: o.tranId };
    }
    if (!r.ok) return { id: o.id, result: 'FAIL', code: String(r.errorKind ?? 'HTTP'), message: `${what} 거절(${r.error ?? ''})`.slice(0, 200), txId: o.tranId };
    const code = String(getPath(r.body, m.rspCode) ?? '');
    const list = getPath(r.body, m.resList);
    const row = Array.isArray(list) ? list[0] : undefined;
    const bank = String(getPath(row, m.bankRspCode) ?? '');
    const msg = String(getPath(row, m.bankRspMessage) ?? getPath(r.body, m.rspMessage) ?? '').slice(0, 160);
    const base = { id: o.id, code: code.slice(0, 40) || undefined, bankCode: bank.slice(0, 10) || undefined, txId: o.tranId };
    if (m.pendingCodes.includes(code) || (code === m.okCode && m.bankPending.includes(bank))) return { ...base, result: 'PENDING', message: `${what} 처리 중 — 결과 조회로 확정합니다 ${msg}`.trim() };
    if (code === m.okCode && m.bankOk.includes(bank)) return { ...base, result: 'OK', message: msg || undefined };
    return { ...base, result: 'FAIL', message: `${what} 실패 ${msg}`.trim() };
  }

  /** ③ 입금이체 — 한 줄씩 · 거래고유번호는 DB 에 저장된 값(o.tranId) */
  async deposit(o: TransferOrder): Promise<TransferOutcome> {
    const m = this.map();
    const t = await this.token(m);
    if (!t.ok) return { id: o.id, result: 'FAIL', code: 'AUTH', message: t.error, txId: o.tranId };   // 토큰이 없으면 요청 자체를 안 보냄 → 안 나감
    const r = await httpJson({
      url: `${KftcTransfer.base()}${m.deposit}`, method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, timeoutMs: this.timeout(), fetchFn: this.fetchFn,
      body: { cntr_account_type: m.cntrType, cntr_account_num: digits(process.env.FIRMBANK_CNTR_ACCOUNT), wd_pass_phrase: 'NONE', wd_print_content: '소개뱅크',
              name_check_option: 'on', tran_dtime: kstStamp(), req_cnt: '1',
              req_list: [{ tran_no: '1', bank_tran_id: o.tranId, bank_code_std: o.bankCode, account_num: o.accountNo, account_holder_name: o.payee,
                           print_content: (o.memo ?? '').slice(0, 20), tran_amt: String(o.amount), req_client_name: this.reqName(),
                           req_client_num: `SGB${o.id}`.slice(0, 20), transfer_purpose: m.purpose }] },
    });
    return this.outcome(o, r, m, '입금이체');
  }

  /** ④ 결과조회 — 다시 보내지 않고 원거래(거래고유번호 · 날짜 · 금액)로 확인 */
  async check(o: TransferOrder): Promise<TransferOutcome> {
    const m = this.map();
    const t = await this.token(m);
    if (!t.ok) return { id: o.id, result: 'PENDING', code: 'AUTH', message: `${t.error} — 다시 결과 조회`, txId: o.tranId };
    const r = await httpJson({
      url: `${KftcTransfer.base()}${m.result}`, method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, timeoutMs: this.timeout(), fetchFn: this.fetchFn,
      body: { check_type: m.checkType, tran_dtime: kstStamp(), req_cnt: '1',
              req_list: [{ tran_no: '1', org_bank_tran_id: o.tranId, org_bank_tran_date: (o.tranDate ?? kstToday()).replace(/-/g, ''), org_tran_amt: String(o.amount) }] },
    });
    const x = this.outcome(o, r, m, '결과조회');
    return x.result === 'FAIL' && !r.ok ? { ...x, result: 'PENDING', message: `${x.message} — 다시 결과 조회` } : x;   // 조회가 막힌 것은 확정 실패가 아님
  }
}

async function settings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('acct.transfer', 'acct.transfer_mode', 'acct.transfer_max')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const max = Number(v('acct.transfer_max') ?? 50_000_000);
  return { on: v('acct.transfer') === 'on', mode: v('acct.transfer_mode') === 'LIVE' ? 'LIVE' as const : 'ASSUME' as const, max: Number.isFinite(max) && max > 0 ? max : 50_000_000 };
}

export function transferAdapter(mode: 'ASSUME' | 'LIVE', fetchFn?: FetchLike): TransferAdapter {
  if (mode !== 'LIVE') return new AssumeTransfer();
  if (!KftcTransfer.ready()) throw new PolicyViolation('TRANSFER_NOT_READY', '금융결제원 키(FIRMBANK_CLIENT_ID · FIRMBANK_CLIENT_SECRET) · 이용기관코드 · 약정계좌가 없습니다 — 외부 연동 › 연동 키와 .env 를 넣거나 간주(ASSUME)로 두십시오.');
  return new KftcTransfer(fetchFn);
}

/** GET /admin/fin/transfers — 묶음 목록 · 상태 · 설정 · 낸 계정 후보 */
export async function listTransfers(db: DatabaseService, state?: string) {
  const s = await settings(db);
  const st = (TRANSFER_STATES as readonly string[]).includes(state ?? '') ? state! : '';
  const items = await db.query(
    `SELECT b.id::text AS id, b.title, b.pay_on::text AS "payOn", b.state, b.mode, b.item_count AS "itemCount", b.total::bigint AS total,
            c.name AS "createdBy", b.created_by::text AS "createdById", b.created_at AS "createdAt", b.approved_at AS "approvedAt", b.sent_at AS "sentAt",
            (SELECT count(*)::int FROM acct_transfer_approvals a WHERE a.batch_id = b.id) AS approvals,
            (SELECT count(*)::int FROM acct_transfer_items i WHERE i.batch_id = b.id AND i.result IN ('FAIL', 'HOLD')) AS failed,
            (SELECT count(*)::int FROM acct_transfer_items i WHERE i.batch_id = b.id AND b.state = 'CHECKING' AND (i.result IS NULL OR i.result = 'PENDING')) AS pending
       FROM acct_transfer_batches b LEFT JOIN accounts c ON c.id = b.created_by
      WHERE ($1::text = '' OR b.state = $1::text) ORDER BY (b.state IN ('SENT', 'PARTIAL', 'FAILED', 'CANCELED')), b.pay_on DESC, b.id DESC LIMIT 200`, [st]);
  const roles = await db.query(`SELECT role, name FROM acct_accounts WHERE kind = 'LIABILITY' OR role = ANY($1::text[]) ORDER BY sort`, [PAY_ROLES]);
  return { on: s.on, mode: s.mode, max: s.max, ready: s.mode === 'ASSUME' || KftcTransfer.ready(), provider: 'KFTC', env: String(process.env.FIRMBANK_ENV ?? 'TEST').toUpperCase() === 'PROD' ? 'PROD' : 'TEST', states: TRANSFER_STATE_KO, results: TRANSFER_RESULT_KO, items, payRoles: roles,
    note: s.on ? (s.mode === 'ASSUME' ? '간주(ASSUME) — 은행에 보내지 않고 결과만 「간주」로 남깁니다(전표 없음).' : 'LIVE — 승인된 묶음을 은행으로 보냅니다.')
               : '보내기 꺼짐(acct.transfer off) — 묶음 만들기 · 승인은 할 수 있습니다.' };
}

/** GET /admin/fin/transfers/{id} — 묶음 · 줄(계좌는 끝 4자리) · 승인한 사람 */
export async function transferDetail(db: DatabaseService, idIn: string) {
  const id = idOk(idIn);
  const [b] = await db.query<Record<string, any>>(
    `SELECT b.id::text AS id, b.title, b.pay_on::text AS "payOn", b.state, b.mode, b.item_count AS "itemCount", b.total::bigint AS total,
            b.created_by::text AS "createdById", c.name AS "createdBy", b.created_at AS "createdAt", b.approved_at AS "approvedAt",
            s.name AS "sentBy", b.sent_at AS "sentAt", b.canceled_at AS "canceledAt", b.cancel_note AS "cancelNote"
       FROM acct_transfer_batches b LEFT JOIN accounts c ON c.id = b.created_by LEFT JOIN accounts s ON s.id = b.sent_by WHERE b.id = $1::bigint`, [id]);
  if (!b) throw new NotFound('없는 이체 묶음입니다.');
  const lines = await db.query(
    `SELECT i.id::text AS id, i.party_id::text AS "partyId", i.payee, i.bank_code AS "bankCode", '****' || i.acct_last4 AS "account", i.amount::bigint AS amount,
            i.pay_role AS "payRole", a.name AS "payRoleName", i.memo, i.result, i.result_code AS "resultCode", i.result_msg AS "resultMsg", i.bank_rsp_code AS "bankRspCode", i.bank_tran_id AS "tranId", i.bank_tx_id AS "bankTxId", i.done_at AS "doneAt",
            (SELECT e.id::text FROM acct_entries e WHERE e.source = 'TRANSFER_PAID' AND e.source_key = i.id::text) AS "entryId"
       FROM acct_transfer_items i LEFT JOIN acct_accounts a ON a.role = i.pay_role WHERE i.batch_id = $1::bigint ORDER BY i.id`, [id]);
  const approvals = await db.query(
    `SELECT p.approver::text AS "approverId", a.name AS approver, p.note, p.approved_at AS "approvedAt"
       FROM acct_transfer_approvals p LEFT JOIN accounts a ON a.id = p.approver WHERE p.batch_id = $1::bigint ORDER BY p.approved_at`, [id]);
  return { batch: b, lines, approvals, stateKo: TRANSFER_STATE_KO[b.state] ?? b.state, results: TRANSFER_RESULT_KO };
}

/** POST /admin/fin/transfers — 새 묶음(DRAFT) */
export async function createTransfer(db: DatabaseService, b: { title: string; payOn?: string }, actor: string | null) {
  if (!actor) throw new AppError(403, { code: 'FORBIDDEN', message: '로그인한 운영자만 만듭니다.' });
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('TRANSFER_TITLE', '묶음 이름은 2 ~ 80자입니다.');
  const payOn = b.payOn && YMD.test(b.payOn) ? b.payOn : kstToday();
  if (payOn < kstToday()) throw new PolicyViolation('TRANSFER_DATE', '지급일은 오늘이나 그 뒤입니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_transfer_batches (title, pay_on, created_by) VALUES ($1, $2::date, $3::uuid) RETURNING id::text AS id`, [title, payOn, actor]);
  return { ok: true, id: r!.id, note: `이체 묶음 「${title}」을 만들었습니다 — 줄을 넣고 다른 두 사람의 승인을 받으십시오.` };
}

async function lockBatch(db: DatabaseService, id: string) {
  const [b] = await db.query<{ state: string; created_by: string; title: string; pay_on: string; mode: string | null }>(
    `SELECT state, created_by::text AS created_by, title, pay_on::text AS pay_on, mode FROM acct_transfer_batches WHERE id = $1::bigint FOR UPDATE`, [id]);
  if (!b) throw new NotFound('없는 이체 묶음입니다.');
  return b;
}

async function recount(db: DatabaseService, id: string) {
  await db.query(
    `UPDATE acct_transfer_batches b SET item_count = x.n, total = x.s
       FROM (SELECT count(*)::int AS n, coalesce(sum(amount), 0)::bigint AS s FROM acct_transfer_items WHERE batch_id = $1::bigint) x
      WHERE b.id = $1::bigint`, [id]);
}

export interface TransferItemIn { partyId?: string; payee: string; bankCode: string; accountNo: string; amount: number; payRole?: string; memo?: string }

/** POST /admin/fin/transfers/{id}/items — 줄 넣기(DRAFT · 한 번에 100줄 · 묶음 200줄 · 합계 상한) */
export async function addTransferItems(db: DatabaseService, idIn: string, items: TransferItemIn[]) {
  const id = idOk(idIn);
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new PolicyViolation('TRANSFER_ITEMS', '한 번에 1 ~ 100줄을 넣습니다.');
  const s = await settings(db);
  const roles = new Set((await db.query<{ role: string }>(`SELECT role FROM acct_accounts`)).map((r) => r.role));
  const clean = items.map((x, i) => {
    const payee = (x.payee ?? '').replace(/\s+/g, ' ').trim();
    if (payee.length < 1 || payee.length > 40) throw new PolicyViolation('TRANSFER_PAYEE', `${i + 1}번째 줄: 받는 분은 1 ~ 40자입니다.`);
    if (!BANK.test(String(x.bankCode ?? ''))) throw new PolicyViolation('TRANSFER_BANK', `${i + 1}번째 줄: 은행 코드는 숫자 3자리입니다.`);
    const acc = digits(x.accountNo);
    if (!ACCT_NO.test(String(x.accountNo ?? '')) || acc.length < 6 || acc.length > 20) throw new PolicyViolation('TRANSFER_ACCOUNT', `${i + 1}번째 줄: 계좌번호는 숫자 6 ~ 20자리입니다.`);
    const amount = Number(x.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) throw new PolicyViolation('TRANSFER_AMOUNT', `${i + 1}번째 줄: 금액은 1원 ~ 10억 원 정수입니다.`);
    const payRole = (x.payRole ?? 'AP').trim();
    if (!roles.has(payRole)) throw new PolicyViolation('TRANSFER_ROLE', `${i + 1}번째 줄: 없는 계정입니다(${payRole}).`);
    const partyId = x.partyId && /^\d{1,18}$/.test(String(x.partyId)) ? String(x.partyId) : null;
    return { payee, bankCode: String(x.bankCode), acc, last4: acc.slice(-4), amount, payRole, partyId, memo: (x.memo ?? '').trim().slice(0, 20) || null };
  });
  return db.transaction(async () => {
    const b = await lockBatch(db, id);
    if (b.state !== 'DRAFT') throw new StateConflict('TRANSFER_STATE', '승인을 받은 묶음에는 줄을 넣지 않습니다(취소하고 새로).');
    const [cur] = await db.query<{ n: number; s: string }>(`SELECT count(*)::int AS n, coalesce(sum(amount), 0)::text AS s FROM acct_transfer_items WHERE batch_id = $1::bigint`, [id]);
    const n = Number(cur?.n ?? 0) + clean.length, sum = Number(cur?.s ?? 0) + clean.reduce((a, x) => a + x.amount, 0);
    if (n > MAX_ITEMS) throw new PolicyViolation('TRANSFER_ITEMS', `한 묶음은 ${MAX_ITEMS}줄까지입니다.`);
    if (sum > s.max) throw new PolicyViolation('TRANSFER_MAX', `한 묶음 합계 상한 ${s.max.toLocaleString('ko-KR')}원을 넘습니다(acct.transfer_max).`);
    if (clean.some((x) => x.partyId)) {
      const ids = [...new Set(clean.map((x) => x.partyId).filter(Boolean))] as string[];
      const [c] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_parties WHERE id = ANY($1::bigint[])`, [ids]);
      if (Number(c?.n ?? 0) !== ids.length) throw new PolicyViolation('TRANSFER_PARTY', '없는 거래처가 있습니다.');
    }
    for (const x of clean) {
      await db.query(
        `INSERT INTO acct_transfer_items (batch_id, party_id, payee, bank_code, acct_no_enc, acct_last4, amount, pay_role, memo)
         VALUES ($1::bigint, $2::bigint, $3, $4, pgp_sym_encrypt($5::text, fn_enc_key()), $6, $7::bigint, $8, $9)`,
        [id, x.partyId, x.payee, x.bankCode, x.acc, x.last4, x.amount, x.payRole, x.memo]);
    }
    await recount(db, id);
    return { ok: true, id, added: clean.length, itemCount: n, total: sum, note: `${clean.length}줄을 넣었습니다(묶음 ${n}줄 · ${sum.toLocaleString('ko-KR')}원).` };
  });
}

/** POST /admin/fin/transfers/{id}/items/{itemId}/remove — 줄 빼기(DRAFT) */
export async function removeTransferItem(db: DatabaseService, idIn: string, itemIn: string) {
  const id = idOk(idIn), item = idOk(itemIn);
  return db.transaction(async () => {
    const b = await lockBatch(db, id);
    if (b.state !== 'DRAFT') throw new StateConflict('TRANSFER_STATE', '승인을 받은 묶음의 줄은 빼지 않습니다(취소하고 새로).');
    const del = await db.query(`DELETE FROM acct_transfer_items WHERE id = $1::bigint AND batch_id = $2::bigint RETURNING id`, [item, id]);
    if (!del.length) throw new NotFound('없는 줄입니다.');
    await recount(db, id);
    return { ok: true, id, note: '줄을 뺐습니다.' };
  });
}

/** POST /admin/fin/transfers/{id}/approve — 만든 사람이 아닌 사람 · 한 사람 한 번 · 2명째에 APPROVED */
export async function approveTransfer(db: DatabaseService, idIn: string, actor: string | null, note?: string) {
  const id = idOk(idIn);
  if (!actor) throw new AppError(403, { code: 'FORBIDDEN', message: '로그인한 운영자만 승인합니다.' });
  return db.transaction(async () => {
    const b = await lockBatch(db, id);
    if (b.state !== 'DRAFT') throw new StateConflict('TRANSFER_STATE', '승인을 기다리는 묶음이 아닙니다.');
    if (b.created_by === actor) throw new PolicyViolation('TRANSFER_SELF', '만든 사람은 승인하지 않습니다 — 다른 두 사람이 승인합니다.');
    const [cnt] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_transfer_items WHERE batch_id = $1::bigint`, [id]);
    if (!Number(cnt?.n ?? 0)) throw new PolicyViolation('TRANSFER_ITEMS', '줄이 없는 묶음은 승인하지 않습니다.');
    const ins = await db.query(`INSERT INTO acct_transfer_approvals (batch_id, approver, note) VALUES ($1::bigint, $2::uuid, $3) ON CONFLICT DO NOTHING RETURNING approver`,
      [id, actor, (note ?? '').trim().slice(0, 200) || null]);
    if (!ins.length) throw new StateConflict('TRANSFER_APPROVED', '이미 승인했습니다 — 다른 사람의 승인을 기다립니다.');
    const [a] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_transfer_approvals WHERE batch_id = $1::bigint AND approver <> $2::uuid`, [id, b.created_by]);
    const n = Number(a?.n ?? 0);
    if (n >= 2) {
      await recount(db, id);
      await db.query(`UPDATE acct_transfer_batches SET state = 'APPROVED', approved_at = now() WHERE id = $1::bigint`, [id]);
      return { ok: true, id, approvals: n, state: 'APPROVED', note: '두 사람이 승인했습니다 — 이제 보낼 수 있습니다.' };
    }
    return { ok: true, id, approvals: n, state: 'DRAFT', note: `승인했습니다(${n} / 2) — 한 사람 더 승인해야 합니다.` };
  });
}

/** POST /admin/fin/transfers/{id}/cancel — 보내기 전(DRAFT · APPROVED) · 사유 */
export async function cancelTransfer(db: DatabaseService, idIn: string, reason: string) {
  const id = idOk(idIn);
  const note = reasonOk(reason, 'TRANSFER_REASON');
  return db.transaction(async () => {
    const b = await lockBatch(db, id);
    if (!['DRAFT', 'APPROVED'].includes(b.state)) throw new StateConflict('TRANSFER_STATE', '보낸 · 취소한 묶음은 취소하지 않습니다.');
    await db.query(`UPDATE acct_transfer_batches SET state = 'CANCELED', canceled_at = now(), cancel_note = $2 WHERE id = $1::bigint`, [id, note]);
    return { ok: true, id, note: '이체 묶음을 취소했습니다.' };
  });
}

/** 줄 결과 한 번 남기기 — NULL → 결과(APPROVED · CHECKING) · PENDING → OK · FAIL · ASSUMED(CHECKING) · 그 밖은 DB 가 막음 */
async function writeResult(db: DatabaseService, batchId: string, x: TransferOutcome) {
  await db.query(
    `UPDATE acct_transfer_items SET result = $2::text, result_code = $3, result_msg = $4, bank_rsp_code = $5, bank_tx_id = coalesce($6, bank_tx_id), done_at = now()
      WHERE id = $1::bigint AND batch_id = $7::bigint AND (result IS NULL OR (result = 'PENDING' AND $2::text <> 'PENDING'))`,
    [x.id, x.result, x.code?.slice(0, 40) ?? null, x.message?.slice(0, 200) ?? null, x.bankCode?.slice(0, 10) ?? null, x.txId?.slice(0, 60) ?? null, batchId]);
}

/** 묶음 끝내기 — 결과 없는 줄 · PENDING 이 없을 때만 SENT · PARTIAL · FAILED · 아니면 CHECKING 그대로 */
async function settle(db: DatabaseService, batchId: string) {
  const [c] = await db.query<{ ok: number; bad: number; open: number; assumed: number; hold: number }>(
    `SELECT count(*) FILTER (WHERE result IN ('OK', 'ASSUMED'))::int AS ok, count(*) FILTER (WHERE result IN ('FAIL', 'HOLD'))::int AS bad,
            count(*) FILTER (WHERE result IS NULL OR result = 'PENDING')::int AS open, count(*) FILTER (WHERE result = 'ASSUMED')::int AS assumed,
            count(*) FILTER (WHERE result = 'HOLD')::int AS hold
       FROM acct_transfer_items WHERE batch_id = $1::bigint`, [batchId]);
  const ok = Number(c?.ok ?? 0), bad = Number(c?.bad ?? 0), open = Number(c?.open ?? 0);
  if (open > 0) return { state: 'CHECKING', ok, bad, open, assumed: Number(c?.assumed ?? 0), hold: Number(c?.hold ?? 0) };
  const state = bad === 0 ? 'SENT' : ok === 0 ? 'FAILED' : 'PARTIAL';
  await db.query(`UPDATE acct_transfer_batches SET state = $2 WHERE id = $1::bigint AND state = 'CHECKING'`, [batchId, state]);
  return { state, ok, bad, open, assumed: Number(c?.assumed ?? 0), hold: Number(c?.hold ?? 0) };
}

/** POST /admin/fin/transfers/{id}/send — APPROVED · acct.transfer on
 *  ① 수취조회(돈 안 나감 · 실패면 APPROVED 그대로) ② 거래고유번호 저장 + CHECKING ③ 줄마다 입금이체 · 결과 바로 저장 ④ 모두 확정이면 끝 */
export async function sendTransfer(db: DatabaseService, idIn: string, actor: string | null, fetchFn?: FetchLike) {
  const id = idOk(idIn);
  const s = await settings(db);
  if (!s.on) throw new PolicyViolation('TRANSFER_OFF', '대량 이체 보내기가 꺼져 있습니다 — 정책 › 전체 설정 acct.transfer 를 켜십시오(SUPER).');
  const ad = transferAdapter(s.mode, fetchFn);
  const org = s.mode === 'LIVE' ? KftcTransfer.orgCode() : ASSUME_ORG;
  const nextTranId = async () => {
    const [r] = await db.query<{ t: string }>(`SELECT fn_acct_transfer_tran_id($1) AS t`, [org]);
    return r!.t;
  };
  /* ① 상태 확인 · 주문(계좌는 이때만 풀어 씀) */
  const b0 = await lockFree(db, id);
  if (b0.state !== 'APPROVED') throw new StateConflict('TRANSFER_STATE', b0.state === 'CHECKING' ? '이미 보낸 묶음입니다 — 「결과 조회」로 확정하십시오(다시 보내지 않음).' : '두 사람이 승인한 묶음만 보냅니다.');
  const orders = await ordersOf(db, id, 'new');
  if (!orders.length) throw new StateConflict('TRANSFER_STATE', '보낼 줄이 없습니다.');
  const pre = await ad.prepare(orders, nextTranId);
  if (!pre.ok) throw new PolicyViolation('TRANSFER_UPSTREAM', `금융결제원 수취조회가 되지 않았습니다(${pre.errorKind ?? ''} ${pre.error ?? ''}) — 아무 줄도 보내지 않았습니다. 잠시 뒤 다시 보내십시오.`.replace(/\s+/g, ' '));
  const held = new Set(pre.holds.map((h) => h.id));
  /* ② 잠그고 — HOLD 줄 결과 · 보낼 줄 거래고유번호 저장 · CHECKING(이 뒤로는 다시 보내지 않음) */
  const sendList = await db.transaction(async () => {
    const b = await lockBatch(db, id);
    if (b.state !== 'APPROVED') throw new StateConflict('TRANSFER_STATE', '그 사이 묶음 상태가 바뀌었습니다 — 화면을 새로 보십시오.');
    for (const h of pre.holds) await writeResult(db, id, h);
    const list: TransferOrder[] = [];
    for (const o of orders) {
      if (held.has(o.id)) continue;
      const tranId = await nextTranId();
      const up = await db.query(`UPDATE acct_transfer_items SET bank_tran_id = $2 WHERE id = $1::bigint AND batch_id = $3::bigint AND bank_tran_id IS NULL AND result IS NULL RETURNING id`, [o.id, tranId, id]);
      if (up.length) list.push({ ...o, tranId, tranDate: kstToday() });
    }
    await db.query(`UPDATE acct_transfer_batches SET state = 'CHECKING', mode = $2, sent_by = $3::uuid, sent_at = now() WHERE id = $1::bigint`, [id, s.mode, actor]);
    return list;
  });
  /* ③ 줄마다 입금이체 — 결과는 줄마다 바로 남김(중간에 멈춰도 결과 없는 줄은 「결과 조회」로) */
  for (const o of sendList) {
    let x: TransferOutcome;
    try { x = await ad.deposit(o); } catch (e) { x = { id: o.id, result: 'PENDING', code: 'ERROR', message: `보내는 중 오류(${(e as Error)?.message ?? ''}) — 결과 조회로 확정합니다`.slice(0, 200), txId: o.tranId }; }
    await writeResult(db, id, x);
  }
  const r = await settle(db, id);
  return { ok: true, id, state: r.state, mode: s.mode, sent: s.mode === 'LIVE' ? r.ok : 0, assumed: r.assumed, failed: r.bad - r.hold, held: r.hold, pending: r.open,
    note: r.state === 'CHECKING' ? `보냈지만 ${r.open}줄은 아직 결과를 모릅니다 — 「결과 조회」로 확정하십시오(다시 보내지 않음).`
      : s.mode === 'ASSUME' ? `간주로 처리했습니다(금융결제원에 보내지 않음 · 전표 없음) — 간주 ${r.assumed} · 실패 ${r.bad - r.hold} · 보내지 않음 ${r.hold}.`
      : `보냈습니다 — 성공 ${r.ok} · 실패 ${r.bad - r.hold} · 보내지 않음(수취조회) ${r.hold}. 성공한 줄은 다음 전표 만들기 때 전표(낸 계정 / 보통예금)가 생깁니다.` };
}

/** POST /admin/fin/transfers/{id}/check — CHECKING · 결과 없는 줄 · PENDING 을 결과조회로만 확정(다시 보내지 않음) · 묶음이 보낸 방식(mode)으로 묻기 */
export async function checkTransfer(db: DatabaseService, idIn: string, fetchFn?: FetchLike) {
  const id = idOk(idIn);
  const b = await lockFree(db, id);
  if (b.state !== 'CHECKING') throw new StateConflict('TRANSFER_STATE', '결과 확인 중인 묶음이 아닙니다.');
  const ad = transferAdapter(b.mode === 'LIVE' ? 'LIVE' : 'ASSUME', fetchFn);
  const orders = await ordersOf(db, id, 'open');
  for (const o of orders) {
    let x: TransferOutcome;
    try { x = await ad.check({ ...o, tranDate: b.sent_on ?? kstToday() }); } catch { x = { id: o.id, result: 'PENDING', code: 'ERROR', message: '결과 조회 오류 — 다시 결과 조회', txId: o.tranId }; }
    if (x.result !== 'PENDING') await writeResult(db, id, x);
    else await db.query(`UPDATE acct_transfer_items SET result = 'PENDING', result_code = $2, result_msg = $3, done_at = now() WHERE id = $1::bigint AND result IS NULL`, [o.id, x.code?.slice(0, 40) ?? null, x.message?.slice(0, 200) ?? null]);
  }
  const r = await settle(db, id);
  return { ok: true, id, state: r.state, checked: orders.length, pending: r.open,
    note: r.state === 'CHECKING' ? `아직 ${r.open}줄은 결과가 없습니다 — 잠시 뒤 다시 결과 조회하십시오(다시 보내지 않음).` : `결과를 확정했습니다 — ${TRANSFER_STATE_KO[r.state] ?? r.state}.` };
}

async function lockFree(db: DatabaseService, id: string) {
  const [b] = await db.query<{ state: string; mode: string | null; sent_on: string | null }>(
    `SELECT state, mode, (sent_at AT TIME ZONE 'Asia/Seoul')::date::text AS sent_on FROM acct_transfer_batches WHERE id = $1::bigint`, [id]);
  if (!b) throw new NotFound('없는 이체 묶음입니다.');
  return b;
}

async function ordersOf(db: DatabaseService, id: string, which: 'new' | 'open') {
  const rows = await db.query<{ id: string; payee: string; bank_code: string; acc: string; amount: string; memo: string | null; tran: string | null }>(
    `SELECT id::text AS id, payee, bank_code, pgp_sym_decrypt(acct_no_enc, fn_enc_key()) AS acc, amount::text AS amount, memo, bank_tran_id AS tran
       FROM acct_transfer_items
      WHERE batch_id = $1::bigint
        AND (($2::text = 'new' AND result IS NULL AND bank_tran_id IS NULL)
          OR ($2::text = 'open' AND bank_tran_id IS NOT NULL AND (result IS NULL OR result = 'PENDING')))
      ORDER BY id`, [id, which]);
  return rows.map((r): TransferOrder => ({ id: r.id, payee: r.payee, bankCode: r.bank_code, accountNo: r.acc, amount: Number(r.amount), memo: r.memo, tranId: r.tran ?? undefined }));
}

/* LIVE 로 OK 난 줄만 — 차변 낸 계정 / 대변 보통예금 · 거래처 = 받는 분(⑭ 기간 분석이 이름으로 갚음 처리) */
export const TRANSFER_SOURCES: Source[] = [
  {
    name: 'TRANSFER_PAID', label: '대량 이체 지급',
    sql: `SELECT i.id::text AS key, i.payee AS party, i.amount::bigint AS amount, i.pay_role AS pay_role, b.title AS no, i.done_at AS at
            FROM acct_transfer_items i JOIN acct_transfer_batches b ON b.id = i.batch_id
           WHERE i.result = 'OK' AND b.mode = 'LIVE' AND i.done_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'TRANSFER_PAID' AND e.source_key = i.id::text)
           ORDER BY i.done_at LIMIT 500`,
    build: (r) => ({ memo: `대량 이체 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: [dr(String(r.pay_role ?? 'AP'), Number(r.amount)), cr('CASH', Number(r.amount))] }),
  },
];
