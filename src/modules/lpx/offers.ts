import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { LPX_AMOUNT_RE, lpxLine, lpxListing, lpxNotify, lpxSettings, lpxWon } from './common';
import { awayAutoNotice, awayNow } from './away';

/* ---------------------------------------------------------------------
 * v10.549 (D286 · docs/687) 매물 가격 제안 — 대표 11/21 「(56) ① 매물 가격 제안」
 *
 *   회원        게시 중 · 거래 금액이 있는 매물에 희망 가격(100원 ~ 13자리 · 한 줄 메모 200자 · 연락처 가림)을 제안
 *               한 매물에 회원당 열린 제안 하나(DB 고유 색인) · 자기 매물 금지(DB 트리거) · 모두 lpx.offer_member_max 개까지
 *               거래 금액의 lpx.offer_min_pct(처음 30 · 대표 11/21) 아래는 받지 않음(0 이면 하한 없음 · 다시 제안에도 같음)
 *   매물 주인   수락 · 거절 · 되제안(금액 · 메모) — 되제안을 받은 회원은 수락 · 거절 · 다시 제안(금액 · 메모) · 거둠
 *   되제안 횟수 주인 되제안 · 회원 다시 제안을 모두 셈 · lpx.offer_counter_max(처음 3 · 대표 11/21)까지 — 넘으면 서버 422 LPX_COUNTER_LIMIT · DB 트리거도 막음
 *   상태        OPEN → ACCEPTED · REJECTED · COUNTERED · WITHDRAWN · EXPIRED / COUNTERED → ACCEPTED · REJECTED · OPEN(다시 제안) · WITHDRAWN · EXPIRED (DB 트리거)
 *   기한        lpx.offer_days(처음 7일 · 대표 11/21) — 되제안 · 다시 제안하면 그때부터 다시 · 지나면 정기 작업 lpx_hourly 가 EXPIRED(매물이 내려가도 EXPIRED)
 *   알림        새 제안 → 주인 · 되제안 → 회원 · 수락 · 거절 → 상대 · 만료 → 회원(LPX_OFFER_* · 회원 알림 설정 따름)
 *   거래        **거래를 만들지 않음** — 수락하면 「1:1 문의」로 대화를 열어 기존 거래 흐름(소개비 · 계약)으로 가라고 안내만(가격 제안은 계약이 아님)
 *   관별 설정   lpx.offer_gwans(처음 NONE = 모두 꺼짐 · 꺼진 관 매물은 서버 422 LPX_GWAN_OFF · DB 트리거도 막음)
 *   자리 비움   주인이 자리 비움이면 응답에 안내를 싣고 회원에게 한 번 알림(LPX_AWAY_AUTO · away.ts)
 * ------------------------------------------------------------------- */

