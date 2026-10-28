import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AgentTool } from './agent.provider';

/**
 * AI 상담 3단계 — 내 정보 조회 도구 5개 (v10.137 · D133 · docs/204 · 설계 docs/196 1절 · ai-agent #23).
 *
 *   모두 **읽기만 · 로그인한 회원 본인 것만**. 회원 번호는 서버가 넣고(RequestCtx), 도구 입력에는 회원 번호 칸이 없습니다.
 *   AI 에게는 아래 「보내는 칸」만 돌려줍니다 — 이름 · 주소 · 전화 · 계좌 · 카드 · 결제 수단 · 글 본문 · 문의 본문 · 사유 원문 · 금액은 SELECT 하지 않음.
 *   결과마다 화면 링크(link)를 붙여 자세한 것은 회원이 직접 보게 합니다.
 *   정산 · 소개비 금액 · 분쟁 · 환불 판단은 도구가 없습니다 → 지금처럼 「담당자에게 넘기기」.
 */
export const LOOKUP_TOOLS: AgentTool[] = [
  { name: 'my_orders', description: "The signed-in member's own recent Sogae Mall (health mall) orders: last 4 digits of order number, order status, latest delivery state and carrier, dates. Use for questions like 'where is my order'.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'my_returns', description: "The signed-in member's own cancel / return / exchange requests: kind, state, request date, decision date, whether refunded. No amounts.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'my_reviews', description: "Review status of the signed-in member's own listings and requests: first 20 characters of the title, status, review state, rejection reason code and label.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'my_inquiries', description: "The signed-in member's own 1:1 inquiries: category, received date, status, whether answered. Inquiry and answer texts are not included.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'my_subscription', description: "The signed-in member's own subscription: plan name, status, current period end (next billing date), referral codes left this period.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
];
export const LOOKUP_NAMES = LOOKUP_TOOLS.map((t) => t.name);

/** 도구마다 AI 에게 보내도 되는 칸(시험 · 조회 기록이 이 목록과 맞는지 봄) */
export const LOOKUP_FIELDS: Record<string, string[]> = {
  my_orders: ['orderTail', 'status', 'orderedAt', 'shippedAt', 'deliveredAt', 'shipState', 'carrier'],
  my_returns: ['kind', 'state', 'requestedAt', 'decidedAt', 'refunded', 'orderTail'],
  my_reviews: ['type', 'titleHead', 'status', 'reviewState', 'rejectCode', 'rejectLabel', 'submittedAt'],
  my_inquiries: ['category', 'status', 'answered', 'receivedAt'],
  my_subscription: ['plan', 'status', 'periodEnd', 'codesLeft', 'extraCodes'],
};
const LINKS: Record<string, string> = {
  my_orders: '/my/health/orders', my_returns: '/my/health/returns', my_reviews: '/my/listings',
  my_inquiries: '/my/inquiries', my_subscription: '/my/subscription',
};
const LIMIT = 5;

@Injectable()
export class AgentLookupService {
  constructor(private readonly db: DatabaseService) {}

  /** 도구 하나를 부름 — accountId 는 부르는 쪽(AgentChatService)이 로그인한 회원으로 넘김 · 모르는 도구는 빈 결과 */
  async run(name: string, accountId: string): Promise<{ link: string | null; items: Record<string, unknown>[] }> {
    if (!LOOKUP_NAMES.includes(name) || !/^[0-9a-f-]{36}$/i.test(accountId)) return { link: null, items: [] };
    const d = (c: string) => `to_char(${c} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;
    let items: Record<string, unknown>[] = [];
    if (name === 'my_orders') {
      items = await this.db.query(
        `SELECT right(o.order_no, 4) AS "orderTail", o.status, ${d('o.created_at')} AS "orderedAt", ${d('o.shipped_at')} AS "shippedAt", ${d('o.delivered_at')} AS "deliveredAt",
                s.state AS "shipState", s.carrier
           FROM hlt_orders o
           LEFT JOIN LATERAL (SELECT state, carrier FROM hlt_shipments WHERE order_id = o.id ORDER BY happened_at DESC LIMIT 1) s ON true
          WHERE o.account_id = $1 ORDER BY o.created_at DESC LIMIT ${LIMIT}`, [accountId]);
    } else if (name === 'my_returns') {
      items = await this.db.query(
        `SELECT r.kind, r.state, ${d('r.created_at')} AS "requestedAt", ${d('r.decided_at')} AS "decidedAt", (r.refunded_at IS NOT NULL) AS refunded, right(o.order_no, 4) AS "orderTail"
           FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
          WHERE o.account_id = $1 ORDER BY r.created_at DESC LIMIT ${LIMIT}`, [accountId]);
    } else if (name === 'my_reviews') {
      items = await this.db.query(
        `SELECT x.type, x."titleHead", x.status, ri.status AS "reviewState", ri.reject_reason_code AS "rejectCode", rc.label AS "rejectLabel", ${d('ri.submitted_at')} AS "submittedAt"
           FROM (SELECT 'LISTING' AS type, id, left(title, 20) AS "titleHead", status, created_at FROM listings WHERE owner_account_id = $1
                 UNION ALL
                 SELECT 'REQUEST', id, left(title, 20), status, created_at FROM requests WHERE owner_account_id = $1) x
           LEFT JOIN LATERAL (SELECT status, reject_reason_code, submitted_at FROM review_items
                               WHERE target_type = x.type AND target_id = x.id ORDER BY submitted_at DESC LIMIT 1) ri ON true
           LEFT JOIN review_reason_codes rc ON rc.code = ri.reject_reason_code
          ORDER BY x.created_at DESC LIMIT ${LIMIT}`, [accountId]);
    } else if (name === 'my_inquiries') {
      items = await this.db.query(
        `SELECT category, status, (answered_at IS NOT NULL) AS answered, ${d('created_at')} AS "receivedAt"
           FROM inquiries WHERE account_id = $1 ORDER BY created_at DESC LIMIT ${LIMIT}`, [accountId]);
    } else if (name === 'my_subscription') {
      items = await this.db.query(
        `SELECT p.name AS plan, s.status, ${d('s.current_period_end')} AS "periodEnd",
                GREATEST(p.included_codes - s.codes_used_this_period, 0) AS "codesLeft",
                (SELECT count(*)::int FROM referral_codes c WHERE c.subscription_id = s.id AND c.is_extra AND c.revoked_at IS NULL
                    AND (c.expires_at IS NULL OR c.expires_at > now())) AS "extraCodes"
           FROM subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
          WHERE s.account_id = $1 ORDER BY (s.status = 'ACTIVE') DESC, s.current_period_end DESC LIMIT 1`, [accountId]);
    }
    // 보내는 칸만 남김(SELECT 를 고쳐 칸이 늘어도 AI 로 가지 않게 한 번 더)
    const allow = LOOKUP_FIELDS[name];
    items = items.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => allow.includes(k))));
    return { link: LINKS[name], items };
  }
}
