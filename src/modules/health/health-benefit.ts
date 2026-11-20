import { randomInt } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { Source, cr, dr, reverse, vatSplit } from '../acct/journal';

/* ---------------------------------------------------------------------
 * v10.479 · 480 · 482 (D267 · docs/617 · 618 · 620) 소개몰 회원 혜택 — 대표 11/20 「㊲」
 *   ① 적립금: 구매확정 때 DB 가 적립(fn_hlt_point_earn · 직판 · mall.points on) · 주문서에서 사용(usePoints · 최소 사용 · 1원은 결제)
 *      쓰는 순서 = 소멸이 가까운 묶음부터 · 취소 · 반품이면 DB 가 되돌림 · 확정 뒤 반품이면 남은 적립 회수(모자람은 운영 알림)
 *      매일 00:20 소멸(mall_benefit_expire) · 30일 전 회원 알림 · 운영 지급 · 회수(사유 · 감사 기록)
 *      ★ 회원 포인트(D190 point_ledger · 현금화 출금)와 다른 장부 — 현금으로 바꾸지 않음
 *   ② 회원 등급: 최근 mall.tier_months 개월 구매확정 직판 주문의 (상품 − 쿠폰) 합으로 등급 · 등급 적립률 · 혜택 글 · 운영이 정한 회원은 건너뜀
 *   ④ 상품권: 운영 발행(판매 · 판촉) · 코드는 발행 응답에 한 번만(DB 는 sha256 지문 · 끝 4자리) · 주문서 giftCode · 잔액에서 · 무효 · 잔액 환불 · 소멸
 *   주문 적용 순서(앞 묶음 ㉝ 쿠폰에 기댐): 상품 + 배송비 → ㉝ 쿠폰 할인 → 적립금 → 상품권 → 남은 금액(최소 1원)을 결제
 *   전표(초안 · 세무사 확인): 적립 = 판매촉진비 / 적립금 충당부채 · 소멸 · 회수 = 반대 · 사용 = 충당부채 / 매출(부가세 없음 · 자기적립마일리지)
 *                           상품권 판매 = 보통예금 / 선수금 · 판촉 = 판매촉진비 / 선수금 · 사용 = 선수금 / 매출 + 부가세 · 소멸 = 선수금 / 잡이익
 * ------------------------------------------------------------------- */

/** 상품권 코드 — 4자씩 네 묶음(붙임표 있어도 · 없어도) · 대문자로 바꾼 뒤 봄. DB 에는 지문(fn_hlt_gift_hash)과 끝 4자리(CHECK ^[A-Z0-9]{4}$)만 */
export const GIFT_CODE = /^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/;
export const GIFT_KINDS = ['SOLD', 'PROMO'] as const;
export const TIER_CODE = /^[A-Z][A-Z0-9_]{1,19}$/;   // DB CHECK hlt_tiers.code 와 같음
const GIFT_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자(I · O · 0 · 1) 뺌
const kstYmd = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOk = (id: string, msg: string) => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound(msg); return String(id); };
const sw = async (db: DatabaseService, key: string) => {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return r?.v ?? null;
};
export const normGift = (code: unknown) => String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');

/* ── 주문서(health-checkout.service 패치 · 쿠폰 다음) ── */

export interface BenefitApplied { total: number; pointAmount: number; giftAmount: number; giftTail: string | null }

/** 주문에 적립금 · 상품권 쓰기 — 주문 · 품목 · ㉝ 쿠폰을 넣은 뒤 같은 트랜잭션(DB 가 잠그고 다시 확인 · 막히면 주문째 되돌아감) */
export async function applyBenefits(db: DatabaseService, orderId: string, accountId: string, points: number, giftCode: string | null): Promise<BenefitApplied | null> {
  const pts = Math.floor(n(points));
  const code = giftCode ? normGift(giftCode) : '';
  if (!pts && !code) return null;
  if (!Number.isInteger(pts) || pts < 0 || pts > 10_000_000) throw new PolicyViolation('HLT_POINT_AMOUNT', '적립금은 0 ~ 1천만 원 정수입니다.');
  if (code && !GIFT_CODE.test(code)) throw new PolicyViolation('HLT_GIFT_CODE', '상품권 코드를 다시 확인해 주십시오.');
  const [r] = await db.query<{ point_amount: string; gift_amount: string; total: string; gift_tail: string | null }>(
    `SELECT point_amount::text, gift_amount::text, total::text, gift_tail FROM fn_hlt_benefit_apply($1::uuid, $2::uuid, $3::bigint, CASE WHEN $4::text = '' THEN NULL ELSE fn_hlt_gift_hash($4::text) END)`,
    [orderId, accountId, pts, code]);
  return { total: n(r?.total), pointAmount: n(r?.point_amount), giftAmount: n(r?.gift_amount), giftTail: r?.gift_tail ?? null };
}

/* ── 회원 ── */