export const LPX_OFFER_STATES = ['OPEN', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const;
const LIVE = ['OPEN', 'COUNTERED'];

const off = () => new StateConflict('LPX_OFFER_OFF', '가격 제안이 꺼져 있습니다.');
const gwanOff = () => new PolicyViolation('LPX_GWAN_OFF', '이 관은 가격 제안을 쓰지 않습니다.');

/** DB 트리거 글 → 오류 코드 */
function dbErr(e: unknown): never {
  const m = String((e as { message?: string })?.message ?? '');
  if ((e as { code?: string })?.code === '23505') throw new StateConflict('LPX_OFFER_ALREADY', '이 매물에 이미 열린 제안이 있습니다 — 거두고 다시 제안하십시오.');
  const hit = /^(LPX_[A-Z_]+):\s*(.*)$/.exec(m);
  if (hit) {
    if (['LPX_OFFER_STATE', 'LPX_OFFER_EXPIRED'].includes(hit[1]!)) throw new StateConflict(hit[1]!, hit[2]!);
    throw new PolicyViolation(hit[1]!, hit[2]!);
  }
  throw e;
}

const amountOf = (raw: unknown) => {
  const s = String(raw ?? '').trim();
  if (!LPX_AMOUNT_RE.test(s)) throw new PolicyViolation('LPX_AMOUNT', '금액은 100원 ~ 13자리 숫자(원)입니다.');
  return s;
};

const link = '/my/offers';

/* ── 회원 ─────────────────────────────────────────────────────────── */

/** 매물 상세의 가격 제안 칸 — 켜졌는지 · 거래 금액 · 하한 · 내 열린 제안 · 내 매물인지 */
export async function offerBoxFor(db: DatabaseService, listingId: string, me: string) {
  const s = await lpxSettings(db);
  const l = await lpxListing(db, listingId);
  const own = l.ownerId === me;
  const can = s.offerOn && s.offerGwans.includes(l.gwan) && l.status === 'PUBLISHED' && l.askingAmount != null;
  if (!can) return { enabled: false, own, asking: null, minAmount: null, days: s.offerDays, counterMax: s.offerCounterMax, mine: null, received: 0 };
  const [mine] = await db.query(
    `SELECT id::text AS id, state, amount::text AS amount, counter_amount::text AS "counterAmount", counter_memo AS "counterMemo", expires_at AS "expiresAt", counter_count AS "counterCount"
       FROM lpx_offers WHERE listing_id = $1::uuid AND member_account_id = $2::uuid AND state IN ('OPEN', 'COUNTERED') ORDER BY id DESC LIMIT 1`, [l.id, me]);
  const [rc] = own ? await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lpx_offers WHERE listing_id = $1::uuid AND state = 'OPEN'`, [l.id]) : [{ n: 0 }];
  const asking = Number(l.askingAmount);
  return { enabled: true, own, asking: l.askingAmount, minAmount: s.offerMinPct > 0 ? String(Math.ceil((asking * s.offerMinPct) / 100)) : null,
    days: s.offerDays, counterMax: s.offerCounterMax, mine: mine ?? null, received: Number(rc?.n ?? 0) };
}

/** 제안하기 */
export async function makeOffer(db: DatabaseService, listingId: string, me: string, amountIn: string, memoIn?: string) {
  const s = await lpxSettings(db);
  if (!s.offerOn) throw off();
  const l = await lpxListing(db, listingId);
  if (!s.offerGwans.includes(l.gwan)) throw gwanOff();
  if (l.status !== 'PUBLISHED') throw new StateConflict('LPX_LISTING', '게시 중인 매물에만 제안합니다.');
  if (l.ownerId === me) throw new PolicyViolation('LPX_OFFER_SELF', '자기 매물에는 가격을 제안할 수 없습니다.');
  if (l.askingAmount == null) throw new PolicyViolation('LPX_NO_PRICE', '거래 금액이 없는 매물이라 가격 제안을 받지 않습니다 — 1:1 문의로 물어보십시오.');
  const amount = amountOf(amountIn);
  const asking = Number(l.askingAmount);
  if (s.offerMinPct > 0 && Number(amount) < Math.ceil((asking * s.offerMinPct) / 100)) {
    throw new PolicyViolation('LPX_AMOUNT_LOW', `거래 금액의 ${s.offerMinPct}% 아래로는 제안할 수 없습니다.`);
  }
  const [cnt] = await db.query<{ n: number; here: number }>(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE listing_id = $2::uuid)::int AS here
       FROM lpx_offers WHERE member_account_id = $1::uuid AND state IN ('OPEN', 'COUNTERED')`, [me, l.id]);
  if (Number(cnt?.here ?? 0) > 0) throw new StateConflict('LPX_OFFER_ALREADY', '이 매물에 이미 열린 제안이 있습니다 — 거두고 다시 제안하십시오.');
  if (Number(cnt?.n ?? 0) >= s.offerMemberMax) throw new PolicyViolation('LPX_OFFER_LIMIT', `열린 가격 제안은 ${s.offerMemberMax}개까지입니다.`);
  const memo = lpxLine(memoIn);
  const [row] = await db.query<{ id: string; expiresAt: string }>(
    `INSERT INTO lpx_offers (listing_id, member_account_id, owner_account_id, asking_amount, amount, memo, expires_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6, now() + make_interval(days => $7::int))
     RETURNING id::text AS id, expires_at AS "expiresAt"`, [l.id, me, l.ownerId, l.askingAmount, amount, memo, s.offerDays]).catch((e) => dbErr(e));
  await lpxNotify(db, l.ownerId, 'LPX_OFFER_NEW', { title: l.title.slice(0, 40), amount: lpxWon(amount), days: String(s.offerDays) }, link);
  const away = await awayNow(db, l.ownerId);
  if (away) await awayAutoNotice(db, l.ownerId, me, l.id, 'OFFER');
  return { ok: true, id: row!.id, state: 'OPEN', expiresAt: row!.expiresAt, away: away ? { endsOn: away.endsOn, message: away.message } : null,
    note: away ? `제안했습니다 — 판매자가 ${away.endsOn} 까지 자리를 비워 답이 늦을 수 있습니다.` : `제안했습니다 — ${s.offerDays}일 안에 판매자가 답하지 않으면 저절로 끝납니다.` };
}

