import { DatabaseService } from '../../db/database.service';
import { hasRole } from '../../core/auth';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { deadlines } from './month';   // v10.390 · 418 신고 기한 · 급여일 · 카드 대금일(같은 셈을 그대로 씀)

/* ---------------------------------------------------------------------
 * v10.462 (D263 · docs/600) 사내 일정 캘린더 — 대표 11/20 「㉜ 사무 2」
 *   달 · 주 보기 한 API(GET /admin/office/calendar?from=&to= · 62일까지)가 지금 있는 표를 읽어 모음 — 사본 · 새 표 없음:
 *     LEAVE    휴가(acct_leave_requests 승인 · 본인 신청 중)          — 운영자 모두(이름만 · 사유 안 보임)
 *     APV      품의 쓸 날(acct_requisitions 결재 기다림 · 승인)        — 올린 사람 · SUPER · 지급 담당
 *     TAX      원천세 · 부가세 · 법인세 · 카드 대금(month.ts deadlines) — SUPER · 지급 담당
 *     PAY      급여일(같은 셈)                                       — 운영자 모두
 *     CONTRACT 계약 만기 · 해지 통보 기한(acct_contracts 쓰는 중)      — SUPER · 지급 담당
 *     TRIP     출장(ofc_trips · 본인 것 · 승인된 남의 출장)            — 운영자 모두
 *     TASK     업무 기한(ofc_tasks · 요청한 · 맡은 것)                 — 본인
 *     EVENT    직접 넣은 일정(ofc_events · 개인은 본인만 · 회사는 모두) — 회사 일정 넣기 · 고치기 ADMIN · SUPER
 *   지우기는 지움 표시(removed_at)만 · DB 가 DELETE 를 막음.
 * ------------------------------------------------------------------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const OFC_TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;   // DB CHECK ofc_events.at_time 과 같음
export const OFC_EVENT_SCOPES = ['PERSONAL', 'COMPANY'] as const;
export const OFC_CAL_KINDS: Record<string, string> = {
  EVENT: '직접 일정', LEAVE: '휴가', APV: '품의 쓸 날', TAX: '신고 · 납부 기한', PAY: '급여일', CONTRACT: '계약 만기', TRIP: '출장', TASK: '업무 기한',
};
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export interface Viewer { id: string; roles: string[] }
export const isFinance = (v: Viewer) => hasRole(v.roles, 'PAYOUT');   // SUPER 포함(hasRole)
export const isCompanyEditor = (v: Viewer) => v.roles.includes('SUPER') || v.roles.includes('ADMIN');

export interface CalItem {
  key: string; kind: keyof typeof OFC_CAL_KINDS | string; title: string; start: string; end: string; time: string | null;
  mine: boolean; editable: boolean; id?: string; scope?: string; memo?: string | null; tab?: string;
}

/** 날짜 범위 — 비우면 이번 달(한국) · 끝 ≥ 시작 · 62일까지 */
export function calRange(fromIn?: string, toIn?: string) {
  const today = kstToday();
  const from = fromIn ? fromIn : `${today.slice(0, 7)}-01`;
  if (!dayOk(from)) throw new PolicyViolation('OFC_RANGE', '시작 날짜(YYYY-MM-DD)가 맞지 않습니다.');
  const to = toIn ? toIn : addDays(addDays(`${from.slice(0, 7)}-01`, 32).slice(0, 8) + '01', -1);
  if (!dayOk(to)) throw new PolicyViolation('OFC_RANGE', '끝 날짜(YYYY-MM-DD)가 맞지 않습니다.');
  if (to < from) throw new PolicyViolation('OFC_RANGE', '끝 날짜가 시작 날짜보다 앞입니다.');
  if (diffDays(from, to) > 62) throw new PolicyViolation('OFC_RANGE', '한 번에 62일까지 봅니다(달 · 주 보기).');
  return { from, to, today };
}

