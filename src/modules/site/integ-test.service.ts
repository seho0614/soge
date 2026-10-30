import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { httpJson } from '../../common/http-json';
import { resolveBankVerifyProvider } from '../billing/bank-verify.provider';
import { HttpEtaxAdapter } from '../etax/etax.http';
import { EtaxResult, fmtApproval } from '../etax/etax.adapter';

/* ---------------------------------------------------------------------
 * v10.144 (D140 · docs/220 · 설계 docs/218) — 결제(PG) · 1원 계좌인증(BANK) 연결 확인 · 시험
 *
 *   PG 키 확인   없는 주문 번호를 토스에 조회 — 404(없는 결제) = 키가 맞음 · 401/403 = 키 틀림 · 그 밖 = 연결 문제. 돈이 나가지 않음
 *               키 종류(test · live) · 결제창 클라이언트 키와 짝(같은 종류)도 봄
 *   1원 시험     SUPER 본인 계좌로 1원 → 통장에 찍힌 코드 → 확인. 하루 integ.bank_test_daily(3) · 30분 · 다섯 번 틀리면 닫힘
 *               계좌번호는 끝 4자리 · 코드는 해시로만 남김
 *   LIVE 조건    PG · BANK 를 LIVE 로 바꾸려면 최근 7일 안에 성공한(스텁 아닌) 시험(PG_KEY · BANK_CONFIRM) — SiteService.updateIntegration 이 부름
 *   v10.155 (D148 · docs/235) 세금계산서(ETAX) — 한 단추로 두 가지
 *     키 확인     운영 주소(ETAX_URL · ETAX_KEY)에 없는 문서 번호 조회 — 404 = 키가 맞음 · 401/403 = 틀림. 발행 없음
 *     시험 발행   업체 **시험 주소(ETAX_TEST_URL · 키는 ETAX_TEST_KEY 없으면 ETAX_KEY)** 로 1건(공급자 = 공급받는 자 = 운영 법인 · 1,000원 + 부가세 100원)
 *                 → 국세청 승인번호 24자리면 성공. 시험 주소가 없거나 운영 주소와 같으면 보내지 않음(실제 세금계산서가 나가므로) · 하루 integ.etax_test_daily(3)
 *     간주 끄기   etax.require_config = on 이면 최근 7일 안 둘 다 성공해야 assume.etax 를 끔(AdminService.checkSwitch · etaxTestMissing)
 * ------------------------------------------------------------------- */

export type IntegTestErrorKind = 'NOT_CONFIGURED' | 'AUTH' | 'TIMEOUT' | 'NETWORK' | 'UPSTREAM' | 'HTTP_4XX' | 'BAD_RESPONSE' | 'PAIR_MISMATCH' | string;
const TOSS_BASE_DEFAULT = 'https://api.tosspayments.com';
const BANK_TTL_MIN = 30;
const BANK_MAX_TRIES = 5;
const keyMode = (k: string | undefined) => { const m = (k ?? '').trim().split('_')[0]; return m === 'test' || m === 'live' ? m : null; };
const last4 = (s: string) => s.replace(/\D/g, '').slice(-4);

@Injectable()
export class IntegTestService {
  private readonly log = new Logger(IntegTestService.name);
  constructor(private readonly db: DatabaseService) {}

  private async record(r: { code: 'PG' | 'BANK' | 'ETAX'; kind: string; ok: boolean; stub?: boolean; errorKind?: string | null; detail?: string | null;
    keyMode?: string | null; last4?: string | null; codeHash?: string | null; txId?: string | null; pending?: boolean }) {
    const [row] = await this.db.query<{ id: string; created_at: Date }>(
      `INSERT INTO integration_tests (integration_code, kind, ok, stub, error_kind, detail, key_mode, account_last4, code_hash, tx_id, pending, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, created_at`,
      [r.code, r.kind, r.ok, !!r.stub, r.errorKind ?? null, (r.detail ?? '').slice(0, 200) || null, r.keyMode ?? null, r.last4 ?? null,
       r.codeHash ?? null, r.txId ?? null, !!r.pending, RequestCtx.actorId()]);
    return row;
  }