/** GET /me/health/benefits — 내 적립금(남은 합 · 30일 안 소멸) · 등급 · 최근 기록 · 스위치 */
export async function myBenefits(db: DatabaseService, me: string) {
  const [s] = await db.query<{ points: string | null; tiers: string | null; subscribe: string | null; gift: string | null; rate: string | null; minuse: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.points') AS points, (SELECT value FROM site_settings WHERE key = 'mall.tiers') AS tiers,
            (SELECT value FROM site_settings WHERE key = 'mall.subscribe') AS subscribe, (SELECT value FROM site_settings WHERE key = 'mall.giftcard') AS gift,
            (SELECT value FROM site_settings WHERE key = 'mall.points_rate') AS rate, (SELECT value FROM site_settings WHERE key = 'mall.points_min_use') AS minuse`);
  const [b] = await db.query<{ balance: string; soon: string; soon_at: string | null }>(
    `SELECT fn_hlt_point_balance($1::uuid)::text AS balance,
            coalesce(sum(remaining) FILTER (WHERE expires_at <= now() + interval '30 days'), 0)::text AS soon,
            min(expires_at) FILTER (WHERE expires_at <= now() + interval '30 days') AS soon_at
       FROM hlt_point_lots WHERE account_id = $1::uuid AND remaining > 0 AND closed_at IS NULL AND expires_at > now()`, [me]);
  const [t] = await db.query<{ code: string; name: string; rate: string; benefit: string | null; amount: string; next_name: string | null; next_min: string | null }>(
    `SELECT t.code, t.name, t.earn_rate::text AS rate, t.benefit, m.period_amount::text AS amount,
            (SELECT x.name FROM hlt_tiers x WHERE x.active AND x.min_amount > t.min_amount ORDER BY x.min_amount LIMIT 1) AS next_name,
            (SELECT x.min_amount::text FROM hlt_tiers x WHERE x.active AND x.min_amount > t.min_amount ORDER BY x.min_amount LIMIT 1) AS next_min
       FROM hlt_member_tiers m JOIN hlt_tiers t ON t.code = m.tier_code WHERE m.account_id = $1::uuid`, [me]);
  const txns = await db.query(
    `SELECT t.id::text AS id, t.kind, t.amount::bigint AS amount, o.order_no AS "orderNo", t.reason, t.created_at AS "createdAt"
       FROM hlt_point_txns t LEFT JOIN hlt_orders o ON o.id = t.order_id WHERE t.account_id = $1::uuid ORDER BY t.id DESC LIMIT 30`, [me]);
  return {
    pointsOn: s?.points === 'on', tiersOn: s?.tiers === 'on', subscribeOn: s?.subscribe === 'on', giftcardOn: s?.gift === 'on',
    rate: n(s?.rate ?? 1), minUse: n(s?.minuse ?? 1000),
    balance: n(b?.balance), expiringSoon: n(b?.soon), expiringFrom: b?.soon_at ?? null,
    tier: t ? { code: t.code, name: t.name, rate: n(t.rate), benefit: t.benefit, periodAmount: n(t.amount), nextName: t.next_name, nextGap: t.next_min == null ? null : Math.max(0, n(t.next_min) - n(t.amount)) } : null,
    txns,
    note: '적립금은 구매확정 때 쌓이고, 소개몰 직판 상품 주문에 씁니다(현금으로 바꾸지 않습니다).',
  };
}

/** POST /me/health/giftcards/check — 코드로 잔액 · 유효 기간(mall.giftcard on 일 때만) */
export async function giftCheck(db: DatabaseService, codeIn: string) {
  if ((await sw(db, 'mall.giftcard')) !== 'on') throw new PolicyViolation('HLT_GIFT_OFF', '지금은 상품권을 받지 않습니다.');
  const c = await giftByCode(db, codeIn);
  return { tail: c.tail, balance: c.balance, expiresAt: c.expiresAt, usable: c.state === 'ACTIVE' && !c.expired && c.balance > 0,
    note: c.state !== 'ACTIVE' ? '쓸 수 없는 상품권입니다.' : c.expired ? '유효 기간이 지났습니다.' : `잔액 ${c.balance.toLocaleString('ko-KR')}원` };
}

async function giftByCode(db: DatabaseService, codeIn: string) {
  const code = normGift(codeIn);
  if (!GIFT_CODE.test(code)) throw new PolicyViolation('HLT_GIFT_CODE', '상품권 코드를 다시 확인해 주십시오.');
  const [c] = await db.query<{ id: string; tail: string; kind: string; face: string; balance: string; state: string; expires_at: string; expired: boolean }>(
    `SELECT id::text AS id, code_tail AS tail, kind, face_amount::text AS face, balance::text AS balance, state, expires_at, expires_at <= now() AS expired
       FROM hlt_giftcards WHERE code_hash = fn_hlt_gift_hash($1)`, [code]);
  if (!c) throw new PolicyViolation('HLT_GIFT_CODE', '없는 상품권입니다.');
  return { id: c.id, tail: c.tail, kind: c.kind, face: n(c.face), balance: n(c.balance), state: c.state, expiresAt: c.expires_at, expired: c.expired };
}

/* ── 운영 › 소개몰 › 적립금 ── */

/** GET /admin/health/points?email= — 스위치 · 설정 · 남은 합(부채) · 30일 안 소멸 · 최근 30일 적립 · 사용 · 기록 50 · (email) 회원 묶음 · 기록 */
export async function pointsView(db: DatabaseService, email?: string) {
  const [s] = await db.query<Record<string, string | null>>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.points') AS sw, (SELECT value FROM site_settings WHERE key = 'mall.points_rate') AS rate,
            (SELECT value FROM site_settings WHERE key = 'mall.points_valid_days') AS days, (SELECT value FROM site_settings WHERE key = 'mall.points_min_use') AS minuse,
            (SELECT value FROM site_settings WHERE key = 'mall.order_open') AS open_`);
  const [t] = await db.query<{ outstanding: string; soon: string; members: number; earned: string; used: string; expired: string }>(
    `SELECT (SELECT coalesce(sum(remaining), 0) FROM hlt_point_lots WHERE remaining > 0 AND closed_at IS NULL AND expires_at > now())::text AS outstanding,
            (SELECT coalesce(sum(remaining), 0) FROM hlt_point_lots WHERE remaining > 0 AND closed_at IS NULL AND expires_at > now() AND expires_at <= now() + interval '30 days')::text AS soon,
            (SELECT count(DISTINCT account_id)::int FROM hlt_point_lots WHERE remaining > 0 AND closed_at IS NULL AND expires_at > now()) AS members,
            (SELECT coalesce(sum(amount), 0) FROM hlt_point_txns WHERE kind IN ('EARN', 'ADJUST_ADD') AND created_at > now() - interval '30 days')::text AS earned,
            (SELECT coalesce(sum(amount), 0) FROM hlt_point_txns WHERE kind = 'USE' AND created_at > now() - interval '30 days')::text AS used,
            (SELECT coalesce(sum(amount), 0) FROM hlt_point_txns WHERE kind IN ('EXPIRE', 'REVOKE') AND created_at > now() - interval '30 days')::text AS expired`);
  const recent = await db.query(
    `SELECT t.id::text AS id, t.kind, t.amount::bigint AS amount, o.order_no AS "orderNo", t.reason, t.created_at AS "createdAt", t.account_id::text AS "accountId", CASE WHEN char_length(coalesce(a.name, '')) <= 1 THEN '*' ELSE left(a.name, 1) || repeat('*', char_length(a.name) - 1) END AS member
       FROM hlt_point_txns t JOIN accounts a ON a.id = t.account_id LEFT JOIN hlt_orders o ON o.id = t.order_id ORDER BY t.id DESC LIMIT 50`);
  let member: unknown = null;
  const em = String(email ?? '').trim().toLowerCase();
  if (em) {
    const [a] = await db.query<{ id: string; member: string }>(`SELECT a.id::text AS id, CASE WHEN char_length(coalesce(a.name, '')) <= 1 THEN '*' ELSE left(a.name, 1) || repeat('*', char_length(a.name) - 1) END AS member FROM accounts a WHERE lower(a.email) = $1`, [em]);
    if (!a) throw new NotFound('없는 회원입니다.');
    const [bal] = await db.query<{ b: string }>(`SELECT fn_hlt_point_balance($1::uuid)::text AS b`, [a.id]);
    const lots = await db.query(
      `SELECT id::text AS id, source, amount::bigint AS amount, remaining::bigint AS remaining, expires_at AS "expiresAt", closed_reason AS "closedReason", created_at AS "createdAt"
         FROM hlt_point_lots WHERE account_id = $1::uuid ORDER BY id DESC LIMIT 50`, [a.id]);
    const txns = await db.query(
      `SELECT t.id::text AS id, t.kind, t.amount::bigint AS amount, o.order_no AS "orderNo", t.reason, t.created_at AS "createdAt"
         FROM hlt_point_txns t LEFT JOIN hlt_orders o ON o.id = t.order_id WHERE t.account_id = $1::uuid ORDER BY t.id DESC LIMIT 50`, [a.id]);
    member = { accountId: a.id, member: a.member, balance: n(bal?.b), lots, txns };
  }
  return {
    on: s?.sw === 'on', ordersOpen: (s?.open_ ?? 'on') === 'on', rate: n(s?.rate ?? 1), validDays: n(s?.days ?? 365), minUse: n(s?.minuse ?? 1000),
    outstanding: n(t?.outstanding), expiringSoon: n(t?.soon), members: n(t?.members), earned30: n(t?.earned), used30: n(t?.used), expired30: n(t?.expired),
    recent, member,
    note: '남은 적립금 합은 「적립금 충당부채」(전표 초안 · 세무사 확인)입니다. 지급 · 회수는 사유를 남기고 감사 기록에 들어갑니다.',
  };
}

