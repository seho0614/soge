import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { CARD_COLS, CARD_FROM, OPTION_COLS } from './health-catalog.sql';

/* ★ 입력 객체(DTO)는 보내지 않은 항목도 키가 있고 값이 undefined 입니다(클래스 필드) — 「키가 있는가」(k in d)로 보면
 *   보내지 않은 개월 수가 null(단품)로, 켬/끔이 false 로 바뀝니다(10/8 시험이 잡음). 늘 「값이 undefined 가 아닌가」로 봅니다. */
/**
 * 운영 화면 「소개몰 상품」 (v10.26 · D027) — 상품 · 옵션 · 재고 · 그림 · 고시 · 성분 · 갈래 판매 범위.
 *
 * 시안 · 개발분 모두 상품 · 재고를 넣는 화면이 없었습니다(G-147). 10/8 확인한 제안 그림 ⑤ 대로 만듭니다. 본사 운영자만 씁니다(입점 판매자용은 v10.28).
 *
 * 규칙은 DB 가 집행합니다 — 금지 표현(fn_hlt_product_words_guard) · 판매 범위(fn_hlt_product_guard) · 옵션 없이 판매 시작 금지(fn_hlt_product_sale_ready) ·
 * 상품의 값 · 재고는 옵션에서 계산(fn_hlt_option_sync) · 성분군 2단(fn_ingredient_tree_guard). 여기서는 읽고 넣고, 바꾼 것을 변경 기록에 남깁니다.
 * DB 가 거절한 글(HLTP: · BANNED_WORD: …)은 그대로 422 로 나갑니다(전역 오류 처리).
 */
const PRODUCT_FIELDS: Record<string, string> = {
  name: 'name', summary: 'summary', listPrice: 'list_price', badge: 'badge', caution: 'caution',
  adCopy: 'ad_copy', reviewNo: 'review_no', artForm: 'art_form', artTone: 'art_tone', imageFileId: 'image_file_id',
};

@Injectable()
export class HealthAdminService {
  constructor(private readonly db: DatabaseService) {}

