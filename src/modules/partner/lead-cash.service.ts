import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from './partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { resolvePaymentProvider } from '../billing/payment.provider';

/**
 * 리드 이용료 — **선불 충전 잔액** (D070 · 10/10 시안 기준 SB-PTC-CTR-400)
 *
 * ── 범위 ──────────────────────────────────────────────────────────────
 * 충전금은 소개뱅크 자사 서비스(리드 열람 확인비용)의 **이용료 선납**으로만 씁니다.
 * 다른 가맹점 · 다른 회원에게 쓰거나 보낼 수 없고, 현금으로 바꾸어 주지 않습니다 —
 * 돌려드리는 것은 유상 잔액의 결제 취소(원래 결제 수단)뿐입니다. 소개비는 여기를 지나지 않습니다(INV-9 · INV-11).
 *
 * ── 돈의 움직임은 DB 가 합니다 ─────────────────────────────────────────
 *   충전 확정  fn_lead_cash_charge_done      (CHARGE + 등급 할인 BONUS)
 *   차감      lead_fees INSERT 트리거        (보너스 먼저 · 모자라면 막음)
 *   환급      lead_fees → VOIDED 트리거       (반려 인정 · 위험감지 무효)
 *   환불      fn_lead_cash_refund_hold → 결제 취소 → fn_lead_cash_refund_close
 * 이 서비스는 결제사와 이야기하고 결과를 그 함수들에 넘길 뿐입니다 — 규칙이 두 곳에 있으면 한쪽이 뒤처집니다.
 */
const KIND_KO: Record<string, string> = {
  CHARGE: '이용료 충전', BONUS: '등급 할인', USE: '리드 확인', RESTORE: '확인비용 환급',
  REFUND_HOLD: '환불 접수', REFUND_PAID: '환불 완료', REFUND_RETURN: '환불 안 된 금액 되돌림',
  BONUS_CLAWBACK: '등급 할인 회수', ADJUST: '운영 조정',
};

