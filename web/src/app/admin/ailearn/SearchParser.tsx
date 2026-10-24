import { useApi } from '../../../lib/useApi';
import { n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';

/* ── SB-ADM-SCH-010 검색 파서 · 로그 ─────────────────────────────── */
interface Parser { enabled: boolean; calls: number; fallbacks: number; fallback_pct: number | null; avg_ms: number | null; note: string | null }

export function SearchParser() {
  const r = useApi<Parser>('/admin/search/parser');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  return (
    <>
      <h2>검색 파서</h2>
      <p className="lead">규칙 엔진과 LLM 파서입니다.</p>
      <div className="kpi4">
        <div><b>{n(d.calls)}</b><span>24시간 호출</span></div>
        <div><b className={(d.fallback_pct ?? 0) > 20 ? 'bad' : 'good'}>{d.fallback_pct ?? 0}%</b><span>폴백</span></div>
        <div><b>{d.avg_ms == null ? '—' : `${d.avg_ms}ms`}</b><span>평균 응답</span></div>
        <div><b className={d.enabled ? 'good' : ''}>{d.enabled ? 'on' : 'off'}</b><span>LLM 파서</span></div>
      </div>
      {d.note && <p className="card warn">{d.note}</p>}
      <p className="card">
        <b>LLM 파서가 꺼져 있어도 검색은 됩니다.</b> 규칙 엔진이 지역 · 규모 · 가격 · 상태를 읽습니다.
        LLM 은 &ldquo;가성비&rdquo; 같은 <b>주관적 조건</b>을 풀기 위한 것입니다.
      </p>
      <h3 className="sec">규칙 엔진이 읽는 것</h3>
      <table className="tbl">
        <thead><tr><th>종류</th><th>예</th></tr></thead>
        <tbody>
          <tr><td>규모</td><td>10평 이내 · 20평 이상</td></tr>
          <tr><td>금액</td><td>3천만원 이내 · 5억</td></tr>
          <tr><td>지역</td><td>부산 · 김포시</td></tr>
          <tr><td>상태</td><td>급매 · 가성비 · 신규</td></tr>
        </tbody>
      </table>
      <h3 className="sec">지키는 것</h3>
      <table className="tbl">
        <thead><tr><th>불변식</th><th>내용</th></tr></thead>
        <tbody>
          <tr><td className="mono">INV-SCH1</td><td>파서 호출에 계정 · 세션 · IP · 성향을 넣지 않습니다</td></tr>
          <tr><td className="mono">INV-SCH2</td><td>원문 검색어를 저장하지 않습니다</td></tr>
        </tbody>
      </table>
      <p className="card warn">
        <b>문제가 생기면 <code>search.llm_parser.enabled</code> 를 off 로 바꾸십시오.</b> 즉시 규칙 엔진만 쓰는 상태로
        돌아가고, 이용자는 차이를 못 느낍니다. 개인화 검색으로 넓히려면 별도 법무 질의가 필요합니다.
      </p>
    </>
  );
}
