import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { ReviewItem, REVIEW_SLA_HOURS } from './review.types';

@Injectable()
export class ReviewRepository {
  constructor(private readonly db: DatabaseService) {}

  /** 트랜잭션은 RequestCtx 가 전달합니다. tx 인자를 넘기지 않습니다 —
   *  인자로 넘기면 한 곳만 빠뜨려도 그 쿼리가 트랜잭션 밖에서 돕니다. */
  async enqueue(
    input: { targetType: string; targetId: string; gwanCode?: string; submittedBy: string },
  ): Promise<string> {
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO review_items (target_type, target_id, gwan_code, submitted_by, sla_due_at)
       VALUES ($1, $2, $3, $4, fn_review_sla_due(now(), $5::int))   /* v10.31 (w2) — 영업일 기준(토 · 일 제외 · 시안 「영업일 기준 24시간」 · D056) */
       RETURNING id`,
      [input.targetType, input.targetId, input.gwanCode ?? null, input.submittedBy, REVIEW_SLA_HOURS],
    );
    await this.db.query(
      `INSERT INTO review_events (review_item_id, event, actor_id) VALUES ($1,'SUBMITTED',$2)`,
      [row.id, input.submittedBy],
    );
    return row.id;
  }

  /**
   * 큐 조회. 부분 인덱스 idx_review_queue 를 그대로 탑니다.
   * 정렬은 SLA 마감 순 — 오래 기다린 건이 먼저입니다.
   */
  queue(params: { gwanCode?: string; cursor?: string; limit: number; status?: string }) {
    /* v10.31 (10/10 시안 기준) — 시안 줄마다 「매물 제목 · 등록자」, 「반려」 탭.
     *   status=REJECTED 면 최근 30일 반려 건(반려 시각 순 · 최근 것이 위). 그 밖에는 대기 건(SLA 마감 순 — 전과 같음). */
    const rejected = params.status === 'REJECTED';
    return this.db.query<ReviewItem>(
      `SELECT ri.id, ri.target_type AS "targetType", ri.target_id AS "targetId",
              ri.gwan_code AS "gwanCode", ri.submitted_by AS "submittedBy",
              ri.submitted_at AS "submittedAt", ri.sla_due_at AS "slaDueAt",
              ri.assignee_id AS "assigneeId", ri.status,
              ri.reject_reason_code AS "rejectReasonCode", ri.reject_memo AS "rejectMemo",
              rc.label AS "rejectReasonLabel",
              ri.decided_at AS "decidedAt", ri.decision_mode AS "decisionMode",
              ri.manual_reasons AS "manualReasons",
              coalesce(l.title, rq.title, bl.title, bz.company_name) AS "targetTitle",
              coalesce(c.name, c2.name) AS "categoryName",
              coalesce(sb.company_name, sa.name) AS "submitterName",
              to_char(${rejected ? 'ri.decided_at' : 'ri.sla_due_at'} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || ri.id AS "cursorKey"
         FROM review_items ri
         LEFT JOIN listings l  ON ri.target_type = 'LISTING' AND l.id = ri.target_id
         LEFT JOIN requests rq ON ri.target_type = 'REQUEST' AND rq.id = ri.target_id
         LEFT JOIN listing_badges lb ON ri.target_type = 'LISTING_BADGE' AND lb.id = ri.target_id
         LEFT JOIN listings bl ON bl.id = lb.listing_id
         LEFT JOIN businesses bz ON ri.target_type = 'BUSINESS' AND bz.id = ri.target_id
         LEFT JOIN categories c  ON c.id = l.category_id
         LEFT JOIN categories c2 ON c2.id = rq.category_id
         LEFT JOIN accounts sa ON sa.id = ri.submitted_by
         LEFT JOIN businesses sb ON sb.account_id = sa.id AND sb.verified_at IS NOT NULL
         LEFT JOIN review_reason_codes rc ON rc.code = ri.reject_reason_code
        WHERE ${rejected
          ? `ri.status = 'REJECTED' AND ri.decided_at > now() - interval '30 days'
             AND ($2::timestamptz IS NULL OR (ri.decided_at, ri.id) < ($2::timestamptz, coalesce($4::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))`
          : `ri.status IN ('QUEUED','IN_PROGRESS')
             AND ($2::timestamptz IS NULL OR (ri.sla_due_at, ri.id) > ($2::timestamptz, coalesce($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)))`}
          AND ($1::text IS NULL OR ri.gwan_code = $1)
        ORDER BY ${rejected ? 'ri.decided_at DESC, ri.id DESC' : 'ri.sla_due_at ASC, ri.id ASC'}
        LIMIT $3`,
      [params.gwanCode ?? null, params.cursor ? params.cursor.split('|')[0] : null, params.limit,
       params.cursor && params.cursor.includes('|') ? params.cursor.split('|')[1] : null],
    );
  }

  /** v10.31 — 시안 탭 숫자(대기 · SLA 임박 · 반려). 화면이 목록을 받아 세던 것을 서버에서 셉니다(50건 넘는 쪽도 맞게) */
  async counts(gwanCode?: string) {
    const [r] = await this.db.query<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE status IN ('QUEUED','IN_PROGRESS')) AS pending,
              count(*) FILTER (WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at >= now()
                                 AND sla_due_at < now() + interval '4 hours') AS "slaSoon",
              count(*) FILTER (WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at < now()) AS "slaOver",
              count(*) FILTER (WHERE status = 'REJECTED' AND decided_at > now() - interval '30 days') AS rejected
         FROM review_items WHERE ($1::text IS NULL OR gwan_code = $1)`, [gwanCode ?? null]);
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
  }

  async decide(
    id: string,
    actorId: string,
    decision: 'APPROVED' | 'REJECTED',
    reasonCode?: string,
    memo?: string,
  ) {
    // CHECK (status <> 'REJECTED' OR reject_reason_code IS NOT NULL) 가 DB 에 있으므로
    // 사유 없는 반려는 여기서 통과해도 DB 가 막습니다.
    const [row] = await this.db.query<ReviewItem>(
      `UPDATE review_items
          SET status = $2, decision_by = $3, decided_at = now(),
              reject_reason_code = $4, reject_memo = $5
        WHERE id = $1 AND status IN ('QUEUED','IN_PROGRESS')
        RETURNING id, target_type AS "targetType", target_id AS "targetId", status`,
      [id, decision, actorId, reasonCode ?? null, memo ?? null],
    );
    if (!row) return null; // 이미 처리됨 → 서비스에서 409

    await this.db.query(
      `INSERT INTO review_events (review_item_id, event, actor_id, reason_code, memo)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, decision, actorId, reasonCode ?? null, memo ?? null],
    );
    return row;
  }

  /** SLA 위반·임박 집계. 검수는 병목이므로 상시 노출합니다. */
  throughput() {
    return this.db.query(`SELECT * FROM v_review_throughput ORDER BY day DESC LIMIT 30`);
  }
}
