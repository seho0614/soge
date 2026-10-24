import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import type { LearnSet } from './shared';

/* ── SB-ADM-CLS-020 분류 학습 ────────────────────────────────────── */
interface LearnLog {
  id: number; term: string; code: string; before: number | null; after: number;
  signals: number; appliedAt: string; revertedAt: string | null;
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
