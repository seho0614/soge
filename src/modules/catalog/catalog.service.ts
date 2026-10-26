import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService, private readonly i18n: I18nService) {}

  gwans() {
    return this.db.query(
      `SELECT g.code, g.name, g.description, g.is_active AS "isActive",
              (SELECT count(*)::int FROM listings l
                WHERE l.gwan_code = g.code AND l.status = 'PUBLISHED') AS "listingCount"
         FROM gwans g WHERE g.is_active ORDER BY g.sort_order`);
  }

  async categories(gwanCode?: string) {
    const rows = await this.db.query<Record<string, any>>(
      `SELECT c.id, c.gwan_code AS "gwanCode", c.code, c.name,
              coalesce(cg.grade_code,'G3') AS "gradeCode",
              c.fee_bearer AS "feeBearer",
              (SELECT guide_rate FROM fee_guidelines f WHERE f.category_id = c.id LIMIT 1) AS "guideRate",
              /* v10.31 — 등록 폼이 제한업종을 고르기에서 뺄 수 있게(서버는 등록 때 다시 막음 · w1) · 관 화면 공개 목록은 제한 업종을 숨김 · 안심소개 축(w2) */
              c.restricted_code AS "restrictedCode",
              (c.restricted_code IS NOT NULL) AS restricted, c.axis
         FROM categories c
         LEFT JOIN LATERAL (
           SELECT grade_code FROM category_grades g
            WHERE g.category_id = c.id AND g.effective_from <= now()
            ORDER BY g.effective_from DESC LIMIT 1) cg ON true
        WHERE c.status = 'APPROVED' AND ($1::text IS NULL OR c.gwan_code = $1)
        ORDER BY c.gwan_code, c.name`, [gwanCode ?? null]);
    /* v10.103 (3-1) — 분류 이름만 화면 언어로(code · id 는 그대로 · 순서는 원문 이름순) */
    return this.i18n.overlay(rows, 'CATEGORY', (r) => String(r.id), { name: 'name' });
  }

  adminCategories() {
    return this.db.query(
      `SELECT c.id, c.gwan_code AS "gwanCode", c.code, c.name, c.status,
              c.labor_law_flag AS "laborLawFlag", c.restricted_code AS "restrictedCode",
              c.fee_bearer AS "feeBearer", coalesce(cg.grade_code,'G3') AS "gradeCode",
              (SELECT count(*)::int FROM listings l WHERE l.category_id = c.id) AS "listingCount"
         FROM categories c
         LEFT JOIN LATERAL (
           SELECT grade_code FROM category_grades g WHERE g.category_id = c.id
            ORDER BY g.effective_from DESC LIMIT 1) cg ON true
        ORDER BY c.status, c.gwan_code, c.name`);
  }

  /** A-14 판정은 DB 트리거가 강제합니다. 여기서 다시 검사하지 않습니다. */
  async decideCategory(id: string, dto: {
    status: string; laborLawFlag: string; laborLawMemo?: string;
    feeBearer?: string; gradeCode?: string; restrictedCode?: string;
  }) {
    return this.db.transaction(async () => {
      const [row] = await this.db.query(
        `UPDATE categories
            SET status = $2, labor_law_flag = $3, labor_law_memo = $4,
                labor_law_checked_at = now(),
                fee_bearer = coalesce($5, fee_bearer),
                restricted_code = coalesce($6, restricted_code),
                approved_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END
          WHERE id = $1
        RETURNING id, code, name, status, labor_law_flag AS "laborLawFlag"`,
        [id, dto.status, dto.laborLawFlag, dto.laborLawMemo ?? null,
         dto.feeBearer ?? null, dto.restrictedCode ?? null]);
      if (!row) throw new StateConflict('NOT_FOUND', '업종을 찾을 수 없습니다.');

      if (dto.gradeCode) {
        await this.db.query(
          `INSERT INTO category_grades (category_id, grade_code) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`, [id, dto.gradeCode]);
      }
      return row;
    });
  }

  async policies() {
    const [restricted, banned, auto] = await Promise.all([
      this.db.query(
        `SELECT code, name, legal_basis AS "legalBasis", gwan_code AS "gwanCode",
                mode, block_message AS "blockMessage", is_active AS "isActive"
           FROM restricted_industries ORDER BY gwan_code, code`),
      this.db.query<{ n: number }>(`SELECT count(*)::int n FROM banned_words WHERE is_active`),
      this.db.query<{ key: string; enabled: boolean; num_value: string | null; description: string }>(
        `SELECT key, enabled, num_value, description FROM auto_review_policies ORDER BY key`),
    ]);
    return {
      restrictedIndustries: restricted,
      bannedWordCount: banned[0]?.n ?? 0,
      autoReviewPolicies: Object.fromEntries(auto.map(p => [p.key, {
        enabled: p.enabled, numValue: p.num_value != null ? Number(p.num_value) : null,   // v10.71 — 전: 0 이 「없음」으로 보임
        description: p.description,
      }])),
    };
  }

  /**
   * 제한업종 지정. BLOCK 이면 기존 노출 매물이 즉시 중단되고 안내가 발송됩니다.
   * 그 처리는 DB 트리거(fn_enforce_new_restriction)가 합니다.
   */
  updateRestriction(code: string, dto: { gwanCode: string; mode: string; blockMessage?: string }) {
    return this.db.query(
      `UPDATE restricted_industries
          SET mode = $3, block_message = coalesce($4, block_message), updated_at = now()
        WHERE code = $1 AND gwan_code = $2
      RETURNING code, name, gwan_code AS "gwanCode", mode,
                block_message AS "blockMessage", is_active AS "isActive",
                legal_basis AS "legalBasis"`,
      [code, dto.gwanCode, dto.mode, dto.blockMessage ?? null]);
  }

  /** 목적지 없는 링크도 함께 내려 줍니다. 화면이 점선으로 그립니다. */
  /* v10.119 — 링크 이름 번역(FOOTER_LINK · D125)을 얹음. 번호(_id)는 응답에서 지움 */
  async footerLinks() {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT section, label, target_type AS "targetType", target_ref AS "targetRef",
              available, tip, id AS "_id"
         FROM v_footer_links ORDER BY sort_order`);
    return this.i18n.overlayBy(rows, 'FOOTER_LINK', '_id', { label: 'label' });
  }

  /** 자동검수 규칙. 코드가 아니라 데이터입니다 (B-10) */
  async updateAutoReviewPolicy(key: string, enabled?: boolean, numValue?: number) {
    const [row] = await this.db.query(
      `UPDATE auto_review_policies
          SET enabled = coalesce($2, enabled), num_value = coalesce($3, num_value),
              updated_by = $4, updated_at = now()   -- v10.71 — 바꾼 사람도 표에(범위 검사는 DB · POLICY_VALUE)
        WHERE key = $1
      RETURNING key, enabled, num_value AS "numValue", description`,
      [key, enabled ?? null, numValue ?? null, RequestCtx.actorId() ?? null]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 규칙입니다.');
    return row;
  }

  /** 가입 유형. **개인 회원이 맨 위**입니다 — 가입 문턱이 가장 낮습니다. */
  signupTypes() {
    return this.db.query(
      `SELECT code, label, sub,
              needs_biz  AS "needsBiz",
              needs_corp AS "needsCorp"
         FROM v_signup_order`);
  }

  /** 로그인 후 랜딩. 중지된 관이면 빈 값으로 돌려 메인으로 보냅니다. */
  async landing(forNewMember = false) {
    /* v10.37 (10/13 대표 답 「사용」) — 신규 가입자 첫 화면(site.landing_new_member)도 같은 규칙으로 돌려 줍니다. 관이 아닌 값(HERO 등)은 빈 값 = 메인 */
    const [r] = await this.db.query<any>(
      `SELECT coalesce(s.value,'') AS value
         FROM site_settings s
         LEFT JOIN gwans g ON g.code = s.value
        WHERE s.key = $1
          AND (s.value = '' OR g.is_active)`, [forNewMember ? 'site.landing_new_member' : 'site.landing_after_login']);
    return { value: r?.value ?? '' };
  }
}
