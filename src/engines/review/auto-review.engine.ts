import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

/**
 * 자동검수 엔진.
 *
 * 판정 규칙 자체는 DB 함수 fn_auto_review_reasons 에 있습니다.
 * 앱에 규칙을 복제하지 않는 이유: 두 곳에 두면 어긋나고, 어긋나면
 * "왜 이 건이 자동 승인됐는가"를 설명할 수 없습니다.
 *
 * 이 클래스가 하는 일은 셋뿐입니다.
 *   판정 조회 · 정책 조정 · 자동화율 관측
 */
export type ManualReason =
  | 'AUTO_DISABLED' | 'UNVERIFIED_BUSINESS' | 'FIRST_LISTING' | 'HIGH_FEE'
  | 'PRIOR_REJECT' | 'GATED_CATEGORY' | 'THIN_CONTENT'
  | `TARGET_TYPE_${string}`;

export interface AutoReviewPolicy {
  key: string;
  enabled: boolean;
  numValue: number | null;
  description: string;
}

@Injectable()
export class AutoReviewEngine {
  private readonly logger = new Logger(AutoReviewEngine.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * 판정 미리보기. 등록 폼에서 "지금 올리면 바로 노출될지"를 보여 줄 때 씁니다.
   * 실제 판정은 review_items INSERT 트리거가 수행합니다 — 여기서 다시 하지 않습니다.
   */
  async reasonsFor(reviewItemId: string): Promise<ManualReason[]> {
    const [row] = await this.db.query<{ reasons: ManualReason[] | null }>(
      `SELECT fn_auto_review_reasons($1) AS reasons`,
      [reviewItemId],
    );
    return row?.reasons ?? [];
  }

  policies() {
    return this.db.query<AutoReviewPolicy>(
      `SELECT key, enabled, num_value AS "numValue", description
         FROM auto_review_policies ORDER BY key`,
    );
  }

  /**
   * 정책 변경은 감사 대상입니다.
   * 자동화 범위를 넓히는 것은 사람의 검토를 줄이는 결정이므로,
   * 누가 언제 무엇을 바꿨는지가 남아야 합니다.
   */
  async updatePolicy(
    key: string,
    patch: { enabled?: boolean; numValue?: number | null },
    actorId: string,
  ) {
    return this.db.transaction(async () => {
      const [before] = await this.db.query(
        `SELECT key, enabled, num_value FROM auto_review_policies WHERE key = $1`, [key],
      );
      if (!before) return null;

      const [after] = await this.db.query(
        `UPDATE auto_review_policies
            SET enabled    = coalesce($2, enabled),
                num_value  = coalesce($3, num_value),
                updated_by = $4, updated_at = now()
          WHERE key = $1
        RETURNING key, enabled, num_value AS "numValue", description`,
        [key, patch.enabled ?? null, patch.numValue ?? null, actorId],
      );

      await this.db.query(
        `INSERT INTO audit.audit_logs
           (actor_account_id, actor_role, action, target_type, target_id, before_data, after_data)
         VALUES ($1,'ADMIN','AUTO_REVIEW_POLICY_UPDATE','POLICY',NULL,$2::jsonb,$3::jsonb)`,
        [actorId, JSON.stringify(before), JSON.stringify(after)],
      );
      return after;
    });
  }

  /** 자동화율 — 이 숫자가 곧 검수 여력입니다 */
  rate(days = 30) {
    return this.db.query(
      `SELECT * FROM v_auto_review_rate ORDER BY day DESC LIMIT $1`, [days],
    );
  }

  /** 개입 사유 분포 — 다음 자동화 후보를 여기서 찾습니다 */
  manualReasonBreakdown() {
    return this.db.query(`SELECT * FROM v_manual_reasons`);
  }

  /** 표본 감사 대기. 없으면 자동화가 옳았는지 영원히 모릅니다 */
  auditQueue() {
    return this.db.query(`SELECT * FROM v_audit_sample_queue LIMIT 100`);
  }
}
