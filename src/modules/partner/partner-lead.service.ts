import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { LeadCashService } from './lead-cash.service';
import { PartnerActorService } from './partner-actor.service';

/**
 * 파트너센터 — 리드(배정된 요청) 목록 · 연락처 · 열람.
 * 리드 이용료는 정보 이용료입니다 — 열람 시점에 발생하고 성사와 무관합니다(INV-9R · partner.service.ts 머리 주석).
 * v10.86 — partner.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class PartnerLeadService {
  private readonly log = new Logger(PartnerLeadService.name);
  constructor(private readonly db: DatabaseService, private readonly cash: LeadCashService,
              private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }
  /** 내 파트너 계정. 없으면 신청 안내를 냅니다.
   *  v10.31 (W5 · CTR-610 계정) — 대표 계정 또는 합류한 직원 계정(business_members · 빠지지 않은).
   *  v10.87 — 세 서비스(핵심 · 리드 · 이용료)에 같은 본문. 매트릭스 생성기(gen-matrix)가 this.actors.forMember 의 SQL 까지 따라가게 함수로 빼지 않음 */
  private async mine() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const p = await this.actors.forMember(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!p) return null;
    const { canMoney: _money, ...mine } = p;           // 이 자리가 내보내던 칸 그대로(대시보드 응답에 펼쳐 넣음)
    return mine;
  }

  /**
   * 받은 리드.
   *
   * **열람 전에는 요약만 보입니다.** 지역·분야·시기까지는 무료이고,
   * 연락처를 여는 순간 이용료가 발생합니다.
   */
  async leads() {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    /* D008 — 배정 상태 · 열람 기한 · 업종을 함께 냅니다. 회수(REVOKED)된 건은 뺍니다 —
     * 운영이 거둬 간 건을 계속 보여 주면 "왜 못 여나" 를 묻게 됩니다. */
    const rows = await this.db.query<any>(
      `SELECT d.id AS "deliveryId", l.id AS "leadId", l.summary, l.sido, l.sigungu,
              l.is_urgent AS "urgent", d.delivered_at AS "deliveredAt",
              d.viewed_at AS "viewedAt", d.state, d.expires_at AS "expiresAt",
              c.name AS "categoryName",
              (pc.lead_id IS NOT NULL AND pc.purged_at IS NULL) AS "hasContact",
              f.amount AS "fee", f.state AS "feeState", f.id AS "feeId",
              /* v10.31 (W5 · CTR-300) — 등급 · 알림톡 · 예상 확인비용 · 메모 · 반려 신청 상태 */
              l.grade, fn_lead_grade_label(l.grade) AS "gradeLabel", l.alim_state AS "alimState",
              fn_lead_fee_quote(l.id, d.partner_id) AS "feeQuote",
              (SELECT m.body FROM lead_delivery_memos m WHERE m.delivery_id = d.id ORDER BY m.created_at DESC LIMIT 1) AS memo,
              (SELECT count(*)::int FROM lead_delivery_memos m WHERE m.delivery_id = d.id) AS "memoCount",
              x.state AS "disputeState", x.id AS "disputeId",
              (f.id IS NOT NULL AND f.state <> 'VOIDED' AND x.id IS NULL
                AND d.delivered_at >= now() - interval '72 hours') AS "disputable"
         FROM lead_deliveries d
         JOIN leads l ON l.id = d.lead_id
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN pii.lead_contacts pc ON pc.lead_id = l.id
         LEFT JOIN lead_fees f ON f.delivery_id = d.id
         LEFT JOIN lead_fee_disputes x ON x.fee_id = f.id
        WHERE d.partner_id = $1 AND d.state <> 'REVOKED'
        ORDER BY (d.state = 'DELIVERED') DESC, d.delivered_at DESC LIMIT 100`, [p.id]);

    return rows.map(r => ({
      ...r,
      // 열람 전에는 연락처 자리를 아예 내려보내지 않습니다. 열람 뒤에도 목록에는 싣지 않습니다 —
      // 연락처는 GET /partner/leads/{id}/contact 로만 풀리고, 풀 때마다 기록이 남습니다.
      contact: r.viewedAt ? '(열람됨 — 연락처 보기로 확인)' : null,
      note: r.state === 'EXPIRED' ? '열람 기한이 지나 다른 업체로 넘어갔습니다.'
        : r.viewedAt ? null : '연락처를 열면 확인비용이 리드 이용료 잔액에서 빠집니다.',
    }));
  }

  /**
   * 열람한 리드의 연락처 (D008).
   *
   * 열람(과금)과 나눕니다 — 열람 응답은 감사 로그(audit_logs.after_data)에 통째로 남아,
   * 거기에 연락처를 실으면 평문 개인정보가 감사 로그에 쌓입니다. 여기서는
   * pii.fn_read_lead_contact 만 거치고, 그 함수가 열람 기록(pii_access_logs)을 남깁니다.
   */
  async leadContact(deliveryId: string) {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new StateConflict('NO_SUCH_LEAD', '받은 리드가 아닙니다.');
    const [d] = await this.db.query<any>(
      `SELECT d.id, d.lead_id, d.viewed_at, d.state,
              pc.lead_id IS NOT NULL AS has_contact, pc.purged_at
         FROM lead_deliveries d
         LEFT JOIN pii.lead_contacts pc ON pc.lead_id = d.lead_id
        WHERE d.id = $1 AND d.partner_id = $2`, [deliveryId, p.id]);
    if (!d) throw new StateConflict('NO_SUCH_LEAD', '받은 리드가 아닙니다.');
    if (!d.viewed_at) {
      throw new PolicyViolation('NOT_VIEWED', '먼저 「연락처 열기」로 열람하셔야 합니다. 열람할 때 이용료가 발생합니다.');
    }
    if (!d.has_contact) {
      return { deliveryId, contact: null, note: '연락처가 따로 저장되지 않은 옛 형식 리드입니다.' };
    }
    if (d.purged_at) {
      return { deliveryId, contact: null, purgedAt: d.purged_at,
        note: '보관 기한이 지나 연락처를 파기했습니다(개인정보 보호법).' };
    }
    const [c] = await this.db.query<any>(
      `SELECT name, phone, address, email FROM pii.fn_read_lead_contact($1, $2, $3)`,      /* v10.28 — 이메일(상담 신청에서 받은 것 · 옛 신청은 null) */
      [d.lead_id, this.me, `파트너 리드 열람 — 배정 ${deliveryId}`]);
    return { deliveryId, contact: c ?? null,
      note: '상담 목적 외에 쓰거나 남에게 넘기면 개인정보 보호법 위반입니다. 이 조회는 기록됩니다.' };
  }

  /**
   * 리드 열람 = 과금.
   *
   * 이 시점 하나뿐입니다. 성사되면 더 내지 않고, 안 되면 돌려받지도 않습니다 —
   * 정보 이용료이기 때문입니다.
   */
  async viewLead(deliveryId: string) {
    const p = await this.mine();
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');

    const [elig] = await this.db.query<{ can_receive: boolean; balance: string }>(
      'SELECT can_receive, balance FROM v_partner_eligible WHERE partner_id = $1', [p.id]);
    if (!elig?.can_receive) {
      /* v10.31 (W5 · D070) — 선불 잔액이 없으면 그 이유를 먼저 말합니다 */
      if (elig && Number(elig.balance) <= 0) {
        throw new PolicyViolation('LEADCASH', '리드 이용료 잔액이 없습니다 — 「리드 이용료」에서 충전하신 뒤 여십시오.');
      }
      throw new PolicyViolation('NOT_ELIGIBLE',
        '이전 후불 미납 한도를 넘었거나 승인된 서비스·활동 지역이 없습니다.');
    }

    return this.db.transaction(async () => {
      const [d] = await this.db.query<any>(
        `UPDATE lead_deliveries SET viewed_at = coalesce(viewed_at, now())
          WHERE id = $1 AND partner_id = $2
        RETURNING id, lead_id, viewed_at`, [deliveryId, p.id]);
      if (!d) throw new StateConflict('NO_SUCH_LEAD', '받은 리드가 아닙니다.');

      // 이미 과금된 건이면 다시 붙이지 않습니다(UNIQUE 가 막지만 메시지가 낫습니다).
      const [exist] = await this.db.query<{ amount: string }>(
        'SELECT amount FROM lead_fees WHERE delivery_id = $1', [d.id]);

      let fee = exist?.amount;
      let parts: { bonus: number; paid: number } | null = null;
      if (!exist) {
        /* v10.31 (W5 · D077) — 확인비용은 DB 한 곳(fn_lead_fee_quote)에서 정합니다:
         *   파트너가 이 업종에 정한 최고 확인비용 → 업종 기준 단가 → 기본 단가(lead.default_fee), × 리드 등급 비율.
         * ★ 코드에 기본값을 박지 않습니다(전에는 8,000 이 박혀 단가를 낮춰도 그대로 매겨졌습니다). */
        const [price] = await this.db.query<{ fee: string | null }>(
          `SELECT fn_lead_fee_quote($1, $2) AS fee`, [d.lead_id, p.id]);
        /* 선불(D070) — 이 INSERT 의 트리거가 잔액에서 뺍니다(보너스 먼저). 모자라면 LEADCASH 로 막히고 열람도 함께 되돌아갑니다 */
        const [f] = await this.db.query<{ amount: string; bonus_part: string | null; paid_part: string | null }>(
          `INSERT INTO lead_fees(delivery_id, partner_id, amount)
           VALUES ($1,$2,$3) RETURNING amount, bonus_part, paid_part`,
          /* 설정도 없으면 과금하지 않습니다 — 모르는 값으로 청구하느니
           *  안 받는 편이 낫습니다. 감시 뷰가 이 상태를 잡습니다. */
          [d.id, p.id, Number(price?.fee ?? 0)]);
        fee = f.amount;
        parts = { bonus: Number(f.bonus_part ?? 0), paid: Number(f.paid_part ?? 0) };
      }

      const [lead] = await this.db.query<any>(
        `SELECT summary, sido, sigungu FROM leads WHERE id = $1`, [d.lead_id]);
      return { ...lead, fee: Number(fee), viewedAt: d.viewed_at, parts,
        contactUrl: `/partner/leads/${d.id}/contact`,
        note: parts
          ? `확인비용 ${Number(fee).toLocaleString('ko-KR')}원이 잔액에서 빠졌습니다${parts.bonus ? `(보너스 ${parts.bonus.toLocaleString('ko-KR')}원 · 유상 ${parts.paid.toLocaleString('ko-KR')}원)` : ''}. 성사 여부와 무관합니다.`
          : '이미 연 리드입니다 — 확인비용은 한 번만 냅니다.' };
    }).then((out) => {
      /* 자동 청구 — 잔액이 기준 아래로 내려갔으면 뒤에서 한 번 충전합니다(실패해도 열람은 그대로) */
      void this.cash.runAuto(p.id).catch((e) => this.log.warn(`lead cash auto: ${e?.message ?? e}`));
      return out;
    });
  }
}
