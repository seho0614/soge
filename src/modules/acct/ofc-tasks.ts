import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Viewer } from './ofc-calendar';

/* ---------------------------------------------------------------------
 * v10.463 (D263 · docs/601) 업무 요청 · 할 일 보드 — 대표 11/20 「㉜ 사무 2」
 *   요청(REQUESTED) → 진행(DOING) → 완료(DONE) · 취소(CANCELED) — 칸반 세 칸(요청 · 진행 · 완료) · 취소는 목록 아래
 *   누가 무엇을: 담당자 = 진행 · 완료 · 요청으로 되돌림 / 요청한 사람 = 담당 바꾸기 · 취소 · 다시 열기(완료 → 진행) / SUPER = 모두
 *   보기: 요청한 사람 · 담당자만(SUPER 는 모두 · view=all) — 남의 업무는 「없음」(404)
 *   기한(due_on): 보드에 「오늘까지」 · 「지남」 표시 · 매일 09:10 기한 지난 수를 운영 알림 OFC_TASK_OVERDUE(제목 없이 수만)
 *   댓글 · 상태 바뀜 · 담당 바뀜은 ofc_task_comments(쌓기만) · 제목 · 내용은 고치지 않음(댓글로 덧붙임 · DB 가 막음)
 * ------------------------------------------------------------------- */

export const TASK_STATES = ['REQUESTED', 'DOING', 'DONE', 'CANCELED'] as const;
export const TASK_STATE_KO: Record<string, string> = { REQUESTED: '요청', DOING: '진행', DONE: '완료', CANCELED: '취소' };
export const TASK_PRIORITIES = ['NORMAL', 'HIGH'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isSuper = (v: Viewer) => v.roles.includes('SUPER');
const STAFF_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'];

interface TaskRow { id: string; title: string; body: string | null; requester: string; assignee: string; state: string; priority: string; due_on: string | null;
  requester_name: string | null; assignee_name: string | null; created_at: string; started_at: string | null; done_at: string | null; canceled_at: string | null; cancel_note: string | null; comments: number }

const SELECT = `SELECT k.id::text AS id, k.title, k.body, k.requester::text AS requester, k.assignee::text AS assignee, k.state, k.priority, k.due_on::text AS due_on,
                       coalesce(ra.name, ra.email) AS requester_name, coalesce(aa.name, aa.email) AS assignee_name,
                       k.created_at, k.started_at, k.done_at, k.canceled_at, k.cancel_note,
                       (SELECT count(*)::int FROM ofc_task_comments c WHERE c.task_id = k.id AND c.kind = 'COMMENT') AS comments
                  FROM ofc_tasks k LEFT JOIN accounts ra ON ra.id = k.requester LEFT JOIN accounts aa ON aa.id = k.assignee`;

function shape(r: TaskRow, v: Viewer, today: string) {
  const open = r.state === 'REQUESTED' || r.state === 'DOING';
  const due = r.due_on && open ? (r.due_on < today ? 'OVER' : r.due_on === today ? 'TODAY' : 'LATER') : null;
  return { id: r.id, title: r.title, state: r.state, stateKo: TASK_STATE_KO[r.state] ?? r.state, priority: r.priority, dueOn: r.due_on, due,
           requesterId: r.requester, requester: r.requester_name, assigneeId: r.assignee, assignee: r.assignee_name, comments: r.comments,
           createdAt: r.created_at, startedAt: r.started_at, doneAt: r.done_at, canceledAt: r.canceled_at, cancelNote: r.cancel_note,
           mineAssigned: r.assignee === v.id, mineRequested: r.requester === v.id };
}

async function staffList(db: DatabaseService) {
  return db.query<{ id: string; name: string }>(
    `SELECT DISTINCT a.id::text AS id, coalesce(a.name, a.email) AS name FROM accounts a JOIN account_roles r ON r.account_id = a.id
      WHERE r.role = ANY($1::text[]) AND a.status = 'ACTIVE' ORDER BY 2 LIMIT 300`, [STAFF_ROLES]);
}

/** GET /admin/office/tasks?view=mine|requested|all&state= — 칸반(요청 · 진행 · 완료) + 취소 + 고를 사람 */
export async function taskBoard(db: DatabaseService, v: Viewer, viewIn?: string, q?: string) {
  const view = viewIn === 'requested' ? 'requested' : viewIn === 'all' && isSuper(v) ? 'all' : viewIn === 'both' ? 'both' : 'mine';
  const today = kstToday();
  const term = clean(q).slice(0, 40);
  const rows = await db.query<TaskRow>(
    `${SELECT}
      WHERE ($1 = 'all' OR ($1 = 'mine' AND k.assignee = $2::uuid) OR ($1 = 'requested' AND k.requester = $2::uuid)
             OR ($1 = 'both' AND (k.assignee = $2::uuid OR k.requester = $2::uuid)))
        AND (k.state IN ('REQUESTED', 'DOING') OR k.updated_at >= now() - interval '30 days')
        AND ($3 = '' OR k.title ILIKE '%' || $3 || '%')
      ORDER BY (k.priority = 'HIGH') DESC, k.due_on NULLS LAST, k.id DESC LIMIT 500`, [view, v.id, term]);
  const items = rows.map((r) => shape(r, v, today));
  const columns = (['REQUESTED', 'DOING', 'DONE'] as const).map((s) => ({ state: s, label: TASK_STATE_KO[s], items: items.filter((x) => x.state === s) }));
  return { view, today, columns, canceled: items.filter((x) => x.state === 'CANCELED'), staff: await staffList(db), canAll: isSuper(v), me: v.id,
           counts: { open: items.filter((x) => x.state === 'REQUESTED' || x.state === 'DOING').length, over: items.filter((x) => x.due === 'OVER').length },
           note: '담당자가 진행 · 완료를 누르고, 요청한 사람이 담당 바꾸기 · 취소 · 다시 열기를 합니다. 끝난 · 취소한 업무는 30일 동안 보입니다. 기한 지난 업무 수는 매일 09:10 운영 알림으로 갑니다.' };
}

async function loadTask(db: DatabaseService, id: string, v: Viewer, lock = false) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('업무 요청이 없습니다.');
  const [r] = await db.query<TaskRow>(`${SELECT} WHERE k.id = $1::bigint${lock ? ' FOR UPDATE OF k' : ''}`, [id]);
  if (!r || !(isSuper(v) || r.requester === v.id || r.assignee === v.id)) throw new NotFound('업무 요청이 없습니다.');   // 남의 업무는 「없음」
  return r;
}

