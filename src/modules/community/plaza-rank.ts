import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.507 (D274 · docs/645) 소개광장 활동 배지 · 랭킹 — 대표 11/20 「㊹ ③」
 *   점수(한국 시각 달): 공개 글 × plaza.score_post(3) + 질문 글 답변 × score_answer(2) + 그 밖 댓글 × score_comment(1) + 받은 도움돼요 × score_helpful(2)
 *     · 빼는 것: 숨김 · 지운 글 · 댓글 · 처리 중이거나 받아들여진 신고가 있는 글 · 댓글 · 공지 · 운영 역할 계정 · 하루 plaza.daily_cap 넘는 글 · 댓글
 *     · DB 함수 fn_plz_month_scores 가 그 달을 통째로 다시 셈(정기 작업 plz_badge_month 매일 03:30 · 운영 「다시 셈」)
 *   랭킹: 공개(로그인 없이) — 노출을 끈 회원(plz_rank_prefs.hide_rank) 빼고 순위 · 이름 가림(fn_mask_name) · plaza.rank_size 명
 *   배지: 달이 끝나면 한 번(fn_plz_month_close · plaza.ranking on 일 때) — TOP1 · TOP3 · TOP10 · 도움왕 · 답변왕 · 꾸준한 글쓴이 · 회원 알림 PLZ_BADGE
 *   도움돼요: 글 · 댓글마다 회원 한 번 · 다시 누르면 취소 · 자기 것 안 됨 · 공개 글만(DB 트리거)
 *   스위치 plaza.ranking(처음 off) — 꺼져 있으면 랭킹 · 도움돼요 · 배지 모두 화면에 없음(점수 셈은 정기 작업이 미리 해 둠)
 * ------------------------------------------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PLZ_TARGETS = ['POST', 'COMMENT'] as const;
export const BADGE_KO: Record<string, string> = { TOP1: '이달의 1위', TOP3: '이달의 3위 안', TOP10: '이달의 10위 안', HELPER: '도움왕', ANSWERER: '답변왕', WRITER: '꾸준한 글쓴이' };
const kstMonth = (add = 0) => {
  const d = new Date(Date.now() + 9 * 3600e3);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
  return m.toISOString().slice(0, 10);
};
/** 'YYYY-MM' → 그 달 1일 · 없으면 이번 달 · 틀리면 422 */
function monthOf(v?: string) {
  if (!v) return kstMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new PolicyViolation('PLZ_MONTH', '달은 2026-11 처럼 줍니다.');
  return `${v}-01`;
}
async function on(db: DatabaseService) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'plaza.ranking'`);
  return r?.v === 'on';
}

/** GET /community/ranking — 공개 랭킹(노출 끈 회원 빼고 · 이름 가림 · 그 달 배지) */
export async function publicRanking(db: DatabaseService, month?: string) {
  const m = monthOf(month);
  if (!(await on(db))) return { on: false, month: m.slice(0, 7), items: [] };
  const [s] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'plaza.rank_size'`);
  const size = Math.min(100, Math.max(3, n(s?.v ?? 20)));
  const items = await db.query(
    `SELECT row_number() OVER (ORDER BY x.score DESC, x.helpful DESC, x.answers DESC, x.account_id)::int AS rank, fn_mask_name(a.name) AS name,
            x.score, x.posts, x.answers, x.comments, x.helpful,
            coalesce((SELECT array_agg(b.badge ORDER BY b.badge) FROM plz_badges b WHERE b.month = x.month AND b.account_id = x.account_id AND b.revoked_at IS NULL), '{}') AS badges
       FROM plz_month_scores x JOIN accounts a ON a.id = x.account_id
      WHERE x.month = $1::date AND x.score > 0 AND NOT coalesce((SELECT p.hide_rank FROM plz_rank_prefs p WHERE p.account_id = x.account_id), false)
      ORDER BY x.score DESC, x.helpful DESC, x.answers DESC, x.account_id LIMIT $2::int`, [m, size]);
  const [c] = await db.query<{ at: string | null; closed: boolean }>(
    `SELECT max(computed_at) AS at, EXISTS (SELECT 1 FROM plz_month_closes WHERE month = $1::date) AS closed FROM plz_month_scores WHERE month = $1::date`, [m]);
  return { on: true, month: m.slice(0, 7), computedAt: c?.at ?? null, closed: !!c?.closed, items, badgeNames: BADGE_KO,
    note: '매일 새벽에 다시 셉니다. 숨김 · 신고된 글과 댓글은 셈에서 빠집니다.' };
}

