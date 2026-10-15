import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 광고 과금 · 정산.
 *
 * 규칙은 DB 가 집행합니다(`fn_ad_invoice_guard` · `fn_ad_payment_apply`).
 * 여기서는 읽고 넣는 일만 합니다 — 규칙을 앱에도 적으면 두 곳이
 * 갈라지고, 어느 쪽이 맞는지 모르게 됩니다.
 */
@Injectable()
export class AdBillingService {
  constructor(private readonly db: DatabaseService) {}

  /* ── 광고주 ────────────────────────────────────────────────────── */

  advertisers(status?: string) {
    return this.db.query(
      `SELECT s.id, s.code, s.name, s.status,
              a.contact_name AS "contactName", a.contact_phone AS "contactPhone",
              s.bookings, s.invoices, s.billed, s.collected, s.unpaid
         FROM v_ad_advertiser_stats s
         JOIN advertisers a ON a.id = s.id
        WHERE $1::text IS NULL OR s.status = $1
        ORDER BY s.unpaid DESC, s.name`, [status ?? null]);
  }

  async createAdvertiser(d: any) {
    const [a] = await this.db.query<any>(
      `INSERT INTO advertisers (code, name, biz_reg_no, ceo_name,
                                contact_name, contact_phone, contact_email, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, code, name, status`,
      [d.code, d.name, d.bizRegNo ?? null, d.ceoName ?? null,
       d.contactName ?? null, d.contactPhone ?? null, d.contactEmail ?? null,
       d.memo ?? null]);
    return a;
  }

  /**
   * 광고주 상태.
   *
   * BLOCKED 로 바꾸면 **나가고 있는 광고도 함께 멈춥니다.**
   * 광고주는 막았는데 광고는 계속 나가면 막은 의미가 없습니다.
   */
  async setAdvertiserStatus(id: string, status: string) {
    if (!['ACTIVE', 'PAUSED', 'BLOCKED'].includes(status)) {
      throw new PolicyViolation('BAD_STATUS', '없는 상태입니다.');
    }
    const [a] = await this.db.query<any>(
      `UPDATE advertisers SET status = $2, updated_at = now()
        WHERE id = $1 RETURNING id, code, name, status`, [id, status]);
    if (!a) throw new StateConflict('NOT_FOUND', '없는 광고주입니다.');

    if (status === 'BLOCKED') {
      const stopped = await this.db.query(
        `UPDATE ad_placements p SET status = 'PAUSED'
          WHERE p.status = 'ACTIVE'
            AND EXISTS (SELECT 1 FROM ad_bookings b
                         WHERE b.creative_code = p.creative_code
                           AND b.advertiser_id = $1)
          RETURNING p.creative_code`, [id]);
      return { ...a, stopped: stopped.length,
        note: stopped.length ? `나가던 광고 ${stopped.length}건을 함께 멈췄습니다.` : null };
    }
    return a;
  }

  /* ── 청구 ──────────────────────────────────────────────────────── */

  invoices(status?: string) {
    return this.db.query(
      `SELECT i.id, i.invoice_no AS "invoiceNo", a.name AS advertiser,
              i.period_from AS "periodFrom", i.period_to AS "periodTo",
              i.amount, i.vat, i.total,
              coalesce(i.paid_amount, 0) AS paid,
              i.total - coalesce(i.paid_amount, 0) AS unpaid,
              i.status, i.due_date AS "dueDate", i.paid_at AS "paidAt"
         FROM ad_invoices i
         JOIN advertisers a ON a.id = i.advertiser_id
        WHERE $1::text IS NULL OR i.status = $1
        ORDER BY i.created_at DESC LIMIT 200`, [status ?? null]);
  }

  /**
   * 청구 발행.
   *
   * 청구번호는 **서버가 만듭니다** — 앱이 만들면 동시에 발행할 때
   * 겹칩니다. 부가세를 비우면 10% 로 계산합니다.
   */
  async createInvoice(d: any) {
    const vat = d.vat ?? Math.floor(d.amount * 0.1);
    const [i] = await this.db.query<any>(
      `INSERT INTO ad_invoices (invoice_no, advertiser_id, booking_id,
                                period_from, period_to, amount, vat, total,
                                due_date, memo, created_by)
       VALUES (fn_next_ad_invoice_no(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, invoice_no AS "invoiceNo", total, status,
                 due_date AS "dueDate"`,
      [d.advertiserId, d.bookingId ?? null, d.periodFrom, d.periodTo,
       d.amount, vat, d.amount + vat, d.dueDate, d.memo ?? null,
       RequestCtx.actorId()]);
    return { ...i, note: '발행했습니다. 입금은 수금 계좌로 받으십시오.' };
  }