/** GET /admin/office/tasks/{id} — 내용 · 댓글 · 기록 */
export async function taskDetail(db: DatabaseService, id: string, v: Viewer) {
  const r = await loadTask(db, id, v);
  const comments = await db.query(
    `SELECT c.id::text AS id, c.kind, c.body, c.created_at AS "createdAt", coalesce(a.name, a.email) AS author, (c.author = $2::uuid) AS mine
       FROM ofc_task_comments c LEFT JOIN accounts a ON a.id = c.author WHERE c.task_id = $1::bigint ORDER BY c.id LIMIT 300`, [r.id, v.id]);
  return { ...shape(r, v, kstToday()), body: r.body, comments,
           can: { start: r.state === 'REQUESTED' && (r.assignee === v.id || isSuper(v)), done: (r.state === 'REQUESTED' || r.state === 'DOING') && (r.assignee === v.id || isSuper(v)),
                  back: r.state === 'DOING' && (r.assignee === v.id || isSuper(v)), reopen: r.state === 'DONE' && (r.requester === v.id || isSuper(v)),
                  assign: (r.state === 'REQUESTED' || r.state === 'DOING') && (r.requester === v.id || isSuper(v)),
                  cancel: (r.state === 'REQUESTED' || r.state === 'DOING') && (r.requester === v.id || isSuper(v)), comment: r.state !== 'CANCELED' } };
}

export interface TaskInput { title?: string; body?: string | null; assigneeId?: string; dueOn?: string | null; priority?: string }

async function staffOk(db: DatabaseService, id: string) {
  if (!UUID.test(id)) throw new PolicyViolation('OFC_TASK_ASSIGNEE', '담당자를 고르십시오.');
  const [a] = await db.query(`SELECT 1 FROM accounts a WHERE a.id = $1::uuid AND a.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = ANY($2::text[]))`, [id, STAFF_ROLES]);
  if (!a) throw new PolicyViolation('OFC_TASK_ASSIGNEE', '담당자는 운영 계정(쓰는 중)이어야 합니다.');
}