interface OfferRow { id: string; state: string; listingId: string; title: string; gwan: string; memberId: string; ownerId: string; amount: string; counterAmount: string | null; askingAmount: string | null; counterCount: number; live: boolean }
async function offerOf(db: DatabaseService, idIn: string): Promise<OfferRow> {
  const id = Number(idIn);
  if (!Number.isInteger(id) || id <= 0) throw new NotFound('없는 가격 제안입니다.');
  const [o] = await db.query<OfferRow>(
    `SELECT o.id::text AS id, o.state, o.listing_id::text AS "listingId", l.title, l.gwan_code AS gwan, o.member_account_id::text AS "memberId",
            o.owner_account_id::text AS "ownerId", o.amount::text AS amount, o.counter_amount::text AS "counterAmount", o.asking_amount::text AS "askingAmount",
            o.counter_count AS "counterCount", (o.expires_at > now()) AS live
       FROM lpx_offers o JOIN listings l ON l.id = o.listing_id WHERE o.id = $1::bigint`, [id]);
  if (!o) throw new NotFound('없는 가격 제안입니다.');
  return o;
}

const nextStep = (o: OfferRow) => ({ listingId: o.listingId, gwanCode: o.gwan, action: 'CONVERSATION' as const });

/** 수락 — 주인은 OPEN 을 · 회원은 COUNTERED 를 */
export async function acceptOffer(db: DatabaseService, idIn: string, me: string) {
  const o = await offerOf(db, idIn);
  const who = o.ownerId === me ? 'OWNER' : o.memberId === me ? 'MEMBER' : null;
  if (!who) throw new NotFound('없는 가격 제안입니다.');
  const from = who === 'OWNER' ? 'OPEN' : 'COUNTERED';
  if (o.state !== from) throw new StateConflict('LPX_OFFER_STATE', who === 'OWNER' ? '답을 기다리는 제안만 수락합니다.' : '판매자가 되제안한 것만 수락합니다.');
  if (!o.live) throw new StateConflict('LPX_OFFER_EXPIRED', '기한이 지난 제안입니다.');
  const final = who === 'OWNER' ? o.amount : o.counterAmount!;
  const r = await db.query(
    `UPDATE lpx_offers SET state = 'ACCEPTED', final_amount = $3::numeric, decided_at = now(), decided_by = $4 WHERE id = $1::bigint AND state = $2 RETURNING id`,
    [o.id, from, final, who]).catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('LPX_OFFER_STATE', '이미 바뀐 제안입니다 — 새로 고쳐 보십시오.');
  await lpxNotify(db, who === 'OWNER' ? o.memberId : o.ownerId, 'LPX_OFFER_ACCEPTED', { title: o.title.slice(0, 40), amount: lpxWon(final) }, link);
  return { ok: true, id: o.id, state: 'ACCEPTED', finalAmount: final, next: nextStep(o),
    note: `${lpxWon(final)}에 합의했습니다 — 거래는 매물 상세의 「1:1 문의」로 대화를 열어 기존 거래 흐름(소개비 · 계약)으로 진행합니다. 가격 제안은 계약이 아닙니다.` };
}

