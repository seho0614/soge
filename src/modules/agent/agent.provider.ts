/**
 * AI 모델 어댑터 (v10.94 · docs/149 3-1 · ai-agent #12).
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
  stopReason: string;
}
export interface AgentProvider {
  readonly name: 'MOCK' | 'CLAUDE' | 'N8N';
  complete(input: { model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens: number }): Promise<AgentReply>;
}

/** 시험용 — 밖으로 나가지 않습니다. 받은 마지막 말을 짧게 되돌리고 토큰 수는 글자 수로 어림합니다 */
export class MockAgentProvider implements AgentProvider {
  readonly name = 'MOCK' as const;
  async complete(input: { model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens: number }): Promise<AgentReply> {
    const last = input.messages[input.messages.length - 1]?.content ?? '';
    const text = `[시험 응답] ${last.slice(0, 80)}`;
    return { text, model: input.model, inputTokens: Math.ceil((input.system.length + last.length) / 2), outputTokens: Math.ceil(text.length / 2),
             cacheReadTokens: 0, stopReason: 'end_turn' };
  }
}

/** AGENT_PROVIDER 환경 값 — 지금은 MOCK 만(없으면 null · 아무것도 부르지 않음) */
export function resolveAgentProvider(env: NodeJS.ProcessEnv = process.env): AgentProvider | null {
  return env.AGENT_PROVIDER === 'MOCK' ? new MockAgentProvider() : null;
}
