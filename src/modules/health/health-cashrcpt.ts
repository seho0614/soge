import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { AssumeCrAdapter, CrAdapter, CrResult, TossCrAdapter } from './cashrcpt.adapter';

/* ---------------------------------------------------------------------
 * v10.506 (D274 · docs/644) 소개몰 현금영수증 — 대표 11/20 「㊹ ②」
 *   대상: 직판(DIRECT) 주문 · 계좌이체(TRANSFER) · 가상계좌(VBANK) 결제 — 카드 결제는 카드 전표가 증빙
 *   회원: 주문마다 소득공제(휴대폰) / 지출증빙(사업자번호) 신청 · 바꾸기(발급 전) — 결제 전이면 REQUESTED · 결제 뒤 mall.cash_receipt_req_days 일까지
 *   DB : 결제 승인이면 발급 대기(PENDING) · 자진발급(mall.cash_receipt_self) · 취소 · 반품이면 취소 대기(CANCEL_PENDING) — 트리거(D274)
 *   정기: mall_cash_receipt(10분 · mall.cash_receipt on 일 때) — 어댑터로 발급 · 취소 · 반품 차감 뒤 남은 금액 다시 발급 · 실패 5번이면 운영 알림
 *   번호: DB 함수(fn_hlt_cr_request)가 정규식 확인 · 암호화(pgp_sym_encrypt) · 가린 값 — 서버 · 화면은 가린 값만 · 업체로 보낼 때만 DB 에서 풂
 *   ★ 세무사 · PG 확인: 의무발행업종 해당 여부 · 자진발급 기준 · 반품 차감분 다시 발급 · 결제창 현금영수증과 겹치지 않게(docs/644 5절)
 * ------------------------------------------------------------------- */

export const CR_PURPOSES = ['INCOME', 'EXPENSE'] as const;
/** DB fn_hlt_cr_request 와 같은 정규식(규칙 2) — 숫자만 남긴 뒤 봄 */
export const CR_PHONE = /^01[016789][0-9]{7,8}$/;
export const CR_BIZNO = /^[0-9]{10}$/;
const MAX_TRIES = 5;
const n = (v: unknown) => Number(v ?? 0);
const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');
const PURPOSE_KO: Record<string, string> = { INCOME: '소득공제', EXPENSE: '지출증빙' };

async function setting(db: DatabaseService, key: string) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return r?.v ?? null;
}

/** 지금 설정으로 고른 어댑터 · 없으면 NOT_READY 사유 */
export async function pickCrAdapter(db: DatabaseService): Promise<{ adapter: CrAdapter | null; mode: string; reason: string | null }> {
  const mode = (await setting(db, 'mall.cash_receipt_mode')) === 'LIVE' ? 'LIVE' : 'ASSUME';
  if (mode === 'ASSUME') return { adapter: new AssumeCrAdapter(), mode, reason: null };
  const key = (process.env.TOSS_SECRET_KEY ?? '').trim();
  if (!key) return { adapter: null, mode, reason: 'NOT_READY: 결제 연동 키(TOSS_SECRET_KEY)가 없어 현금영수증을 발급하지 않았습니다 — 외부 연동 키 화면에서 넣거나 간주(ASSUME)로 두십시오.' };
  return { adapter: new TossCrAdapter(key), mode, reason: null };
}

function checkNumber(purpose: string, number: string) {
  if (!(CR_PURPOSES as readonly string[]).includes(purpose)) throw new PolicyViolation('HLT_CR_PURPOSE', '소득공제 · 지출증빙 가운데 고르십시오.');
  const d = digits(number);
  if (purpose === 'INCOME' && !CR_PHONE.test(d)) throw new PolicyViolation('HLT_CR_NUMBER', '휴대폰 번호를 다시 확인해 주십시오.');
  if (purpose === 'EXPENSE' && !CR_BIZNO.test(d)) throw new PolicyViolation('HLT_CR_NUMBER', '사업자등록번호 10자리를 다시 확인해 주십시오.');
  return d;
}