  /** 토스 응답 → 결과. 404(NOT_FOUND_PAYMENT 또는 코드 없음) 만 「키가 맞음」 */
  static classifyPg(status: number, body: any, errorKind?: string): { ok: boolean; errorKind: IntegTestErrorKind | null; detail: string } {
    if (status === 404 && (!body?.code || body.code === 'NOT_FOUND_PAYMENT' || body.code === 'NOT_FOUND'))
      return { ok: true, errorKind: null, detail: '키 확인됨(없는 주문 조회 → 404)' };
    if (status === 401 || status === 403) return { ok: false, errorKind: 'AUTH', detail: `키가 맞지 않습니다(${status} ${String(body?.code ?? '').slice(0, 40)})` };
    if (status === 0) return { ok: false, errorKind: errorKind ?? 'NETWORK', detail: errorKind === 'TIMEOUT' ? '토스 응답 지연' : '토스 서버에 연결하지 못함' };
    if (status >= 500) return { ok: false, errorKind: 'UPSTREAM', detail: `토스 서버 오류(${status})` };
    if (status >= 200 && status < 300) return { ok: false, errorKind: 'BAD_RESPONSE', detail: '없는 주문인데 결제가 있다고 답함 — 주문 번호 규칙 확인' };
    return { ok: false, errorKind: 'HTTP_4XX', detail: `예상하지 못한 응답(${status} ${String(body?.code ?? '').slice(0, 40)})` };
  }

  /* ── PG 키 확인 ─────────────────────────────────────────────────── */
  async pgCheck() {
    const sk = process.env.TOSS_SECRET_KEY?.trim();
    const ck = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim();
    const mode = keyMode(sk);
    if (!sk) {
      await this.record({ code: 'PG', kind: 'PG_KEY', ok: false, errorKind: 'NOT_CONFIGURED', detail: '시크릿 키 없음' });
      return { ok: false, errorKind: 'NOT_CONFIGURED', keyMode: null, clientKey: ck ? keyMode(ck) : null, pair: false,
        detail: '결제 시크릿 키가 없습니다 — 외부 연동 › 연동 키 › 전자결제에 넣은 뒤 다시 확인하십시오.' };
    }
    const pair = !!ck && keyMode(ck) === mode;
    const base = (process.env.TOSS_API_BASE || TOSS_BASE_DEFAULT).replace(/\/+$/, '');
    const orderId = 'sgb-keycheck-' + randomBytes(8).toString('hex');
    const r = await httpJson({ url: `${base}/v1/payments/orders/${orderId}`, method: 'GET', timeoutMs: 8000,
      headers: { Authorization: 'Basic ' + Buffer.from(`${sk}:`).toString('base64') } });
    const c = IntegTestService.classifyPg(r.status, r.body, r.errorKind);
    await this.record({ code: 'PG', kind: 'PG_KEY', ok: c.ok, errorKind: c.errorKind, detail: c.detail + (pair ? '' : ' · 클라이언트 키 짝 안 맞음'), keyMode: mode });
    return { ok: c.ok, errorKind: c.errorKind, keyMode: mode, clientKey: ck ? keyMode(ck) : null, pair, detail: c.detail };
  }

  /* ── 1원 시험 ─────────────────────────────────────────────────── */
  private async setting(key: string, dflt: string) {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v?.trim() || dflt;
  }
  private async bankUsedToday() {
    const [c] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_tests WHERE kind = 'BANK_SEND' AND NOT stub
          AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`);
    return c.n;
  }

  async bankSend(d: { bankCode: string; accountNo: string; holderName: string }) {
    const bankCode = (d.bankCode ?? '').trim(), accountNo = (d.accountNo ?? '').replace(/[\s-]/g, ''), holder = (d.holderName ?? '').trim();
    if (!/^\d{3}$/.test(bankCode) || !/^\d{6,20}$/.test(accountNo) || !holder || holder.length > 40)
      throw new PolicyViolation('BANK_TEST_INPUT', '은행 코드(숫자 3자리) · 계좌번호(숫자 6 ~ 20자리) · 예금주를 확인해 주십시오.');
    const limit = Number(await this.setting('integ.bank_test_daily', '3')) || 0;
    const used = await this.bankUsedToday();
    const real = !!process.env.BANK_VERIFY_KEY?.trim();
    if (real && used >= limit) throw new PolicyViolation('BANK_TEST_LIMIT', `오늘 1원 시험 ${limit}번을 다 썼습니다.`);
    const [busy] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_tests WHERE kind = 'BANK_SEND' AND pending AND created_at > now() - interval '1 minute'`);
    if (busy.n) throw new StateConflict('BANK_TEST_BUSY', '방금 보낸 1원 시험이 있습니다 — 통장 코드를 확인하거나 1분 뒤 다시 보내 주십시오.');

