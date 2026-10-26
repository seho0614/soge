import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { CARD_COLS, CARD_FROM } from './health-catalog.sql';
import { I18nService } from '../i18n/i18n.service';

const MASK = `coalesce(left(btrim(a.name), 1), '회') || '○○'`;

/**
 * v10.28 (D036) — 소개몰 리뷰 · 상품 문의. 10/9 답 「권장대로」:
 * 리뷰는 구매확정한 주문의 상품마다 1건 · 글 + 별점(사진 없음) · 바로 보임(금칙어에 걸리면 운영 확인 뒤) · 고치기/지우기는 본인 · 운영은 가림만.
 * 문의는 본인인증 회원 · 비공개 고르기 · 운영자가 답함(답하면 쓴 사람에게 알림). 규칙은 DB 트리거(fn_hlt_review_guard)도 집행합니다.
 */
@Injectable()
export class HealthReviewService {
  constructor(private readonly db: DatabaseService, private readonly i18n: I18nService) {}

  private async productId(code: string) {
    const [p] = await this.db.query<any>(`SELECT id FROM hlt_products WHERE code = $1 AND status IN ('ON_SALE','SOLD_OUT','STOPPED')`, [code]);
    if (!p) throw new NotFound('없는 상품입니다.');
    return p.id as string;
  }

  /** 상품 상세 「리뷰」 탭 — 보이는 리뷰만 · 별점 분포 · 이름은 첫 글자만 */
  async productReviews(code: string, rating?: number) {
    const pid = await this.productId(code);
    const me = RequestCtx.actorId() ?? null;
    const [st] = await this.db.query<any>(`SELECT * FROM v_hlt_review_stats WHERE product_id = $1`, [pid]);
    const items = await this.db.query<any>(
      `SELECT r.id, r.rating, r.body, r.created_at AS "createdAt", r.updated_at AS "updatedAt", ${MASK} AS "writer",
              (r.account_id = $3) AS mine, i.option_label AS "optionLabel"
         FROM hlt_reviews r JOIN accounts a ON a.id = r.account_id JOIN hlt_order_items i ON i.id = r.order_item_id
        WHERE r.product_id = $1 AND r.state = 'VISIBLE' AND ($2::int IS NULL OR r.rating = $2)
        ORDER BY r.created_at DESC LIMIT 100`, [pid, rating && rating >= 1 && rating <= 5 ? rating : null, me]);
    return {
      count: st?.review_count ?? 0, avg: st ? Number(st.rating_avg) : null,
      dist: { 5: st?.r5 ?? 0, 4: st?.r4 ?? 0, 3: st?.r3 ?? 0, 2: st?.r2 ?? 0, 1: st?.r1 ?? 0 },
      items,
    };
  }

  /** 리뷰 쓰기 — 구매확정한 내 주문의 그 상품 줄(주문번호 + 상품 코드 + 옵션) */
  async create(d: { orderNo: string; productCode: string; optionId?: string; rating: number; body: string }) {
    const me = RequestCtx.actorId()!;
    const [it] = await this.db.query<any>(
      `SELECT i.id, i.order_id, i.product_id, o.status
         FROM hlt_order_items i JOIN hlt_orders o ON o.id = i.order_id JOIN hlt_products p ON p.id = i.product_id
        WHERE o.order_no = $1 AND o.account_id = $2 AND p.code = $3 AND ($4::uuid IS NULL OR i.option_id = $4)
        ORDER BY i.id LIMIT 1`, [d.orderNo, me, d.productCode, d.optionId ?? null]);
    if (!it) throw new NotFound('내 주문에 없는 상품입니다.');
    if (it.status !== 'CONFIRMED') throw new StateConflict('NOT_CONFIRMED', '구매확정한 주문만 리뷰를 쓸 수 있습니다.');
    const [dup] = await this.db.query<any>(`SELECT id FROM hlt_reviews WHERE order_item_id = $1`, [it.id]);
    if (dup) throw new StateConflict('ALREADY_REVIEWED', '이 주문 상품의 리뷰는 이미 쓰셨습니다 — 고치기를 써 주십시오.');
    const body = (d.body ?? '').trim();
    if (body.length < 10) throw new PolicyViolation('TOO_SHORT', '리뷰는 10자 이상 써 주십시오.');
    const [r] = await this.db.query<any>(
      `INSERT INTO hlt_reviews (order_item_id, order_id, product_id, account_id, rating, body)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, state, rating, body, hold_word AS "holdWord"`,
      [it.id, it.order_id, it.product_id, me, d.rating, body]);
    return { ...r, note: r.state === 'PENDING' ? '리뷰를 받았습니다. 확인이 필요한 표현이 있어 운영 확인 뒤 보입니다.' : '리뷰를 올렸습니다.' };
  }

