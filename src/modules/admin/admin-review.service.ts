import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { StateConflict } from '../../core/errors';

/**
 * 백오피스 — 배지 검수 · 자동검수 통계 · 표본 감사 (v10.96 · admin.service.ts 에서 함수 본문을 그대로 옮김).
 */
@Injectable()
export class AdminReviewService {
  constructor(private readonly db: DatabaseService) {}
  /** 배지 신청 검수 (SB-ADM-BDG-010). 배지는 전건 수동입니다 */
  badges() {
    return this.db.query(
      `SELECT b.id, b.badge_type AS "badgeType",
              coalesce(cl.label, b.badge_type) AS "badgeLabel",
              b.listing_id AS "listingId", l.title AS "listingTitle",
              coalesce(bz.company_name, a.name) AS "ownerName",
              b.urgent_reason AS "urgentReason", b.valid_until AS "validUntil",
              b.evidence, b.requested_at AS "requestedAt",
              ri.id AS "reviewItemId"
         FROM listing_badges b
         JOIN listings l ON l.id = b.listing_id
         JOIN accounts a ON a.id = b.requested_by
         LEFT JOIN businesses bz ON bz.account_id = a.id AND bz.verified_at IS NOT NULL
         LEFT JOIN code_labels cl ON cl.domain='badge.type' AND cl.code=b.badge_type
         LEFT JOIN review_items ri ON ri.target_type='LISTING_BADGE' AND ri.target_id=b.id
        WHERE b.status = 'IN_REVIEW'
        ORDER BY b.requested_at`);
  }

  /** v10.31 — 배지 발급 이력(시안 SB-ADM-BDG-010 「발급 이력」) */
  badgeHistory() {
    return this.db.query(
      `SELECT b.id, coalesce(bz.company_name, a.name) AS "ownerName", coalesce(cl.label, b.badge_type) AS "badgeLabel",
              l.title AS "listingTitle", b.status, b.decided_at AS "decidedAt", b.valid_until AS "validUntil",
              b.reject_reason_code AS "rejectReasonCode"
         FROM listing_badges b
         JOIN listings l ON l.id = b.listing_id
         JOIN accounts a ON a.id = b.requested_by
         LEFT JOIN businesses bz ON bz.account_id = a.id AND bz.verified_at IS NOT NULL
         LEFT JOIN code_labels cl ON cl.domain='badge.type' AND cl.code=b.badge_type
        WHERE b.status <> 'IN_REVIEW' AND b.decided_at IS NOT NULL
        ORDER BY b.decided_at DESC LIMIT 100`);
  }

  /** 표본 감사 (SB-ADM-REV-040). 자동 승인이 옳았는지 사후 확인 */
  /** 수동 검수 사유별 건수. manual_reasons 는 배열이라 풀어서 셉니다. (20260930 신설) */
  autoReviewReasons() {
    return this.db.query(
      `SELECT r AS reason, count(*)::int AS cnt
         FROM review_items, unnest(manual_reasons) AS r
        WHERE submitted_at > now() - interval '30 days'
        GROUP BY r ORDER BY cnt DESC, r`);
  }

  /** 일별 자동화율. (20260930 신설) */
  autoReviewRate() {
    return this.db.query(
      `SELECT day::text AS day, auto_rate_pct::float8 AS "autoRatePct",
              submitted::int, auto_approved::int AS "autoApproved", manual_queue::int AS "manualQueue"
         FROM v_auto_review_rate
        WHERE day > current_date - 30
        ORDER BY day DESC`);
  }

  auditSamples() {
    return this.db.query(
      `SELECT ri.id, ri.target_id AS "targetId", l.title,
              l.desired_fee AS "desiredFee", ri.decided_at AS "decidedAt",
              (ri.reject_memo IS NULL) AS pending, ri.reject_memo AS memo
         FROM review_items ri
         LEFT JOIN listings l ON l.id = ri.target_id
        WHERE ri.audit_sampled AND ri.decision_mode = 'AUTO'
        ORDER BY ri.decided_at DESC LIMIT 50`);
  }

  /** v10.31 (시안 SB-ADM-REV-040 칸 「자동 승인 · 표본 · 불일치 · 표본율」) — 최근 30일 */
  async auditSummary() {
    const [r] = await this.db.query<Record<string, string | null>>(
      `SELECT count(*) FILTER (WHERE decision_mode = 'AUTO' AND status = 'APPROVED') AS auto,
              count(*) FILTER (WHERE audit_sampled AND decision_mode = 'AUTO') AS sampled,
              count(*) FILTER (WHERE audit_sampled AND decision_mode = 'AUTO' AND reject_memo LIKE '감사: 부적정%') AS mismatch,
              count(*) FILTER (WHERE audit_sampled AND decision_mode = 'AUTO' AND reject_memo IS NULL) AS pending,
              (SELECT num_value FROM auto_review_policies WHERE key = 'sample_audit_rate') AS rate
         FROM review_items WHERE decided_at > now() - interval '30 days'`);
    return { autoApproved: Number(r.auto), sampled: Number(r.sampled), mismatch: Number(r.mismatch),
             pending: Number(r.pending), ratePct: r.rate == null ? null : Number(r.rate) };
  }

  /**
   * v10.31 (시안 「표본 다시 뽑기」) — 최근 30일 자동 승인 건 중 표본율에 모자라는 만큼 무작위로 더 뽑습니다.
   * 이미 뽑힌 표본은 그대로(결과가 지워지지 않음) — 모자란 만큼만 더합니다.
   */
  async resample() {
    const rows = await this.db.query<{ id: string }>(
      `WITH cfg AS (SELECT coalesce((SELECT num_value FROM auto_review_policies WHERE key = 'sample_audit_rate'), 5) AS rate),
            pool AS (SELECT id, audit_sampled FROM review_items
                      WHERE decision_mode = 'AUTO' AND status = 'APPROVED' AND decided_at > now() - interval '30 days'),
            need AS (SELECT greatest(ceil(count(*) * (SELECT rate FROM cfg) / 100.0) - count(*) FILTER (WHERE audit_sampled), 0)::int AS n FROM pool)
       UPDATE review_items SET audit_sampled = true
        WHERE id IN (SELECT id FROM pool WHERE NOT audit_sampled ORDER BY random() LIMIT (SELECT n FROM need))
       RETURNING id`);
    return { added: rows.length, note: rows.length ? `표본 ${rows.length}건을 더 뽑았습니다.` : '표본율을 이미 채웠습니다 — 더 뽑을 것이 없습니다.' };
  }

  /** 감사 결과 기록. 틀렸으면 노출을 중단합니다 */
  async recordAudit(reviewItemId: string, correct: boolean, memo?: string) {
    return this.db.transaction(async () => {
      const [ri] = await this.db.query<{ target_id: string }>(
        `UPDATE review_items SET reject_memo = $2 WHERE id = $1 RETURNING target_id`,
        [reviewItemId, correct ? '감사: 적정' : `감사: 부적정 — ${memo ?? ''}`]);
      if (!ri) throw new StateConflict('NOT_FOUND', '감사 대상을 찾을 수 없습니다.');
      if (!correct) {
        await this.db.query(
          `UPDATE listings SET status = 'SUSPENDED' WHERE id = $1 AND status = 'PUBLISHED'`,
          [ri.target_id]);
      }
      return { reviewItemId, correct };
    });
  }

  reviewReasons() {
    return this.db.query(
      `SELECT code, label, category FROM review_reason_codes
        WHERE is_active ORDER BY sort_order`);
  }
}
