import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymd, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

/* ════════════════════════════════════════════════════════════════════
 * AI 운영 · 학습 화면 묶음 (2026-10-02)
 *   SB-ADM-SCH-010 검색 파서 · 로그
 *   SB-ADM-DIC-010 검색 사전
 *   SB-ADM-CLS-020 분류 학습
 *   SB-ADM-SEG-010 성향 학습
 *   SB-ADM-RSK-020 위험감지 학습
 * AiOps.tsx 의 하위 탭으로 붙습니다.
 * ════════════════════════════════════════════════════════════════════ */

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

/* ── SB-ADM-DIC-010 검색 사전 ────────────────────────────────────── */
interface Syn { id: string; term: string; canonical: string; kind: string; weight: number; createdAt: string }
interface Intent { term: string; field: string; operator: string; value: string | null; note: string }
interface TermStat { term: string; hits: number; zeroHits: number }
interface Terms { synonyms: Syn[]; intents: Intent[]; top: TermStat[]; zeroHit: TermStat[] }
const KIND: Record<string, string> = { GWAN: '관', CATEGORY: '분류', REGION: '지역', STATE: '상태', ITEM: '품목' };

export function SearchDict() {
  const r = useApi<Terms>('/admin/search/terms');
  const [f, setF] = useState({ term: '', canonical: '', kind: 'CATEGORY', weight: '5' });
  const [q, setQ] = useState('');
  const a = useAct();

  const add = () => {
    if (!f.term.trim() || !f.canonical.trim()) { a.setErr('치는 말과 우리 말을 적으십시오.'); return; }
    void a.run('add', () => api('/admin/search/synonyms', {
      method: 'POST', body: JSON.stringify({ term: f.term.trim(), canonical: f.canonical.trim(), kind: f.kind, weight: Number(f.weight) }),
    }), () => { setF({ ...f, term: '', canonical: '' }); r.reload(); }, '동의어를 넣었습니다. 다음 검색부터 적용됩니다.');
  };
  const del = (s: Syn) => {
    if (!confirm(`'${s.term} → ${s.canonical}' 을(를) 지웁니다.`)) return;
    void a.run(s.id, () => api(`/admin/search/synonyms/${s.id}`, { method: 'DELETE' }), r.reload, '지웠습니다.');
  };

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const syns = q.trim() ? d.synonyms.filter((s) => (s.term + s.canonical).includes(q.trim())) : d.synonyms;

  return (
    <>
      <h2>검색 사전</h2>
      <div className="kpi4">
        <div><b>{d.synonyms.length}</b><span>동의어</span></div>
        <div><b>{d.intents.length}</b><span>주관 표현</span></div>
        <div><b className={d.zeroHit.length ? 'bad' : 'good'}>{d.zeroHit.length}</b><span>결과 0건 잦은 말</span></div>
        <div><b>{d.top.length}</b><span>많이 찾은 말</span></div>
      </div>
      <p className="card">
        <b>한글은 pg_trgm 이 안 통합니다.</b> levenshtein 으로 오타를 잡습니다 — 거리 1 까지만입니다.
        두 글자에서는 관을 추측하지 않습니다(&ldquo;창고&rdquo;가 &ldquo;소개창업&rdquo;으로 가던 것을 막았습니다).
      </p>
      <Flash msg={a.msg} err={a.err} />

      {d.zeroHit.length > 0 && (
        <>
          <h3 className="sec">결과 0건으로 끝난 말 <em>{d.zeroHit.length}</em></h3>
          <p className="hint">동의어가 없어서일 가능성이 큽니다 — 넣을 후보입니다.</p>
          <table className="tbl">
            <thead><tr><th>검색어</th><th>검색</th><th>0건</th><th></th></tr></thead>
            <tbody>{d.zeroHit.slice(0, 20).map((t) => (
              <tr key={t.term}><td>{t.term}</td><td className="num-cell">{t.hits}</td><td className="num-cell">{t.zeroHits}</td>
                <td><button className="btn-sm" onClick={() => setF({ ...f, term: t.term })}>동의어로</button></td></tr>
            ))}</tbody>
          </table>
        </>
      )}

      <h3 className="sec">동의어 추가</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>치는 말</span><input value={f.term} maxLength={40} onChange={(e) => setF({ ...f, term: e.target.value })} /></label>
          <label><span>우리 말</span><input value={f.canonical} maxLength={40} onChange={(e) => setF({ ...f, canonical: e.target.value })} /></label>
          <label><span>종류</span>
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label><span>확신 (1~10)</span><input type="number" min={1} max={10} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'add'} onClick={add}>동의어 넣기</button></div>
      </div>

      <h3 className="sec">동의어 <em>{d.synonyms.length}</em></h3>
      <div className="search-row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="찾기" aria-label="동의어 찾기" /></div>
      {syns.length === 0 ? <p className="muted">동의어가 없습니다.</p> : (
        <table className="tbl">
          <thead><tr><th>치는 말</th><th>우리 말</th><th>종류</th><th>확신</th><th>넣은 날</th><th></th></tr></thead>
          <tbody>
            {syns.slice(0, 200).map((s) => (
              <tr key={s.id}>
                <td>{s.term}</td><td><b>{s.canonical}</b></td><td>{KIND[s.kind] ?? s.kind}</td>
                <td className="num-cell">{s.weight}</td><td className="muted">{ymd(s.createdAt)}</td>
                <td><button className="btn-no" disabled={a.busy === s.id} onClick={() => del(s)}>지우기</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">주관 표현 <em>{d.intents.length}</em></h3>
      <table className="tbl">
        <thead><tr><th>말</th><th>규칙</th><th>왜 이 값인가</th></tr></thead>
        <tbody>
          {d.intents.map((i) => (
            <tr key={i.term}><td><b>{i.term}</b></td><td className="mono">{i.field} {i.operator} {i.value ?? ''}</td><td className="muted">{i.note}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="card warn"><b>왜 그 값인지 반드시 적으십시오.</b> 안 적으면 나중에 &ldquo;이 40% 는 어디서 나온 숫자냐&rdquo;에 답할 수 없습니다.</p>
    </>
  );
}

/* ── SB-ADM-CLS-020 분류 학습 ────────────────────────────────────── */
interface LearnLog {
  id: number; term: string; code: string; before: number | null; after: number;
  signals: number; appliedAt: string; revertedAt: string | null;
}

interface LearnSet {
  classify: { enabled: boolean; minSignals: number; maxWeight: number; vocab: number };
  risk: { enabled: boolean; minSignals: number; expireDays: number; lawExempted: number };
}

export function ClassifyLearn() {
  const r = useApi<{ items: LearnLog[]; note: string | null }>('/admin/classify/learn/log');
  /* v10.31 — 시안 지표 4칸(학습 · 최소 교정 · 점수 상한 · 어휘) · 「학습 끄기」 */
  const ls = useApi<LearnSet>('/admin/ai/learn-settings');
  const [c, setC] = useState({ logId: '', toCode: '', reason: '' });
  const [since, setSince] = useState('');
  const a = useAct();

  const learn = () => a.run('learn', () => api('/admin/classify/learn', { method: 'POST' }), r.reload);
  const correct = () => {
    const logId = Number(c.logId);
    if (!Number.isInteger(logId) || logId < 1 || c.toCode.trim().length < 2) { a.setErr('분류 기록 번호와 고칠 분류 코드를 적으십시오.'); return; }
    void a.run('correct', () => api('/admin/classify/correct', {
      method: 'POST', body: JSON.stringify({ logId, toCode: c.toCode.trim().toUpperCase(), reason: c.reason.trim() || undefined }),
    }), () => setC({ logId: '', toCode: '', reason: '' }));
  };
  const revert = () => {
    if (!since) { a.setErr('되돌릴 시점을 고르십시오.'); return; }
    if (!confirm(`${since} 이후의 학습을 되돌립니다.`)) return;
    void a.run('revert', () => api('/admin/classify/learn/revert', {
      method: 'POST', body: JSON.stringify({ since: new Date(since).toISOString() }),
    }), r.reload);
  };

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data?.items ?? [];
  return (
    <>
      <h2>분류 학습</h2>
      <p className="lead">교정이 쌓이면 어휘집이 늘어납니다.</p>
      {ls.data && <div className="kpi4">
        <div><b className={ls.data.classify.enabled ? 'good' : ''}>{ls.data.classify.enabled ? 'on' : 'off'}</b><span>학습</span></div>
        <div><b>{ls.data.classify.minSignals}</b><span>최소 교정</span></div>
        <div><b>{ls.data.classify.maxWeight}</b><span>점수 상한</span></div>
        <div><b>{ls.data.classify.vocab.toLocaleString('ko-KR')}</b><span>어휘</span></div>
      </div>}
      <p className="card">
        <b>신경망이 아닙니다.</b> 운영 판단을 학습해 정확도가 올라가는 분류 엔진입니다 — 왜 그 분류인지 단어로 설명됩니다.
        한 번 고쳐서는 아무것도 바뀌지 않습니다. 같은 방향으로 3회 이상 쌓여야 반영됩니다.
      </p>
      {r.data?.note && <p className="card warn">{r.data.note}</p>}
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <button className="btn-ok" disabled={a.busy === 'learn'} onClick={() => void learn()}>학습 실행</button>
        {ls.data && <button className="btn-plain" disabled={a.busy === 'toggle'} data-learn-toggle
          onClick={() => void a.run('toggle', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'classify.learn.enabled', value: ls.data!.classify.enabled ? 'off' : 'on' }) }),
            ls.reload, ls.data?.classify.enabled ? '분류 학습을 껐습니다.' : '분류 학습을 켰습니다.')}>
          {ls.data.classify.enabled ? '학습 끄기' : '학습 켜기'}</button>}
      </div>
      <p className="card warn"><b>되돌리기 전에 학습을 먼저 끄십시오.</b> 되돌리는 사이에 또 학습되면 끝이 없습니다.</p>

      <h3 className="sec">학습 이력 <em>{rows.length}</em></h3>
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">아직 학습된 어휘가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>단어</th><th>분류</th><th>점수</th><th>교정 횟수</th><th>일시</th><th>상태</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td><b>{l.term}</b></td><td className="mono">{l.code}</td>
                <td>{l.before == null ? '신규' : l.before} → {l.after}</td>
                <td className="num-cell">{l.signals}</td><td className="muted">{ymdhm(l.appliedAt)}</td>
                <td>{l.revertedAt ? <span className="muted">되돌림</span> : '적용'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">분류 교정</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>분류 기록 번호</span><input value={c.logId} onChange={(e) => setC({ ...c, logId: e.target.value })} placeholder="예) 42" /></label>
          <label><span>사람이 고른 분류 코드</span><input value={c.toCode} onChange={(e) => setC({ ...c, toCode: e.target.value })} placeholder="예) FR" /></label>
          <label><span>왜 고쳤는지</span><input value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'correct'} onClick={correct}>교정 기록</button></div>
        <p className="hint">검수 화면에서 분류를 고치면 여기로 자동 기록됩니다. 이 폼은 기록 번호를 알 때 직접 넣는 자리입니다.</p>
      </div>

      <h3 className="sec">되돌리기</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>이 시각 이후를 되돌림</span><input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} /></label>
        </div>
        <div className="acts"><button className="btn-no" disabled={a.busy === 'revert'} onClick={revert}>되돌리기</button></div>
        <p className="hint"><b>되돌리기 전에 학습을 먼저 끄십시오</b>(<code>classify.learn.enabled</code> = off). 되돌리는 사이에 또 학습되면 끝이 없습니다 — 켜져 있으면 서버가 거절합니다.</p>
      </div>

      <h3 className="sec">안전장치</h3>
      <table className="tbl">
        <thead><tr><th>막는 것</th><th>설정</th><th>왜</th></tr></thead>
        <tbody>
          <tr><td>1~2회 교정</td><td>최소 3회</td><td>한 사람 실수가 전체를 바꿉니다</td></tr>
          <tr><td>한 단어 독주</td><td>상한 9</td><td>다른 단어가 무의미해집니다</td></tr>
          <tr><td>제한업종</td><td>학습 제외</td><td>법이 정한 것입니다 (INV-6)</td></tr>
          <tr><td>폭주</td><td>하루 50건 감시</td><td>일괄 수정이나 오작동</td></tr>
          <tr><td>되돌리기</td><td>이력 보존</td><td>잘못 가도 복구합니다</td></tr>
        </tbody>
      </table>
    </>
  );
}

/* ── SB-ADM-SEG-010 성향 학습 ────────────────────────────────────── */
interface SegC { accountId: string; currentCode?: string; toCode: string; clicksFrom: number; clicksTo: number }
interface SegRes { enabled: boolean; minClicks: number; ratio: number; items: SegC[]; noConsent: number; thrash: number }

interface SegLog { id: string; fromCode: string | null; fromName: string | null; toCode: string; toName: string | null; clicksFrom: number; clicksTo: number; appliedAt: string; revertedAt: string | null }
interface SegPrev {
  enabled: boolean; minClicks: number; ratio: number; moved: number; held: number; noConsent: number;
  items: { member: string; ref: string; currentCode: string | null; currentName: string | null; toCode: string; toName: string | null; clicksFrom: number; clicksTo: number; verdict: string }[];
}

/* SB-ADM-SEG-010 성향 학습 · SB-ADM-SEG-020 옮길 대상 미리보기
 * v10.31 (10/10 시안 기준) — 시안: 지표 4칸 → 안내 → 「옮긴 기록」 표 → 안내 2 → 「안전장치」 표 → 「학습 실행 · 대상 보기」.
 * 「대상 보기」는 학습 실행 전 미리보기(옮김 · 보류 판정 · 이름 첫 글자만 · GET /admin/segments/preview)를 엽니다. */
/* v10.32 — 미리보기에 자기 주소(#/ai-ops/segments-preview)가 생겼습니다. onPreview 가 오면 그 주소로 갑니다 */
export function SegmentLearn({ onPreview }: { onPreview?: () => void } = {}) {
  const r = useApi<SegRes>('/admin/segments/candidates');
  const log = useApi<SegLog[]>('/admin/segments/log');
  const [preview, setPreview] = useState(false);
  const a = useAct();
  const learn = () => {
    if (!confirm('행동으로 세그먼트를 옮깁니다. 진행하시겠습니까?')) return;
    void a.run('learn', () => api<{ applied: number; note: string }>('/admin/segments/learn', { method: 'POST' }), () => { r.reload(); log.reload(); },
      (x) => x?.note ?? `${x?.applied ?? 0}명을 옮겼습니다.`);
  };
  if (preview) return <SegmentPreview onBack={() => setPreview(false)} />;
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const seg = (c: string | null, nm: string | null) => (c ? `${c}${nm ? ` ${nm.split(' ')[0]}` : ''}` : '—');
  return (
    <>
      <h2>성향 학습</h2>
      <p className="lead">행동으로 세그먼트를 고칩니다.</p>
      <div className="kpi4">
        <div><b className={d.enabled ? 'good' : ''}>{d.enabled ? 'on' : 'off'}</b><span>학습</span></div>
        <div><b>{d.minClicks}</b><span>최소 클릭</span></div>
        <div><b>{d.ratio}배</b><span>차이 기준</span></div>
        <div><b className={d.thrash ? 'bad' : 'good'}>{d.thrash}</b><span>왔다갔다</span></div>
      </div>
      {d.noConsent > 0 && <p className="card warn"><b>동의 없이 바뀐 건 {d.noConsent}건</b> — 0 이어야 합니다. 즉시 확인하십시오.</p>}
      <div className="ad-nt info"><b>질문은 가입할 때 한 번 답한 것입니다.</b> 사업은 바뀌므로 행동이 더 최근 사실입니다.</div>
      <Flash msg={a.msg} err={a.err} />

      <h3 className="ad-s2">옮긴 기록 <em>{(log.data ?? []).length}</em></h3>
      <div className="ad-tw"><table className="tbl" data-seg-log>
        <thead><tr><th>전</th><th>후</th><th className="num-cell">원래 클릭</th><th className="num-cell">새 클릭</th><th>일시</th></tr></thead>
        <tbody>
          {(log.data ?? []).length === 0 && <tr><td colSpan={5} className="muted">아직 옮긴 회원이 없습니다.</td></tr>}
          {(log.data ?? []).map((x) => (
            <tr key={x.id}><td>{seg(x.fromCode, x.fromName)}</td><td><b>{seg(x.toCode, x.toName)}</b></td>
              <td className="num-cell">{x.clicksFrom}</td><td className="num-cell">{x.clicksTo}</td>
              <td>{ymdhm(x.appliedAt)}{x.revertedAt && <span className="ad-bg" style={{ marginLeft: 6 }}>되돌림</span>}</td></tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt warn"><b>소재 하나가 여러 세그먼트를 겨냥하면</b> 그런 클릭은 어느 쪽이 끌었는지 몰라 신호로 쓰지 않습니다 — 애매하면 안 옮깁니다.</div>
      <div className="ad-nt info"><b>개인정보를 늘리지 않았습니다.</b> 이미 있는 광고 집계만 씁니다. 광고주는 여전히 집계만 받습니다.</div>

      <h3 className="ad-s2">안전장치</h3>
      <div className="ad-tw"><table className="tbl" data-seg-safety>
        <thead><tr><th>막는 것</th><th>왜</th></tr></thead>
        <tbody>
          <tr><td><b>동의 안 한 회원</b></td><td>성향 자체를 쓰지 않습니다 — 지금 동의 없이 바뀐 건 {d.noConsent}건</td></tr>
          <tr><td><b>1~{Math.max(d.minClicks - 1, 1)}회 클릭</b></td><td>지나가다 누른 것일 수 있습니다(최소 {d.minClicks}회)</td></tr>
          <tr><td><b>왔다갔다</b></td><td>기준이 느슨한 것입니다 — 지금 {d.thrash}건</td></tr>
          <tr><td><b>출처 표시</b></td><td>BEHAVIOR — 질문이 아닌 행동으로 바뀜</td></tr>
        </tbody>
      </table></div>
      <div className="ad-dact">
        <button className="btn-ok" disabled={a.busy === 'learn' || !d.enabled} onClick={learn}>학습 실행</button>
        <button className="btn-plain" onClick={() => (onPreview ? onPreview() : setPreview(true))} data-seg-preview>대상 보기</button>
        {!d.enabled && <span className="muted">학습이 꺼져 있습니다 (segment.learn.enabled)</span>}
      </div>
    </>
  );
}

/* SB-ADM-SEG-020 옮길 대상 미리보기 — 시안 「옮김 · 보류 · 동의 안 함 제외 · 최소 클릭」 4칸 + 회원별 판정 표 */
/* v10.32 — bare: 자기 주소(#/ai-ops/segments-preview)로 열 때는 제목 · 설명을 위 제목 줄(SUB_PAGE)이 그립니다 */
export function SegmentPreview({ onBack, bare }: { onBack: () => void; bare?: boolean }) {
  const r = useApi<SegPrev>('/admin/segments/preview');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const why = (v: string) => (v === 'MOVE' ? '옮김' : v === 'HOLD_CLICKS' ? `보류 — 클릭 ${d.minClicks}회 미만` : `보류 — 차이 ${d.ratio}배 미만`);
  return (
    <section data-seg-preview-view>
      {!bare && <>
        <h2>옮길 대상 미리보기 <span className="ad-sid">SB-ADM-SEG-020</span></h2>
        <p className="lead">학습을 실행하면 옮겨질 회원입니다. 실행 전에 확인합니다.</p>
      </>}
      <div className="kpi4">
        <div><b>{d.moved}</b><span>옮김</span></div>
        <div><b>{d.held}</b><span>보류</span></div>
        <div><b className="good">{d.noConsent}</b><span>동의 안 함 제외</span></div>
        <div><b>{d.minClicks}</b><span>최소 클릭</span></div>
      </div>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>회원</th><th>지금</th><th>옮길 곳</th><th className="num-cell">원래 쪽 클릭</th><th className="num-cell">새 쪽 클릭</th><th>판정</th></tr></thead>
        <tbody>
          {d.items.length === 0 && <tr><td colSpan={6} className="muted">옮길 대상도 보류도 없습니다 — 동의한 회원 중 다른 세그먼트를 누른 행동이 없습니다.</td></tr>}
          {d.items.map((x) => (
            <tr key={x.ref} data-verdict={x.verdict}>
              <td>{x.member}</td><td>{x.currentCode ?? '—'} {x.currentName?.split(' ')[0]}</td><td>{x.toCode} {x.toName?.split(' ')[0]}</td>
              <td className="num-cell">{x.clicksFrom}</td><td className="num-cell">{x.clicksTo}</td>
              <td><span className={`ad-bg ${x.verdict === 'MOVE' ? 'ok' : 'wait'}`}>{why(x.verdict)}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt info"><b>이름은 첫 글자만 보입니다.</b> 광고주는 이 목록을 받지 않습니다 — 여전히 집계만 받습니다.</div>
      <div className="ad-nt warn"><b>여러 세그먼트를 겨냥한 소재의 클릭은 세지 않습니다.</b> 어느 쪽이 끌었는지 몰라 신호로 쓰지 않습니다.</div>
      <div className="ad-dact"><button className="btn-plain" onClick={onBack}>← 성향 학습</button></div>
    </section>
  );
}

/* ── SB-ADM-RSK-020 위험감지 학습 ────────────────────────────────── */
interface Exempt {
  id: string; rule: string; ruleName: string | null; subject: string; reason: string;
  signals: number | null; createdAt: string; expiresAt: string | null; expired: boolean;
}

export function RiskLearn() {
  const r = useApi<{ items: Exempt[]; note: string | null }>('/admin/risk/exemptions');
  const ls = useApi<LearnSet>('/admin/ai/learn-settings');
  const [f, setF] = useState({ ruleCode: 'RSK-06', subject: '', reason: '', days: '90' });
  const a = useAct();

  const learn = () => a.run('learn', () => api('/admin/risk/learn', { method: 'POST' }), r.reload);
  const add = () => {
    if (f.subject.trim().length < 2) { a.setErr('무엇을 예외로 둘지 적으십시오 (예: acct:U-4471).'); return; }
    if (f.reason.trim().length < 5) { a.setErr('왜 정상인지 다섯 자 이상 적으십시오.'); return; }
    void a.run('add', () => api('/admin/risk/exemptions', {
      method: 'POST', body: JSON.stringify({ ruleCode: f.ruleCode.trim().toUpperCase(), subject: f.subject.trim(), reason: f.reason.trim(), days: Number(f.days) || undefined }),
    }), () => { setF({ ...f, subject: '', reason: '' }); r.reload(); });
  };
  const revoke = (x: Exempt) => {
    if (!confirm(`${x.rule} · ${x.subject} 예외를 해제합니다. 다음부터 다시 경보가 뜹니다.`)) return;
    void a.run(x.id, () => api(`/admin/risk/exemptions/${x.id}`, { method: 'DELETE' }), r.reload);
  };

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data?.items ?? [];
  const live = rows.filter((x) => !x.expired);
  return (
    <>
      <h2>위험감지 학습</h2>
      <p className="lead">오탐을 예외로 둡니다.</p>
      {ls.data && <div className="kpi4">
        <div><b className={ls.data.risk.enabled ? 'good' : ''}>{ls.data.risk.enabled ? 'on' : 'off'}</b><span>학습</span></div>
        <div><b>{ls.data.risk.minSignals}</b><span>최소 신호</span></div>
        <div><b>{ls.data.risk.expireDays}일</b><span>예외 기한</span></div>
        <div><b className={ls.data.risk.lawExempted ? 'bad' : 'good'}>{ls.data.risk.lawExempted}</b><span>법 규칙 예외</span></div>
      </div>}
      <p className="card"><b>같은 것이 내일 또 뜨면</b> 사람이 경보를 안 보게 되고, 진짜 위험이 묻힙니다. 정상으로 3회 닫으면 예외로 둡니다.</p>
      <p className="card warn">
        <b>법이 정한 규칙은 예외를 둘 수 없습니다.</b> RSK-05 제한업종(대부업법 · 방문판매법) · RSK-07 광고 규제(의료법 27조) —
        운영이 &ldquo;정상&rdquo;이라고 해도 열 수 없습니다(서버가 거절).
      </p>
      {r.data?.note && <p className="card warn">{r.data.note}</p>}
      <Flash msg={a.msg} err={a.err} />
      <div className="acts"><button className="btn-ok" disabled={a.busy === 'learn'} onClick={() => void learn()}>학습 실행</button></div>

      <h3 className="sec">예외 목록 <em>{live.length}</em></h3>
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">둔 예외가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>규칙</th><th>대상</th><th>사유</th><th>기한</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className={x.expired ? 'off' : ''}>
                <td className="mono">{x.rule}{x.ruleName && <span className="dim"> {x.ruleName}</span>}</td>
                <td className="mono">{x.subject}</td><td>{x.reason}</td>
                <td className="muted">{x.expiresAt ? ymd(x.expiresAt) : '—'}{x.expired && ' (만료)'}</td>
                <td>{!x.expired && <button className="btn-no" disabled={a.busy === x.id} onClick={() => revoke(x)}>예외 해제</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {live.length > 20 && <p className="card warn"><b>예외가 20건 넘으면 규칙이 잘못된 것입니다.</b> 예외를 늘리지 말고 규칙의 조건을 고치십시오.</p>}

      <h3 className="sec">예외 추가</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>규칙</span><input value={f.ruleCode} onChange={(e) => setF({ ...f, ruleCode: e.target.value })} placeholder="RSK-06" /></label>
          <label><span>대상</span><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="acct:U-4471" /></label>
          <label><span>기한(일)</span><input type="number" min={1} max={3650} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>왜 정상인지 (다섯 자 이상)</span><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'add'} onClick={add}>예외 추가</button></div>
        <p className="hint"><b>기한을 반드시 두십시오.</b> 영구 예외는 시간이 지나면 왜 뒀는지 아무도 모르고, 그 사이 진짜 위험이 통과합니다.</p>
      </div>
    </>
  );
}
