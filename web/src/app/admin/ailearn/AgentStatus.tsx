import { useApi } from '../../../lib/useApi';
import { n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';

/* ── SB-ADM-AGT-010 AI 에이전트 — v10.94 0단계 틀(D116 · docs/149 · docs/151) ─────────
 * 스위치 · 월 상한 · 이번 달 비용 · 통로별 사용량 · 요금표 · AI 검수 일치율을 봅니다.
 * 바꾸는 것은 정책(site_settings)의 agent.* 입니다. AI 는 승인 · 반려 · 확정 · 지급을 하지 않습니다. */
interface Status {
  enabled: boolean; switches: { reviewShadow: boolean; chat: boolean; memberLookup: boolean };
  capUsd: string; monthCostUsd: string; reviewModel: string | null; chatModel: string | null;
  limits: { guestDaily: number; memberDaily: number };
  channels: { channel: string; ok: boolean; reason: string | null }[];
  usage: { channel: string; model: string; requests: number; inputTokens: string; outputTokens: string; costUsd: string }[];
  prices: { model: string; inputPerM: string; outputPerM: string; cacheReadPerM: string; asOf: string; note: string | null }[];
  agreement: { model: string; decided: number; agreed: number; unsure: number; agreePct: string | null }[];
  note: string;
}
const CH_KO: Record<string, string> = { REVIEW_SHADOW: '검수 보조(병행)', SITE_CHAT: '고객응대 안내', AUDIT: '감사 보조', SETTLE: '정산 보조' };
const WHY_KO: Record<string, string> = {
  AGENT_OFF: '전체 꺼짐(agent.enabled)', CHANNEL_OFF: '이 통로 꺼짐', CHANNEL_NOT_READY: '아직 없는 통로',
  CAP_ZERO: '월 상한 0', CAP_REACHED: '월 상한에 닿음',
};
const onOff = (v: boolean) => (v ? '켜짐' : '꺼짐');

export function AgentStatus() {
  const r = useApi<Status>('/admin/agent/status');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  return (
    <>
      <h2>AI 에이전트</h2>
      <div className="kpi4" data-agent-kpi>
        <div><b className={d.enabled ? 'good' : ''}>{onOff(d.enabled)}</b><span>전체(agent.enabled)</span></div>
        <div><b>${d.capUsd}</b><span>월 상한</span></div>
        <div><b>${d.monthCostUsd}</b><span>이번 달 비용</span></div>
        <div><b>{d.reviewModel ?? '—'}</b><span>검수 보조 모델</span></div>
      </div>
      <p className="card">{d.note} 월 상한에 닿으면 전체가 저절로 꺼지고 운영 경보가 뜹니다. AI 의견은 따로 쌓일 뿐 검수 상태를 바꾸지 않습니다.</p>

      <h3 className="sec">통로</h3>
      <table className="tbl" data-agent-channels>
        <thead><tr><th>통로</th><th>스위치</th><th>지금 부를 수 있나</th></tr></thead>
        <tbody>
          {d.channels.map((c) => (
            <tr key={c.channel}><td>{CH_KO[c.channel] ?? c.channel}</td>
              <td>{onOff(c.channel === 'REVIEW_SHADOW' ? d.switches.reviewShadow : d.switches.chat)}</td>
              <td>{c.ok ? <span className="good">예</span> : <span className="muted">아니오 — {WHY_KO[c.reason ?? ''] ?? c.reason}</span>}</td></tr>
          ))}
          <tr><td>고객응대 내 정보 조회</td><td>{onOff(d.switches.memberLookup)}</td><td className="muted">3단계</td></tr>
        </tbody>
      </table>
      <p className="hint">하루 횟수 — 비회원 {n(d.limits.guestDaily)}회 · 회원 {n(d.limits.memberDaily)}회 · 고객응대 모델 {d.chatModel ?? '—'}</p>

      <h3 className="sec">이번 달 사용량</h3>
      {d.usage.length === 0 ? <p className="muted">아직 부른 적이 없습니다.</p> : (
        <table className="tbl" data-agent-usage>
          <thead><tr><th>통로</th><th>모델</th><th>횟수</th><th>입력 토큰</th><th>출력 토큰</th><th>비용(달러)</th></tr></thead>
          <tbody>{d.usage.map((u) => (
            <tr key={u.channel + u.model}><td>{CH_KO[u.channel] ?? u.channel}</td><td>{u.model}</td><td className="num-cell">{n(u.requests)}</td>
              <td className="num-cell">{n(u.inputTokens)}</td><td className="num-cell">{n(u.outputTokens)}</td><td className="num-cell">{u.costUsd}</td></tr>
          ))}</tbody>
        </table>
      )}

      <h3 className="sec">AI 검수 의견 · 사람 결정 일치(최근 14일)</h3>
      {d.agreement.length === 0 ? <p className="muted">아직 AI 의견이 없습니다(1단계에서 시작).</p> : (
        <table className="tbl" data-agent-agreement>
          <thead><tr><th>모델</th><th>사람이 결정</th><th>일치</th><th>모름</th><th>일치율</th></tr></thead>
          <tbody>{d.agreement.map((a) => (
            <tr key={a.model}><td>{a.model}</td><td className="num-cell">{n(a.decided)}</td><td className="num-cell">{n(a.agreed)}</td>
              <td className="num-cell">{n(a.unsure)}</td><td className="num-cell">{a.agreePct ?? '—'}%</td></tr>
          ))}</tbody>
        </table>
      )}
      <p className="hint">통과 기준(ai-agent #15) — 2주 · 100건 이상 · 방향 일치 90% 이상. 통과해도 자동 처리는 하지 않습니다(의견만).</p>

      <h3 className="sec">요금표(100만 토큰당 달러)</h3>
      <table className="tbl" data-agent-prices>
        <thead><tr><th>모델</th><th>입력</th><th>출력</th><th>캐시 읽기</th><th>기준일</th><th>메모</th></tr></thead>
        <tbody>{d.prices.map((p) => (
          <tr key={p.model}><td>{p.model}</td><td className="num-cell">{p.inputPerM}</td><td className="num-cell">{p.outputPerM}</td>
            <td className="num-cell">{p.cacheReadPerM}</td><td>{p.asOf}</td><td className="muted">{p.note}</td></tr>
        ))}</tbody>
      </table>
      <p className="hint">요금은 바뀔 수 있습니다 — 계약 전 Anthropic 요금표로 다시 확인하십시오.</p>
    </>
  );
}