@Injectable()
export class LeadCashService {
  private readonly log = new Logger(LeadCashService.name);
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId(); }

  /** 내 파트너. 대표 계정 또는 합류한 직원 계정. money=true 면 돈을 움직일 권한(대표 · 정산 권한 직원)까지 봅니다. */
  async minePartner(money = false) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const p = await this.actors.forMember(this.me);   // v10.39 — 조회는 PartnerActorService 한 곳
    if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
    if (money && !p.canMoney) {
      throw new PolicyViolation('NO_MONEY_ROLE', '충전 · 환불은 대표 계정이나 정산 권한이 있는 직원만 할 수 있습니다.');
    }
    const { id, grade, status, ownerId, company, canMoney } = p;   // 이 자리가 쓰던 칸 그대로
    return { id, grade, status, ownerId, company, canMoney };
  }

  private async settings() {
    const rows = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'lead.cash.%'`);
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      mode: m['lead.cash.mode'] ?? 'PREPAID',
      min: Number(m['lead.cash.min_charge'] ?? 10000),
      max: Number(m['lead.cash.max_charge'] ?? 2000000),
      maxBalance: Number(m['lead.cash.max_balance'] ?? 2000000),
    };
  }

  private async wallet(partnerId: string) {
    const [w] = await this.db.query<any>(
      `SELECT paid_balance AS paid, bonus_balance AS bonus, auto_on AS "autoOn", auto_below AS "autoBelow",
              auto_amount AS "autoAmount", auto_failed_at AS "autoFailedAt", auto_fail_reason AS "autoFailReason"
         FROM lead_cash_wallets WHERE partner_id = $1`, [partnerId]);
    return {
      paid: Number(w?.paid ?? 0), bonus: Number(w?.bonus ?? 0),
      autoOn: !!w?.autoOn, autoBelow: w?.autoBelow != null ? Number(w.autoBelow) : null,
      autoAmount: w?.autoAmount != null ? Number(w.autoAmount) : null,
      autoFailedAt: w?.autoFailedAt ?? null, autoFailReason: w?.autoFailReason ?? null,
    };
  }

  private async bonusRate(grade: string): Promise<number> {
    const [r] = await this.db.query<{ rate: string }>('SELECT rate FROM lead_cash_bonus_rates WHERE grade = $1', [grade]);
    return Number(r?.rate ?? 0);
  }

  /** 내 카드(빌링키) — 대표 계정의 것. 자동 충전에 씁니다(구독 결제와 같은 카드). */
  private async card(ownerId: string) {
    const [k] = await this.db.query<any>(
      `SELECT id, billing_key AS "billingKey", card_company AS "cardCompany", card_last4 AS "cardLast4"
         FROM billing_keys WHERE account_id = $1 AND status = 'ACTIVE'`, [ownerId]);
    return k ?? null;
  }

  /* ── 화면 ─────────────────────────────────────────────────────── */

  /** GET /partner/cash — 시안 「총 잔액 · 유상 잔액 · 등급 할인」 · 자동 청구 · 사용 내역 */
  async summary() {
    const p = await this.minePartner();
    const [w, s, rate, card] = await Promise.all([
      this.wallet(p.id), this.settings(), this.bonusRate(p.grade), this.card(p.ownerId),
    ]);
    const log = await this.db.query<any>(
      `SELECT e.id, e.kind, e.memo, e.ref_type AS "refType", e.ref_id AS "refId", e.created_at AS "at",
              -coalesce(sum(l.amount) FILTER (WHERE l.account = 'PARTNER_PAID'), 0)  AS paid,
              -coalesce(sum(l.amount) FILTER (WHERE l.account = 'PARTNER_BONUS'), 0) AS bonus,
              CASE WHEN e.ref_type = 'LEAD_FEE' THEN (
                SELECT ld.summary FROM lead_fees f JOIN lead_deliveries d ON d.id = f.delivery_id
                  JOIN leads ld ON ld.id = d.lead_id WHERE f.id::text = e.ref_id) END AS "leadSummary"
         FROM lead_cash_entries e JOIN lead_cash_lines l ON l.entry_id = e.id
        WHERE e.partner_id = $1
        GROUP BY e.id ORDER BY e.created_at DESC, e.id DESC LIMIT 100`, [p.id]);
    const charges = await this.db.query<any>(
      `SELECT id, order_id AS "orderId", amount, bonus_amount AS bonus, source, state, stub, method,
              approved_at AS "approvedAt", refunded, fail_reason AS "failReason", created_at AS "createdAt"
         FROM lead_cash_charges WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 30`, [p.id]);
    const refunds = await this.db.query<any>(
      `SELECT id, amount, refunded, clawback, state, reason, detail, created_at AS "createdAt", done_at AS "doneAt"
         FROM lead_cash_refunds WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 20`, [p.id]);
    const [legacy] = await this.db.query<any>(
      `SELECT coalesce(sum(amount) FILTER (WHERE state='PENDING' AND settle_mode='POSTPAID'),0)::bigint AS pending,
              count(*) FILTER (WHERE state='PENDING' AND settle_mode='POSTPAID')::int AS n
         FROM lead_fees WHERE partner_id = $1`, [p.id]);
    const [month] = await this.db.query<any>(
      /* 차감(USE)은 파트너 계정 차변(+) · 환급(RESTORE)은 대변(−) — 더하면 이번 달 순 사용액 */
      `SELECT coalesce(sum(l.amount) FILTER (WHERE e.kind IN ('USE','RESTORE') AND l.account IN ('PARTNER_PAID','PARTNER_BONUS')),0) AS used,
              coalesce(sum(l.amount) FILTER (WHERE e.kind IN ('USE','RESTORE') AND l.account = 'PARTNER_BONUS'),0) AS "usedBonus"
         FROM lead_cash_entries e JOIN lead_cash_lines l ON l.entry_id = e.id
        WHERE e.partner_id = $1
          AND e.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`, [p.id]);
    const [refundable] = await this.db.query<any>(
      `SELECT coalesce(sum(amount - refunded),0)::bigint AS v FROM lead_cash_charges WHERE partner_id = $1 AND state = 'DONE'`, [p.id]);

    return {
      mode: s.mode,
      total: w.paid + w.bonus, paid: w.paid, bonus: w.bonus,
      bonusRate: rate, grade: p.grade,
      canMoney: p.canMoney,
      auto: {
        on: w.autoOn, below: w.autoBelow, amount: w.autoAmount,
        engine: !!card,     // 등록된 카드(빌링키)가 있어야 자동 충전이 실제로 돕니다
        card: card ? { company: card.cardCompany, last4: card.cardLast4 } : null,
        failedAt: w.autoFailedAt, failReason: w.autoFailReason,
      },
      month: { used: Number(month?.used ?? 0), usedBonus: Number(month?.usedBonus ?? 0) },
      refundable: Math.min(w.paid, Number(refundable?.v ?? 0)),
      limits: { min: s.min, max: s.max, maxBalance: s.maxBalance },
      legacy: { pending: Number(legacy?.pending ?? 0), count: legacy?.n ?? 0 },
      log: log.map((r) => ({
        id: Number(r.id), kind: r.kind, kindKo: KIND_KO[r.kind] ?? r.kind, at: r.at,
        memo: r.memo, refType: r.refType, refId: r.refId, leadSummary: r.leadSummary ?? null,
        paid: Number(r.paid), bonus: Number(r.bonus), total: Number(r.paid) + Number(r.bonus),
      })),
      charges: charges.map((c) => ({ ...c, amount: Number(c.amount), bonus: Number(c.bonus), refunded: Number(c.refunded) })),
      refunds: refunds.map((r) => ({ ...r, amount: Number(r.amount), refunded: Number(r.refunded), clawback: Number(r.clawback) })),
      note: '리드를 열 때 확인비용이 잔액에서 빠집니다 — 등급 할인(보너스) 잔액부터 차감합니다. 잔액이 0이면 상담을 받지 못합니다.',
      scope: '충전금은 소개뱅크 리드 확인비용 선납으로만 씁니다. 다른 곳에 쓰거나 남에게 보낼 수 없고, 유상 잔액은 결제 취소로 환불합니다(등급 할인분은 환불 대상이 아닙니다).',
    };
  }

  /* ── 충전 ─────────────────────────────────────────────────────── */

  /** POST /partner/cash/charges — 결제창에 넘길 주문을 만듭니다(금액 · 보너스는 서버가 정함) */
  async createCharge(amount: number, source: 'MANUAL' | 'AUTO' = 'MANUAL', partnerOverride?: { id: string; grade: string }) {
    const p = partnerOverride ?? await this.minePartner(true);
    if (!Number.isInteger(amount) || amount <= 0) throw new PolicyViolation('BAD_AMOUNT', '충전 금액은 원 단위 정수입니다.');
    const s = await this.settings();
    if (amount < s.min) throw new PolicyViolation('CHARGE_TOO_SMALL', `한 번에 ${s.min.toLocaleString('ko-KR')}원 이상 충전합니다.`);
    if (amount > s.max) throw new PolicyViolation('CHARGE_TOO_LARGE', `한 번에 ${s.max.toLocaleString('ko-KR')}원까지 충전합니다.`);
    const w = await this.wallet(p.id);
    if (w.paid + amount > s.maxBalance) {
      throw new PolicyViolation('BALANCE_CAP',
        `유상 잔액은 ${s.maxBalance.toLocaleString('ko-KR')}원까지 둘 수 있습니다 — 지금 ${w.paid.toLocaleString('ko-KR')}원이라 ${Math.max(0, s.maxBalance - w.paid).toLocaleString('ko-KR')}원까지 충전할 수 있습니다.`);
    }
    const rate = await this.bonusRate(p.grade);
    const bonus = Math.floor(amount * rate);
    const orderId = `lc-${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
    const [c] = await this.db.query<any>(
      `INSERT INTO lead_cash_charges(partner_id, order_id, amount, bonus_rate, bonus_amount, source, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, order_id AS "orderId", amount, bonus_amount AS bonus, state`,
      [p.id, orderId, amount, rate, bonus, source, this.me ?? null]);
    return { ...c, amount: Number(c.amount), bonus: Number(c.bonus), bonusRate: rate,
      orderName: '소개뱅크 리드 이용료 충전',
      note: `결제가 승인되면 유상 잔액 ${amount.toLocaleString('ko-KR')}원${bonus ? ` · 등급 할인 ${bonus.toLocaleString('ko-KR')}원` : ''}이 들어옵니다.` };
  }

  /** POST /partner/cash/charges/confirm — 결제사 승인 확인 뒤 원장에 올립니다(같은 주문 두 번 → 한 번만) */
  async confirmCharge(orderId: string, paymentKey: string, amount: number) {
    const p = await this.minePartner(true);
    const [c] = await this.db.query<any>(
      `SELECT id, amount, state, payment_key FROM lead_cash_charges WHERE order_id = $1 AND partner_id = $2`, [orderId, p.id]);
    if (!c) throw new NotFound('충전 주문이 없습니다.');
    if (c.state === 'DONE') return { ok: true, already: true, state: 'DONE', note: '이미 충전되었습니다.' };
    if (c.state === 'FAILED') throw new StateConflict('CHARGE_FAILED', '실패로 끝난 충전입니다 — 새로 충전해 주십시오.');
    if (Number(c.amount) !== Number(amount)) {
      throw new PolicyViolation('AMOUNT_MISMATCH', '결제 금액이 주문 금액과 다릅니다.');
    }
    if (!paymentKey || paymentKey.length > 200) throw new PolicyViolation('BAD_PAYMENT_KEY', '결제 키가 올바르지 않습니다.');

    const provider = resolvePaymentProvider();
    const r = await provider.confirm({ paymentKey, orderId, amount: Number(c.amount), orderName: '소개뱅크 리드 이용료 충전' });
    if (!r.approved) {
      if (r.uncertain) {
        await this.db.query(`UPDATE lead_cash_charges SET state='UNKNOWN', payment_key=$2, fail_reason=$3 WHERE id=$1 AND state='READY'`,
          [c.id, paymentKey, r.detail ?? '결과 확인 중']);
        throw new StateConflict('CHARGE_UNKNOWN', '결제 결과를 아직 확인하지 못했습니다 — 잠시 뒤 다시 확인합니다. 두 번 결제되지 않습니다.');
      }
      await this.db.query(`UPDATE lead_cash_charges SET state='FAILED', fail_reason=$2 WHERE id=$1 AND state IN ('READY','UNKNOWN')`,
        [c.id, r.detail ?? '결제 승인 실패']);
      throw new PolicyViolation('CHARGE_DECLINED', r.detail ?? '결제가 승인되지 않았습니다.');
    }
    const [done] = await this.db.query<{ v: string }>(
      `SELECT fn_lead_cash_charge_done($1, $2, $3, $4, $5) AS v`, [c.id, r.paymentKey ?? paymentKey, r.method ?? null, r.stub, this.me ?? null]);
    const w = await this.wallet(p.id);
    return { ok: true, state: 'DONE', already: done?.v === 'ALREADY', stub: r.stub, total: w.paid + w.bonus, paid: w.paid, bonus: w.bonus,
      note: r.stub ? '충전되었습니다(시험 결제 — 실제 돈은 오가지 않았습니다).' : '충전되었습니다.' };
  }

  /* ── 자동 청구 ────────────────────────────────────────────────── */

  /** PUT /partner/cash/auto — 시안 「○원 미만이면 ○원 청구」 */
  async setAuto(dto: { on: boolean; below?: number | null; amount?: number | null }) {
    const p = await this.minePartner(true);
    const s = await this.settings();
    if (dto.on) {
      const below = Number(dto.below), amount = Number(dto.amount);
      if (!Number.isInteger(below) || below <= 0) throw new PolicyViolation('BAD_AUTO', '기준 금액(○원 미만)을 넣어 주십시오.');
      if (!Number.isInteger(amount) || amount < s.min || amount > s.max) {
        throw new PolicyViolation('BAD_AUTO', `충전 금액은 ${s.min.toLocaleString('ko-KR')}원 ~ ${s.max.toLocaleString('ko-KR')}원입니다.`);
      }
      if (below + amount > s.maxBalance) {
        throw new PolicyViolation('BAD_AUTO', `기준 금액 + 충전 금액이 유상 잔액 상한(${s.maxBalance.toLocaleString('ko-KR')}원)을 넘지 않게 정해 주십시오.`);
      }
    }
    await this.db.query(
      `INSERT INTO lead_cash_wallets(partner_id, auto_on, auto_below, auto_amount)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (partner_id) DO UPDATE SET auto_on = $2,
              auto_below = coalesce($3, lead_cash_wallets.auto_below), auto_amount = coalesce($4, lead_cash_wallets.auto_amount),
              auto_failed_at = NULL, auto_fail_reason = NULL, updated_at = now()`,
      [p.id, !!dto.on, dto.on ? Number(dto.below) : (dto.below ?? null), dto.on ? Number(dto.amount) : (dto.amount ?? null)]);
    const card = await this.card(p.ownerId);
    return { ok: true, on: !!dto.on, engine: !!card,
      note: !dto.on ? '자동 청구를 껐습니다.'
        : card ? `잔액이 ${Number(dto.below).toLocaleString('ko-KR')}원 미만이 되면 등록된 카드로 ${Number(dto.amount).toLocaleString('ko-KR')}원을 충전합니다.`
        : '설정은 저장했지만 등록된 카드가 없어 자동 충전이 돌지 않습니다 — 구독 결제에서 카드를 등록하십시오.' };
  }

  /**
   * 자동 충전 한 번. 잔액이 기준 아래이고, 등록 카드가 있고, 최근 실패(1시간)가 없고, 진행 중인 자동 충전이 없을 때만.
   * 리드를 연 뒤(뒤에서) · 운영 「자동 충전 돌리기」 · 정기 작업 lead_cash_auto(30분마다 · D090)가 부릅니다. 실패는 지갑에 남기고 던지지 않습니다.
   */
  async runAuto(partnerId: string): Promise<{ partnerId: string; result: string; detail?: string }> {
    const [x] = await this.db.query<any>(
      `SELECT w.paid_balance + w.bonus_balance AS total, w.paid_balance AS paid, w.auto_below, w.auto_amount,
              p.grade, b.account_id AS owner
         FROM lead_cash_wallets w JOIN partners p ON p.id = w.partner_id JOIN businesses b ON b.id = p.business_id
        WHERE w.partner_id = $1 AND w.auto_on AND p.status = 'ACTIVE'
          AND w.paid_balance + w.bonus_balance < w.auto_below
          AND (w.auto_failed_at IS NULL OR w.auto_failed_at < now() - interval '1 hour')
          AND NOT EXISTS (SELECT 1 FROM lead_cash_charges c WHERE c.partner_id = w.partner_id AND c.source = 'AUTO'
                           AND c.state IN ('READY','UNKNOWN') AND c.created_at > now() - interval '10 minutes')`, [partnerId]);
    if (!x) return { partnerId, result: 'SKIP' };
    const fail = async (why: string) => {
      await this.db.query(`UPDATE lead_cash_wallets SET auto_failed_at = now(), auto_fail_reason = $2 WHERE partner_id = $1`, [partnerId, why]);
      return { partnerId, result: 'FAILED', detail: why };
    };
    const card = await this.card(x.owner);
    if (!card) return fail('등록된 카드(빌링키)가 없습니다 — 구독 결제에서 카드를 등록하십시오.');
    let c: any;
    try { c = await this.createCharge(Number(x.auto_amount), 'AUTO', { id: partnerId, grade: x.grade }); }
    catch (e: any) { return fail(e?.response?.message ?? e?.message ?? '충전 주문을 만들지 못했습니다.'); }
    const r = await resolvePaymentProvider().chargeWithBillingKey({
      billingKey: card.billingKey, customerKey: x.owner, orderId: c.orderId, amount: c.amount,
      orderName: '소개뱅크 리드 이용료 자동 충전', idempotencyKey: c.orderId,
    });
    if (r.approved) {
      await this.db.query(`SELECT fn_lead_cash_charge_done($1,$2,$3,$4,NULL)`, [c.id, r.paymentKey ?? `bill_${c.orderId}`, r.method ?? 'BILLING', r.stub]);
      await this.db.query(`UPDATE billing_keys SET last_used_at = now() WHERE id = $1`, [card.id]);
      await this.db.query(`UPDATE lead_cash_wallets SET auto_failed_at = NULL, auto_fail_reason = NULL WHERE partner_id = $1`, [partnerId]);
      return { partnerId, result: 'DONE', detail: `${c.amount}원${r.stub ? ' (시험 결제)' : ''}` };
    }
    if (r.uncertain) {
      await this.db.query(`UPDATE lead_cash_charges SET state='UNKNOWN', fail_reason=$2 WHERE id=$1`, [c.id, r.detail ?? '결과 확인 중']);
      return { partnerId, result: 'UNKNOWN', detail: r.detail };
    }
    await this.db.query(`UPDATE lead_cash_charges SET state='FAILED', fail_reason=$2 WHERE id=$1`, [c.id, r.detail ?? '카드 결제 실패']);
    return fail(r.detail ?? '카드 결제가 승인되지 않았습니다.');
  }

  /** 운영 — 자동 청구가 켜진 파트너 전부 한 번씩 */
  async runAutoAll() {
    const rows = await this.db.query<{ partner_id: string }>(
      `SELECT partner_id FROM lead_cash_wallets WHERE auto_on AND paid_balance + bonus_balance < auto_below`);
    const out = [];
    for (const r of rows) out.push(await this.runAuto(r.partner_id));
    return { ran: out.length, items: out };
  }

  /* ── 환불 ─────────────────────────────────────────────────────── */

  /** POST /partner/cash/refunds — 유상 잔액만. 묶고 → 최근 충전부터 결제 취소 → 마감 */
  async refund(amount: number, reason: string) {
    const p = await this.minePartner(true);
    if (!Number.isInteger(amount) || amount <= 0) throw new PolicyViolation('BAD_AMOUNT', '환불 금액은 원 단위 정수입니다.');
    if (!reason?.trim()) throw new PolicyViolation('REASON_REQUIRED', '환불 사유를 적어 주십시오.');
    const [h] = await this.db.query<{ id: string }>(
      `SELECT fn_lead_cash_refund_hold($1, $2, $3, $4) AS id`, [p.id, amount, reason.trim().slice(0, 500), this.me ?? null]);
    const refundId = h.id;

    const charges = await this.db.query<any>(
      `SELECT id, amount, refunded, payment_key AS "paymentKey" FROM lead_cash_charges
        WHERE partner_id = $1 AND state = 'DONE' AND amount > refunded
        ORDER BY approved_at DESC`, [p.id]);
    const provider = resolvePaymentProvider();
    let left = amount;
    for (const c of charges) {
      if (left <= 0) break;
      const part = Math.min(left, Number(c.amount) - Number(c.refunded));
      const r = await provider.cancel({ paymentKey: c.paymentKey, cancelReason: `리드 이용료 잔액 환불 — ${reason.trim().slice(0, 100)}`,
        cancelAmount: part, idempotencyKey: `lcr-${refundId}-${c.id}` });
      const ok = !!r.ok;
      await this.db.query(
        `INSERT INTO lead_cash_refund_parts(refund_id, charge_id, amount, ok, detail, transaction_key) VALUES ($1,$2,$3,$4,$5,$6)`,
        [refundId, c.id, part, ok, r.detail ?? (r.uncertain ? '결과 확인 필요' : null), r.transactionKey ?? null]);
      if (ok) {
        await this.db.query(`UPDATE lead_cash_charges SET refunded = refunded + $2 WHERE id = $1`, [c.id, part]);
        left -= part;
      } else {
        this.log.warn(`lead cash refund ${refundId} charge ${c.id} cancel failed: ${r.detail}`);
        break;   // 결제사 오류면 멈추고 남은 금액은 잔액으로 되돌립니다
      }
    }
    const [closed] = await this.db.query<{ v: string }>(`SELECT fn_lead_cash_refund_close($1, $2) AS v`, [refundId, this.me ?? null]);
    const [r] = await this.db.query<any>(`SELECT refunded, clawback, state FROM lead_cash_refunds WHERE id = $1`, [refundId]);
    const w = await this.wallet(p.id);
    return { ok: closed.v !== 'FAILED', id: refundId, state: r.state, refunded: Number(r.refunded), clawback: Number(r.clawback),
      paid: w.paid, bonus: w.bonus,
      note: r.state === 'DONE'
        ? `${Number(r.refunded).toLocaleString('ko-KR')}원을 결제 수단으로 돌려드렸습니다${Number(r.clawback) ? ` — 그 충전의 등급 할인 ${Number(r.clawback).toLocaleString('ko-KR')}원은 회수했습니다` : ''}.`
        : r.state === 'PARTIAL' ? `${Number(r.refunded).toLocaleString('ko-KR')}원만 환불되었습니다. 나머지는 잔액으로 되돌렸습니다 — 고객센터로 알려 주십시오.`
        : '결제 취소가 되지 않아 잔액으로 되돌렸습니다. 고객센터로 알려 주십시오.' };
  }

  /* ── 운영(w6 BO 와 이름을 맞춤 — SHARED_NOTES) ───────────────────── */

  async admWallets() {
    const items = await this.db.query<any>(
      `SELECT p.id AS "partnerId", b.company_name AS company, p.grade, p.status,
              coalesce(w.paid_balance,0)::bigint AS paid, coalesce(w.bonus_balance,0)::bigint AS bonus,
              coalesce(w.auto_on,false) AS "autoOn", w.auto_below AS "autoBelow", w.auto_amount AS "autoAmount",
              w.auto_fail_reason AS "autoFailReason",
              (SELECT coalesce(sum(amount),0) FROM lead_cash_charges c WHERE c.partner_id = p.id AND c.state='DONE')::bigint AS charged,
              (SELECT coalesce(sum(refunded),0) FROM lead_cash_charges c WHERE c.partner_id = p.id)::bigint AS refunded,
              (SELECT count(*) FROM lead_cash_charges c WHERE c.partner_id = p.id AND c.state='UNKNOWN')::int AS "unknownCharges"
         FROM partners p JOIN businesses b ON b.id = p.business_id
         LEFT JOIN lead_cash_wallets w ON w.partner_id = p.id
        ORDER BY coalesce(w.paid_balance,0) + coalesce(w.bonus_balance,0) DESC, b.company_name`);
    const inv = await this.db.query<any>(`SELECT code, partner_id AS "partnerId", ref, detail FROM v_lead_cash_invariants LIMIT 200`);
    const [tot] = await this.db.query<any>(
      `SELECT coalesce(sum(paid_balance),0)::bigint AS paid, coalesce(sum(bonus_balance),0)::bigint AS bonus FROM lead_cash_wallets`);
    return { items: items.map((i) => ({ ...i, paid: Number(i.paid), bonus: Number(i.bonus), charged: Number(i.charged), refunded: Number(i.refunded) })),
      totals: { paid: Number(tot.paid), bonus: Number(tot.bonus) },
      invariants: { ok: inv.length === 0, items: inv },
      note: '유상 잔액 합계가 선불로 보관 중인 금액입니다(자사 이용료 선납 한정). 불변식이 한 줄이라도 있으면 원장 점검이 먼저입니다.' };
  }

  async admLedger(partnerId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(partnerId)) throw new NotFound('파트너가 없습니다.');
    const [p] = await this.db.query<any>(
      `SELECT p.id, b.company_name AS company, p.grade FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1`, [partnerId]);
    if (!p) throw new NotFound('파트너가 없습니다.');
    const w = await this.wallet(partnerId);
    const entries = await this.db.query<any>(
      `SELECT e.id, e.kind, e.ref_type AS "refType", e.ref_id AS "refId", e.memo, e.created_at AS "at",
              a.email AS "createdBy",
              json_agg(json_build_object('account', l.account, 'amount', l.amount) ORDER BY l.id) AS lines
         FROM lead_cash_entries e JOIN lead_cash_lines l ON l.entry_id = e.id
         LEFT JOIN accounts a ON a.id = e.created_by
        WHERE e.partner_id = $1 GROUP BY e.id, a.email ORDER BY e.id DESC LIMIT 300`, [partnerId]);
    const charges = await this.db.query<any>(
      `SELECT id, order_id AS "orderId", amount, bonus_amount AS bonus, source, state, stub, payment_key AS "paymentKey",
              approved_at AS "approvedAt", refunded, fail_reason AS "failReason", created_at AS "createdAt"
         FROM lead_cash_charges WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 100`, [partnerId]);
    const refunds = await this.db.query<any>(
      `SELECT id, amount, refunded, clawback, state, reason, detail, created_at AS "createdAt", done_at AS "doneAt"
         FROM lead_cash_refunds WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 100`, [partnerId]);
    const inv = await this.db.query<any>(`SELECT code, ref, detail FROM v_lead_cash_invariants WHERE partner_id = $1`, [partnerId]);
    return { partner: p, wallet: w, entries, charges, refunds, invariants: inv };
  }

  /** 운영 조정 — 반대 기입. 사유 필수 · 잔액이 0 아래로 내려가는 조정은 DB 가 막습니다 */
  async admAdjust(partnerId: string, dto: { account: 'PAID' | 'BONUS'; amount: number; reason: string }) {
    if (!['PAID', 'BONUS'].includes(dto.account)) throw new PolicyViolation('BAD_ACCOUNT', 'account 는 PAID · BONUS 중 하나입니다.');
    if (!Number.isInteger(dto.amount) || dto.amount === 0) throw new PolicyViolation('BAD_AMOUNT', '조정 금액(+ 늘림 · − 줄임)을 원 단위로 넣어 주십시오.');
    if (!dto.reason?.trim() || dto.reason.trim().length < 5) throw new PolicyViolation('REASON_REQUIRED', '조정 사유를 다섯 글자 이상 적어 주십시오 — 원장에 그대로 남습니다.');
    const acc = dto.account === 'PAID' ? 'PARTNER_PAID' : 'PARTNER_BONUS';
    const [w] = await this.db.query<any>(`SELECT paid_balance, bonus_balance FROM lead_cash_wallets WHERE partner_id = $1`, [partnerId]);
    const cur = Number(dto.account === 'PAID' ? w?.paid_balance ?? 0 : w?.bonus_balance ?? 0);
    if (cur + dto.amount < 0) throw new PolicyViolation('LEADCASH', `줄일 수 있는 금액은 ${cur.toLocaleString('ko-KR')}원까지입니다.`);
    const [r] = await this.db.query<{ id: string }>(
      `SELECT fn_lead_cash_post($1, 'ADJUST', $2::jsonb, 'ADJUST', NULL, $3, $4) AS id`,
      [partnerId, JSON.stringify([{ a: acc, v: -dto.amount }, { a: 'ADJUSTMENT', v: dto.amount }]), `운영 조정 — ${dto.reason.trim()}`, this.me ?? null]);
    return { ok: true, entryId: Number(r.id), wallet: await this.wallet(partnerId) };
  }
}
