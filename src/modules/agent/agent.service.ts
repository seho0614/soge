import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation } from '../../core/errors';
import { AgentProvider, ClaudeAgentProvider, MockAgentProvider, resolveAgentProvider } from './agent.provider';

export type AgentChannel = 'SITE_CHAT' | 'REVIEW_SHADOW' | 'AUDIT' | 'SETTLE' | 'TRANSLATE' | 'BOARD';   // v10.104 TRANSLATE(D118) · v10.105 BOARD(D119)
/** v10.111 — 엔진의 키가 어디서 왔나: 운영 화면 · .env · 시험 엔진(.env AGENT_PROVIDER=MOCK) · 없음 */
export type AgentKeySource = 'ADMIN' | 'ENV' | 'MOCK' | 'NONE';

const ENGINE_TTL_MS = 60_000;   // 운영 화면에서 키를 바꾸면 늦어도 1분 안에 모든 통로가 새 키로(재시작 없음)

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
  private readonly log = new Logger(AgentService.name);
  private engine: { at: number; key: string | null; source: AgentKeySource; prov: AgentProvider | null } | null = null;

  constructor(private readonly db: DatabaseService) {}

  /* ── v10.111 엔진 (D122 · docs/173) ──────────────────────────────────
   * 번역 · 게시판 번역 · 검수 보조 · AI 상담이 모두 여기서 엔진을 받습니다(전에는 서비스마다 기동 때 한 번).
   *   ① .env AGENT_PROVIDER=MOCK → 시험 엔진(밖으로 안 나감 · 점검판 전용)
   *   ② 운영 화면 › AI 에이전트 › 「AI 키」(integration_secrets · 암호화) → CLAUDE
   *   ③ .env AGENT_PROVIDER=CLAUDE + ANTHROPIC_API_KEY → CLAUDE (v10.104 방식 그대로)
   *   ④ 없음 → null(아무것도 부르지 않음)
   * 키는 서버만 씁니다 — 화면 · 응답 · 로그 · 감사 기록에 내보내지 않습니다(끝 4자리만). 부를지 말지는 여전히 allowed()(스위치 · 월 상한).
   */
  async provider(): Promise<AgentProvider | null> { return (await this.resolve()).prov; }

  private async resolve() {
    if (this.engine && Date.now() - this.engine.at < ENGINE_TTL_MS) return this.engine;
    const env = process.env;
    const prev = this.engine;
    let next: { key: string | null; source: AgentKeySource; prov: AgentProvider | null };
    if (env.AGENT_PROVIDER === 'MOCK') {
      next = { key: null, source: 'MOCK', prov: prev?.source === 'MOCK' ? prev.prov : new MockAgentProvider() };
    } else {
      const { v: dbKey, failed } = await this.dbKey();
      if (failed && prev?.source === 'ADMIN') {
        // 운영 화면 키를 잠깐 못 읽음 — 쓰던 엔진을 그대로 두고 5초 뒤 다시 읽음(60초 동안 꺼지거나 .env 로 넘어가지 않게)
        this.engine = { ...prev, at: Date.now() - ENGINE_TTL_MS + 5_000 };
        return this.engine;
      }
      const envProv = dbKey ? null : resolveAgentProvider(env);
      const key = dbKey ?? (envProv ? (env.ANTHROPIC_API_KEY as string) : null);
      // 같은 키면 SDK 클라이언트를 다시 만들지 않음
      next = { key, source: dbKey ? 'ADMIN' : envProv ? 'ENV' : 'NONE',
               prov: !key ? null : prev?.key === key && prev.prov ? prev.prov : dbKey ? new ClaudeAgentProvider(dbKey) : envProv };
    }
    this.engine = { at: Date.now(), ...next };
    return this.engine;
  }

  private async dbKey(): Promise<{ v: string | null; failed: boolean }> {
    try {
      const [r] = await this.db.query<{ v: string | null }>(`SELECT public.fn_integ_secret_get('AGENT', 'ANTHROPIC_API_KEY') AS v`);
      return { v: r?.v?.trim() || null, failed: false };
    } catch (e) {
      // 암호 열쇠 문제 등 — 키 값은 남기지 않고 종류만. .env 키로 이어감
      this.log.warn(`운영 화면 AI 키를 읽지 못했습니다(${(e as { code?: string })?.code ?? 'ERR'}) — .env 키로 이어갑니다`);
      return { v: null, failed: true };
    }
  }

  /** 운영 화면 › AI 에이전트 › 「AI 키」 (SUPER) — 값은 내보내지 않고 끝 4자리 · 어디서 왔는지만 */
  async keyView() {
    this.engine = null;
    const e = await this.resolve();
    const [r] = await this.db.query<{ last4: string; updated_at: Date }>(
      `SELECT last4, updated_at FROM integration_secrets WHERE integration_code = 'AGENT' AND name = 'ANTHROPIC_API_KEY'`);
    const envKey = process.env.ANTHROPIC_API_KEY?.trim();
    // 끝 4자리는 지금 쓰는 키의 것만(시험 엔진이면 저장한 키) — 저장한 키를 못 읽어 .env 로 넘어갔으면 unreadable
    const showSaved = !!r && (e.source === 'ADMIN' || e.source === 'MOCK');
    return {
      name: 'ANTHROPIC_API_KEY',
      source: e.source,
      engine: e.prov?.name ?? null,
      saved: !!r,
      unreadable: !!r && (e.source === 'ENV' || e.source === 'NONE'),
      masked: showSaved ? `••••••${r!.last4}` : e.source === 'ENV' && envKey ? `••••••${envKey.slice(-4)}` : null,
      updatedAt: r?.updated_at ?? null,
    };
  }

  async setKey(value: string) {
    await this.db.query(`SELECT * FROM public.fn_integ_secret_set('AGENT', 'ANTHROPIC_API_KEY', $1, $2)`, [value, RequestCtx.actorId() ?? null]);
    return this.keyView();
  }

  async clearKey() {
    await this.db.query(`DELETE FROM integration_secrets WHERE integration_code = 'AGENT' AND name = 'ANTHROPIC_API_KEY'`);
    await this.db.query(`UPDATE integrations SET secret_registered = false WHERE code = 'AGENT'`);
    return this.keyView();
  }

  /**
   * 키 확인 — Anthropic 모델 목록을 한 번 읽습니다(토큰을 쓰지 않아 비용 없음 · 월 상한과 무관).
   * 지금 쓰는 키(운영 화면 먼저, 없으면 .env)로 합니다. 응답에 키 값은 없습니다.
   */
  async testKey(): Promise<{ ok: boolean; kind: string | null; message: string; models: string[] }> {
    this.engine = null;
    const e = await this.resolve();
    if (e.source === 'MOCK') return { ok: true, kind: null, message: '시험 엔진(MOCK)입니다 — 밖으로 나가지 않으므로 키를 확인하지 않습니다.', models: [] };
    if (!e.key) throw new PolicyViolation('AGENT_KEY_MISSING', 'AI 키가 없습니다. 먼저 키를 넣으십시오.');
    const want = await this.db.query<{ v: string | null }>(   // DB 오류를 Anthropic 실패로 잘못 보이지 않게 try 밖에서
      `SELECT value AS v FROM site_settings WHERE key IN ('agent.review_model', 'agent.chat_model', 'i18n.translate_model') AND coalesce(value, '') <> ''`);
    try {
      const page = await new Anthropic({ apiKey: e.key, maxRetries: 0, timeout: 10_000 }).models.list({ limit: 100 });
      const ids = page.data.map((m) => m.id);
      const missing = [...new Set(want.map((w) => w.v as string))].filter((m) => !ids.some((id) => id === m || id.startsWith(`${m}-`)));
      return { ok: true, kind: null, models: ids.slice(0, 20),
               message: `키 확인 성공 — 쓸 수 있는 모델 ${ids.length}개${missing.length ? ` · 설정한 모델 중 목록에서 찾지 못함: ${missing.join(', ')}(모델 이름 확인 필요)` : ''}` };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const kind = err instanceof Anthropic.APIConnectionTimeoutError ? 'TIMEOUT'
        : err instanceof Anthropic.APIConnectionError ? 'NETWORK'
        : status === 401 ? 'AUTH' : status === 403 ? 'PERMISSION' : status === 429 ? 'RATE' : 'UPSTREAM';
      const why: Record<string, string> = {
        AUTH: '키가 틀렸거나 폐기된 키입니다 — Anthropic 콘솔 › API Keys 에서 새로 만들어 넣으십시오.',
        PERMISSION: '이 키로는 쓸 수 없습니다(권한 · 조직 설정) — Anthropic 콘솔에서 키의 워크스페이스를 확인하십시오.',
        RATE: '요청이 많습니다 — 잠시 뒤 다시 하십시오.',
        TIMEOUT: '응답이 늦습니다 — 잠시 뒤 다시 하십시오.',
        NETWORK: '서버에서 Anthropic(api.anthropic.com)으로 연결하지 못했습니다(발신 · 방화벽).',
      };
      this.log.warn(`AI 키 확인 실패 — ${kind}${status ? ` (${status})` : ''}`);
      return { ok: false, kind, models: [], message: why[kind] ?? `Anthropic 이 요청을 받지 않았습니다${status ? `(${status})` : ''} — 잠시 뒤 다시 하십시오.` };
    }
  }

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
      `SELECT key, value FROM site_settings WHERE key LIKE 'agent.%' OR key IN ('i18n.auto_translate.enabled', 'i18n.translate_model', 'i18n.board_on_view') ORDER BY key`);
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
    const eng = await this.resolve();
    const channels = await Promise.all((['REVIEW_SHADOW', 'SITE_CHAT', 'TRANSLATE', 'BOARD'] as AgentChannel[]).map(async (c) => ({ channel: c, ...(await this.allowed(c)) })));
    return {
      enabled: s['agent.enabled'] === 'on',
      switches: {
        reviewShadow: s['agent.review_shadow.enabled'] === 'on', chat: s['agent.chat.enabled'] === 'on',
        memberLookup: s['agent.chat.member_lookup.enabled'] === 'on',
        translate: s['i18n.auto_translate.enabled'] === 'on',   // v10.104 등록 글 자동 번역(D118)
        board: s['i18n.board_on_view'] === 'on',   // v10.105 소개광장 볼 때 번역(D119)
      },
      capUsd: s['agent.monthly_cap_usd'] ?? '0', monthCostUsd: m?.cost ?? '0',
      reviewModel: s['agent.review_model'] ?? null, chatModel: s['agent.chat_model'] ?? null, translateModel: s['i18n.translate_model'] ?? null,
      limits: { guestDaily: Number(s['agent.guest_daily_limit'] ?? 0), memberDaily: Number(s['agent.member_daily_limit'] ?? 0) },
      engine: eng.prov?.name ?? null, keySource: eng.source,   // v10.111 — 지금 엔진 · 키가 어디서 왔나(값은 없음)
      channels, usage, prices, agreement,
      note: '0단계(틀) — 모델 연결은 1단계(API 키 · 월 상한 · 법무 검토 뒤). 상한이 0 이면 아무것도 부르지 않습니다.',
    };
  }
}
