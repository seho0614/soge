import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { mtrAlertOnce, mtrAlertResolve, mtrSettings, mtrText, MTR_UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.573 (docs/715) 신고 → 이의 제기 — 스위치 mtr.appeal(처음 꺼짐)
 *   ① 대상 — 신고 때문에 내려간 내 것만:
 *      매물(LISTING)  상태 반려(REJECTED) · 정지(SUSPENDED) 이고 그 매물에 인정(UPHELD) · 검수 대기(QUEUED) 신고가 있음
 *      글(POST)       감춤(HIDDEN)이고 그 글에 신고가 있음(신고 3건 자동 가림 · 운영 감춤)
 *      댓글(COMMENT)  감춤(HIDDEN)이고 그 댓글에 신고가 있음
 *   ② 작성자는 사유(신고 사유 이름 · 건수 · 운영이 적은 처리 내용 · 글 감춘 사유)를 봄 — 신고한 사람은 보이지 않음
 *   ③ 대상마다 한 번(DB 고유 색인) · 내려간 뒤 mtr.appeal_days(30)일 안 · 글 10 ~ 1000자
 *   ④ 운영 재판단 — 기한 mtr.appeal_sla_hours(72)시간 · 넘으면 운영 알림 MTR_APPEAL_OVERDUE(매시간 mtr_hourly)
 *      받아들임: 글 · 댓글은 다시 보이게(신고 수 0) · 매물은 검수 대기(IN_REVIEW + 검수 큐 — 게시 조건(중개사 · 자리 수 등)은 검수가 봄)
 *                그 대상의 열린 · 인정 신고를 기각으로 닫고 신고한 사람에게 결과 알림(신고 처리 · 글 되살리기와 같은 알림)
 *      받아들이지 않음: 그대로 · 사유는 작성자에게
 *      둘 다 작성자에게 사이트 알림 MTR_APPEAL_DECIDED · 감사(MTR_APPEAL_DECIDE)
 * ------------------------------------------------------------------- */

export const APPEAL_TARGETS = ['LISTING', 'POST', 'COMMENT'] as const;
export const APPEAL_STATES = ['OPEN', 'ACCEPTED', 'REJECTED'] as const;
export const APPEAL_BODY_MIN = 10;
export const APPEAL_BODY_MAX = 1000;

interface DownItem {
  targetType: string; targetId: string; title: string; targetState: string; downAt: Date | string | null;
  reasons: Array<{ reasonCode: string; label: string | null; n: number }>;
  resolutions: string[]; hiddenReason: string | null;
}

/** 내려간 내 대상(최근 180일 · 많아야 100) — SQL 하나로 세 종류 */
async function downItems(db: DatabaseService, me: string, one?: { type: string; id: string }): Promise<DownItem[]> {
  const rows = await db.query<{ target_type: string; target_id: string; title: string; target_state: string; down_at: Date | string | null; hidden_reason: string | null }>(
    `WITH mine AS (
       SELECT 'LISTING'::text AS target_type, l.id AS target_id, coalesce(l.title, '') AS title, l.status AS target_state, NULL::text AS hidden_reason
         FROM listings l
        WHERE l.owner_account_id = $1 AND l.status IN ('REJECTED', 'SUSPENDED')
          AND EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'LISTING' AND r.target_id = l.id AND r.state IN ('UPHELD', 'QUEUED'))
       UNION ALL
       SELECT 'POST', p.id, p.title, p.state, p.hidden_reason
         FROM posts p
        WHERE p.author_id = $1 AND p.state = 'HIDDEN'
          AND EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'POST' AND r.target_id = p.id)
       UNION ALL
       SELECT 'COMMENT', c.id, left(c.body, 80), c.state, NULL
         FROM post_comments c
        WHERE c.author_id = $1 AND c.state = 'HIDDEN'
          AND EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'COMMENT' AND r.target_id = c.id))
     SELECT m.target_type, m.target_id::text AS target_id, m.title, m.target_state, m.hidden_reason,
            (SELECT greatest(max(r.handled_at), max(r.created_at)) FROM reports r WHERE r.target_type = m.target_type AND r.target_id = m.target_id) AS down_at
       FROM mine m
      WHERE ($2::text IS NULL OR (m.target_type = $2::text AND m.target_id = $3::uuid))
      ORDER BY 6 DESC NULLS LAST
      LIMIT 100`, [me, one?.type ?? null, one?.id ?? null]);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.target_id);
  const reasons = await db.query<{ target_id: string; reason_code: string; label: string | null; n: number }>(
    `SELECT r.target_id::text AS target_id, r.reason_code, rr.label, count(*)::int AS n
       FROM reports r LEFT JOIN report_reasons rr ON rr.code = r.reason_code
      WHERE r.target_id = ANY($1::uuid[]) AND r.state IN ('OPEN', 'QUEUED', 'UPHELD')
      GROUP BY r.target_id, r.reason_code, rr.label ORDER BY count(*) DESC`, [ids]);
  const res = await db.query<{ target_id: string; resolution: string }>(
    `SELECT DISTINCT r.target_id::text AS target_id, r.resolution
       FROM reports r WHERE r.target_id = ANY($1::uuid[]) AND r.state = 'UPHELD' AND coalesce(btrim(r.resolution), '') <> ''`, [ids]);
  return rows
    .filter((r) => r.down_at !== null)
    .map((r) => ({
      targetType: r.target_type, targetId: r.target_id, title: r.title, targetState: r.target_state, downAt: r.down_at,
      reasons: reasons.filter((x) => x.target_id === r.target_id).map((x) => ({ reasonCode: x.reason_code, label: x.label, n: Number(x.n) })),
      resolutions: res.filter((x) => x.target_id === r.target_id).map((x) => x.resolution).slice(0, 5),
      hiddenReason: r.hidden_reason,
    }));
}