  private async hist(productId: string, field: string, before: unknown, after: unknown, optionId: string | null = null, note: string | null = null) {
    if (String(before ?? '') === String(after ?? '')) return;
    await this.db.query(
      `INSERT INTO hlt_product_history (product_id, option_id, actor_id, field, before, after, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [productId, optionId, RequestCtx.actorId() ?? null, field,
       before == null ? null : typeof before === 'object' ? JSON.stringify(before) : String(before),
       after == null ? null : typeof after === 'object' ? JSON.stringify(after) : String(after), note]);
  }

  private async row(code: string, lock = false) {
    const [p] = await this.db.query<any>(`SELECT * FROM hlt_products WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`, [code]);
    if (!p) throw new StateConflict('NOT_FOUND', '없는 상품입니다.');
    return p;
  }

  /** 상품 목록 — 모든 상태 · 옵션(재고) · 카드 항목 */
  async list(q?: string, category?: string, status?: string) {
    const items = await this.db.query<any>(
      `SELECT ${CARD_COLS}, p.status, p.updated_at AS "updatedAt",
              (SELECT json_agg(json_build_object('id', o.id, 'months', o.months, 'price', o.price, 'stock', o.stock, 'tag', o.tag,
                                                 'label', fn_hlt_option_label(o.months, o.tag), 'active', o.is_active) ORDER BY o.sort, o.months)
                 FROM hlt_product_options o WHERE o.product_id = p.id) AS options
         FROM ${CARD_FROM}
        WHERE c.gwan_code = 'HLT'
          /* v10.31 (10/10 결함) — 한 글자(예: 「김」)는 공용 검색 규칙(fn_search_match · 두 글자부터)이 무시해 전체가 나왔습니다.
           * 운영 상품 찾기는 한 글자면 이름 · 코드에 그 글자가 든 것만 거릅니다. 두 글자부터는 전과 같습니다. */
          AND ($1::text IS NULL
               OR (char_length($1) = 1 AND (p.name ILIKE '%' || $1 || '%' OR p.code ILIKE '%' || $1 || '%'))
               OR (char_length($1) > 1 AND fn_search_match(p.name, p.code || ' ' || coalesce(p.summary, '') || ' ' ||
                coalesce((SELECT string_agg(g.name, ' ') FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code WHERE pi.product_id = p.id), ''), $1)))
          AND ($2::text IS NULL OR c.code = $2)
          AND ($3::text IS NULL OR p.status = $3)
        ORDER BY p.created_at DESC LIMIT 500`, [q?.trim() || null, category || null, status || null]);
    return { items, total: items.length };
  }

  /** 상품 하나 — 수정 화면 */
  async get(code: string) {
    const p = await this.row(code);
    const [card] = await this.db.query<any>(`SELECT ${CARD_COLS}, p.status FROM ${CARD_FROM} WHERE p.id = $1`, [p.id]);
    const [options, ingredients, groupRow] = await Promise.all([
      this.db.query(`SELECT ${OPTION_COLS} FROM hlt_product_options o WHERE o.product_id = $1 ORDER BY o.sort, o.months`, [p.id]),
      this.db.query(`SELECT g.code, g.name, pi.amount, pi.is_main AS "isMain" FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code
                      WHERE pi.product_id = $1 ORDER BY pi.is_main DESC, pi.sort`, [p.id]),
      this.db.query<any>(`SELECT ng.notice_group, ng.caution_title FROM categories c JOIN hlt_notice_groups ng ON ng.category_code = c.code WHERE c.id = $1`, [p.category_id]),
    ]);
    const items = groupRow[0] ? await this.db.query<any>(`SELECT label, auto FROM hlt_notice_items WHERE notice_group = $1 ORDER BY sort`, [groupRow[0].notice_group]) : [];
    return { ...card, status: p.status, adCopy: p.ad_copy, caution: p.caution, notice: p.notice ?? {}, imageFileId: p.image_file_id,
      noticeItems: items, cautionTitle: groupRow[0]?.caution_title ?? '사용상 주의사항', options, ingredients };
  }

  /**
   * 상품 등록 — 늘 초안(DRAFT)으로 만듭니다. 판매 시작은 /status 로(그때 판매 범위 · 옵션 · 금지 표현을 DB 가 봅니다).
   * 판매자는 직판(입점 판매자는 v10.28). 청약철회 규칙은 갈래로 정합니다 — 화장품 · 운동 용품 등 = 일반(GENERAL) · 의료기기 = DEVICE · 나머지 = 식품(FOOD_SEALED).
   */
  async create(d: any) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/.test(String(d.code ?? ''))) throw new PolicyViolation('BAD_CODE', '상품 코드는 영문 · 숫자 · 붙임표 2 ~ 40자입니다(주소에 쓰입니다).');
    if (!Array.isArray(d.options) || !d.options.length) throw new PolicyViolation('OPTIONS_REQUIRED', '옵션(개월 수 · 결제 금액 · 재고)을 하나 이상 넣어 주십시오 — 개월 수를 비우면 「단품」입니다.');
    return this.db.transaction(async () => {
      const [c] = await this.db.query<any>(`SELECT id, code FROM categories WHERE gwan_code = 'HLT' AND code = $1`, [d.categoryCode]);
      if (!c) throw new PolicyViolation('BAD_CATEGORY', '소개몰 갈래를 골라 주십시오.');
      const [dup] = await this.db.query<any>(`SELECT 1 FROM hlt_products WHERE code = $1`, [d.code]);
      if (dup) throw new StateConflict('DUPLICATE_CODE', '이미 있는 상품 코드입니다.');
      const [seller] = await this.db.query<any>(`SELECT id FROM hlt_sellers WHERE type = 'DIRECT' LIMIT 1`);
      const wd = c.code === 'HLT_MEDDEV' ? 'DEVICE' : ['HLT_FOOD', 'HLT_FUNC'].includes(c.code) ? 'FOOD_SEALED' : 'GENERAL';
      const first = d.options[0];
      const [p] = await this.db.query<any>(
        `INSERT INTO hlt_products (code, name, category_id, price, stock, withdrawal_code, status, seller_id,
                                   summary, list_price, badge, caution, notice, ad_copy, art_form, art_tone)
         VALUES ($1,$2,$3,$4,0,$5,'DRAFT',$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) RETURNING id`,
        [d.code, d.name, c.id, Number(first?.price) || 1, wd, seller?.id ?? null, d.summary ?? null, d.listPrice ?? null, d.badge ?? null,
         d.caution ?? null, JSON.stringify(d.notice ?? {}), d.adCopy ?? null, d.artForm ?? null, d.artTone ?? null]);
      let n = 0;
      for (const o of d.options) await this.insertOption(p.id, o, ++n);
      if (d.mainIngredient?.code) await this.setMainIngredient(p.id, d.mainIngredient.code, d.mainIngredient.amount);
      await this.hist(p.id, 'created', null, d.code, null, '상품 등록(초안)');
      return { code: d.code, status: 'DRAFT', note: '초안으로 등록했습니다. 「판매 시작」을 누르면 손님에게 보입니다.' };
    });
  }

  private async insertOption(productId: string, o: any, sort: number) {
    const months = o.months == null || o.months === '' ? null : Number(o.months);
    const [r] = await this.db.query<any>(
      `INSERT INTO hlt_product_options (product_id, months, price, stock, tag, sort)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [productId, months, Number(o.price), Number(o.stock ?? 0), (o.tag ?? '').trim() || null, sort]);
    return r.id as string;
  }

