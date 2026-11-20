import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { SMX_KEYS, smxOn } from './common';

/* ---------------------------------------------------------------------
 * v10.555 (D287 · docs/693) ③ 리뷰 판매자 답글
 *   누가   입점 판매자 = 자기 상품 리뷰(판매자센터 › 리뷰 답글) · 직판 상품 리뷰 = 운영자(소개몰 › 리뷰 답글)
 *   하나   리뷰 하나에 답글 하나(DB 고유) — 다시 쓰면 고치기 · 고친 글은 기록(hlt_review_reply_edits · 쌓기만)
 *   검사   금칙어 = 기존 사전(fn_check_banned_words · HLT) — 걸리면 운영 확인 뒤 보임(PENDING · 고쳐 쓰면 저절로 보임)
 *   운영   보이기 · 가리기(사유 · 쓴 쪽에 보임) · 판매자 답글도 가릴 수 있음
 *   알림   답글이 처음 보이게 될 때 리뷰 쓴 회원에게 한 번(HLT_REVIEW_REPLY)
 *   스위치 smx.review_reply off(처음) — 쓰기 막음 · 공개 목록에 안 붙음(쓴 답글은 남음)
 * ------------------------------------------------------------------- */

/* 이름 가림 — health-review.service MASK 와 같은 식(SQL 에 자리 끼우기를 쓰지 않으려고 글자 그대로 씀 · 규칙 3) */

/** 상품 상세 「리뷰」 목록 줄에 보이는 답글을 붙임(health-review.service productReviews 에서 부름 · 꺼져 있으면 아무것도 안 함) */
export async function smxAttachReplies(db: DatabaseService, items: Array<Record<string, unknown>>): Promise<void> {
  if (!items?.length || !(await smxOn(db, SMX_KEYS.reply))) return;
  const rows = await db.query<{ reviewId: string; kind: string; byName: string | null; body: string; createdAt: string; updatedAt: string; edited: boolean }>(
    `SELECT rp.review_id AS "reviewId", rp.author_kind AS kind, CASE WHEN rp.author_kind = 'SELLER' THEN s.name END AS "byName",
            rp.body, rp.created_at AS "createdAt", rp.updated_at AS "updatedAt", (rp.edit_count > 0) AS edited
       FROM hlt_review_replies rp LEFT JOIN hlt_sellers s ON s.id = rp.seller_id
      WHERE rp.review_id = ANY($1::uuid[]) AND rp.state = 'VISIBLE'`, [items.map((i) => String(i.id))]);
  const by = new Map(rows.map((r) => [r.reviewId, r]));
  for (const it of items) {
    const r = by.get(String(it.id));
    it.reply = r ? { kind: r.kind, byName: r.byName, body: r.body, createdAt: r.createdAt, updatedAt: r.updatedAt, edited: r.edited } : null;
  }
}

/** 답글이 처음 보이게 되면 리뷰 쓴 회원에게 한 번 알림 */
async function notifyOnce(db: DatabaseService, replyId: string) {
  await db.query(
    `WITH x AS (
       UPDATE hlt_review_replies rp SET notified_at = now()
         FROM hlt_reviews rv, hlt_products p
        WHERE rp.id = $1 AND rp.state = 'VISIBLE' AND rp.notified_at IS NULL AND rv.id = rp.review_id AND p.id = rv.product_id
        RETURNING rv.account_id, p.code, rp.body)
     INSERT INTO notifications (account_id, event_code, title, body, link_url)
     SELECT account_id, 'HLT_REVIEW_REPLY', '내 리뷰에 답글이 달렸습니다', left(body, 80), '/health/p/' || code || '#reviews' FROM x`, [replyId]);
}

async function mustBeOn(db: DatabaseService) {
  if (!(await smxOn(db, SMX_KEYS.reply))) throw new PolicyViolation('SMX_REPLY_OFF', '지금은 리뷰 답글을 쓸 수 없습니다(운영이 켤 때까지).');
}

