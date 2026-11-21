import { DatabaseService } from '../../db/database.service';
import { lsqNotify, lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.603 (docs/745) ⑲ 성사 뒤 후기 요청 자동
 *   기존 후기(deal_reviews · POST /deals/{id}/reviews — 성사 확정 CONFIRMED · SETTLED 거래의 구매자 · 판매자만)를 그대로 쓰고, 요청만 더함
 *   lsq_daily(매일 10:20) · lsq.review_ask on 일 때만:
 *     ① 처음 요청 — 성사 확정(confirmed_at) 뒤 lsq.review_ask_days(3)일 ~ 30일 안 · 그 당사자가 후기를 안 씀 · 요청한 적 없음 → 알림 LSQ_REVIEW_ASK
 *     ② 다시 한 번 — 처음 요청 뒤 lsq.review_ask_again(7)일 · 아직 안 씀 · ask_count 1 → 한 번 더(0 이면 없음)
 *   하루 500명까지(넘는 것은 다음 날) · 알림은 fn_notify(회원이 끄면 안 감 · 그래도 요청 줄은 남김) · 링크 /deal/{id}/review
 *   소개자는 후기를 쓰지 않음(기존 규칙) — 구매자 · 판매자만
 * ------------------------------------------------------------------- */

const DAILY_MAX = 500;

export async function reviewAskJob(db: DatabaseService) {
  const s = await lsqSettings(db);
  if (!s.reviewAskOn) return { on: false, asked: 0, again: 0 };
  const firsts = await db.query<{ deal_id: string; account_id: string; party: string; title: string }>(
    `SELECT d.id::text AS deal_id, x.acc::text AS account_id, x.party, coalesce(l.title, rq.title, '거래') AS title
       FROM deals d
       CROSS JOIN LATERAL (VALUES (d.buyer_account_id, 'BUYER'), (d.seller_account_id, 'SELLER')) AS x(acc, party)
       LEFT JOIN listings l ON l.id = d.listing_id
       LEFT JOIN requests rq ON rq.id = d.request_id
      WHERE d.status IN ('CONFIRMED', 'SETTLED') AND d.confirmed_at IS NOT NULL
        AND d.confirmed_at <= now() - make_interval(days => $1::int) AND d.confirmed_at > now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM deal_reviews rv WHERE rv.deal_id = d.id AND rv.author_id = x.acc)
        AND NOT EXISTS (SELECT 1 FROM lsq_review_asks a WHERE a.deal_id = d.id AND a.account_id = x.acc)
      ORDER BY d.confirmed_at LIMIT $2::int`, [s.reviewAskDays, DAILY_MAX]);
  let asked = 0;
  for (const r of firsts) {
    const [ins] = await db.query<{ deal_id: string }>(
      `INSERT INTO lsq_review_asks (deal_id, account_id, party) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING RETURNING deal_id`,
      [r.deal_id, r.account_id, r.party]);
    if (!ins) continue;
    await lsqNotify(db, r.account_id, 'LSQ_REVIEW_ASK', { title: r.title.slice(0, 40) }, `/deal/${r.deal_id}/review`);
    asked++;
  }
  let again = 0;
  if (s.reviewAskAgain > 0) {
    const rows = await db.query<{ deal_id: string; account_id: string; title: string }>(
      `UPDATE lsq_review_asks a SET ask_count = 2, last_asked_at = now()
         FROM deals d LEFT JOIN listings l ON l.id = d.listing_id LEFT JOIN requests rq ON rq.id = d.request_id
        WHERE d.id = a.deal_id AND a.ask_count = 1 AND a.reviewed_at IS NULL
          AND a.first_asked_at <= now() - make_interval(days => $1::int)
          AND NOT EXISTS (SELECT 1 FROM deal_reviews rv WHERE rv.deal_id = a.deal_id AND rv.author_id = a.account_id)
          AND (a.deal_id, a.account_id) IN (SELECT deal_id, account_id FROM lsq_review_asks WHERE ask_count = 1 AND reviewed_at IS NULL ORDER BY first_asked_at LIMIT $2::int)
       RETURNING a.deal_id::text AS deal_id, a.account_id::text AS account_id, coalesce(l.title, rq.title, '거래') AS title`, [s.reviewAskAgain, DAILY_MAX]);
    for (const r of rows) {
      await lsqNotify(db, r.account_id, 'LSQ_REVIEW_ASK', { title: r.title.slice(0, 40) }, `/deal/${r.deal_id}/review`);
      again++;
    }
  }
  return { on: true, asked, again };
}

/** 운영 — 설정 · 최근 30일 요청 · 다시 요청 · 요청 뒤 쓴 후기(전환) · 후기 수 · 날마다 */
export async function adminReviewAsks(db: DatabaseService) {
  const settings = await lsqSettings(db);
  const [sum] = await db.query<Record<string, number | string | null>>(
    `SELECT count(*)::int AS asked, count(*) FILTER (WHERE ask_count = 2)::int AS again,
            count(*) FILTER (WHERE reviewed_at IS NOT NULL)::int AS reviewed,
            round(100.0 * count(*) FILTER (WHERE reviewed_at IS NOT NULL) / nullif(count(*), 0), 1) AS "reviewedPct",
            round(avg(extract(epoch FROM reviewed_at - first_asked_at) / 86400.0)::numeric, 1) AS "avgDays"
       FROM lsq_review_asks WHERE first_asked_at > now() - interval '30 days'`);
  const [base] = await db.query<{ confirmed: number; reviews: number }>(
    `SELECT (SELECT count(*)::int FROM deals WHERE status IN ('CONFIRMED', 'SETTLED') AND confirmed_at > now() - interval '30 days') AS confirmed,
            (SELECT count(*)::int FROM deal_reviews WHERE created_at > now() - interval '30 days') AS reviews`);
  const daily = await db.query(
    `SELECT to_char(first_asked_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day, count(*)::int AS asked, count(*) FILTER (WHERE reviewed_at IS NOT NULL)::int AS reviewed
       FROM lsq_review_asks WHERE first_asked_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1 DESC`);
  return { settings, summary30: { ...(sum ?? {}), ...(base ?? {}) }, daily,
    note: '후기 요청은 성사 확정된 거래의 구매자 · 판매자에게만 갑니다(소개자 제외) · 회원이 알림을 끄면 가지 않습니다 · 후기는 고칠 수 있지만 지워지지 않습니다.' };
}
