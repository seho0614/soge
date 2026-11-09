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
 *   POINT    회원 포인트 출금 (point_cashouts · v10.219 · D190) — 회원이 신청(REQUESTED)하면 운영이 확정 · 반려
 * 소개비는 당사자 직접 지급이라 여기 없습니다(INV-11).
 *
 * 흐름   DRAFT(포인트는 REQUESTED) ──확정(ADMIN)──► CONFIRMED ──지급(PAYOUT)──► PAID
 * 확정한 사람과 지급한 사람이 같으면 DB 가 막습니다(C997 fn_payout_two_person).
 */
const TBL = {
  PARTNER: { table: 'partner_settlements', col: 'state' },
  HEALTH:  { table: 'hlt_settlements',     col: 'status' },
  POINT:   { table: 'point_cashouts',      col: 'status' },
} as const;
/** 확정할 수 있는 상태 — 정산은 DRAFT · 포인트 출금은 회원 신청(REQUESTED) */
const FROM: Record<Kind, string> = { PARTNER: 'DRAFT', HEALTH: 'DRAFT', POINT: 'REQUESTED' };
type Kind = keyof typeof TBL;

@Injectable()
export class PayoutService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  private kindOf(k: string): Kind {
    const u = k.toUpperCase();
    if (u !== 'PARTNER' && u !== 'HEALTH' && u !== 'POINT') throw new NotFound('없는 지급 종류입니다 (partner · health · point).');
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
       UNION ALL
       SELECT 'POINT', c.id, 'MEMBER', a.name, (c.requested_at AT TIME ZONE 'Asia/Seoul')::date, NULL::date, c.net_amount::bigint
         FROM point_cashouts c JOIN accounts a ON a.id = c.account_id
        WHERE c.status = 'REQUESTED'
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
       UNION ALL
       SELECT 'POINT', c.id, a.name, c.net_amount::bigint, c.paid_at, c.paid_ref, pa.name
         FROM point_cashouts c JOIN accounts a ON a.id = c.account_id
         LEFT JOIN accounts pa ON pa.id = c.paid_by
        WHERE c.status = 'PAID'
        ORDER BY 5 DESC NULLS LAST LIMIT 50`);
    /* v10.219 (D190) — 포인트 출금 기준(최소 · 원천징수율 · 비어 있으면 신청 막힘) — 바꾸기는 SUPER(운영 설정 point.cashout_*) */
    const [pointSetting] = await this.db.query<{ min: number; taxRate: string | null }>(
      `SELECT coalesce(nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_min'), '')::int, 10000) AS min,
              nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'), '') AS "taxRate"`);
    const readyAmt = (queue as Array<{ ready: boolean; amount: number }>)
      .filter((q) => q.ready).reduce((a, q) => a + Number(q.amount), 0);
    return {
      queue, drafts, paid, pointSetting,
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
        WHERE id = $1 AND ${col} = $3 RETURNING id`, [id, this.me, FROM[k]]);
    if (!rows.length) throw new PolicyViolation('NOT_DRAFT', k === 'POINT'
      ? '확정할 수 있는 출금 신청이 아닙니다 (신청 상태만).' : '확정할 수 있는 정산이 아닙니다 (DRAFT 만).');
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

  /** v10.219 (D190) — 포인트 출금 반려(신청 · 확정 상태) · 사유 필수 · 반려한 포인트는 다시 출금할 수 있는 잔액으로 돌아감 */
  async reject(kind: string, id: string, reason: string) {
    if (this.kindOf(kind) !== 'POINT') throw new PolicyViolation('REJECT_POINT_ONLY', '반려는 포인트 출금만 할 수 있습니다.');
    if ((reason ?? '').trim().length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 2자 이상 적어 주십시오.');
    const rows = await this.db.query<{ id: string }>(
      `UPDATE point_cashouts SET status = 'REJECTED', closed_by = $2, closed_reason = $3
        WHERE id = $1 AND status IN ('REQUESTED', 'CONFIRMED') RETURNING id`, [id, this.me, reason.trim()]);
    if (!rows.length) throw new PolicyViolation('NOT_OPEN', '반려할 수 있는 출금 신청이 아닙니다 (신청 · 확정 상태만).');
    return { ok: true, id, status: 'REJECTED', note: '반려했습니다. 포인트는 회원의 출금 가능 잔액으로 돌아갑니다.' };
  }
}