/** GET /admin/office/calendar — 모은 일정(날짜순) */
export async function calendarView(db: DatabaseService, v: Viewer, fromIn?: string, toIn?: string) {
  const { from, to, today } = calRange(fromIn, toIn);
  const fin = isFinance(v), editor = isCompanyEditor(v);
  const items: CalItem[] = [];

  /* 직접 넣은 일정 */
  const evs = await db.query<{ id: string; scope: string; owner: string; title: string; s: string; e: string; t: string | null; memo: string | null; who: string | null }>(
    `SELECT x.id::text AS id, x.scope, x.owner_id::text AS owner, x.title, x.start_on::text AS s, x.end_on::text AS e, x.at_time AS t, x.memo, coalesce(a.name, a.email) AS who
       FROM ofc_events x LEFT JOIN accounts a ON a.id = x.owner_id
      WHERE x.removed_at IS NULL AND x.start_on <= $2::date AND x.end_on >= $1::date AND (x.scope = 'COMPANY' OR x.owner_id = $3::uuid)
      ORDER BY x.start_on, x.at_time NULLS FIRST, x.id LIMIT 500`, [from, to, v.id]);
  for (const x of evs) {
    const mine = x.owner === v.id;
    items.push({ key: `EVENT:${x.id}`, kind: 'EVENT', id: x.id, scope: x.scope, title: x.scope === 'COMPANY' ? `[회사] ${x.title}` : x.title,
      start: x.s, end: x.e, time: x.t, memo: x.memo, mine, editable: x.scope === 'COMPANY' ? editor : mine });
  }

  /* 휴가 — 승인된 것 · 내 신청 중 */
  const lv = await db.query<{ id: string; name: string; s: string; e: string; half: string; state: string; mine: boolean }>(
    `SELECT r.id::text AS id, e.name, r.start_on::text AS s, r.end_on::text AS e, r.half, r.state, coalesce(e.account_id = $3::uuid, false) AS mine
       FROM acct_leave_requests r JOIN acct_employees e ON e.id = r.employee_id
      WHERE r.start_on <= $2::date AND r.end_on >= $1::date AND (r.state = 'APPROVED' OR (r.state = 'REQUESTED' AND e.account_id = $3::uuid))
      ORDER BY r.start_on, r.id LIMIT 500`, [from, to, v.id]);
  for (const r of lv) {
    const half = r.half === 'AM' ? ' 오전 반차' : r.half === 'PM' ? ' 오후 반차' : '';
    items.push({ key: `LEAVE:${r.id}`, kind: 'LEAVE', title: `휴가 ${r.name}${half}${r.state === 'REQUESTED' ? ' (신청 중)' : ''}`, start: r.s, end: r.e, time: null,
      mine: r.mine, editable: false, tab: r.mine ? 'my-hr' : 'hr-leave' });
  }

  /* 품의 쓸 날 — 출장 품의는 출장 줄로 보이므로 뺌 */
  const rq = await db.query<{ id: string; title: string; d: string; state: string; mine: boolean }>(
    `SELECT r.id::text AS id, r.title, r.needed_on::text AS d, r.state, (r.requester = $3::uuid) AS mine
       FROM acct_requisitions r
      WHERE r.needed_on BETWEEN $1::date AND $2::date AND r.state IN ('REQUESTED', 'APPROVED')
        AND ($4::boolean OR r.requester = $3::uuid)
        AND NOT EXISTS (SELECT 1 FROM ofc_trips t WHERE t.requisition_id = r.id)
      ORDER BY r.needed_on, r.id LIMIT 300`, [from, to, v.id, fin]);
  for (const r of rq) {
    items.push({ key: `APV:${r.id}`, kind: 'APV', title: `품의 쓸 날 — ${r.title}${r.state === 'REQUESTED' ? ' · 결재 기다림' : ''}`, start: r.d, end: r.d, time: null,
      mine: r.mine, editable: false, tab: 'acct-requisitions' });
  }

  /* 신고 기한 · 급여일 — month.ts 의 셈 그대로(그 달 · 다음 달) · 범위 안 달 첫날마다 */
  const starts = new Set<string>([from]);
  for (let d = `${from.slice(0, 7)}-01`; d <= to; d = addDays(d, 32).slice(0, 8) + '01') if (d > from) starts.add(d);
  const seen = new Set<string>();
  for (const s of starts) {
    const r = await deadlines(db, s).catch(() => ({ list: [] as Array<{ key: string; kind: string; label: string; due: string }> }));
    for (const d of r.list) {
      if (seen.has(d.key) || d.due < from || d.due > to) continue;
      seen.add(d.key);
      if (d.kind === 'PAY') items.push({ key: `PAY:${d.key}`, kind: 'PAY', title: d.label, start: d.due, end: d.due, time: null, mine: false, editable: false });
      else if (fin) items.push({ key: `TAX:${d.key}`, kind: 'TAX', title: `${d.label} 기한`, start: d.due, end: d.due, time: null, mine: false, editable: false, tab: 'acct-month' });
    }
  }

  /* 계약 만기 · 해지 통보 기한 */
  if (fin) {
    const cs = await db.query<{ id: string; title: string; e: string; notice: string; renew: boolean }>(
      `SELECT c.id::text AS id, c.title, c.end_on::text AS e, (c.end_on - c.notice_days)::text AS notice, c.auto_renew AS renew
         FROM acct_contracts c
        WHERE c.state = 'ACTIVE' AND c.end_on IS NOT NULL
          AND (c.end_on BETWEEN $1::date AND $2::date OR (c.end_on - c.notice_days) BETWEEN $1::date AND $2::date)
        ORDER BY c.end_on, c.id LIMIT 300`, [from, to]);
    for (const c of cs) {
      if (c.e >= from && c.e <= to) items.push({ key: `CONTRACT:${c.id}:END`, kind: 'CONTRACT', title: `계약 만기 — ${c.title}${c.renew ? ' (자동 갱신)' : ''}`, start: c.e, end: c.e, time: null, mine: false, editable: false, tab: 'acct-contracts' });
      if (c.notice >= from && c.notice <= to) items.push({ key: `CONTRACT:${c.id}:NOTICE`, kind: 'CONTRACT', title: `계약 해지 통보 기한 — ${c.title}`, start: c.notice, end: c.notice, time: null, mine: false, editable: false, tab: 'acct-contracts' });
    }
  }

  /* 출장 — 내 것 · 승인된 남의 출장 */
  const tr = await db.query<{ id: string; who: string | null; dest: string; s: string; e: string; rstate: string; mine: boolean }>(
    `SELECT t.id::text AS id, coalesce(a.name, a.email) AS who, t.destination AS dest, t.depart_on::text AS s, t.return_on::text AS e, r.state AS rstate, (t.traveler = $3::uuid) AS mine
       FROM ofc_trips t JOIN acct_requisitions r ON r.id = t.requisition_id LEFT JOIN accounts a ON a.id = t.traveler
      WHERE t.state <> 'CANCELED' AND t.depart_on <= $2::date AND t.return_on >= $1::date
        AND (t.traveler = $3::uuid OR r.state IN ('APPROVED', 'USED'))
      ORDER BY t.depart_on, t.id LIMIT 300`, [from, to, v.id]);
  for (const t of tr) {
    items.push({ key: `TRIP:${t.id}`, kind: 'TRIP', title: `출장 ${t.who ?? ''} — ${t.dest}${t.rstate === 'REQUESTED' ? ' (결재 기다림)' : ''}`, start: t.s, end: t.e, time: null,
      mine: t.mine, editable: false, tab: 'ofc-trips' });
  }

  /* 업무 기한 — 요청한 · 맡은 것(끝나지 않은 것) */
  const tk = await db.query<{ id: string; title: string; d: string; mine: boolean; late: boolean }>(
    `SELECT k.id::text AS id, k.title, k.due_on::text AS d, (k.assignee = $3::uuid) AS mine, (k.due_on < $4::date) AS late
       FROM ofc_tasks k
      WHERE k.state IN ('REQUESTED', 'DOING') AND k.due_on BETWEEN $1::date AND $2::date AND (k.requester = $3::uuid OR k.assignee = $3::uuid)
      ORDER BY k.due_on, k.id LIMIT 300`, [from, to, v.id, today]);
  for (const k of tk) {
    items.push({ key: `TASK:${k.id}`, kind: 'TASK', title: `업무 기한 — ${k.title}${k.late ? ' (지남)' : ''}`, start: k.d, end: k.d, time: null, mine: k.mine, editable: false, tab: 'ofc-tasks' });
  }

  items.sort((a, b) => a.start.localeCompare(b.start) || String(a.time ?? '').localeCompare(String(b.time ?? '')) || a.key.localeCompare(b.key));
  return { from, to, today, items, count: items.length, kinds: OFC_CAL_KINDS, canCompany: editor, finance: fin,
           note: '휴가 · 품의 쓸 날 · 신고 기한 · 계약 만기 · 급여일 · 출장 · 업무 기한은 각 화면의 표를 그대로 읽습니다(여기서 고치지 않음). 직접 일정은 개인(본인만) · 회사(모두 · ADMIN · SUPER 가 넣음)입니다.' };
}

