import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { addDays, dayOk, kstToday } from './report-day';

/* ---------------------------------------------------------------------
 * v10.414 (D250 · docs/551) 담당자 업무 일지
 *   운영자 누구나 오늘(한국 날짜) 일지를 씀 — 한 일(꼭) · 할 일 · 막힌 것 · 시간(분).
 *   고치기 · 지우기 없음(덧붙임은 새 줄 · DB 가 막음 WORKLOG_LOCKED · WORKLOG_DATE).
 *   SUPER 는 모두 보고 확인(읽음 · 한 줄 답 · 쌓기만) · 나머지는 자기 것만.
 *   일보 · 주보 · 월보에는 「몇 명 · 몇 건 · 몇 시간 · 확인 몇 건」 숫자만.
 * ------------------------------------------------------------------- */

const clean = (s: unknown, max: number) => { const t = String(s ?? '').replace(/\r\n/g, '\n').trim(); return t ? t.slice(0, max) : null; };

export async function addWorklog(db: DatabaseService, actor: string | null, b: { done?: string; todo?: string; blocked?: string; minutes?: number }) {
  if (!actor) throw new PolicyViolation('WORKLOG_ACTOR', '로그인한 운영자만 씁니다.');
  const done = clean(b.done, 2000);
  if (!done || done.length < 2) throw new PolicyViolation('WORKLOG_DONE', '한 일은 2자 이상 적습니다.');
  const minutes = b.minutes == null ? null : Number(b.minutes);
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) throw new PolicyViolation('WORKLOG_MINUTES', '시간(분)은 0 ~ 1440 입니다.');
  const [r] = await db.query<{ id: string; work_date: string }>(
    `INSERT INTO staff_worklogs (account_id, work_date, done, todo, blocked, minutes)
     VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, $2, $3, $4, $5) RETURNING id::text AS id, work_date::text AS work_date`,
    [actor, done, clean(b.todo, 2000), clean(b.blocked, 1000), minutes]);
  return { ok: true, id: r!.id, workDate: r!.work_date, note: '업무 일지를 남겼습니다 — 오늘 안에 덧붙일 수 있고 고치거나 지우지는 않습니다.' };
}

/** 목록 — SUPER(all) 는 모두 · 나머지는 자기 것 · 기간 최대 31일 */
export async function listWorklogs(db: DatabaseService, q: { from?: string; to?: string; mine?: boolean }, actor: string | null, isSuper: boolean) {
  const to = q.to ? dayOk(q.to) : kstToday();
  const from = q.from ? dayOk(q.from) : addDays(to, -6);
  if (from > to) throw new PolicyViolation('REPORT_PERIOD', '시작일이 끝일보다 늦습니다.');
  if (Date.parse(to) - Date.parse(from) > 31 * 86400e3) throw new PolicyViolation('REPORT_PERIOD', '기간은 31일까지입니다.');
  const all = isSuper && !q.mine;
  const items = await db.query(
    `SELECT w.id::text AS id, w.work_date::text AS "workDate", w.done, w.todo, w.blocked, w.minutes, w.created_at AS "createdAt",
            w.account_id::text AS "accountId", coalesce(a.name, '') AS "staffName", w.account_id = $3::uuid AS mine,
            coalesce((SELECT json_agg(json_build_object('note', r.note, 'createdAt', r.created_at, 'by', coalesce(ra.name, '')) ORDER BY r.id)
                        FROM staff_worklog_reviews r LEFT JOIN accounts ra ON ra.id = r.reviewer_id WHERE r.worklog_id = w.id), '[]'::json) AS reviews
       FROM staff_worklogs w LEFT JOIN accounts a ON a.id = w.account_id
      WHERE w.work_date BETWEEN $1::date AND $2::date AND ($4::boolean OR w.account_id = $3::uuid)
      ORDER BY w.work_date DESC, w.id DESC LIMIT 500`, [from, to, actor, all]);
  const summary = await db.query<{ name: string; entries: number; minutes: number; reviewed: number }>(
    `SELECT coalesce(a.name, '') AS name, count(*)::int AS entries, coalesce(sum(w.minutes), 0)::int AS minutes,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM staff_worklog_reviews r WHERE r.worklog_id = w.id))::int AS reviewed
       FROM staff_worklogs w LEFT JOIN accounts a ON a.id = w.account_id
      WHERE w.work_date BETWEEN $1::date AND $2::date AND ($4::boolean OR w.account_id = $3::uuid)
      GROUP BY a.name ORDER BY 2 DESC, 1 LIMIT 50`, [from, to, actor, all]);
  return { from, to, all, items, summary, canReview: isSuper, today: kstToday(),
           note: '오늘(한국 날짜) 일지만 쓸 수 있고, 지난 일지는 고치지 않습니다. 일보 · 주보 · 월보에는 사람 수 · 건수 · 시간만 들어갑니다.' };
}