/** GET /me/mtr/appeals — 내려간 내 것 · 이의 낼 수 있는지 · 낸 이의와 결과 */
export async function myAppeals(db: DatabaseService, me: string) {
  const s = await mtrSettings(db);
  const items = await downItems(db, me);
  const mine = await db.query<{ id: string; target_type: string; target_id: string; state: string; body: string; due_at: Date; decision_note: string | null; decided_at: Date | null; restored: string | null; created_at: Date }>(
    `SELECT id::text, target_type, target_id::text, state, body, due_at, decision_note, decided_at, restored, created_at
       FROM mtr_appeals WHERE author_id = $1 ORDER BY created_at DESC LIMIT 100`, [me]);
  const now = Date.now();
  const byKey = new Map(mine.map((a) => [`${a.target_type}:${a.target_id}`, a]));
  const down = items.map((it) => {
    const a = byKey.get(`${it.targetType}:${it.targetId}`);
    const until = it.downAt ? new Date(new Date(it.downAt).getTime() + s.appealDays * 86_400_000) : null;
    return {
      ...it, appealUntil: until ? until.toISOString() : null,
      canAppeal: s.appeal && !a && !!until && until.getTime() > now,
      appeal: a ? { id: a.id, state: a.state, createdAt: a.created_at, dueAt: a.due_at, decisionNote: a.decision_note, decidedAt: a.decided_at, restored: a.restored } : null,
    };
  });
  /* 내려간 목록에서 빠진(받아들여 다시 올라간) 이의도 결과를 보여 줌 */
  const shown = new Set(down.filter((d) => d.appeal).map((d) => d.appeal!.id));
  const past = mine.filter((a) => !shown.has(a.id)).map((a) => ({
    id: a.id, targetType: a.target_type, targetId: a.target_id, state: a.state, createdAt: a.created_at, dueAt: a.due_at,
    decisionNote: a.decision_note, decidedAt: a.decided_at, restored: a.restored,
  }));
  return {
    on: s.appeal, appealDays: s.appealDays, slaHours: s.appealSlaHours, bodyMin: APPEAL_BODY_MIN, bodyMax: APPEAL_BODY_MAX, down, past,
    note: s.appeal ? '신고로 내려간 내 매물 · 글 · 댓글입니다. 대상마다 한 번 이의를 낼 수 있고, 운영자가 다시 판단합니다.' : '지금은 이의 제기를 받지 않습니다.',
  };
}

