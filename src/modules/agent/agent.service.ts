import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

export type AgentChannel = 'SITE_CHAT' | 'REVIEW_SHADOW' | 'AUDIT' | 'SETTLE';

/**
 * AI 에이전트 0단계 틀 (v10.94 · D116 · docs/149 · docs/151).
 *
 * 부르기 전 · 뒤에 지킬 것을 한 곳에 둡니다 — 판단은 DB 함수가 합니다.
 *   allowed(통로)      fn_agent_allowed — 스위치 · 월 상한(0 이면 CAP_ZERO)
 *   record(…)          fn_agent_record_usage — 비용을 쌓고, 상한에 닿으면 agent.enabled 를 끄고 운영 경보
 * AI 는 승인 · 반려 · 확정 · 지급을 하지 않습니다(ai-agent #7) — 이 서비스에는 그런 기능이 없습니다.
 */
@Injectable()
export class AgentService {
  constructor(private readonly db: DatabaseService) {}

  async allowed(channel: AgentChannel): Promise<{ ok: boolean; reason: string | null }> {
    const [r] = await this.db.query<{ ok: boolean; reason: string | null }>(`SELECT ok, reason FROM fn_agent_allowed($1)`, [channel]);
    return { ok: !!r?.ok, reason: r?.reason ?? 'AGENT_OFF' };
  }

  async record(channel: AgentChannel, model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0): Promise<number> {
    const [r] = await this.db.query<{ cost: string }>(
      `SELECT fn_agent_record_usage($1, $2, $3, $4, $5)::text AS cost`, [channel, model, inputTokens, outputTokens, cacheReadTokens]);
    return Number(r?.cost ?? 0);
  }

  /** 운영 화면 — 스위치 · 상한 · 이번 달 비용 · 통로별 사용량 · 요금표 · AI 검수 일치율 */
  async status() {
    const settings = await this.db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'agent.%' ORDER BY key`);
    const s = Object.fromEntries(settings.map((x) => [x.key, x.value]));
    const [m] = await this.db.query<{ cost: string }>(`SELECT round(fn_agent_month_cost(), 4)::text AS cost`);
    const usage = await this.db.query(
      `SELECT channel, model, sum(requests)::int AS requests, sum(input_tokens)::bigint::text AS "inputTokens",
              sum(output_tokens)::bigint::text AS "outputTokens", round(sum(cost_usd), 4)::text AS "costUsd"
         FROM agent_usage_daily WHERE day >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date
        GROUP BY channel, model ORDER BY channel, model`);
    const prices = await this.db.query(
      `SELECT model, input_per_m::text AS "inputPerM", output_per_m::text AS "outputPerM", cache_read_per_m::text AS "cacheReadPerM",
              as_of::text AS "asOf", note FROM agent_model_prices ORDER BY input_per_m`);
    const agreement = await this.db.query(
      `SELECT model, decided::int, agreed::int, unsure::int, agree_pct::text AS "agreePct" FROM v_ai_review_agreement ORDER BY model`);
    const channels = await Promise.all((['REVIEW_SHADOW', 'SITE_CHAT'] as AgentChannel[]).map(async (c) => ({ channel: c, ...(await this.allowed(c)) })));
    return {
      enabled: s['agent.enabled'] === 'on',
      switches: {
        reviewShadow: s['agent.review_shadow.enabled'] === 'on', chat: s['agent.chat.enabled'] === 'on',
        memberLookup: s['agent.chat.member_lookup.enabled'] === 'on',
      },
      capUsd: s['agent.monthly_cap_usd'] ?? '0', monthCostUsd: m?.cost ?? '0',
      reviewModel: s['agent.review_model'] ?? null, chatModel: s['agent.chat_model'] ?? null,
      limits: { guestDaily: Number(s['agent.guest_daily_limit'] ?? 0), memberDaily: Number(s['agent.member_daily_limit'] ?? 0) },
      channels, usage, prices, agreement,
      note: '0단계(틀) — 모델 연결은 1단계(API 키 · 월 상한 · 법무 검토 뒤). 상한이 0 이면 아무것도 부르지 않습니다.',
    };
  }
}