  private async mine(id: string) {
    const [r] = await this.db.query<any>(`SELECT * FROM hlt_reviews WHERE id = $1 AND account_id = $2 FOR UPDATE`, [id, RequestCtx.actorId()]);
    if (!r) throw new NotFound('없는 리뷰입니다.');
    return r;
  }

  /** 고치기 — 본인만 · 가려진 리뷰는 고칠 수 없음 · 글을 바꾸면 다시 검사(DB) */
  update(id: string, d: { rating?: number; body?: string }) {
    return this.db.transaction(async () => {
      const r = await this.mine(id);
      if (r.state === 'HIDDEN') throw new StateConflict('HIDDEN', '가려진 리뷰는 고칠 수 없습니다.');
      const body = d.body !== undefined ? d.body.trim() : r.body;
      if (body.length < 10) throw new PolicyViolation('TOO_SHORT', '리뷰는 10자 이상 써 주십시오.');
      const [n] = await this.db.query<any>(
        `UPDATE hlt_reviews SET rating = $2, body = $3 WHERE id = $1 RETURNING id, state, rating, body, hold_word AS "holdWord"`,
        [id, d.rating ?? r.rating, body]);
      return { ...n, note: n.state === 'PENDING' ? '고쳤습니다. 확인이 필요한 표현이 있어 운영 확인 뒤 보입니다.' : '고쳤습니다.' };
    });
  }

  /** 지우기 — 본인만(운영자는 지우지 않고 가림) */
  remove(id: string) {
    return this.db.transaction(async () => {
      await this.mine(id);
      await this.db.query(`DELETE FROM hlt_reviews WHERE id = $1`, [id]);
      return { id, deleted: true, note: '리뷰를 지웠습니다.' };
    });
  }

  /** 내 주문 상세의 상품 줄마다 내 리뷰 */
  async myReviewsForOrder(no: string) {
    return this.db.query<any>(
      `SELECT r.id, r.order_item_id AS "orderItemId", p.code AS "productCode", i.option_id AS "optionId", r.rating, r.body, r.state,
              r.hidden_reason AS "hiddenReason", r.created_at AS "createdAt"
         FROM hlt_reviews r JOIN hlt_orders o ON o.id = r.order_id JOIN hlt_order_items i ON i.id = r.order_item_id JOIN hlt_products p ON p.id = r.product_id
        WHERE o.order_no = $1 AND r.account_id = $2`, [no, RequestCtx.actorId()]);
  }

  /* ── 문의 ─────────────────────────────────────────────── */
  async productQna(code: string) {
    const pid = await this.productId(code);
    const me = RequestCtx.actorId() ?? null;
    const items = await this.db.query<any>(
      `SELECT q.id, q.is_private AS "isPrivate", q.created_at AS "createdAt", ${MASK} AS "writer", (q.account_id = $2) AS mine,
              CASE WHEN q.is_private AND q.account_id IS DISTINCT FROM $2 THEN NULL ELSE q.body END AS body,
              CASE WHEN q.is_private AND q.account_id IS DISTINCT FROM $2 THEN NULL ELSE q.answer END AS answer,
              q.answered_at AS "answeredAt", (q.answer IS NOT NULL) AS answered
         FROM hlt_qna q JOIN accounts a ON a.id = q.account_id
        WHERE q.product_id = $1 AND q.state = 'VISIBLE'
        ORDER BY q.created_at DESC LIMIT 100`, [pid, me]);
    return { count: items.length, items };
  }