    const res = await resolveBankVerifyProvider().send({ bankCode, accountNo, holderName: holder });
    if (!res.sent) {
      await this.record({ code: 'BANK', kind: 'BANK_SEND', ok: false, stub: res.stub, errorKind: res.errorKind ?? 'REJECTED', detail: res.detail, last4: last4(accountNo) });
      return { ok: false, stub: res.stub, errorKind: res.errorKind ?? 'REJECTED', detail: res.detail ?? '1원을 보내지 못했습니다.', left: Math.max(limit - used - (real ? 1 : 0), 0) };
    }
    /* 코드는 해시로만 — 행 번호를 소금으로(같은 코드라도 행마다 다른 값) */
    const row = await this.record({ code: 'BANK', kind: 'BANK_SEND', ok: true, stub: res.stub, detail: res.stub ? '스텁(코드 SGB01)' : '1원 보냄',
      last4: last4(accountNo), txId: res.txId ?? null, pending: true });
    if (res.code) await this.db.query(`UPDATE integration_tests SET code_hash = $2 WHERE id = $1`, [row.id, IntegTestService.hashCode(row.id, res.code)]);
    return { ok: true, stub: res.stub, testId: row.id, account: `***${last4(accountNo)}`, expiresInMin: BANK_TTL_MIN,
      detail: res.stub ? '연동 전(스텁)이라 실제로 1원이 가지 않았습니다 — 코드는 SGB01 입니다(이 시험은 LIVE 근거가 되지 않음).'
        : '1원을 보냈습니다. 통장 입금자명에 찍힌 코드를 넣으십시오.', left: Math.max(limit - used - (real ? 1 : 0), 0) };
  }
  static hashCode(id: string, code: string) { return createHash('sha256').update(`${id}:${code.trim().toUpperCase()}`, 'utf8').digest('hex'); }

  async bankConfirm(testId: string, code: string) {
    const c = (code ?? '').trim();
    if (!c || c.length > 20) throw new PolicyViolation('BANK_TEST_INPUT', '통장에 찍힌 코드를 넣어 주십시오.');
    const [t] = await this.db.query<{ id: string; stub: boolean; code_hash: string | null; tx_id: string | null; tries: number; pending: boolean; expired: boolean; account_last4: string | null }>(
      `SELECT id::text, stub, code_hash, tx_id, tries, pending, created_at < now() - make_interval(mins => $2::int) AS expired, account_last4
         FROM integration_tests WHERE id = $1::bigint AND kind = 'BANK_SEND'`, [testId, BANK_TTL_MIN]);
    if (!t || !t.pending) throw new StateConflict('BANK_TEST_NOT_PENDING', '확인할 1원 시험이 없습니다 — 다시 보내 주십시오.');
    if (t.expired) {
      await this.db.query(`UPDATE integration_tests SET pending = false WHERE id = $1::bigint`, [t.id]);
      throw new StateConflict('BANK_TEST_EXPIRED', `${BANK_TTL_MIN}분이 지났습니다 — 1원을 다시 보내 주십시오.`);
    }
    const localMatched = t.code_hash ? IntegTestService.hashCode(t.id, c) === t.code_hash : undefined;
    const res = await resolveBankVerifyProvider().confirm({ bankCode: '', accountNo: '', code: c, localMatched, txId: t.tx_id ?? undefined });
    if (!res.verified) {
      const tries = t.tries + 1;
      await this.db.query(`UPDATE integration_tests SET tries = $2, pending = $3 WHERE id = $1::bigint`, [t.id, tries, tries < BANK_MAX_TRIES]);
      await this.record({ code: 'BANK', kind: 'BANK_CONFIRM', ok: false, stub: res.stub, errorKind: res.errorKind ?? 'CODE_MISMATCH', detail: res.detail, last4: t.account_last4 });
      return { ok: false, stub: res.stub, errorKind: res.errorKind ?? 'CODE_MISMATCH', triesLeft: Math.max(BANK_MAX_TRIES - tries, 0),
        detail: `${res.detail ?? '코드가 맞지 않습니다.'}${tries < BANK_MAX_TRIES ? ` (${BANK_MAX_TRIES - tries}번 남음)` : ' — 다섯 번 틀려 닫았습니다. 다시 보내 주십시오.'}` };
    }
    await this.db.query(`UPDATE integration_tests SET pending = false WHERE id = $1::bigint`, [t.id]);
    await this.record({ code: 'BANK', kind: 'BANK_CONFIRM', ok: true, stub: res.stub, detail: res.stub ? '스텁 확인' : `확인됨${res.holderName ? ' · 예금주 일치' : ''}`, last4: t.account_last4 });
    return { ok: true, stub: res.stub, detail: res.stub ? '스텁이라 실제 계좌를 확인하지 않았습니다(LIVE 근거가 되지 않음).' : '1원 계좌인증이 확인됐습니다.' };
  }

  /* ── 세금계산서 키 확인 · 시험 발행 (v10.155) ──────────────────────── */
  /** 운영 주소에 없는 문서 조회 결과 → 키 확인. NOT_FOUND(404) 만 「키가 맞음」 */
  static classifyEtaxKey(r: EtaxResult): { ok: boolean; errorKind: IntegTestErrorKind | null; detail: string } {
    if (r.status === 'NOT_FOUND') return { ok: true, errorKind: null, detail: '키 확인됨(없는 문서 조회 → 404)' };
    if (r.status !== 'FAILED') return { ok: false, errorKind: 'BAD_RESPONSE', detail: `없는 문서인데 업체가 「${r.status}」라고 답함 — 어댑터(etax.http.ts) 확인` };
    return { ok: false, errorKind: r.errorKind ?? 'BAD_RESPONSE', detail: (r.error ?? '업체 응답 오류').slice(0, 160) };
  }
  private async etaxUsedToday() {
    const [c] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_tests WHERE kind = 'ETAX_TEST_ISSUE' AND coalesce(error_kind, '') NOT IN ('NOT_CONFIGURED', 'SAME_URL', 'SUPPLIER')
          AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`);
    return c.n;
  }

  async etaxTest() {
    const env = process.env;
    const url = env.ETAX_URL?.trim(), key = env.ETAX_KEY?.trim();
    const turl = env.ETAX_TEST_URL?.trim(), tkey = env.ETAX_TEST_KEY?.trim() || key;
    const limit = Number(await this.setting('integ.etax_test_daily', '3')) || 0;
    const used = await this.etaxUsedToday();
    const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase();
    const willSend = !!turl && !!tkey && !(url && norm(turl) === norm(url));
    if (willSend && used >= limit) throw new PolicyViolation('ETAX_TEST_LIMIT', `오늘 세금계산서 시험 발행 ${limit}번을 다 썼습니다.`);

    /* ① 키 확인 — 발행 없음 */
    let k: { ok: boolean; errorKind: IntegTestErrorKind | null; detail: string };
    if (!url || !key) k = { ok: false, errorKind: 'NOT_CONFIGURED', detail: `${!url ? 'ETAX_URL' : 'ETAX_KEY'} 없음 — 주소는 .env · 키는 외부 연동 › 연동 키` };
    else k = IntegTestService.classifyEtaxKey(await new HttpEtaxAdapter(url, key).status('SGB-K-' + randomBytes(8).toString('hex')));
    await this.record({ code: 'ETAX', kind: 'ETAX_KEY', ok: k.ok, errorKind: k.errorKind, detail: k.detail });

    /* ② 시험 발행 — 업체 시험 주소로만(운영 주소로는 보내지 않음) */
    let t: { ok: boolean; errorKind: IntegTestErrorKind | null; detail: string; approvalNo: string | null };
    if (!turl || !tkey) t = { ok: false, errorKind: 'NOT_CONFIGURED', detail: 'ETAX_TEST_URL 없음 — 업체 시험 환경 주소를 .env 에 넣으십시오(키가 다르면 ETAX_TEST_KEY)', approvalNo: null };
    else if (!willSend) t = { ok: false, errorKind: 'SAME_URL', detail: '시험 주소가 운영 주소와 같습니다 — 실제 세금계산서가 나가므로 보내지 않았습니다', approvalNo: null };
    else {
      const f = await this.db.query<{ key: string; value: string | null }>(
        `SELECT key, nullif(btrim(value), '') AS value FROM site_settings WHERE key IN ('footer.company_name', 'footer.biz_reg_no', 'footer.ceo_name')`);
      const v = (n: string) => f.find((x) => x.key === n)?.value ?? null;
      const name = v('footer.company_name'), bizNo = v('footer.biz_reg_no');
      if (!name || !bizNo) t = { ok: false, errorKind: 'SUPPLIER', detail: '공급자(운영 법인) 정보 없음 — 설정 footer.company_name · footer.biz_reg_no', approvalNo: null };
      else {
        const [d] = await this.db.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text AS d`);
        const r = await new HttpEtaxAdapter(turl, tkey).issue({
          docKey: `SGB-T-${d.d.replace(/-/g, '').slice(2)}-${randomBytes(5).toString('hex')}`, kind: 'DIRECTORY', writeDate: d.d,
          supplier: { bizNo, name, ceoName: v('footer.ceo_name') }, buyer: { bizNo, name },
          supply: 1000, vat: 100, total: 1100, itemName: '소개뱅크 연동 시험 발행(업체 시험 환경)',
        });
        t = r.status === 'SENT' && r.approvalNo ? { ok: true, errorKind: null, detail: `시험 발행됨 — 승인번호 ${fmtApproval(r.approvalNo)}`, approvalNo: r.approvalNo }
          : r.status === 'SENDING' ? { ok: false, errorKind: 'PENDING', detail: '업체가 접수만 함(국세청 승인 대기) — 승인번호가 나오면 다시 시험하십시오', approvalNo: null }
          : { ok: false, errorKind: r.errorKind ?? 'BAD_RESPONSE', detail: (r.error ?? '시험 발행 실패').slice(0, 160), approvalNo: null };
      }
    }
    await this.record({ code: 'ETAX', kind: 'ETAX_TEST_ISSUE', ok: t.ok, errorKind: t.errorKind, detail: t.detail });
    return { ok: k.ok && t.ok, key: { ok: k.ok, errorKind: k.errorKind, detail: k.detail },
      issue: { ok: t.ok, errorKind: t.errorKind, detail: t.detail, approvalNo: fmtApproval(t.approvalNo) },
      left: Math.max(limit - used - (willSend ? 1 : 0), 0) };
  }

  /** v10.155 (D148) — 간주 끄기에 빠진 시험 이름(최근 7일 · 스텁 아님 · 성공) — 빈 배열이면 둘 다 있음 */
  static async etaxTestMissing(db: DatabaseService): Promise<string[]> {
    const rows = await db.query<{ kind: string }>(
      `SELECT DISTINCT kind FROM integration_tests
        WHERE integration_code = 'ETAX' AND kind IN ('ETAX_KEY', 'ETAX_TEST_ISSUE') AND ok AND NOT stub AND created_at > now() - interval '7 days'`);
    const has = (k: string) => rows.some((r) => r.kind === k);
    return [...(has('ETAX_KEY') ? [] : ['세금계산서 키 확인']), ...(has('ETAX_TEST_ISSUE') ? [] : ['시험 발행'])];
  }

  /* ── LIVE 조건 · 운영 화면 ─────────────────────────────────────── */
  /** PG · BANK 를 LIVE 로 — 최근 7일 안에 성공(스텁 아님) 시험이 있어야 함 */
  async assertLiveAllowed(code: string) {
    const kind = code === 'PG' ? 'PG_KEY' : code === 'BANK' ? 'BANK_CONFIRM' : null;
    if (!kind) return;
    const [r] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM integration_tests WHERE integration_code = $1 AND kind = $2 AND ok AND NOT stub AND created_at > now() - interval '7 days'`, [code, kind]);
    if (!r.n) throw new PolicyViolation('INTEG_TEST_REQUIRED',
      `${code === 'PG' ? '결제 키 확인' : '1원 계좌인증 시험'}이 최근 7일 안에 성공해야 「연결됨(LIVE)」으로 바꿀 수 있습니다 — 외부 연동 › 결제 · 계좌 연결 확인에서 시험하십시오.`);
  }

  async status() {
    const sk = process.env.TOSS_SECRET_KEY?.trim(), ck = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim();
    const integ = await this.db.query<{ code: string; status: string }>(`SELECT code, status FROM integrations WHERE code IN ('PG', 'BANK', 'ETAX')`);
    const last = await this.db.query<any>(
      `SELECT DISTINCT ON (kind) integration_code AS code, kind, created_at AS at
         FROM integration_tests WHERE ok AND NOT stub AND kind IN ('PG_KEY', 'BANK_CONFIRM', 'ETAX_KEY', 'ETAX_TEST_ISSUE') ORDER BY kind, created_at DESC`);
    const recent = await this.db.query<any>(
      `SELECT id::text, integration_code AS code, kind, ok, stub, error_kind AS "errorKind", detail, key_mode AS "keyMode",
              account_last4 AS "accountLast4", pending, created_at AS "at"
         FROM integration_tests WHERE integration_code IN ('PG', 'BANK', 'ETAX') ORDER BY created_at DESC LIMIT 30`);   // v10.153 — 본인인증(PASS) 키 확인은 본인인증 구역에 · v10.155 — 세금계산서(ETAX)는 여기
    const limit = Number(await this.setting('integ.bank_test_daily', '3')) || 0;
    const used = await this.bankUsedToday();
    const lastOk = (c: string) => last.find((x) => x.code === c && x.kind !== 'ETAX_KEY' && x.kind !== 'ETAX_TEST_ISSUE')?.at ?? null;
    const lastKind = (k: string) => last.find((x) => x.kind === k)?.at ?? null;
    const etaxLimit = Number(await this.setting('integ.etax_test_daily', '3')) || 0, etaxUsed = await this.etaxUsedToday();
    const env = process.env;
    return {
      pg: { status: integ.find((x) => x.code === 'PG')?.status ?? null, secretKey: !!sk, keyMode: keyMode(sk), clientKey: ck ? keyMode(ck) : null,
        pair: !!sk && !!ck && keyMode(sk) === keyMode(ck), lastOkAt: lastOk('PG') },
      bank: { status: integ.find((x) => x.code === 'BANK')?.status ?? null, key: !!process.env.BANK_VERIFY_KEY?.trim(), url: !!process.env.BANK_VERIFY_URL?.trim(),
        lastOkAt: lastOk('BANK'), test: { limit, used, left: Math.max(limit - used, 0) } },
      etax: { status: integ.find((x) => x.code === 'ETAX')?.status ?? null, url: !!env.ETAX_URL?.trim(), key: !!env.ETAX_KEY?.trim(),
        testUrl: !!env.ETAX_TEST_URL?.trim(), testKey: env.ETAX_TEST_KEY?.trim() ? 'ETAX_TEST_KEY' : env.ETAX_KEY?.trim() ? 'ETAX_KEY' : null,
        lastKeyOkAt: lastKind('ETAX_KEY'), lastIssueOkAt: lastKind('ETAX_TEST_ISSUE'), requireTest: (await this.setting('etax.require_config', 'on')) !== 'off',
        test: { limit: etaxLimit, used: etaxUsed, left: Math.max(etaxLimit - etaxUsed, 0) } },
      recent,
    };
  }
}