/** GET /community/posts/{id}/helpful — 글 · 그 댓글의 도움돼요 수 · 내가 누른 것(로그인일 때) */
export async function helpfulCounts(db: DatabaseService, postId: string, me: string | null) {
  if (!(await on(db))) return { on: false, post: 0, comments: {}, mine: [] };
  if (!UUID.test(String(postId ?? ''))) throw new NotFound('없는 글입니다.');
  const rows = await db.query<{ target_type: string; target_id: string; n: number; mine: boolean }>(
    `SELECT v.target_type, v.target_id::text AS target_id, count(*)::int AS n, bool_or(v.voter_id = $2::uuid) AS mine
       FROM plz_helpful_votes v
      WHERE (v.target_type = 'POST' AND v.target_id = $1::uuid)
         OR (v.target_type = 'COMMENT' AND v.target_id IN (SELECT c.id FROM post_comments c WHERE c.post_id = $1::uuid))
      GROUP BY v.target_type, v.target_id`, [postId, me]);
  const post = rows.find((r) => r.target_type === 'POST');
  return {
    on: true, loggedIn: !!me, post: n(post?.n),
    comments: Object.fromEntries(rows.filter((r) => r.target_type === 'COMMENT').map((r) => [r.target_id, n(r.n)])),
    mine: rows.filter((r) => r.mine).map((r) => `${r.target_type}:${r.target_id}`),
  };
}

