import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskMail } from '../../common/mail/mail-admin.service';
import { inquiryNo } from '../public/public.service';
import { clean, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.612 (docs/754) ㉘ 상담원별 답변 품질
 *   v10.337 처리 지표(InquiryAdminService.stats — 전체)를 상담원(처음 답한 운영자)마다 나눔. 셈 근거는 같음:
 *     처음 답 = 감사 기록 INQUIRY_ANSWER 가장 이른 줄(그 줄의 actor_account_id = 상담원) · 기한 안 = 처음 답이 due_at 전
 *     답변 만족도(v10.341 · feedback RESOLVED · UNRESOLVED) · 다시 열림(reopen_count > 0) · 답 고친 횟수(INQUIRY_ANSWER 두 번째부터)
 *   품질 표본 점검(새 · bzx_answer_reviews): 답한 문의에서 아직 점검 안 한 것 몇 건 → 다른 운영자가 정확 · 친절 · 충분 1 ~ 5점 + 메모
 *     자기 답은 점검 못 함(409) · 같은 사람이 같은 문의 두 번 못 함 · 쌓기만
 *   「살펴볼 상담원」 표시만(자동 조치 없음): 만족도 남긴 것 5건 이상인데 해결률 50% 미만 · 점검 3건 이상인데 평균 3점 미만
 *   이름 대신 가린 메일 · 문의 본문 · 회원 정보 없음(점검 한 건은 운영 「1:1 문의」로 열어 봄)
 * ------------------------------------------------------------------- */

const FIRST = `SELECT DISTINCT ON (l.target_id) l.target_id AS inquiry_id, l.actor_account_id AS agent, l.occurred_at AS first_at
                 FROM audit.audit_logs l WHERE l.action = 'INQUIRY_ANSWER' AND l.target_id IS NOT NULL
                ORDER BY l.target_id, l.occurred_at`;

/** GET /admin/bzx/cs-quality?days= */
export async function csQuality(db: DatabaseService, daysIn?: number) {
  const days = Math.max(7, Math.min(180, Math.floor(Number(daysIn) || 30)));
  const rows = await db.query<{ agent: string; email: string | null; answered: number; edits: number; avgHours: number | null; inTime: number;
    resolved: number; unresolved: number; reopened: number; reviews: number; score: number | null }>(
    `WITH f AS (${FIRST}),
          w AS (SELECT i.id, i.created_at, i.due_at, i.feedback, i.reopen_count, f.agent, f.first_at
                  FROM inquiries i JOIN f ON f.inquiry_id = i.id WHERE i.created_at > now() - make_interval(days => $1::int)),
          e AS (SELECT l.actor_account_id AS agent, count(*)::int AS n FROM audit.audit_logs l
                 WHERE l.action = 'INQUIRY_ANSWER' AND l.occurred_at > now() - make_interval(days => $1::int) GROUP BY 1),
          r AS (SELECT agent_id AS agent, count(*)::int AS n, avg((accuracy + kindness + completeness) / 3.0) AS s
                  FROM bzx_answer_reviews WHERE created_at > now() - make_interval(days => $1::int) GROUP BY 1)
     SELECT w.agent::text AS agent, a.email::text AS email, count(*)::int AS answered,
            greatest(coalesce(max(e.n), 0) - count(*), 0)::int AS edits,
            round((avg(extract(epoch FROM w.first_at - w.created_at)) / 3600)::numeric, 1)::float AS "avgHours",
            count(*) FILTER (WHERE w.due_at IS NULL OR w.first_at <= w.due_at)::int AS "inTime",
            count(*) FILTER (WHERE w.feedback = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE w.feedback = 'UNRESOLVED')::int AS unresolved,
            count(*) FILTER (WHERE w.reopen_count > 0)::int AS reopened,
            coalesce(max(r.n), 0)::int AS reviews, round(max(r.s)::numeric, 2)::float AS score
       FROM w LEFT JOIN accounts a ON a.id = w.agent LEFT JOIN e ON e.agent = w.agent LEFT JOIN r ON r.agent = w.agent
      GROUP BY w.agent, a.email ORDER BY count(*) DESC`, [days]);
  const agents = rows.map((x) => {
    const fb = x.resolved + x.unresolved;
    const resolvedRate = fb ? Math.round((x.resolved / fb) * 1000) / 10 : null;
    const watch: string[] = [];
    if (fb >= 5 && resolvedRate !== null && resolvedRate < 50) watch.push('해결률 낮음');
    if (x.reviews >= 3 && x.score !== null && x.score < 3) watch.push('점검 점수 낮음');
    return { agent: x.agent, email: maskMail(x.email), answered: x.answered, edits: x.edits, avgHours: x.avgHours,
      inTimeRate: x.answered ? Math.round((x.inTime / x.answered) * 1000) / 10 : null, resolved: x.resolved, unresolved: x.unresolved, resolvedRate,
      reopenRate: x.answered ? Math.round((x.reopened / x.answered) * 1000) / 10 : null, reviews: x.reviews, score: x.score, watch };
  });
  return { days, agents,
    note: '상담원은 그 문의에 처음 답한 운영자(감사 기록 INQUIRY_ANSWER). 시간은 접수부터 처음 답까지. 만족도는 회원이 남긴 것만. 「살펴볼 상담원」은 표시만 하고 아무것도 바꾸지 않습니다.' };
}

/** GET /admin/bzx/cs-quality/samples?agent= — 아직 내가 점검 안 한 · 남이 답한 최근 문의 5건(본문 없음 · 번호 · 제목 · 상태) */
export async function csSamples(db: DatabaseService, actor: string | null, agent?: string) {
  if (agent && !UUID_RE.test(agent)) throw new PolicyViolation('BZX_CSQ', '상담원 번호가 맞지 않습니다.');
  const rows = await db.query<{ id: string; createdAt: Date; title: string; status: string; feedback: string | null; agent: string; email: string | null; answeredAt: string }>(
    `WITH f AS (${FIRST})
     SELECT i.id::text AS id, i.created_at AS "createdAt", i.title, i.status, i.feedback, f.agent::text AS agent, a.email::text AS email, i.answered_at AS "answeredAt"
       FROM inquiries i JOIN f ON f.inquiry_id = i.id LEFT JOIN accounts a ON a.id = f.agent
      WHERE i.answer IS NOT NULL AND f.agent IS DISTINCT FROM $1::uuid AND ($2::uuid IS NULL OR f.agent = $2::uuid)
        AND NOT EXISTS (SELECT 1 FROM bzx_answer_reviews r WHERE r.inquiry_id = i.id AND r.reviewer_id = $1::uuid)
        AND i.answered_at > now() - interval '90 days'
      ORDER BY i.answered_at DESC LIMIT 5`, [actor, agent || null]);
  return { items: rows.map((r) => ({ ...r, no: inquiryNo(r.id, r.createdAt), email: maskMail(r.email) })) };
}

export interface CsReviewInput { inquiryId: string; accuracy: number; kindness: number; completeness: number; note?: string }

/** POST /admin/bzx/cs-quality/reviews — 표본 점검 한 줄(쌓기만) */
export async function csReview(db: DatabaseService, actor: string | null, b: CsReviewInput) {
  if (!actor) throw new NotFound('그 문의가 없습니다.');
  if (!UUID_RE.test(b.inquiryId ?? '')) throw new NotFound('그 문의가 없습니다.');
  for (const k of ['accuracy', 'kindness', 'completeness'] as const) {
    const v = Number(b[k]);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new PolicyViolation('BZX_CSQ_SCORE', '점수는 1 ~ 5 입니다.');
  }
  const [f] = await db.query<{ agent: string | null; answered: boolean }>(
    `SELECT (SELECT l.actor_account_id::text FROM audit.audit_logs l WHERE l.action = 'INQUIRY_ANSWER' AND l.target_id = i.id ORDER BY l.occurred_at LIMIT 1) AS agent,
            (i.answer IS NOT NULL) AS answered FROM inquiries i WHERE i.id = $1::uuid`, [b.inquiryId]);
  if (!f) throw new NotFound('그 문의가 없습니다.');
  if (!f.answered || !f.agent) throw new StateConflict('BZX_CSQ_NO_ANSWER', '답한 문의만 점검합니다.');
  if (f.agent === actor) throw new StateConflict('BZX_CSQ_SELF', '자기 답변은 점검하지 않습니다 — 다른 운영자가 점검합니다.');
  const r = await db.query<{ id: string }>(
    `INSERT INTO bzx_answer_reviews (inquiry_id, agent_id, reviewer_id, accuracy, kindness, completeness, note)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::int, $6::int, $7) ON CONFLICT (inquiry_id, reviewer_id) DO NOTHING RETURNING id::text AS id`,
    [b.inquiryId, f.agent, actor, b.accuracy, b.kindness, b.completeness, clean(b.note, 300) || null]);
  if (!r.length) throw new StateConflict('BZX_CSQ_DONE', '이미 점검한 문의입니다.');
  return { ok: true, id: r[0]!.id, note: '점검을 남겼습니다.' };
}
