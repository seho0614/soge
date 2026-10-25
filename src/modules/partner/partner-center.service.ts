import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from './partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';


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
 *
 * v10.108 (리팩토링 4차 · docs/168) — 내 서비스는 partner-service-form.service.ts, 회사 · 계정은 partner-company.service.ts 로 나눴습니다(함수 본문 그대로).
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
  private uuid(id: string, what = '대상') {
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new NotFound(`${what}이(가) 없습니다.`);
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
