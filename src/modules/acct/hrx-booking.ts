import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { kstToday } from './hr';
import { HRX_HM_RE, hrxAddDays, hrxHm, hrxKstMs } from './hrx-overtime';
import { pgxCan } from '../admin/pgx-perm';   // v10.615 (docs/757)

/* ---------------------------------------------------------------------
 * v10.473 (D265 · docs/611) 회의실 · 장비 예약 — 대표 11/20 「㉟ 인사 4」
 *   자원(hrx_resources) — 회의실(ROOM · 인원) · 장비(EQUIP) · ADMIN 이 넣고 고침 · 지우지 않음(쓰지 않음)
 *   예약(hrx_bookings) — 운영 역할 누구나 · 날 · 시작 · 끝(한국 시각 · 같은 날 · 끝 > 시작) · 제목 · [시작, 끝) 반열린 구간
 *     같은 자원 살아 있는 예약이 시간이 겹치면 **DB 배제 제약 ex_hrx_booking_overlap** 이 막음 → 409 HRX_BOOK_OVERLAP
 *     (서버가 먼저 겹친 예약을 찾아 알려 주지만, 동시에 두 사람이 눌러도 DB 가 하나만 받음)
 *     지난 시각 · hrx.book_ahead_days 넘게 뒤 · hrx.book_max_hours 넘는 길이는 422 HRX_BOOK_TIME
 *   취소 — 예약한 사람 또는 ADMIN · SUPER · 끝나기 전만 · 한 번 · 지우지 않음
 *   ㉜ 사내 일정 캘린더(D263 ofc-calendar.ts) — bookingCalItems() 가 「내 예약」 줄을 같은 모양(CalItem)으로 돌려줌(합칠 때 calendarView 에 연결 · NOTES).
 * ------------------------------------------------------------------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const HRX_RESOURCE_KINDS = ['ROOM', 'EQUIP'] as const;
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

export interface BookViewer { id: string; roles: string[] }
/* v10.615 (docs/757) perm.mode GROUPS — 관리자 = 「회의실 · 장비 예약」 업무의 승인(APPROVE)(R_ADMIN 만 가짐 · 같은 범위) · ROLE · COMPARE 는 지금처럼 ADMIN · SUPER */
const isManager = (db: DatabaseService, v: BookViewer) => pgxCan(db, v.id, v.roles, ['hrx-booking'], ['APPROVE'], ['ADMIN']);

