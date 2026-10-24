import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { useHashSub } from '../../lib/hashSub';
import { AgentStatus, ClassifyLearn, RiskLearn, SearchDict, SearchParser, SegmentLearn, SegmentPreview } from './AiLearn';

interface Accuracy { total: number; missed: number; matched: number; corrected?: number }
interface Health {
  accuracy: Accuracy | null;
  misses: Array<{ input_text?: string; inputText?: string; cnt?: number }>;
  corrections: Array<{ suggested?: string; chosen?: string; cnt?: number }>;
  unlinked: Array<{ code: string; name: string; gwan_code?: string; gwanCode?: string }>;
  conflicts: Array<{ term?: string }>;
  note: string | null;
  vocab?: Record<string, number>;
}

type View = 'health' | 'parser' | 'dict' | 'classify' | 'segments' | 'segments-preview' | 'risk' | 'agent';
const TABS: SubTab<View>[] = [
  { key: 'health', label: '분류 품질', screen: 'SB-ADM-AIS-010' },
  { key: 'parser', label: '검색 파서', screen: 'SB-ADM-SCH-010' },
  { key: 'dict', label: '검색 사전', screen: 'SB-ADM-DIC-010' },
  { key: 'classify', label: '분류 학습', screen: 'SB-ADM-CLS-020' },
  { key: 'segments', label: '성향 학습', screen: 'SB-ADM-SEG-010' },
  { key: 'risk', label: '위험감지 학습', screen: 'SB-ADM-RSK-020' },
  { key: 'agent', label: 'AI 에이전트', screen: 'SB-ADM-AGT-010' },   /* v10.94 */
  /* v10.32 — 성향 학습 「대상 보기」가 여는 화면. 하위 탭 줄에는 그리지 않고(성향 학습이 켜진 채) 주소로 바로 엽니다 */
  { key: 'segments-preview', label: '옮길 대상 미리보기', screen: 'SB-ADM-SEG-020', hidden: true },
];
const VIEWS = TABS.map((t) => t.key);
/** SB-ADM-SEG-020 옮길 대상 미리보기의 주소 — 성향 학습에서 들어가면 뒤로 가기로 돌아옵니다 */
export const SEG_PREVIEW_HASH = '#/ai-ops/segments-preview';

/**
 * AI 운영 · 학습 탭 (2026-10-02)
 *   SB-ADM-AIS-010 AI 운영(분류 품질) · SB-ADM-SCH-010 검색 파서 · SB-ADM-DIC-010 검색 사전
 *   SB-ADM-CLS-020 분류 학습 · SB-ADM-SEG-010 성향 학습 · SB-ADM-RSK-020 위험감지 학습
 * 학습 화면들은 AiLearn.tsx 에 있습니다.
 */
/* v10.32 — 하위 탭을 주소(#/ai-ops/<하위>)에 남깁니다. 옮길 대상 미리보기(SB-ADM-SEG-020)는 #/ai-ops/segments-preview 로 바로 열립니다 */
export function AiOps() {
  const [view, setView] = useHashSub<View>('health', VIEWS);
  const openPreview = () => {
    history.pushState(null, '', SEG_PREVIEW_HASH);
    window.dispatchEvent(new Event('bo-sub'));
    window.scrollTo(0, 0);
  };
  return (
    <section>
      <SubTabs tabs={TABS} value={view === 'segments-preview' ? 'segments' : view} onChange={setView} />
      {view === 'health' && <ClassifyHealth />}
      {view === 'parser' && <SearchParser />}
      {view === 'dict' && <SearchDict />}
      {view === 'classify' && <ClassifyLearn />}
      {view === 'segments' && <SegmentLearn onPreview={openPreview} />}
      {view === 'segments-preview' && <SegmentPreview bare onBack={() => setView('segments')} />}
      {view === 'risk' && <RiskLearn />}
      {view === 'agent' && <AgentStatus />}
    </section>
  );
}

/**
 * SB-ADM-AIS-010 AI 운영
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────
 * 감시 뷰가 6종 있고 API 도 있는데 **볼 화면이 없었습니다.**
 * `v_classify_unlinked` 가 9건으로 "분류가 업종에 연결 안 됨" 을
 * 알리고 있었지만 아무도 못 봤습니다.
 *
 * **지표를 만들어 놓고 보지 않으면 없는 것과 같습니다.**
 *
 * ── AI 를 분리하지 않은 이유 ────────────────────────────────────────
 * 분류 판정의 재료가 본체 데이터입니다(금칙어 · 제한업종 · 어휘).
 * 떼어 내면 **본체가 안 뜰 때 제한업종을 못 거릅니다** —
 * 광고가 안 나가는 것은 매출 손실이지만 이건 법 위반입니다.
 */
