import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { FORM_KO, FORM_STEPS } from './partner-center.service';

/**
 * 규제 분야 자격 심사 · 의료 심의 확인.
 *
 * 자격 없는 사업자가 규제 분야에 등록되면 **플랫폼도 책임을 집니다.**
 * 통신판매중개자의 면책은 "고지하고 확인한 범위"에서만 성립하고,
 * 자격 확인이 그 '확인'입니다.
 *
 * 서류를 받아 두는 것만으로는 부족합니다 — 발급처에서 조회해야 하고,
 * DB 가 그것 없이는 승인을 막습니다.
 */
@Injectable()
export class QualificationService {
  constructor(private readonly db: DatabaseService) {}

  rules() {
    return this.db.query(
      `SELECT r.category_code AS "categoryCode", r.category_name AS "categoryName",
              r.required_doc AS "requiredDoc", r.legal_basis AS "legalBasis",
              r.needs_lookup AS "needsLookup",
              (SELECT count(*)::int FROM qualification_reviews q
                WHERE q.category_code = r.category_code AND q.state='PENDING') AS pending
         FROM qualification_rules r WHERE r.is_active
        ORDER BY r.category_code`);
  }

  /**
   * v10.32 — SB-ADM-PTN-060 카테고리 마스터 (T-05 · T-06) · 시안 admptnc 세 구역을 실제 자료로. 읽기 전용.
   *   ① 안심소개 상담 축 업종(MAL · axis CONSULT) — 게시 방식은 restricted_industries.mode(GATED · 그 밖은 일반) ·
   *      상태는 categories.status · consult_mode(공개 · 준비 중 · 월 정액 노출형 · 비활성). 공개 API(GET /consult/categories)와 같은 기준.
   *   ② 등록 폼 · 단가 — 파트너센터 등록 위자드(GET /partner-center/service-forms)와 같은 업종 · 같은 등록 방식 · 같은 단계 수.
   *      단가 입력은 등록 방식이 없으면 막힘(DB 트리거 fn_partner_service_form_guard) · 매트릭스인데 구간이 없으면 막힘.
   *   ③ 매트릭스 축 — category_matrix_axes. 업종 마스터에는 기준 금액 칸이 없습니다(값은 파트너가 서비스마다 넣음) — 지어내지 않고 비워 둡니다.
   */
  async categoryMaster() {
    const consult = await this.db.query<any>(
      `SELECT c.code, c.name, c.status, c.consult_mode AS "consultMode",
              CASE WHEN r.is_active THEN r.mode ELSE 'OPEN' END AS "publishMode",
              r.legal_basis AS "legalBasis"
         FROM categories c
         LEFT JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code
        WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status IN ('APPROVED','PENDING','ARCHIVED')
        ORDER BY (c.status = 'ARCHIVED'), (c.consult_mode = 'LISTING_FEE'),
                 (CASE WHEN r.is_active THEN r.mode ELSE 'OPEN' END) = 'GATED' DESC, c.name`);
    const cats = await this.db.query<any>(
      `SELECT c.id, c.code, c.name, c.gwan_code AS "gwanCode", c.service_form AS form,
              CASE WHEN r.is_active AND r.mode IN ('GATED','AD_ONLY') THEN r.legal_basis END AS "legalBasis",
              coalesce(c.lead_fee, (SELECT value::numeric FROM site_settings WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$')) AS "baseFee",
              (SELECT count(*) FROM partner_services s WHERE s.category_id = c.id AND s.status = 'APPROVED')::int AS services
         FROM categories c
         LEFT JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code
        WHERE c.status = 'APPROVED' AND (c.axis = 'CONSULT' OR c.service_form IS NOT NULL)
        ORDER BY (c.service_form IS NULL), array_position(ARRAY['MATRIX','CONTRACT','CONSULT','RENTAL','PAYMENT','MEDICAL'], c.service_form), c.name`);
    const axes = await this.db.query<any>(
      `SELECT a.category_id AS "categoryId", a.axis_type AS type, a.axis_key AS key, a.label
         FROM category_matrix_axes a
         JOIN categories c ON c.id = a.category_id
        WHERE a.is_active AND c.status = 'APPROVED'
        ORDER BY a.category_id, a.axis_type DESC, a.sort_order`);
    const short = (s: string | null) => (s ? s.split(/\s+—\s+/)[0]!.trim() : null);
    const forms = cats.map((c) => {
      const rows = axes.filter((a) => a.categoryId === c.id && a.type === 'ROW').length;
      const cols = axes.filter((a) => a.categoryId === c.id && a.type === 'COL').length;
      const blocked = !c.form ? 'NO_FORM' : c.form === 'MATRIX' && !(rows && cols) ? 'NO_AXES' : null;
      return { code: c.code, name: c.name, gwanCode: c.gwanCode, form: c.form, formLabel: c.form ? FORM_KO[c.form] ?? c.form : null,
        steps: c.form ? (FORM_STEPS[c.form] ?? []).length : null,
        axis: c.form === 'MATRIX' && rows && cols ? { rows, cols } : null,
        regulation: short(c.legalBasis), baseFee: c.baseFee != null ? Number(c.baseFee) : null,
        services: c.services, priceInput: !blocked, blocked };
    });
    const matrices = cats.filter((c) => axes.some((a) => a.categoryId === c.id)).map((c) => ({
      code: c.code, name: c.name,
      rows: axes.filter((a) => a.categoryId === c.id && a.type === 'ROW').map((a) => ({ key: a.key, label: a.label })),
      cols: axes.filter((a) => a.categoryId === c.id && a.type === 'COL').map((a) => ({ key: a.key, label: a.label })),
      /* 업종 마스터에 기준 금액이 없습니다 — 칸마다 null(화면은 「—」) */
      base: null as null,
    }));
    return {
      consult: consult.map((c) => ({ code: c.code, name: c.name, status: c.status, consultMode: c.consultMode,
        publishMode: c.publishMode === 'GATED' ? 'GATED' : 'OPEN',
        state: c.status === 'ARCHIVED' ? 'INACTIVE' : c.status === 'PENDING' ? 'PENDING'
          : c.consultMode === 'LISTING_FEE' ? 'LISTING_FEE' : 'OPEN',
        legalBasis: c.legalBasis ?? null })),
      forms, matrices,
    };
  }