async function bookRules(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('hrx.book_ahead_days', 'hrx.book_max_hours')`);
  const n = (k: string, d: number, max: number) => { const v = Number(rows.find((r) => r.key === k)?.value ?? d); return Number.isInteger(v) && v >= 1 && v <= max ? v : d; };
  return { aheadDays: n('hrx.book_ahead_days', 90, 365), maxHours: n('hrx.book_max_hours', 8, 24) };
}

export interface ResRow { id: string; kind: string; name: string; location: string | null; capacity: number | null; note: string | null; active: boolean; sort: number }
export interface BookRow { id: string; resourceId: string; resource: string; title: string; memo: string | null; startAt: string; endAt: string; bookedBy: string; who: string | null }

/** GET /admin/hrx/booking?from=&to= — 자원 · 기간 안 살아 있는 예약(14일까지 · 비우면 오늘 하루) */
export async function bookingBoard(db: DatabaseService, v: BookViewer, fromIn?: string, toIn?: string) {
  const today = kstToday();
  const from = fromIn && dayOk(fromIn) ? fromIn : today;
  const to = toIn && dayOk(toIn) ? toIn : from;
  if (to < from) throw new PolicyViolation('HRX_BOOK_RANGE', '끝 날짜가 시작 날짜보다 앞입니다.');
  if (diffDays(from, to) > 13) throw new PolicyViolation('HRX_BOOK_RANGE', '한 번에 14일까지 봅니다.');
  const resources = await db.query<ResRow>(
    `SELECT id::text AS id, kind, name, location, capacity, note, active, sort FROM hrx_resources ORDER BY active DESC, sort, kind, name`);
  const fromIso = new Date(hrxKstMs(from, '00:00')).toISOString(), toIso = new Date(hrxKstMs(hrxAddDays(to, 1), '00:00')).toISOString();
  const rows = await db.query<BookRow>(
    `SELECT b.id::text AS id, b.resource_id::text AS "resourceId", r.name AS resource, b.title, b.memo, b.start_at AS "startAt", b.end_at AS "endAt",
            b.booked_by::text AS "bookedBy", coalesce(a.name, a.email) AS who
       FROM hrx_bookings b JOIN hrx_resources r ON r.id = b.resource_id LEFT JOIN accounts a ON a.id = b.booked_by
      WHERE b.canceled_at IS NULL AND b.start_at < $2::timestamptz AND b.end_at > $1::timestamptz
      ORDER BY b.start_at, r.sort, b.id LIMIT 1000`, [fromIso, toIso]);
  const now = Date.now(), mgr = await isManager(db, v);
  const items = rows.map((b) => {
    const mine = b.bookedBy === v.id, s = Date.parse(b.startAt), e = Date.parse(b.endAt);
    return { id: b.id, resourceId: b.resourceId, resource: b.resource, title: b.title, memo: mine || mgr ? b.memo : null, day: new Date(s + 9 * 3600e3).toISOString().slice(0, 10),
             startHm: hrxHm(s), endHm: hrxHm(e), who: b.who ?? '', mine, canCancel: e > now && (mine || mgr), past: e <= now };
  });
  const r = await bookRules(db);
  return { from, to, today, resources, items, canManage: mgr, rules: r,
           note: `같은 자원은 시간이 겹치게 예약할 수 없습니다(DB 가 막음 · 10:00 ~ 11:00 과 11:00 ~ 12:00 은 겹치지 않음). 오늘부터 ${r.aheadDays}일 안 · 한 번에 ${r.maxHours}시간까지.` };
}

export interface BookInput { resourceId?: string; day?: string; startHm?: string; endHm?: string; title?: string; memo?: string | null }

/** POST /admin/hrx/booking — 예약(겹치면 409 HRX_BOOK_OVERLAP) */
export async function createBooking(db: DatabaseService, b: BookInput, v: BookViewer) {
  const resourceId = String(b.resourceId ?? ''), day = String(b.day ?? ''), s = String(b.startHm ?? ''), t = String(b.endHm ?? ''), title = clean(b.title);
  const memo = b.memo ? clean(b.memo).slice(0, 200) || null : null;
  if (!/^\d{1,18}$/.test(resourceId)) throw new NotFound('없는 자원입니다.');
  if (!dayOk(day)) throw new PolicyViolation('HRX_BOOK_TIME', '날짜(YYYY-MM-DD)가 바르지 않습니다.');
  if (!HRX_HM_RE.test(s) || !HRX_HM_RE.test(t)) throw new PolicyViolation('HRX_BOOK_TIME', '시각은 HH:MM(한국 시각)입니다.');
  if (t <= s) throw new PolicyViolation('HRX_BOOK_TIME', '끝 시각이 시작 시각보다 뒤여야 합니다(같은 날 안).');
  if (title.length < 1 || title.length > 80) throw new PolicyViolation('HRX_BOOK_TITLE', '제목은 1 ~ 80자입니다.');
  const r = await bookRules(db);
  const startMs = hrxKstMs(day, s), endMs = hrxKstMs(day, t);
  if (endMs - startMs > r.maxHours * 3600e3) throw new PolicyViolation('HRX_BOOK_TIME', `한 번에 ${r.maxHours}시간까지 예약합니다(설정 hrx.book_max_hours).`);
  if (endMs <= Date.now()) throw new PolicyViolation('HRX_BOOK_TIME', '이미 지난 시각입니다.');
  if (day > hrxAddDays(kstToday(), r.aheadDays)) throw new PolicyViolation('HRX_BOOK_TIME', `오늘부터 ${r.aheadDays}일 안만 예약합니다(설정 hrx.book_ahead_days).`);
  const [res] = await db.query<{ name: string; active: boolean }>(`SELECT name, active FROM hrx_resources WHERE id = $1::bigint`, [resourceId]);
  if (!res) throw new NotFound('없는 자원입니다.');
  if (!res.active) throw new PolicyViolation('HRX_BOOK_RESOURCE', '쓰지 않는 자원입니다.');
  const startIso = new Date(startMs).toISOString(), endIso = new Date(endMs).toISOString();
  const [over] = await db.query<{ id: string; title: string; s: string; e: string; who: string | null }>(
    `SELECT b.id::text AS id, b.title, b.start_at AS s, b.end_at AS e, coalesce(a.name, a.email) AS who FROM hrx_bookings b LEFT JOIN accounts a ON a.id = b.booked_by
      WHERE b.resource_id = $1::bigint AND b.canceled_at IS NULL AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)') ORDER BY b.start_at LIMIT 1`,
    [resourceId, startIso, endIso]);
  if (over) throw new StateConflict('HRX_BOOK_OVERLAP', `${res.name}은 ${hrxHm(Date.parse(over.s))} ~ ${hrxHm(Date.parse(over.e))}에 이미 예약이 있습니다(${over.who ?? ''} · ${over.title}).`);
  try {
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO hrx_bookings (resource_id, booked_by, title, memo, start_at, end_at) VALUES ($1::bigint, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz) RETURNING id::text AS id`,
      [resourceId, v.id, title, memo, startIso, endIso]);
    return { ok: true, id: row!.id, resource: res.name, day, startHm: s, endHm: t, note: `${res.name} ${day} ${s} ~ ${t}을 예약했습니다.` };
  } catch (err) {
    /* 동시에 누른 두 번째 예약 — 배제 제약(23P01)이 막음 */
    if ((err as { code?: string })?.code === '23P01') throw new StateConflict('HRX_BOOK_OVERLAP', `${res.name}은 그 시간에 방금 다른 예약이 들어왔습니다.`);
    throw err;
  }
}

/** POST /admin/hrx/booking/{id}/cancel — 예약한 사람 · ADMIN · SUPER · 끝나기 전 */
export async function cancelBooking(db: DatabaseService, id: string, reasonIn: string | undefined, v: BookViewer) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 예약입니다.');
  const reason = clean(reasonIn).slice(0, 200) || null;
  return db.transaction(async () => {
    const [b] = await db.query<{ id: string; bookedBy: string; ended: boolean; canceled: boolean }>(
      `SELECT id::text AS id, booked_by::text AS "bookedBy", end_at <= now() AS ended, canceled_at IS NOT NULL AS canceled FROM hrx_bookings WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!b) throw new NotFound('없는 예약입니다.');
    if (b.bookedBy !== v.id && !(await isManager(db, v))) throw new Forbidden('HRX_BOOK_OWNER', '예약한 사람 · 관리자만 취소합니다.');
    if (b.canceled) throw new StateConflict('HRX_BOOK_STATE', '이미 취소한 예약입니다.');
    if (b.ended) throw new StateConflict('HRX_BOOK_STATE', '끝난 예약은 취소하지 않습니다.');
    if (b.bookedBy !== v.id && (!reason || reason.length < 2)) throw new PolicyViolation('HRX_BOOK_REASON', '남의 예약을 취소할 때는 사유를 2자 이상 적습니다.');
    await db.query(`UPDATE hrx_bookings SET canceled_at = now(), canceled_by = $2::uuid, cancel_reason = $3 WHERE id = $1::bigint`, [id, v.id, reason]);
    return { ok: true, id, note: '예약을 취소했습니다.' };
  });
}

