import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 신고 접수 · 처리.
 *
 * 규칙은 대부분 DB 에 있습니다(`fn_report_guard`·`fn_report_escalate`).
 * 여기서는 **읽고 넣는 일만** 합니다 — 규칙을 앱에도 적으면 두 곳이
 * 갈라지고, 어느 쪽이 맞는지 모르게 됩니다.
 */
@Injectable()
export class AbuseService {
  constructor(private readonly db: DatabaseService) {}

  /** 신고 사유. 관 전용이 있으면 공통과 함께 옵니다. */
  reasons(gwanCode?: string) {
    return this.db.query(
      `SELECT code, label, severity, gwan_code AS "gwanCode"
         FROM report_reasons
        WHERE gwan_code IS NULL OR gwan_code = $1
        ORDER BY gwan_code NULLS FIRST, sort_order`, [gwanCode ?? null]);
  }

  /**
   * 신고 접수.
   *
   * ── 같은 사람의 반복 신고는 1건입니다 ────────────────────────────
   * 열 번 눌러 열 건으로 세면, 한 사람이 임계치를 넘겨 남의 등록을
   * 검수 큐에 올릴 수 있습니다. 이미 낸 신고가 있으면 그것을
   * 돌려줍니다.
   */
  async create(dto: {
    targetType: string; targetId: string; reasonCode: string; detail?: string;
  }) {
    const me = RequestCtx.actorId()!;

    /* 기타를 골랐으면 무엇이 문제인지 적어야 합니다 —
       처리하는 쪽이 판단할 근거가 없으면 기각밖에 할 수 없습니다. */
    if (dto.reasonCode === 'OTHER' && !dto.detail?.trim()) {
      throw new PolicyViolation('DETAIL_REQUIRED',
        '기타를 고르셨으면 무엇이 문제인지 적어 주십시오.');
    }

    const [reason] = await this.db.query<{ code: string }>(
      `SELECT code FROM report_reasons WHERE code = $1`, [dto.reasonCode]);
    if (!reason) throw new PolicyViolation('BAD_REASON', '없는 신고 사유입니다.');

    // 이미 같은 건을 신고했으면 그것을 돌려줍니다.
    const [dup] = await this.db.query<any>(
      `SELECT id, state, reason_code AS "reasonCode", resolution,
              created_at AS "createdAt"
         FROM reports
        WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3`,
      [me, dto.targetType, dto.targetId]);
    if (dup) return { ...dup, already: true };

    const [r] = await this.db.query<any>(
      `INSERT INTO reports (target_type, target_id, reason_code, detail, reporter_id, state)
       VALUES ($1,$2,$3,$4,$5,'OPEN')
       RETURNING id, state, reason_code AS "reasonCode", created_at AS "createdAt"`,
      [dto.targetType, dto.targetId, dto.reasonCode, dto.detail ?? null, me]);

    /* 임계치를 넘으면 트리거가 검수 큐로 올립니다 —
       **자동으로 내리지는 않습니다.** 여럿이 짜고 내리는 것을 막습니다. */
    return { ...r, note: '접수되었습니다. 처리 결과를 알려 드립니다.' };
  }

  /** 내가 한 신고. 결과를 알려 주지 않으면 다시 신고합니다. */
  mine() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      `SELECT r.id, r.state, r.reason_code AS "reasonCode", rr.label AS "reasonLabel",
              r.target_type AS "targetType", r.resolution,
              r.created_at AS "createdAt", r.handled_at AS "handledAt"
         FROM reports r
         LEFT JOIN report_reasons rr ON rr.code = r.reason_code
        WHERE r.reporter_id = $1
        ORDER BY r.created_at DESC LIMIT 50`, [me]);
  }

  /** 처리 큐. 오래 방치된 것이 위로 옵니다. */
  queue(state?: string) {
    return this.db.query(
      `SELECT r.id, r.state, r.target_type AS "targetType", r.target_id AS "targetId",
              r.reason_code AS "reasonCode", rr.label AS "reasonLabel",
              rr.severity, r.detail, r.created_at AS "createdAt",
              (SELECT count(*) FROM reports x
                WHERE x.target_type = r.target_type AND x.target_id = r.target_id
                  AND x.state IN ('OPEN','QUEUED')) AS "sameTarget"
         FROM reports r
         LEFT JOIN report_reasons rr ON rr.code = r.reason_code
        WHERE r.state IN ('OPEN','QUEUED')
          AND ($1::text IS NULL OR r.state = $1)
        ORDER BY r.created_at ASC LIMIT 200`, [state ?? null]);
  }

  /**
   * 신고 처리.
   *
   * 처리 내용은 DB 가 강제합니다 — 인정이든 기각이든 비워 둘 수
   * 없습니다. 신고한 사람에게 그대로 전달되므로, **근거 없는 기각이
   * 기록에 남지 않습니다.**
   */
  async resolve(id: string, dto: { state: string; resolution: string }) {
    const me = RequestCtx.actorId()!;
    const [r] = await this.db.query<any>(
      `UPDATE reports
          SET state = $2, resolution = $3, handled_by = $4, handled_at = now()
        WHERE id = $1 AND state IN ('OPEN','QUEUED')
        RETURNING id, state, reason_code AS "reasonCode", resolution,
                  created_at AS "createdAt"`,
      [id, dto.state, dto.resolution, me]);
    if (!r) throw new StateConflict('NOT_OPEN', '이미 처리됐거나 없는 신고입니다.');

    /* 신고한 사람에게 결과를 알립니다.
       알려 주지 않으면 같은 건을 다시 신고합니다. */
    await this.db.query(
      /* notifications 에는 ref_type·ref_id 가 없습니다 —
         link_url 로 신고 내역 화면을 가리킵니다. */
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT reporter_id, 'REPORT_RESOLVED',
              '신고 처리 결과를 알려 드립니다', $2, '/my/reports'
         FROM reports WHERE id = $1
       ON CONFLICT DO NOTHING`,
      [id, dto.resolution]);

    return r;
  }
}