/* 목록 칸(가린 번호만 · 번호 원문 · 암호문은 싣지 않음) — SQL 안에 끼우지 않으려고 쿼리마다 그대로 적음(규칙 3) */

/* ── 회원 ── */

/** GET /me/health/orders/{no}/cash-receipt — 신청 · 발급 상태 · 신청할 수 있는지 */
export async function crMine(db: DatabaseService, me: string, orderNo: string) {
  const [o] = await db.query<{ id: string; status: string; seller_type: string | null; method: string | null; pay_state: string | null; approved_at: string | null }>(
    `SELECT o.id, o.status, s.type AS seller_type, p.method, p.state AS pay_state, p.approved_at
       FROM hlt_orders o LEFT JOIN hlt_sellers s ON s.id = o.seller_id
       LEFT JOIN LATERAL (SELECT method, state, approved_at FROM hlt_payments WHERE order_id = o.id ORDER BY (state = 'PAID') DESC, created_at DESC LIMIT 1) p ON true
      WHERE o.order_no = $1 AND o.account_id = $2::uuid`, [orderNo, me]);
  if (!o) throw new NotFound('없는 주문입니다.');
  const on = (await setting(db, 'mall.cash_receipt')) === 'on';
  const days = n((await setting(db, 'mall.cash_receipt_req_days')) ?? 5);
  const rows = await db.query(`SELECT c.id::text AS id, o.order_no AS "orderNo", c.purpose, c.id_kind AS "idKind", c.id_mask AS "idMask", c.amount::bigint AS amount,
  c.tax_free::bigint AS "taxFree", c.supply::bigint AS supply, c.vat::bigint AS vat, c.state, c.source, c.doc_key AS "docKey", c.approval_no AS "approvalNo",
  c.adapter, c.attempts, c.last_error AS "lastError", c.cancel_reason AS "cancelReason", c.issued_at AS "issuedAt", c.canceled_at AS "canceledAt",
  c.created_at AS "createdAt", c.reissue_of::text AS "reissueOf" FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE c.order_id = $1::uuid ORDER BY c.id DESC LIMIT 5`, [o.id]);
  const direct = o.seller_type === 'DIRECT';
  const card = o.pay_state === 'PAID' && o.method === 'CARD';
  const late = o.pay_state === 'PAID' && !!o.approved_at && Date.parse(o.approved_at) < Date.now() - days * 86400e3;
  const closed = ['CANCELED', 'RETURNED'].includes(o.status);
  const canRequest = on && direct && !card && !late && !closed;
  return {
    on, canRequest, receipts: rows, requestDays: days,
    why: !on ? '지금은 화면에서 현금영수증을 신청할 수 없습니다.' : !direct ? '입점 판매자 상품은 그 판매자가 현금영수증을 발급합니다.'
      : card ? '카드로 결제한 주문은 카드 전표가 증빙입니다.' : closed ? '취소 · 반품된 주문입니다.' : late ? '신청 기간이 지났습니다 — 고객센터로 문의해 주십시오.' : null,
  };
}

