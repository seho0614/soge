import { randomUUID } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { resolvePaymentProvider } from '../billing/payment.provider';
import { confirmOrRecover } from '../billing/payment-recover';
import { Source, cr, dr, reverse, vatSplit } from '../acct/journal';
import { LsxSettings, lsxSettings, needReason, ownListing, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.515 (D276 · docs/653) 매물 끌어올리기 — 대표 결정 11/20 「끌어올리기는 상황에 따라 전환 가능 · 관리자가 지정」
 *   ① 방식 lsx.bump_mode = OFF(처음) | FREE | PAID — SUPER 가 언제든 바꿈(바뀐 기록 · 사유는 「전체 설정」 기록 그대로)
 *   ② FREE: 회원마다 기간(lsx.bump_period_days)당 무료 횟수(lsx.bump_free_count) · 같은 매물 최소 간격(lsx.bump_min_hours)
 *      PAID: 1회 금액(lsx.bump_price · 공급가) + 부가세(D243 별도 시작일 뒤 · fn_vat10) · 기존 결제 어댑터(키 없으면 시험 결제 stub) ·
 *            결제 승인 뒤에만 끌어올림 · 끌어올린 뒤 회원 환불 없음(문구 법무 확인) · 운영 환불은 SUPER(사유 · 오류 · 중복 결제 등) · 전표 LSX_BUMP_PAID · LSX_BUMP_REFUND
 *      최소 간격은 무료 · 유료 같음(돈으로 간격을 줄이지 못함)
 *   ③ 회원 등급 · 파트너별로 다르게 하지 않음 — 한 가지 규칙(다음 후보는 NOTES)
 *   ④ 노출 가산은 방식과 상관없이 같은 상한 · 감쇠 — 최신순(RECENT) 정렬 키가 greatest(게시 시각, 끌어올린 시각)이 되어
 *      그 시각의 새 글과 같은 자리에서 시작해 새 글이 올라올수록 내려가고(감쇠), lsx.bump_effect_hours(처음 72 · 최대 168) 뒤 원래 자리.
 *      앞날 시각 없음 · 효과 시간 상한은 DB 트리거(trg_lsx_bump_live_guard) · 유료라고 더 올리지 않음(노출 공정성 · INV-11)
 *      다른 정렬(소개비 · 인기 · 관련도 · 마감 · 금액)과 우선노출(광고) 영역은 그대로.
 *   ⑤ 운영자 직접 끌어올리기는 바로잡기용으로만(대표 결정 11/20) — SUPER 만 · 사유 종류 FIX_ERROR(오류 바로잡기) · MEMBER_REQUEST(회원 요청 대신) 둘만 + 글 사유 ·
 *      그 밖 사유는 서버(DTO · 서비스) · DB(CHECK · trg_lsx_admin_bump_guard) 둘 다 막음 · 감사 · 같은 상한 · 감쇠 · 목록에 「끌어올림」 표시
 * ------------------------------------------------------------------- */

export interface BumpPay { paymentKey?: string; orderId?: string; amount?: number }
/** 운영 바로잡기 사유 종류 — DB CHECK 와 같은 목록 */
export const ADMIN_BUMP_REASONS = ['FIX_ERROR', 'MEMBER_REQUEST'] as const;

async function vatOf(db: DatabaseService, supply: number) {
  const [v] = await db.query<{ sep: boolean; vat: string }>(`SELECT fn_vat_separate(now()) AS sep, fn_vat10($1) AS vat`, [supply]);
  const vat = v?.sep ? Number(v.vat) : 0;
  return { separate: !!v?.sep, supply, vat, total: supply + vat };
}

/** 이 매물을 지금 끌어올릴 수 있나(결제 전에 막을 것을 모두 먼저 봄 — 결제 뒤에 막히면 돈만 나감) */
async function precheck(db: DatabaseService, me: string, listingId: string, s: LsxSettings) {
  if (s.bumpMode === 'OFF') throw new PolicyViolation('LSX_OFF', '지금은 쓸 수 없는 기능입니다.');
  const l = await ownListing(db, listingId, me);
  if (l.status !== 'PUBLISHED') throw new StateConflict('LSX_NOT_PUBLISHED', '노출 중인 매물만 끌어올릴 수 있습니다.');
  if (l.is_priority_exposed) throw new StateConflict('LSX_BUMP_PRIORITY', '우선노출(광고) 영역의 매물은 끌어올리지 않습니다.');
  const [last] = await db.query<{ at: string; next: string; wait: boolean }>(
    `SELECT max(created_at) AS at, max(created_at) + make_interval(hours => $2::int) AS next,
            coalesce(max(created_at) + make_interval(hours => $2::int) > now(), false) AS wait
       FROM lsx_bumps WHERE listing_id = $1 AND kind <> 'ADMIN'`, [listingId, s.bumpMinHours]);
  if (last?.wait) {
    throw new StateConflict('LSX_BUMP_TOO_SOON', `같은 매물은 ${s.bumpMinHours}시간에 한 번만 끌어올릴 수 있습니다.`);
  }
  const [used] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM lsx_bumps WHERE account_id = $1 AND kind = 'FREE' AND created_at > now() - make_interval(days => $2::int)`,
    [me, s.bumpPeriodDays]);
  return { l, nextAt: last?.next ?? null, freeUsed: used?.n ?? 0 };
}

/** 회원 — 끌어올리기 전에 볼 값(방식 · 남은 무료 횟수 · 금액 · 다음 가능 시각) */
export async function bumpQuote(db: DatabaseService, me: string, listingId: string) {
  const s = await lsxSettings(db);
  const l = await ownListing(db, listingId, me);
  const [last] = await db.query<{ next: string | null }>(
    `SELECT max(created_at) + make_interval(hours => $2::int) AS next FROM lsx_bumps WHERE listing_id = $1 AND kind <> 'ADMIN'`, [listingId, s.bumpMinHours]);
  const [used] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM lsx_bumps WHERE account_id = $1 AND kind = 'FREE' AND created_at > now() - make_interval(days => $2::int)`, [me, s.bumpPeriodDays]);
  const [live] = await db.query<{ until_at: string }>(`SELECT until_at FROM lsx_bump_live WHERE listing_id = $1`, [listingId]);
  const price = s.bumpMode === 'PAID' && s.bumpPrice > 0 ? await vatOf(db, s.bumpPrice) : null;
  const nextAt = last?.next && new Date(last.next).getTime() > Date.now() ? last.next : null;
  return {
    mode: s.bumpMode, status: l.status, effectHours: s.bumpEffectHours, minHours: s.bumpMinHours,
    freeCount: s.bumpFreeCount, freeLeft: Math.max(0, s.bumpFreeCount - (used?.n ?? 0)), periodDays: s.bumpPeriodDays,
    price: price ? { supply: price.supply, vat: price.vat, amount: price.total, vatSeparate: price.separate } : null,
    nextAt, liveUntil: live?.until_at ?? null,
    canBump: s.bumpMode !== 'OFF' && l.status === 'PUBLISHED' && !l.is_priority_exposed && !nextAt
      && (s.bumpMode !== 'FREE' || (used?.n ?? 0) < s.bumpFreeCount) && (s.bumpMode !== 'PAID' || !!price),
    refundNote: '끌어올린 뒤에는 환불하지 않습니다(결제 오류 · 중복 결제는 고객센터). — 법무 확인 중인 문구',
  };
}

