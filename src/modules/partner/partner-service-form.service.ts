import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from './partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { FORM_KO, FORM_STEPS } from './partner-center.service';

const BLOCK_KO: Record<string, string> = {
  HERO_IMAGE: '대표 이미지', INTRO: '서비스 소개', PRICE: '가격표', CASES: '시공 사례', FAQ: '자주 묻는 질문', LOCATION: '오시는 길',
};
const BLOCKS = Object.keys(BLOCK_KO);
const PHONE = /01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}/;

/**
 * 파트너센터 — 내 서비스: 등록 방식 · 위자드 정의 · 상세 · 수정(재검수) · 노출 중단 · 재개 · 상세페이지 블록 · 견적 매트릭스 (CTR-200 · 201 · 210).
 *
 * v10.108 (리팩토링 4차 · docs/168) — partner-center.service.ts 에서 함수 본문을 그대로 옮겼습니다(mine() · uuid() 는 두 곳에 원본 그대로).
 */
@Injectable()
export class PartnerServiceFormService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }
  private async mine() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const p = await this.actors.forMember(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    const { id, grade, status, businessId, ownerId, company, isOwner } = p;   // 이 자리가 쓰던 칸 그대로
    return { id, grade, status, businessId, ownerId, company, isOwner };
  }
  private uuid(id: string, what = '대상') {
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new NotFound(`${what}이(가) 없습니다.`);
  }
  private async actor() {
    await this.db.query(`SELECT set_config('app.actor_id', $1, true)`, [this.me ?? '']);
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
}
