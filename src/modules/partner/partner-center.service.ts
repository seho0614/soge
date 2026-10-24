import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from './partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { normSido } from '../../common/region';


/**
 * 파트너센터 — v10.31 (W5 · 10/10 시안 기준)에 새로 만든 서버 기능.
 *
 *   상담 신청  메모(쌓임) · 반려 한도 · 반려 · 이의신청 내역          SB-PTC-CTR-300 · 330
 *   내 서비스  등록 방식 · 위자드 정의 · 상세 · 수정(재검수) · 노출 중단 · 재개 · 상세페이지 블록 · 견적 매트릭스   CTR-200 · 201 · 210
 *   성과 관리  이행 보고 → 소비자 확인(성사)                         CTR-450
 *   회사 · 계정 사업자 정보 변경 요청 · 직원 계정 · 회사 관리(브랜드 · 소재)  CTR-610
 *   전용 트랙  판금 · 도색 견적 · 중고차 매물 · 제품 카탈로그             CTR-950
 *
 * 전부 「내 것만」입니다 — mine() 이 로그인한 사람의 파트너(대표 또는 합류한 직원)를 잡고 시작합니다.
 * 규칙(금칙어 · 등록 방식 · 매트릭스 구간 · 연락처 적기 금지 · 한 번만 확인)은 DB 트리거가 봅니다.
 */
export const FORM_KO: Record<string, string> = {
  MATRIX: '매트릭스 견적', CONTRACT: '계약 성사형', CONSULT: '상담형', RENTAL: '약정 월요금형',
  PAYMENT: '결제형(레거시)', MEDICAL: '의료 심의 트랙',
};
/* 시안 reg.forms — 등록 방식마다 단계 */
export const FORM_STEPS: Record<string, string[]> = {
  MATRIX: ['제공 서비스', '주요 타겟', '자동 견적 구간', '상담 확인비용', '소개비', '랜딩 미리보기', '등록 신청'],
  CONTRACT: ['접수 방식', '상세 페이지', '검수 요청'],
  CONSULT: ['접수 방식', '상세 페이지', '검수 요청'],
  RENTAL: ['접수 방식', '상세 페이지', '검수 요청'],
  MEDICAL: ['시술 선택 · 소재', '심의 제출 자료', '심의필 등록'],
  PAYMENT: ['상품 정의', '상품정보 고시', '배송 · 반품', '소개 리워드', '가격 · 재고', '검수 요청'],
};
const BLOCK_KO: Record<string, string> = {
  HERO_IMAGE: '대표 이미지', INTRO: '서비스 소개', PRICE: '가격표', CASES: '시공 사례', FAQ: '자주 묻는 질문', LOCATION: '오시는 길',
};
const BLOCKS = Object.keys(BLOCK_KO);
const PHONE = /01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}/;

