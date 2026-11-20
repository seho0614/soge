import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { vsxToday, vsxSettings } from './vsx-settings';
import { awayNow } from '../lpx/away';   // (56) D286 판매자 자리 비움

/* ---------------------------------------------------------------------
 * v10.542 (D284 · docs/680) 매물 방문 예약 — 대표 11/20 「(54) ① 매물 방문 예약」
 *
 *   매물 주인   방문 가능한 시간 칸을 엶(날짜 + 시각 여러 개 + 길이 · 10분 단위 · vsx.slot_days 앞까지 · 매물마다 vsx.max_open 칸)
 *               요청 확정 · 취소 · 칸 닫기(그 칸 예약은 주인 취소로) · 방문 시각 뒤 7일 안 「노쇼」 · 「방문 끝」 표시
 *   회원        열린 칸 하나를 골라 요청(한 줄 메모 200자) · 매물마다 살아 있는 예약 하나 · 모두 10개까지 · 방문 전 취소
 *   알림        요청 → 주인 · 확정 · 취소 → 상대 · 전날(10시부터 · 한 번) → 회원 · 주인(알림함 · 회원 알림 설정 따라 메일)
 *   정기 작업   vsx_visit 매시간 — 지난 칸의 확정 안 된 요청은 저절로 취소(SYSTEM) · 전날 알림
 *   관별 설정   vsx.gwans(처음 NONE = 모두 꺼짐 · 대표 11/21) — 꺼진 관 매물은 칸 열기 · 예약을 서버 · DB 트리거가 막음(422 VSX_GWAN_OFF)
 *   개인정보    주인에게는 가린 이름(김**) · 메모만 — 노쇼 횟수는 운영 화면에서만(대표 11/21) · 연락처는 싣지 않음(기존 안심번호 · 대화로)
 *   상태 규칙 · 겹침 · 자기 매물 막기는 DB 트리거(fn_vsx_slot_guard · fn_vsx_booking_guard)가 다시 봄
 * ------------------------------------------------------------------- */

export const VSX_DATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
/** DB CHECK ck_vsx_slot_step(10분 단위 · 초 0)과 같은 뜻(규칙 2) */
export const VSX_TIME_RE = /^([01][0-9]|2[0-3]):[0-5]0$/;
export const VSX_MINUTES = [10, 20, 30, 40, 50, 60, 90, 120, 180, 240] as const;
export const VSX_MEMBER_MAX = 10;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const off = () => new StateConflict('VSX_OFF', '매물 방문 예약이 꺼져 있습니다.');
const gwanOff = () => new PolicyViolation('VSX_GWAN_OFF', '이 관은 방문 예약을 쓰지 않습니다.');

/** DB 트리거 글 → 오류 코드 */
function dbErr(e: unknown): never {
  const m = String((e as { message?: string })?.message ?? '');
  const code = (e as { code?: string })?.code;
  if (code === '23505') throw new StateConflict('VSX_SLOT_TAKEN', '그 시간은 방금 다른 분이 골랐습니다 — 다른 시간을 고르십시오.');
  const hit = /^(VSX_[A-Z_]+):\s*(.*)$/.exec(m);
  if (hit) {
    const c = hit[1]!;
    if (['VSX_BOOKING_STATE', 'VSX_BOOKING_PAST', 'VSX_SLOT'].includes(c)) throw new StateConflict(c, hit[2]!);
    throw new PolicyViolation(c, hit[2]!);
  }
  throw e;
}

function notify(db: DatabaseService, accountId: string, code: string, title: string, body: string, link = '/my/visits') {
  return db.query(`INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1, $2, $3, $4, $5)`,
    [accountId, code, title, body.slice(0, 500), link]).catch(() => undefined);
}

const kst = (iso: string | Date) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
  return `${d.toISOString().slice(5, 10).replace('-', '/')} ${d.toISOString().slice(11, 16)}`;
};

interface ListingRow { id: string; title: string; ownerId: string; status: string; gwan: string }
async function listingOf(db: DatabaseService, id: string): Promise<ListingRow> {
  if (!UUID_RE.test(String(id ?? ''))) throw new NotFound('없는 매물입니다.');
  const [l] = await db.query<ListingRow>(`SELECT id, title, owner_account_id AS "ownerId", status, gwan_code AS gwan FROM listings WHERE id = $1::uuid`, [id]);
  if (!l) throw new NotFound('없는 매물입니다.');
  return l;
}

