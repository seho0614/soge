import { useState, type ReactNode } from 'react';
import { api, tokenRoles } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { RcmGraph, type GNode } from './RcmGraph';
import { SettlementSummary } from '../SettlementSummary';

interface Member { id: string; name: string; email: string | null; code: string | null; status: string; joinedAt: string; directCount: number; recommender: string | null }
interface TNode { k: number; p: number; gen: number; id: string; name: string; code: string | null; status: string; verified: boolean; joined: string; children: number }
interface Detail {
  member: { id: string; name: string; email: string | null; code: string | null; status: string; joinedAt: string; verified: boolean };
  recommenders: Array<{ id: string; name: string; code: string | null; gen: number }>;
  rewarded: boolean;
  changes: Array<{ at: string; old: string | null; new: string | null; reason: string }>;
  total: number; truncated: boolean; generations: Array<{ gen: number; count: number }>; nodes: TNode[];
}
interface Rule { isActive: boolean; points: number; monthlyCap: number | null; given: number; givenPoints: number }

/* ── SB-AFF-RCM-010 추천 관계도 · v10.218 (D189 · docs/351) ─────────────────────
 *   회원 찾기(코드 · 이메일 · 이름) → 위로 추천인 줄 · 아래 전체 트리(접고 펴기) · 추천인 고치기(ADMIN · 사유 · 기록)
 *   추천 보상 규칙(직접 추천 1단계만 · 가입한 분 첫 본인인증 때 한 번) — 바꾸기는 SUPER.
 *   계층 용어(하위 · 산하 · 직급)를 쓰지 않습니다. */