/** SUPER 확인 — 읽음 · 한 줄 답(200자) */
export async function reviewWorklog(db: DatabaseService, id: string, note: string | undefined, actor: string | null) {
  if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('없는 업무 일지입니다.');
  const [w] = await db.query(`SELECT 1 FROM staff_worklogs WHERE id = $1::bigint`, [id]);
  if (!w) throw new NotFound('없는 업무 일지입니다.');
  const t = clean(note, 200);
  await db.query(`INSERT INTO staff_worklog_reviews (worklog_id, reviewer_id, note) VALUES ($1::bigint, $2, $3)`, [id, actor, t]);
  return { ok: true, id, note: t ? '확인하고 답을 남겼습니다.' : '확인했습니다.' };
}

/* ---------------------------------------------------------------------
 * v10.414 (D250 · docs/551) 업무 일지 현황판 — 대표 11/19 「업무일지 현황판」(SUPER)
 *   그날(한국 날짜) 운영자마다 쓴 건수 · 시간 · 안 쓴 사람 · 막힌 것(최근 7일) · 확인 안 한 일지 · 최근 7일 작성률.
 *   운영자 = SUPER · ADMIN · PAYOUT · REVIEWER · PARTNER_MAL · PARTNER_AFF 역할이 있는 계정(MEMBER 만인 계정 빼고).
 * ------------------------------------------------------------------- */
export async function worklogBoard(db: DatabaseService, date?: string) {
  const day = date && dayOk(date) ? date : kstToday();
  const from7 = addDays(day, -6);
  const people = await db.query<{ id: string; name: string; email: string; roles: string; n: number; minutes: number; days7: number; unreviewed: number }>(
    `WITH staff AS (SELECT a.id, coalesce(a.name, '') AS name, a.email, string_agg(DISTINCT r.role, ' · ' ORDER BY r.role) AS roles
                      FROM accounts a JOIN account_roles r ON r.account_id = a.id
                     WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF')
                     GROUP BY a.id, a.name, a.email)
     SELECT s.id::text AS id, s.name, s.email, s.roles,
            count(w.id) FILTER (WHERE w.work_date = $1::date)::int AS n,
            coalesce(sum(w.minutes) FILTER (WHERE w.work_date = $1::date), 0)::int AS minutes,
            count(DISTINCT w.work_date) FILTER (WHERE w.work_date BETWEEN $2::date AND $1::date)::int AS days7,
            count(w.id) FILTER (WHERE w.work_date BETWEEN $2::date AND $1::date
                                  AND NOT EXISTS (SELECT 1 FROM staff_worklog_reviews v WHERE v.worklog_id = w.id))::int AS unreviewed
       FROM staff s LEFT JOIN staff_worklogs w ON w.account_id = s.id
      GROUP BY s.id, s.name, s.email, s.roles
      ORDER BY (count(w.id) FILTER (WHERE w.work_date = $1::date) = 0) DESC, s.name, s.email`, [day, from7]);
  const blocked = await db.query(
    `SELECT w.id::text AS id, w.work_date::text AS date, coalesce(a.name, a.email) AS who, w.blocked,
            EXISTS (SELECT 1 FROM staff_worklog_reviews v WHERE v.worklog_id = w.id) AS reviewed
       FROM staff_worklogs w JOIN accounts a ON a.id = w.account_id
      WHERE w.work_date BETWEEN $2::date AND $1::date AND coalesce(btrim(w.blocked), '') <> ''
      ORDER BY w.work_date DESC, w.id DESC LIMIT 30`, [day, from7]);
  const wrote = people.filter((p) => p.n > 0).length;
  return {
    date: day, from7,
    total: { staff: people.length, wrote, missing: people.length - wrote, entries: people.reduce((a, p) => a + p.n, 0), minutes: people.reduce((a, p) => a + p.minutes, 0),
             unreviewed: people.reduce((a, p) => a + p.unreviewed, 0), blocked: blocked.length,
             rate7: people.length ? Math.round((people.reduce((a, p) => a + p.days7, 0) / (people.length * 7)) * 100) : 0 },
    people: people.map((p) => ({ ...p, rate7: Math.round((p.days7 / 7) * 100) })),
    blocked,
    note: '운영자(SUPER · ADMIN · PAYOUT · REVIEWER · 파트너 담당)마다 그날 일지 · 최근 7일 작성률 · 막힌 것 · 확인 안 한 일지입니다. 주말 · 휴일도 7일에 셈합니다.',
  };
}
