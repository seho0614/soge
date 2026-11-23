import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService, private readonly i18n: I18nService) {}

  gwans() {
    return this.db.query(
      `SELECT g.code, g.name, g.description, g.is_active AS "isActive", g.is_hub AS "isHub",   /* v10.646 (D309) 새 관 — 사용자 웹 메뉴에서 허브 뺌 */
              g.icon, g.color,   /* v10.663 (D314) 관 아이콘 · 대표 색 */
              (SELECT count(*)::int FROM listings l
                WHERE l.gwan_code = g.code AND l.status = 'PUBLISHED') AS "listingCount"
         FROM gwans g WHERE g.is_active ORDER BY g.sort_order`)
      /* v10.647 (D310 · docs/792) 관 이름 · 설명 번역(승인된 것) — 사용자 웹이 새 관은 이 이름을 씀(처음 관은 사전 header.gwan) */
      .then((rows) => this.i18n.overlay(rows as Array<Record<string, any>>, 'GWAN', (r) => String(r.code), { name: 'name', description: 'description' }));
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
              (SELECT count(*)::int FROM listings l WHERE l.category_id = c.id) AS "listingCount",
              c.requested_by AS "requestedBy", ra.name AS "requestedByName", c.axis   /* v10.643 (D308) */
         FROM categories c
         LEFT JOIN accounts ra ON ra.id = c.requested_by
         LEFT JOIN LATERAL (
           SELECT grade_code FROM category_grades g WHERE g.category_id = c.id
            ORDER BY g.effective_from DESC LIMIT 1) cg ON true
        ORDER BY c.status, c.gwan_code, c.name`);
  }

  /**
   * v10.643 (D308 · docs/787) 새 업종 — 「승인 대기」로 만듦 · 만든 사람(requested_by)은 승인 못 함(DB) ·
   * 허브 관 · 소개리드는 DB 가 막음(CATEGORY_GWAN_NOT_ALLOWED) · 등급은 G3 로 시작(승인 칸에서 바꿈)
   */
  async createCategory(dto: {
    gwanCode: string; code: string; name: string; laborLawFlag: string; laborLawMemo?: string;
    feeBearer?: string; axis?: string; restrictedCode?: string;
  }) {
    const [g] = await this.db.query<{ code: string }>(`SELECT code FROM gwans WHERE code = $1`, [dto.gwanCode]);
    if (!g) throw new PolicyViolation('CATEGORY_GWAN_UNKNOWN', '없는 관입니다.');
    if (dto.gwanCode === 'MAL' && !dto.axis) throw new PolicyViolation('CATEGORY_AXIS_REQUIRED', '안심소개 업종은 축(기계 · 설비 / 부동산 / 태양광 / 상담)을 골라야 합니다.');
    if (dto.gwanCode !== 'MAL' && dto.axis) throw new PolicyViolation('CATEGORY_AXIS_REQUIRED', '축은 안심소개(MAL) 업종에만 고릅니다.');
    if (dto.restrictedCode) {
      const [r] = await this.db.query(`SELECT code FROM restricted_industries WHERE code = $1`, [dto.restrictedCode]);
      if (!r) throw new PolicyViolation('CATEGORY_RESTRICTED_UNKNOWN', '없는 제한업종 코드입니다.');
    }
    const [dup] = await this.db.query(`SELECT id FROM categories WHERE gwan_code = $1 AND code = $2`, [dto.gwanCode, dto.code]);
    if (dup) throw new StateConflict('CATEGORY_EXISTS', '같은 관에 같은 업종 코드가 있습니다.');
    const actor = RequestCtx.actorId() ?? null;
    const [row] = await this.db.query(
      `INSERT INTO categories (gwan_code, code, name, status, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at,
                               fee_bearer, axis, restricted_code, requested_by)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $9, now(), $6, $7, $8, $9)
       RETURNING id, gwan_code AS "gwanCode", code, name, status, labor_law_flag AS "laborLawFlag"`,
      [dto.gwanCode, dto.code, dto.name.trim(), dto.laborLawFlag, dto.laborLawMemo ?? null,
       dto.feeBearer ?? null, dto.axis ?? null, dto.restrictedCode ?? null, actor]);
    return row;
  }

  /**
   * v10.646 (D309 · docs/791) 다른 관 업종 가져오기 — 업종은 관을 옮기지 않으므로(D308) 같은 이름 · 직업안정법 판정 · 부담 주체로
   * 새 관에 「승인 대기」 업종을 하나 더 만듦(만든 사람 = 지금 관리자 · 다른 관리자가 승인). 제한업종은 넣을 관에 같은 코드가 있을 때만.
   */
  async copyCategory(dto: { fromId: string; gwanCode: string; code?: string; axis?: string }) {
    const [s] = await this.db.query<{ gwanCode: string; code: string; name: string; laborLawFlag: string | null; laborLawMemo: string | null;
      feeBearer: string | null; axis: string | null; restrictedCode: string | null }>(
      `SELECT gwan_code AS "gwanCode", code, name, labor_law_flag AS "laborLawFlag", labor_law_memo AS "laborLawMemo",
              fee_bearer AS "feeBearer", axis, restricted_code AS "restrictedCode"
         FROM categories WHERE id = $1`, [dto.fromId]);
    if (!s) throw new NotFound('가져올 업종이 없습니다.');
    if (s.gwanCode === dto.gwanCode) throw new PolicyViolation('CATEGORY_COPY_SAME', '같은 관으로는 가져올 수 없습니다.');
    const code = dto.code ?? (s.code.startsWith(s.gwanCode + '_') ? dto.gwanCode + s.code.slice(s.gwanCode.length) : `${dto.gwanCode}_${s.code}`).slice(0, 40);
    const [ri] = s.restrictedCode
      ? await this.db.query(`SELECT code FROM restricted_industries WHERE code = $1 AND gwan_code = $2`, [s.restrictedCode, dto.gwanCode]) : [];
    const memo = `가져옴: ${s.gwanCode} › ${s.code}` + (s.laborLawMemo ? ` · ${s.laborLawMemo}` : '');
    return this.createCategory({
      gwanCode: dto.gwanCode, code, name: s.name, laborLawFlag: s.laborLawFlag ?? 'REVIEW_REQUIRED', laborLawMemo: memo.slice(0, 500),
      feeBearer: s.feeBearer ?? undefined, axis: dto.gwanCode === 'MAL' ? (dto.axis ?? s.axis ?? undefined) : undefined,
      restrictedCode: ri ? s.restrictedCode! : undefined,
    });
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
                approved_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END,
                approved_by = CASE WHEN $2 = 'APPROVED' THEN $7::uuid ELSE approved_by END,   /* v10.643 (D308) 만든 사람 ≠ 승인한 사람(DB) */
                updated_at = now()
          WHERE id = $1
        RETURNING id, code, name, status, labor_law_flag AS "laborLawFlag"`,
        [id, dto.status, dto.laborLawFlag, dto.laborLawMemo ?? null,
         dto.feeBearer ?? null, dto.restrictedCode ?? null, RequestCtx.actorId() ?? null]);
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