/** 효과 줄 넣기(무료 · 유료 · 운영 같은 상한) */
async function apply(db: DatabaseService, listingId: string, owner: string, kind: 'FREE' | 'PAID' | 'ADMIN', s: LsxSettings,
                     paymentId: number | null, actorId: string | null, reason: string | null, reasonKind: string | null = null) {
  const [b] = await db.query<{ id: string; sort_at: string; until_at: string }>(
    `INSERT INTO lsx_bumps (listing_id, account_id, kind, sort_at, until_at, payment_id, actor_id, reason, reason_kind)
     VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp() + make_interval(hours => $4::int), $5, $6, $7, $8)
     RETURNING id::text, sort_at, until_at`, [listingId, owner, kind, s.bumpEffectHours, paymentId, actorId, reason, reasonKind]);
  await db.query(
    `INSERT INTO lsx_bump_live (listing_id, bump_id, kind, sort_at, until_at) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
     ON CONFLICT (listing_id) DO UPDATE SET bump_id = EXCLUDED.bump_id, kind = EXCLUDED.kind, sort_at = EXCLUDED.sort_at, until_at = EXCLUDED.until_at`,
    [listingId, b!.id, kind, b!.sort_at, b!.until_at]);
  return { bumpId: Number(b!.id), sortAt: b!.sort_at, until: b!.until_at };
}