/** 거절 — 주인은 OPEN 을 · 회원은 COUNTERED 를 */
export async function rejectOffer(db: DatabaseService, idIn: string, me: string) {
  const o = await offerOf(db, idIn);
  const who = o.ownerId === me ? 'OWNER' : o.memberId === me ? 'MEMBER' : null;
  if (!who) throw new NotFound('없는 가격 제안입니다.');
  const from = who === 'OWNER' ? 'OPEN' : 'COUNTERED';
  if (o.state !== from) throw new StateConflict('LPX_OFFER_STATE', who === 'OWNER' ? '답을 기다리는 제안만 거절합니다.' : '판매자가 되제안한 것만 거절합니다.');
  const r = await db.query(
    `UPDATE lpx_offers SET state = 'REJECTED', decided_at = now(), decided_by = $3 WHERE id = $1::bigint AND state = $2 RETURNING id`, [o.id, from, who]).catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('LPX_OFFER_STATE', '이미 바뀐 제안입니다 — 새로 고쳐 보십시오.');
  await lpxNotify(db, who === 'OWNER' ? o.memberId : o.ownerId, 'LPX_OFFER_REJECTED', { title: o.title.slice(0, 40), amount: lpxWon(who === 'OWNER' ? o.amount : o.counterAmount) }, link);
  return { ok: true, id: o.id, state: 'REJECTED', note: '거절했습니다 — 상대에게 알림이 갑니다.' };
}

const limitHit = (max: number) => new PolicyViolation('LPX_COUNTER_LIMIT', `되제안은 ${max}번까지입니다 — 수락 · 거절 중에 고르십시오.`);

/** 되제안 — 주인 · OPEN 만 · lpx.offer_counter_max 번까지(회원 다시 제안과 합쳐 셈 · 대표 11/21 처음 3) · 기한은 그때부터 다시 */
export async function counterOffer(db: DatabaseService, idIn: string, me: string, amountIn: string, memoIn?: string) {
  const s = await lpxSettings(db);
  const o = await offerOf(db, idIn);
  if (o.ownerId !== me) throw new NotFound('없는 가격 제안입니다.');
  if (o.state !== 'OPEN') throw new StateConflict('LPX_OFFER_STATE', '답을 기다리는 제안에만 되제안합니다.');
  if (!o.live) throw new StateConflict('LPX_OFFER_EXPIRED', '기한이 지난 제안입니다.');
  if (Number(o.counterCount) >= s.offerCounterMax) throw limitHit(s.offerCounterMax);
  const amount = amountOf(amountIn);
  if (amount === o.amount) throw new PolicyViolation('LPX_COUNTER_SAME', '같은 금액이면 「수락」을 누르십시오.');
  const memo = lpxLine(memoIn);
  const r = await db.query<{ n: number }>(
    `UPDATE lpx_offers SET state = 'COUNTERED', counter_amount = $2::numeric, counter_memo = $3, countered_at = now(), counter_count = counter_count + 1,
            expires_at = now() + make_interval(days => $4::int)
      WHERE id = $1::bigint AND state = 'OPEN' RETURNING counter_count AS n`, [o.id, amount, memo, s.offerDays]).catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('LPX_OFFER_STATE', '이미 바뀐 제안입니다 — 새로 고쳐 보십시오.');
  const n = Number(r[0]!.n ?? 0);
  await lpxNotify(db, o.memberId, 'LPX_OFFER_COUNTER', { title: o.title.slice(0, 40), amount: lpxWon(amount), days: String(s.offerDays) }, link);
  return { ok: true, id: o.id, state: 'COUNTERED', counterAmount: amount, counterCount: n, counterLeft: Math.max(0, s.offerCounterMax - n),
    note: `${lpxWon(amount)}로 되제안했습니다 — ${s.offerDays}일 안에 회원이 답합니다(되제안 ${n} / ${s.offerCounterMax}).` };
}