/** PUT /me/health/orders/{no}/cash-receipt — 신청 · 바꾸기(발급 전만) */
export async function crRequest(db: DatabaseService, me: string, orderNo: string, dto: { purpose: string; number: string }) {
  if ((await setting(db, 'mall.cash_receipt')) !== 'on') throw new PolicyViolation('HLT_CR_OFF', '지금은 화면에서 현금영수증을 신청할 수 없습니다.');
  const num = checkNumber(dto.purpose, dto.number);
  const [o] = await db.query<{ id: string }>(`SELECT id FROM hlt_orders WHERE order_no = $1 AND account_id = $2::uuid`, [orderNo, me]);
  if (!o) throw new NotFound('없는 주문입니다.');
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM hlt_cash_receipts WHERE order_id = $1::uuid AND state NOT IN ('CANCELED', 'SKIPPED')`, [o.id]);
  if (cur && ['ISSUED', 'ASSUMED', 'CANCEL_PENDING'].includes(cur.state)) {
    throw new StateConflict('HLT_CR_ISSUED', '이미 발급된 현금영수증이 있습니다 — 바꾸려면 운영이 취소한 뒤 다시 발급합니다.');
  }
  const [r] = await db.query<{ id: string }>(`SELECT fn_hlt_cr_request($1::uuid, $2::uuid, $3::text, $4::text, NULL::uuid, NULL::text)::text AS id`, [o.id, me, dto.purpose, num]);
  const [row] = await db.query(`SELECT c.id::text AS id, o.order_no AS "orderNo", c.purpose, c.id_kind AS "idKind", c.id_mask AS "idMask", c.amount::bigint AS amount,
  c.tax_free::bigint AS "taxFree", c.supply::bigint AS supply, c.vat::bigint AS vat, c.state, c.source, c.doc_key AS "docKey", c.approval_no AS "approvalNo",
  c.adapter, c.attempts, c.last_error AS "lastError", c.cancel_reason AS "cancelReason", c.issued_at AS "issuedAt", c.canceled_at AS "canceledAt",
  c.created_at AS "createdAt", c.reissue_of::text AS "reissueOf" FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE c.id = $1::bigint`, [r!.id]);
  return { ...(row as object), note: '현금영수증 신청을 받았습니다 — 결제가 확인되면 발급합니다.' };
}

/* ── 운영 ── */

/** GET /admin/health/cash-receipts — 스위치 · 방식 · 준비 · 상태별 수 · 이번 달 · 지난달 발급 합(부가세 신고 참고) · 목록 200(가린 번호) */
export async function crView(db: DatabaseService, state?: string) {
  const st = state && /^[A-Z_]{4,20}$/.test(state) ? state : null;
  const pick = await pickCrAdapter(db);
  const [c] = await db.query<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE state = 'REQUESTED')::text AS requested, count(*) FILTER (WHERE state = 'PENDING')::text AS pending,
            count(*) FILTER (WHERE state = 'FAILED')::text AS failed, count(*) FILTER (WHERE state = 'CANCEL_PENDING')::text AS cancel_pending,
            count(*) FILTER (WHERE state = 'ISSUED')::text AS issued, count(*) FILTER (WHERE state = 'ASSUMED')::text AS assumed
       FROM hlt_cash_receipts`);
  const months = await db.query(
    `SELECT to_char(date_trunc('month', issued_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') AS month,
            count(*)::int AS n, coalesce(sum(amount), 0)::bigint AS amount, coalesce(sum(supply), 0)::bigint AS supply,
            coalesce(sum(vat), 0)::bigint AS vat, coalesce(sum(tax_free), 0)::bigint AS "taxFree",
            count(*) FILTER (WHERE state = 'ASSUMED')::int AS assumed
       FROM hlt_cash_receipts WHERE issued_at IS NOT NULL AND state IN ('ISSUED', 'ASSUMED') AND issued_at >= date_trunc('month', now() - interval '1 month')
      GROUP BY 1 ORDER BY 1 DESC`);
  const items = await db.query(
    `SELECT c.id::text AS id, o.order_no AS "orderNo", c.purpose, c.id_kind AS "idKind", c.id_mask AS "idMask", c.amount::bigint AS amount,
  c.tax_free::bigint AS "taxFree", c.supply::bigint AS supply, c.vat::bigint AS vat, c.state, c.source, c.doc_key AS "docKey", c.approval_no AS "approvalNo",
  c.adapter, c.attempts, c.last_error AS "lastError", c.cancel_reason AS "cancelReason", c.issued_at AS "issuedAt", c.canceled_at AS "canceledAt",
  c.created_at AS "createdAt", c.reissue_of::text AS "reissueOf", fn_mask_name(a.name) AS member FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id LEFT JOIN accounts a ON a.id = c.account_id
      WHERE ($1::text IS NULL OR c.state = $1::text) ORDER BY c.id DESC LIMIT 200`, [st]);
  const on = (await setting(db, 'mall.cash_receipt')) === 'on';
  return {
    on, mode: pick.mode, ready: !!pick.adapter, readyNote: pick.reason ? pick.reason.replace(/^NOT_READY:\s*/, '') : null,
    self: (await setting(db, 'mall.cash_receipt_self')) === 'on', selfMin: n((await setting(db, 'mall.cash_receipt_self_min')) ?? 100000),
    requestDays: n((await setting(db, 'mall.cash_receipt_req_days')) ?? 5), keepYears: n((await setting(db, 'mall.cash_receipt_keep_years')) ?? 5),
    counts: Object.fromEntries(Object.entries(c ?? {}).map(([k, v]) => [k, n(v)])), months, items,
    note: '직판 · 계좌이체 · 가상계좌 결제만 대상입니다. 간주(ASSUME) 발급은 국세청에 보내지 않은 기록이라 부가세 신고 자료로 쓰지 않습니다(세무사 확인).',
  };
}