/** POST /me/mtr/appeals — 이의 내기 */
export async function createAppeal(db: DatabaseService, me: string, d: { targetType: string; targetId: string; body: string }) {
  const s = await mtrSettings(db);
  if (!s.appeal) throw new PolicyViolation('MTR_APPEAL_OFF', '지금은 이의 제기를 받지 않습니다.');
  if (!(APPEAL_TARGETS as readonly string[]).includes(d.targetType)) throw new PolicyViolation('MTR_APPEAL_TARGET', '이의를 낼 수 없는 대상입니다.');
  if (!MTR_UUID_RE.test(String(d.targetId ?? ''))) throw new NotFound('대상을 찾을 수 없습니다.');
  const body = mtrText(d.body, APPEAL_BODY_MIN, APPEAL_BODY_MAX, 'MTR_APPEAL_BODY', '이의 내용을 10 ~ 1000자로 적어 주십시오.');
  const [it] = await downItems(db, me, { type: d.targetType, id: d.targetId });
  if (!it) throw new NotFound('신고로 내려간 내 대상이 아닙니다.');
  const until = it.downAt ? new Date(it.downAt).getTime() + s.appealDays * 86_400_000 : 0;
  if (until <= Date.now()) throw new PolicyViolation('MTR_APPEAL_LATE', '이의를 낼 수 있는 기간이 지났습니다.');
  const reasons = it.reasons.map((r) => ({ reasonCode: r.reasonCode, label: r.label, n: r.n }));
  const rows = await db.query<{ id: string; due_at: Date }>(
    `INSERT INTO mtr_appeals (target_type, target_id, author_id, body, target_state, reasons, due_at)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::jsonb, now() + make_interval(hours => $7::int))
     ON CONFLICT (target_type, target_id) DO NOTHING RETURNING id::text, due_at`,
    [d.targetType, d.targetId, me, body, it.targetState, JSON.stringify(reasons), s.appealSlaHours]);
  if (!rows.length) throw new StateConflict('MTR_APPEAL_DONE', '이 대상에는 이미 이의를 냈습니다(한 번만).');
  return { ok: true, id: rows[0]!.id, dueAt: rows[0]!.due_at, note: '이의를 냈습니다. 운영자가 다시 판단해 결과를 알려 드립니다.' };
}

