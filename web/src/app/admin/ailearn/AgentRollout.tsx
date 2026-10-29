import { useApi } from '../../../lib/useApi';
import { ErrorView } from '../../../components/ErrorView';

/**
 * v10.147 — AI 운영 › AI 에이전트 › 「AI 켜기 단계」 (SB-ADM-AGT-010 안의 한 구역)
 *   docs/176 의 순서를 한 줄씩: 처리방침 게시 → 키 · 월 상한 · AI 전체 → 검수 보조 2주 → AI 상담 1주 → 내 정보 조회 → 신청서 초안.
 *   단계마다 지금 숫자 · 넘어가는 기준 · 상태. 막지는 않습니다 — 아래 「AI 스위치」가 앞 단계 미달이면 확인 창에 경고(SUPER 판단).
 */
export interface RolloutStep {
  step: number; code: string; label: string; switchKey: string | null; on: boolean;
  state: 'DONE' | 'RUN' | 'READY' | 'WAIT'; early: boolean; now: string; need: string;
}
const ST: Record<RolloutStep['state'], [string, string]> = {
  DONE: ['ok', '기준 넘음'], RUN: ['wait', '켜고 보는 중'], READY: ['wait', '할 차례'], WAIT: ['no', '앞 단계 먼저'],
};

export function AgentRollout() {
  const r = useApi<RolloutStep[]>('/admin/agent/rollout');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  return (
    <div data-agent-rollout>
      <h3 className="sec">AI 켜기 단계</h3>
      <p className="hint">위에서부터 하나씩 켜고 기준을 넘으면 다음으로 갑니다(docs/176). 기준은 숫자로 보이며, 「넘겨야 할 문항 100%」처럼 셀 수 없는 것은 상담 기록을 보고 판단합니다.</p>
      <table className="tbl">
        <thead><tr><th style={{ width: 40 }}>#</th><th>단계</th><th>지금</th><th>넘어가는 기준 · 할 일</th><th style={{ width: 120 }}>상태</th></tr></thead>
        <tbody>
          {r.data.map((s) => (
            <tr key={s.code} data-rollout={s.code} data-rollout-state={s.state}>
              <td>{s.step}</td>
              <td><b>{s.label}</b></td>
              <td>{s.now}</td>
              <td className="muted">{s.need}</td>
              <td><span className={`ad-bg ${ST[s.state][0]}`}>{ST[s.state][1]}</span>
                {s.early && <div className="form-error" data-rollout-early>앞 단계 기준 전에 켜짐</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
