import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/** 운영자가 고를 수 있는 택배사(택배사 연동은 계약 뒤 — 지금은 이름 · 송장번호만 남김) */
export const CARRIERS = ['CJ대한통운', '한진택배', '롯데택배', '우체국택배', '로젠택배'] as const;
export const TRACKING_RE = /^[0-9]{10,14}$/;

/**
 * v10.28 (G-147 · G-194 · D035) — 소개몰 발송 처리 · 구매확정.
 *
 * 10/9 답: 운영자가 택배사 · 송장번호를 직접 넣고 단계를 바꿈(택배사 연동은 계약 뒤) · 배송 완료 7일 뒤 자동 확정 · 구매자가 먼저 누를 수 있음 ·
 * 송장은 배송중일 때만 고침. 배송 기록(hlt_shipments)은 쌓기만 하고, 주문 상태는 DB 트리거(fn_hlt_ship_apply)가 바꿉니다.
 * 구매확정 뒤에도 법정 기간 안의 반품 · 교환 신청은 받습니다(fn_hlt_return_judge 그대로 — 전자상거래법 17조).
 */
@Injectable()
export class HealthOrdersService {
  constructor(private readonly db: DatabaseService) {}

  /** 운영 「소개몰 주문」 — 상태별 목록(발송할 것 먼저) */
  async adminList(status?: string, q?: string) {
    const st = status && ['PAID', 'SHIPPED', 'DELIVERED', 'CONFIRMED'].includes(status) ? status : null;
    const rows = await this.db.query<any>(
      `SELECT o.order_no AS "orderNo", o.status, o.total, o.paid_at AS "paidAt", o.shipped_at AS "shippedAt",
              o.delivered_at AS "deliveredAt", o.confirmed_at AS "confirmedAt", o.confirmed_by AS "confirmedBy",
              CASE WHEN o.status = 'DELIVERED' THEN fn_hlt_confirm_due(o.id) END AS "confirmDue",
              (SELECT p.name || CASE WHEN count(*) OVER () > 1 THEN ' 외' ELSE '' END
                 FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id WHERE i.order_id = o.id ORDER BY i.id LIMIT 1) AS "itemName",
              (SELECT count(*)::int FROM hlt_order_items i WHERE i.order_id = o.id) AS "itemCount",
              s.carrier, s.tracking_no AS "trackingNo", s.state AS "shipState", s.happened_at AS "shipAt",
              EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('REQUESTED','APPROVED')) AS "openReturn",
              o.ship_memo AS "shipMemo"   -- v10.31 — 주문서 「배송 요청사항」(발송할 때 봄)
         FROM hlt_orders o
         LEFT JOIN LATERAL (SELECT carrier, tracking_no, state, happened_at FROM hlt_shipments x
                             WHERE x.order_id = o.id ORDER BY x.happened_at DESC, x.id DESC LIMIT 1) s ON true
        WHERE o.status IN ('PAID','PREPARING','SHIPPED','DELIVERED','CONFIRMED')
          AND ($1::text IS NULL OR o.status = $1 OR ($1 = 'PAID' AND o.status = 'PREPARING'))
          AND ($2::text IS NULL OR o.order_no ILIKE '%' || $2 || '%')
        ORDER BY (o.status IN ('PAID','PREPARING')) DESC, (o.status = 'SHIPPED') DESC, coalesce(o.paid_at, o.created_at) DESC
        LIMIT 200`, [st, q?.trim() || null]);
    const [c] = await this.db.query<any>(
      `SELECT count(*) FILTER (WHERE status IN ('PAID','PREPARING'))::int AS "toShip",
              count(*) FILTER (WHERE status = 'SHIPPED')::int AS shipping,
              count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
              count(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed
         FROM hlt_orders`);
    return { counts: c, carriers: CARRIERS, items: rows };
  }

  private async order(no: string, lock = true) {
    const [o] = await this.db.query<any>(`SELECT * FROM hlt_orders WHERE order_no = $1 ${lock ? 'FOR UPDATE' : ''}`, [no]);
    if (!o) throw new NotFound('없는 주문입니다.');
    return o;
  }

  private check(carrier: string, trackingNo: string) {
    if (!(CARRIERS as readonly string[]).includes(carrier)) throw new PolicyViolation('BAD_CARRIER', '택배사를 목록에서 골라 주십시오.');
    if (!TRACKING_RE.test(trackingNo)) throw new PolicyViolation('BAD_TRACKING_NO', '송장번호는 숫자 10 ~ 14자리입니다(붙임표 없이).');
  }