function ClassifyHealth() {
  const { data, error } = useApi<Health>('/admin/risk/classify-health');

  if (error) return <ErrorView error={error} />;
  if (!data) return <p className="dim">불러오는 중…</p>;

  const a = data.accuracy;
  const rate = a && a.total > 0 ? Math.round(((a.matched ?? 0) / a.total) * 100) : null;

  return (
    <div>
      {data.unlinked.length > 0 && (
        <div className="notice warn">
          <b>업종에 연결되지 않은 분류가 {data.unlinked.length}건 있습니다.</b>
          분류 결과가 나와도 <b>어느 업종을 고르라는 것인지 화면이 알 수 없습니다.</b>
        </div>
      )}
      {data.conflicts.length > 0 && (
        <div className="notice warn">
          <b>같은 어휘가 여러 분류에 걸린 것이 {data.conflicts.length}건 있습니다.</b>
          어느 쪽으로 갈지 정해지지 않습니다.
        </div>
      )}

      {/* v10.31 — 시안 「분류 어휘」 표(어휘 · 분류 · 업종 미연결 · 어휘 충돌 · 제한업종 어휘) */}
      {data.vocab && (
        <div className="ad-tw"><table className="tbl" data-ai-vocab>
          <thead><tr><th>분류 어휘</th><th>값</th></tr></thead>
          <tbody>
            <tr><td><b>어휘</b></td><td>{(data.vocab.terms ?? 0).toLocaleString('ko-KR')}개</td></tr>
            <tr><td><b>분류</b></td><td>{data.vocab.cats ?? 0}종</td></tr>
            <tr><td><b>업종 미연결</b></td><td>{data.unlinked.length ? <b className="warn-text">{data.unlinked.length}건</b> : '없음'}</td></tr>
            <tr><td><b>어휘 충돌</b></td><td>{data.conflicts.length ? <b className="warn-text">{data.conflicts.length}건</b> : '없음'}</td></tr>
            <tr><td><b>제한업종 어휘</b></td><td>{data.vocab.restrict_terms ?? 0}개 · 어휘가 붙은 제한업종 {data.vocab.restrict_codes ?? 0} / {data.vocab.restricted ?? 0}
              {(data.vocab.restricted_no_vocab ?? 0) > 0 && <b className="warn-text"> · 어휘 없는 제한업종 {data.vocab.restricted_no_vocab}</b>}</td></tr>
          </tbody>
        </table></div>
      )}
      <h3>분류 품질</h3>
      {!a || a.total === 0 ? (
        <p className="dim">아직 분류 기록이 없습니다. 등록이 쌓이면 여기에 나옵니다.</p>
      ) : (
        <table className="tbl">
          <tbody>
            <tr><th>분류 요청</th><td>{a.total.toLocaleString()}건</td></tr>
            <tr><th>제안대로 선택</th>
              <td><b>{(a.matched ?? 0).toLocaleString()}</b>건
                {rate !== null && <span className="dim"> · {rate}%</span>}</td></tr>
            <tr><th>사람이 고침</th>
              <td>{(a.corrected ?? 0).toLocaleString()}건
                <span className="dim"> · 많으면 어휘를 손봐야 합니다</span></td></tr>
            <tr><th>분류 못 함</th>
              <td>{(a.missed ?? 0).toLocaleString()}건
                <span className="dim"> · 어휘에 없는 말이 들어온 것</span></td></tr>
          </tbody>
        </table>
      )}

      {data.misses.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>분류하지 못한 입력</h3>
          <p className="hint"><b>어휘를 무엇으로 늘릴지의 근거입니다.</b> 자주 나오는 말부터 넣으십시오.</p>
          <table className="tbl">
            <thead><tr><th>입력</th><th>횟수</th></tr></thead>
            <tbody>
              {data.misses.slice(0, 15).map((m, i) => (
                <tr key={i}>
                  <td>{m.inputText ?? m.input_text ?? '—'}</td>
                  <td className="dim">{m.cnt ?? 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.corrections.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>제안과 다른 선택</h3>
          <p className="hint">같은 조합이 반복되면 <b>그 어휘의 가중치를 손보십시오.</b></p>
          <table className="tbl">
            <thead><tr><th>제안</th><th>실제 선택</th><th>횟수</th></tr></thead>
            <tbody>
              {data.corrections.slice(0, 15).map((c, i) => (
                <tr key={i}>
                  <td className="dim">{c.suggested ?? '—'}</td>
                  <td><b>{c.chosen ?? '—'}</b></td>
                  <td className="dim">{c.cnt ?? 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.unlinked.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>업종 미연결 분류</h3>
          <table className="tbl">
            <thead><tr><th>분류</th><th>이름</th><th>관</th></tr></thead>
            <tbody>
              {data.unlinked.map((u) => (
                <tr key={u.code}>
                  <td><b>{u.code}</b></td>
                  <td>{u.name}</td>
                  <td className="dim">{u.gwanCode ?? u.gwan_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="notice">
        <b>정정 비율이 높아지면 어휘를 늘리십시오.</b>
        ML 로 바꾸는 것보다 싸고 빠릅니다 — 제한업종 차단이
        어휘 65개로 5/30 에서 30/30 이 됐습니다.
      </div>

      <div className="notice">
        <b>AI 는 본체와 같은 DB 에 둡니다.</b>
        분류 판정의 재료가 금칙어 · 제한업종 · 어휘라,
        떼어 내면 <b>본체가 안 뜰 때 제한업종을 못 거릅니다.</b>
      </div>
    </div>
  );
}