/* ── 회원 ─────────────────────────────────────────────────────────── */

/** 매물 상세의 방문 예약 칸 — 열린 앞 칸(남이 고른 칸은 taken) · 내 살아 있는 예약 */
export async function visitSlotsForMember(db: DatabaseService, listingId: string, me: string) {
  const s = await vsxSettings(db);
  if (!s.visitOn) return { enabled: false, slots: [], mine: null, own: false };
  const l = await listingOf(db, listingId);
  if (!s.visitGwans.includes(l.gwan)) return { enabled: false, slots: [], mine: null, own: l.ownerId === me };
  if (l.status !== 'PUBLISHED') return { enabled: true, slots: [], mine: null, own: l.ownerId === me };
  const slots = await db.query(
    `SELECT s.id::text AS id, s.starts_at AS "startsAt", s.ends_at AS "endsAt",
            EXISTS (SELECT 1 FROM vsx_bookings b WHERE b.slot_id = s.id AND b.state IN ('REQUESTED', 'CONFIRMED')) AS taken
       FROM vsx_slots s WHERE s.listing_id = $1::uuid AND s.state = 'OPEN' AND s.starts_at > now()
      ORDER BY s.starts_at LIMIT 200`, [l.id]);
  const [mine] = await db.query(
    `SELECT b.id::text AS id, b.state, s.starts_at AS "startsAt", s.ends_at AS "endsAt", b.memo
       FROM vsx_bookings b JOIN vsx_slots s ON s.id = b.slot_id
      WHERE b.listing_id = $1::uuid AND b.member_account_id = $2 AND b.state IN ('REQUESTED', 'CONFIRMED') ORDER BY b.id DESC LIMIT 1`, [l.id, me]);
  return { enabled: true, own: l.ownerId === me, slots, mine: mine ?? null };
}