  pending() {
    return this.db.query(
      `SELECT id, company, category_code AS "categoryCode",
              category_name AS "categoryName", doc_no AS "docNo",
              lookup_done AS "lookupDone", required_doc AS "requiredDoc",
              legal_basis AS "legalBasis", created_at AS "createdAt"
         FROM v_qualification_pending`);
  }

  /** 발급처 조회 완료 표시. 이것 없이는 승인이 막힙니다. */
  async markLookup(id: string) {
    const [row] = await this.db.query<any>(
      `UPDATE qualification_reviews
          SET lookup_done = true, lookup_by = $2, lookup_at = now()
        WHERE id = $1 AND state = 'PENDING'
      RETURNING id, lookup_done AS "lookupDone"`, [id, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_PENDING', '심사 대기 중인 건이 아닙니다.');
    return { ...row, note: '이제 승인할 수 있습니다.' };
  }

  async decide(id: string, approve: boolean, reason?: string) {
    if (!approve && !reason?.trim()) {
      throw new PolicyViolation('REASON_REQUIRED',
        '반려에는 무엇이 부족한지까지 적어야 합니다.');
    }
    const [row] = await this.db.query<any>(
      `UPDATE qualification_reviews
          SET state = $2, reject_reason = $3, decided_by = $4, decided_at = now()
        WHERE id = $1 AND state = 'PENDING'
      RETURNING id, state, category_code AS "categoryCode"`,
      [id, approve ? 'APPROVED' : 'REJECTED', approve ? null : reason,
       RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_PENDING', '심사 대기 중인 건이 아닙니다.');
    return row;
  }

  /**
   * 의료 심의 확인.
   *
   * 심의필 번호를 확인해야 슬롯에 붙습니다. 확인 전에는 DB 가 막습니다 —
   * 실수로 노출되는 일이 없습니다.
   */
  medicalPending() {
    return this.db.query(
      `SELECT creative_code AS "creativeCode", advertiser, category,
              review_no AS "reviewNo", review_confirmed_at AS "confirmedAt"
         FROM ad_placements
        WHERE is_regulated AND review_confirmed_at IS NULL
          AND review_rejected_at IS NULL   -- v10.32 — 반려(review-reject)한 소재는 대기에서 빠집니다
        ORDER BY creative_code`);
  }

  /* ── 매물 심사 (SB-ADM-PTN-* · 안심소개 — 옛 이름 「소개몰」 2관) ────────────────────── */

  /**
   * 심사 대기 매물.
   *
   * 중개사 자격 통과 여부를 함께 냅니다 — 없으면 승인해도 트리거가 막습니다.
   * 미리 보여 주지 않으면 눌러 보고서야 알게 됩니다.
   */
  propertyPending() {
    return this.db.query(
      `SELECT listing_id AS "listingId", title, company,
              broker_reg_no AS "brokerRegNo",
              address_sido AS "sido", address_sigungu AS "sigungu",
              deal_type AS "dealType", price, area_m2 AS "areaM2",
              broker_ok AS "brokerOk", created_at AS "createdAt"
         FROM v_property_pending`);
  }

  /**
   * 매물 공개 · 반려.
   *
   * 자격 없는 사람이 매물을 올리고 중개하면 **무등록 중개**이고,
   * 플랫폼이 그 자리를 제공한 것이 됩니다. DB 가 막습니다.
   */
  async decideProperty(listingId: string, approve: boolean, reason?: string) {
    if (!approve && !reason?.trim()) {
      throw new PolicyViolation('REASON_REQUIRED',
        '반려에는 무엇이 부족한지까지 적어야 합니다.');
    }
    const [row] = await this.db.query<any>(
      approve
        ? `UPDATE property_listings
              SET verified_at = now(), verified_by = $2
            WHERE listing_id = $1 AND verified_at IS NULL
          RETURNING listing_id AS "listingId", verified_at AS "verifiedAt"`
        : `UPDATE property_listings
              SET reject_reason = $2
            WHERE listing_id = $1 AND verified_at IS NULL
          RETURNING listing_id AS "listingId", reject_reason AS "rejectReason"`,
      [listingId, approve ? RequestCtx.actorId() : reason]);
    if (!row) throw new StateConflict('NOT_PENDING', '심사 대기 중인 매물이 아닙니다.');
    return row;
  }
}