/** 다시 제안 — 회원 · 되제안 받은 것(COUNTERED)에 새 금액 · 횟수는 되제안과 합쳐 셈 · 하한 그대로 · 기한 다시 */
export async function reofferOffer(db: DatabaseService, idIn: string, me: string, amountIn: string, memoIn?: string) {
  const s = await lpxSettings(db);
  const o = await offerOf(db, idIn);
  if (o.memberId !== me) throw new NotFound('없는 가격 제안입니다.');
  if (o.state !== 'COUNTERED') throw new StateConflict('LPX_OFFER_STATE', '판매자가 되제안한 것에만 다시 제안합니다.');
  if (!o.live) throw new StateConflict('LPX_OFFER_EXPIRED', '기한이 지난 제안입니다.');
  if (Number(o.counterCount) >= s.offerCounterMax) throw limitHit(s.offerCounterMax);
  const amount = amountOf(amountIn);
  if (amount === o.counterAmount) throw new PolicyViolation('LPX_COUNTER_SAME', '같은 금액이면 「수락」을 누르십시오.');
  if (s.offerMinPct > 0 && o.askingAmount != null && Number(amount) < Math.ceil((Number(o.askingAmount) * s.offerMinPct) / 100)) {
    throw new PolicyViolation('LPX_AMOUNT_LOW', `거래 금액의 ${s.offerMinPct}% 아래로는 제안할 수 없습니다.`);
  }
  const memo = lpxLine(memoIn);
  const r = await db.query<{ n: number }>(
    `UPDATE lpx_offers SET state = 'OPEN', amount = $2::numeric, memo = $3, counter_count = counter_count + 1, expires_at = now() + make_interval(days => $4::int)
      WHERE id = $1::bigint AND state = 'COUNTERED' RETURNING counter_count AS n`, [o.id, amount, memo, s.offerDays]).catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('LPX_OFFER_STATE', '이미 바뀐 제안입니다 — 새로 고쳐 보십시오.');
  const n = Number(r[0]!.n ?? 0);
  await lpxNotify(db, o.ownerId, 'LPX_OFFER_NEW', { title: o.title.slice(0, 40), amount: lpxWon(amount), days: String(s.offerDays) }, link);
  return { ok: true, id: o.id, state: 'OPEN', amount, counterCount: n, counterLeft: Math.max(0, s.offerCounterMax - n),
    note: `${lpxWon(amount)}로 다시 제안했습니다 — ${s.offerDays}일 안에 판매자가 답합니다(되제안 ${n} / ${s.offerCounterMax}).` };
}

/** 거두기 — 회원 · OPEN · COUNTERED */
export async function withdrawOffer(db: DatabaseService, idIn: string, me: string) {
  const o = await offerOf(db, idIn);
  if (o.memberId !== me) throw new NotFound('없는 가격 제안입니다.');
  if (!LIVE.includes(o.state)) throw new StateConflict('LPX_OFFER_STATE', '열린 제안만 거둡니다.');
  const r = await db.query(
    `UPDATE lpx_offers SET state = 'WITHDRAWN', decided_at = now(), decided_by = 'MEMBER' WHERE id = $1::bigint AND state IN ('OPEN', 'COUNTERED') RETURNING id`, [o.id])
    .catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('LPX_OFFER_STATE', '이미 바뀐 제안입니다 — 새로 고쳐 보십시오.');
  return { ok: true, id: o.id, state: 'WITHDRAWN', note: '제안을 거뒀습니다.' };
}

/** 나의공간 › 가격 제안 — 보낸 것 · 받은 것(가린 이름) */
export async function myOffers(db: DatabaseService, me: string) {
  const s = await lpxSettings(db);
  const sent = await db.query(
    `SELECT o.id::text AS id, o.state, o.amount::text AS amount, o.counter_amount::text AS "counterAmount", o.counter_memo AS "counterMemo", o.final_amount::text AS "finalAmount",
            o.asking_amount::text AS "askingAmount", o.memo, o.expires_at AS "expiresAt", o.created_at AS "createdAt", o.decided_at AS "decidedAt",
            l.id::text AS "listingId", l.title, l.gwan_code AS "gwanCode",
            o.counter_count AS "counterCount", (o.state = 'COUNTERED' AND o.expires_at > now()) AS "canAnswer",
            (o.state = 'COUNTERED' AND o.expires_at > now() AND o.counter_count < $2::int) AS "canReoffer", (o.state IN ('OPEN', 'COUNTERED')) AS "canWithdraw"
       FROM lpx_offers o JOIN listings l ON l.id = o.listing_id WHERE o.member_account_id = $1::uuid ORDER BY o.id DESC LIMIT 100`, [me, s.offerCounterMax]);
  const got = await db.query<Record<string, unknown> & { name: string | null }>(
    `SELECT o.id::text AS id, o.state, o.amount::text AS amount, o.counter_amount::text AS "counterAmount", o.final_amount::text AS "finalAmount",
            o.asking_amount::text AS "askingAmount", o.memo, o.expires_at AS "expiresAt", o.created_at AS "createdAt",
            l.id::text AS "listingId", l.title, l.gwan_code AS "gwanCode", a.name,
            o.counter_count AS "counterCount", (o.state = 'OPEN' AND o.expires_at > now()) AS "canAnswer",
            (o.state = 'OPEN' AND o.expires_at > now() AND o.counter_count < $2::int) AS "canCounter"
       FROM lpx_offers o JOIN listings l ON l.id = o.listing_id JOIN accounts a ON a.id = o.member_account_id
      WHERE o.owner_account_id = $1::uuid ORDER BY (o.state = 'OPEN') DESC, o.id DESC LIMIT 100`, [me, s.offerCounterMax]);
  return { enabled: s.offerOn, days: s.offerDays, counterMax: s.offerCounterMax, sent, received: got.map(({ name, ...r }) => ({ ...r, from: maskName(name) ?? '회원' })),
    note: '가격 제안은 계약이 아닙니다 — 합의하면 매물 상세의 「1:1 문의」로 기존 거래 흐름을 이어 갑니다.' };
}