/** 회원 — 끌어올리기(FREE · PAID) */
export async function memberBump(db: DatabaseService, me: string, listingId: string, pay: BumpPay = {}) {
  if (!UUID_RE.test(listingId)) throw new NotFound('매물을 찾을 수 없습니다.');
  const s = await lsxSettings(db);
  if (s.bumpMode === 'FREE') {
    return db.transaction(async () => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('lsx-bump:' || $1::text, 0))`, [me]);
      const p = await precheck(db, me, listingId, s);
      if (p.freeUsed >= s.bumpFreeCount) {
        throw new PolicyViolation('LSX_BUMP_FREE_USED', `이번 기간의 무료 끌어올리기(${s.bumpFreeCount}회)를 모두 썼습니다.`);
      }
      const r = await apply(db, listingId, me, 'FREE', s, null, null, null);
      return { ok: true, kind: 'FREE', ...r, freeLeft: s.bumpFreeCount - p.freeUsed - 1, note: '끌어올렸습니다. 최신순 목록에서 지금 올린 글과 같은 자리에서 시작합니다.' };
    });
  }
  if (s.bumpMode === 'PAID') {
    if (!(s.bumpPrice > 0)) throw new StateConflict('LSX_BUMP_PRICE_UNSET', '유료 끌어올리기 금액이 아직 정해지지 않았습니다.');
    const vx = await vatOf(db, s.bumpPrice);
    await precheck(db, me, listingId, s);   // 결제 요청 전에 막을 것(간격 · 상태)
    if (!pay.paymentKey) {
      throw new PolicyViolation('LSX_BUMP_PAYMENT_REQUIRED', `끌어올리기는 1회 ${vx.total.toLocaleString('ko-KR')}원 결제 후 됩니다.`,
        { supply: vx.supply, vat: vx.vat, amount: vx.total, vatSeparate: vx.separate, orderId: `lsx-${randomUUID().replace(/-/g, '').slice(0, 24)}`, orderName: '매물 끌어올리기 1회' });
    }
    if (pay.amount != null && Number(pay.amount) !== vx.total) {
      throw new PolicyViolation('LSX_AMOUNT_MISMATCH', `결제 금액이 맞지 않습니다 — 끌어올리기 1회는 ${vx.total.toLocaleString('ko-KR')}원입니다.`, { amount: vx.total });
    }
    const orderId = String(pay.orderId ?? `lsx-${randomUUID().replace(/-/g, '').slice(0, 24)}`);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) throw new PolicyViolation('LSX_ORDER_ID', '주문 번호 형식이 맞지 않습니다.');
    return db.transaction(async () => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('lsx-bump:' || $1::text, 0))`, [me]);
      await precheck(db, me, listingId, s);   // 잠근 뒤 한 번 더(두 번 눌렀을 때)
      const [used] = await db.query(
        `SELECT 1 FROM lsx_bump_payments WHERE payment_key = $1 OR order_id = $2
         UNION ALL SELECT 1 FROM referral_code_payments WHERE payment_key = $1
         UNION ALL SELECT 1 FROM subscription_invoices WHERE payment_key = $1 LIMIT 1`, [pay.paymentKey, orderId]);
      if (used) throw new StateConflict('PAYMENT_KEY_USED', '이미 사용한 결제입니다. 같은 결제로 다시 끌어올릴 수 없습니다.');
      const r = await confirmOrRecover(resolvePaymentProvider(), {
        paymentKey: pay.paymentKey!, orderId, amount: vx.total, orderName: '매물 끌어올리기 1회',   // 소개비가 아닙니다 — 회원이 플랫폼에 내는 노출 요금
      });
      if (!r.approved) {
        if (r.uncertain) {
          throw new PolicyViolation('PAYMENT_UNCERTAIN', '결제 결과를 확인하지 못했습니다. 잠시 뒤 같은 요청으로 다시 시도해 주십시오 — 이미 승인된 결제는 다시 청구되지 않습니다.');
        }
        throw new PolicyViolation('PAYMENT_FAILED', r.detail ?? '결제 승인에 실패했습니다.');
      }
      const [p] = await db.query<{ id: string }>(
        `INSERT INTO lsx_bump_payments (payment_key, order_id, account_id, listing_id, supply, vat, amount, stub)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
        [pay.paymentKey, orderId, me, listingId, vx.supply, vx.vat, vx.total, !!r.stub]);
      const out = await apply(db, listingId, me, 'PAID', s, Number(p!.id), null, null);
      return { ok: true, kind: 'PAID', ...out, paymentId: Number(p!.id), amount: vx.total, stub: !!r.stub,
               note: r.stub ? '시험 결제(실제 돈 없음)로 끌어올렸습니다.' : '결제 뒤 끌어올렸습니다.' };
    });
  }
  throw new PolicyViolation('LSX_OFF', '지금은 쓸 수 없는 기능입니다.');
}

/** 운영자 바로잡기(SUPER 만 · 사유 종류 둘 + 글 사유 · 감사 · 같은 상한) · 방식이 OFF 여도 됨 */
export async function adminBump(db: DatabaseService, actorId: string, d: { listingId?: string; reasonKind?: string; reason?: string }) {
  const id = String(d.listingId ?? '');
  if (!UUID_RE.test(id)) throw new NotFound('매물을 찾을 수 없습니다.');
  const kind = String(d.reasonKind ?? '');
  if (!(ADMIN_BUMP_REASONS as readonly string[]).includes(kind)) {
    throw new PolicyViolation('LSX_ADMIN_BUMP_REASON', '운영 끌어올리기는 「오류 바로잡기」 · 「회원 요청 대신」 때만 할 수 있습니다.');
  }
  const reason = needReason(d.reason);
  const s = await lsxSettings(db);
  const [l] = await db.query<{ owner: string; status: string; is_priority_exposed: boolean }>(
    `SELECT owner_account_id::text AS owner, status, is_priority_exposed FROM listings WHERE id = $1`, [id]);
  if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
  if (l.status !== 'PUBLISHED') throw new StateConflict('LSX_NOT_PUBLISHED', '노출 중인 매물만 끌어올릴 수 있습니다.');
  if (l.is_priority_exposed) throw new StateConflict('LSX_BUMP_PRIORITY', '우선노출(광고) 영역의 매물은 끌어올리지 않습니다.');
  return db.transaction(async () => {
    const r = await apply(db, id, l.owner, 'ADMIN', s, null, actorId, reason, kind);
    return { ok: true, kind: 'ADMIN', reasonKind: kind, listingId: id, ...r };
  });
}

/** 운영 환불(SUPER) — 결제 오류 · 중복 결제 등 · 시험 결제(stub)는 결제사를 부르지 않고 표시만 · 그 결제의 효과도 끝냄 */
export async function refundBump(db: DatabaseService, actorId: string, id: number, d: { reason?: string }) {
  const reason = needReason(d.reason);
  const [p] = await db.query<{ id: string; payment_key: string; amount: string; stub: boolean; refunded_at: string | null; listing_id: string }>(
    `SELECT id::text, payment_key, amount::text, stub, refunded_at, listing_id::text FROM lsx_bump_payments WHERE id = $1`, [id]);
  if (!p) throw new NotFound('끌어올리기 결제를 찾을 수 없습니다.');
  if (p.refunded_at) throw new StateConflict('LSX_REFUNDED', '이미 환불한 결제입니다.');
  if (!p.stub) {
    const r = await resolvePaymentProvider().cancel({ paymentKey: p.payment_key, cancelReason: reason.slice(0, 200), idempotencyKey: `lsx-refund-${p.id}` });
    if (!r.ok) {
      if (r.uncertain) throw new StateConflict('LSX_REFUND_UNCERTAIN', '환불 결과를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.');
      throw new PolicyViolation('LSX_REFUND_FAILED', r.detail ?? '환불에 실패했습니다.');
    }
  }
  return db.transaction(async () => {
    await db.query(`UPDATE lsx_bump_payments SET refunded_at = now(), refund_amount = amount, refund_reason = $2, refunded_by = $3 WHERE id = $1 AND refunded_at IS NULL`,
      [id, reason, actorId]);
    await db.query(`DELETE FROM lsx_bump_live bl USING lsx_bumps b WHERE bl.bump_id = b.id AND b.payment_id = $1`, [id]);
    return { ok: true, id, amount: Number(p.amount), stub: p.stub };
  });
}

/** 매시간 — 효과 끝난 끌어올림 지움(원래 자리) · 게시 중이 아닌 매물 줄도 지움 · 스위치와 상관없이 */
export async function bumpCleanup(db: DatabaseService) {
  const rows = await db.query(
    `DELETE FROM lsx_bump_live bl
      WHERE bl.until_at <= now() OR NOT EXISTS (SELECT 1 FROM listings l WHERE l.id = bl.listing_id AND l.status = 'PUBLISHED')
      RETURNING listing_id`);
  return { ended: rows.length };
}

/** 운영 목록 — 최근 끌어올리기 · 결제 · 지금 효과 중 */
export async function adminBumpList(db: DatabaseService) {
  const s = await lsxSettings(db);
  const recent = await db.query(
    `SELECT b.id::text, b.kind, b.listing_id::text AS "listingId", l.title, l.listing_no AS "listingNo", b.sort_at AS "sortAt", b.until_at AS "until",
            b.reason, b.reason_kind AS "reasonKind", b.created_at AS "createdAt", p.amount::int AS amount, p.stub, p.refunded_at AS "refundedAt",
            (bl.listing_id IS NOT NULL AND bl.bump_id = b.id) AS live
       FROM lsx_bumps b JOIN listings l ON l.id = b.listing_id
       LEFT JOIN lsx_bump_payments p ON p.id = b.payment_id
       LEFT JOIN lsx_bump_live bl ON bl.listing_id = b.listing_id
      ORDER BY b.id DESC LIMIT 100`);
  const payments = await db.query(
    `SELECT p.id::text, p.listing_id::text AS "listingId", l.title, p.supply::int AS supply, p.vat::int AS vat, p.amount::int AS amount, p.stub,
            p.paid_at AS "paidAt", p.refunded_at AS "refundedAt", p.refund_reason AS "refundReason"
       FROM lsx_bump_payments p JOIN listings l ON l.id = p.listing_id ORDER BY p.id DESC LIMIT 100`);
  const [sum] = await db.query<{ live: number; d7: number; free7: number; paid7: number; admin7: number; paid30: number }>(
    `SELECT (SELECT count(*)::int FROM lsx_bump_live) AS live,
            count(*)::int AS d7,
            count(*) FILTER (WHERE kind = 'FREE')::int AS free7,
            count(*) FILTER (WHERE kind = 'PAID')::int AS paid7,
            count(*) FILTER (WHERE kind = 'ADMIN')::int AS admin7,
            (SELECT coalesce(sum(amount) FILTER (WHERE refunded_at IS NULL AND NOT stub), 0)::int FROM lsx_bump_payments WHERE paid_at > now() - interval '30 days') AS paid30
       FROM lsx_bumps WHERE created_at > now() - interval '7 days'`);
  return {
    settings: { mode: s.bumpMode, freeCount: s.bumpFreeCount, periodDays: s.bumpPeriodDays, minHours: s.bumpMinHours, price: s.bumpPrice, effectHours: s.bumpEffectHours },
    summary: sum ?? { live: 0, d7: 0, free7: 0, paid7: 0, admin7: 0, paid30: 0 }, recent, payments,
  };
}

/* ── 자동 전표(acct_journal · sources.ts 끝에 push) — 계정은 초안(세무사 확인) ── */
const num = (v: unknown) => Number(v ?? 0);
const bumpLines = (amt: number, vat: unknown, split: boolean) => {
  if (vat == null) {
    if (!split) return [dr('PG_RECV', amt), cr('REV_BUMP', amt)];
    const v = vatSplit(amt);
    return [dr('PG_RECV', amt), cr('REV_BUMP', v.supply), cr('VAT_OUT', v.vat)];
  }
  return [dr('PG_RECV', amt), cr('REV_BUMP', amt - num(vat)), ...(num(vat) > 0 ? [cr('VAT_OUT', num(vat))] : [])];
};
export const LSX_SOURCES: Source[] = [
  {
    name: 'LSX_BUMP_PAID', label: '끌어올리기 결제',
    sql: `SELECT p.id::text AS key, p.paid_at AS at, p.amount::bigint AS amt, nullif(p.vat, 0)::bigint AS vat, NULL::text AS party
            FROM lsx_bump_payments p
           WHERE p.amount > 0 AND p.paid_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'LSX_BUMP_PAID' AND e.source_key = p.id::text)
           ORDER BY p.paid_at LIMIT 500`,
    build: (r, c) => ({ memo: '매물 끌어올리기 결제', evidence: 'CARD_PG', lines: bumpLines(num(r.amt), r.vat, c.subVat) }),
  },
  {
    name: 'LSX_BUMP_REFUND', label: '끌어올리기 환불',
    sql: `SELECT p.id::text AS key, p.refunded_at AS at, p.amount::bigint AS amt, nullif(p.vat, 0)::bigint AS vat, NULL::text AS party
            FROM lsx_bump_payments p
           WHERE p.refunded_at IS NOT NULL AND p.refund_amount = p.amount AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'LSX_BUMP_PAID' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'LSX_BUMP_REFUND' AND e.source_key = p.id::text)
           ORDER BY p.refunded_at LIMIT 500`,
    build: (r, c) => ({ memo: '매물 끌어올리기 환불', evidence: 'CARD_PG', lines: reverse(bumpLines(num(r.amt), r.vat, c.subVat)) }),
  },
];