  /**
   * 입금 기록.
   *
   * 합계가 청구액에 닿으면 **트리거가 자동으로 완납**으로 바꿉니다.
   * 사람이 바꾸게 하면 빠뜨립니다.
   */
  async recordPayment(invoiceId: string, d: any) {
    const [inv] = await this.db.query<any>(
      `SELECT id, total, coalesce(paid_amount,0) AS paid, status
         FROM ad_invoices WHERE id = $1`, [invoiceId]);
    if (!inv) throw new StateConflict('NOT_FOUND', '없는 청구입니다.');
    if (inv.status === 'VOID') {
      throw new PolicyViolation('VOIDED', '취소된 청구에는 입금을 기록할 수 없습니다.');
    }

    await this.db.query(
      `INSERT INTO ad_payments (invoice_id, amount, method, payer_name, memo, recorded_by)
       VALUES ($1,$2,coalesce($3,'TRANSFER'),$4,$5,$6)`,
      [invoiceId, d.amount, d.method ?? null, d.payerName ?? null,
       d.memo ?? null, RequestCtx.actorId()]);

    const [after] = await this.db.query<any>(
      `SELECT invoice_no AS "invoiceNo", total,
              coalesce(paid_amount,0) AS paid,
              total - coalesce(paid_amount,0) AS unpaid, status
         FROM ad_invoices WHERE id = $1`, [invoiceId]);
    return { ...after,
      note: after.status === 'PAID' ? '완납 처리됐습니다.'
        : `남은 금액 ${Number(after.unpaid).toLocaleString()}원` };
  }

  /* ── 정산 · 미수 ───────────────────────────────────────────────── */

  receivables() {
    return this.db.query(
      `SELECT id, invoice_no AS "invoiceNo", advertiser,
              contact_phone AS "contactPhone",
              total, paid, unpaid, due_date AS "dueDate",
              overdue_days AS "overdueDays", status
         FROM v_ad_receivables LIMIT 200`);
  }

  /** 광고 정산 요약. 한 화면에서 보게 모읍니다. */
  async settlement() {
    const [sum] = await this.db.query<any>(`
      SELECT
        (SELECT count(*) FROM advertisers WHERE status='ACTIVE')      AS advertisers,
        (SELECT count(*) FROM ad_invoices
          WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')
            AND status <> 'VOID')                                     AS invoices_this_month,
        (SELECT coalesce(sum(total),0) FROM ad_invoices
          WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')
            AND status <> 'VOID')                                     AS billed_this_month,
        (SELECT coalesce(sum(amount),0) FROM ad_payments
          WHERE date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')) AS collected_this_month,
        (SELECT coalesce(sum(total - coalesce(paid_amount,0)),0) FROM ad_invoices
          WHERE status IN ('ISSUED','PARTIAL','OVERDUE'))             AS unpaid_total,
        (SELECT count(*) FROM v_ad_receivables WHERE overdue_days > 0) AS overdue_count`);

    const running = await this.db.query(
      `SELECT creative_code AS "creativeCode", advertiser,
              invoice_no AS "invoiceNo", unpaid, overdue_days AS "overdueDays"
         FROM v_ad_overdue_running LIMIT 50`);

    return {
      advertisers: Number(sum?.advertisers ?? 0),
      invoicesThisMonth: Number(sum?.invoices_this_month ?? 0),
      billedThisMonth: Number(sum?.billed_this_month ?? 0),
      collectedThisMonth: Number(sum?.collected_this_month ?? 0),
      unpaidTotal: Number(sum?.unpaid_total ?? 0),
      overdueCount: Number(sum?.overdue_count ?? 0),
      overdueRunning: running,
      note: running.length
        ? '연체인데 아직 나가는 광고가 있습니다 — 받지 못한 채 노출만 계속하면 손해가 커집니다.'
        : null,
    };
  }
}