/* ── 직접 일정 넣기 · 고치기 · 지우기 ── */
export interface OfcEventInput { scope?: string; title?: string; startOn?: string; endOn?: string; time?: string | null; memo?: string | null }

function checkEvent(b: { title: string; startOn: string; endOn: string; time: string | null; memo: string | null }) {
  if (b.title.length < 1 || b.title.length > 80) throw new PolicyViolation('OFC_EVENT_TITLE', '일정 제목은 1 ~ 80자입니다.');
  if (!dayOk(b.startOn) || !dayOk(b.endOn)) throw new PolicyViolation('OFC_EVENT_DATE', '날짜(YYYY-MM-DD)가 맞지 않습니다.');
  if (b.endOn < b.startOn) throw new PolicyViolation('OFC_EVENT_DATE', '끝 날짜가 시작 날짜보다 앞입니다.');
  if (diffDays(b.startOn, b.endOn) > 92) throw new PolicyViolation('OFC_EVENT_DATE', '일정 하나는 93일까지입니다.');
  if (b.time && !OFC_TIME_RE.test(b.time)) throw new PolicyViolation('OFC_EVENT_TIME', '시각은 HH:MM(00:00 ~ 23:59)입니다.');
  if (b.memo && b.memo.length > 400) throw new PolicyViolation('OFC_EVENT_MEMO', '메모는 400자까지입니다.');
}

