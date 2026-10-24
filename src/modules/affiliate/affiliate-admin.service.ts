import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * 파트너 제휴수수료 — 운영 화면(신청 심사 · 상품 · 목표 · 홍보 자료 · 안내 · 정산 실행).
 *
 * v10.92 (리팩토링) — affiliate.service.ts 에서 함수 본문을 그대로 옮겼습니다. 파트너 화면은 affiliate.service.ts 그대로.
 * 단가 고정 · 72시간 귀속 · 정산 상태 · 심의는 트리거가 봅니다(C850).
 */
@Injectable()
export class AffiliateAdminService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }
  async applications() {
    /* ★ 입점 심사는 **관리자가 합니다**(결정 2026-09-22). */
    const items = await this.db.query(
      `SELECT p.id, p.grade, p.status, p.applied_at AS "appliedAt",
              b.company_name AS "companyName", b.ceo_name AS "ceoName",
              b.biz_reg_no AS "bizRegNo",
              (b.verified_at IS NOT NULL) AS "bizVerified",
              /* v10.38 (D096 · P2P) — 개인 활동 정보면 본인인증이 활동 자격 */
              (b.kind = 'PERSON') AS "personal", fn_actor_ok(b.id) AS "actorOk"
         FROM partners p
         JOIN businesses b ON b.id = p.business_id
        WHERE p.status = 'APPLIED'   /* 20261002 — 표의 대기 상태는 APPLIED 입니다(전: 'PENDING' → 늘 빈 목록) */
        ORDER BY p.applied_at`);
    return {
      items,
      note: items.length
        ? '활동 자격(사업자 인증 · 개인은 본인인증)이 끝난 곳인지 먼저 보십시오.'
        : null,
    };
  }

  async decideApplication(id: string, dto: { state: string; reason?: string }) {
    if (dto.state === 'REJECTED' && !dto.reason?.trim()) {
      return { ok: false, note: '거절 사유를 적으십시오. 안 적으면 같은 신청이 다시 올라옵니다.' };
    }
    const [r] = await this.db.query(
      `UPDATE partners SET
          status = $2,
          approved_at = CASE WHEN $2 = 'ACTIVE' THEN now() ELSE NULL END,
          approved_by = CASE WHEN $2 = 'ACTIVE' THEN $3::uuid ELSE NULL END,
          suspended_reason = CASE WHEN $2 <> 'ACTIVE' THEN $4 ELSE NULL END
        WHERE id = $1 AND status = 'APPLIED'
      RETURNING id, status`,
      [id, dto.state === 'APPROVED' ? 'ACTIVE' : 'REJECTED', this.me, dto.reason ?? null]);
    if (!r) return { ok: false, note: '심사 대기 상태가 아닙니다.' };
    return {
      ok: true, ...r,
      note: dto.state === 'APPROVED'
        ? '승인했습니다. 파트너가 링크를 발급할 수 있습니다.'
        : '거절했습니다. 사유가 신청자에게 보입니다.',
    };
  }

  adminProducts() {
    return this.db.query(
      `SELECT p.id, p.code, p.name, p.advertiser, p.commission, p.status,
              p.landing_url AS "landingUrl",
              (SELECT count(*) FROM partner_orders o WHERE o.product_id = p.id)::int AS orders,
              (SELECT count(*) FROM affiliate_product_rates r WHERE r.product_id = p.id)::int AS "rateChanges",
              p.updated_at AS "updatedAt"
         FROM affiliate_products p ORDER BY p.status, p.name`);
  }

  async createProduct(dto: {
    code: string; name: string; commission: number; landingUrl: string;
    advertiser?: string; description?: string;
  }) {
    const [r] = await this.db.query(
      `INSERT INTO affiliate_products (code, name, commission, landing_url, advertiser, description)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, code, status`,
      [dto.code, dto.name, dto.commission, dto.landingUrl,
       dto.advertiser ?? null, dto.description ?? null]);
    return {
      ok: true, ...r,
      /* ★ 등록하자마자 팔리지 않습니다. 상태를 바꿔야 나갑니다. */
      note: '등록했습니다. 아직 DRAFT 라 파트너에게 보이지 않습니다 — 판매중으로 바꾸십시오.',
    };
  }

  async updateProduct(id: string, dto: {
    commission?: number; status?: string; landingUrl?: string;
  }) {
    const [r] = await this.db.query(
      `UPDATE affiliate_products SET
          commission = coalesce($2, commission),
          status = coalesce($3, status),
          landing_url = coalesce($4, landing_url),
          updated_at = now()
        WHERE id = $1
      RETURNING id, commission, status`,
      [id, dto.commission ?? null, dto.status ?? null, dto.landingUrl ?? null]);
    if (!r) return { ok: false, note: '없는 상품입니다.' };
    return {
      ok: true, ...r,
      /* ★ 단가를 바꿔도 이미 생긴 주문은 그대로입니다. */
      note: dto.commission
        ? '단가를 바꿨습니다. **이미 생긴 주문에는 소급하지 않습니다** — 새 주문부터 적용됩니다.'
        : '바꿨습니다.',
    };
  }

  goals(periodYm?: string) {
    return this.db.query(
      `SELECT g.id, g.partner_id AS "partnerId", g.grade, g.period_ym AS "periodYm",
              g.target, g.reward,
              CASE WHEN g.partner_id IS NOT NULL THEN '개인' ELSE '등급' END AS scope,
              b.company_name AS "companyName"
         FROM partner_goals g
         LEFT JOIN partners p ON p.id = g.partner_id
         LEFT JOIN businesses b ON b.id = p.business_id
        WHERE ($1::text IS NULL OR g.period_ym = $1)
        ORDER BY g.period_ym DESC, scope, b.company_name`, [periodYm ?? null]);
  }

  async setGoal(dto: {
    partnerId?: string; grade?: string; periodYm: string;
    target: number; reward?: number;
  }) {
    if (!dto.partnerId && !dto.grade) {
      return { ok: false, note: '개인 또는 등급 중 하나를 고르십시오.' };
    }
    const [r] = await this.db.query(
      `INSERT INTO partner_goals (partner_id, grade, period_ym, target, reward, set_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [dto.partnerId ?? null, dto.grade ?? null, dto.periodYm,
       dto.target, dto.reward ?? null, this.me]);
    return {
      ok: true, ...r,
      /* ★ 개인 설정이 등급 일괄을 이깁니다(결정 20). */
      note: dto.partnerId
        ? '개인 목표를 정했습니다. 등급 일괄보다 이것이 우선합니다.'
        : '등급 목표를 정했습니다. 개인 목표가 따로 있으면 그것이 우선합니다.',
    };
  }

  async materialQueue() {
    const items = await this.db.query(
      `SELECT m.id, m.title, m.kind, m.body, m.created_at AS "createdAt",
              coalesce(a.name,'(탈퇴)') AS "createdBy",
              m.file_key AS "fileKey", f.id AS "fileId", f.original_name AS "fileName",
              f.content_type AS "fileType", f.size_bytes AS "fileSize"
         FROM marketing_materials m
         LEFT JOIN accounts a ON a.id = m.created_by
         LEFT JOIN files f ON f.id = m.file_id AND f.status = 'READY'
        WHERE m.state = 'PENDING' ORDER BY m.created_at`);
    return {
      items,
      /* ★ 파트너가 뿌리는 순간 회사가 한 말이 됩니다. */
      note: items.length
        ? '파트너가 이것을 뿌립니다 — 회사가 한 말이 됩니다. 표현을 보십시오.'
        : null,
    };
  }

  /* ── 마케팅자료 · 파트너가이드 등록 (D007) ───────────────────
   *   자료는 **심의 대기(PENDING)로만** 들어갑니다 — 올린 즉시 파트너에게 가지 않습니다.
   *   파일의 용도 · 상태 · 형식(이미지/영상/문서)은 DB 트리거(fn_file_ref_material)가 봅니다. */

  async createMaterial(dto: { title: string; kind: string; body?: string; fileId?: string }) {
    if (dto.kind === 'COPY' && !dto.body?.trim()) {
      throw new PolicyViolation('MATERIAL_BODY_REQUIRED', '문구 자료는 본문을 적으십시오.');
    }
    if (dto.kind !== 'COPY' && !dto.fileId) {
      throw new PolicyViolation('MATERIAL_FILE_REQUIRED', '이미지 · 배너 · 영상 · 문서 자료는 파일을 올리십시오.');
    }
    const [r] = await this.db.query(
      `INSERT INTO marketing_materials (title, kind, body, file_id, file_key, created_by)
       VALUES ($1, $2, $3, $4::uuid, (SELECT original_name FROM files WHERE id = $4::uuid), $5)
       RETURNING id, state`,
      [dto.title.trim(), dto.kind, dto.body?.trim() || null, dto.fileId ?? null, this.me]);
    return { ok: true, ...r, note: '심의 대기로 올렸습니다. 승인되면 파트너 자료실에 나갑니다.' };
  }

  adminGuides() {
    return this.db.query(
      `SELECT g.id, g.title, g.body, g.sort_order AS "sortOrder", g.is_active AS "isActive",
              g.updated_at AS "updatedAt",
              f.id AS "fileId", f.original_name AS "fileName", f.content_type AS "fileType", f.size_bytes AS "fileSize"
         FROM partner_guides g
         LEFT JOIN files f ON f.id = g.file_id AND f.status = 'READY'
        ORDER BY g.sort_order, g.title`);
  }

  async createGuide(dto: { title: string; body: string; sortOrder?: number; fileId?: string }) {
    const [r] = await this.db.query(
      `INSERT INTO partner_guides (title, body, sort_order, file_id, created_by)
       VALUES ($1, $2, $3, $4::uuid, $5) RETURNING id, is_active AS "isActive"`,
      [dto.title.trim(), dto.body.trim(), dto.sortOrder ?? 100, dto.fileId ?? null, this.me]);
    return { ok: true, ...r, note: '가이드를 올렸습니다. 파트너가이드에 바로 보입니다.' };
  }

  async updateGuide(id: string, dto: { title?: string; body?: string; sortOrder?: number;
                                       isActive?: boolean; fileId?: string; removeFile?: boolean }) {
    const [r] = await this.db.query(
      `UPDATE partner_guides SET
          title = coalesce($2, title), body = coalesce($3, body),
          sort_order = coalesce($4, sort_order), is_active = coalesce($5, is_active),
          file_id = CASE WHEN $7 THEN NULL ELSE coalesce($6::uuid, file_id) END,
          updated_at = now()
        WHERE id = $1 RETURNING id, is_active AS "isActive"`,
      [id, dto.title?.trim() ?? null, dto.body?.trim() ?? null, dto.sortOrder ?? null,
       dto.isActive ?? null, dto.fileId ?? null, dto.removeFile === true]);
    if (!r) throw new NotFound('가이드를 찾을 수 없습니다.');
    return { ok: true, ...r, note: '고쳤습니다.' };
  }

  async reviewMaterial(id: string, dto: { state: string; reason?: string }) {
    if (dto.state === 'REJECTED' && !dto.reason?.trim()) {
      return { ok: false, note: '반려 사유를 적으십시오. 안 적으면 같은 자료가 다시 올라옵니다.' };
    }
    const [r] = await this.db.query(
      `UPDATE marketing_materials SET
          state = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now()
        WHERE id = $1 AND state = 'PENDING' RETURNING id, state`,
      [id, dto.state, dto.reason ?? null, this.me]);
    if (!r) return { ok: false, note: '심의 대기 상태가 아닙니다.' };
    return {
      ok: true, ...r,
      /* 반려는 인앱과 이메일 둘 다 보냅니다(결정 19). */
      note: dto.state === 'APPROVED'
        ? '승인했습니다. 자료실에 올라갑니다.'
        : '반려했습니다. 인앱과 이메일로 사유가 갑니다.',
    };
  }

  adminSettlements(track?: string) {
    return this.db.query(
      `SELECT s.id, s.track, s.period_from AS "from", s.period_to AS "to",
              s.gross_amount AS gross, s.net_amount AS net, s.state,
              b.company_name AS "companyName",
              (a.verified_at IS NOT NULL) AS "accountReady"
         FROM partner_settlements s
         JOIN partners p ON p.id = s.partner_id
         JOIN businesses b ON b.id = p.business_id
         LEFT JOIN partner_settlement_accounts a ON a.partner_id = s.partner_id
        WHERE ($1::text IS NULL OR s.track = $1)
        ORDER BY s.period_from DESC, b.company_name`, [track ?? null]);
  }

  async runSettle(dto: { track: string; periodFrom: string; periodTo: string }) {
    /* v10.31 (W5 · 결함 「2029-07-09 ~ 2029-02-10」) — 기간이 거꾸로이거나 아직 끝나지 않은 기간은 정산하지 않습니다
     * (DB 에도 ck_pstl_period 가 있습니다 — 여기서는 사람이 읽을 사유를 먼저 냅니다) */
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(dto.periodFrom) || !re.test(dto.periodTo)) throw new PolicyViolation('BAD_PERIOD', '기간은 YYYY-MM-DD 입니다.');
    if (dto.periodFrom > dto.periodTo) throw new PolicyViolation('BAD_PERIOD', '정산 기간의 끝이 시작보다 앞입니다.');
    const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (dto.periodTo >= todayKst) throw new PolicyViolation('BAD_PERIOD', '끝나지 않은 기간(오늘 이후)은 정산하지 않습니다 — 어제까지로 정하십시오.');
    /* ★ 트랙별로 따로 돕니다(결정 21). 정산주기가 다를 수 있습니다. */
    const rows = await this.db.query(
      `INSERT INTO partner_settlements
         (partner_id, track, period_from, period_to, gross_amount, withholding, net_amount)
       SELECT o.partner_id, $1, $2::date, $3::date,
              sum(o.commission),
              /* 사업소득 원천징수 3.3% */
              round(sum(o.commission) * 0.033),
              sum(o.commission) - round(sum(o.commission) * 0.033)
         FROM partner_orders o
        WHERE o.state = 'CONFIRMED' AND o.attributed
          AND o.ordered_at::date BETWEEN $2::date AND $3::date
        GROUP BY o.partner_id
       ON CONFLICT (partner_id, track, period_from, period_to) DO NOTHING
       RETURNING id, partner_id AS "partnerId", net_amount AS net`,
      [dto.track, dto.periodFrom, dto.periodTo]);
    return {
      ok: true, created: rows.length, items: rows,
      note: rows.length
        ? `${rows.length}건을 만들었습니다. 확인 후 지급하십시오 — DRAFT 에서 바로 지급할 수 없습니다.`
        : '대상이 없습니다.',
    };
  }
}
