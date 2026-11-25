import { Injectable } from '@nestjs/common';
import { sgb, sgbOk } from '../../core/sgb-client';

/* e3.5 (docs/011) AI — 소개뱅크 agent.service 와 같은 이름 · 회계(영수증 읽기)가 쓰는 allowed · provider().complete · record 만
 *   AI 키 · 월 상한 · 사용량 기록은 소개뱅크 한 곳(대표 11/26 「소개뱅크가 대신 호출」) → 내부 API 로 넘김 */
export interface AgentReply { text: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number }
@Injectable()
export class AgentService {
  async allowed(kind: string): Promise<{ ok: boolean; reason?: string }> {
    return sgbOk(await sgb.post('/internal/erp/agent/allowed', { kind }));
  }
  async provider(): Promise<{ name: string; complete(req: Record<string, unknown>): Promise<AgentReply> } | null> {
    const p = sgbOk<{ name: string | null }>(await sgb.get('/internal/erp/agent/provider'));
    if (!p?.name) return null;
    return { name: p.name, complete: async (req) => sgbOk<AgentReply>(await sgb.post('/internal/erp/agent/complete', req)) };
  }
  async record(kind: string, model: string, inTok: number, outTok: number, cacheRead?: number): Promise<void> {
    sgbOk(await sgb.post('/internal/erp/agent/record', { kind, model, inTok, outTok, cacheRead: cacheRead ?? 0 }));
  }
}