  /** 발송 처리 — 결제 완료 · 준비 중 주문 → 집화(PICKED) 기록 → 트리거가 「배송중」(SHIPPED) */
  ship(no: string, carrier: string, trackingNo: string) {
    this.check(carrier, trackingNo);
    return this.db.transaction(async () => {
      const o = await this.order(no);
      if (!['PAID', 'PREPARING'].includes(o.status)) {
        throw new StateConflict('NOT_SHIPPABLE', o.status === 'SHIPPED' ? '이미 발송한 주문입니다 — 송장을 고치려면 「송장 고치기」를 쓰십시오.' : `발송할 수 없는 주문입니다(${o.status}).`);
      }
      const [open] = await this.db.query<any>(`SELECT id FROM hlt_returns WHERE order_id = $1 AND kind = 'CANCEL' AND state IN ('REQUESTED','APPROVED') LIMIT 1`, [o.id]);
      if (open) throw new StateConflict('CANCEL_REQUESTED', '취소 신청이 접수된 주문입니다 — 신청을 먼저 처리해 주십시오.');
      await this.db.query(
        `INSERT INTO hlt_shipments (order_id, carrier, tracking_no, state, note, created_by) VALUES ($1,$2,$3,'PICKED','발송 처리',$4)`,
        [o.id, carrier, trackingNo, RequestCtx.actorId() ?? null]);
      return { orderNo: no, status: 'SHIPPED', carrier, trackingNo, note: '발송 처리했습니다 — 주문이 「배송중」이 되었습니다.' };
    });
  }

  /** 송장 고치기 — 배송중일 때만(배송 완료 뒤에는 구매확정 · 반품 기한의 기준이라 고치지 않음 · 10/9 답) */
  fixTracking(no: string, carrier: string, trackingNo: string) {
    this.check(carrier, trackingNo);
    return this.db.transaction(async () => {
      const o = await this.order(no);
      if (o.status !== 'SHIPPED') throw new StateConflict('NOT_SHIPPING', '송장은 배송중일 때만 고칠 수 있습니다.');
      await this.db.query(
        `INSERT INTO hlt_shipments (order_id, carrier, tracking_no, state, note, created_by) VALUES ($1,$2,$3,'PICKED','송장 고침',$4)`,
        [o.id, carrier, trackingNo, RequestCtx.actorId() ?? null]);
      return { orderNo: no, status: 'SHIPPED', carrier, trackingNo, note: '송장을 고쳤습니다(전 기록은 남습니다).' };
    });
  }

  /** 단계 — 배송중(간선 이동) · 배송 완료. 배송 완료가 구매확정 · 반품 기한의 기준입니다 */
  advance(no: string, state: 'IN_TRANSIT' | 'DELIVERED') {
    return this.db.transaction(async () => {
      const o = await this.order(no);
      if (o.status !== 'SHIPPED') throw new StateConflict('NOT_SHIPPING', '배송중인 주문만 단계를 바꿀 수 있습니다.');
      const [last] = await this.db.query<any>(
        `SELECT carrier, tracking_no FROM hlt_shipments WHERE order_id = $1 AND tracking_no IS NOT NULL ORDER BY happened_at DESC, id DESC LIMIT 1`, [o.id]);
      await this.db.query(
        `INSERT INTO hlt_shipments (order_id, carrier, tracking_no, state, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [o.id, last?.carrier ?? null, last?.tracking_no ?? null, state, state === 'DELIVERED' ? '배송 완료' : '간선 이동', RequestCtx.actorId() ?? null]);
      const [n] = await this.db.query<any>(`SELECT status, delivered_at AS "deliveredAt", fn_hlt_confirm_due(id) AS "confirmDue" FROM hlt_orders WHERE id = $1`, [o.id]);
      return { orderNo: no, ...n, note: state === 'DELIVERED' ? '배송 완료로 바꿨습니다 — 기한이 지나면 자동으로 구매확정됩니다.' : '「배송중」 기록을 더했습니다.' };
    });
  }

  /** 구매자의 구매확정 — 배송 완료 · 내 주문 · 처리 중인 신청 없음(DB 트리거도 같은 규칙) */
  confirm(no: string) {
    const me = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const [o] = await this.db.query<any>(`SELECT * FROM hlt_orders WHERE order_no = $1 AND account_id = $2 FOR UPDATE`, [no, me]);
      if (!o) throw new NotFound('없는 주문입니다.');
      if (o.status === 'CONFIRMED') return { orderNo: no, status: 'CONFIRMED', confirmedAt: o.confirmed_at, already: true, note: '이미 구매확정한 주문입니다.' };
      if (o.status !== 'DELIVERED') throw new StateConflict('NOT_DELIVERED', '배송 완료된 주문만 구매확정할 수 있습니다.');
      const [open] = await this.db.query<any>(`SELECT id FROM hlt_returns WHERE order_id = $1 AND state IN ('REQUESTED','APPROVED') LIMIT 1`, [o.id]);
      if (open) throw new StateConflict('RETURN_IN_PROGRESS', '처리 중인 취소·반품 신청이 있어 구매확정할 수 없습니다.');
      const [r] = await this.db.query<any>(
        `UPDATE hlt_orders SET status = 'CONFIRMED', confirmed_at = now(), confirmed_by = 'BUYER' WHERE id = $1
         RETURNING confirmed_at AS "confirmedAt"`, [o.id]);
      return { orderNo: no, status: 'CONFIRMED', confirmedAt: r.confirmedAt, already: false,
        note: '구매확정했습니다. 이제 리뷰를 쓰실 수 있습니다. 상품 하자 · 표시와 다름 · 오배송은 받으신 날부터 3개월 안에 신청하실 수 있습니다.' };
    });
  }
}