  async ask(code: string, d: { body: string; isPrivate?: boolean }) {
    const pid = await this.productId(code);
    const body = (d.body ?? '').trim();
    if (body.length < 5) throw new PolicyViolation('TOO_SHORT', '문의는 5자 이상 써 주십시오.');
    const [q] = await this.db.query<any>(
      `INSERT INTO hlt_qna (product_id, account_id, body, is_private) VALUES ($1,$2,$3,$4)
       RETURNING id, is_private AS "isPrivate", created_at AS "createdAt"`, [pid, RequestCtx.actorId(), body, d.isPrivate === true]);
    return { ...q, note: '문의를 받았습니다. 운영자가 답하면 알림으로 알려 드립니다.' };
  }

  /* ── 순위(D037) ─────────────────────────────────────────── */
  /** 메인 「오늘의 건강상품」(판매 수량) · 「많이 찾는 상품」(주문 건수) — 가장 최근 집계 · 기준 · 기간 · 집계 시각 */
  async rankings() {
    const [last] = await this.db.query<any>(`SELECT to_char(max(snapshot_date), 'YYYY-MM-DD') AS d FROM hlt_rankings`);   /* 날짜는 글자로 — date 를 그대로 내리면 UTC 자정 시각이 되어 하루 앞으로 보임 */
    const out: Record<string, any> = {};
    for (const [kind, basis] of [['SALES_7D', '판매 수량'], ['ORDERS_7D', '주문 건수']] as const) {
      const items = last?.d ? await this.db.query<any>(
        `SELECT r.rank, r.qty, r.orders, ${CARD_COLS}
           FROM hlt_rankings r JOIN ${CARD_FROM} ON p.id = r.product_id
          WHERE r.snapshot_date = $1 AND r.kind = $2 AND p.status IN ('ON_SALE','SOLD_OUT')
          ORDER BY r.rank`, [last.d, kind]) : [];
      const [m] = last?.d ? await this.db.query<any>(
        `SELECT to_char(min(basis_from), 'YYYY-MM-DD') AS "from", to_char(max(basis_to), 'YYYY-MM-DD') AS "to", max(made_at) AS "madeAt" FROM hlt_rankings WHERE snapshot_date = $1 AND kind = $2`, [last.d, kind]) : [null];
      out[kind] = { basis: `최근 7일 ${basis} 기준`, from: m?.from ?? null, to: m?.to ?? null, madeAt: m?.madeAt ?? null, items };
    }
    /* v10.103 (3-1) — 상품 이름 · 한 줄 설명만 화면 언어로(두 순위 한 번에) */
    await this.i18n.overlay([...out.SALES_7D.items, ...out.ORDERS_7D.items], 'HLT_PRODUCT', (r: any) => r.code, { name: 'name', summary: 'summary' });
    await this.i18n.overlayMainIngredient([...out.SALES_7D.items, ...out.ORDERS_7D.items]);   // v10.119 (D125)
    return { sales: out.SALES_7D, orders: out.ORDERS_7D };
  }

  /* ── 운영 ─────────────────────────────────────────────── */
  adminReviews(state?: string) {
    const st = state && ['PENDING', 'VISIBLE', 'HIDDEN'].includes(state) ? state : 'PENDING';
    return this.db.query<any>(
      `SELECT r.id, r.state, r.rating, r.body, r.hold_word AS "holdWord", r.hidden_reason AS "hiddenReason",
              r.created_at AS "createdAt", r.decided_at AS "decidedAt", p.code AS "productCode", p.name AS "productName",
              o.order_no AS "orderNo", ${MASK} AS "writer"
         FROM hlt_reviews r JOIN hlt_products p ON p.id = r.product_id JOIN hlt_orders o ON o.id = r.order_id JOIN accounts a ON a.id = r.account_id
        WHERE r.state = $1 ORDER BY r.created_at ${st === 'PENDING' ? 'ASC' : 'DESC'} LIMIT 200`, [st]);
  }

