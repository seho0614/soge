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
 * v10.278 (D209 · docs/407) — 별도 공지사항(대표 결정 11/13): 예약하면 소개몰 공지 초안을 만들고, 운영자가 「공지 게시」(게시한 날 + 31일 ≤ 시행일).
 *   예약 안내를 게시한 뒤 취소하면 「변경 취소 안내」 초안 · 같은 단추로 게시. 빠뜨림은 정기 작업이 운영 알림 RATE_NOTICE_MISSING.
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
    const noticeId = await this.draftNotice(`판매 수수료율 변경 안내(${d} 시행)`, [
      `소개몰 입점 판매자 여러분께 알려 드립니다.`,
      ``,
      `- 대상: ${label ?? this.scopeLabel(scope)}`,
      `- 판매 수수료율: ${show(from)} → ${show(rate)}`,
      `- 시행일: ${d} 0시(한국 시간) 이후 들어오는 주문부터 적용 · 이미 받은 주문은 그대로입니다`,
      `- 사유: ${reason}`,
      ``,
      `소개몰 입점(판매자) 이용약관 제17조 4항에 따라 시행일 30일 전에 공지하고, 해당 판매자께는 따로 알려 드렸습니다. 궁금한 점은 고객센터로 문의해 주십시오.`,
    ].join('\n'));
    await this.db.query(`UPDATE hlt_rate_schedules SET notified = $2, notice_id = $3 WHERE id = $1`, [row.id, sent, noticeId]);
    return { ok: true, scheduled: true, id: row.id, effectiveDate: d, from, to: rate, notified: sent, noticeId,
      note: `${d} 부터 적용하도록 예약했습니다 — 판매자 ${sent}곳에 알렸습니다(약관 제17조 4항). 「요율 변경 예정」에서 공지를 게시해 주십시오.` };
  }

  private scopeLabel(scope: string) { return scope === 'SELLER' ? '판매자 개별 요율' : scope === 'TYPE' ? '입점 유형 요율' : '갈래 요율'; }

  /** v10.278 (D209) — 소개몰 공지 초안(게시 안 됨 · published_at 비움) */
  private async draftNotice(title: string, body: string) {
    const [n] = await this.db.query<{ id: string }>(
      `INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, author_id, grades) VALUES ('HLT', $1, $2, true, NULL, $3, ARRAY['SELLER']) RETURNING id`,   // v10.279 등급 소개몰 판매자
      [title, body, RequestCtx.actorId()]);
    return n.id;
  }

  /**
   * v10.278 (D209) — 「공지 게시」: 예정 예약이면 예약 안내(게시한 날 + 31일 ≤ 시행일일 때만) · 취소한 예약이면 취소 안내.
   *   게시하면 사용자 웹 공지(파트너센터 공지 · 소개몰 판매자센터 공지)에 맨 위 고정으로 보임.
   * v10.291 (docs/414) — at(YYYY-MM-DD)이면 그날 0시(한국) 게시 예약 · 오늘 ~ 시행일 31일 전 · 비우거나 오늘이면 바로.
   */
  async publishNotice(id: string, atRaw?: string | null) {
    const at = String(atRaw ?? '').trim();
    if (at && !/^\d{4}-\d{2}-\d{2}$/.test(at)) throw new PolicyViolation('NOTICE_AT_BAD', '공지 날짜는 YYYY-MM-DD 로 적어 주십시오.');
    return this.db.transaction(async () => {
      /* v10.291 (docs/414) — 날짜 정해 게시 예약(published_at 이 아직 안 옴)은 「게시 안 함」으로 보고 다시 정하거나 지금 게시할 수 있음 */
      const [r] = await this.db.query<{ status: string; notice: string | null; cnotice: string | null; npub: boolean; cpub: boolean; late: boolean; d: string; e: string; today: string }>(
        `SELECT r.status, r.notice_id AS notice, r.cancel_notice_id AS cnotice,
                (n.published_at IS NOT NULL AND n.published_at <= now()) AS npub, (c.published_at IS NOT NULL AND c.published_at <= now()) AS cpub,
                ((now() AT TIME ZONE 'Asia/Seoul')::date + $2::int > (r.effective_at AT TIME ZONE 'Asia/Seoul')::date) AS late,
                to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d,
                to_char((r.effective_at AT TIME ZONE 'Asia/Seoul')::date - $2::int, 'YYYY-MM-DD') AS e,
                to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS today
           FROM hlt_rate_schedules r LEFT JOIN notices n ON n.id = r.notice_id LEFT JOIN notices c ON c.id = r.cancel_notice_id
          WHERE r.id::text = $1 FOR UPDATE OF r`, [id, NOTICE_DAYS]);
      if (!r) throw new NotFound('요율 예약을 찾을 수 없습니다.');
      let target: string | null = null, kind = '';
      if (r.status === 'SCHEDULED' && r.notice && !r.npub) {
        if (r.late) throw new PolicyViolation('NOTICE_LATE', `시행일(${r.d})까지 30일이 남지 않아 공지할 수 없습니다(마지막 날 ${r.e}) — 예약을 취소하고 시행일을 다시 정해 예약하십시오.`);
        target = r.notice; kind = 'SCHEDULE';
      } else if (r.status === 'CANCELED' && r.cnotice && !r.cpub) {
        target = r.cnotice; kind = 'CANCEL';
      }
      if (!target) throw new StateConflict('NOTICE_DONE', '게시할 공지가 없습니다 — 이미 게시했거나 공지 초안이 없는 예약입니다.');
      if (kind === 'SCHEDULE' && at && at !== r.today) {
        if (at < r.today || at > r.e) {
          throw new PolicyViolation('NOTICE_AT_RANGE', `공지 날짜는 오늘(${r.today})부터 ${r.e}까지 정할 수 있습니다 — 시행일(${r.d}) 31일 전까지(입점 약관 제17조 4항).`);
        }
        await this.db.query(`UPDATE notices SET published_at = ($2::date)::timestamp AT TIME ZONE 'Asia/Seoul', is_pinned = true WHERE id = $1`, [target, at]);
        return { ok: true, noticeId: target, kind, at, note: `예약 안내 공지를 ${at} 0시에 게시하도록 정했습니다 — 그때부터 파트너센터 공지 · 판매자센터에 보입니다.` };
      }
      await this.db.query(`UPDATE notices SET published_at = now(), is_pinned = true WHERE id = $1`, [target]);
      return { ok: true, noticeId: target, kind, at: r.today, note: kind === 'SCHEDULE' ? '예약 안내 공지를 게시했습니다.' : '변경 취소 안내 공지를 게시했습니다.' };
    });
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
              (SELECT count(*)::int FROM fn_hlt_rate_sched_sellers(r.scope, r.target)) AS "affectedNow",
              r.notice_id AS "noticeId", n.title AS "noticeTitle", n.body AS "noticeBody", n.published_at AS "noticePublishedAt", (n.published_at > now()) AS "noticeScheduled",
              r.cancel_notice_id AS "cancelNoticeId", c.title AS "cancelNoticeTitle", c.body AS "cancelNoticeBody", c.published_at AS "cancelNoticePublishedAt",
              ((now() AT TIME ZONE 'Asia/Seoul')::date + ${NOTICE_DAYS} > (r.effective_at AT TIME ZONE 'Asia/Seoul')::date) AS "noticeLate",
              /* v10.283 (D212) 읽음 n / 대상 m · 다시 알림 */
              (SELECT count(*)::int FROM hlt_sellers s JOIN notice_reads nr ON nr.account_id = s.account_id AND nr.notice_id = r.notice_id
                WHERE s.id IN (SELECT fn_hlt_rate_sched_sellers(r.scope, r.target))) AS "noticeReads",
              (SELECT max(m.at) FROM hlt_rate_reminds m WHERE m.schedule_id = r.id) AS "remindedAt",
              (SELECT count(*)::int FROM hlt_rate_reminds m WHERE m.schedule_id = r.id) AS "reminds"
         FROM hlt_rate_schedules r LEFT JOIN accounts a ON a.id = r.created_by
         LEFT JOIN notices n ON n.id = r.notice_id LEFT JOIN notices c ON c.id = r.cancel_notice_id
        ORDER BY (r.status = 'SCHEDULED') DESC, r.effective_at DESC LIMIT 50`);
  }

  /** v10.283 (D212 · docs/411) — 예약 안내 공지를 안 읽은 영향 판매자에게만 다시 알림(24시간에 한 번 · 기록) */
  async remind(id: string) {
    return this.db.transaction(async () => {
      const [r] = await this.db.query<{ scope: string; target: string; ok: boolean; notice: string | null; title: string | null; d: string; soon: boolean }>(
        `SELECT r.scope, r.target, (r.status = 'SCHEDULED' AND r.effective_at > now() AND n.published_at IS NOT NULL AND n.published_at <= now()) AS ok,
                r.notice_id AS notice, n.title, to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d,
                EXISTS (SELECT 1 FROM hlt_rate_reminds m WHERE m.schedule_id = r.id AND m.at > now() - interval '24 hours') AS soon
           FROM hlt_rate_schedules r LEFT JOIN notices n ON n.id = r.notice_id WHERE r.id::text = $1 FOR UPDATE OF r`, [id]);
      if (!r) throw new NotFound('요율 예약을 찾을 수 없습니다.');
      if (!r.ok) throw new StateConflict('REMIND_NOT_READY', '예약 안내 공지를 게시한 예정 예약만 다시 알릴 수 있습니다.');
      if (r.soon) throw new StateConflict('REMIND_TOO_SOON', '다시 알림은 24시간에 한 번만 보낼 수 있습니다.');
      const rows = await this.db.query<{ id: string }>(
        `INSERT INTO notifications (account_id, event_code, title, body, link_url)
         SELECT s.account_id, 'SELLER_RATE_SCHEDULED', $3, $4, '/health/seller/center' FROM hlt_sellers s
          WHERE s.id IN (SELECT fn_hlt_rate_sched_sellers($1, $2)) AND s.account_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM notice_reads nr WHERE nr.notice_id = $5 AND nr.account_id = s.account_id)
         RETURNING id`,
        [r.scope, r.target, '[다시 알림] 판매 수수료율 변경 예정 안내',
         `${r.d} 부터 판매 수수료율이 바뀝니다 — 판매자센터 「소개몰 공지」의 「${r.title ?? ''}」를 확인해 주십시오(입점 약관 제17조 4항).`, r.notice]);
      if (!rows.length) throw new StateConflict('ALL_READ', '영향받는 판매자가 모두 공지를 읽었습니다 — 다시 알릴 곳이 없습니다.');
      await this.db.query(`INSERT INTO hlt_rate_reminds (schedule_id, sent, by_account) VALUES ($1, $2, $3)`, [id, rows.length, RequestCtx.actorId()]);
      return { ok: true, sent: rows.length, note: `안 읽은 판매자 ${rows.length}곳에 다시 알렸습니다.` };
    });
  }

  /** 운영 — 시행 전 예약 취소(사유 · 판매자에게 알림) */
  async cancel(id: string, reasonRaw: string) {
    const reason = String(reasonRaw ?? '').trim();
    if (reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '취소 사유를 적어 주십시오 — 판매자에게 알리고 기록에 남습니다.');
    return this.db.transaction(async () => {
      const [r] = await this.db.query<{ scope: string; target: string; status: string; due: boolean; d: string; npub: boolean; nsched: boolean; notice: string | null }>(
        `SELECT r.scope, r.target, r.status, r.effective_at <= now() AS due, to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d,
                (n.published_at IS NOT NULL AND n.published_at <= now()) AS npub,
                (n.published_at > now()) AS nsched, r.notice_id AS notice
           FROM hlt_rate_schedules r LEFT JOIN notices n ON n.id = r.notice_id WHERE r.id::text = $1 FOR UPDATE OF r`, [id]);
      if (!r) throw new NotFound('요율 예약을 찾을 수 없습니다.');
      if (r.status !== 'SCHEDULED' || r.due) throw new StateConflict('SCHEDULE_CLOSED', '이미 시행했거나 취소한 예약입니다 — 시행 시각이 지나면 취소할 수 없습니다.');
      await this.db.query(
        `UPDATE hlt_rate_schedules SET status = 'CANCELED', canceled_by = $2, canceled_at = now(), cancel_reason = $3 WHERE id::text = $1`,
        [id, RequestCtx.actorId(), reason]);
      const sent = await this.notifySellers(r.scope, r.target, 'SELLER_RATE_SCHEDULE_CANCELED', '판매 수수료율 변경 예정이 취소되었습니다',
        `${r.d} 부터 바뀔 예정이던 판매 수수료율 변경을 취소했습니다 — 지금 요율 그대로입니다 · 사유: ${reason}`);
      /* v10.291 (docs/414) — 날짜 정해 게시 예약만 하고 아직 안 나간 공지는 거둠(초안으로 · 판매자에게 보인 적 없음 → 취소 안내 없음) */
      if (r.nsched && r.notice) await this.db.query(`UPDATE notices SET published_at = NULL WHERE id = $1 AND published_at > now()`, [r.notice]);
      let cancelNoticeId: string | null = null;   // v10.278 — 예약 안내를 이미 게시했으면 취소 안내 초안
      if (r.npub) {
        cancelNoticeId = await this.draftNotice(`판매 수수료율 변경 취소 안내(${r.d} 시행 예정이던 변경)`, [
          `${r.d} 부터 바뀔 예정이라고 공지한 판매 수수료율 변경을 취소합니다. 지금 요율 그대로입니다.`,
          ``,
          `- 사유: ${reason}`,
          ``,
          `해당 판매자께는 따로 알려 드렸습니다. 궁금한 점은 고객센터로 문의해 주십시오.`,
        ].join('\n'));
        await this.db.query(`UPDATE hlt_rate_schedules SET cancel_notice_id = $2 WHERE id::text = $1`, [id, cancelNoticeId]);
      }
      return { ok: true, status: 'CANCELED', notified: sent, cancelNoticeId,
        note: cancelNoticeId ? `예약을 취소했습니다 — 판매자 ${sent}곳에 알렸습니다. 게시한 공지가 있어 「변경 취소 안내」 초안을 만들었습니다 — 「공지 게시」로 게시해 주십시오.`
          : r.nsched ? `예약을 취소했습니다 — 판매자 ${sent}곳에 알렸습니다. 게시 예약한 공지는 나가기 전이라 거뒀습니다.`
          : `예약을 취소했습니다 — 판매자 ${sent}곳에 알렸습니다.` };
    });
  }

  /** v10.278 (D209) — 예약한 지 하루가 지나도 예약 안내 공지를 게시하지 않은 예정 예약 */
  noticeMissing() {
    return this.db.query<{ id: string; effectiveDate: string; target: string; scope: string }>(
      `SELECT r.id, r.scope, r.target, to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "effectiveDate"
         FROM hlt_rate_schedules r LEFT JOIN notices n ON n.id = r.notice_id
        WHERE r.status = 'SCHEDULED' AND r.effective_at > now() AND r.created_at < now() - interval '1 day' AND n.published_at IS NULL
        ORDER BY r.effective_at`);
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