export interface PointAdjustIn { accountId: string; direction: string; amount: number; reason: string }

/** POST /admin/health/points/adjust — 운영 지급(새 묶음 · 유효 기간 설정대로) · 회수(소멸이 가까운 묶음부터 · 모자라면 422) */
export async function pointAdjust(db: DatabaseService, b: PointAdjustIn, actor: string | null) {
  if (!UUID.test(String(b.accountId ?? ''))) throw new PolicyViolation('HLT_POINT_ACCOUNT', '회원을 다시 골라 주십시오.');
  if (!['ADD', 'SUB'].includes(b.direction)) throw new PolicyViolation('HLT_POINT_DIR', '지급(ADD) · 회수(SUB)를 고르십시오.');
  const amt = n(b.amount);
  if (!Number.isInteger(amt) || amt < 1 || amt > 1_000_000) throw new PolicyViolation('HLT_POINT_AMOUNT', '지급 · 회수는 1원 ~ 100만 원 정수입니다.');
  const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('HLT_POINT_REASON', '사유는 2 ~ 200자입니다.');
  const [a] = await db.query<{ id: string }>(`SELECT id::text AS id FROM accounts WHERE id = $1::uuid`, [b.accountId]);
  if (!a) throw new NotFound('없는 회원입니다.');
  return db.transaction(async () => {
    if (b.direction === 'ADD') {
      const [l] = await db.query<{ id: string }>(
        `INSERT INTO hlt_point_lots (account_id, source, amount, remaining, expires_at)
         VALUES ($1::uuid, 'ADMIN', $2::bigint, $2::bigint, now() + make_interval(days => greatest(30, least(1825, fn_hlt_setting_num('mall.points_valid_days', 365)::int))))
         RETURNING id::text AS id`, [b.accountId, amt]);
      await db.query(`INSERT INTO hlt_point_txns (account_id, kind, amount, lot_id, reason, actor) VALUES ($1::uuid, 'ADJUST_ADD', $2::bigint, $3::bigint, $4, $5::uuid)`,
        [b.accountId, amt, l!.id, reason, actor]);
    } else {
      await db.query(`SELECT fn_hlt_point_take($1::uuid, $2::bigint, NULL, 'ADJUST_SUB', $3, $4::uuid)`, [b.accountId, amt, reason, actor]);
    }
    const [bal] = await db.query<{ b: string }>(`SELECT fn_hlt_point_balance($1::uuid)::text AS b`, [b.accountId]);
    return { ok: true, balance: n(bal?.b), note: b.direction === 'ADD' ? `지급했습니다 — ${amt.toLocaleString('ko-KR')}원.` : `회수했습니다 — ${amt.toLocaleString('ko-KR')}원.` };
  });
}

/* ── 운영 › 소개몰 › 회원 등급 ── */

/** GET /admin/health/tiers — 등급(회원 수) · 운영이 정한 회원 · 최근 바뀐 기록 · 설정 */
export async function tiersView(db: DatabaseService) {
  const tiers = await db.query(
    `SELECT t.code, t.name, t.min_amount::bigint AS "minAmount", t.earn_rate::float AS "earnRate", t.benefit, t.sort, t.active,
            (SELECT count(*)::int FROM hlt_member_tiers m WHERE m.tier_code = t.code) AS members
       FROM hlt_tiers t ORDER BY t.min_amount, t.sort, t.code`);
  const manual = await db.query(
    `SELECT m.account_id::text AS "accountId", CASE WHEN char_length(coalesce(a.name, '')) <= 1 THEN '*' ELSE left(a.name, 1) || repeat('*', char_length(a.name) - 1) END AS member, m.tier_code AS "tierCode", m.reason, m.computed_at AS "at"
       FROM hlt_member_tiers m JOIN accounts a ON a.id = m.account_id WHERE m.manual ORDER BY m.computed_at DESC LIMIT 50`);
  const changes = await db.query(
    `SELECT c.id::text AS id, CASE WHEN char_length(coalesce(a.name, '')) <= 1 THEN '*' ELSE left(a.name, 1) || repeat('*', char_length(a.name) - 1) END AS member, c.from_code AS "from", c.to_code AS "to", c.period_amount::bigint AS amount, c.by_job AS "byJob", c.reason, c.created_at AS "at"
       FROM hlt_tier_changes c JOIN accounts a ON a.id = c.account_id ORDER BY c.id DESC LIMIT 30`);
  const on = (await sw(db, 'mall.tiers')) === 'on';
  return { on, months: n((await sw(db, 'mall.tier_months')) ?? 6), tiers, manual, changes,
    note: on ? '매일 05:20 기간 구매액으로 다시 셉니다. 운영이 정한 회원은 건너뜁니다.' : '꺼져 있습니다(mall.tiers) — 켜기 전에 등급 · 기준 금액 · 적립률을 확인하십시오.' };
}