/** POST /me/community/helpful — 누르기 · 다시 누르면 취소 */
export async function toggleHelpful(db: DatabaseService, me: string, dto: { targetType: string; targetId: string }) {
  if (!(await on(db))) throw new PolicyViolation('PLZ_RANK_OFF', '지금은 도움돼요를 받지 않습니다.');
  if (!(PLZ_TARGETS as readonly string[]).includes(dto.targetType) || !UUID.test(String(dto.targetId ?? ''))) throw new NotFound('없는 글 · 댓글입니다.');
  const del = await db.query(`DELETE FROM plz_helpful_votes WHERE target_type = $1 AND target_id = $2::uuid AND voter_id = $3::uuid RETURNING id`, [dto.targetType, dto.targetId, me]);
  if (!del.length) {
    await db.query(`INSERT INTO plz_helpful_votes (target_type, target_id, voter_id) VALUES ($1, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`, [dto.targetType, dto.targetId, me]);
  }
  const [c] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM plz_helpful_votes WHERE target_type = $1 AND target_id = $2::uuid`, [dto.targetType, dto.targetId]);
  return { on: !del.length, count: n(c?.n) };
}

/** GET /me/community/activity — 이번 달 내 점수 · 내 순위(노출을 껐으면 모든 회원 가운데 · 표시만) · 내 배지 · 노출 설정 */
export async function myActivity(db: DatabaseService, me: string) {
  const m = kstMonth();
  const [s] = await db.query<{ posts: number; answers: number; comments: number; helpful: number; score: number; computed_at: string }>(
    `SELECT posts, answers, comments, helpful, score, computed_at FROM plz_month_scores WHERE month = $1::date AND account_id = $2::uuid`, [m, me]);
  const [p] = await db.query<{ hide: boolean }>(`SELECT hide_rank AS hide FROM plz_rank_prefs WHERE account_id = $1::uuid`, [me]);
  const hide = !!p?.hide;
  const [r] = await db.query<{ rk: number | null }>(
    `SELECT CASE WHEN x.score IS NULL THEN NULL ELSE 1 + (SELECT count(*)::int FROM plz_month_scores y WHERE y.month = $1::date AND y.score > x.score
              AND ($3::boolean OR NOT coalesce((SELECT q.hide_rank FROM plz_rank_prefs q WHERE q.account_id = y.account_id), false))) END AS rk
       FROM (SELECT score FROM plz_month_scores WHERE month = $1::date AND account_id = $2::uuid AND score > 0) x`, [m, me, hide]);
  const badges = await db.query(
    `SELECT to_char(month, 'YYYY-MM') AS month, badge, score, awarded_at AS "awardedAt" FROM plz_badges WHERE account_id = $1::uuid AND revoked_at IS NULL ORDER BY month DESC, badge LIMIT 36`, [me]);
  return { on: await on(db), month: m.slice(0, 7), hideRank: hide, score: s ?? { posts: 0, answers: 0, comments: 0, helpful: 0, score: 0, computed_at: null },
    rank: r?.rk ?? null, badges, badgeNames: BADGE_KO };
}

/** PUT /me/community/rank-pref — 공개 랭킹에 나오지 않기 */
export async function setRankPref(db: DatabaseService, me: string, hide: boolean) {
  await db.query(`INSERT INTO plz_rank_prefs (account_id, hide_rank) VALUES ($1::uuid, $2::boolean)
                  ON CONFLICT (account_id) DO UPDATE SET hide_rank = EXCLUDED.hide_rank, updated_at = now()`, [me, !!hide]);
  return { hideRank: !!hide, note: hide ? '공개 랭킹에 나오지 않습니다(배지는 그대로 받습니다).' : '공개 랭킹에 다시 나옵니다.' };
}

/* ── 운영 ── */

/** GET /admin/community/ranking — 그 달 전체(노출 끈 회원 표시) · 배지 · 마감 여부 · 점수 규칙 */
export async function adminRanking(db: DatabaseService, month?: string) {
  const m = monthOf(month);
  const items = await db.query(
    `SELECT row_number() OVER (ORDER BY x.score DESC, x.helpful DESC, x.answers DESC, x.account_id)::int AS rank, x.account_id AS "accountId", a.name,
            x.score, x.posts, x.answers, x.comments, x.helpful, coalesce(p.hide_rank, false) AS "hideRank", x.computed_at AS "computedAt"
       FROM plz_month_scores x JOIN accounts a ON a.id = x.account_id LEFT JOIN plz_rank_prefs p ON p.account_id = x.account_id
      WHERE x.month = $1::date ORDER BY x.score DESC, x.helpful DESC, x.answers DESC, x.account_id LIMIT 200`, [m]);
  const badges = await db.query(
    `SELECT b.id::text AS id, b.badge, b.score, b.account_id AS "accountId", a.name, b.awarded_at AS "awardedAt", b.revoked_at AS "revokedAt", b.revoke_reason AS "revokeReason"
       FROM plz_badges b JOIN accounts a ON a.id = b.account_id WHERE b.month = $1::date ORDER BY b.badge, b.score DESC LIMIT 200`, [m]);
  const rules = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'plaza.%' ORDER BY key`);
  const [cl] = await db.query<{ closed_at: string | null; members: number | null; badges: number | null }>(`SELECT closed_at, members, badges FROM plz_month_closes WHERE month = $1::date`, [m]);
  const [hv] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM plz_helpful_votes WHERE created_at >= now() - interval '30 days'`);
  return { on: await on(db), month: m.slice(0, 7), items, badges, rules: Object.fromEntries(rules.map((r) => [r.key, r.value])),
    closed: cl ?? null, helpful30: n(hv?.n), badgeNames: BADGE_KO };
}

/** POST /admin/community/ranking/run — 그 달 다시 셈(마감한 달은 점수만 · 배지는 그대로) */
export async function runRanking(db: DatabaseService, month?: string) {
  const m = monthOf(month);
  if (m > kstMonth()) throw new PolicyViolation('PLZ_MONTH', '아직 오지 않은 달입니다.');
  const [r] = await db.query<{ n: number }>(`SELECT fn_plz_month_scores($1::date) AS n`, [m]);
  return { month: m.slice(0, 7), members: n(r?.n) };
}

/** POST /admin/community/badges/{id}/revoke — 배지 거두기(사유 · 지우지 않음) */
export async function revokeBadge(db: DatabaseService, id: string, actor: string | null, reason: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 배지입니다.');
  const why = String(reason ?? '').trim();
  if (why.length < 2) throw new PolicyViolation('PLZ_BADGE_REASON', '사유를 적어 주십시오.');
  const [b] = await db.query<{ revoked_at: string | null }>(`SELECT revoked_at FROM plz_badges WHERE id = $1::bigint`, [id]);
  if (!b) throw new NotFound('없는 배지입니다.');
  if (b.revoked_at) throw new StateConflict('PLZ_BADGE_REVOKED', '이미 거둔 배지입니다.');
  await db.query(`UPDATE plz_badges SET revoked_at = now(), revoked_by = $2::uuid, revoke_reason = $3 WHERE id = $1::bigint AND revoked_at IS NULL`, [id, actor, why.slice(0, 200)]);
  return { id, revoked: true };
}

/** plz_badge_month — 이번 달 다시 셈 · 지난달이 마감 전이면 마감(배지 · 스위치 on 일 때만) */
export async function plzBadgeMonthJob(db: DatabaseService) {
  const cur = kstMonth();
  const prev = kstMonth(-1);
  const [a] = await db.query<{ n: number }>(`SELECT fn_plz_month_scores($1::date) AS n`, [cur]);
  let closed: number | null = null;
  if (await on(db)) {
    const [c] = await db.query<{ n: number }>(`SELECT fn_plz_month_close($1::date) AS n`, [prev]);
    closed = n(c?.n);
  }
  return { month: cur.slice(0, 7), members: n(a?.n), prevMonth: prev.slice(0, 7), badges: closed };
}
