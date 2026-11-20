import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { storageFromEnv } from '../file/storage';

/* ---------------------------------------------------------------------
 * v10.533 (D281 · docs/671) 리뷰 작성 적립 — 대표 11/20 「(51) ② 리뷰 작성 적립」
 *   주기 · 회수는 DB 가 함(fn_hlt_review_reward · fn_hlt_review_reward_revoke · hlt_reviews 트리거 3개) — 서버는 보기 · 운영 회수 · 사진 열기만
 *   ㊲ 적립금 장부 그대로(묶음 근거 REVIEW · 기록 EARN · REVOKE) → 전표 MALL_POINT_EARN · MALL_POINT_LAPSE 가 그대로 잡음
 *   처음 꺼짐(mall.review_points) · 적립금(mall.points)도 켜져 있어야 함 · 직판 주문만 · 한 주문 한 번 · 사진 가산
 * ------------------------------------------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
export const REVIEW_POINT_STATES = ['GRANTED', 'REVOKED'] as const;

/** GET /admin/health/review-points?state= — 스위치 · 금액 설정 · 최근 30일 적립 · 회수 · 사진 비율 · 기록 100 */
export async function reviewPointsView(db: DatabaseService, state?: string) {
  const [s] = await db.query<Record<string, string | null>>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.review_points') AS sw, (SELECT value FROM site_settings WHERE key = 'mall.points') AS points,
            (SELECT value FROM site_settings WHERE key = 'mall.review_points_text') AS txt, (SELECT value FROM site_settings WHERE key = 'mall.review_points_photo') AS photo,
            (SELECT value FROM site_settings WHERE key = 'mall.review_points_min_len') AS minlen, (SELECT value FROM site_settings WHERE key = 'mall.review_points_days') AS days`);
  const [t] = await db.query<Record<string, string | number>>(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS granted,
            coalesce(sum(amount) FILTER (WHERE created_at > now() - interval '30 days'), 0)::bigint AS "grantedAmount",
            count(*) FILTER (WHERE created_at > now() - interval '30 days' AND photo)::int AS photos,
            count(*) FILTER (WHERE revoked_at > now() - interval '30 days')::int AS revoked,
            coalesce(sum(revoked_amount) FILTER (WHERE revoked_at > now() - interval '30 days'), 0)::bigint AS "revokedAmount"
       FROM hlt_review_rewards`);
  const st = state && (REVIEW_POINT_STATES as readonly string[]).includes(state) ? state : null;
  const rows = await db.query<Record<string, unknown>>(
    `SELECT w.id::text AS id, w.state, w.amount::bigint AS amount, w.photo, w.created_at AS "createdAt", w.revoked_at AS "revokedAt", w.revoke_reason AS "revokeReason",
            w.revoked_amount::bigint AS "revokedAmount", o.order_no AS "orderNo", CASE WHEN char_length(coalesce(a.name, '')) <= 1 THEN '*' ELSE left(a.name, 1) || repeat('*', char_length(a.name) - 1) END AS member,
            r.id::text AS "reviewId", r.state AS "reviewState", r.rating, left(r.body, 60) AS body, p.code AS "productCode", p.name AS "productName",
            CASE WHEN r.photo_file_id IS NOT NULL THEN '/api/v1/health/reviews/' || r.id || '/photo' END AS "photoUrl"
       FROM hlt_review_rewards w JOIN hlt_orders o ON o.id = w.order_id JOIN accounts a ON a.id = w.account_id
       LEFT JOIN hlt_reviews r ON r.id = w.review_id LEFT JOIN hlt_products p ON p.id = r.product_id
      WHERE ($1::text IS NULL OR w.state = $1::text)
      ORDER BY w.id DESC LIMIT 100`, [st]);
  const on = s?.sw === 'on' && s?.points === 'on';
  return {
    on, switchOn: s?.sw === 'on', pointsOn: s?.points === 'on',
    text: n(s?.txt ?? 500), photo: n(s?.photo ?? 500), minLen: n(s?.minlen ?? 20), days: n(s?.days ?? 30),
    granted30: n(t?.granted), grantedAmount30: n(t?.grantedAmount), photos30: n(t?.photos), revoked30: n(t?.revoked), revokedAmount30: n(t?.revokedAmount),
    rows: rows.map((r) => ({ ...r, amount: n(r.amount), revokedAmount: r.revokedAmount == null ? null : n(r.revokedAmount) })),
    note: on ? '구매확정한 직판 주문의 리뷰가 보이게 되면 주문 하나에 한 번 쌓습니다. 지우거나 가리면 남은 금액을 회수합니다.'
      : `꺼져 있습니다(${[s?.sw === 'on' ? '' : 'mall.review_points', s?.points === 'on' ? '' : 'mall.points'].filter(Boolean).join(' · ')}) — 켜기 전에 금액 · 최소 글자 · 기한을 확인하십시오.`,
  };
}

/** POST /admin/health/review-points/{id}/revoke — 운영 회수(사유 · 감사 기록) · 이미 회수면 409 */
export async function reviewPointRevoke(db: DatabaseService, id: string, reasonIn: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('리뷰 적립을 찾을 수 없습니다.');
  const reason = String(reasonIn ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('HLT_REVIEW_POINT_REASON', '회수 사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const [w] = await db.query<{ id: string; review_id: string; state: string }>(
      `SELECT id::text AS id, review_id::text AS review_id, state FROM hlt_review_rewards WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!w) throw new NotFound('리뷰 적립을 찾을 수 없습니다.');
    if (w.state !== 'GRANTED') throw new StateConflict('HLT_REVIEW_POINT_REVOKED', '이미 회수한 리뷰 적립입니다.');
    const [r] = await db.query<{ back: string }>(`SELECT fn_hlt_review_reward_revoke($1::uuid, $2::text, $3::uuid)::text AS back`, [w.review_id, `운영 회수 — ${reason}`.slice(0, 200), actor]);
    const back = n(r?.back);
    return { ok: true, revoked: back, note: `회수했습니다 — ${back.toLocaleString('ko-KR')}원(이미 쓴 몫은 운영 알림으로 남김).` };
  });
}

/** GET /health/reviews/{id}/photo — 보이는 리뷰의 사진(공개) · 쓴 사람 · 운영자는 늘 */
export async function reviewPhoto(db: DatabaseService, id: string, me: string | null, staff: boolean) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) throw new NotFound('사진이 없습니다.');
  const [f] = await db.query<{ storage_key: string; content_type: string; size_bytes: string; state: string; owner: string }>(
    `SELECT f.storage_key, f.content_type, f.size_bytes::text AS size_bytes, r.state, r.account_id::text AS owner
       FROM hlt_reviews r JOIN files f ON f.id = r.photo_file_id AND f.status = 'READY'
      WHERE r.id = $1::uuid`, [id]);
  if (!f || (f.state !== 'VISIBLE' && f.owner !== me && !staff)) throw new NotFound('사진이 없습니다.');
  const stream = await storageFromEnv().open(f.storage_key);
  if (!stream) throw new NotFound('사진이 없습니다.');
  return { stream, contentType: f.content_type, size: n(f.size_bytes) };
}