/** POST /admin/health/cash-receipts — 운영이 주문에 발급 신청(전화 요청 · 기간 지난 신청) */
export async function crAdminIssue(db: DatabaseService, actor: string | null, dto: { orderNo: string; purpose: string; number: string; reason: string }) {
  const num = checkNumber(dto.purpose, dto.number);
  if (String(dto.reason ?? '').trim().length < 2) throw new PolicyViolation('HLT_CR_REASON', '사유를 적어 주십시오.');
  const [o] = await db.query<{ id: string }>(`SELECT id FROM hlt_orders WHERE order_no = $1`, [dto.orderNo]);
  if (!o) throw new NotFound('없는 주문입니다.');
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM hlt_cash_receipts WHERE order_id = $1::uuid AND state NOT IN ('CANCELED', 'SKIPPED')`, [o.id]);
  if (cur && ['ISSUED', 'ASSUMED', 'CANCEL_PENDING'].includes(cur.state)) {
    throw new StateConflict('HLT_CR_ISSUED', '이미 발급된 현금영수증이 있습니다 — 바꾸려면 운영이 취소한 뒤 다시 발급합니다.');
  }
  const [r] = await db.query<{ id: string }>(`SELECT fn_hlt_cr_request($1::uuid, NULL::uuid, $2::text, $3::text, $4::uuid, $5::text)::text AS id`,
    [o.id, dto.purpose, num, actor, String(dto.reason).trim().slice(0, 200)]);
  const [row] = await db.query(`SELECT c.id::text AS id, o.order_no AS "orderNo", c.purpose, c.id_kind AS "idKind", c.id_mask AS "idMask", c.amount::bigint AS amount,
  c.tax_free::bigint AS "taxFree", c.supply::bigint AS supply, c.vat::bigint AS vat, c.state, c.source, c.doc_key AS "docKey", c.approval_no AS "approvalNo",
  c.adapter, c.attempts, c.last_error AS "lastError", c.cancel_reason AS "cancelReason", c.issued_at AS "issuedAt", c.canceled_at AS "canceledAt",
  c.created_at AS "createdAt", c.reissue_of::text AS "reissueOf" FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE c.id = $1::bigint`, [r!.id]);
  return { ...(row as object), note: '발급 대기로 넣었습니다 — 다음 정기 작업(10분)이나 「지금 돌리기」로 발급합니다.' };
}

/** POST /admin/health/cash-receipts/{id}/retry — 실패한 것을 다시 대기로(번호는 그대로) */
export async function crRetry(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 현금영수증입니다.');
  const [c] = await db.query<{ state: string }>(`SELECT state FROM hlt_cash_receipts WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 현금영수증입니다.');
  if (c.state !== 'FAILED') throw new StateConflict('HLT_CR_STATE', '실패한 현금영수증만 다시 보낼 수 있습니다.');
  await db.query(`UPDATE hlt_cash_receipts SET state = 'PENDING', attempts = 0, last_error = NULL WHERE id = $1::bigint AND state = 'FAILED'`, [id]);
  return { id, state: 'PENDING' };
}