export interface TierIn { code?: string; name?: string; minAmount?: number; earnRate?: number; benefit?: string; sort?: number; active?: boolean }

const tierVals = (b: TierIn, base: { name: string; min_amount: string; earn_rate: string; benefit: string | null; sort: number; active: boolean }) => {
  const name = b.name === undefined ? base.name : String(b.name).replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 30) throw new PolicyViolation('HLT_TIER_NAME', '등급 이름은 1 ~ 30자입니다.');
  const min = b.minAmount === undefined ? n(base.min_amount) : n(b.minAmount);
  if (!Number.isInteger(min) || min < 0 || min > 1_000_000_000) throw new PolicyViolation('HLT_TIER_MIN', '기준 구매액은 0 ~ 10억 원 정수입니다.');
  const rate = b.earnRate === undefined ? n(base.earn_rate) : n(b.earnRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 20 || Math.abs(Math.round(rate * 10) - rate * 10) > 1e-9) throw new PolicyViolation('HLT_TIER_RATE', '적립률은 0 ~ 20(소수 한 자리)입니다.');
  const benefit = b.benefit === undefined ? base.benefit : (String(b.benefit).trim().slice(0, 200) || null);
  const sort = b.sort === undefined ? base.sort : n(b.sort);
  if (!Number.isInteger(sort) || sort < 0 || sort > 9999) throw new PolicyViolation('HLT_TIER_SORT', '순서는 0 ~ 9999 입니다.');
  const active = b.active === undefined ? base.active : !!b.active;
  return { name, min, rate, benefit, sort, active };
};

/** POST /admin/health/tiers — 등급 만들기(코드는 바꾸지 못함) */
export async function createTier(db: DatabaseService, b: TierIn, actor: string | null) {
  const code = String(b.code ?? '').trim().toUpperCase();
  if (!TIER_CODE.test(code)) throw new PolicyViolation('HLT_TIER_CODE', '등급 코드는 영문 대문자로 시작하는 대문자 · 숫자 · 밑줄 2 ~ 20자입니다.');
  const v = tierVals(b, { name: '', min_amount: '0', earn_rate: '1', benefit: null, sort: 0, active: true });
  const [dup] = await db.query<{ code: string }>(`SELECT code FROM hlt_tiers WHERE code = $1`, [code]);
  if (dup) throw new StateConflict('HLT_TIER_DUP', '같은 코드의 등급이 있습니다.');
  await db.query(`INSERT INTO hlt_tiers (code, name, min_amount, earn_rate, benefit, sort, active, updated_by) VALUES ($1, $2, $3::bigint, $4::numeric, $5, $6::int, $7::boolean, $8::uuid)`,
    [code, v.name, v.min, v.rate, v.benefit, v.sort, v.active, actor]);
  return { ok: true, code, note: `등급 「${v.name}」을 만들었습니다.` };
}

/** PUT /admin/health/tiers/{code} — 보낸 칸만 고침 · 끄기(active=false)는 회원이 없을 때만 */
export async function updateTier(db: DatabaseService, codeIn: string, b: TierIn, actor: string | null) {
  const code = String(codeIn ?? '').trim().toUpperCase();
  if (!TIER_CODE.test(code)) throw new NotFound('없는 등급입니다.');
  const [t] = await db.query<{ name: string; min_amount: string; earn_rate: string; benefit: string | null; sort: number; active: boolean; members: number }>(
    `SELECT name, min_amount::text AS min_amount, earn_rate::text AS earn_rate, benefit, sort, active, (SELECT count(*)::int FROM hlt_member_tiers m WHERE m.tier_code = t.code) AS members
       FROM hlt_tiers t WHERE code = $1`, [code]);
  if (!t) throw new NotFound('없는 등급입니다.');
  const v = tierVals(b, t);
  if (t.active && !v.active && t.members > 0) throw new StateConflict('HLT_TIER_IN_USE', '이 등급의 회원이 있어 끌 수 없습니다 — 기준을 바꾸고 다시 셈한 뒤 끄십시오.');
  await db.query(`UPDATE hlt_tiers SET name = $2, min_amount = $3::bigint, earn_rate = $4::numeric, benefit = $5, sort = $6::int, active = $7::boolean, updated_by = $8::uuid WHERE code = $1`,
    [code, v.name, v.min, v.rate, v.benefit, v.sort, v.active, actor]);
  return { ok: true, code, active: v.active, note: '등급을 고쳤습니다 — 다음 다시 셈(매일 05:20 · 「지금 다시 셈」)부터 적용됩니다.' };
}

/** PUT /admin/health/tiers/member/{accountId} — 운영이 등급 정하기(사유) · 빈 코드 = 풀기(다음 다시 셈부터 자동) */
export async function setMemberTier(db: DatabaseService, accountId: string, b: { tierCode?: string; reason?: string }, actor: string | null) {
  if (!UUID.test(String(accountId ?? ''))) throw new NotFound('없는 회원입니다.');
  const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('HLT_TIER_REASON', '사유는 2 ~ 200자입니다.');
  const [a] = await db.query<{ id: string }>(`SELECT id::text AS id FROM accounts WHERE id = $1::uuid`, [accountId]);
  if (!a) throw new NotFound('없는 회원입니다.');
  const code = String(b.tierCode ?? '').trim().toUpperCase();
  return db.transaction(async () => {
    const [cur] = await db.query<{ tier_code: string; period_amount: string }>(`SELECT tier_code, period_amount::text AS period_amount FROM hlt_member_tiers WHERE account_id = $1::uuid FOR UPDATE`, [accountId]);
    if (!code) {
      if (!cur) return { ok: true, released: false, note: '운영이 정한 등급이 없습니다.' };
      await db.query(`UPDATE hlt_member_tiers SET manual = false, reason = $2, updated_by = $3::uuid, computed_at = now() WHERE account_id = $1::uuid`, [accountId, reason, actor]);
      return { ok: true, released: true, note: '운영이 정한 등급을 풀었습니다 — 다음 다시 셈부터 자동입니다.' };
    }
    const [t] = await db.query<{ code: string }>(`SELECT code FROM hlt_tiers WHERE code = $1 AND active`, [code]);
    if (!t) throw new PolicyViolation('HLT_TIER_CODE', '켜진 등급을 고르십시오.');
    await db.query(
      `INSERT INTO hlt_member_tiers (account_id, tier_code, period_amount, manual, reason, computed_at, updated_by) VALUES ($1::uuid, $2, 0, true, $3, now(), $4::uuid)
       ON CONFLICT (account_id) DO UPDATE SET tier_code = EXCLUDED.tier_code, manual = true, reason = EXCLUDED.reason, computed_at = now(), updated_by = EXCLUDED.updated_by`,
      [accountId, code, reason, actor]);
    if (cur?.tier_code !== code) {
      await db.query(`INSERT INTO hlt_tier_changes (account_id, from_code, to_code, period_amount, by_job, reason, actor) VALUES ($1::uuid, $2, $3, $4::bigint, false, $5, $6::uuid)`,
        [accountId, cur?.tier_code ?? null, code, n(cur?.period_amount), reason, actor]);
    }
    return { ok: true, tierCode: code, note: '등급을 정했습니다 — 다시 셈에서 건너뜁니다.' };
  });
}