export async function bookVisit(db: DatabaseService, listingId: string, me: string, slotIdIn: string, memoIn?: string) {
  const s = await vsxSettings(db);
  if (!s.visitOn) throw off();
  const l = await listingOf(db, listingId);
  if (!s.visitGwans.includes(l.gwan)) throw gwanOff();
  if (l.status !== 'PUBLISHED') throw new StateConflict('VSX_LISTING', '게시 중인 매물만 방문 예약합니다.');
  if (l.ownerId === me) throw new PolicyViolation('VSX_BOOKING_SELF', '자기 매물은 방문 예약할 수 없습니다.');
  const slotId = Number(slotIdIn);
  if (!Number.isInteger(slotId) || slotId <= 0) throw new PolicyViolation('VSX_SLOT_ID', '시간 칸을 고르십시오.');
  const memo = memoIn === undefined || memoIn === null ? null : String(memoIn).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const [cnt] = await db.query<{ n: number; here: number }>(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE listing_id = $2::uuid)::int AS here
       FROM vsx_bookings WHERE member_account_id = $1 AND state IN ('REQUESTED', 'CONFIRMED')`, [me, l.id]);
  if (Number(cnt?.here ?? 0) > 0) throw new StateConflict('VSX_ALREADY', '이 매물에 이미 방문 예약이 있습니다 — 바꾸려면 먼저 취소하십시오.');
  if (Number(cnt?.n ?? 0) >= VSX_MEMBER_MAX) throw new PolicyViolation('VSX_LIMIT', `살아 있는 방문 예약은 ${VSX_MEMBER_MAX}개까지입니다.`);
  let row: { id: string; startsAt: string } | undefined;
  try {
    row = await db.transaction(async () => {
      const [slot] = await db.query<{ id: string; state: string; future: boolean }>(
        `SELECT id::text AS id, state, (starts_at > now()) AS future FROM vsx_slots WHERE id = $1::bigint AND listing_id = $2::uuid FOR UPDATE`, [slotId, l.id]);
      if (!slot) throw new NotFound('없는 시간 칸입니다.');
      if (slot.state !== 'OPEN' || !slot.future) throw new StateConflict('VSX_SLOT_CLOSED', '닫혔거나 지난 시간입니다 — 다른 시간을 고르십시오.');
      const [r] = await db.query<{ id: string; startsAt: string }>(
        `INSERT INTO vsx_bookings (slot_id, listing_id, member_account_id, memo) VALUES ($1::bigint, $2::uuid, $3, $4)
         RETURNING id::text AS id, (SELECT starts_at FROM vsx_slots WHERE id = $1::bigint) AS "startsAt"`, [slotId, l.id, me, memo]);
      return r;
    });
  } catch (e) {
    if (e instanceof StateConflict || e instanceof NotFound) throw e;
    dbErr(e);
  }
  await notify(db, l.ownerId, 'VSX_BOOK_REQUEST', '방문 예약 요청이 왔습니다', `「${l.title.slice(0, 40)}」 ${kst(row!.startsAt)} 방문 요청 — 나의공간 › 방문 예약에서 확정해 주십시오.`);
  const away = await awayNow(db, l.ownerId);   // (56) D286 — 자동 안내 알림은 DB 트리거 trg_lpx_away_on_visit 가 이미 보냄
  return { ok: true, id: row!.id, state: 'REQUESTED', away: away ? { endsOn: away.endsOn, message: away.message } : null,
    note: away ? `방문 예약을 요청했습니다 — 판매자가 ${away.endsOn} 까지 자리를 비워 확정이 늦을 수 있습니다.` : '방문 예약을 요청했습니다 — 매물 주인이 확정하면 알림이 갑니다.' };
}

/** 나의공간 › 방문 예약 — 내가 한 예약 · 내 매물에 온 예약 · 내 게시 매물(열린 칸 수) */
export async function myVisits(db: DatabaseService, me: string) {
  const s = await vsxSettings(db);
  const asVisitor = await db.query(
    `SELECT b.id::text AS id, b.state, b.memo, b.created_at AS "createdAt", b.cancel_by AS "cancelBy", b.cancel_reason AS "cancelReason",
            s.starts_at AS "startsAt", s.ends_at AS "endsAt", l.id AS "listingId", l.title, l.gwan_code AS "gwanCode",
            (b.state IN ('REQUESTED', 'CONFIRMED') AND s.starts_at > now()) AS "canCancel"
       FROM vsx_bookings b JOIN vsx_slots s ON s.id = b.slot_id JOIN listings l ON l.id = b.listing_id
      WHERE b.member_account_id = $1 ORDER BY s.starts_at DESC LIMIT 50`, [me]);
  const owner = await db.query<Record<string, unknown> & { name: string | null }>(
    `SELECT b.id::text AS id, b.state, b.memo, b.created_at AS "createdAt", b.cancel_by AS "cancelBy",
            s.starts_at AS "startsAt", s.ends_at AS "endsAt", l.id AS "listingId", l.title, a.name,
            (b.state = 'REQUESTED' AND s.starts_at > now()) AS "canConfirm",
            (b.state IN ('REQUESTED', 'CONFIRMED') AND s.starts_at > now()) AS "canCancel",
            (b.state = 'CONFIRMED' AND s.starts_at <= now() AND s.starts_at > now() - interval '7 days') AS "canMark"
       FROM vsx_bookings b JOIN vsx_slots s ON s.id = b.slot_id JOIN listings l ON l.id = b.listing_id JOIN accounts a ON a.id = b.member_account_id
      WHERE l.owner_account_id = $1 ORDER BY (b.state IN ('REQUESTED', 'CONFIRMED')) DESC, s.starts_at DESC LIMIT 100`, [me]);
  const asOwner = owner.map(({ name, ...r }) => ({ ...r, visitor: maskName(name) ?? '회원' }));
  /* 방문 예약을 쓰는 관의 게시 매물만(관별 설정) */
  const ownerListings = await db.query(
    `SELECT l.id, l.title, l.gwan_code AS "gwanCode",
            (SELECT count(*)::int FROM vsx_slots s WHERE s.listing_id = l.id AND s.state = 'OPEN' AND s.starts_at > now()) AS "openSlots"
       FROM listings l WHERE l.owner_account_id = $1 AND l.status = 'PUBLISHED' AND l.gwan_code = ANY($2::text[]) ORDER BY l.published_at DESC NULLS LAST LIMIT 50`, [me, s.visitGwans]);
  return { enabled: s.visitOn, slotDays: s.slotDays, maxOpen: s.maxOpen, minutes: VSX_MINUTES, asVisitor, asOwner, ownerListings };
}

interface BookingRow { id: string; state: string; memberId: string; ownerId: string; title: string; startsAt: string; future: boolean }
async function bookingOf(db: DatabaseService, idIn: string, lock = false): Promise<BookingRow> {
  const id = Number(idIn);
  if (!Number.isInteger(id) || id <= 0) throw new NotFound('없는 방문 예약입니다.');
  const [b] = await db.query<BookingRow>(
    lock
      ? `SELECT b.id::text AS id, b.state, b.member_account_id AS "memberId", l.owner_account_id AS "ownerId", l.title, s.starts_at AS "startsAt", (s.starts_at > now()) AS future
           FROM vsx_bookings b JOIN vsx_slots s ON s.id = b.slot_id JOIN listings l ON l.id = b.listing_id WHERE b.id = $1::bigint FOR UPDATE OF b`
      : `SELECT b.id::text AS id, b.state, b.member_account_id AS "memberId", l.owner_account_id AS "ownerId", l.title, s.starts_at AS "startsAt", (s.starts_at > now()) AS future
           FROM vsx_bookings b JOIN vsx_slots s ON s.id = b.slot_id JOIN listings l ON l.id = b.listing_id WHERE b.id = $1::bigint`, [id]);
  if (!b) throw new NotFound('없는 방문 예약입니다.');
  return b;
}

/** 취소 — 회원(자기 예약) 또는 매물 주인 · 방문 전 · 요청 · 확정 상태만 */
export async function cancelVisit(db: DatabaseService, idIn: string, me: string, reasonIn?: string) {
  const reason = reasonIn === undefined || reasonIn === null ? null : String(reasonIn).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const b = await bookingOf(db, idIn);
  const by = b.memberId === me ? 'MEMBER' : b.ownerId === me ? 'OWNER' : null;
  if (!by) throw new NotFound('없는 방문 예약입니다.');
  if (!['REQUESTED', 'CONFIRMED'].includes(b.state) || !b.future) throw new StateConflict('VSX_BOOKING_STATE', '방문 전 요청 · 확정 예약만 취소합니다.');
  const r = await db.query(
    `UPDATE vsx_bookings SET state = 'CANCELLED', cancelled_at = now(), cancel_by = $2, cancel_reason = $3 WHERE id = $1::bigint AND state IN ('REQUESTED', 'CONFIRMED') RETURNING id`,
    [b.id, by, reason]).catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('VSX_BOOKING_STATE', '이미 바뀐 예약입니다 — 새로 고쳐 보십시오.');
  const other = by === 'MEMBER' ? b.ownerId : b.memberId;
  await notify(db, other, 'VSX_BOOK_CANCELLED', '방문 예약이 취소되었습니다',
    `「${b.title.slice(0, 40)}」 ${kst(b.startsAt)} 방문 — ${by === 'MEMBER' ? '방문하려던 회원' : '매물 주인'}이 취소했습니다${reason ? `(${reason.slice(0, 60)})` : ''}.`);
  return { ok: true, id: b.id, state: 'CANCELLED', note: '방문 예약을 취소했습니다.' };
}

/** 확정 — 매물 주인 · 요청 상태 · 방문 전 */
export async function confirmVisit(db: DatabaseService, idIn: string, me: string) {
  const b = await bookingOf(db, idIn);
  if (b.ownerId !== me) throw new NotFound('없는 방문 예약입니다.');
  if (b.state !== 'REQUESTED' || !b.future) throw new StateConflict('VSX_BOOKING_STATE', '방문 전 요청만 확정합니다.');
  const r = await db.query(`UPDATE vsx_bookings SET state = 'CONFIRMED', confirmed_at = now() WHERE id = $1::bigint AND state = 'REQUESTED' RETURNING id`, [b.id])
    .catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('VSX_BOOKING_STATE', '이미 바뀐 예약입니다 — 새로 고쳐 보십시오.');
  await notify(db, b.memberId, 'VSX_BOOK_CONFIRMED', '방문 예약이 확정되었습니다', `「${b.title.slice(0, 40)}」 ${kst(b.startsAt)} 방문이 확정되었습니다. 전날 한 번 더 알려 드립니다.`);
  return { ok: true, id: b.id, state: 'CONFIRMED', note: '확정했습니다 — 회원에게 알림이 갑니다.' };
}

/** 노쇼 · 방문 끝 — 매물 주인 · 확정 예약 · 방문 시각 뒤 7일 안 */
export async function markVisit(db: DatabaseService, idIn: string, me: string, result: string) {
  if (!['NOSHOW', 'DONE'].includes(result)) throw new PolicyViolation('VSX_RESULT', '결과는 NOSHOW · DONE 중 하나입니다.');
  const b = await bookingOf(db, idIn);
  if (b.ownerId !== me) throw new NotFound('없는 방문 예약입니다.');
  if (b.state !== 'CONFIRMED') throw new StateConflict('VSX_BOOKING_STATE', '확정한 예약만 표시합니다.');
  const r = await db.query(`UPDATE vsx_bookings SET state = $2, marked_at = now() WHERE id = $1::bigint AND state = 'CONFIRMED' RETURNING id`, [b.id, result])
    .catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('VSX_BOOKING_STATE', '이미 바뀐 예약입니다 — 새로 고쳐 보십시오.');
  return { ok: true, id: b.id, state: result, note: result === 'NOSHOW' ? '노쇼로 표시했습니다(횟수는 운영 화면에서만 봅니다).' : '방문 끝으로 표시했습니다.' };
}

/* ── 매물 주인 ────────────────────────────────────────────────────── */

async function ownListing(db: DatabaseService, listingId: string, me: string) {
  const l = await listingOf(db, listingId);
  if (l.ownerId !== me) throw new NotFound('없는 매물입니다.');
  return l;
}

/** 내 매물의 칸 — 앞으로 · 지난 7일 · 칸마다 예약(가린 이름) */
export async function ownerSlots(db: DatabaseService, listingId: string, me: string) {
  const s = await vsxSettings(db);
  const l = await ownListing(db, listingId, me);
  const rows = await db.query<Record<string, unknown> & { name: string | null }>(
    `SELECT s.id::text AS id, s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.state, (s.starts_at > now()) AS future,
            b.id::text AS "bookingId", b.state AS "bookingState", b.memo, a.name
       FROM vsx_slots s
       LEFT JOIN LATERAL (SELECT x.* FROM vsx_bookings x WHERE x.slot_id = s.id ORDER BY (x.state IN ('REQUESTED', 'CONFIRMED')) DESC, x.id DESC LIMIT 1) b ON true
       LEFT JOIN accounts a ON a.id = b.member_account_id
      WHERE s.listing_id = $1::uuid AND s.starts_at > now() - interval '7 days' ORDER BY s.starts_at LIMIT 300`, [l.id]);
  return { enabled: s.visitOn && s.visitGwans.includes(l.gwan), listing: { id: l.id, title: l.title, status: l.status }, slotDays: s.slotDays, maxOpen: s.maxOpen, minutes: VSX_MINUTES,
    slots: rows.map(({ name, ...r }) => ({ ...r, visitor: r.bookingId ? maskName(name) ?? '회원' : null })) };
}

/** 칸 열기 — 날짜 하나 · 시각 여러 개(24개까지) · 길이 · 겹치거나 지난 시각은 건너뜀(까닭과 함께) */
export async function openSlots(db: DatabaseService, listingId: string, me: string, d: { date: string; times: string[]; minutes: number }) {
  const s = await vsxSettings(db);
  if (!s.visitOn) throw off();
  const l = await ownListing(db, listingId, me);
  if (!s.visitGwans.includes(l.gwan)) throw gwanOff();
  if (l.status !== 'PUBLISHED') throw new StateConflict('VSX_LISTING', '게시 중인 매물만 방문 시간을 엽니다.');
  if (!VSX_DATE_RE.test(String(d.date ?? ''))) throw new PolicyViolation('VSX_DATE', '날짜는 YYYY-MM-DD 입니다.');
  if (!(VSX_MINUTES as readonly number[]).includes(Number(d.minutes))) throw new PolicyViolation('VSX_MINUTES', `길이는 ${VSX_MINUTES.join(' · ')}분 중 하나입니다.`);
  const times = [...new Set((Array.isArray(d.times) ? d.times : []).map(String))].sort();
  if (!times.length || times.length > 24 || times.some((t) => !VSX_TIME_RE.test(t))) throw new PolicyViolation('VSX_TIME', '시각은 HH:MM(10분 단위) 1 ~ 24개입니다.');
  const today = vsxToday();
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + s.slotDays * 86400e3).toISOString().slice(0, 10);
  if (d.date < today || d.date > last) throw new PolicyViolation('VSX_DATE_RANGE', `오늘부터 ${s.slotDays}일 안(${last} 까지) 날짜만 엽니다.`);
  const [c] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM vsx_slots WHERE listing_id = $1::uuid AND state = 'OPEN' AND starts_at > now()`, [l.id]);
  const room = s.maxOpen - Number(c?.n ?? 0);
  if (room <= 0) throw new PolicyViolation('VSX_MAX_OPEN', `이 매물에 열어 둔 앞 칸이 ${s.maxOpen}개라 더 열 수 없습니다.`);
  const made: string[] = [];
  const skipped: Array<{ time: string; why: string }> = [];
  for (const t of times) {
    if (made.length >= room) { skipped.push({ time: t, why: 'VSX_MAX_OPEN' }); continue; }
    try {
      await db.query(
        `INSERT INTO vsx_slots (listing_id, owner_account_id, starts_at, ends_at)
         VALUES ($1::uuid, $2, ($3::date + $4::time) AT TIME ZONE 'Asia/Seoul', ($3::date + $4::time) AT TIME ZONE 'Asia/Seoul' + make_interval(mins => $5::int))`,
        [l.id, me, d.date, t, Number(d.minutes)]);
      made.push(t);
    } catch (e) {
      const m = /^(VSX_[A-Z_]+):/.exec(String((e as { message?: string })?.message ?? ''));
      skipped.push({ time: t, why: m ? m[1]! : 'VSX_SLOT' });
    }
  }
  return { ok: true, made: made.length, times: made, skipped, note: skipped.length ? `${made.length}칸을 열었습니다 · ${skipped.length}칸은 건너뜀(겹침 · 지난 시각 · 칸 수).` : `${made.length}칸을 열었습니다.` };
}

