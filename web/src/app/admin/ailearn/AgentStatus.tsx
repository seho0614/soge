import { Fragment, useState } from 'react';
import { useApi } from '../../../lib/useApi';
import { api, tokenRoles } from '../../../lib/api';
import { n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { AgentKey } from './AgentKey';
import { AgentSwitches } from './AgentSwitches';
import { AgentLimits } from './AgentLimits';
import { AgentRollout } from './AgentRollout';

/* ── SB-ADM-AGT-010 AI 에이전트 — v10.94 0단계 틀(D116 · docs/149 · docs/151) ─────────
 * 스위치 · 월 상한 · 이번 달 비용 · 통로별 사용량 · 요금표 · AI 검수 일치율을 봅니다.
 * 바꾸는 것은 정책(site_settings)의 agent.* 입니다 — v10.129 부터 아래 「AI 스위치」에서(최고 관리자). AI 는 승인 · 반려 · 확정 · 지급을 하지 않습니다. */
interface Status {
  enabled: boolean; switches: { reviewShadow: boolean; chat: boolean; memberLookup: boolean };
  capUsd: string; monthCostUsd: string; reviewModel: string | null; chatModel: string | null;
  limits: { guestDaily: number; memberDaily: number };
  channels: { channel: string; ok: boolean; reason: string | null }[];
  usage: { channel: string; model: string; requests: number; inputTokens: string; outputTokens: string; costUsd: string }[];
  prices: { model: string; inputPerM: string; outputPerM: string; cacheReadPerM: string; asOf: string; note: string | null }[];
  agreement: { model: string; decided: number; agreed: number; unsure: number; agreePct: string | null }[];
  /** v10.138 (D134) — 관별 일치율 · AI 의견 참고 결정 수 */
  agreementByGwan?: { gwanCode: string; decided: number; agreed: number; unsure: number; referenced: number; agreePct: string | null }[];
  engine: 'CLAUDE' | 'MOCK' | null; keySource: 'ADMIN' | 'ENV' | 'MOCK' | 'NONE';   // v10.111
  note: string;
}
const CH_KO: Record<string, string> = { REVIEW_SHADOW: '검수 보조(병행)', SITE_CHAT: '고객응대 안내', AUDIT: '감사 보조', SETTLE: '정산 보조', TRANSLATE: '등록 글 번역', BOARD: '게시판 번역' };
const WHY_KO: Record<string, string> = {
  AGENT_OFF: '전체 꺼짐(agent.enabled)', CHANNEL_OFF: '이 통로 꺼짐', CHANNEL_NOT_READY: '아직 없는 통로',
  CAP_ZERO: '월 상한 0', CAP_REACHED: '월 상한에 닿음',
};
const onOff = (v: boolean) => (v ? '켜짐' : '꺼짐');
const KEY_FROM: Record<Status['keySource'], string> = { ADMIN: '운영 화면 키', ENV: '.env 키', MOCK: '시험 엔진', NONE: '키 없음 — 아무것도 부르지 않음' };

export function AgentStatus() {
  const r = useApi<Status>('/admin/agent/status');
  const [tick, setTick] = useState(0);   // v10.147 — 스위치를 바꾸면 「AI 켜기 단계」도 다시 읽음
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
      <p className="hint" data-agent-engine>엔진 <b>{d.engine ?? '없음'}</b> · {KEY_FROM[d.keySource] ?? d.keySource}</p>
      {tokenRoles().includes('SUPER') && <AgentKey onChanged={r.reload} />}
      <AgentRollout key={tick} />
      <AgentSwitches onChanged={() => { r.reload(); setTick((t) => t + 1); }} />
      <AgentLimits onChanged={r.reload} />

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
      {(d.agreementByGwan?.length ?? 0) > 0 && (
        <table className="tbl" data-agent-agreement-gwan>
          <thead><tr><th>관(최근 14일)</th><th>사람이 결정</th><th>일치</th><th>모름</th><th>일치율</th><th>AI 의견 참고 결정</th></tr></thead>
          <tbody>{d.agreementByGwan!.map((a) => (
            <tr key={a.gwanCode} data-agreement-gwan={a.gwanCode}><td>{a.gwanCode}</td><td className="num-cell">{n(a.decided)}</td><td className="num-cell">{n(a.agreed)}</td>
              <td className="num-cell">{n(a.unsure)}</td><td className="num-cell">{a.agreePct ?? '—'}%</td><td className="num-cell">{n(a.referenced)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <p className="hint">통과 기준(ai-agent #15) — 2주 · 100건 이상 · 방향 일치 90% 이상. 통과해도 자동 처리는 하지 않습니다(의견만).</p>

      <AgentChats />

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

/* ── v10.109 (D121 · docs/170) AI 상담 목록 — 읽기만 · 연락처는 가려 저장됨 · 보관 5년(agent.chat_retention_days) ── */
interface ChatRow { id: string; status: string; member: boolean; inquiryId: string | null; createdAt: string; purgeAfter: string; turns: number; firstQuestion: string | null }
interface ChatMsg { role: string; body: string; model: string | null; stopReason: string | null; createdAt: string }
const ST_KO: Record<string, string> = { OPEN: '진행', HANDED_OFF: '담당자에게 넘김', CLOSED: '끝남' };
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

/* ── v10.131 (D129 · docs/197) AI 상담 「답 · 넘김 비율」 — 1주 운영 결과 판단용(결정 기록 ai-agent #20 · 기준 제안: 답할 문항 95%) ── */
interface ChatStats {
  days: number; questions: number; answers: number; answered: number; handoffSuggested: number; byAi: number;
  refusal: number; cut: number; badShape: number; banned: number; unknown: number; conversations: number; handedOff: number; lookups?: number; drafts?: number; draftsOpened?: number; draftsSubmitted?: number;
  answeredPct: number | null; handoffPct: number | null; handedOffPct: number | null;
}
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

function AgentChatStats() {
  const [days, setDays] = useState(7);
  const r = useApi<ChatStats>(`/admin/agent/chats/stats?days=${days}`);
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  const s = r.data;
  return (
    <div data-agent-chat-stats>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        {[7, 14, 30].map((d) => <button key={d} className={`btn-sm${days === d ? ' on' : ''}`} onClick={() => setDays(d)}>최근 {d}일</button>)}
      </div>
      <div className="kpi4">
        <div><b>{n(s.questions)}</b><span>질문 · 상담 {n(s.conversations)}건</span></div>
        <div><b className={s.answeredPct !== null && s.answeredPct >= 95 ? 'good' : ''} data-stat="answered">{pct(s.answeredPct)}</b><span>AI 가 답함({n(s.answered)})</span></div>
        <div><b data-stat="handoff">{pct(s.handoffPct)}</b><span>담당자에게 넘기기 권함({n(s.handoffSuggested)})</span></div>
        <div><b data-stat="handed">{pct(s.handedOffPct)}</b><span>손님이 실제로 넘김({n(s.handedOff)}건)</span></div>
      </div>
      <p className="hint">넘기기 권함의 내용 — AI 판단 {n(s.byAi)} · 거절 {n(s.refusal)} · 잘림 {n(s.cut)} · 답 모양 틀림 {n(s.badShape)} · 금칙어 {n(s.banned)}
        {s.unknown > 0 && <> · 기록 전 답 {n(s.unknown)}(v10.131 전 — 비율에서 뺌)</>}.
        {' '}내 정보 조회(3단계) <b data-stat="lookups">{n(s.lookups ?? 0)}</b>회.
        {' '}신청서 초안(4단계 · v10.139) <b data-stat="drafts">{n(s.drafts ?? 0)}</b>건 · 회원이 엶 <b data-stat="drafts-opened">{n(s.draftsOpened ?? 0)}</b> · 화면에서 제출 <b data-stat="drafts-submitted">{n(s.draftsSubmitted ?? 0)}</b>.
        기준(제안): 답할 수 있는 문항은 95% 이상 답함 · 돈 · 분쟁 · 개인 사정 문항은 모두 넘김 — 어느 쪽이 맞았는지는 아래 대화를 몇 건 열어 확인합니다.</p>
    </div>
  );
}

function AgentChats() {
  const [status, setStatus] = useState('');
  const r = useApi<ChatRow[]>(`/admin/agent/chats${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const show = (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setMsgs(null);
    api<ChatMsg[]>(`/admin/agent/chats/${id}`).then(setMsgs).catch(() => setMsgs([]));
  };
  return (
    <>
      <h3 className="sec">AI 상담(고객응대 안내)</h3>
      <AgentChatStats />
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        {['', 'OPEN', 'HANDED_OFF', 'CLOSED'].map((s) => (
          <button key={s || 'ALL'} className={`btn-sm${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>{s ? ST_KO[s] : '전체'}</button>
        ))}
      </div>
      {r.error ? <ErrorView error={r.error} onRetry={r.reload} /> : !r.data ? <p className="muted">불러오는 중…</p> : r.data.length === 0 ? (
        <p className="muted">아직 상담이 없습니다(스위치 agent.chat.enabled 가 꺼져 있으면 손님 화면에 단추가 없습니다).</p>
      ) : (
        <table className="tbl" data-agent-chats>
          <thead><tr><th>시작</th><th>손님</th><th>첫 질문</th><th>질문 수</th><th>상태</th><th>1:1 문의</th></tr></thead>
          <tbody>{r.data.map((c) => (
            <Fragment key={c.id}>
              <tr onClick={() => show(c.id)} style={{ cursor: 'pointer' }} data-agent-chat={c.id}>
                <td>{when(c.createdAt)}</td><td>{c.member ? '회원' : '비회원'}</td><td>{c.firstQuestion ?? '—'}</td>
                <td className="num-cell">{n(c.turns)}</td><td>{ST_KO[c.status] ?? c.status}</td><td>{c.inquiryId ? c.inquiryId.slice(0, 8) : '—'}</td>
              </tr>
              {open === c.id && (
                <tr><td colSpan={6}>
                  {!msgs ? <p className="muted">불러오는 중…</p> : msgs.map((m, i) => (
                    <p key={i} style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}><b>{m.role === 'user' ? '손님' : m.role === 'tool' ? '조회' : 'AI'}</b> {m.role === 'tool' ? <span className="muted" data-agent-tool-call>{m.body}</span> : m.body}
                      {m.stopReason && m.role === 'assistant' && m.stopReason !== 'end_turn' ? <span className="muted"> ({m.stopReason})</span> : null}</p>
                  ))}
                  <p className="hint">보관 기한 {when(c.purgeAfter)} · 손님 글의 연락처 · 링크는 가려 저장됩니다.</p>
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
