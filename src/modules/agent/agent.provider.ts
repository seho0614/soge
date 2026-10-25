import Anthropic from '@anthropic-ai/sdk';

/**
 * AI 모델 어댑터 (v10.94 · docs/149 3-1 · ai-agent #12 · v10.104 CLAUDE · docs/162).
 *
 * 결제 · 국세청 어댑터와 같은 방식 — 서비스는 이 모양만 압니다. 이번 판(0단계)에는 시험용 MOCK 만 있습니다.
 * 1단계에서 CLAUDE(공식 SDK `@anthropic-ai/sdk` · 소개뱅크가 직접 호출)를, 자동화 서버가 생기면 N8N 을 더합니다.
 * 부르기 전에 반드시 DB 의 fn_agent_allowed(통로)를 보고, 부른 뒤 fn_agent_record_usage 로 비용을 쌓습니다(AgentGuardService).
 */
export interface AgentReply {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** v10.109 — 프롬프트 캐시에 새로 쓴 토큰(입력의 약 1.25배 값) · 없으면 0 */
  cacheWriteTokens?: number;
  stopReason: string;
}
export interface AgentProvider {
  readonly name: 'MOCK' | 'CLAUDE' | 'N8N';
  /** effort — 생각 · 답 길이를 줄이는 정도(v10.104 · 번역은 low). 받지 않는 엔진은 무시 */
  complete(input: { model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens: number; effort?: 'low' | 'medium' | 'high'; cacheSystem?: boolean }): Promise<AgentReply>;
}

/** 시험용 — 밖으로 나가지 않습니다. 받은 마지막 말을 짧게 되돌리고 토큰 수는 글자 수로 어림합니다 */
export class MockAgentProvider implements AgentProvider {
  readonly name = 'MOCK' as const;
  async complete(input: { model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens: number; effort?: 'low' | 'medium' | 'high'; cacheSystem?: boolean }): Promise<AgentReply> {
    const last = input.messages[input.messages.length - 1]?.content ?? '';
    const text = `[시험 응답] ${last.slice(0, 80)}`;
    return { text, model: input.model, inputTokens: Math.ceil((input.system.length + last.length) / 2), outputTokens: Math.ceil(text.length / 2),
             cacheReadTokens: 0, stopReason: 'end_turn' };
  }
}

/**
 * v10.104 — Claude(공식 SDK · 소개뱅크 API 가 직접 호출). 키는 운영 .env 의 ANTHROPIC_API_KEY(사람이 넣음 · 코드 · 기록에 남기지 않음).
 *   SDK 가 잠깐 막힘(429 · 5xx · 연결)을 스스로 1번 다시 시도합니다. 그 밖의 실패는 부르는 쪽(작업 줄)이 횟수를 세어 다시 합니다.
 */
export class ClaudeAgentProvider implements AgentProvider {
  readonly name = 'CLAUDE' as const;
  private readonly client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });   // 배치 시간 예산(40초) 안에서 — 길게 매달리지 않음
  }
  async complete(input: { model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens: number; effort?: 'low' | 'medium' | 'high'; cacheSystem?: boolean }): Promise<AgentReply> {
    const r = await this.client.messages.create({
      model: input.model, max_tokens: input.maxTokens, messages: input.messages,
      // v10.109 — 긴 지시문(고객응대 지식 묶음)은 프롬프트 캐시에 — 같은 지시문이면 다음 호출부터 입력 값이 약 1/10
      system: input.cacheSystem ? [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }] : input.system,
      ...(input.effort ? { output_config: { effort: input.effort } } : {}),
    });
    const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, model: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens,
             cacheReadTokens: r.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: r.usage.cache_creation_input_tokens ?? 0,
             stopReason: r.stop_reason ?? 'unknown' };
  }
}

/**
 * AGENT_PROVIDER 환경 값 — MOCK(시험 · 밖으로 안 나감) · CLAUDE(ANTHROPIC_API_KEY 가 있을 때만). 그 밖에는 null(아무것도 부르지 않음).
 *   부를지 말지(스위치 · 월 상한)는 이것과 따로 DB 의 fn_agent_allowed 가 정합니다.
 */
export function resolveAgentProvider(env: NodeJS.ProcessEnv = process.env): AgentProvider | null {
  if (env.AGENT_PROVIDER === 'MOCK') return new MockAgentProvider();
  if (env.AGENT_PROVIDER === 'CLAUDE' && (env.ANTHROPIC_API_KEY ?? '').length > 20) return new ClaudeAgentProvider(env.ANTHROPIC_API_KEY as string);
  return null;
}