function cleanBody(v: string): string {
  const b = String(v ?? '').replace(/\r\n/g, '\n').trim();
  if (b.length < 2 || b.length > 1000) throw new PolicyViolation('SMX_REPLY_BODY', '답글은 2 ~ 1,000자로 써 주십시오.');
  return b;
}

/** 쓰기 · 고치기 공통 — 리뷰 하나에 하나(있으면 고침) */
async function upsert(db: DatabaseService, reviewId: string, kind: 'SELLER' | 'STAFF', body: string) {
  const me = RequestCtx.actorId()!;
  const [cur] = await db.query<{ id: string; state: string; author_id: string; author_kind: string }>(
    `SELECT id, state, author_id, author_kind FROM hlt_review_replies WHERE review_id = $1 FOR UPDATE`, [reviewId]);
  let id: string;
  if (!cur) {
    const [n] = await db.query<{ id: string }>(
      `INSERT INTO hlt_review_replies (review_id, author_kind, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id`, [reviewId, kind, me, body]);
    id = n.id;
  } else {
    if (cur.author_kind !== kind) throw new Forbidden('SMX_REPLY_KIND', '이 리뷰의 답글은 다른 쪽이 씁니다.');
    if (cur.state === 'HIDDEN') throw new StateConflict('SMX_REPLY_HIDDEN', '가려진 답글은 고칠 수 없습니다.');
    await db.query(`UPDATE hlt_review_replies SET body = $2, author_id = $3 WHERE id = $1`, [cur.id, body, me]);
    id = cur.id;
  }
  const [r] = await db.query<{ id: string; state: string; holdWord: string | null; editCount: number }>(
    `SELECT id, state, hold_word AS "holdWord", edit_count AS "editCount" FROM hlt_review_replies WHERE id = $1`, [id]);
  if (r.state === 'VISIBLE') await notifyOnce(db, id);
  return { ...r, created: !cur,
    note: r.state === 'PENDING' ? '답글을 받았습니다. 확인이 필요한 표현이 있어 운영 확인 뒤 보입니다.' : cur ? '답글을 고쳤습니다(고친 기록이 남습니다).' : '답글을 올렸습니다.' };
}

/* ── 판매자센터 ── */

