import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * v10.208 (D185 · docs/333) — 소개몰 개봉 반품 재고 · 할인 판매(스위치 hlt.open_stock_sale · 처음 off)
 *
 *   반품 승인(개봉)마다 주문 줄별로 대장에 남음(health-return.service) — 직판은 보관 · 폐기, 입점은 판매자에게 반송.
 *   보관한 것을 할인 판매로 옮기면 원래 상품을 복제한 「[개봉 반품] …」 상품이 생김(fn_hlt_open_stock_sell) —
 *   장바구니 · 주문 · 결제 · 환불은 지금 흐름 그대로. 스위치가 꺼져 있으면 멈춘 채로 두고, 켜면 판매 중.
 */
@Injectable()
export class HealthOpenStockService {
  constructor(private readonly db: DatabaseService) {}

  private static readonly HLTOS = /HLTOS:\s*(.*)$/s;
  private rethrow(e: any): never {
    const m = HealthOpenStockService.HLTOS.exec(String(e?.message ?? ''));
    if (m) throw new PolicyViolation('OPEN_STOCK_RULE', m[1].trim());
    throw e;
  }

  async list(state?: string) {
    const st = ['HOLD', 'FOR_SALE', 'DISCARDED', 'TO_SELLER'].includes(state ?? '') ? state : null;
    const items = await this.db.query<any>(
      `SELECT k.id, k.state, k.qty, k.note, to_char(k.expires_on, 'YYYY-MM-DD') AS "expiresOn",
              to_char(k.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS "createdAt",
              o.order_no AS "orderNo", p.code AS "productCode", p.name AS "productName",
              fn_hlt_option_label(op.months, op.tag) AS "optionLabel", op.price::float8 AS "optionPrice", k.option_id AS "optionId",
              coalesce(s.type, 'DIRECT') AS "sellerType",
              sp.code AS "saleCode", sp.status AS "saleStatus", sp.stock AS "saleStock", sp.price::float8 AS "salePrice"
         FROM hlt_open_stock k
         JOIN hlt_orders o ON o.id = k.order_id
         JOIN hlt_products p ON p.id = k.product_id
         LEFT JOIN hlt_product_options op ON op.id = k.option_id
         LEFT JOIN hlt_sellers s ON s.id = p.seller_id
         LEFT JOIN hlt_products sp ON sp.id = k.sale_product_id
        WHERE ($1::text IS NULL OR k.state = $1)
        ORDER BY k.created_at DESC LIMIT 200`, [st]);
    const [c] = await this.db.query<any>(
      `SELECT count(*) FILTER (WHERE state = 'HOLD')::int AS hold, count(*) FILTER (WHERE state = 'FOR_SALE')::int AS "forSale",
              count(*) FILTER (WHERE state = 'DISCARDED')::int AS discarded, count(*) FILTER (WHERE state = 'TO_SELLER')::int AS "toSeller",
              fn_hlt_open_sale_on() AS "saleOn"
         FROM hlt_open_stock`);
    return { items, counts: { hold: c.hold, forSale: c.forSale, discarded: c.discarded, toSeller: c.toSeller }, saleOn: c.saleOn };
  }

  async sell(ids: string[], price: number, note?: string, expiresOn?: string) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw new PolicyViolation('OPEN_STOCK_IDS', '옮길 개봉 반품 재고를 1 ~ 50개 골라 주십시오.');
    if (!Number.isInteger(price) || price <= 0) throw new PolicyViolation('OPEN_STOCK_PRICE', '할인 판매 값을 원 단위 정수로 넣으십시오.');
    if (expiresOn && !/^20\d{2}-\d{2}-\d{2}$/.test(expiresOn)) throw new PolicyViolation('OPEN_STOCK_EXPIRES', '유통기한은 YYYY-MM-DD 로 넣으십시오.');
    try {
      const [r] = await this.db.query<{ code: string }>(
        `SELECT fn_hlt_open_stock_sell($1::uuid[], $2, $3, $4::date, $5) AS code`,
        [ids, price, (note ?? '').trim() || null, expiresOn || null, RequestCtx.actorId() ?? null]);
      const [p] = await this.db.query<any>(`SELECT code, status, stock FROM hlt_products WHERE code = $1`, [r.code]);
      return { ok: true, code: p.code, status: p.status, stock: p.stock };
    } catch (e) { this.rethrow(e); }
  }

  async discard(id: string, note: string) {
    const n = (note ?? '').trim();
    if (n.length < 2 || n.length > 300) throw new PolicyViolation('OPEN_STOCK_NOTE', '폐기 사유를 2 ~ 300자로 적어 주십시오.');
    try {
      const rows = await this.db.query(
        `UPDATE hlt_open_stock SET state = 'DISCARDED', note = $2, decided_at = now(), decided_by = $3
          WHERE id::text = $1 RETURNING id`, [id, n, RequestCtx.actorId() ?? null]);
      if (!rows.length) throw new NotFound('없는 개봉 반품 재고입니다.');
      return { ok: true, id };
    } catch (e) { if (e instanceof NotFound) throw e; this.rethrow(e); }
  }
}