  /** 운영 판정 — SHOW(보이기) · HIDE(가림 · 사유 필수 · 쓴 사람에게 알림). 지우지 않습니다 */
  decideReview(id: string, action: 'SHOW' | 'HIDE', reason?: string) {
    return this.db.transaction(async () => {
      const [r] = await this.db.query<any>(`SELECT r.*, p.code FROM hlt_reviews r JOIN hlt_products p ON p.id = r.product_id WHERE r.id = $1 FOR UPDATE`, [id]);
      if (!r) throw new NotFound('없는 리뷰입니다.');
      if (action === 'HIDE' && !(reason ?? '').trim()) throw new PolicyViolation('REASON_REQUIRED', '가리는 사유를 적어 주십시오(쓴 분에게 알립니다).');
      const st = action === 'SHOW' ? 'VISIBLE' : 'HIDDEN';
      await this.db.query(
        `UPDATE hlt_reviews SET state = $2, hidden_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
        [id, st, action === 'HIDE' ? reason!.trim() : null, RequestCtx.actorId()]);
      if (action === 'HIDE') {
        await this.db.query(
          `INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1,'HLT_REVIEW_HIDDEN',$2,$3,$4)`,
          [r.account_id, '리뷰가 가려졌습니다', `사유: ${reason!.trim()}`, `/health/p/${r.code}#reviews`]);
      }
      return { id, state: st, note: action === 'SHOW' ? '리뷰를 보이게 했습니다.' : '리뷰를 가렸습니다(쓴 분에게 알림).' };
    });
  }

  adminQna(open?: boolean) {
    return this.db.query<any>(
      `SELECT q.id, q.body, q.is_private AS "isPrivate", q.state, q.answer, q.answered_at AS "answeredAt", q.created_at AS "createdAt",
              p.code AS "productCode", p.name AS "productName", ${MASK} AS "writer"
         FROM hlt_qna q JOIN hlt_products p ON p.id = q.product_id JOIN accounts a ON a.id = q.account_id
        WHERE ($1::boolean IS NULL OR ($1 AND q.answer IS NULL AND q.state = 'VISIBLE') OR (NOT $1 AND q.answer IS NOT NULL))
        ORDER BY q.created_at ${open ? 'ASC' : 'DESC'} LIMIT 200`, [open === undefined ? null : open]);
  }

  answer(id: string, text: string) {
    return this.db.transaction(async () => {
      const [q] = await this.db.query<any>(`SELECT q.*, p.code FROM hlt_qna q JOIN hlt_products p ON p.id = q.product_id WHERE q.id = $1 FOR UPDATE`, [id]);
      if (!q) throw new NotFound('없는 문의입니다.');
      const t = (text ?? '').trim();
      if (t.length < 2) throw new PolicyViolation('TOO_SHORT', '답을 적어 주십시오.');
      await this.db.query(`UPDATE hlt_qna SET answer = $2, answered_by = $3, answered_at = now() WHERE id = $1`, [id, t, RequestCtx.actorId()]);
      await this.db.query(
        `INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1,'HLT_QNA_ANSWERED',$2,$3,$4)`,
        [q.account_id, '상품 문의에 답이 왔습니다', t.slice(0, 80), `/health/p/${q.code}#qna`]);
      return { id, answered: true, note: q.answer ? '답을 고쳤습니다(쓴 분에게 다시 알림).' : '답했습니다(쓴 분에게 알림).' };
    });
  }

  hideQna(id: string, reason: string) {
    return this.db.transaction(async () => {
      const r = (reason ?? '').trim();
      if (!r) throw new PolicyViolation('REASON_REQUIRED', '가리는 사유를 적어 주십시오.');
      const n = await this.db.query<any>(`UPDATE hlt_qna SET state = 'HIDDEN', hidden_reason = $2 WHERE id = $1 RETURNING id`, [id, r]);
      if (!n.length) throw new NotFound('없는 문의입니다.');
      return { id, state: 'HIDDEN', note: '문의를 가렸습니다.' };
    });
  }
}