export interface ResourceInput { kind?: string; name?: string; location?: string | null; capacity?: number | null; note?: string | null; active?: boolean; sort?: number }

function checkRes(x: { kind: string; name: string; location: string | null; capacity: number | null; note: string | null; sort: number }) {
  if (!(HRX_RESOURCE_KINDS as readonly string[]).includes(x.kind)) throw new PolicyViolation('HRX_RESOURCE', '자원 종류는 회의실(ROOM) · 장비(EQUIP)입니다.');
  if (x.name.length < 1 || x.name.length > 40) throw new PolicyViolation('HRX_RESOURCE', '자원 이름은 1 ~ 40자입니다.');
  if (x.location && x.location.length > 60) throw new PolicyViolation('HRX_RESOURCE', '위치는 60자까지입니다.');
  if (x.capacity !== null && (!Number.isInteger(x.capacity) || x.capacity < 1 || x.capacity > 500)) throw new PolicyViolation('HRX_RESOURCE', '인원은 1 ~ 500 입니다.');
  if (x.note && x.note.length > 200) throw new PolicyViolation('HRX_RESOURCE', '메모는 200자까지입니다.');
  if (!Number.isInteger(x.sort) || x.sort < 0 || x.sort > 9999) throw new PolicyViolation('HRX_RESOURCE', '순서는 0 ~ 9999 입니다.');
}

/** POST /admin/hrx/booking/resources — 자원 넣기(ADMIN) */
export async function addResource(db: DatabaseService, b: ResourceInput, actor: string | null) {
  const x = { kind: b.kind ?? 'ROOM', name: clean(b.name), location: b.location ? clean(b.location) || null : null, capacity: b.capacity ?? null,
              note: b.note ? clean(b.note) || null : null, sort: b.sort ?? 100 };
  checkRes(x);
  const r = await db.query<{ id: string }>(
    `INSERT INTO hrx_resources (kind, name, location, capacity, note, sort, updated_by) VALUES ($1, $2, $3, $4::int, $5, $6::int, $7::uuid)
     ON CONFLICT (name) DO NOTHING RETURNING id::text AS id`, [x.kind, x.name, x.location, x.capacity, x.note, x.sort, actor]);
  if (!r.length) throw new StateConflict('HRX_RESOURCE_DUP', `같은 이름의 자원이 있습니다: ${x.name}`);
  return { ok: true, id: r[0]!.id, note: `${x.kind === 'ROOM' ? '회의실' : '장비'} ${x.name}을 넣었습니다.` };
}

