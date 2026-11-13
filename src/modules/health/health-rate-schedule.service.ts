import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

export type RateScope = 'SELLER' | 'TYPE' | 'CATEGORY';
export const NOTICE_DAYS = 31;   // 예약한 날을 빼고 꼬박 30일 — DB(hlt_rate_sched_notice_31d)도 같은 값

/**
 * v10.275 ~ 277 (D208 · docs/406) — 판매수수료율 인상 예약(입점 약관 제17조 4항)
 *   올리거나 비워서 어느 갈래에서라도 오르고, 그 요율이 쓰이는 판매 중 · 정지 입점 판매자가 있으면 바로 바꾸지 않고 예약합니다.
 *   시행일 = 예약한 날(한국) + 31일 이후 0시 · 영향받는 판매자마다 알림 · 판매자센터에 예정 표시 · 시행 전에만 취소(사유).
 *   내리는 것 · 영향받는 판매자가 없는 바꿈은 지금처럼 바로 적용합니다. 판정은 DB(fn_hlt_rate_notice) 한 곳.
 */
@Injectable()
export class HealthRateScheduleService {
  constructor(private readonly db: DatabaseService) {}

  /** 가장 이른 시행일(한국 날짜) */
  async earliest(): Promise<string> {
    const [r] = await this.db.query<{ d: string }>(
      `SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + $1::int, 'YYYY-MM-DD') AS d`, [NOTICE_DAYS]);
    return r.d;
  }

  /** 바꾸면 오르는지 · 영향받는 판매자 수 · 예약이 필요한지 · 이미 있는 예약 */
  async notice(scope: RateScope, target: string, rate: number | null) {
    const [n] = await this.db.query<{ o_increase: boolean; o_affected: number }>(
      `SELECT o_increase, o_affected FROM fn_hlt_rate_notice($1, $2, $3::numeric)`, [scope, target, rate]);
    const [open] = await this.db.query<{ id: string; effectiveDate: string }>(
      `SELECT id, to_char(effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "effectiveDate"
         FROM hlt_rate_schedules WHERE scope = $1 AND target = $2 AND status = 'SCHEDULED'`, [scope, target]);
    const increase = !!n?.o_increase, affected = Number(n?.o_affected ?? 0);
    return { increase, affected, needsNotice: increase && affected > 0, earliest: await this.earliest(), scheduled: open ?? null };
  }