/** POST /admin/health/cash-receipts/{id}/cancel — 발급된 것은 취소 대기 · 발급 전은 닫음 */
export async function crCancel(db: DatabaseService, id: string, reason: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 현금영수증입니다.');
  if (String(reason ?? '').trim().length < 2) throw new PolicyViolation('HLT_CR_REASON', '사유를 적어 주십시오.');
  const [c] = await db.query<{ state: string }>(`SELECT state FROM hlt_cash_receipts WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 현금영수증입니다.');
  const why = String(reason).trim().slice(0, 200);
  if (['ISSUED', 'ASSUMED'].includes(c.state)) {
    await db.query(`UPDATE hlt_cash_receipts SET state = 'CANCEL_PENDING', cancel_reason = $2 WHERE id = $1::bigint`, [id, why]);
    return { id, state: 'CANCEL_PENDING', note: '취소 대기로 넣었습니다 — 다음 정기 작업에서 취소합니다.' };
  }
  if (['REQUESTED', 'PENDING', 'FAILED'].includes(c.state)) {
    await db.query(`UPDATE hlt_cash_receipts SET state = 'SKIPPED', cancel_reason = $2 WHERE id = $1::bigint`, [id, why]);
    return { id, state: 'SKIPPED', note: '발급 전이라 닫았습니다.' };
  }
  throw new StateConflict('HLT_CR_STATE', '이미 닫힌 현금영수증입니다.');
}

/* ── 정기 작업 ── */

async function notify(db: DatabaseService, row: { account_id: string | null; order_no: string; purpose: string; amount: string | number | null; source: string },
  action: '발급' | '취소', note: string) {
  if (!row.account_id || row.source === 'SELF') return;
  await db.query(`SELECT fn_notify($1::uuid, 'HLT_CASH_RECEIPT', $2::jsonb, $3)`, [row.account_id,
    JSON.stringify({ orderNo: row.order_no, purpose: PURPOSE_KO[row.purpose] ?? row.purpose, amount: n(row.amount).toLocaleString('ko-KR'), action, note }),
    `/my/health/orders/${encodeURIComponent(row.order_no)}`]);
}

async function alertOnce(db: DatabaseService, code: string, severity: 'WARN' | 'CRITICAL', title: string, detail: object) {
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT $1, $2, $3, $4::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND acknowledged_at IS NULL AND raised_at >= now() - interval '1 day')`,
    [code, severity, title, JSON.stringify(detail)]);
}

interface CrJobRow { id: string; order_id: string; order_no: string; account_id: string | null; purpose: 'INCOME' | 'EXPENSE'; doc_key: string; identity: string | null;
  state: string; attempts: number; source: string; adapter: string | null; receipt_key: string | null; amount: string | null }