/** 칸 닫기 — 그 칸의 방문 전 요청 · 확정 예약은 주인 취소로(DB 트리거) · 회원에게 알림 */
export async function closeSlot(db: DatabaseService, slotIdIn: string, me: string) {
  const id = Number(slotIdIn);
  if (!Number.isInteger(id) || id <= 0) throw new NotFound('없는 시간 칸입니다.');
  const [sl] = await db.query<{ id: string; state: string; ownerId: string; title: string; startsAt: string }>(
    `SELECT s.id::text AS id, s.state, s.owner_account_id AS "ownerId", l.title, s.starts_at AS "startsAt" FROM vsx_slots s JOIN listings l ON l.id = s.listing_id WHERE s.id = $1::bigint`, [id]);
  if (!sl || sl.ownerId !== me) throw new NotFound('없는 시간 칸입니다.');
  if (sl.state !== 'OPEN') throw new StateConflict('VSX_SLOT', '이미 닫힌 칸입니다.');
  const hit = await db.query<{ member: string }>(
    `SELECT member_account_id AS member FROM vsx_bookings WHERE slot_id = $1::bigint AND state IN ('REQUESTED', 'CONFIRMED') AND (SELECT starts_at FROM vsx_slots WHERE id = $1::bigint) > now()`, [id]);
  const r = await db.query(`UPDATE vsx_slots SET state = 'CLOSED', closed_at = now() WHERE id = $1::bigint AND state = 'OPEN' RETURNING id`, [id]).catch((e) => dbErr(e));
  if (!r.length) throw new StateConflict('VSX_SLOT', '이미 닫힌 칸입니다.');
  for (const h of hit) await notify(db, h.member, 'VSX_BOOK_CANCELLED', '방문 예약이 취소되었습니다', `「${sl.title.slice(0, 40)}」 ${kst(sl.startsAt)} 방문 — 매물 주인이 그 시간을 닫았습니다.`);
  return { ok: true, id: sl.id, cancelled: hit.length, note: hit.length ? `칸을 닫고 예약 ${hit.length}건을 취소했습니다(회원에게 알림).` : '칸을 닫았습니다.' };
}