/** POST /admin/office/events — 개인(누구나) · 회사(ADMIN · SUPER) */
export async function createEvent(db: DatabaseService, b: OfcEventInput, v: Viewer) {
  const scope = (OFC_EVENT_SCOPES as readonly string[]).includes(b.scope ?? '') ? String(b.scope) : 'PERSONAL';
  if (scope === 'COMPANY' && !isCompanyEditor(v)) throw new Forbidden('OFC_EVENT_SCOPE', '회사 일정은 ADMIN · SUPER 가 넣습니다.');
  const x = { title: clean(b.title), startOn: String(b.startOn ?? ''), endOn: String(b.endOn || b.startOn || ''), time: b.time ? String(b.time) : null, memo: b.memo ? String(b.memo).trim() || null : null };
  checkEvent(x);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO ofc_events (scope, owner_id, title, start_on, end_on, at_time, memo, updated_by) VALUES ($1, $2::uuid, $3, $4::date, $5::date, $6, $7, $2::uuid) RETURNING id::text AS id`,
    [scope, v.id, x.title, x.startOn, x.endOn, x.time, x.memo]);
  return { ok: true, id: r!.id, scope, note: scope === 'COMPANY' ? '회사 일정을 넣었습니다 — 운영자 모두에게 보입니다.' : '내 일정을 넣었습니다 — 나만 봅니다.' };
}

async function loadEvent(db: DatabaseService, id: string, v: Viewer) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('일정이 없습니다.');
  const [e] = await db.query<{ id: string; scope: string; owner: string; title: string; s: string; e: string; t: string | null; memo: string | null; removed: boolean }>(
    `SELECT id::text AS id, scope, owner_id::text AS owner, title, start_on::text AS s, end_on::text AS e, at_time AS t, memo, removed_at IS NOT NULL AS removed
       FROM ofc_events WHERE id = $1::bigint FOR UPDATE`, [id]);
  if (!e || (e.scope === 'PERSONAL' && e.owner !== v.id)) throw new NotFound('일정이 없습니다.');   // 남의 개인 일정은 「없음」
  if (e.removed) throw new StateConflict('OFC_EVENT_REMOVED', '지운 일정입니다.');
  if (e.scope === 'COMPANY' && !isCompanyEditor(v)) throw new Forbidden('OFC_EVENT_SCOPE', '회사 일정은 ADMIN · SUPER 가 고칩니다.');
  return e;
}

/** PUT /admin/office/events/{id} — 보낸 칸만 바꿈(안 보낸 칸은 그대로) */
export async function updateEvent(db: DatabaseService, id: string, b: OfcEventInput, v: Viewer) {
  return db.transaction(async () => {
    const e = await loadEvent(db, id, v);
    const x = {
      title: b.title !== undefined ? clean(b.title) : e.title,
      startOn: b.startOn !== undefined ? String(b.startOn) : e.s,
      endOn: b.endOn !== undefined ? String(b.endOn) : e.e,
      time: b.time !== undefined ? (b.time ? String(b.time) : null) : e.t,
      memo: b.memo !== undefined ? (b.memo ? String(b.memo).trim() || null : null) : e.memo,
    };
    if (b.startOn !== undefined && b.endOn === undefined && x.endOn < x.startOn) x.endOn = x.startOn;
    checkEvent(x);
    await db.query(`UPDATE ofc_events SET title = $2, start_on = $3::date, end_on = $4::date, at_time = $5, memo = $6, updated_by = $7::uuid WHERE id = $1::bigint`,
      [e.id, x.title, x.startOn, x.endOn, x.time, x.memo, v.id]);
    return { ok: true, id: e.id, note: '일정을 고쳤습니다.' };
  });
}

/** POST /admin/office/events/{id}/remove — 지움 표시 */
export async function removeEvent(db: DatabaseService, id: string, v: Viewer) {
  return db.transaction(async () => {
    const e = await loadEvent(db, id, v);
    await db.query(`UPDATE ofc_events SET removed_at = now(), removed_by = $2::uuid WHERE id = $1::bigint AND removed_at IS NULL`, [e.id, v.id]);
    return { ok: true, id: e.id, note: '일정을 지웠습니다.' };
  });
}