/** mall_cash_receipt — 발급 대기 · 다시 보낼 실패 · 취소 대기를 50건씩(스위치 off 면 건너뜀 · 「지금 돌리기」는 force) */
export async function mallCashReceiptJob(db: DatabaseService, opts: { force?: boolean } = {}) {
  const out = { issued: 0, assumed: 0, failed: 0, canceled: 0, reissued: 0, notReady: 0, skipped: null as string | null };
  if (!opts.force && (await setting(db, 'mall.cash_receipt')) !== 'on') { out.skipped = 'OFF'; return out; }
  const pick = await pickCrAdapter(db);

  const due = await db.query<CrJobRow>(
    `SELECT c.id::text AS id, c.order_id, o.order_no, c.account_id, c.purpose, c.doc_key, pgp_sym_decrypt(c.id_enc, fn_enc_key()) AS identity,
            c.state, c.attempts, c.source, c.adapter, c.receipt_key, c.amount::text AS amount
       FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id
      WHERE (c.state = 'PENDING' OR (c.state = 'FAILED' AND c.attempts < $1::int AND c.updated_at < now() - interval '30 minutes')) AND c.id_enc IS NOT NULL
      ORDER BY c.id LIMIT 50`, [MAX_TRIES]);
  for (const r of due) {
    if (!pick.adapter) {
      await db.query(`UPDATE hlt_cash_receipts SET last_error = $2 WHERE id = $1::bigint`, [r.id, pick.reason]);
      out.notReady++;
      continue;
    }
    const [a] = await db.query<{ o_amount: string | null; o_tax_free: string; o_supply: string | null; o_vat: string | null }>(
      `SELECT o_amount::text, o_tax_free::text, o_supply::text, o_vat::text FROM fn_hlt_cr_amounts($1::uuid)`, [r.order_id]);
    const amount = r.source === 'REISSUE' && r.amount ? n(r.amount) : n(a?.o_amount);
    if (!amount) {
      await db.query(`UPDATE hlt_cash_receipts SET state = 'SKIPPED', last_error = '결제 금액이 없어 발급하지 않음' WHERE id = $1::bigint`, [r.id]);
      continue;
    }
    const taxFree = Math.min(amount, n(a?.o_tax_free));
    const vat = Math.round((amount - taxFree) / 11);
    let res: CrResult;
    try {
      res = await pick.adapter.issue({ docKey: r.doc_key, orderName: `소개몰 주문 ${r.order_no}`, purpose: r.purpose, identity: String(r.identity ?? ''), amount, taxFree });
    } catch (e) {
      res = { status: 'FAILED', approvalNo: null, receiptKey: null, error: String((e as Error)?.message ?? e).slice(0, 300) };
    }
    if (res.status === 'ISSUED' || res.status === 'ASSUMED') {
      await db.query(
        `UPDATE hlt_cash_receipts SET state = $2, approval_no = $3, receipt_key = $4, adapter = $5, issued_at = now(), attempts = attempts + 1, last_error = $6,
                amount = $7::bigint, tax_free = $8::bigint, vat = $9::bigint, supply = $7::bigint - $8::bigint - $9::bigint
          WHERE id = $1::bigint`,
        [r.id, res.status, res.approvalNo, res.receiptKey, pick.adapter.name, res.error ?? null, amount, taxFree, vat]);
      if (res.status === 'ISSUED') out.issued++; else out.assumed++;
      await notify(db, { ...r, amount }, '발급', res.status === 'ASSUMED' ? '(지금은 시험 운영 중이라 국세청 전송 없이 기록만 했습니다)' : '국세청 홈택스에서도 확인하실 수 있습니다.');
    } else {
      const tries = r.attempts + 1;
      await db.query(`UPDATE hlt_cash_receipts SET state = 'FAILED', attempts = $2::int, adapter = $3, last_error = $4 WHERE id = $1::bigint`,
        [r.id, tries, pick.adapter.name, (res.error ?? '발급 실패').slice(0, 500)]);
      out.failed++;
      if (tries >= MAX_TRIES) {
        await alertOnce(db, 'MALL_CASH_RECEIPT_FAIL', 'WARN', '소개몰 현금영수증 발급이 5번 실패한 건이 있습니다 — 소개몰 › 현금영수증', { id: r.id, order: r.order_no });
      }
    }
  }

  const cancels = await db.query<CrJobRow & { pay_amount: string | null; canceled_amount: string | null; order_status: string }>(
    `SELECT c.id::text AS id, c.order_id, o.order_no, c.account_id, c.purpose, c.doc_key, NULL::text AS identity, c.state, c.attempts, c.source, c.adapter,
            c.receipt_key, c.amount::text AS amount, o.status AS order_status,
            (SELECT p.amount::text FROM hlt_payments p WHERE p.id = c.payment_id) AS pay_amount,
            (SELECT coalesce(p.canceled_amount, 0)::text FROM hlt_payments p WHERE p.id = c.payment_id) AS canceled_amount
       FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE c.state = 'CANCEL_PENDING' ORDER BY c.id LIMIT 50`);
  for (const r of cancels) {
    let res: CrResult;
    if (r.adapter === 'assume' || !r.adapter) res = await new AssumeCrAdapter().cancel();
    else if (pick.adapter && pick.adapter.name === r.adapter) {
      try { res = await pick.adapter.cancel(r.receipt_key, n(r.amount), '주문 취소 · 반품'); }
      catch (e) { res = { status: 'FAILED', approvalNo: null, receiptKey: r.receipt_key, error: String((e as Error)?.message ?? e).slice(0, 300) }; }
    } else {
      await db.query(`UPDATE hlt_cash_receipts SET last_error = $2 WHERE id = $1::bigint`, [r.id, pick.reason ?? '발급한 업체 방식(LIVE)이 아니라 취소를 보내지 않았습니다.']);
      out.notReady++;
      continue;
    }
    if (res.status !== 'CANCELED') {
      await db.query(`UPDATE hlt_cash_receipts SET attempts = attempts + 1, last_error = $2 WHERE id = $1::bigint`, [r.id, (res.error ?? '취소 처리 중').slice(0, 500)]);
      if (r.attempts + 1 >= MAX_TRIES) await alertOnce(db, 'MALL_CASH_RECEIPT_FAIL', 'WARN', '소개몰 현금영수증 취소가 5번 실패한 건이 있습니다 — 소개몰 › 현금영수증', { id: r.id, order: r.order_no });
      continue;
    }
    await db.query(`UPDATE hlt_cash_receipts SET state = 'CANCELED', canceled_at = now(), last_error = NULL WHERE id = $1::bigint`, [r.id]);
    out.canceled++;
    await notify(db, r, '취소', '주문 취소 · 반품에 따라 취소했습니다.');
    /* 반품 차감(반품 배송비 등)으로 일부만 돌려준 주문 — 남은 금액으로 다시 발급(세무사 확인 · docs/644 3절) */
    const remain = n(r.pay_amount) - n(r.canceled_amount);
    if (r.order_status === 'RETURNED' && remain > 0 && remain < n(r.amount)) {
      const made = await db.query(
        `INSERT INTO hlt_cash_receipts (order_id, payment_id, account_id, purpose, id_kind, id_enc, id_mask, amount, tax_free, supply, vat, state, source, reissue_of)
         SELECT c.order_id, c.payment_id, c.account_id, c.purpose, c.id_kind, c.id_enc, c.id_mask, $2::bigint, 0, $2::bigint - round($2::bigint / 11.0)::bigint,
                round($2::bigint / 11.0)::bigint, 'PENDING', 'REISSUE', c.id
           FROM hlt_cash_receipts c WHERE c.id = $1::bigint AND c.id_enc IS NOT NULL
         ON CONFLICT DO NOTHING RETURNING id`, [r.id, remain]);
      out.reissued += made.length;
    }
  }
  if (out.notReady && pick.reason) {
    await alertOnce(db, 'MALL_CASH_RECEIPT_NOT_READY', 'WARN', '소개몰 현금영수증 — 실제 발급(LIVE)인데 결제 연동 키가 없어 멈춰 있습니다', { waiting: out.notReady });
  }
  return out;
}

/** 정기(mlx_daily_purge) — 보관 해 수 지난 번호 지우기(가린 값 · 금액 · 승인번호는 남김) */
export async function crPurge(db: DatabaseService) {
  const years = Math.min(10, Math.max(1, n((await setting(db, 'mall.cash_receipt_keep_years')) ?? 5)));
  const r = await db.query(
    `UPDATE hlt_cash_receipts SET id_enc = NULL, id_purged_at = now()
      WHERE id_enc IS NOT NULL AND state IN ('ISSUED', 'ASSUMED', 'CANCELED', 'SKIPPED') AND created_at < now() - make_interval(years => $1::int) RETURNING id`, [years]);
  return { purged: r.length };
}