/* ── 정기 작업(lpx_hourly) — 기한 지난 제안 · 내려간 매물의 열린 제안을 EXPIRED(스위치와 상관없이) ── */
export async function offerExpireJob(db: DatabaseService) {
  const rows = await db.query<{ member: string; title: string; amount: string }>(
    `UPDATE lpx_offers o SET state = 'EXPIRED', decided_at = now(), decided_by = 'SYSTEM'
       FROM listings l
      WHERE l.id = o.listing_id AND o.state IN ('OPEN', 'COUNTERED') AND (o.expires_at <= now() OR l.status <> 'PUBLISHED')
      RETURNING o.member_account_id::text AS member, l.title, o.amount::text AS amount`);
  for (const x of rows) await lpxNotify(db, x.member, 'LPX_OFFER_EXPIRED', { title: x.title.slice(0, 40), amount: lpxWon(x.amount) }, link);
  return { expired: rows.length };
}

/* ── 운영 화면 › 검수 › 매물 가격 제안 ── */
export async function adminOffers(db: DatabaseService) {
  const settings = await lpxSettings(db);
  const [sum] = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'OPEN')::int AS open, count(*) FILTER (WHERE state = 'COUNTERED')::int AS countered,
            count(*) FILTER (WHERE state = 'ACCEPTED')::int AS accepted, count(*) FILTER (WHERE state = 'REJECTED')::int AS rejected,
            count(*) FILTER (WHERE state = 'WITHDRAWN')::int AS withdrawn, count(*) FILTER (WHERE state = 'EXPIRED')::int AS expired,
            round(avg(CASE WHEN state = 'ACCEPTED' AND asking_amount > 0 THEN final_amount * 100.0 / asking_amount END), 1)::text AS "acceptedPct"
       FROM lpx_offers WHERE created_at > now() - interval '30 days'`);
  const gwans = await db.query<{ code: string; name: string }>(`SELECT code, name FROM gwans WHERE is_active ORDER BY sort_order, code`);
  const rows = await db.query<Record<string, unknown> & { name: string | null }>(
    `SELECT o.id::text AS id, o.state, o.asking_amount::text AS "askingAmount", o.amount::text AS amount, o.counter_amount::text AS "counterAmount",
            o.final_amount::text AS "finalAmount", o.counter_count AS "counterCount", o.decided_by AS "decidedBy", o.created_at AS "createdAt", l.title, l.gwan_code AS "gwanCode", a.name
       FROM lpx_offers o JOIN listings l ON l.id = o.listing_id JOIN accounts a ON a.id = o.member_account_id ORDER BY o.id DESC LIMIT 100`);
  return { settings, gwans: gwans.map((g) => ({ ...g, on: settings.offerGwans.includes(g.code) })), summary30: sum ?? {},
    recent: rows.map(({ name, ...r }) => ({ ...r, member: maskName(name) ?? '회원' })),
    note: '가격 제안은 회원 사이 의사 표시입니다 — 운영은 숫자 · 기록만 봅니다(메모 · 연락처 없음 · 거래는 기존 흐름).' };
}