export function Recommend() {
  const roles = tokenRoles();
  const canEdit = roles.includes('ADMIN') || roles.includes('SUPER');
  const isSuper = roles.includes('SUPER');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useApi<Member[]>(`/admin/affiliates/recommend${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const [sel, setSel] = useState<string | null>(null);
  const rule = useApi<Rule>('/admin/affiliates/recommend-reward');
  const [rf, setRf] = useState<{ on: boolean; points: string; cap: string } | null>(null);
  const a = useAct();

  const saveRule = () => {
    if (!rf) return;
    void a.run('rule', () => api('/admin/affiliates/recommend-reward', {
      method: 'PUT', body: JSON.stringify({ isActive: rf.on, points: Number(rf.points), monthlyCap: rf.cap.trim() ? Number(rf.cap) : null }),
    }), () => { setRf(null); rule.reload(); });
  };

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const r = rule.data;
  return (
    <div data-screen="SB-AFF-RCM-010">
      <h2>추천 관계도</h2>
      <p className="card"><b>추천 보상은 직접 추천 1단계만입니다.</b> 추천인의 추천인에게는 아무것도 주지 않습니다(DB 가 막음). 파트너센터에는 이름 첫 글자 · 가입일만 보입니다.</p>
      <Flash msg={a.msg} err={a.err} />

      {r && (
        <div className="card pad" data-rcm-rule="">
          <b>추천 보상</b> {r.isActive ? <span className="st ok">켜짐</span> : <span className="st">꺼짐</span>}{' '}
          {r.points.toLocaleString('ko-KR')}점 · 한 달 상한 {r.monthlyCap ?? '없음'} · 지금까지 {n(r.given)}번 {n(r.givenPoints)}점
          <div className="hint">가입한 분이 처음 본인인증을 마칠 때 그분을 직접 추천한 한 사람에게 한 번 줍니다. 꺼져 있을 때 인증한 분은 나중에 켜도 주지 않습니다.</div>
          {isSuper && !rf && <button className="btn-sm" onClick={() => setRf({ on: r.isActive, points: String(r.points), cap: r.monthlyCap == null ? '' : String(r.monthlyCap) })}>바꾸기 (SUPER)</button>}
          {isSuper && rf && (
            <div className="form-grid" style={{ marginTop: 8 }}>
              <label><span>켜기</span><input type="checkbox" checked={rf.on} onChange={(e) => setRf({ ...rf, on: e.target.checked })} /></label>
              <label><span>점수</span><input type="number" min={1} max={100000} value={rf.points} onChange={(e) => setRf({ ...rf, points: e.target.value })} /></label>
              <label><span>한 달 상한(비우면 없음)</span><input type="number" min={1} max={1000} value={rf.cap} onChange={(e) => setRf({ ...rf, cap: e.target.value })} /></label>
              <div className="acts"><button className="btn-ok" disabled={a.busy === 'rule'} onClick={saveRule}>저장</button> <button className="btn-plain" onClick={() => setRf(null)}>그만두기</button></div>
            </div>
          )}
        </div>
      )}

      <div className="search-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="추천 코드 · 이메일 · 이름" aria-label="회원 찾기"
               onKeyDown={(e) => { if (e.key === 'Enter') setQuery(q.trim()); }} style={{ maxWidth: 280 }} />
        <button className="btn-plain" onClick={() => setQuery(q.trim())}>찾기</button>
        {query && <button className="btn-plain" onClick={() => { setQ(''); setQuery(''); }}>추천 많은 순</button>}
      </div>
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && list.data.length === 0 && <p className="muted">{query ? '찾는 회원이 없습니다.' : '아직 추천으로 가입한 회원이 없습니다.'}</p>}
      {list.data && list.data.length > 0 && (
        <table className="tbl" data-rcm-list="">
          <thead><tr><th>이름</th><th>이메일</th><th>추천 코드</th><th>가입</th><th>직접 추천</th><th>추천인</th><th /></tr></thead>
          <tbody>
            {list.data.map((m) => (
              <tr key={m.id} className={m.id === sel ? 'on' : undefined}>
                <td>{m.name}</td><td className="dim">{m.email}</td><td className="mono">{m.code}</td><td>{m.joinedAt}</td>
                <td className="num-cell">{n(m.directCount)}</td><td>{m.recommender ?? '—'}</td>
                <td><button className="btn-sm" onClick={() => setSel(m.id)}>관계도</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && <RecommendDetail key={sel} id={sel} canEdit={canEdit} onPick={setSel} onChanged={list.reload} />}
    </div>
  );
}

/** 한 회원 — 위로 추천인 줄 · 아래 전체 트리(v10.254 그림 ↔ 목록) · 고른 회원 · 정산 내역(v10.255 · ADMIN) · 추천인 고치기 · 변경 기록 */
export function RecommendDetail({ id, canEdit, onPick, onChanged }: { id: string; canEdit: boolean; onPick: (id: string) => void; onChanged: () => void }) {
  const d = useApi<Detail>(`/admin/affiliates/recommend/${id}`);
  const [fix, setFix] = useState({ code: '', reason: '' });
  const [picked, setPicked] = useState<GNode | null>(null);
  const [money, setMoney] = useState<{ id: string; name: string } | null>(null);
  const a = useAct();
  const saveFix = () => {
    if (fix.reason.trim().length < 2) { a.setErr('사유를 2자 이상 적으십시오.'); return; }
    void a.run('fix', () => api(`/admin/affiliates/recommend/${id}`, {
      method: 'PATCH', body: JSON.stringify({ recommendCode: fix.code.trim() || null, reason: fix.reason.trim() }),
    }), () => { setFix({ code: '', reason: '' }); d.reload(); onChanged(); });
  };
  const listLabel = (x: TNode) => <>
    <button className="btn-plain btn-sm" onClick={() => onPick(x.id)} data-rcm-node={x.id}>{x.name}</button>{' '}
    <span className="mono dim">{x.code}</span> <span className="dim">{x.joined} 가입</span>{' '}
    {x.verified ? <span className="st ok">본인인증</span> : <span className="st">인증 전</span>}
    {x.status !== 'ACTIVE' && <> <span className="st warn">{x.status}</span></>}
  </>;

  if (d.error) return <ErrorView error={d.error} onRetry={d.reload} />;
  return (
    <>
      <Flash msg={a.msg} err={a.err} />
      {d.data && (
        <div className="card pad" data-rcm-detail={d.data.member.id}>
          <h3 className="sec">{d.data.member.name} <span className="mono dim">{d.data.member.code}</span></h3>
          <p data-rcm-up="">추천인 줄: {d.data.recommenders.length
            ? d.data.recommenders.slice().reverse().map((u) => <span key={u.id}><button className="btn-plain btn-sm" onClick={() => onPick(u.id)}>{u.name}</button> → </span>)
            : '없음 · '}<b>{d.data.member.name}</b></p>
          <p>모두 {n(d.data.total)}명 {d.data.generations.map((g) => <span key={g.gen} className="st">{g.gen === 1 ? `직접 추천 ${g.count}명` : `${g.gen}번째 ${g.count}명`}</span>)}</p>
          {d.data.truncated && <p className="hint">사람이 많아 처음 3,000명까지만 보입니다.</p>}
          {canEdit && <p><button className="btn-sm ghost" onClick={() => setMoney(money?.id === d.data!.member.id ? null : { id: d.data!.member.id, name: d.data!.member.name })} data-rcm-money={d.data.member.id}>
            {money?.id === d.data.member.id ? '정산 내역 닫기' : `${d.data.member.name} 정산 내역`}</button></p>}
          {d.data.total > 0 && <RcmGraph rootName={d.data.member.name} nodes={d.data.nodes} onSelect={setPicked} listLabel={listLabel as (n: GNode) => ReactNode} />}
          {picked && (
            <div className="card pad" data-rcm-picked={picked.id}>
              <b>{picked.name}</b> <span className="mono dim">{picked.code}</span> · {picked.joined} 가입 · {picked.verified ? '본인인증' : '인증 전'}{picked.status !== 'ACTIVE' ? ` · ${picked.status}` : ''}
              {' '}<button className="btn-sm" onClick={() => onPick(picked.id)} data-rcm-goto={picked.id}>이 회원 관계도</button>
              {canEdit && <>{' '}<button className="btn-sm ghost" onClick={() => setMoney({ id: picked.id, name: picked.name })} data-rcm-money={picked.id}>정산 내역</button></>}
            </div>
          )}
          {money && <SettlementSummary key={money.id} id={money.id} name={money.name} />}

          {canEdit && (
            <>
              <h3 className="sec">추천인 고치기</h3>
              {d.data.rewarded
                ? <p className="hint">추천 보상을 준 관계라 추천인을 바꾸거나 지울 수 없습니다.</p>
                : <div className="form-grid">
                    <label><span>새 추천인의 추천 코드(비우면 추천인 지움)</span><input value={fix.code} maxLength={8} onChange={(e) => setFix({ ...fix, code: e.target.value.toUpperCase() })} /></label>
                    <label><span>사유 (필수 · 기록에 남음)</span><input value={fix.reason} maxLength={300} onChange={(e) => setFix({ ...fix, reason: e.target.value })} /></label>
                    <div className="acts"><button className="btn-ok" disabled={a.busy === 'fix'} onClick={saveFix}>저장</button></div>
                  </div>}
            </>
          )}
          {d.data.changes.length > 0 && (
            <table className="tbl" data-rcm-changes="">
              <thead><tr><th>언제</th><th>전</th><th>후</th><th>사유</th></tr></thead>
              <tbody>{d.data.changes.map((c, i) => <tr key={i}><td>{new Date(c.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}</td><td>{c.old ?? '—'}</td><td>{c.new ?? '—'}</td><td>{c.reason}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
