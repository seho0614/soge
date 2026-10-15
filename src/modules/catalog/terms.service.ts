import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * 약관 관리 (B-12).
 *
 * 법무 회신이 오면 여기로 들어옵니다. SQL 을 직접 치지 않게 하는 것이 목적입니다 —
 * 직접 치면 status 만 바꾸고 body 를 빼먹거나, 시행일을 과거로 넣습니다.
 *
 * 발행 조건은 DB 트리거(fn_assert_term_publish)가 강제합니다.
 */
@Injectable()
export class TermsService {
  constructor(private readonly db: DatabaseService) {}

  /** 관리자용. 미발행 약관도 보입니다. */
  listAll() {
    return this.db.query(
      `SELECT code, version, title, coalesce(body,'') AS body, status,
              is_required AS "isRequired", blocked_by AS "blockedBy",
              CASE WHEN effective_from = 'infinity' THEN NULL
                   ELSE effective_from END AS "effectiveFrom"
         FROM terms ORDER BY display_order, code, effective_from DESC`);
  }

  /**
   * 초안 저장. 기존 버전을 덮지 않고 새 버전을 만듭니다 —
   * 이미 동의받은 문서를 고치면 동의 이력의 근거가 사라집니다.
   */
  async upsertDraft(code: string, dto: {
    version: string; title: string; body: string; isRequired?: boolean;
  }) {
    const [base] = await this.db.query<{ is_required: boolean; display_order: number }>(
      `SELECT is_required, display_order FROM terms WHERE code = $1 LIMIT 1`, [code]);
    if (!base) throw new NotFound('약관 코드를 찾을 수 없습니다.');

    const [row] = await this.db.query(
      `INSERT INTO terms (code, version, title, body, is_required,
                          effective_from, status, display_order)
       VALUES ($1,$2,$3,$4,$5,'infinity','LEGAL_REVIEW',$6)
       ON CONFLICT (code, version) DO UPDATE
         SET title = EXCLUDED.title, body = EXCLUDED.body,
             is_required = EXCLUDED.is_required
       RETURNING code, version, status`,
      [code, dto.version, dto.title, dto.body,
       dto.isRequired ?? base.is_required, base.display_order]);
    return row;
  }

  /**
   * 발행. 이 시점부터 가입 화면과 푸터에 나타납니다.
   * 내용이 비었거나 시행일이 없으면 DB 가 거부합니다.
   */
  async publish(code: string, dto: { version: string; effectiveFrom: string }) {
    if (new Date(dto.effectiveFrom) < new Date(Date.now() - 86_400_000)) {
      throw new PolicyViolation(
        'EFFECTIVE_DATE_IN_PAST',
        '시행일을 과거로 지정할 수 없습니다. 동의 이력의 기준이 되는 날짜입니다.');
    }

    return this.db.transaction(async () => {
      const [row] = await this.db.query<{ code: string; version: string; status: string }>(
        `UPDATE terms
            SET status = 'PUBLISHED', effective_from = $3, blocked_by = NULL
          WHERE code = $1 AND version = $2
        RETURNING code, version, status`,
        [code, dto.version, dto.effectiveFrom]);
      if (!row) throw new NotFound('해당 버전의 약관이 없습니다.');

      // 이전 버전은 보관 처리. 삭제하지 않습니다 — 동의 이력이 참조합니다.
      await this.db.query(
        `UPDATE terms SET status = 'ARCHIVED'
          WHERE code = $1 AND version <> $2 AND status = 'PUBLISHED'`,
        [code, dto.version]);

      const [n] = await this.db.query<{ c: string }>(
        `SELECT count(*) AS c FROM v_open_blockers`);
      return { ...row, remainingBlockers: Number(n.c) };
    });
  }

  /** 오픈 차단 항목. 설정·약관·푸터를 함께 봅니다. */
  blockers() {
    return this.db.query(`SELECT kind, item, reason FROM v_open_blockers`);
  }
}