  /**
   * 요율을 바꾸기 전에 부름 — 시행된 예약을 먼저 표에 옮기고, 같은 대상 예약이 있으면 409.
   *   예약이 필요 없으면 null(부른 쪽이 바로 바꿈) · 필요한데 시행일이 없거나 이르면 422 · 맞으면 예약을 만들고 결과를 돌려줌.
   */
  async guard(scope: RateScope, target: string, from: number | null, rate: number | null, reason: string, effectiveDate?: string | null, label?: string) {
    await this.db.query(`SELECT fn_hlt_rate_sched_apply()`);
    const n = await this.notice(scope, target, rate);
    if (n.scheduled) {
      throw new StateConflict('RATE_SCHEDULED', `이 요율에는 이미 예약이 있습니다(${n.scheduled.effectiveDate} 시행) — 「요율 변경 예정」에서 취소한 뒤 바꾸십시오.`);
    }
    if (!n.needsNotice) return null;
    const d = String(effectiveDate ?? '').trim();
    if (!d) {
      throw new PolicyViolation('NOTICE_REQUIRED',
        `요율을 올리면 판매자 ${n.affected}곳에 시행일 30일 전에 알려야 합니다(입점 약관 제17조 4항) — 시행일(${n.earliest} 이후)을 정해 주십시오.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < n.earliest) {
      throw new PolicyViolation('NOTICE_TOO_SHORT', `시행일은 ${n.earliest} 이후로 정해 주십시오 — 예약한 날을 빼고 30일이 지나야 합니다.`);
    }
    if (reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '바꾸는 사유를 적어 주십시오 — 판매자에게 알리고 기록에 남습니다.');
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO hlt_rate_schedules (scope, target, from_rate, to_rate, effective_at, reason, created_by)
       VALUES ($1, $2, $3, $4, ($5::date)::timestamp AT TIME ZONE 'Asia/Seoul', $6, $7) RETURNING id`,
      [scope, target, from, rate, d, reason, RequestCtx.actorId()]);
    const show = (v: number | null) => (v === null ? '다음 순서 요율' : `${v}%`);
    const sent = await this.notifySellers(scope, target, 'SELLER_RATE_SCHEDULED', '판매 수수료율 변경 예정 안내',
      `${label ? `${label} ` : ''}판매 수수료율이 ${d} 부터 ${show(rate)} 로 바뀝니다 — 그날 0시 뒤 들어오는 주문부터 적용(이미 받은 주문은 그대로) · 사유: ${reason}`);
    await this.db.query(`UPDATE hlt_rate_schedules SET notified = $2 WHERE id = $1`, [row.id, sent]);
    return { ok: true, scheduled: true, id: row.id, effectiveDate: d, from, to: rate, notified: sent,
      note: `${d} 부터 적용하도록 예약했습니다 — 판매자 ${sent}곳에 알렸습니다(약관 제17조 4항).` };
  }

  private async notifySellers(scope: string, target: string, code: string, title: string, body: string) {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT s.account_id, $3, $4, $5, '/health/seller/center' FROM hlt_sellers s
        WHERE s.id IN (SELECT fn_hlt_rate_sched_sellers($1, $2)) AND s.account_id IS NOT NULL
       RETURNING id`, [scope, target, code, title, body]);
    return rows.length;
  }

  /** 운영 — 예약 목록(예정 먼저 · 최근 50) */
  list() {
    return this.db.query(
      `SELECT r.id, r.scope, r.target, r.from_rate AS "fromRate", r.to_rate AS "toRate",
              to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "effectiveDate",
              r.reason, r.status, r.notified, r.created_at AS "createdAt", r.applied_at AS "appliedAt",
              r.canceled_at AS "canceledAt", r.cancel_reason AS "cancelReason", a.name AS "by",
              CASE r.scope WHEN 'SELLER' THEN (SELECT s.name FROM hlt_sellers s WHERE s.id::text = r.target)
                           WHEN 'TYPE' THEN CASE r.target WHEN 'BRAND' THEN '브랜드 직영관' ELSE '일반 입점' END
                           ELSE coalesce((SELECT c.name FROM categories c WHERE c.gwan_code = 'HLT' AND c.code = r.target), r.target) END AS "label",
              (SELECT count(*)::int FROM fn_hlt_rate_sched_sellers(r.scope, r.target)) AS "affectedNow"
         FROM hlt_rate_schedules r LEFT JOIN accounts a ON a.id = r.created_by
        ORDER BY (r.status = 'SCHEDULED') DESC, r.effective_at DESC LIMIT 50`);
  }

  /** 운영 — 시행 전 예약 취소(사유 · 판매자에게 알림) */
  async cancel(id: string, reasonRaw: string) {
    const reason = String(reasonRaw ?? '').trim();
    if (reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '취소 사유를 적어 주십시오 — 판매자에게 알리고 기록에 남습니다.');
    return this.db.transaction(async () => {
      const [r] = await this.db.query<{ scope: string; target: string; status: string; due: boolean; d: string }>(
        `SELECT scope, target, status, effective_at <= now() AS due, to_char(effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d
           FROM hlt_rate_schedules WHERE id::text = $1 FOR UPDATE`, [id]);
      if (!r) throw new NotFound('요율 예약을 찾을 수 없습니다.');
      if (r.status !== 'SCHEDULED' || r.due) throw new StateConflict('SCHEDULE_CLOSED', '이미 시행했거나 취소한 예약입니다 — 시행 시각이 지나면 취소할 수 없습니다.');
      await this.db.query(
        `UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_by = $2, canceled_at = now(), cancel_reason = $3 WHERE id::text = $1`,
        [id, RequestCtx.actorId(), reason]);
      const sent = await this.notifySellers(r.scope, r.target, 'SELLER_RATE_SCHEDULE_CANCELED', '판매 수수료율 변경 예정이 취소되었습니다',
        `${r.d} 부터 바뀔 예정이던 판매 수수료율 변경을 취소했습니다 — 지금 요율 그대로입니다 · 사유: ${reason}`);
      return { ok: true, status: 'CANCELED', notified: sent, note: `예약을 취소했습니다 — 판매자 ${sent}곳에 알렸습니다.` };
    });
  }

  /** 정기 작업 hlt_rate_schedule — 시행 시각이 지난 예약을 표로 */
  async applyDue() {
    const [r] = await this.db.query<{ n: number }>(`SELECT fn_hlt_rate_sched_apply() AS n`);
    return Number(r?.n ?? 0);
  }

  /** 판매자센터 — 이 판매자에게 쓰이는 예정 변경 */
  forSeller(sellerId: string) {
    return this.db.query(
      `SELECT r.scope, to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "effectiveDate",
              r.from_rate AS "fromRate", r.to_rate AS "toRate", r.reason,
              CASE r.scope WHEN 'CATEGORY' THEN coalesce((SELECT c.name FROM categories c WHERE c.gwan_code = 'HLT' AND c.code = r.target), r.target) ELSE NULL END AS "categoryName"
         FROM hlt_rate_schedules r
        WHERE r.status = 'SCHEDULED' AND r.effective_at > now()
          AND $1::uuid IN (SELECT fn_hlt_rate_sched_sellers(r.scope, r.target))
        ORDER BY r.effective_at`, [sellerId]);
  }
}