/** 정기 작업 mall_tier_recalc(매일 05:20) · POST /admin/health/tiers/run — mall.tiers on 일 때만 · 운영이 정한 회원 건너뜀 · 올라가면 회원 알림 */
export async function mallTierJob(db: DatabaseService, opts: { force?: boolean } = {}) {
  const on = (await sw(db, 'mall.tiers')) === 'on';
  if (!on && !opts.force) return { on, accounts: 0, changed: 0, skipped: '꺼짐(mall.tiers)' };
  const months = Math.max(1, Math.min(12, n((await sw(db, 'mall.tier_months')) ?? 6) || 6));
  const rows = await db.query<{ account_id: string; amt: string; code: string | null; before: string | null; manual: boolean | null; up: boolean | null }>(
    `WITH amt AS (
       SELECT o.account_id, sum(o.goods_amount - o.discount_amount)::bigint AS amt
         FROM hlt_orders o JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
        WHERE o.status = 'CONFIRMED' AND o.confirmed_at >= now() - make_interval(months => $1::int) GROUP BY o.account_id),
     who AS (SELECT account_id FROM amt UNION SELECT account_id FROM hlt_member_tiers),
     calc AS (
       SELECT w.account_id, coalesce(a.amt, 0)::bigint AS amt,
              (SELECT t.code FROM hlt_tiers t WHERE t.active AND t.min_amount <= coalesce(a.amt, 0) ORDER BY t.min_amount DESC, t.sort LIMIT 1) AS code
         FROM who w LEFT JOIN amt a ON a.account_id = w.account_id)
     SELECT c.account_id::text AS account_id, c.amt::text AS amt, c.code, m.tier_code AS before, m.manual,
            (SELECT tn.min_amount FROM hlt_tiers tn WHERE tn.code = c.code) > coalesce((SELECT tb.min_amount FROM hlt_tiers tb WHERE tb.code = m.tier_code), -1) AS up
       FROM calc c LEFT JOIN hlt_member_tiers m ON m.account_id = c.account_id
      ORDER BY c.account_id LIMIT 20000`, [months]);
  let changed = 0;
  for (const r of rows) {
    if (!r.code || r.manual) continue;
    await db.transaction(async () => {
      await db.query(
        `INSERT INTO hlt_member_tiers (account_id, tier_code, period_amount, manual, computed_at) VALUES ($1::uuid, $2, $3::bigint, false, now())
         ON CONFLICT (account_id) DO UPDATE SET tier_code = EXCLUDED.tier_code, period_amount = EXCLUDED.period_amount, computed_at = now() WHERE NOT hlt_member_tiers.manual`,
        [r.account_id, r.code, n(r.amt)]);
      if (r.before !== r.code) {
        await db.query(`INSERT INTO hlt_tier_changes (account_id, from_code, to_code, period_amount, by_job) VALUES ($1::uuid, $2, $3, $4::bigint, true)`,
          [r.account_id, r.before, r.code, n(r.amt)]);
        if (r.before && r.up && on) {
          await db.query(
            `INSERT INTO notifications (account_id, event_code, title, body, link_url)
             SELECT $1::uuid, 'HLT_TIER_UP', '소개몰 회원 등급이 올랐습니다', '「' || t.name || '」 등급 — 구매확정 적립 ' || t.earn_rate::text || '퍼센트', '/my/health/benefits' FROM hlt_tiers t WHERE t.code = $2`,
            [r.account_id, r.code]);
        }
      }
    });
    if (r.before !== r.code) changed++;
  }
  return { on, months, accounts: rows.length, changed };
}

/* ── 운영 › 소개몰 › 상품권 ── */

