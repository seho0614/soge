import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * 지급 데스크 (2026-10-01 결정 Q1).
 *
 * 플랫폼이 실제로 돈을 내보내는 곳은 두 군데입니다.
 *   PARTNER  제휴 파트너 수수료 (partner_settlements)
 *   HEALTH   소개몰 판매자 정산 (hlt_settlements)
 * 소개비는 당사자 직접 지급이라 여기 없습니다(INV-11).
 *
 * 흐름   DRAFT ──확정(ADMIN)──► CONFIRMED ──지급(PAYOUT)──► PAID
 * 확정한 사람과 지급한 사람이 같으면 DB 가 막습니다(C997 fn_payout_two_person).
 */
const TBL = {
  PARTNER: { table: 'partner_settlements', col: 'state' },
  HEALTH:  { table: 'hlt_settlements',     col: 'status' },
} as const;
type Kind = keyof typeof TBL;

@Injectable()
export class PayoutService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  private kindOf(k: string): Kind {
    const u = k.toUpperCase();
    if (u !== 'PARTNER' && u !== 'HEALTH') throw new NotFound('없는 지급 종류입니다 (partner · health).');
    return u;
  }

  async desk() {
    const queue = await this.db.query(
      `SELECT kind, id, sub, payee, period_from AS "from", period_to AS "to",
              amount::bigint AS amount, status, confirmed_at AS "confirmedAt",
              ready, blocker, bank_name AS "bankName", account_last4 AS "last4",
              holder_name AS "holder"
         FROM v_payout_queue ORDER BY ready DESC, confirmed_at NULLS LAST, payee`);
    const drafts = await this.db.query(
      `SELECT 'PARTNER' AS kind, s.id, s.track AS sub, b.company_name AS payee,
              s.period_from AS "from", s.period_to AS "to", s.net_amount::bigint AS amount
         FROM partner_settlements s JOIN partners p ON p.id = s.partner_id
         JOIN businesses b ON b.id = p.business_id
        WHERE s.state = 'DRAFT'
       UNION ALL
       SELECT 'HEALTH', h.id, sl.type, sl.name, h.period_from, h.period_to, h.net_amount::bigint
         FROM hlt_settlements h JOIN hlt_sellers sl ON sl.id = h.seller_id
        WHERE h.status = 'DRAFT'
        ORDER BY 5 DESC, 4`);
    const paid = await this.db.query(
      `SELECT 'PARTNER' AS kind, s.id, b.company_name AS payee, s.net_amount::bigint AS amount,
              s.paid_at AS "paidAt", s.paid_ref AS ref, pa.name AS "paidBy"
         FROM partner_settlements s JOIN partners p ON p.id = s.partner_id
         JOIN businesses b ON b.id = p.business_id
         LEFT JOIN accounts pa ON pa.id = s.paid_by
        WHERE s.state = 'PAID'
       UNION ALL
       SELECT 'HEALTH', h.id, sl.name, h.net_amount::bigint, h.paid_at, h.paid_ref, pa.name
         FROM hlt_settlements h JOIN hlt_sellers sl ON sl.id = h.seller_id
         LEFT JOIN accounts pa ON pa.id = h.paid_by
        WHERE h.status = 'PAID'
        ORDER BY 5 DESC NULLS LAST LIMIT 50`);
    const readyAmt = (queue as Array<{ ready: boolean; amount: number }>)
      .filter((q) => q.ready).reduce((a, q) => a + Number(q.amount), 0);
    return {
      queue, drafts, paid,
      summary: { waiting: queue.length, ready: (queue as Array<{ ready: boolean }>).filter((q) => q.ready).length,
                 readyAmount: readyAmt, drafts: drafts.length },
      note: '확정은 운영(ADMIN), 지급은 지급 담당(PAYOUT)이 합니다. 같은 사람이 둘 다 할 수 없습니다.',
    };
  }

  async confirm(kind: string, id: string) {
    const k = this.kindOf(kind);
    const { table, col } = TBL[k];
    const rows = await this.db.query<{ id: string }>(
      `UPDATE ${table} SET ${col} = 'CONFIRMED', confirmed_by = $2
        WHERE id = $1 AND ${col} = 'DRAFT' RETURNING id`, [id, this.me]);
    if (!rows.length) throw new PolicyViolation('NOT_DRAFT', '확정할 수 있는 정산이 아닙니다 (DRAFT 만).');
    return { ok: true, id, status: 'CONFIRMED', note: '확정했습니다. 지급은 지급 담당이 합니다.' };
  }

  async pay(kind: string, id: string, ref: string, memo?: string) {
    const k = this.kindOf(kind);
    const { table, col } = TBL[k];
    if (!ref?.trim()) throw new PolicyViolation('REF_REQUIRED', '이체 참조(은행 거래번호 등)를 적어 주십시오.');
    const memoSql = k === 'HEALTH' ? ', memo = coalesce($4, memo)' : '';
    const params = k === 'HEALTH' ? [id, this.me, ref.trim(), memo ?? null] : [id, this.me, ref.trim()];
    const rows = await this.db.query<{ id: string }>(
      `UPDATE ${table} SET ${col} = 'PAID', paid_by = $2, paid_ref = $3 ${memoSql}
        WHERE id = $1 AND ${col} = 'CONFIRMED' RETURNING id`, params);
    if (!rows.length) throw new PolicyViolation('NOT_CONFIRMED', '지급할 수 있는 정산이 아닙니다 (확정된 것만).');
    return { ok: true, id, status: 'PAID', ref: ref.trim(), note: '지급을 기록했습니다. 되돌릴 수 없습니다 — 틀렸으면 다음 회차에서 조정하십시오.' };
  }
}
