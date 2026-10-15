import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

export interface ReconcileResult {
  ok: boolean;
  stage1: { settlementCount: number; total: number };
  stage2: { dealCount: number; total: number };
  stage3: { violations: { inv: string; count: number }[] };
  mismatches: string[];
}

/**
 * 정산 (T8).
 *
 * ── 이 서비스가 하지 않는 일 ───────────────────────────────────────
 *   · 지급 승인       플랫폼은 승인하지 않습니다
 *   · 배치 편성       플랫폼은 지급을 묶지 않습니다
 *   · 이체 실행       플랫폼은 자금을 옮기지 않습니다
 *   · 계좌 보관       플랫폼은 계좌번호를 갖지 않습니다
 *
 * 소개비는 당사자 간에 직접 지급됩니다(INV-9R · INV-11).
 * 정산 레코드는 "받았다고 당사자가 표시한 기록"이며,
 * 플랫폼이 지급 사실을 확인해 준 값이 아닙니다.
 *
 * 이전 판본에는 승인 → 배치 → 이체 흐름이 있었습니다.
 * 에스크로 폐지 결정 이후에도 남아 있던 잔재이며 320_inv_hardening 에서 제거했습니다.
 */
@Injectable()
export class SettlementService {
  private readonly log = new Logger(SettlementService.name);
  constructor(private readonly db: DatabaseService) {}

  /**
   * 원장 대조.
   *
   * 지급을 막기 위한 관문이 아니라 **운영이 이상을 발견하기 위한 조회**입니다.
   * 플랫폼이 지급하지 않으므로 여기서 막을 이체가 없습니다.
   *
   *   1단계  settlements 합계
   *   2단계  deals.agreed_fee 합계   — 두 값이 같아야 합니다(INV-9R: 공제 없음)
   *   3단계  불변식 위반 스윕         — INV-9 · INV-11 컬럼이 되살아났는지
   */
  async reconcile(): Promise<ReconcileResult> {
    const [s1] = await this.db.query<{ n: string; total: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(s.amount),0)::text AS total
         FROM settlements s
        WHERE s.status <> 'REJECTED' AND s.held_by_dispute_id IS NULL`);

    const [s2] = await this.db.query<{ n: string; total: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(d.agreed_fee),0)::text AS total
         FROM deals d
         JOIN settlements s ON s.deal_id = d.id
        WHERE s.status <> 'REJECTED' AND s.held_by_dispute_id IS NULL`);

    const inv9  = await this.db.query<{ table_name: string }>(`SELECT table_name FROM v_inv9_violations`);
    const inv11 = await this.db.query<{ table_name: string }>(`SELECT table_name FROM v_inv11_violations`);

    const mismatches: string[] = [];
    if (s1.total !== s2.total) {
      // 두 경로가 갈리면 트리거를 우회한 보정이 있었다는 뜻입니다.
      mismatches.push(`정산 합계 ${s1.total} ≠ 약정 합계 ${s2.total} (INV-9R 위반 가능)`);
    }
    if (inv9.length)  mismatches.push(`INV-9 공제 컬럼 ${inv9.length}건 발견`);
    if (inv11.length) mismatches.push(`INV-11 자금수탁 컬럼 ${inv11.length}건 발견`);

    return {
      ok: mismatches.length === 0,
      stage1: { settlementCount: Number(s1.n), total: Number(s1.total) },
      stage2: { dealCount: Number(s2.n), total: Number(s2.total) },
      stage3: { violations: [
        { inv: 'INV-9',  count: inv9.length },
        { inv: 'INV-11', count: inv11.length },
      ] },
      mismatches,
    };
  }

  /** 정산 목록 (운영 조회) */
  batches() {
    return this.db.query(
      `SELECT s.id, s.deal_id, s.payee_account_id, s.amount, s.status,
              s.paid_marked_by, s.paid_marked_at, s.held_by_dispute_id, s.requested_at
         FROM settlements s
        ORDER BY s.requested_at DESC NULLS LAST
        LIMIT 200`);
  }

  /**
   * 지급 완료 표시.
   *
   * 당사자만 찍을 수 있고, 한 번 찍히면 바뀌지 않습니다.
   * 둘 다 DB 트리거(trg_settlement_paid_actor)가 집행하며
   * 여기서는 화면에 먼저 안내하기 위한 1차 확인만 합니다.
   */
  /**
   * v10.31 (합침 · w6 정산 승인 D080) — 나의공간 「받았음 표시」. 내 정산(받는 사람 · 그 거래의 판매자)만, 운영 승인(APPROVED) 뒤에만.
   *   승인 전 표시 · 당사자 아님은 DB 트리거(STL_PAID · fn_settlement_paid_actor)가 마지막 둑 — 여기서는 화면에 먼저 알맞은 말을 냅니다.
   *   남의 정산은 있는지도 알리지 않습니다(404).
   */
  async markPaidMine(settlementId: string) {
    const actor = RequestCtx.actorId();
    if (!actor) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settlementId)) throw new NotFound('없는 정산입니다.');
    const [s] = await this.db.query<{ status: string; payee: string; seller: string | null }>(
      `SELECT s.status, s.payee_account_id AS payee, d.seller_account_id AS seller
         FROM settlements s JOIN deals d ON d.id = s.deal_id WHERE s.id = $1`, [settlementId]);
    if (!s || (s.payee !== actor && s.seller !== actor)) throw new NotFound('없는 정산입니다.');
    if (s.status === 'PAID') throw new PolicyViolation('STL_PAID', '이미 받았음으로 표시된 정산입니다.');
    if (s.status !== 'APPROVED') {
      throw new PolicyViolation('STL_PAID', '운영이 정산서를 확인한 뒤(승인됨 · 지급 대기)에만 받았음 표시를 할 수 있습니다.');
    }
    return this.markPaid(settlementId);
  }

  async markPaid(settlementId: string) {
    const actor = RequestCtx.actorId();
    if (!actor) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');

    const [row] = await this.db.query<{ id: string; status: string }>(
      `UPDATE settlements
          SET status = 'PAID', paid_marked_by = $2
        WHERE id = $1 AND status <> 'PAID'
      RETURNING id, status, paid_marked_by, paid_marked_at`,
      [settlementId, actor]);

    if (!row) throw new PolicyViolation('NOT_FOUND', '없거나 이미 표시된 정산입니다.');

    this.log.log(`정산 ${settlementId} 지급 표시 — 당사자 기록이며 플랫폼 확인이 아닙니다`);
    return { ...row, note: '당사자 표시 기록입니다. 플랫폼이 지급을 확인한 것이 아닙니다(INV-11).' };
  }
}
