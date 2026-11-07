import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * v10.207 (D184 · docs/332) — 요금제 금액 · 한도(운영 화면 › 청구 현황 SB-ADM-BIL-010 안의 한 구역)
 *
 *   대표 「운영 화면에서 바꾸게」 — 금액은 오픈 전에 대표가 정함(subscription-referral-code #13 · 미정 3).
 *   올린 금액은 새 구독부터 — 이용 중인 구독은 옛 금액이 묶임(locked_price · 갱신은 작은 값).
 *   내린 금액은 모두 다음 결제부터. 무료 ↔ 유료 전환 · 음수는 DB(fn_plan_update)가 막음.
 */
export const PLAN_FIELDS = ['monthly_price', 'included_codes', 'extra_code_price', 'proposal_limit',
  'request_views_per_month', 'listing_slots', 'priority_slot_count', 'success_fee'] as const;
type PlanField = typeof PLAN_FIELDS[number];
/** NULL(무제한)을 넣을 수 있는 칸 */
const NULLABLE: PlanField[] = ['proposal_limit', 'request_views_per_month', 'listing_slots'];

@Injectable()
export class PlanAdminService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const plans = await this.db.query<any>(
      `SELECT p.code, p.name, p.monthly_price::float8 AS "monthlyPrice", p.included_codes AS "includedCodes",
              p.extra_code_price::float8 AS "extraCodePrice", p.proposal_limit AS "proposalLimit",
              p.request_views_per_month AS "requestViews", p.listing_slots AS "listingSlots",
              p.priority_slot_count AS "prioritySlots", p.success_fee::float8 AS "successFee",
              (SELECT count(*)::int FROM subscriptions s WHERE s.plan_code = p.code AND s.status IN ('ACTIVE','PAST_DUE')) AS subscribers,
              (SELECT count(*)::int FROM subscriptions s WHERE s.plan_code = p.code AND s.status IN ('ACTIVE','PAST_DUE')
                  AND s.locked_plan_code = p.code AND s.locked_price < p.monthly_price) AS locked
         FROM subscription_plans p WHERE p.is_active ORDER BY p.monthly_price, p.code`);
    const changes = await this.db.query<any>(
      `SELECT c.id::text AS id, c.plan_code AS "planCode", to_char(c.changed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at,
              coalesce(a.email, '') AS "by", c.reason, c.locked, c.lowered,
              (SELECT string_agg(k || ' ' || coalesce(c.before->>k, '무제한') || ' → ' || coalesce(c.after->>k, '무제한'), ' · ' ORDER BY k)
                 FROM jsonb_object_keys(c.after) k
                WHERE k = ANY($1::text[]) AND (c.before->k) IS DISTINCT FROM (c.after->k)) AS diff
         FROM subscription_plan_changes c LEFT JOIN accounts a ON a.id = c.changed_by
        ORDER BY c.changed_at DESC LIMIT 20`, [PLAN_FIELDS as unknown as string[]]);
    return { plans, changes };
  }

  async save(code: string, body: Record<string, unknown>, reason: string) {
    const r = (reason ?? '').trim();
    if (r.length < 2 || r.length > 200) throw new PolicyViolation('PLAN_REASON', '바꾸는 사유를 2 ~ 200자로 적어 주십시오.');
    const vals: Record<string, number | null> = {};
    for (const f of PLAN_FIELDS) {
      if (!(f in body) || body[f] === undefined) continue;
      const v = body[f];
      if (v === null || v === '') {
        if (!NULLABLE.includes(f)) throw new PolicyViolation('PLAN_VALUE', '비울 수 없는 칸입니다 — 무제한(빈칸)은 소개 제안 · 열람 · 매물 슬롯만 됩니다.', { field: f });
        vals[f] = null; continue;
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100_000_000) throw new PolicyViolation('PLAN_VALUE', '금액 · 건수는 0 이상의 정수로 넣으십시오.', { field: f });
      vals[f] = n;
    }
    if (!Object.keys(vals).length) throw new PolicyViolation('PLAN_VALUE', '바꿀 칸이 없습니다.');
    const [ex] = await this.db.query<{ code: string }>(`SELECT code FROM subscription_plans WHERE code = $1 AND is_active`, [code]);
    if (!ex) throw new NotFound('없는 요금제입니다.');
    try {
      const [res] = await this.db.query<{ locked: number; lowered: number }>(
        `SELECT locked, lowered FROM fn_plan_update($1, $2::jsonb, $3, $4)`, [code, JSON.stringify(vals), r, RequestCtx.actorId() ?? null]);
      return { ok: true, code, locked: res.locked, lowered: res.lowered };
    } catch (e: any) {
      const m = String(e?.message ?? '');
      if (m.includes('PLAN:')) throw new PolicyViolation('PLAN_RULE', m.slice(m.indexOf('PLAN:') + 5).trim());
      throw e;
    }
  }
}