/* ── 정기 작업 vsx_visit (매시간) ───────────────────────────────────── */
export async function vsxVisitJob(db: DatabaseService) {
  const s = await vsxSettings(db);
  if (!s.visitOn) return { on: false, expired: 0, reminded: 0 };
  const expired = await db.query<{ member: string; title: string; startsAt: string }>(
    `UPDATE vsx_bookings b SET state = 'CANCELLED', cancelled_at = now(), cancel_by = 'SYSTEM', cancel_reason = '방문 시각까지 확정되지 않음'
       FROM vsx_slots s, listings l
      WHERE s.id = b.slot_id AND l.id = b.listing_id AND b.state = 'REQUESTED' AND s.starts_at <= now()
      RETURNING b.member_account_id AS member, l.title, s.starts_at AS "startsAt"`);
  for (const x of expired) await notify(db, x.member, 'VSX_BOOK_CANCELLED', '방문 예약이 취소되었습니다', `「${x.title.slice(0, 40)}」 ${kst(x.startsAt)} 방문 — 매물 주인이 시간 안에 확정하지 않아 저절로 취소되었습니다.`);
  /* 전날 알림 — 한국 시각 10시부터 · 내일 방문 · 한 번(reminded_at) */
  const hour = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  let reminded = 0;
  if (hour >= 10) {
    const due = await db.query<{ member: string; owner: string; title: string; startsAt: string }>(
      `UPDATE vsx_bookings b SET reminded_at = now()
         FROM vsx_slots s, listings l
        WHERE s.id = b.slot_id AND l.id = b.listing_id AND b.state = 'CONFIRMED' AND b.reminded_at IS NULL
          AND (s.starts_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date + 1
        RETURNING b.member_account_id AS member, l.owner_account_id AS owner, l.title, s.starts_at AS "startsAt"`);
    for (const x of due) {
      await notify(db, x.member, 'VSX_VISIT_REMIND', '내일 방문 예약이 있습니다', `「${x.title.slice(0, 40)}」 ${kst(x.startsAt)} 방문 — 못 가게 되면 미리 취소해 주십시오.`);
      await notify(db, x.owner, 'VSX_VISIT_REMIND', '내일 방문 손님이 있습니다', `「${x.title.slice(0, 40)}」 ${kst(x.startsAt)} 방문 예약(확정).`);
    }
    reminded = due.length;
  }
  return { on: true, expired: expired.length, reminded };
}