@Injectable()
export class PartnerCenterService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }
  private async mine() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const p = await this.actors.forMember(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const { id, grade, status, businessId, ownerId, company, isOwner } = p;   // 이 자리가 쓰던 칸 그대로
    return { id, grade, status, businessId, ownerId, company, isOwner };
  }
  private async owner() {
    const p = await this.mine();
    if (!p.isOwner) throw new Forbidden('OWNER_ONLY', '대표 계정만 할 수 있습니다.');
    return p;
  }
  private uuid(id: string, what = '대상') {
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new NotFound(`${what}이(가) 없습니다.`);
  }
  private async actor() {
    await this.db.query(`SELECT set_config('app.actor_id', $1, true)`, [this.me ?? '']);
  }

  /* ══ 상담 신청 — 메모 · 반려 한도 · 반려 내역 ═══════════════════════════ */

  async addMemo(deliveryId: string, body: string) {
    const p = await this.mine();
    this.uuid(deliveryId, '받은 리드');
    if (!body?.trim()) throw new PolicyViolation('MEMO_EMPTY', '메모를 적어 주십시오.');
    const [m] = await this.db.query<any>(
      `INSERT INTO lead_delivery_memos(delivery_id, partner_id, author_id, body) VALUES ($1,$2,$3,$4)
       RETURNING id, body, created_at AS "createdAt"`, [deliveryId, p.id, this.me, body.trim()]);
    return { ...m, id: Number(m.id) };
  }

  async memos(deliveryId: string) {
    const p = await this.mine();
    this.uuid(deliveryId, '받은 리드');
    const [d] = await this.db.query(`SELECT 1 FROM lead_deliveries WHERE id = $1 AND partner_id = $2`, [deliveryId, p.id]);
    if (!d) throw new NotFound('받은 리드가 아닙니다.');
    const rows = await this.db.query<any>(
      `SELECT m.id, m.body, m.created_at AS "createdAt",
              CASE WHEN m.author_id = $3 THEN '나' ELSE coalesce(left(a.name, 1) || '**', '직원') END AS author
         FROM lead_delivery_memos m LEFT JOIN accounts a ON a.id = m.author_id
        WHERE m.delivery_id = $1 AND m.partner_id = $2 ORDER BY m.created_at DESC`, [deliveryId, p.id, this.me]);
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  /** 반려 · 이의신청(시안 CTR-330) — 반려 한도(이번 달) + 신청 내역(RJ 번호) */
  async rejects() {
    const p = await this.mine();
    const [cap] = await this.db.query<any>(`SELECT * FROM fn_lead_reject_cap($1)`, [p.id]);
    const rows = await this.db.query<any>(
      `SELECT x.id, 'RJ-' || x.id AS "no", f.id AS "feeId", 'L-' || upper(left(replace(l.id::text,'-',''), 6)) AS "leadNo",
              l.summary, x.reason_code AS "reasonCode", x.reason, x.created_at AS "requestedAt",
              x.state, x.decision_reason AS "decisionReason", x.decided_at AS "decidedAt",
              f.amount, f.settle_mode AS "settleMode",
              (SELECT -sum(cl.amount) FROM lead_cash_entries ce JOIN lead_cash_lines cl ON cl.entry_id = ce.id
                WHERE ce.kind = 'RESTORE' AND ce.ref_type = 'LEAD_FEE' AND ce.ref_id = f.id::text
                  AND cl.account IN ('PARTNER_PAID','PARTNER_BONUS')) AS restored
         FROM lead_fee_disputes x
         JOIN lead_fees f ON f.id = x.fee_id
         JOIN lead_deliveries d ON d.id = f.delivery_id
         JOIN leads l ON l.id = d.lead_id
        WHERE x.partner_id = $1
        ORDER BY x.created_at DESC LIMIT 100`, [p.id]);
    return {
      cap: { month: cap?.month, received: cap?.received ?? 0, used: cap?.used ?? 0, cap: cap?.cap ?? 1 },
      rows: rows.map((r) => ({ ...r, id: Number(r.id), amount: Number(r.amount), restored: r.restored != null ? Number(r.restored) : null })),
      note: '반려는 접수 72시간 이내 · 한 건에 한 번 · 월 접수량의 15%까지 신청할 수 있습니다. 인정되면 확인비용이 잔액으로 환급됩니다. 상담 결렬은 사유가 아닙니다.',
    };
  }

  /* ══ 내 서비스 ═════════════════════════════════════════════════════════ */

  /** 위자드 정의 — 업종마다 등록 방식 · 단계 · 매트릭스 축 · 기준 단가 (시안 reg.forms · steps7) */
  async serviceForms() {
    await this.mine();
    const cats = await this.db.query<any>(
      `SELECT c.id, c.code, c.name, c.gwan_code AS "gwanCode", c.service_form AS "form", c.restricted_code AS "restrictedCode",
              coalesce(c.lead_fee, (SELECT value::numeric FROM site_settings WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$')) AS "baseFee",
              c.partner_track AS track
         FROM categories c
        WHERE c.status = 'APPROVED' AND (c.axis = 'CONSULT' OR c.service_form IS NOT NULL)
        ORDER BY (c.service_form IS NULL), c.name`);
    const axes = await this.db.query<any>(
      `SELECT category_id AS "categoryId", axis_type AS type, axis_key AS key, label
         FROM category_matrix_axes WHERE is_active ORDER BY category_id, axis_type DESC, sort_order`);
    const rates = await this.db.query<any>(`SELECT grade, label, rate FROM lead_grade_rates WHERE gwan_code IS NULL ORDER BY rank`);
    const forms = Object.keys(FORM_KO).map((k) => ({
      form: k, label: FORM_KO[k], steps: FORM_STEPS[k],
      categories: cats.filter((c) => c.form === k).map((c) => c.name),
    }));
    return {
      forms,
      categories: cats.map((c) => ({
        ...c, baseFee: c.baseFee != null ? Number(c.baseFee) : null, formLabel: c.form ? FORM_KO[c.form] : '미정',
        steps: c.form ? FORM_STEPS[c.form] : [],
        rows: axes.filter((a) => a.categoryId === c.id && a.type === 'ROW').map((a) => ({ key: a.key, label: a.label })),
        cols: axes.filter((a) => a.categoryId === c.id && a.type === 'COL').map((a) => ({ key: a.key, label: a.label })),
      })),
      rates: rates.map((r) => ({ ...r, rate: Number(r.rate) })),
      blocks: BLOCKS.map((k) => ({ kind: k, label: BLOCK_KO[k] })),
      receiveModes: [{ key: 'QUOTE', label: '견적 요청' }, { key: 'CALL', label: '전화 상담' }, { key: 'VISIT', label: '방문 상담' }, { key: 'CHAT', label: '채팅 상담' }],
      note: '업종이 등록 화면을 정합니다. 규제 업종은 접수 방식이 고정되고(보험업법 · 의료법 제27조), 등록 방식이 정해지지 않은 업종은 아직 등록할 수 없습니다.',
    };
  }

  async serviceDetail(id: string) {
    const p = await this.mine();
    this.uuid(id, '서비스');
    const [s] = await this.db.query<any>(
      `SELECT s.id, s.title, s.body, s.status, s.reject_reason AS "rejectReason", s.created_at AS "createdAt",
              s.updated_at AS "updatedAt", s.form_type AS "formType", s.target, s.receive_mode AS "receiveMode",
              s.top_fee AS "topFee", s.referral_rate AS "referralRate", s.rebate_bonus AS "rebateBonus",
              s.suspended_by AS "suspendedBy", s.suspended_at AS "suspendedAt",
              c.id AS "categoryId", c.name AS "categoryName", c.lead_fee AS "categoryFee"
         FROM partner_services s LEFT JOIN categories c ON c.id = s.category_id
        WHERE s.id = $1 AND s.partner_id = $2`, [id, p.id]);
    if (!s) throw new NotFound('서비스가 없습니다.');
    const [blocks, matrix, axes, events, stat] = await Promise.all([
      this.db.query<any>(`SELECT kind, body, file_id AS "fileId", is_visible AS visible, updated_at AS "updatedAt"
                            FROM partner_service_blocks WHERE service_id = $1`, [id]),
      this.db.query<any>(`SELECT row_key AS row, col_key AS col, amount FROM partner_service_matrix WHERE service_id = $1`, [id]),
      s.categoryId ? this.db.query<any>(`SELECT axis_type AS type, axis_key AS key, label FROM category_matrix_axes
                                           WHERE category_id = $1 AND is_active ORDER BY axis_type DESC, sort_order`, [s.categoryId]) : Promise.resolve([]),
      this.db.query<any>(`SELECT e.action, e.from_status AS "from", e.to_status AS "to", e.reason, e.at
                            FROM partner_service_events e WHERE e.service_id = $1 ORDER BY e.at DESC, e.id DESC LIMIT 50`, [id]),
      this.db.query<any>(`SELECT count(*)::int AS received, count(*) FILTER (WHERE d.viewed_at IS NOT NULL)::int AS viewed
                            FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id
                           WHERE d.partner_id = $1 AND $2::uuid IS NOT NULL AND l.category_id = $2 AND d.state <> 'REVOKED'`, [p.id, s.categoryId]),
    ]);
    return {
      ...s, formLabel: s.formType ? FORM_KO[s.formType] : null,
      topFee: s.topFee != null ? Number(s.topFee) : null, referralRate: s.referralRate != null ? Number(s.referralRate) : null,
      rebateBonus: s.rebateBonus != null ? Number(s.rebateBonus) : null,
      blocks: BLOCKS.map((k) => {
        const b = blocks.find((x) => x.kind === k);
        return { kind: k, label: BLOCK_KO[k], filled: !!b, body: b?.body ?? null, fileId: b?.fileId ?? null, visible: b?.visible ?? true, updatedAt: b?.updatedAt ?? null };
      }),
      matrix: { rows: axes.filter((a) => a.type === 'ROW'), cols: axes.filter((a) => a.type === 'COL'),
        cells: matrix.map((m) => ({ ...m, amount: Number(m.amount) })) },
      events, stats: stat[0] ?? { received: 0, viewed: 0 },
      canEdit: ['APPROVED', 'REJECTED', 'IN_REVIEW', 'SUSPENDED', 'DRAFT'].includes(s.status) && s.suspendedBy !== 'OPS',
      canSuspend: s.status === 'APPROVED',
      canResume: s.status === 'SUSPENDED' && s.suspendedBy === 'PARTNER',
    };
  }

  /** 서비스 수정 — 노출 중이면 재검수(검수중으로 내려감 · 그동안 리드가 오지 않음 — 시안 svcd.warn) */
  async updateService(id: string, dto: { title?: string; body?: string; target?: string | null; receiveMode?: string | null;
    topFee?: number | null; referralRate?: number | null; rebateBonus?: number | null }) {
    const p = await this.mine();
    this.uuid(id, '서비스');
    return this.db.transaction(async () => {
      await this.actor();
      const [cur] = await this.db.query<any>(
        `SELECT status, suspended_by FROM partner_services WHERE id = $1 AND partner_id = $2 FOR UPDATE`, [id, p.id]);
      if (!cur) throw new NotFound('서비스가 없습니다.');
      if (cur.status === 'SUSPENDED' && cur.suspended_by === 'OPS') {
        throw new StateConflict('OPS_SUSPENDED', '운영이 멈춘 서비스는 고칠 수 없습니다 — 고객센터로 문의해 주십시오.');
      }
      const contentChanged = dto.title !== undefined || dto.body !== undefined || dto.target !== undefined || dto.receiveMode !== undefined;
      /* 확인비용 · 소개비만 바꾸면 노출은 그대로(심사 대상이 아닌 값) · 내용이 바뀌면 재검수 */
      const next = contentChanged && ['APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT'].includes(cur.status) ? 'IN_REVIEW' : cur.status;
      const [row] = await this.db.query<any>(
        `UPDATE partner_services SET
            title = coalesce($3, title), body = coalesce($4, body),
            target = CASE WHEN $5::boolean THEN $6 ELSE target END,
            receive_mode = CASE WHEN $7::boolean THEN $8 ELSE receive_mode END,
            top_fee = CASE WHEN $9::boolean THEN $10::bigint ELSE top_fee END,
            referral_rate = CASE WHEN $11::boolean THEN $12::numeric ELSE referral_rate END,
            rebate_bonus = CASE WHEN $13::boolean THEN $14::bigint ELSE rebate_bonus END,
            status = $15, reject_reason = CASE WHEN $15 = 'IN_REVIEW' THEN NULL ELSE reject_reason END
          WHERE id = $1 AND partner_id = $2
        RETURNING id, status, updated_at AS "updatedAt"`,
        [id, p.id, dto.title?.trim() || null, dto.body?.trim() || null,
         dto.target !== undefined, dto.target?.trim() || null,
         dto.receiveMode !== undefined, dto.receiveMode ?? null,
         dto.topFee !== undefined, dto.topFee ?? null,
         dto.referralRate !== undefined, dto.referralRate ?? null,
         dto.rebateBonus !== undefined, dto.rebateBonus ?? null, next]);
      return { ...row, reReview: next === 'IN_REVIEW' && cur.status !== 'IN_REVIEW',
        note: next === 'IN_REVIEW' && cur.status === 'APPROVED'
          ? '고친 내용은 재검수 대상입니다 — 승인될 때까지 검수중으로 내려가고 그동안 리드가 오지 않습니다.'
          : '저장했습니다.' };
    });
  }

  async suspendService(id: string) {
    const p = await this.mine();
    this.uuid(id, '서비스');
    return this.db.transaction(async () => {
      await this.actor();
      const [row] = await this.db.query<any>(
        `UPDATE partner_services SET status = 'SUSPENDED', suspended_by = 'PARTNER', suspended_at = now()
          WHERE id = $1 AND partner_id = $2 AND status = 'APPROVED' RETURNING id, status`, [id, p.id]);
      if (!row) throw new StateConflict('NOT_APPROVED', '노출 중인 서비스만 멈출 수 있습니다.');
      return { ...row, note: '노출을 멈췄습니다 — 신규 리드만 막히고, 진행 중인 상담은 그대로 갑니다. 「노출 재개」로 다시 켭니다.' };
    });
  }

  async resumeService(id: string) {
    const p = await this.mine();
    this.uuid(id, '서비스');
    return this.db.transaction(async () => {
      await this.actor();
      const [row] = await this.db.query<any>(
        `UPDATE partner_services SET status = 'APPROVED'
          WHERE id = $1 AND partner_id = $2 AND status = 'SUSPENDED' AND suspended_by = 'PARTNER' RETURNING id, status`, [id, p.id]);
      if (!row) throw new StateConflict('NOT_SUSPENDED', '내가 멈춘 서비스만 다시 켤 수 있습니다(운영이 멈춘 건은 운영이 풉니다).');
      return { ...row, note: '노출을 다시 켰습니다.' };
    });
  }

  /** 상세페이지 블록 저장 — 빈 내용이면 블록을 지웁니다(비어 있음) */
  async putBlock(id: string, kind: string, dto: { body?: string | null; fileId?: string | null; visible?: boolean }) {
    const p = await this.mine();
    this.uuid(id, '서비스');
    if (!BLOCKS.includes(kind)) throw new PolicyViolation('BAD_BLOCK', `블록은 ${BLOCKS.join(' · ')} 중 하나입니다.`);
    const [s] = await this.db.query<any>(`SELECT id FROM partner_services WHERE id = $1 AND partner_id = $2`, [id, p.id]);
    if (!s) throw new NotFound('서비스가 없습니다.');
    const body = dto.body?.trim() || null;
    if (body && PHONE.test(body)) throw new PolicyViolation('BLOCK_PHONE', '상세페이지에 전화번호를 적지 마십시오 — 연락은 상담 신청으로 받습니다.');
    if (dto.fileId) {
      this.uuid(dto.fileId, '파일');
      const [f] = await this.db.query(`SELECT 1 FROM files WHERE id = $1 AND owner_account_id = $2 AND status = 'READY'`, [dto.fileId, this.me]);
      if (!f) throw new PolicyViolation('BAD_FILE', '올린 파일이 아니거나 아직 올리는 중입니다.');
    }
    if (!body && !dto.fileId) {
      await this.db.query(`DELETE FROM partner_service_blocks WHERE service_id = $1 AND kind = $2`, [id, kind]);
      return { ok: true, kind, filled: false };
    }
    await this.db.query(
      `INSERT INTO partner_service_blocks(service_id, kind, body, file_id, is_visible, sort_order)
       VALUES ($1,$2,$3,$4,coalesce($5,true),$6)
       ON CONFLICT (service_id, kind) DO UPDATE SET body = EXCLUDED.body, file_id = EXCLUDED.file_id,
              is_visible = EXCLUDED.is_visible, updated_at = now()`,
      [id, kind, body, dto.fileId ?? null, dto.visible ?? null, BLOCKS.indexOf(kind)]);
    return { ok: true, kind, filled: true, note: '블록 순서와 노출은 배포 없이 바뀝니다.' };
  }

  /** 견적 매트릭스 저장 — 칸 전체를 한 번에(빈 칸은 지움). 구간은 업종 마스터에 있는 것만(트리거) */
  async putMatrix(id: string, cells: Array<{ row: string; col: string; amount: number | null }>) {
    const p = await this.mine();
    this.uuid(id, '서비스');
    if (!Array.isArray(cells) || cells.length > 200) throw new PolicyViolation('BAD_MATRIX', '칸은 200개까지입니다.');
    return this.db.transaction(async () => {
      const [s] = await this.db.query<any>(
        `SELECT id, form_type FROM partner_services WHERE id = $1 AND partner_id = $2 FOR UPDATE`, [id, p.id]);
      if (!s) throw new NotFound('서비스가 없습니다.');
      if (s.form_type !== 'MATRIX') throw new PolicyViolation('NOT_MATRIX', '매트릭스 견적 서비스가 아닙니다.');
      await this.db.query(`DELETE FROM partner_service_matrix WHERE service_id = $1`, [id]);
      let n = 0;
      for (const c of cells) {
        if (c.amount == null || c.amount === 0) continue;
        if (!Number.isInteger(c.amount) || c.amount < 0) throw new PolicyViolation('BAD_MATRIX', '금액은 원 단위 정수입니다.');
        await this.db.query(`INSERT INTO partner_service_matrix(service_id, row_key, col_key, amount) VALUES ($1,$2,$3,$4)`,
          [id, String(c.row), String(c.col), c.amount]);
        n++;
      }
      await this.db.query(`UPDATE partner_services SET updated_at = now() WHERE id = $1`, [id]);
      return { ok: true, cells: n };
    });
  }

  /* ══ 성과 관리 — 이행 보고 · 소비자 확인 ══════════════════════════════════ */

  async performance() {
    const p = await this.mine();
    const rows = await this.db.query<any>(
      `SELECT f.id, 'D-' || upper(left(replace(f.id::text,'-',''), 6)) AS "no", f.content, f.done_on AS "doneOn", f.amount,
              f.consumer_state AS "consumerState", f.consumer_at AS "consumerAt", f.consumer_rating AS rating,
              f.created_at AS "reportedAt", l.summary, (l.requester_account_id IS NOT NULL) AS "consumerCanConfirm"
         FROM partner_fulfillment_reports f
         JOIN lead_deliveries d ON d.id = f.delivery_id JOIN leads l ON l.id = d.lead_id
        WHERE f.partner_id = $1 ORDER BY f.created_at DESC LIMIT 100`, [p.id]);
    const open = await this.db.query<any>(
      `SELECT d.id AS "deliveryId", l.summary, d.viewed_at AS "viewedAt", c.name AS "categoryName"
         FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id LEFT JOIN categories c ON c.id = l.category_id
        WHERE d.partner_id = $1 AND d.viewed_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM partner_fulfillment_reports f WHERE f.delivery_id = d.id)
        ORDER BY d.viewed_at DESC LIMIT 50`, [p.id]);
    const [t] = await this.db.query<any>(
      `SELECT count(*)::int AS received, count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed,
              round(avg(EXTRACT(epoch FROM (viewed_at - delivered_at)) / 60) FILTER (WHERE viewed_at IS NOT NULL))::int AS "avgViewMin",
              (SELECT count(*)::int FROM lead_fees f WHERE f.partner_id = $1 AND f.state = 'BILLED') AS billed
         FROM lead_deliveries WHERE partner_id = $1 AND state <> 'REVOKED'`, [p.id]);
    return { rows: rows.map((r) => ({ ...r, amount: r.amount != null ? Number(r.amount) : null })), open, metrics: t,
      note: '계약 성사형은 파트너가 이행을 보고하고 소비자가 확인해야 성사로 잡힙니다. 성사는 확인비용과 무관합니다.' };
  }

  async report(dto: { deliveryId: string; content: string; doneOn: string; amount?: number | null }) {
    const p = await this.mine();
    this.uuid(dto.deliveryId, '받은 리드');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.doneOn ?? '')) throw new PolicyViolation('BAD_DATE', '이행일은 YYYY-MM-DD 입니다.');
    const [svc] = await this.db.query<any>(
      `SELECT s.id FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id
         JOIN partner_services s ON s.partner_id = d.partner_id AND s.category_id = l.category_id
        WHERE d.id = $1 AND d.partner_id = $2 ORDER BY (s.status = 'APPROVED') DESC LIMIT 1`, [dto.deliveryId, p.id]);
    const [dup] = await this.db.query(`SELECT 1 FROM partner_fulfillment_reports WHERE delivery_id = $1`, [dto.deliveryId]);
    if (dup) throw new StateConflict('ALREADY_REPORTED', '이미 이행을 보고한 건입니다.');
    const [r] = await this.db.query<any>(
      `INSERT INTO partner_fulfillment_reports(partner_id, delivery_id, service_id, content, done_on, amount)
       VALUES ($1,$2,$3,$4,$5::date,$6) RETURNING id, consumer_state AS "consumerState"`,
      [p.id, dto.deliveryId, svc?.id ?? null, dto.content?.trim(), dto.doneOn, dto.amount ?? null]);
    /* 소비자에게 확인 요청 — 신청한 회원 계정이 있을 때만(알림 센터) */
    await this.db.query(
      `INSERT INTO notifications(account_id, event_code, title, body, link_url)
       SELECT l.requester_account_id, 'FULFILL_CONFIRM_REQUEST', '이행 확인을 부탁드립니다',
              $2 || ' — 상담하신 업체가 일을 마쳤다고 알려 왔습니다. 맞으면 확인해 주십시오.', '/my/fulfillments'
         FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id
        WHERE d.id = $1 AND l.requester_account_id IS NOT NULL`, [dto.deliveryId, p.company]).catch(() => undefined);
    return { ...r, note: '보고했습니다. 소비자가 확인하면 성사로 잡힙니다.' };
  }

  /** 소비자 — 내 상담에 온 이행 보고 */
  async myFulfillments() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const rows = await this.db.query<any>(
      `SELECT f.id, f.content, f.done_on AS "doneOn", f.consumer_state AS state, f.consumer_rating AS rating,
              f.consumer_at AS "confirmedAt", f.created_at AS "reportedAt", b.company_name AS company, l.summary
         FROM partner_fulfillment_reports f
         JOIN lead_deliveries d ON d.id = f.delivery_id JOIN leads l ON l.id = d.lead_id
         JOIN partners p ON p.id = f.partner_id JOIN businesses b ON b.id = p.business_id
        WHERE l.requester_account_id = $1 ORDER BY f.created_at DESC LIMIT 50`, [this.me]);
    return rows;
  }

  async confirmFulfillment(id: string, dto: { result: 'CONFIRMED' | 'DISPUTED'; rating?: number | null; note?: string | null }) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    this.uuid(id, '이행 보고');
    if (!['CONFIRMED', 'DISPUTED'].includes(dto.result)) throw new PolicyViolation('BAD_RESULT', 'result 는 CONFIRMED · DISPUTED 입니다.');
    if (dto.rating != null && !(Number.isInteger(dto.rating) && dto.rating >= 1 && dto.rating <= 5)) {
      throw new PolicyViolation('BAD_RATING', '평점은 1 ~ 5 입니다.');
    }
    if (dto.result === 'DISPUTED' && !dto.note?.trim()) throw new PolicyViolation('NOTE_REQUIRED', '무엇이 다른지 적어 주십시오.');
    const [r] = await this.db.query<any>(
      `UPDATE partner_fulfillment_reports f
          SET consumer_state = $3, consumer_rating = $4, consumer_note = $5
         FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id
        WHERE f.id = $1 AND d.id = f.delivery_id AND l.requester_account_id = $2 AND f.consumer_state = 'WAITING'
      RETURNING f.id, f.consumer_state AS state, f.partner_id AS "partnerId"`,
      [id, this.me, dto.result, dto.rating ?? null, dto.note?.trim() || null]);
    if (!r) throw new StateConflict('NOT_WAITING', '확인할 이행 보고가 아닙니다(이미 확인했거나 내 상담이 아닙니다).');
    await this.db.query(
      `INSERT INTO notifications(account_id, event_code, title, body, link_url)
       SELECT b.account_id, $2, $3, $4, '/partner/performance'
         FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1`,
      [r.partnerId, dto.result === 'CONFIRMED' ? 'FULFILL_CONFIRMED' : 'FULFILL_DISPUTED',
       dto.result === 'CONFIRMED' ? '소비자가 이행을 확인했습니다' : '소비자가 이행 보고에 이의를 냈습니다',
       dto.result === 'CONFIRMED' ? '성사로 잡혔습니다.' : '성과 관리에서 내용을 확인해 주십시오.']).catch(() => undefined);
    return { ok: true, state: r.state };
  }

  /* ══ 회사 · 계정 ═══════════════════════════════════════════════════════ */

  async company() {
    const p = await this.mine();
    const [b] = await this.db.query<any>(
      `SELECT b.company_name AS company, b.biz_reg_no AS "bizRegNo", b.ceo_name AS "ceoName",
              b.biz_type AS "bizType", b.biz_item AS "bizItem",
              /* 주소는 시 · 군 · 구까지만 보여 줍니다(시안 「서울 송파구 ***」) */
              concat_ws(' ', b.sido, b.sigungu) AS "addressShort", (b.address IS NOT NULL OR b.address_road IS NOT NULL) AS "hasAddress",
              b.verified_at AS "verifiedAt", b.nts_status AS "ntsStatus", b.nts_env AS "ntsEnv", b.created_at AS "createdAt",
              p.grade, p.status, p.approved_at AS "approvedAt"
         FROM businesses b JOIN partners p ON p.business_id = b.id WHERE p.id = $1`, [p.id]);
    const changes = await this.db.query<any>(
      `SELECT id, field, after_value AS "afterValue", reason, state, decision_reason AS "decisionReason",
              created_at AS "createdAt", decided_at AS "decidedAt"
         FROM business_change_requests WHERE business_id = $1 ORDER BY created_at DESC LIMIT 20`, [p.businessId]);
    const staff = await this.db.query<any>(
      `SELECT 'OWNER' AS role, a.id AS "accountId", a.email::text AS email, a.name, true AS joined, true AS "canSettle", NULL::timestamptz AS "invitedAt"
         FROM businesses b JOIN accounts a ON a.id = b.account_id WHERE b.id = $1
       UNION ALL
       SELECT m.member_role, a.id, a.email::text, a.name, (m.joined_at IS NOT NULL), m.can_settle, m.invited_at
         FROM business_members m JOIN accounts a ON a.id = m.account_id
        WHERE m.business_id = $1 AND m.member_role = 'STAFF' AND m.removed_at IS NULL`, [p.businessId]);
    staff.sort((a, b) => (a.role === 'OWNER' ? -1 : b.role === 'OWNER' ? 1 : String(a.invitedAt).localeCompare(String(b.invitedAt))));
    const terms = await this.db.query<any>(
      `SELECT t.code, t.title, t.is_required AS required, t.status, a.agreed, a.agreed_at AS "agreedAt", a.term_version AS version
         FROM terms t
         LEFT JOIN LATERAL (SELECT agreed, agreed_at, term_version FROM term_agreements x
                             WHERE x.account_id = $1 AND x.term_code = t.code ORDER BY agreed_at DESC NULLS LAST LIMIT 1) a ON true
        WHERE (t.status = 'PUBLISHED' AND NOT t.is_notice) OR (t.code = 'PARTNER' AND t.status <> 'ARCHIVED')
        ORDER BY t.display_order, t.code`, [p.ownerId]);
    const [brand] = await this.db.query<any>(
      `SELECT brand_name AS "brandName", logo_file_id AS "logoFileId", intro, updated_at AS "updatedAt"
         FROM partner_brands WHERE partner_id = $1`, [p.id]);
    const sites = await this.db.query<any>(
      `SELECT id, name, sido, sigungu, created_at AS "createdAt" FROM partner_brand_sites WHERE partner_id = $1 ORDER BY created_at`, [p.id]);
    /* 개인정보: 대표가 아닌 직원에게는 다른 직원의 이메일을 가립니다 */
    const mask = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_m, a, b2, c) => a + '*'.repeat(Math.min(6, b2.length)) + c);
    return {
      info: b, isOwner: p.isOwner,
      changes,
      staff: staff.map((s) => ({ ...s, email: p.isOwner || s.accountId === this.me ? s.email : mask(String(s.email)),
        name: s.name ? (p.isOwner || s.accountId === this.me ? s.name : String(s.name).slice(0, 1) + '**') : null })),
      terms,
      brand: brand ?? null, sites,
      notes: {
        info: '국세청 진위확인 · 휴폐업 조회가 연동 전이면 「간주」로 표시됩니다 — 판단 근거로 쓰지 마십시오. 변경은 요청으로 접수되고 승인은 본사가 합니다.',
        staff: '직원은 이미 가입한 회원을 이메일로 초대하고, 그 회원이 받아들이면 합류합니다(초대 메일 발송은 아직 없습니다 — 직접 알려 주십시오).',
        brand: '소재는 서비스 노출 단위가 아니라 신뢰 표시 단위입니다.',
      },
    };
  }

  async requestChange(dto: { field: string; afterValue: string; reason: string }) {
    const p = await this.owner();
    const FIELDS = ['COMPANY_NAME', 'CEO_NAME', 'ADDRESS', 'BIZ_TYPE', 'BIZ_ITEM'];
    if (!FIELDS.includes(dto.field)) throw new PolicyViolation('BAD_FIELD', `변경 항목은 ${FIELDS.join(' · ')} 중 하나입니다(사업자등록번호는 바꿀 수 없습니다).`);
    const col: Record<string, string> = { COMPANY_NAME: 'company_name', CEO_NAME: 'ceo_name', ADDRESS: 'address', BIZ_TYPE: 'biz_type', BIZ_ITEM: 'biz_item' };
    const [cur] = await this.db.query<any>(`SELECT ${col[dto.field]} AS v FROM businesses WHERE id = $1`, [p.businessId]);
    const [open] = await this.db.query(`SELECT 1 FROM business_change_requests WHERE business_id = $1 AND field = $2 AND state = 'REQUESTED'`, [p.businessId, dto.field]);
    if (open) throw new StateConflict('ALREADY_REQUESTED', '같은 항목의 변경 요청이 처리 중입니다.');
    const [r] = await this.db.query<any>(
      `INSERT INTO business_change_requests(business_id, field, before_value, after_value, reason, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, state, created_at AS "createdAt"`,
      [p.businessId, dto.field, cur?.v ?? null, dto.afterValue?.trim(), dto.reason?.trim(), this.me]);
    return { ...r, note: '변경 요청을 접수했습니다 — 승인은 본사가 합니다. 승인되면 사업자 정보에 바로 반영됩니다.' };
  }

  async inviteStaff(dto: { email: string; canSettle?: boolean }) {
    const p = await this.owner();
    const email = String(dto.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PolicyViolation('BAD_EMAIL', '이메일 형식이 아닙니다.');
    const [a] = await this.db.query<any>(`SELECT id, status FROM accounts WHERE email = $1 AND withdrawn_at IS NULL`, [email]);
    /* 가입 여부를 응답으로 알려 주지 않으면 대표가 초대를 끝낼 수 없어 알려 주되, 이름 등 다른 정보는 내지 않습니다 */
    if (!a) throw new PolicyViolation('NO_ACCOUNT', '그 이메일로 가입한 회원이 없습니다 — 먼저 소개뱅크에 가입하도록 알려 주십시오.');
    if (a.id === p.ownerId) throw new PolicyViolation('SELF', '대표 계정은 초대하지 않습니다.');
    const [other] = await this.db.query(
      `SELECT 1 FROM business_members WHERE account_id = $1 AND business_id <> $2 AND removed_at IS NULL`, [a.id, p.businessId]);
    if (other) throw new StateConflict('OTHER_BUSINESS', '다른 사업자에 소속된 계정입니다.');
    await this.db.query(
      `INSERT INTO business_members(business_id, account_id, member_role, can_settle, invited_by)
       VALUES ($1,$2,'STAFF',$3,$4)
       ON CONFLICT (business_id, account_id) DO UPDATE SET can_settle = EXCLUDED.can_settle, invited_by = EXCLUDED.invited_by,
              invited_at = now(), joined_at = NULL, removed_at = NULL
        WHERE business_members.member_role = 'STAFF'`, [p.businessId, a.id, !!dto.canSettle, this.me]);
    return { ok: true, state: 'INVITED', note: '초대했습니다 — 그 회원이 로그인해 「파트너센터 → 회사 · 계정」에서 받아들이면 합류합니다.' };
  }

  async removeStaff(accountId: string) {
    const p = await this.owner();
    this.uuid(accountId, '직원');
    const rows = await this.db.query(
      `UPDATE business_members SET removed_at = now() WHERE business_id = $1 AND account_id = $2 AND member_role = 'STAFF' AND removed_at IS NULL RETURNING account_id`,
      [p.businessId, accountId]);
    if (!rows.length) throw new NotFound('직원이 아닙니다.');
    return { ok: true, note: '직원 계정을 뺐습니다 — 이제 파트너센터에 들어오지 못합니다.' };
  }

  /** 초대받은 회원 — 내 초대 목록 · 받아들이기 */
  async myInvites() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    return this.db.query<any>(
      `SELECT m.business_id AS "businessId", b.company_name AS company, m.invited_at AS "invitedAt", m.can_settle AS "canSettle"
         FROM business_members m JOIN businesses b ON b.id = m.business_id
        WHERE m.account_id = $1 AND m.joined_at IS NULL AND m.removed_at IS NULL AND m.member_role = 'STAFF'`, [this.me]);
  }
  async acceptInvite(businessId: string) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    this.uuid(businessId, '초대');
    const rows = await this.db.query(
      `UPDATE business_members SET joined_at = now()
        WHERE business_id = $1 AND account_id = $2 AND joined_at IS NULL AND removed_at IS NULL AND member_role = 'STAFF'
       RETURNING business_id`, [businessId, this.me]);
    if (!rows.length) throw new NotFound('받아들일 초대가 없습니다.');
    return { ok: true, note: '합류했습니다. 파트너센터를 쓰실 수 있습니다.' };
  }

  async putBrand(dto: { brandName: string; intro?: string | null; logoFileId?: string | null }) {
    const p = await this.owner();
    if (dto.logoFileId) {
      this.uuid(dto.logoFileId, '파일');
      const [f] = await this.db.query(`SELECT 1 FROM files WHERE id = $1 AND owner_account_id = $2 AND status = 'READY'`, [dto.logoFileId, this.me]);
      if (!f) throw new PolicyViolation('BAD_FILE', '올린 파일이 아니거나 아직 올리는 중입니다.');
    }
    await this.db.query(
      `INSERT INTO partner_brands(partner_id, brand_name, intro, logo_file_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (partner_id) DO UPDATE SET brand_name = EXCLUDED.brand_name, intro = EXCLUDED.intro,
              logo_file_id = coalesce(EXCLUDED.logo_file_id, partner_brands.logo_file_id), updated_at = now()`,
      [p.id, dto.brandName?.trim(), dto.intro?.trim() || null, dto.logoFileId ?? null]);
    return { ok: true };
  }
  async addSite(dto: { name: string; sido: string; sigungu?: string | null }) {
    const p = await this.owner();
    if (!dto.sido?.trim()) throw new PolicyViolation('NO_SIDO', '시 · 도를 고르십시오.');
    const [r] = await this.db.query<any>(
      `INSERT INTO partner_brand_sites(partner_id, name, sido, sigungu) VALUES ($1,$2,$3,$4)
       ON CONFLICT (partner_id, name) DO NOTHING RETURNING id`, [p.id, dto.name?.trim(), normSido(dto.sido.trim()), dto.sigungu?.trim() || null]);
    if (!r) throw new StateConflict('DUP_SITE', '같은 이름의 소재가 있습니다.');
    return { ok: true, id: r.id };
  }
  async removeSite(id: string) {
    const p = await this.owner();
    this.uuid(id, '소재');
    const rows = await this.db.query(`DELETE FROM partner_brand_sites WHERE id = $1 AND partner_id = $2 RETURNING id`, [id, p.id]);
    if (!rows.length) throw new NotFound('소재가 없습니다.');
    return { ok: true };
  }

  /* ══ 전용 트랙 ═════════════════════════════════════════════════════════ */

  async tracks() {
    const p = await this.mine();
    const repair = await this.db.query<any>(
      `SELECT d.id AS "deliveryId", 'R-' || upper(left(replace(l.id::text,'-',''), 6)) AS "no", l.summary,
              concat_ws(' ', l.sido, l.sigungu) AS area, d.delivered_at AS "deliveredAt", d.viewed_at AS "viewedAt",
              d.state, q.amount AS "quoteAmount", q.sent_at AS "quotedAt",
              (SELECT f.consumer_state FROM partner_fulfillment_reports f WHERE f.delivery_id = d.id) AS "fulfillState",
              fn_lead_fee_quote(l.id, d.partner_id) AS "feeQuote"
         FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id JOIN categories c ON c.id = l.category_id
         LEFT JOIN partner_track_quotes q ON q.delivery_id = d.id
        WHERE d.partner_id = $1 AND c.partner_track = 'REPAIR' AND d.state <> 'REVOKED'
        ORDER BY d.delivered_at DESC LIMIT 100`, [p.id]);
    const car = await this.db.query<any>(
      `SELECT x.id, 'C-' || upper(left(replace(x.id::text,'-',''), 6)) AS "no", x.title, x.status, x.created_at AS "createdAt",
              c.name AS "categoryName"
         FROM listings x JOIN categories c ON c.id = x.category_id
        WHERE x.owner_account_id = $1 AND c.partner_track = 'USEDCAR' AND x.status <> 'DELETED'
        ORDER BY x.created_at DESC LIMIT 100`, [p.ownerId]);
    const catalog = await this.db.query<any>(
      `SELECT id, name, sale_kind AS "saleKind", price, state, created_at AS "createdAt"
         FROM partner_catalog_items WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 200`, [p.id]);
    const [tracksOn] = await this.db.query<any>(
      `SELECT array_agg(DISTINCT c.partner_track) FILTER (WHERE c.partner_track IS NOT NULL) AS t
         FROM partner_services s JOIN categories c ON c.id = s.category_id WHERE s.partner_id = $1 AND s.status = 'APPROVED'`, [p.id]);
    return {
      repair: repair.map((r) => ({ ...r, quoteAmount: r.quoteAmount != null ? Number(r.quoteAmount) : null, feeQuote: Number(r.feeQuote ?? 0),
        stage: r.fulfillState === 'CONFIRMED' ? '성사' : r.quoteAmount != null ? '견적 발송' : r.viewedAt ? '연락처 확인' : r.state === 'EXPIRED' ? '기한 지남' : '견적 요청' })),
      car, catalog: catalog.map((c) => ({ ...c, price: Number(c.price) })),
      enabled: (tracksOn?.t ?? []) as string[],
      notes: {
        track: '전용 트랙은 업종마다 다른 접수 형태를 씁니다 — 판금 · 도색은 견적요청함, 중고차는 매물, 렌탈은 카탈로그입니다.',
        car: '국토부 자동차 이력 조회는 아직 연동 전이라 조회 결과를 보여 주지 않습니다(조회 전) — 임시 값을 실조회처럼 보이지 않게 합니다.',
        repair: '연락처를 열어야(확인비용 차감) 견적을 보낼 수 있습니다. 사진 첨부는 파일 저장소 연동 뒤 열립니다.',
      },
    };
  }

  async sendQuote(deliveryId: string, dto: { amount: number; message?: string | null }) {
    const p = await this.mine();
    this.uuid(deliveryId, '견적 요청');
    if (!Number.isInteger(dto.amount) || dto.amount <= 0) throw new PolicyViolation('BAD_AMOUNT', '견적 금액은 원 단위 정수입니다.');
    const [r] = await this.db.query<any>(
      `INSERT INTO partner_track_quotes(delivery_id, partner_id, amount, message) VALUES ($1,$2,$3,$4)
       ON CONFLICT (delivery_id) DO UPDATE SET amount = EXCLUDED.amount, message = EXCLUDED.message, sent_at = now()
       RETURNING delivery_id AS "deliveryId", amount, sent_at AS "sentAt"`,
      [deliveryId, p.id, dto.amount, dto.message?.trim() || null]);
    return { ...r, amount: Number(r.amount), note: '견적을 저장했습니다 — 연 연락처로 직접 안내해 주십시오.' };
  }

  async addCatalog(dto: { name: string; saleKind: string; price: number }) {
    const p = await this.mine();
    if (!['RENTAL', 'SALE'].includes(dto.saleKind)) throw new PolicyViolation('BAD_KIND', '형태는 렌탈(RENTAL) · 판매(SALE)입니다.');
    if (!Number.isInteger(dto.price) || dto.price <= 0) throw new PolicyViolation('BAD_PRICE', '가격은 원 단위 정수입니다.');
    const [r] = await this.db.query<any>(
      `INSERT INTO partner_catalog_items(partner_id, name, sale_kind, price) VALUES ($1,$2,$3,$4) RETURNING id, state`,
      [p.id, dto.name?.trim(), dto.saleKind, dto.price]);
    return { ok: true, ...r };
  }
  async setCatalog(id: string, state: string) {
    const p = await this.mine();
    this.uuid(id, '카탈로그 품목');
    if (!['LISTED', 'HIDDEN'].includes(state)) throw new PolicyViolation('BAD_STATE', '상태는 LISTED · HIDDEN 입니다.');
    const rows = await this.db.query(`UPDATE partner_catalog_items SET state = $3, updated_at = now() WHERE id = $1 AND partner_id = $2 RETURNING id`, [id, p.id, state]);
    if (!rows.length) throw new NotFound('카탈로그 품목이 없습니다.');
    return { ok: true, state };
  }

  /* ══ 운영(w6 BO 와 이름을 맞춤 — SHARED_NOTES) ═══════════════════════════ */
}
