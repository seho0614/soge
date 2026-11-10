import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.224 (D194 · docs/359) — 파트너 본인 해지(탈퇴)
 *
 *   안심소개(MAL)   status APPLIED · ACTIVE · SUSPENDED → WITHDRAWN · 축 입점(승인 · 심사 중)도 해지 · 자동 충전 끔
 *                  막는 것: 전환 전 후불 미납 이용료 · 리드 이용료 유상 잔액(먼저 환불 신청) · 처리 중 환불 · 지급 안 끝난 소개비 정산
 *   제휴(AFF)       aff_status APPLIED · ACTIVE · SUSPENDED → WITHDRAWN · 링크 끔
 *                  막는 것: 확정 · 정산 전 제휴 주문 · 지급 안 끝난 제휴 정산
 *   누구            파트너 대표 계정 본인만(합류 직원은 못 함)
 *   다시            탈퇴한 자격은 다시 신청할 수 있음(입점 심사부터 · partner.service apply · affiliate.service apply)
 *   한쪽만 해지해도 다른 자격은 그대로(D173 — 두 자격은 따로)
 * ------------------------------------------------------------------- */
export type WithdrawTrack = 'MAL' | 'AFF';

@Injectable()
export class PartnerWithdrawService {
  constructor(private readonly db: DatabaseService) {}
  private get me() {
    const id = RequestCtx.actorId();
    if (!id) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    return id;
  }

  /** 대표 계정 본인의 파트너 줄 */
  private async owned() {
    const [p] = await this.db.query<{ id: string; status: string; affStatus: string | null }>(
      `SELECT p.id, p.status, p.aff_status AS "affStatus"
         FROM partners p JOIN businesses b ON b.id = p.business_id
        WHERE b.account_id = $1
        ORDER BY (p.status <> 'NONE') DESC, p.approved_at DESC NULLS LAST LIMIT 1`, [this.me]);
    return p ?? null;
  }

  private async malBlockers(partnerId: string) {
    const [r] = await this.db.query<{ fees: number; paid: number; refunds: number; settle: number }>(
      `SELECT (SELECT count(*)::int FROM lead_fees WHERE partner_id = $1 AND state = 'PENDING') AS fees,
              coalesce((SELECT paid_balance FROM lead_cash_wallets WHERE partner_id = $1), 0)::bigint AS paid,
              (SELECT count(*)::int FROM lead_cash_refunds WHERE partner_id = $1 AND state = 'REQUESTED') AS refunds,
              (SELECT count(*)::int FROM partner_settlements WHERE partner_id = $1 AND track = 'REFERRAL' AND state IN ('DRAFT','CONFIRMED') AND net_amount <> 0) AS settle`,
      [partnerId]);
    const why: string[] = [];
    if (r.fees) why.push(`전환 전 후불 미납 이용료 ${r.fees}건 — 먼저 결제해 주십시오`);
    if (Number(r.paid) > 0) why.push(`리드 이용료 유상 잔액 ${Number(r.paid).toLocaleString('ko-KR')}원 — 먼저 환불을 신청해 주십시오`);
    if (r.refunds) why.push(`처리 중인 환불 ${r.refunds}건`);
    if (r.settle) why.push(`지급 안 끝난 소개비 정산 ${r.settle}건`);
    return why;
  }

  private async affBlockers(partnerId: string) {
    const [r] = await this.db.query<{ orders: number; settle: number }>(
      `SELECT (SELECT count(*)::int FROM partner_orders WHERE partner_id = $1 AND state IN ('PENDING','CONFIRMED')) AS orders,
              (SELECT count(*)::int FROM partner_settlements WHERE partner_id = $1 AND track = 'AFFILIATE' AND state IN ('DRAFT','CONFIRMED') AND net_amount <> 0) AS settle`,
      [partnerId]);
    const why: string[] = [];
    if (r.orders) why.push(`확정 · 정산 전 제휴 주문 ${r.orders}건`);
    if (r.settle) why.push(`지급 안 끝난 제휴 정산 ${r.settle}건`);
    return why;
  }