/* ── 운영 화면 › 검수 › 매물 방문 예약 ─────────────────────────────── */
export async function adminVisits(db: DatabaseService) {
  const settings = await vsxSettings(db);
  const [sum] = await db.query(
    `SELECT (SELECT count(*)::int FROM vsx_slots WHERE state = 'OPEN' AND starts_at > now()) AS "openSlots",
            count(*)::int AS total,
            count(*) FILTER (WHERE state = 'REQUESTED')::int AS requested, count(*) FILTER (WHERE state = 'CONFIRMED')::int AS confirmed,
            count(*) FILTER (WHERE state = 'CANCELLED')::int AS cancelled, count(*) FILTER (WHERE state = 'NOSHOW')::int AS noshow,
            count(*) FILTER (WHERE state = 'DONE')::int AS done, count(*) FILTER (WHERE cancel_by = 'SYSTEM')::int AS expired
       FROM vsx_bookings WHERE created_at > now() - interval '30 days'`);
  const gwans = await db.query<{ code: string; name: string }>(`SELECT code, name FROM gwans WHERE is_active ORDER BY sort_order, code`);
  /* 노쇼 횟수(지난 180일)는 운영 화면에서만 — 회원 화면 · 회원 API 에는 싣지 않음(대표 11/21) */
  const rows = await db.query<Record<string, unknown> & { name: string | null }>(
    `SELECT b.id::text AS id, b.state, b.cancel_by AS "cancelBy", b.created_at AS "createdAt", s.starts_at AS "startsAt", l.id AS "listingId", l.title, l.gwan_code AS "gwanCode", a.name,
            (SELECT count(*)::int FROM vsx_bookings x WHERE x.member_account_id = b.member_account_id AND x.state = 'NOSHOW' AND x.marked_at > now() - interval '180 days') AS "noshow180"
       FROM vsx_bookings b JOIN vsx_slots s ON s.id = b.slot_id JOIN listings l ON l.id = b.listing_id JOIN accounts a ON a.id = b.member_account_id
      ORDER BY b.id DESC LIMIT 100`);
  return { settings, gwans: gwans.map((g) => ({ ...g, on: settings.visitGwans.includes(g.code) })), summary30: sum ?? {}, recent: rows.map(({ name, ...r }) => ({ ...r, visitor: maskName(name) ?? '회원' })),
    note: '방문 예약은 매물 주인과 회원 사이 약속입니다 — 운영은 숫자 · 기록만 봅니다(연락처 없음).' };
}
