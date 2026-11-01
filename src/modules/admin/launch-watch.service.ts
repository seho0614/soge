import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.170 (D159 · docs/262) — 공개 직후 지켜보기
 *
 *   사용자 웹을 전체 공개(11/1 · open-blockers #27)한 뒤 오늘(한국 날짜) 무엇이 들어오는지 한눈에 —
 *   가입 · 로그인 · 소개광장 글 · 매물 · 소개몰 주문 · **시험 결제(stub)로 결제 완료된 주문** · 확인 안 한 운영 알림 · 스위치 상태.
 *   시험 결제 주문은 돈을 받지 않은 주문입니다(결제대행사 연결 전) — 생기면 정기 작업 launch_watch 가 운영 알림을 남깁니다.
 * ------------------------------------------------------------------- */
const TODAY = `(now() AT TIME ZONE 'Asia/Seoul')::date`;
const KST = (col: string) => `(${col} AT TIME ZONE 'Asia/Seoul')::date = ${TODAY}`;

@Injectable()
export class LaunchWatchService {
  constructor(private readonly db: DatabaseService) {}

  async today() {
    const [c] = await this.db.query<any>(
      `SELECT (SELECT count(*)::int FROM accounts WHERE ${KST('created_at')}) AS signups,
              (SELECT count(*)::int FROM accounts WHERE last_login_at IS NOT NULL AND ${KST('last_login_at')}) AS logins,
              (SELECT count(*)::int FROM posts WHERE ${KST('created_at')}) AS posts,
              (SELECT count(*)::int FROM listings WHERE ${KST('created_at')}) AS listings,
              (SELECT count(*)::int FROM hlt_orders WHERE ${KST('created_at')}) AS orders,
              (SELECT count(*)::int FROM hlt_orders WHERE paid_at IS NOT NULL AND ${KST('paid_at')}) AS "paidOrders",
              (SELECT count(DISTINCT p.order_id)::int FROM hlt_payments p WHERE p.stub AND p.state = 'PAID' AND ${KST('coalesce(p.approved_at, p.created_at)')}) AS "stubPaidOrders",
              (SELECT count(*)::int FROM ops_alerts WHERE acknowledged_at IS NULL AND severity IN ('WARN', 'CRITICAL')) AS "openAlerts",
              coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') AS "orderOpen",
              coalesce((SELECT value FROM site_settings WHERE key = 'assume.payment'), 'off') AS "assumePayment",
              (SELECT count(*)::int FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE p.status = 'ON_SALE' AND s.type = 'DIRECT') AS "directOnSale"`);
    const stubOrders = await this.db.query(
      `SELECT o.order_no AS "orderNo", o.total, o.status, coalesce(p.approved_at, p.created_at) AS "paidAt"
         FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
        WHERE p.stub AND p.state = 'PAID' AND coalesce(p.approved_at, p.created_at) > now() - interval '7 days'
        ORDER BY coalesce(p.approved_at, p.created_at) DESC LIMIT 10`);
    return { ...c, stubOrders,
      warn: c.stubPaidOrders > 0 ? '시험 결제로 결제 완료된 주문이 있습니다 — 돈을 받지 않은 주문입니다. 소개몰 「주문 받기」를 끄거나 직판 상품을 판매 중지하십시오.' : undefined };
  }

  /** 정기 작업 launch_watch — 지난 15분 안에 시험 결제로 결제 완료된 소개몰 주문 수 */
  async recentStubOrders(): Promise<{ n: number; orders: string[] }> {
    const rows = await this.db.query<{ order_no: string }>(
      `SELECT DISTINCT o.order_no FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
        WHERE p.stub AND p.state = 'PAID' AND coalesce(p.approved_at, p.created_at) > now() - interval '15 minutes' ORDER BY 1 LIMIT 20`);
    return { n: rows.length, orders: rows.map((r) => r.order_no) };
  }
}