/** POST /admin/office/tasks — 운영자 누구나(나에게 맡겨 할 일로 써도 됨) */
export async function createTask(db: DatabaseService, b: TaskInput, v: Viewer) {
  const title = clean(b.title);
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('OFC_TASK_TITLE', '업무 제목은 2 ~ 100자입니다.');
  const body = b.body ? String(b.body).trim() : '';
  if (body.length > 2000) throw new PolicyViolation('OFC_TASK_BODY', '내용은 2000자까지입니다.');
  const assignee = String(b.assigneeId ?? '').trim() || v.id;
  await staffOk(db, assignee);
  const due = b.dueOn ? String(b.dueOn) : null;
  if (due && !dayOk(due)) throw new PolicyViolation('OFC_TASK_DUE', '기한(YYYY-MM-DD)이 맞지 않습니다.');
  if (due && due < kstToday()) throw new PolicyViolation('OFC_TASK_DUE', '기한은 오늘이나 그 뒤입니다.');
  const priority = (TASK_PRIORITIES as readonly string[]).includes(b.priority ?? '') ? String(b.priority) : 'NORMAL';
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO ofc_tasks (title, body, requester, assignee, priority, due_on) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6::date) RETURNING id::text AS id`,
      [title, body || null, v.id, assignee, priority, due]);
    await db.query(`INSERT INTO ofc_task_comments (task_id, author, kind, body) VALUES ($1::bigint, $2::uuid, 'STATE', $3)`, [r!.id, v.id, '요청함']);
    return { ok: true, id: r!.id, note: assignee === v.id ? '할 일을 넣었습니다.' : '업무를 요청했습니다 — 담당자 화면 「요청」 칸에 보이고, 브라우저 알림을 켠 담당자에게 알림이 갑니다.' };
  });
}

/** POST /admin/office/tasks/{id}/move — to = DOING(진행) · DONE(완료) · REQUESTED(되돌림 · 담당자) · DOING(다시 열기 · 요청한 사람 · 완료에서) */
export async function moveTask(db: DatabaseService, id: string, toIn: string, noteIn: string | undefined, v: Viewer) {
  const to = String(toIn ?? '');
  if (!['REQUESTED', 'DOING', 'DONE'].includes(to)) throw new PolicyViolation('OFC_TASK_MOVE', '옮길 칸(REQUESTED · DOING · DONE)을 고르십시오.');
  const note = clean(noteIn).slice(0, 300);
  return db.transaction(async () => {
    const r = await loadTask(db, id, v, true);
    const sup = isSuper(v), asg = r.assignee === v.id, req = r.requester === v.id;
    if (r.state === to) throw new StateConflict('OFC_TASK_STATE', `이미 「${TASK_STATE_KO[to]}」 칸입니다.`);
    let ok = false;
    if (r.state === 'REQUESTED' && (to === 'DOING' || to === 'DONE')) ok = asg || sup;
    else if (r.state === 'DOING' && (to === 'DONE' || to === 'REQUESTED')) ok = asg || sup;
    else if (r.state === 'DONE' && to === 'DOING') ok = req || sup;
    else throw new StateConflict('OFC_TASK_STATE', `「${TASK_STATE_KO[r.state] ?? r.state}」에서 「${TASK_STATE_KO[to]}」로는 옮길 수 없습니다.`);
    if (!ok) throw new Forbidden('OFC_TASK_WHO', r.state === 'DONE' ? '다시 열기는 요청한 사람이 합니다.' : '진행 · 완료는 담당자가 누릅니다.');
    await db.query(
      `UPDATE ofc_tasks SET state = $2, started_at = CASE WHEN $2 = 'DOING' THEN coalesce(started_at, now()) ELSE started_at END,
              done_at = CASE WHEN $2 = 'DONE' THEN now() ELSE NULL END WHERE id = $1::bigint`, [r.id, to]);
    const label = r.state === 'DONE' ? '다시 엶' : to === 'DOING' ? '진행 시작' : to === 'DONE' ? '완료' : '요청으로 되돌림';
    await db.query(`INSERT INTO ofc_task_comments (task_id, author, kind, body) VALUES ($1::bigint, $2::uuid, 'STATE', $3)`, [r.id, v.id, note ? `${label} · ${note}` : label]);
    return { ok: true, id: r.id, state: to, note: `「${TASK_STATE_KO[to]}」 칸으로 옮겼습니다.` };
  });
}

/** POST /admin/office/tasks/{id}/assign — 요청한 사람 · SUPER · 끝나지 않은 것만 */
export async function assignTask(db: DatabaseService, id: string, assigneeId: string, noteIn: string | undefined, v: Viewer) {
  const to = String(assigneeId ?? '').trim();
  await staffOk(db, to);
  return db.transaction(async () => {
    const r = await loadTask(db, id, v, true);
    if (!(r.requester === v.id || isSuper(v))) throw new Forbidden('OFC_TASK_WHO', '담당 바꾸기는 요청한 사람이 합니다.');
    if (!(r.state === 'REQUESTED' || r.state === 'DOING')) throw new StateConflict('OFC_TASK_STATE', '끝난 · 취소한 업무는 담당을 바꾸지 않습니다.');
    if (r.assignee === to) throw new StateConflict('OFC_TASK_STATE', '이미 그 사람이 담당입니다.');
    const [who] = await db.query<{ name: string }>(`SELECT coalesce(name, email) AS name FROM accounts WHERE id = $1::uuid`, [to]);
    await db.query(`UPDATE ofc_tasks SET assignee = $2::uuid, state = 'REQUESTED', started_at = NULL WHERE id = $1::bigint`, [r.id, to]);
    const note = clean(noteIn).slice(0, 300);
    await db.query(`INSERT INTO ofc_task_comments (task_id, author, kind, body) VALUES ($1::bigint, $2::uuid, 'ASSIGN', $3)`,
      [r.id, v.id, `담당 바꿈 → ${who?.name ?? to}${note ? ` · ${note}` : ''}`]);
    return { ok: true, id: r.id, note: `담당을 ${who?.name ?? ''}(으)로 바꿨습니다 — 「요청」 칸으로 돌아갑니다.` };
  });
}

/** POST /admin/office/tasks/{id}/cancel — 요청한 사람 · SUPER · 사유 */
export async function cancelTask(db: DatabaseService, id: string, reasonIn: string, v: Viewer) {
  const reason = clean(reasonIn);
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('OFC_TASK_REASON', '취소 사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const r = await loadTask(db, id, v, true);
    if (!(r.requester === v.id || isSuper(v))) throw new Forbidden('OFC_TASK_WHO', '취소는 요청한 사람이 합니다.');
    if (!(r.state === 'REQUESTED' || r.state === 'DOING')) throw new StateConflict('OFC_TASK_STATE', '끝난 · 취소한 업무는 취소하지 않습니다.');
    await db.query(`UPDATE ofc_tasks SET state = 'CANCELED', canceled_at = now(), cancel_note = $2 WHERE id = $1::bigint`, [r.id, reason]);
    await db.query(`INSERT INTO ofc_task_comments (task_id, author, kind, body) VALUES ($1::bigint, $2::uuid, 'STATE', $3)`, [r.id, v.id, `취소 · ${reason}`]);
    return { ok: true, id: r.id, note: '업무 요청을 취소했습니다.' };
  });
}

/** POST /admin/office/tasks/{id}/comments — 요청한 사람 · 담당자 · SUPER */
export async function commentTask(db: DatabaseService, id: string, bodyIn: string, v: Viewer) {
  const body = String(bodyIn ?? '').trim();
  if (body.length < 1 || body.length > 1000) throw new PolicyViolation('OFC_TASK_COMMENT', '댓글은 1 ~ 1000자입니다.');
  const r = await loadTask(db, id, v);
  if (r.state === 'CANCELED') throw new StateConflict('OFC_TASK_STATE', '취소한 업무에는 댓글을 달지 않습니다.');
  const [c] = await db.query<{ id: string }>(`INSERT INTO ofc_task_comments (task_id, author, kind, body) VALUES ($1::bigint, $2::uuid, 'COMMENT', $3) RETURNING id::text AS id`, [r.id, v.id, body]);
  return { ok: true, id: r.id, commentId: c!.id, note: '댓글을 달았습니다.' };
}

/** 정기 작업 ofc_task_due(매일 09:10) — 기한 지난 업무 수를 운영 알림 하나로(제목 · 사람 없이 수만) · 0 이거나 꺼지면 풀림 */
export async function ofcTaskDueJob(db: DatabaseService, today = kstToday()) {
  const [s] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'ofc.task_due_alert'`);
  const on = (s?.v ?? 'on') === 'on';
  const [c] = await db.query<{ n: number; people: number }>(
    `SELECT count(*)::int AS n, count(DISTINCT assignee)::int AS people FROM ofc_tasks WHERE state IN ('REQUESTED', 'DOING') AND due_on < $1::date`, [today]);
  const n = c?.n ?? 0;
  const r1 = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2
      WHERE alert_code = 'OFC_TASK_OVERDUE' AND resolved_at IS NULL AND (NOT $3::boolean OR coalesce(detail->>'day', '') <> $1) RETURNING id`,
    [today, on ? '다음 날 · 다시 셈' : '알림 끔', on && n > 0]);
  let made = 0;
  if (on && n > 0) {
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'OFC_TASK_OVERDUE', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'OFC_TASK_OVERDUE' AND detail->>'day' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`기한 지난 업무 요청 ${n}건(담당 ${c?.people ?? 0}명) — 사무 › 업무 요청`, JSON.stringify({ day: today, count: n, people: c?.people ?? 0 }), today]);
    made = ins.length;
  }
  return { on, today, overdue: n, made, resolved: r1.length };
}