/* ── 운영 ── */
export async function appealList(db: DatabaseService, stateIn?: string) {
  const state = (APPEAL_STATES as readonly string[]).includes(String(stateIn ?? '')) ? String(stateIn) : 'OPEN';
  const s = await mtrSettings(db);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT a.id::text, a.target_type AS "targetType", a.target_id::text AS "targetId", a.body, a.target_state AS "targetState", a.reasons,
            a.state, a.due_at AS "dueAt", (a.state = 'OPEN' AND a.due_at < now()) AS overdue, a.created_at AS "createdAt",
            a.decision_note AS "decisionNote", a.decided_at AS "decidedAt", a.restored, a.dismissed_reports AS "dismissedReports",
            left(coalesce(au.name, ''), 1) || '*' AS "authorHead",
            CASE a.target_type WHEN 'LISTING' THEN (SELECT l.title FROM listings l WHERE l.id = a.target_id)
                               WHEN 'POST' THEN (SELECT p.title FROM posts p WHERE p.id = a.target_id)
                               ELSE (SELECT left(c.body, 120) FROM post_comments c WHERE c.id = a.target_id) END AS "targetTitle",
            CASE a.target_type WHEN 'LISTING' THEN (SELECT l.status FROM listings l WHERE l.id = a.target_id)
                               WHEN 'POST' THEN (SELECT p.state FROM posts p WHERE p.id = a.target_id)
                               ELSE (SELECT c.state FROM post_comments c WHERE c.id = a.target_id) END AS "targetNow",
            (SELECT p.hidden_reason FROM posts p WHERE a.target_type = 'POST' AND p.id = a.target_id) AS "hiddenReason",
            (SELECT coalesce(jsonb_agg(jsonb_build_object('reasonCode', r.reason_code, 'label', rr.label, 'state', r.state, 'detail', left(coalesce(r.detail, ''), 200),
                                                          'resolution', r.resolution, 'createdAt', r.created_at) ORDER BY r.created_at), '[]'::jsonb)
               FROM reports r LEFT JOIN report_reasons rr ON rr.code = r.reason_code
              WHERE r.target_type = a.target_type AND r.target_id = a.target_id) AS reports
       FROM mtr_appeals a JOIN accounts au ON au.id = a.author_id
      WHERE a.state = $1
      ORDER BY CASE WHEN a.state = 'OPEN' THEN a.due_at END ASC NULLS LAST, a.decided_at DESC NULLS LAST, a.id DESC
      LIMIT 200`, [state]);
  const [c] = await db.query<{ open: number; overdue: number; accepted: number; rejected: number }>(
    `SELECT count(*) FILTER (WHERE state = 'OPEN')::int AS open, count(*) FILTER (WHERE state = 'OPEN' AND due_at < now())::int AS overdue,
            count(*) FILTER (WHERE state = 'ACCEPTED' AND decided_at > now() - interval '30 days')::int AS accepted,
            count(*) FILTER (WHERE state = 'REJECTED' AND decided_at > now() - interval '30 days')::int AS rejected
       FROM mtr_appeals`);
  return { state, on: s.appeal, appealDays: s.appealDays, slaHours: s.appealSlaHours, counts: c ?? { open: 0, overdue: 0, accepted: 0, rejected: 0 }, rows };
}

const ACCEPT_RES = '작성자의 이의 제기를 운영자가 받아들여 다시 올렸습니다 — ';

/** POST /admin/mtr/appeals/{id}/decide — 받아들임 · 받아들이지 않음 + 사유(작성자에게 보임) */
export async function decideAppeal(db: DatabaseService, actorId: string, id: number, d: { accept: boolean; note: string }) {
  if (typeof d.accept !== 'boolean') throw new PolicyViolation('MTR_APPEAL_DECIDE', '받아들일지 정해 주십시오.');
  /* 알림 글에 { } 가 있으면 알림 트리거(fn_assert_no_unresolved_vars)가 막음 — 빼고 씀 */
  const note = mtrText(String(d.note ?? '').replace(/[{}]/g, ''), 2, 500, 'MTR_APPEAL_NOTE', '사유를 2 ~ 500자로 적어 주십시오. 작성자에게 보입니다.');
  return db.transaction(async () => {
    const [a] = await db.query<{ id: string; target_type: string; target_id: string; author_id: string; state: string }>(
      `SELECT id::text, target_type, target_id::text, author_id::text, state FROM mtr_appeals WHERE id = $1 FOR UPDATE`, [id]);
    if (!a) throw new NotFound('이의 제기를 찾을 수 없습니다.');
    if (a.state !== 'OPEN') throw new StateConflict('MTR_APPEAL_STATE', '이미 결정한 이의 제기입니다.');
    let restored: string | null = null;
    let dismissed = 0;
    if (d.accept) {
      if (a.target_type === 'POST') {
        const r = await db.query(
          `UPDATE posts SET state = 'PUBLISHED', hidden_at = NULL, hidden_reason = NULL, report_count = 0, updated_at = now()
            WHERE id = $1::uuid AND state = 'HIDDEN' RETURNING id`, [a.target_id]);
        if (!r.length) throw new StateConflict('MTR_APPEAL_TARGET_GONE', '대상이 이미 바뀌었거나 작성자가 지웠습니다.');
        restored = 'PUBLISHED';
      } else if (a.target_type === 'COMMENT') {
        const r = await db.query(
          `UPDATE post_comments SET state = 'PUBLISHED', hidden_at = NULL, report_count = 0
            WHERE id = $1::uuid AND state = 'HIDDEN' RETURNING id`, [a.target_id]);
        if (!r.length) throw new StateConflict('MTR_APPEAL_TARGET_GONE', '대상이 이미 바뀌었거나 작성자가 지웠습니다.');
        restored = 'PUBLISHED';
      } else {
        /* 매물 — 바로 게시하지 않고 검수 대기로(게시 조건 트리거 · 중개사 · 자리 수는 검수 승인 때 봄) */
        const [l] = await db.query<{ gwan_code: string | null; owner: string }>(
          `UPDATE listings SET status = 'IN_REVIEW' WHERE id = $1::uuid AND status IN ('REJECTED', 'SUSPENDED')
           RETURNING gwan_code, owner_account_id::text AS owner`, [a.target_id]);
        if (!l) throw new StateConflict('MTR_APPEAL_TARGET_GONE', '대상이 이미 바뀌었거나 작성자가 지웠습니다.');
        await db.query(
          `INSERT INTO review_items (target_type, target_id, gwan_code, submitted_by, status, decision_mode, sla_due_at, manual_reasons)
           SELECT 'LISTING', $1::uuid, coalesce($2::text, 'MNY'), $3::uuid, 'QUEUED', 'MANUAL', fn_review_sla_due(now(), 24), ARRAY['이의 제기 받아들임']
            WHERE NOT EXISTS (SELECT 1 FROM review_items ri WHERE ri.target_id = $1::uuid AND ri.status IN ('QUEUED', 'IN_PROGRESS'))`,
          [a.target_id, l.gwan_code, l.owner]);
        restored = 'IN_REVIEW';
      }
      const res = `${ACCEPT_RES}${note}`.slice(0, 500);
      const closed = await db.query<{ reporter_id: string | null }>(
        `UPDATE reports SET state = 'DISMISSED', resolution = $3, handled_by = $4::uuid, handled_at = now()
          WHERE target_type = $1 AND target_id = $2::uuid AND state IN ('OPEN', 'QUEUED', 'UPHELD')
          RETURNING reporter_id::text`, [a.target_type, a.target_id, res, actorId]);
      dismissed = closed.length;
      const reporters = [...new Set(closed.map((c) => c.reporter_id).filter((x): x is string => !!x))];
      if (reporters.length) {
        await db.query(
          `INSERT INTO notifications (account_id, event_code, title, body, link_url)
           SELECT x, 'REPORT_RESOLVED', '신고 처리 결과를 알려 드립니다', $2, '/my/reports' FROM unnest($1::uuid[]) AS x
           ON CONFLICT DO NOTHING`, [reporters, res]);
      }
    }
    await db.query(
      `UPDATE mtr_appeals SET state = $2, decided_by = $3::uuid, decided_at = now(), decision_note = $4, restored = $5, dismissed_reports = $6::int
        WHERE id = $1`, [id, d.accept ? 'ACCEPTED' : 'REJECTED', actorId, note, restored, dismissed]);
    await db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       VALUES ($1::uuid, 'MTR_APPEAL_DECIDED', $2, $3, '/my/appeals') ON CONFLICT DO NOTHING`,
      [a.author_id, d.accept ? '이의 제기를 받아들였습니다' : '이의 제기 결과를 알려 드립니다',
       d.accept ? (restored === 'IN_REVIEW' ? `매물을 검수 대기로 돌렸습니다. 검수를 마치면 다시 보입니다. 운영자 의견: ${note}` : `다시 보이게 했습니다. 운영자 의견: ${note}`)
                : `내려간 상태를 그대로 둡니다. 운영자 의견: ${note}`]);
    return { ok: true, id, state: d.accept ? 'ACCEPTED' : 'REJECTED', restored, dismissedReports: dismissed,
             note: d.accept ? '받아들였습니다. 작성자 · 신고한 사람에게 알렸습니다.' : '받아들이지 않았습니다. 작성자에게 사유를 알렸습니다.' };
  });
}

/** 매시간 — 기한 넘긴 열린 이의가 있으면 운영 알림 하나 · 다 처리되면 풂(꺼져 있어도 열린 이의는 봄) */
export async function appealOverdueJob(db: DatabaseService) {
  const [r] = await db.query<{ n: number; oldest: string | null }>(
    `SELECT count(*)::int AS n, min(due_at)::text AS oldest FROM mtr_appeals WHERE state = 'OPEN' AND due_at < now()`);
  const n = Number(r?.n ?? 0);
  if (n > 0) {
    await mtrAlertOnce(db, 'MTR_APPEAL_OVERDUE', 'WARN', `이의 제기 ${n}건이 처리 기한을 넘겼습니다(위험감지 › 이의 제기)`, { overdue: n, oldest: r?.oldest ?? null });
    await db.query(`UPDATE mtr_appeals SET overdue_alerted_at = now() WHERE state = 'OPEN' AND due_at < now() AND overdue_alerted_at IS NULL`);
  } else await mtrAlertResolve(db, 'MTR_APPEAL_OVERDUE', '기한 넘긴 이의 제기 없음');
  return { overdue: n };
}
