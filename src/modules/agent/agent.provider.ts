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
  /** v10.137 — 도구를 주었을 때 모델이 고른 도구(stopReason 'tool_use') · 다음 호출에 그대로 되돌릴 답 조각 */
  toolUses?: AgentToolUse[];
  content?: AgentBlock[];
}
/** v10.137 (AI 상담 3단계 · docs/204) — 도구 사용(tool use). 모양은 Anthropic Messages API 와 같음 */
export interface AgentTool { name: string; description: string; input_schema: Record<string, unknown> }
export interface AgentToolUse { id: string; name: string; input: Record<string, unknown> }
export type AgentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
export interface AgentMessage { role: 'user' | 'assistant'; content: string | AgentBlock[] }
export interface AgentInput {
  model: string; system: string; messages: AgentMessage[]; maxTokens: number;
  /** effort — 생각 · 답 길이를 줄이는 정도(v10.104 · 번역은 low). 받지 않는 엔진은 무시 */
  effort?: 'low' | 'medium' | 'high'; cacheSystem?: boolean;
  /** v10.137 — 주면 모델이 도구를 고를 수 있음(없으면 지금처럼 글만) */
  tools?: AgentTool[];
}
export interface AgentProvider {
  readonly name: 'MOCK' | 'CLAUDE' | 'N8N';
  complete(input: AgentInput): Promise<AgentReply>;
}

/** 시험 엔진의 도구 고르기 — 질문의 낱말로 정함(밖으로 나가지 않음 · 시험이 같은 결과를 얻게)
 *   v10.139 — 「초안」이 들어가면 신청서 초안 도구(받았을 때만 · 아니면 아래 조회 도구로) · 끝 4자리는 질문의 「주문 XXXX」 */
const MOCK_TOOL_WORDS: [RegExp, string, ((q: string) => Record<string, unknown>)?][] = [
  [/초안.*(반품|교환|취소)|(반품|교환|취소).*초안/, 'draft_return', (q) => ({
    orderTail: /주문\s*([A-Za-z0-9]{4})\b/.exec(q)?.[1] ?? '0000', kind: /교환/.test(q) ? 'EXCHANGE' : /취소/.test(q) ? 'CANCEL' : 'RETURN',
    reason: /불량|파손|하자/.test(q) ? 'DEFECT' : 'CHANGE_MIND', detail: q.slice(0, 100) })],
  [/초안.*문의|문의.*초안/, 'draft_inquiry', (q) => ({ category: /정산|소개비/.test(q) ? 'SETTLE' : 'ETC', title: q.slice(0, 30), body: q.slice(0, 300) })],
  [/반품|교환|취소 신청/, 'my_returns'], [/주문|배송|택배/, 'my_orders'], [/검수|반려|안 올라/, 'my_reviews'],
  [/문의/, 'my_inquiries'], [/구독|소개코드|요금제/, 'my_subscription'],
];

/** 시험용 — 밖으로 나가지 않습니다. 받은 마지막 말을 짧게 되돌리고 토큰 수는 글자 수로 어림합니다 */
export class MockAgentProvider implements AgentProvider {
  readonly name = 'MOCK' as const;
  async complete(input: AgentInput): Promise<AgentReply> {
    const lastMsg = input.messages[input.messages.length - 1]?.content ?? '';
    const last = typeof lastMsg === 'string' ? lastMsg : lastMsg.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : '')).join(' ');
    // v10.137 — 도구를 받았고 아직 도구 결과가 오지 않은 질문이면 낱말로 도구 하나를 고름
    const hit = input.tools?.length && typeof lastMsg === 'string'
      ? MOCK_TOOL_WORDS.find(([re, name]) => re.test(lastMsg) && input.tools!.some((t) => t.name === name)) : undefined;
    if (hit && typeof lastMsg === 'string') {
      const [, tool, make] = hit;
      const id = `mock_${tool}`;
      const args = make ? make(lastMsg) : {};
      return { text: '', model: input.model, inputTokens: Math.ceil((input.system.length + last.length) / 2), outputTokens: 20, cacheReadTokens: 0,
               stopReason: 'tool_use', toolUses: [{ id, name: tool, input: args }], content: [{ type: 'tool_use', id, name: tool, input: args }] };
    }
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
  async complete(input: AgentInput): Promise<AgentReply> {
    const r = await this.client.messages.create({
      model: input.model, max_tokens: input.maxTokens, messages: input.messages as Anthropic.MessageParam[],
      ...(input.tools?.length ? { tools: input.tools as Anthropic.Tool[] } : {}),
      // v10.109 — 긴 지시문(고객응대 지식 묶음)은 프롬프트 캐시에 — 같은 지시문이면 다음 호출부터 입력 값이 약 1/10
      system: input.cacheSystem ? [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }] : input.system,
      ...(input.effort ? { output_config: { effort: input.effort } } : {}),
    });
    const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, model: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens,
             cacheReadTokens: r.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: r.usage.cache_creation_input_tokens ?? 0,
             stopReason: r.stop_reason ?? 'unknown',
             toolUses: r.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : [])),
             content: r.content.flatMap((b): AgentBlock[] => (b.type === 'text' ? [{ type: 'text', text: b.text }]
               : b.type === 'tool_use' ? [{ type: 'tool_use', id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : [])) };
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
