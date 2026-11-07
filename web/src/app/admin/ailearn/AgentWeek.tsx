import { useApi } from '../../../lib/useApi';
import { ErrorView } from '../../../components/ErrorView';

/**
 * v10.206 (D183 · docs/330) — AI 운영 › AI 에이전트 › 「AI 첫 주 보고」 (SB-ADM-AGT-010 안의 한 구역 · 「AI 켜기 단계」 아래)
 *   최근 7일 날짜별 AI 상담(대화 · 답 · 넘김 · 답 %) · 검수 보조(의견 · 사람 결정 · 일치율) · 비용. 숫자만 — 글 · 손님 정보 없음.
 *   기준은 AI 켜기 단계와 같음(답 95% · 일치율 90%) — 못 미친 칸은 빨간 글자.
 */
interface WeekDay {
  day: string; chats: number; answers: number; handoffs: number; answeredPct: number | null;
  opinions: number; decided: number; agreePct: number | null; requests: number; costUsd: number;
}
interface Week { days: WeekDay[]; total: WeekDay; below: string[]; used: boolean }

const pct = (v: number | null, min: number) => v == null ? <span className="muted">—</span>
  : <span className={v < min ? 'form-error' : undefined} data-week-below={v < min ? '' : undefined}>{v}%</span>;

function Row({ d, b }: { d: WeekDay; b?: boolean }) {
  return (
    <tr data-week-day={d.day} style={b ? { fontWeight: 700 } : undefined}>
      <td>{d.day}</td><td>{d.chats}</td><td>{d.answers}</td><td>{d.handoffs}</td><td>{pct(d.answeredPct, 95)}</td>
      <td>{d.opinions}</td><td>{d.decided}</td><td>{pct(d.agreePct, 90)}</td><td>{d.requests}</td><td>${d.costUsd.toFixed(4)}</td>
    </tr>
  );
}

export function AgentWeek() {
  const r = useApi<Week>('/admin/agent/week');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  const w = r.data;
  return (
    <div data-agent-week>
      <h3 className="sec">AI 첫 주 보고 — 최근 7일</h3>
      <p className="hint">켠 뒤 다음 단계로 넘어갈지 판단하는 숫자입니다. 기준은 위 「AI 켜기 단계」와 같습니다(AI 상담 답 95% · 검수 보조 일치율 90%). 하루 요약에도 7일 합이 한 줄 나갑니다.</p>
      {!w.used && <p className="muted" data-week-empty>최근 7일 동안 AI 를 쓴 기록이 없습니다.</p>}
      {w.below.length > 0 && <p className="form-error" data-week-below-list>기준 미달: {w.below.join(' · ')}</p>}
      <table className="tbl">
        <thead><tr><th>날짜</th><th>상담 대화</th><th>답</th><th>넘김</th><th>답 %</th><th>검수 의견</th><th>사람 결정</th><th>일치율</th><th>요청</th><th>비용</th></tr></thead>
        <tbody>
          {w.days.map((d) => <Row key={d.day} d={d} />)}
          <Row d={w.total} b />
        </tbody>
      </table>
    </div>
  );
}