/** PUT /admin/hrx/booking/resources/{id} — 자원 고치기(ADMIN · 보낸 칸만 · 종류는 못 바꿈) */
export async function updateResource(db: DatabaseService, id: string, b: ResourceInput, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 자원입니다.');
  const [o] = await db.query<ResRow>(`SELECT id::text AS id, kind, name, location, capacity, note, active, sort FROM hrx_resources WHERE id = $1::bigint`, [id]);
  if (!o) throw new NotFound('없는 자원입니다.');
  if (b.kind !== undefined && b.kind !== o.kind) throw new PolicyViolation('HRX_RESOURCE', '자원 종류는 바꾸지 않습니다(새 자원으로).');
  const x = { kind: o.kind, name: b.name !== undefined ? clean(b.name) : o.name, location: b.location !== undefined ? (b.location ? clean(b.location) || null : null) : o.location,
              capacity: b.capacity !== undefined ? b.capacity : o.capacity, note: b.note !== undefined ? (b.note ? clean(b.note) || null : null) : o.note,
              sort: b.sort !== undefined ? b.sort : o.sort, active: b.active !== undefined ? !!b.active : o.active };
  checkRes(x);
  const [dup] = await db.query(`SELECT 1 FROM hrx_resources WHERE name = $1 AND id <> $2::bigint`, [x.name, id]);
  if (dup) throw new StateConflict('HRX_RESOURCE_DUP', `같은 이름의 자원이 있습니다: ${x.name}`);
  await db.query(
    `UPDATE hrx_resources SET name = $2, location = $3, capacity = $4::int, note = $5, sort = $6::int, active = $7::boolean, updated_by = $8::uuid WHERE id = $1::bigint`,
    [id, x.name, x.location, x.capacity, x.note, x.sort, x.active, actor]);
  const [fut] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hrx_bookings WHERE resource_id = $1::bigint AND canceled_at IS NULL AND end_at > now()`, [id]);
  return { ok: true, id, active: x.active, futureBookings: fut?.n ?? 0,
           note: !x.active && (fut?.n ?? 0) > 0 ? `${x.name}을 쓰지 않음으로 했습니다 — 앞으로의 예약 ${fut!.n}건은 그대로 남아 있습니다(필요하면 취소).` : `${x.name}을 고쳤습니다.` };
}

/* ── ㉜ 사내 일정 캘린더(D263)에 붙일 「내 예약」 줄 — ofc-calendar.ts CalItem 과 같은 모양(kind BOOK) ──
 *   합칠 때 calendarView 의 items.push 묶음 끝에:  for (const x of await bookingCalItems(db, v.id, from, to)) items.push(x);
 *   그리고 OFC_CAL_KINDS 에 BOOK: '회의실 · 장비 예약' 한 줄(NOTES 「앞 묶음 ㉜ 에 기댐」). */
export async function bookingCalItems(db: DatabaseService, viewerId: string, from: string, to: string) {
  if (!dayOk(from) || !dayOk(to)) return [];
  const fromIso = new Date(hrxKstMs(from, '00:00')).toISOString(), toIso = new Date(hrxKstMs(hrxAddDays(to, 1), '00:00')).toISOString();
  const rows = await db.query<{ id: string; resource: string; title: string; s: string; e: string }>(
    `SELECT b.id::text AS id, r.name AS resource, b.title, b.start_at AS s, b.end_at AS e FROM hrx_bookings b JOIN hrx_resources r ON r.id = b.resource_id
      WHERE b.booked_by = $1::uuid AND b.canceled_at IS NULL AND b.start_at < $3::timestamptz AND b.end_at > $2::timestamptz ORDER BY b.start_at LIMIT 300`,
    [viewerId, fromIso, toIso]);
  return rows.map((b) => {
    const s = Date.parse(b.s), e = Date.parse(b.e), day = new Date(s + 9 * 3600e3).toISOString().slice(0, 10);
    return { key: `BOOK:${b.id}`, kind: 'BOOK', title: `${b.resource} 예약 — ${b.title} (${hrxHm(s)} ~ ${hrxHm(e)})`, start: day, end: day, time: hrxHm(s),
             mine: true, editable: false, tab: 'hrx-booking' };
  });
}
