import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

/* ── SB-ADM-DIC-010 검색 사전 ────────────────────────────────────── */
interface Syn { id: string; term: string; canonical: string; kind: string; weight: number; createdAt: string }

interface Intent { term: string; field: string; operator: string; value: string | null; note: string }

interface TermStat { term: string; hits: number; zeroHits: number; hidden?: boolean }

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
  /* v10.83 (D111) — 추천 검색어(검색 팝업 · 관 화면)에서 숨기기 · 다시 보이기. 통계는 지우지 않음 */
  const hideTerm = (t: TermStat, hidden: boolean) => {
    void a.run('t:' + t.term, () => api('/admin/search/terms/hide', {
      method: 'POST', body: JSON.stringify({ term: t.term, hidden }),
    }), r.reload);
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
        동의어 · 오타 교정은 <b>실제 검색 결과</b>(통합 검색 · 관 목록 · 소개광장 · 소개몰)에 쓰입니다 — 검색한 말 「또는」 바뀐 말이 든 것을 찾습니다(v10.83).
        관(분류 「관」)은 넓히지 않습니다.
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

      <h3 className="sec">많이 찾은 말 · 추천 검색어 <em>{d.top.length}</em></h3>
      <p className="hint">검색 팝업 · 관 화면의 추천 검색어는 여기서 나옵니다(결과가 나온 말 · 제한업종 제외). 시험 꼬리표 같은 말은 「숨기기」 — 통계는 그대로 쌓입니다.</p>
      {d.top.length === 0 ? <p className="muted">아직 쌓인 검색어가 없습니다.</p> : (
        <table className="tbl" data-search-top="">
          <thead><tr><th>검색어</th><th>검색</th><th>0건</th><th>추천</th><th></th></tr></thead>
          <tbody>{d.top.slice(0, 50).map((t) => (
            <tr key={t.term}>
              <td>{t.term}</td><td className="num-cell">{t.hits}</td><td className="num-cell">{t.zeroHits}</td>
              <td>{t.hidden ? <span className="muted">숨김</span> : '보임'}</td>
              <td>{t.hidden
                ? <button className="btn-sm" disabled={a.busy === 't:' + t.term} onClick={() => hideTerm(t, false)}>다시 보이기</button>
                : <button className="btn-no" disabled={a.busy === 't:' + t.term} onClick={() => hideTerm(t, true)}>숨기기</button>}</td>
            </tr>
          ))}</tbody>
        </table>
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