  /** 해지할 수 있는지 — 자격마다 막는 것 */
  async check() {
    const p = await this.owned();
    const mal = p && ['APPLIED', 'ACTIVE', 'SUSPENDED'].includes(p.status) ? await this.malBlockers(p.id) : null;
    const aff = p && ['APPLIED', 'ACTIVE', 'SUSPENDED'].includes(p.affStatus ?? '') ? await this.affBlockers(p.id) : null;
    return {
      mal: mal === null ? null : { status: p!.status, can: mal.length === 0, why: mal },
      aff: aff === null ? null : { status: p!.affStatus, can: aff.length === 0, why: aff },
    };
  }

  /** 본인 해지 */
  async withdraw(track: WithdrawTrack, reasonRaw?: string) {
    const p = await this.owned();
    if (!p) throw new Forbidden('NOT_OWNER', '파트너 대표 계정만 해지할 수 있습니다.');
    const reason = `본인 탈퇴${String(reasonRaw ?? '').trim() ? ` — ${String(reasonRaw).trim().slice(0, 200)}` : ''}`;
    return this.db.transaction(async () => {
      if (track === 'MAL') {
        if (!['APPLIED', 'ACTIVE', 'SUSPENDED'].includes(p.status)) throw new StateConflict('BAD_STATE', '해지할 안심소개 자격이 없습니다.');
        const why = await this.malBlockers(p.id);
        if (why.length) throw new StateConflict('PARTNER_OPEN_MONEY', `해지 전에 끝낼 일이 있습니다 — ${why.join(' · ')}.`);
        await this.db.query(
          `UPDATE partners SET status = 'WITHDRAWN', suspended_reason = $2 WHERE id = $1 AND status IN ('APPLIED','ACTIVE','SUSPENDED')`, [p.id, reason]);
        await this.db.query(`UPDATE lead_cash_wallets SET auto_on = false WHERE partner_id = $1 AND auto_on`, [p.id]);
        const ax = await this.db.query(
          `UPDATE mal_partner_axes ax SET state = 'REVOKED', reason = $2, decided_at = now(), decided_by = $3
             FROM partners p WHERE p.id = $1 AND ax.business_id = p.business_id AND ax.state IN ('PENDING','APPROVED')
           RETURNING ax.id`, [p.id, reason, this.me]);
        return { ok: true, track, status: 'WITHDRAWN', axesRevoked: ax.length,
          note: '안심소개 파트너에서 탈퇴했습니다. 리드가 더 이상 오지 않습니다. 다시 하려면 입점 신청부터 다시 하시면 됩니다.' };
      }
      if (!['APPLIED', 'ACTIVE', 'SUSPENDED'].includes(p.affStatus ?? '')) throw new StateConflict('BAD_STATE', '해지할 제휴 자격이 없습니다.');
      const why = await this.affBlockers(p.id);
      if (why.length) throw new StateConflict('PARTNER_OPEN_MONEY', `해지 전에 끝낼 일이 있습니다 — ${why.join(' · ')}.`);
      await this.db.query(
        `UPDATE partners SET aff_status = 'WITHDRAWN', aff_reason = $2 WHERE id = $1 AND aff_status IN ('APPLIED','ACTIVE','SUSPENDED')`, [p.id, reason]);
      const links = await this.db.query(`UPDATE partner_links SET is_active = false WHERE partner_id = $1 AND is_active RETURNING id`, [p.id]);
      return { ok: true, track, status: 'WITHDRAWN', linksOff: links.length,
        note: '제휴 파트너에서 탈퇴했습니다. 발급한 링크를 모두 껐습니다. 다시 하려면 제휴 신청부터 다시 하시면 됩니다.' };
    });
  }
}