async function mySeller(db: DatabaseService) {
  const [s] = await db.query<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM hlt_sellers WHERE account_id = $1 AND type IN ('TENANT', 'BRAND') AND status IN ('ACTIVE', 'PAUSED')`, [RequestCtx.actorId()]);
  if (!s) throw new Forbidden('NOT_SELLER', '입점 승인된 판매자만 판매자센터를 쓸 수 있습니다.');
  return s;
}

/** GET /me/health/seller/review-replies?view=open|all — 내 상품의 보이는 리뷰 · 내 답글 */
export async function sellerReplies(db: DatabaseService, view?: string) {
  const s = await mySeller(db);
  const on = await smxOn(db, SMX_KEYS.reply);
  const open = view !== 'all';
  const items = await db.query<Record<string, unknown>>(
    `SELECT rv.id AS "reviewId", p.code AS "productCode", p.name AS "productName", rv.rating, rv.body, rv.created_at AS "createdAt", coalesce(left(btrim(a.name), 1), '회') || '○○' AS writer,
            CASE WHEN rp.id IS NULL THEN NULL ELSE json_build_object('id', rp.id, 'body', rp.body, 'state', rp.state, 'holdWord', rp.hold_word, 'hiddenReason', rp.hidden_reason,
                 'editCount', rp.edit_count, 'updatedAt', rp.updated_at) END AS reply
       FROM hlt_reviews rv JOIN hlt_products p ON p.id = rv.product_id JOIN accounts a ON a.id = rv.account_id
       LEFT JOIN hlt_review_replies rp ON rp.review_id = rv.id
      WHERE p.seller_id = $1 AND rv.state = 'VISIBLE' AND ($2::boolean IS FALSE OR rp.id IS NULL)
      ORDER BY rv.created_at DESC LIMIT 100`, [s.id, open]);
  return { on, seller: { code: s.code, name: s.name }, view: open ? 'open' : 'all', items,
    note: on ? '내 상품 리뷰에 답글을 하나씩 달 수 있습니다 — 고치면 기록이 남고, 확인이 필요한 표현은 운영 확인 뒤 보입니다.' : '지금은 리뷰 답글을 쓸 수 없습니다(운영이 켤 때까지).' };
}

/** PUT /me/health/seller/review-replies/{reviewId} — 내 상품 리뷰에 답글(DB 가 판매자 본인인지 다시 봄) */
export async function sellerReplySave(db: DatabaseService, reviewId: string, body: string) {
  await mustBeOn(db);
  const b = cleanBody(body);
  return db.transaction(async () => {
    const s = await mySeller(db);
    const [rv] = await db.query<{ id: string; state: string }>(
      `SELECT rv.id, rv.state FROM hlt_reviews rv JOIN hlt_products p ON p.id = rv.product_id WHERE rv.id = $1 AND p.seller_id = $2`, [reviewId, s.id]);
    if (!rv) throw new NotFound('내 상품의 리뷰가 아닙니다.');
    if (rv.state !== 'VISIBLE') throw new StateConflict('SMX_REPLY_REVIEW', '보이는 리뷰에만 답글을 달 수 있습니다.');
    return upsert(db, reviewId, 'SELLER', b);
  });
}

/* ── 운영 ── */

/** GET /admin/smx/review-replies?view=open|pending|hidden|all — open = 답글 없는 직판 리뷰 · 나머지 = 답글(판매자 · 운영) */
export async function adminReplies(db: DatabaseService, view?: string) {
  const on = await smxOn(db, SMX_KEYS.reply);
  const v = ['open', 'pending', 'hidden', 'all'].includes(view ?? '') ? view! : 'open';
  const [c] = await db.query<{ open: number; pending: number; hidden: number }>(
    `SELECT (SELECT count(*)::int FROM hlt_reviews rv JOIN hlt_products p ON p.id = rv.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
              WHERE rv.state = 'VISIBLE' AND NOT EXISTS (SELECT 1 FROM hlt_review_replies rp WHERE rp.review_id = rv.id)) AS open,
            (SELECT count(*)::int FROM hlt_review_replies WHERE state = 'PENDING') AS pending,
            (SELECT count(*)::int FROM hlt_review_replies WHERE state = 'HIDDEN') AS hidden`);
  const items = v === 'open'
    ? await db.query<Record<string, unknown>>(
      `SELECT rv.id AS "reviewId", p.code AS "productCode", p.name AS "productName", 'DIRECT' AS "sellerType", NULL::text AS "sellerName",
              rv.rating, rv.body, rv.created_at AS "createdAt", coalesce(left(btrim(a.name), 1), '회') || '○○' AS writer, NULL::json AS reply
         FROM hlt_reviews rv JOIN hlt_products p ON p.id = rv.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' JOIN accounts a ON a.id = rv.account_id
        WHERE rv.state = 'VISIBLE' AND NOT EXISTS (SELECT 1 FROM hlt_review_replies rp WHERE rp.review_id = rv.id)
        ORDER BY rv.created_at DESC LIMIT 200`)
    : await db.query<Record<string, unknown>>(
      `SELECT rv.id AS "reviewId", p.code AS "productCode", p.name AS "productName", s.type AS "sellerType", s.name AS "sellerName",
              rv.rating, rv.body, rv.created_at AS "createdAt", coalesce(left(btrim(a.name), 1), '회') || '○○' AS writer,
              json_build_object('id', rp.id, 'kind', rp.author_kind, 'body', rp.body, 'state', rp.state, 'holdWord', rp.hold_word, 'hiddenReason', rp.hidden_reason,
                                'editCount', rp.edit_count, 'createdAt', rp.created_at, 'updatedAt', rp.updated_at) AS reply
         FROM hlt_review_replies rp JOIN hlt_reviews rv ON rv.id = rp.review_id JOIN hlt_products p ON p.id = rv.product_id
         LEFT JOIN hlt_sellers s ON s.id = p.seller_id JOIN accounts a ON a.id = rv.account_id
        WHERE ($1::text = 'all' OR rp.state = upper($1::text))
        ORDER BY rp.updated_at DESC LIMIT 200`, [v]);
  return { on, view: v, counts: c, items,
    note: on ? '직판 상품 리뷰는 여기서 답합니다. 입점 판매자 답글은 판매자센터에서 쓰고, 여기서는 보이기 · 가리기만 합니다.' : '리뷰 답글이 꺼져 있습니다(smx.review_reply) — 쓰기가 막히고 공개 화면에도 보이지 않습니다.' };
}

/** PUT /admin/smx/review-replies/{reviewId} — 직판 상품 리뷰에 운영자 답글(DB 가 직판인지 다시 봄) */
export async function adminReplySave(db: DatabaseService, reviewId: string, body: string) {
  await mustBeOn(db);
  const b = cleanBody(body);
  return db.transaction(async () => {
    const [rv] = await db.query<{ id: string; state: string; type: string | null }>(
      `SELECT rv.id, rv.state, s.type FROM hlt_reviews rv JOIN hlt_products p ON p.id = rv.product_id LEFT JOIN hlt_sellers s ON s.id = p.seller_id WHERE rv.id = $1`, [reviewId]);
    if (!rv) throw new NotFound('없는 리뷰입니다.');
    if (rv.type && rv.type !== 'DIRECT') throw new PolicyViolation('SMX_REPLY_TENANT', '입점 상품 리뷰의 답글은 그 판매자가 씁니다 — 운영은 보이기 · 가리기만 합니다.');
    if (rv.state !== 'VISIBLE') throw new StateConflict('SMX_REPLY_REVIEW', '보이는 리뷰에만 답글을 달 수 있습니다.');
    return upsert(db, reviewId, 'STAFF', b);
  });
}

/** POST /admin/smx/review-replies/{replyId}/decide — 보이기 · 가리기(사유) */
export async function adminReplyDecide(db: DatabaseService, replyId: string, action: 'SHOW' | 'HIDE', reason?: string) {
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string; state: string }>(`SELECT id, state FROM hlt_review_replies WHERE id = $1 FOR UPDATE`, [replyId]);
    if (!r) throw new NotFound('없는 답글입니다.');
    const why = (reason ?? '').replace(/\s+/g, ' ').trim();
    if (action === 'HIDE' && why.length < 2) throw new PolicyViolation('REASON_REQUIRED', '가리는 사유를 적어 주십시오(답글 쓴 쪽에 보입니다).');
    const st = action === 'SHOW' ? 'VISIBLE' : 'HIDDEN';
    if (r.state === st) throw new StateConflict('SMX_REPLY_SAME', st === 'VISIBLE' ? '이미 보이는 답글입니다.' : '이미 가린 답글입니다.');
    await db.query(`UPDATE hlt_review_replies SET state = $2, hidden_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
      [replyId, st, action === 'HIDE' ? why : null, RequestCtx.actorId()]);
    if (st === 'VISIBLE') await notifyOnce(db, replyId);
    return { id: replyId, state: st, note: st === 'VISIBLE' ? '답글을 보이게 했습니다.' : '답글을 가렸습니다.' };
  });
}

/** GET /admin/smx/review-replies/{replyId}/edits — 고치기 기록 */
export async function adminReplyEdits(db: DatabaseService, replyId: string) {
  const [r] = await db.query<{ id: string }>(`SELECT id FROM hlt_review_replies WHERE id = $1`, [replyId]);
  if (!r) throw new NotFound('없는 답글입니다.');
  const items = await db.query<Record<string, unknown>>(
    `SELECT e.id, e.old_body AS "oldBody", e.new_body AS "newBody", e.edited_at AS "editedAt", coalesce(left(btrim(a.name), 1), '회') || '○○' AS editor
       FROM hlt_review_reply_edits e LEFT JOIN accounts a ON a.id = e.edited_by
      WHERE e.reply_id = $1 ORDER BY e.edited_at DESC, e.id DESC LIMIT 100`, [replyId]);
  return { id: replyId, items };
}