/** GET /admin/health/giftcards?state= — 스위치 · 남은 잔액 합(선수금) · 발행 · 사용 합 · 상품권 200 */
export async function giftView(db: DatabaseService, state?: string) {
  const st = ['ACTIVE', 'EXPIRED', 'VOID', 'REFUNDED'].includes(String(state)) ? String(state) : '';
  const [s] = await db.query<{ sw: string | null; days: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.giftcard') AS sw, (SELECT value FROM site_settings WHERE key = 'mall.giftcard_valid_days') AS days`);
  const [t] = await db.query<{ active: number; outstanding: string; issued: string; used: string; sold_out: string }>(
    `SELECT count(*) FILTER (WHERE state = 'ACTIVE')::int AS active, coalesce(sum(balance) FILTER (WHERE state = 'ACTIVE'), 0)::text AS outstanding,
            coalesce(sum(face_amount), 0)::text AS issued, coalesce(sum(balance) FILTER (WHERE state = 'ACTIVE' AND kind = 'SOLD'), 0)::text AS sold_out,
            (SELECT coalesce(sum(CASE WHEN kind = 'USE' THEN amount ELSE -amount END), 0) FROM hlt_giftcard_txns WHERE kind IN ('USE', 'RESTORE'))::text AS used
       FROM hlt_giftcards`);
  const cards = await db.query(
    `SELECT id::text AS id, code_tail AS tail, batch_no AS "batchNo", kind, face_amount::bigint AS face, balance::bigint AS balance, state, expires_at AS "expiresAt",
            expires_at <= now() AS expired, buyer_name AS "buyerName", memo, issued_at AS "issuedAt", closed_at AS "closedAt"
       FROM hlt_giftcards WHERE ($1::text = '' OR state = $1::text) ORDER BY id DESC LIMIT 200`, [st]);
  return { on: s?.sw === 'on', validDays: n(s?.days ?? 1825), active: n(t?.active), outstanding: n(t?.outstanding), soldOutstanding: n(t?.sold_out), issued: n(t?.issued), used: n(t?.used), cards,
    note: '코드는 발행할 때 한 번만 보입니다(DB 에는 지문 · 끝 4자리만). 판매 상품권의 남은 잔액은 선수금입니다(전표 초안 · 세무사 확인 · 법무 확인 뒤 켬).' };
}

export interface GiftIssueIn { kind: string; amount: number; count: number; validDays?: number; buyerName?: string; memo?: string }

/** 상품권 코드 하나 — XXXX-XXXX-XXXX-XXXX(32글자 · 약 80비트) */
export function newGiftCode() {
  let s = '';
  for (let i = 0; i < 16; i++) s += GIFT_ALPHA[randomInt(GIFT_ALPHA.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

/** POST /admin/health/giftcards — 발행(1 ~ 100장) · 응답에 코드(이번 한 번만) · 기록 ISSUE */
export async function giftIssue(db: DatabaseService, b: GiftIssueIn, actor: string | null) {
  if (!(GIFT_KINDS as readonly string[]).includes(b.kind)) throw new PolicyViolation('HLT_GIFT_KIND', '판매(SOLD) · 판촉(PROMO)을 고르십시오.');
  const amt = n(b.amount), cnt = n(b.count);
  if (!Number.isInteger(amt) || amt < 1000 || amt > 1_000_000) throw new PolicyViolation('HLT_GIFT_AMOUNT', '액면은 1천 ~ 100만 원 정수입니다.');
  if (!Number.isInteger(cnt) || cnt < 1 || cnt > 100) throw new PolicyViolation('HLT_GIFT_COUNT', '한 번에 1 ~ 100장 발행합니다.');
  const defDays = n((await sw(db, 'mall.giftcard_valid_days')) ?? 1825) || 1825;
  const days = b.validDays === undefined ? defDays : n(b.validDays);
  if (!Number.isInteger(days) || days < 365 || days > 3650) throw new PolicyViolation('HLT_GIFT_DAYS', '유효 기간은 365 ~ 3650일입니다.');
  const buyer = b.buyerName === undefined ? null : (String(b.buyerName).replace(/\s+/g, ' ').trim().slice(0, 40) || null);
  const memo = b.memo === undefined ? null : (String(b.memo).trim().slice(0, 200) || null);
  const batch = `GC${kstYmd().replace(/-/g, '')}-${String(Date.now() % 100_000_000).padStart(8, '0')}`;
  return db.transaction(async () => {
    const codes: Array<{ id: string; code: string }> = [];
    for (let i = 0; i < cnt; i++) {
      const code = newGiftCode();
      const plain = code.replace(/-/g, '');
      const [c] = await db.query<{ id: string }>(
        `INSERT INTO hlt_giftcards (code_hash, code_tail, batch_no, kind, face_amount, balance, expires_at, buyer_name, memo, issued_by)
         VALUES (fn_hlt_gift_hash($1), $2, $3, $4, $5::bigint, $5::bigint, now() + make_interval(days => $6::int), $7, $8, $9::uuid) RETURNING id::text AS id`,
        [plain, plain.slice(-4), batch, b.kind, amt, days, buyer, memo, actor]);
      await db.query(`INSERT INTO hlt_giftcard_txns (card_id, kind, amount, reason, actor) VALUES ($1::bigint, 'ISSUE', $2::bigint, $3, $4::uuid)`, [c!.id, amt, memo, actor]);
      codes.push({ id: c!.id, code });
    }
    return { ok: true, batchNo: batch, kind: b.kind, amount: amt, count: cnt, codes,
      note: `상품권 ${cnt}장을 발행했습니다 — 코드는 지금 한 번만 보입니다(저장하거나 전달하십시오).` };
  });
}

/** GET /admin/health/giftcards/{id} — 상품권 · 기록 */
export async function giftDetail(db: DatabaseService, idIn: string) {
  const id = idOk(idIn, '없는 상품권입니다.');
  const [c] = await db.query(
    `SELECT id::text AS id, code_tail AS tail, batch_no AS "batchNo", kind, face_amount::bigint AS face, balance::bigint AS balance, state, expires_at AS "expiresAt",
            buyer_name AS "buyerName", memo, issued_at AS "issuedAt", closed_at AS "closedAt", closed_reason AS "closedReason",
            EXISTS (SELECT 1 FROM hlt_giftcard_txns t WHERE t.card_id = g.id AND t.kind = 'USE') AS used
       FROM hlt_giftcards g WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 상품권입니다.');
  const txns = await db.query(
    `SELECT t.id::text AS id, t.kind, t.amount::bigint AS amount, o.order_no AS "orderNo", t.reason, t.created_at AS "createdAt"
       FROM hlt_giftcard_txns t LEFT JOIN hlt_orders o ON o.id = t.order_id WHERE t.card_id = $1::bigint ORDER BY t.id`, [id]);
  return { card: c, txns };
}

/** POST /admin/health/giftcards/{id}/close — 무효(VOID · 안 쓴 것만) · 잔액 환불 기록(REFUND · 판매 상품권 · 돈은 따로 보냄) */
export async function giftClose(db: DatabaseService, idIn: string, b: { action: string; reason: string }, actor: string | null) {
  const id = idOk(idIn, '없는 상품권입니다.');
  if (!['VOID', 'REFUND'].includes(b.action)) throw new PolicyViolation('HLT_GIFT_ACTION', '무효(VOID) · 잔액 환불(REFUND)을 고르십시오.');
  const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('HLT_GIFT_REASON', '사유는 2 ~ 200자입니다.');
  const [c] = await db.query<{ state: string; kind: string; used: boolean }>(
    `SELECT state, kind, EXISTS (SELECT 1 FROM hlt_giftcard_txns t WHERE t.card_id = g.id AND t.kind = 'USE') AS used FROM hlt_giftcards g WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 상품권입니다.');
  if (c.state !== 'ACTIVE') throw new StateConflict('HLT_GIFT_STATE', '이미 닫힌 상품권입니다.');
  if (b.action === 'VOID' && c.used) throw new StateConflict('HLT_GIFT_USED', '한 번이라도 쓴 상품권은 무효로 하지 않습니다(잔액 환불로).');
  if (b.action === 'REFUND' && c.kind === 'PROMO') throw new PolicyViolation('HLT_GIFT_PROMO_REFUND', '판촉으로 드린 상품권은 잔액 환불이 없습니다(무효 · 소멸로).');
  const [r] = await db.query<{ amt: string }>(`SELECT fn_hlt_gift_close($1::bigint, $2, $3, $4::uuid)::text AS amt`, [id, b.action, reason, actor]);
  return { ok: true, id, state: b.action === 'VOID' ? 'VOID' : 'REFUNDED', amount: n(r?.amt),
    note: b.action === 'VOID' ? '무효로 했습니다.' : `잔액 ${n(r?.amt).toLocaleString('ko-KR')}원 환불로 적었습니다 — 돈은 따로 보내 주십시오.` };
}

/** POST /admin/health/giftcards/lookup — 코드로 찾기(운영 · 꺼져도 됨) */
export async function giftLookup(db: DatabaseService, code: string) {
  const c = await giftByCode(db, code);
  return { id: c.id, tail: c.tail, kind: c.kind, face: c.face, balance: c.balance, state: c.state, expiresAt: c.expiresAt, expired: c.expired };
}

/* ── 정기 작업 mall_benefit_expire(매일 00:20) — 적립금 · 상품권 소멸 · 적립금 30일 전 회원 알림 ── */
export async function mallBenefitExpireJob(db: DatabaseService) {
  const pts = await db.query<{ amount: string }>(
    `WITH x AS (SELECT id, account_id, remaining FROM hlt_point_lots
                 WHERE remaining > 0 AND closed_at IS NULL AND expires_at <= now() ORDER BY id LIMIT 2000 FOR UPDATE SKIP LOCKED),
          u AS (UPDATE hlt_point_lots l SET remaining = 0, closed_reason = 'EXPIRED', closed_at = clock_timestamp() FROM x WHERE l.id = x.id
                RETURNING x.id, x.account_id, x.remaining)
     INSERT INTO hlt_point_txns (account_id, kind, amount, lot_id, reason)
     SELECT account_id, 'EXPIRE', remaining, id, '유효 기간 지남' FROM u RETURNING amount::text AS amount`);
  await db.query(`UPDATE hlt_point_lots SET closed_reason = 'EXPIRED', closed_at = clock_timestamp() WHERE remaining = 0 AND closed_at IS NULL AND expires_at <= now()`);
  const due = await db.query<{ id: string }>(`SELECT id::text AS id FROM hlt_giftcards WHERE state = 'ACTIVE' AND expires_at <= now() ORDER BY id LIMIT 1000`);
  let giftAmt = 0;
  for (const g of due) {
    const [r] = await db.query<{ amt: string }>(`SELECT fn_hlt_gift_close($1::bigint, 'EXPIRE', '유효 기간 지남', NULL)::text AS amt`, [g.id]);
    giftAmt += n(r?.amt);
  }
  let notified = 0;
  if ((await sw(db, 'mall.points')) === 'on') {
    const nt = await db.query(
      `WITH x AS (SELECT id, account_id, remaining, expires_at FROM hlt_point_lots
                   WHERE remaining > 0 AND closed_at IS NULL AND notified_at IS NULL AND expires_at > now() AND expires_at <= now() + interval '30 days'
                   ORDER BY id LIMIT 5000 FOR UPDATE SKIP LOCKED),
            u AS (UPDATE hlt_point_lots l SET notified_at = now() FROM x WHERE l.id = x.id RETURNING x.account_id, x.remaining, x.expires_at),
            g AS (SELECT account_id, sum(remaining) AS amt, min(expires_at) AS first FROM u GROUP BY account_id)
       INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT account_id, 'HLT_POINT_EXPIRE_SOON', '소개몰 적립금 소멸 예정',
              to_char(amt, 'FM999,999,999,999') || '원이 ' || to_char(first AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || '부터 차례로 소멸됩니다.', '/my/health/benefits'
         FROM g RETURNING account_id`);
    notified = nt.length;
  }
  const ptAmt = pts.reduce((s, r) => s + n(r.amount), 0);
  if (pts.length || due.length) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       VALUES ('MALL_BENEFIT_EXPIRED', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`소개몰 소멸 — 적립금 ${pts.length}묶음 ${ptAmt.toLocaleString('ko-KR')}원 · 상품권 ${due.length}장 ${giftAmt.toLocaleString('ko-KR')}원 — 소개몰 › 적립금 · 상품권`.slice(0, 300),
       JSON.stringify({ day: kstYmd(), pointLots: pts.length, pointAmount: ptAmt, giftCards: due.length, giftAmount: giftAmt })]);
  }
  return { pointLots: pts.length, pointAmount: ptAmt, giftCards: due.length, giftAmount: giftAmt, notified };
}

/* ── 전표(정기 작업 acct_journal · sources.ts 끝에 덧붙임 · ㉝ COUPON_SOURCES 뒤) — 계정 초안(세무사 확인) ──
 *   직판 결제 전표(MALL_SALE · 낸 돈 = 할인 · 적립금 · 상품권 뒤)가 있는 주문의 적립금 · 상품권 몫을 따로 매출로 잡음
 *   면세 몫은 「쿠폰 뒤 면세 상품 금액」을 낸 돈 → 적립금 → 상품권 차례로 나눔(낸 돈 몫은 MALL_SALE 이 이미 잡음 · 합계는 맞음)
 *   journal.ts 의 MALL_SALE 줄은 고치지 않음(㉝ 패치와 겹치지 않게) */

function pointUseLines(amount: number, exempt: number) {
  const ex = Math.max(0, Math.min(amount, exempt));
  return [dr('MALL_POINT_LIAB', amount), ...(ex > 0 ? [cr('REV_MALL_EXEMPT', ex)] : []), ...(amount - ex > 0 ? [cr('REV_MALL', amount - ex)] : [])];
}
function giftUseLines(amount: number, exempt: number) {
  const ex = Math.max(0, Math.min(amount, exempt));
  const v = vatSplit(amount - ex);
  return [dr('GIFT_ADV', amount), ...(ex > 0 ? [cr('REV_MALL_EXEMPT', ex)] : []), ...(v.supply > 0 ? [cr('REV_MALL', v.supply)] : []), ...(v.vat > 0 ? [cr('VAT_OUT', v.vat)] : [])];
}
function giftCloseLines(kind: string, gkind: string, amount: number) {
  const to = kind === 'REFUND' ? 'CASH' : gkind === 'PROMO' ? 'EXP_MALL_PROMO' : kind === 'VOID' ? 'CASH' : 'INC_GIFT_LAPSE';
  return [dr('GIFT_ADV', amount), cr(to, amount)];
}

export const BENEFIT_SOURCES: Source[] = [
  {
    name: 'MALL_POINT_EARN', label: '소개몰 적립금 적립 · 운영 지급(판매촉진비)',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, t.kind, o.order_no AS no, NULL::text AS party
            FROM hlt_point_txns t LEFT JOIN hlt_orders o ON o.id = t.order_id
           WHERE t.kind IN ('EARN', 'ADJUST_ADD') AND t.created_at >= fn_acct_from() AND fn_acct_stub_ok(coalesce((SELECT bool_or(p.stub) FROM hlt_payments p WHERE p.order_id = t.order_id AND p.approved_at IS NOT NULL), false))
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_EARN' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 ${r.kind === 'ADJUST_ADD' ? '운영 지급' : '적립'} ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: [dr('EXP_MALL_PROMO', n(r.amount)), cr('MALL_POINT_LIAB', n(r.amount))] }),
  },
  {
    name: 'MALL_POINT_LAPSE', label: '소개몰 적립금 소멸 · 회수(환입)',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, t.kind, o.order_no AS no, NULL::text AS party
            FROM hlt_point_txns t LEFT JOIN hlt_point_lots l ON l.id = t.lot_id LEFT JOIN hlt_orders o ON o.id = coalesce(t.order_id, l.order_id)
           WHERE t.kind IN ('EXPIRE', 'REVOKE', 'ADJUST_SUB') AND t.created_at >= fn_acct_from() AND fn_acct_stub_ok(coalesce((SELECT bool_or(p.stub) FROM hlt_payments p WHERE p.order_id = coalesce(t.order_id, l.order_id) AND p.approved_at IS NOT NULL), false))
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_LAPSE' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 ${r.kind === 'EXPIRE' ? '소멸' : r.kind === 'REVOKE' ? '반품 회수' : '운영 회수'} ${r.no ?? ''}`.trim(), evidence: 'NONE',
      lines: [dr('MALL_POINT_LIAB', n(r.amount)), cr('EXP_MALL_PROMO', n(r.amount))] }),
  },
  {
    name: 'MALL_POINT_USE', label: '소개몰 적립금 사용(매출)',
    sql: `SELECT p.id::text AS key, p.approved_at AS at, o.point_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total, 0), o.point_amount)::bigint AS exempt
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.point_amount > 0 AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.amount > 0 AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_USE' AND e.source_key = p.id::text)
           ORDER BY p.approved_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 사용 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: pointUseLines(n(r.amount), n(r.exempt)) }),
  },
  {
    name: 'MALL_POINT_USE_CANCEL', label: '소개몰 적립금 사용 되돌림(취소 · 반품)',
    sql: `SELECT p.id::text AS key, (SELECT max(t.created_at) FROM hlt_point_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE') AS at,
                 o.point_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total, 0), o.point_amount)::bigint AS exempt
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.point_amount > 0 AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM hlt_point_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE')
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_USE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_USE_CANCEL' AND e.source_key = p.id::text)
           ORDER BY p.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 사용 되돌림 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: reverse(pointUseLines(n(r.amount), n(r.exempt))) }),
  },
  {
    name: 'MALL_GIFT_ISSUE', label: '소개몰 상품권 발행(선수금)',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, g.kind AS gkind, g.batch_no AS no, g.buyer_name AS party
            FROM hlt_giftcard_txns t JOIN hlt_giftcards g ON g.id = t.card_id
           WHERE t.kind = 'ISSUE' AND t.created_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_ISSUE' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 ${r.gkind === 'PROMO' ? '판촉 발행' : '판매'} ${r.no ?? ''}`.trim(), evidence: 'NONE',
      lines: [dr(r.gkind === 'PROMO' ? 'EXP_MALL_PROMO' : 'CASH', n(r.amount)), cr('GIFT_ADV', n(r.amount))] }),
  },
  {
    name: 'MALL_GIFT_USE', label: '소개몰 상품권 사용(매출)',
    sql: `SELECT p.id::text AS key, p.approved_at AS at, o.gift_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total - o.point_amount, 0), o.gift_amount)::bigint AS exempt
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.gift_amount > 0 AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.amount > 0 AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_USE' AND e.source_key = p.id::text)
           ORDER BY p.approved_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 사용 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: giftUseLines(n(r.amount), n(r.exempt)) }),
  },
  {
    name: 'MALL_GIFT_USE_CANCEL', label: '소개몰 상품권 사용 되돌림(취소 · 반품)',
    sql: `SELECT p.id::text AS key, (SELECT max(t.created_at) FROM hlt_giftcard_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE') AS at,
                 o.gift_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total - o.point_amount, 0), o.gift_amount)::bigint AS exempt
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.gift_amount > 0 AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM hlt_giftcard_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE')
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_USE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_USE_CANCEL' AND e.source_key = p.id::text)
           ORDER BY p.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 사용 되돌림 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: reverse(giftUseLines(n(r.amount), n(r.exempt))) }),
  },
  {
    name: 'MALL_GIFT_CLOSE', label: '소개몰 상품권 소멸 · 무효 · 잔액 환불',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, t.kind, g.kind AS gkind, g.batch_no AS no, g.buyer_name AS party
            FROM hlt_giftcard_txns t JOIN hlt_giftcards g ON g.id = t.card_id
           WHERE t.kind IN ('EXPIRE', 'VOID', 'REFUND') AND t.created_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_CLOSE' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 ${r.kind === 'VOID' ? '무효' : r.kind === 'REFUND' ? '잔액 환불' : '소멸'} ${r.no ?? ''}`.trim(), evidence: 'NONE',
      lines: giftCloseLines(String(r.kind ?? 'EXPIRE'), String(r.gkind ?? 'SOLD'), n(r.amount)) }),
  },
];