  private async setMainIngredient(productId: string, code: string, amount?: string) {
    const [g] = await this.db.query<any>(`SELECT code, is_group FROM ingredients WHERE code = $1 AND NOT is_excipient`, [code]);
    if (!g || g.is_group) throw new PolicyViolation('BAD_INGREDIENT', '표제 성분은 성분군이 아닌 성분이어야 합니다.');
    await this.db.query(`UPDATE hlt_product_ingredients SET is_main = false WHERE product_id = $1 AND is_main AND ingredient_code <> $2`, [productId, code]);
    await this.db.query(
      `INSERT INTO hlt_product_ingredients (product_id, ingredient_code, amount, sort, is_main) VALUES ($1,$2,$3,0,true)
       ON CONFLICT (product_id, ingredient_code) DO UPDATE SET amount = EXCLUDED.amount, is_main = true`,
      [productId, code, (amount ?? '').trim() || null]);
  }

  /** 상품 고치기 — 글 · 정가 · 배지 · 그림 · 고시 · 갈래 · 표제 성분. 바꾼 것은 변경 기록에 남습니다 */
  async update(code: string, d: any) {
    return this.db.transaction(async () => {
      const p = await this.row(code, true);
      const sets: string[] = []; const vals: unknown[] = [p.id];
      for (const [k, col] of Object.entries(PRODUCT_FIELDS)) {
        if (d[k] === undefined) continue;
        const v = d[k] === '' ? null : d[k];
        vals.push(v); sets.push(`${col} = $${vals.length}`);
        await this.hist(p.id, k, p[col], v);
      }
      if (d.notice !== undefined) {
        vals.push(JSON.stringify(d.notice ?? {})); sets.push(`notice = $${vals.length}::jsonb`);
        await this.hist(p.id, 'notice', p.notice, d.notice ?? {});
      }
      if (d.categoryCode !== undefined) {
        const [c] = await this.db.query<any>(`SELECT id, code FROM categories WHERE gwan_code = 'HLT' AND code = $1`, [d.categoryCode]);
        if (!c) throw new PolicyViolation('BAD_CATEGORY', '소개몰 갈래를 골라 주십시오.');
        vals.push(c.id); sets.push(`category_id = $${vals.length}`);
        await this.hist(p.id, 'category', p.category_id, c.code);
      }
      if (d.imageFileId) {
        const [f] = await this.db.query<any>(`SELECT id FROM files WHERE id::text = $1 AND purpose = 'PRODUCT_IMAGE' AND status = 'READY'`, [d.imageFileId]);
        if (!f) throw new PolicyViolation('BAD_IMAGE', '올리기를 마친 상품 사진(JPG · PNG)이 아닙니다.');
      }
      if (sets.length) await this.db.query(`UPDATE hlt_products SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
      if (d.mainIngredient?.code) await this.setMainIngredient(p.id, d.mainIngredient.code, d.mainIngredient.amount);
      return this.get(code);
    });
  }

  /** 판매 시작 · 판매 중지 · 초안으로 — DB 가 판매 범위 · 옵션 · 금지 표현을 봅니다 */
  async setStatus(code: string, status: string) {
    if (!['ON_SALE', 'STOPPED', 'DRAFT', 'SOLD_OUT'].includes(status)) throw new PolicyViolation('BAD_STATUS', '없는 상태입니다.');
    return this.db.transaction(async () => {
      const p = await this.row(code, true);
      await this.db.query(`UPDATE hlt_products SET status = $2 WHERE id = $1`, [p.id, status]);
      await this.hist(p.id, 'status', p.status, status);
      return { code, status, note: status === 'ON_SALE' ? '판매를 시작했습니다 — 손님에게 보입니다.' : status === 'STOPPED' ? '판매를 멈췄습니다 — 손님에게 보이지 않습니다(장바구니 · 주문 기록은 그대로).' : '바꿨습니다.' };
    });
  }

  async addOption(code: string, o: any) {
    return this.db.transaction(async () => {
      const p = await this.row(code, true);
      const [{ n }] = await this.db.query<{ n: number }>(`SELECT coalesce(max(sort), 0)::int AS n FROM hlt_product_options WHERE product_id = $1`, [p.id]);
      const id = await this.insertOption(p.id, o, n + 1);
      await this.hist(p.id, 'option.add', null, `${o.months ?? '단품'} · ${o.price} · 재고 ${o.stock ?? 0}`, id);
      return this.get(code);
    });
  }

  /** 옵션 고치기 — 결제 금액 · 재고 · 꼬리 글자 · 개월 수 · 켬/끔. 주문이 있는 옵션은 지우지 않고 끕니다 */
  async updateOption(code: string, optionId: string, d: any) {
    return this.db.transaction(async () => {
      const p = await this.row(code, true);
      const [o] = await this.db.query<any>(`SELECT * FROM hlt_product_options WHERE id::text = $1 AND product_id = $2 FOR UPDATE`, [optionId, p.id]);
      if (!o) throw new StateConflict('NOT_FOUND', '이 상품의 옵션이 아닙니다.');
      const map: Record<string, string> = { price: 'price', stock: 'stock', tag: 'tag', months: 'months', active: 'is_active' };
      const sets: string[] = []; const vals: unknown[] = [o.id];
      for (const [k, col] of Object.entries(map)) {
        if (d[k] === undefined) continue;
        const v = k === 'tag' ? ((d.tag ?? '').trim() || null) : k === 'months' ? (d.months == null || d.months === '' ? null : Number(d.months)) : k === 'active' ? !!d.active : Number(d[k]);
        vals.push(v); sets.push(`${col} = $${vals.length}`);
        await this.hist(p.id, `option.${k}`, o[col], v, o.id, d.note ?? null);
      }
      if (sets.length) await this.db.query(`UPDATE hlt_product_options SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
      return this.get(code);
    });
  }

  history(code: string) {
    return this.db.query(
      `SELECT h.created_at AS "createdAt", a.email AS actor, h.field, h.before, h.after, h.note,
              CASE WHEN h.option_id IS NOT NULL THEN (SELECT fn_hlt_option_label(o.months, o.tag) FROM hlt_product_options o WHERE o.id = h.option_id) END AS "optionLabel"
         FROM hlt_product_history h JOIN hlt_products p ON p.id = h.product_id
         LEFT JOIN accounts a ON a.id = h.actor_id
        WHERE p.code = $1 ORDER BY h.created_at DESC LIMIT 200`, [code]);
  }

  /* ── 성분 · 고민 ── */

  ingredients() {
    return this.db.query(
      `SELECT g.code, g.name, g.aliases, g.note, g.is_group AS "isGroup", g.parent_code AS parent, g.is_featured AS featured,
              g.is_excipient AS excipient, g.sort,
              (SELECT count(*)::int FROM hlt_product_ingredients pi JOIN hlt_products p ON p.id = pi.product_id AND p.status = 'ON_SALE'
                WHERE pi.ingredient_code = g.code) AS "onSale"
         FROM ingredients g ORDER BY g.sort, g.name`);
  }

  async addIngredient(d: any) {
    if (!/^[A-Z][A-Z0-9-]{1,19}$/.test(String(d.code ?? ''))) throw new PolicyViolation('BAD_CODE', '성분 코드는 영문 대문자 · 숫자 · 붙임표 2 ~ 20자입니다.');
    const [dup] = await this.db.query<any>(`SELECT 1 FROM ingredients WHERE code = $1`, [d.code]);
    if (dup) throw new StateConflict('DUPLICATE_CODE', '이미 있는 성분 코드입니다.');
    await this.db.query(
      `INSERT INTO ingredients (code, name, aliases, is_group, is_featured, parent_code, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [d.code, d.name, Array.isArray(d.aliases) ? d.aliases : [], !!d.isGroup, !!d.featured, d.parent || null, Number(d.sort ?? 1000)]);
    return this.ingredients();
  }

  async updateIngredient(code: string, d: any) {
    const [g] = await this.db.query<any>(`SELECT code FROM ingredients WHERE code = $1`, [code]);
    if (!g) throw new StateConflict('NOT_FOUND', '없는 성분입니다.');
    const map: Record<string, string> = { name: 'name', aliases: 'aliases', featured: 'is_featured', parent: 'parent_code', sort: 'sort', note: 'note' };
    const sets: string[] = []; const vals: unknown[] = [code];
    for (const [k, col] of Object.entries(map)) {
      if (d[k] === undefined) continue;
      vals.push(k === 'parent' ? (d.parent || null) : k === 'featured' ? !!d.featured : d[k]); sets.push(`${col} = $${vals.length}`);
    }
    if (sets.length) await this.db.query(`UPDATE ingredients SET ${sets.join(', ')} WHERE code = $1`, vals);
    return this.ingredients();
  }

  /* ── 갈래 · 판매 범위 ── */

  /* ── v10.31 (합침) 특가 배너 hlt_promos ───────────────────────── */
  private static readonly PROMO_COLS = `id, slot, tag, title, title_em AS "titleEm", body, link_url AS "linkUrl", cta,
    is_sample AS "isSample", is_active AS "isActive", starts_at AS "startsAt", ends_at AS "endsAt", sort_order AS "sortOrder",
    (is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())) AS "live", updated_at AS "updatedAt"`;

  promos() {
    return this.db.query(`SELECT ${HealthAdminService.PROMO_COLS} FROM hlt_promos ORDER BY sort_order, created_at DESC`);
  }

  async addPromo(d: { tag: string; title: string; titleEm?: string | null; body?: string | null; linkUrl: string; cta?: string;
    isSample?: boolean; isActive?: boolean; startsAt?: string | null; endsAt?: string | null; sortOrder?: number }) {
    const [row] = await this.db.query(
      `INSERT INTO hlt_promos (tag, title, title_em, body, link_url, cta, is_sample, is_active, starts_at, ends_at, sort_order)
       VALUES (btrim($1), btrim($2), nullif(btrim($3), ''), nullif(btrim($4), ''), $5, coalesce(nullif(btrim($6), ''), '지금 바로 보기'),
               coalesce($7, true), coalesce($8, true), $9, $10, coalesce($11, 0))
       RETURNING ${HealthAdminService.PROMO_COLS}`,
      [d.tag, d.title, d.titleEm ?? null, d.body ?? null, d.linkUrl, d.cta ?? null, d.isSample ?? null, d.isActive ?? null,
       d.startsAt ?? null, d.endsAt ?? null, d.sortOrder ?? null]);
    return row;
  }

  async updatePromo(id: string, d: Record<string, unknown>) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StateConflict('NOT_FOUND', '없는 배너입니다.');
    const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k);
    const [row] = await this.db.query(
      `UPDATE hlt_promos SET
          tag = coalesce(btrim($2), tag), title = coalesce(btrim($3), title),
          title_em = CASE WHEN $4::boolean THEN nullif(btrim($5), '') ELSE title_em END,
          body = CASE WHEN $6::boolean THEN nullif(btrim($7), '') ELSE body END,
          link_url = coalesce($8, link_url), cta = coalesce(nullif(btrim($9), ''), cta),
          is_sample = coalesce($10, is_sample), is_active = coalesce($11, is_active),
          starts_at = CASE WHEN $12::boolean THEN $13::timestamptz ELSE starts_at END,
          ends_at = CASE WHEN $14::boolean THEN $15::timestamptz ELSE ends_at END,
          sort_order = coalesce($16, sort_order), updated_at = now()
        WHERE id = $1
      RETURNING ${HealthAdminService.PROMO_COLS}`,
      [id, d.tag ?? null, d.title ?? null, has('titleEm'), d.titleEm ?? null, has('body'), d.body ?? null,
       d.linkUrl ?? null, d.cta ?? null, d.isSample ?? null, d.isActive ?? null,
       has('startsAt'), d.startsAt ?? null, has('endsAt'), d.endsAt ?? null, d.sortOrder ?? null]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 배너입니다.');
    return row;
  }

  saleCategories() {
    return this.db.query(
      `SELECT c.code, c.name, coalesce(s.state, 'OPEN') AS state, s.note, coalesce(s.sort, 100) AS sort,
              (SELECT count(*)::int FROM hlt_products p WHERE p.category_id = c.id AND p.status = 'ON_SALE') AS "onSale",
              (SELECT count(*)::int FROM hlt_products p WHERE p.category_id = c.id) AS total,
              ng.notice_group AS "noticeGroup", r.rate AS "commissionRate"
         FROM categories c
         LEFT JOIN hlt_sale_categories s ON s.category_code = c.code
         LEFT JOIN hlt_notice_groups ng ON ng.category_code = c.code
         LEFT JOIN hlt_commission_rates r ON r.category_code = c.code
        WHERE c.gwan_code = 'HLT' AND c.status = 'APPROVED' AND c.restricted_code IS DISTINCT FROM 'PHARM' AND c.restricted_code IS DISTINCT FROM 'MEDICAL'
        ORDER BY coalesce(s.sort, 100), c.name`);
  }
}
