import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ymdKst } from '../../lib/format';

/**
 * v10.211 (D188 · docs/336) — 소개광장 › 「동네픽 후보」 (보기 · 승인 · 거절 ADMIN · SUPER · 지금 고르기 SUPER)
 *
 *   AI 가 매일 06:00 시군구별로 최근 회원 글 · 맛집 글에서 고른 후보 — 승인한 것만 소개광장 맨 위 「동네픽」에 30일 보임.
 *   제목 · 소개는 고쳐서 승인할 수 있음 · 거절은 사유. AI 통로가 닫혀 있으면(스위치 agent.town_pick.enabled · AI 전체 · 월 상한) 새 후보가 생기지 않음.
 */
interface Row {
  id: string; postId: string; source: 'PLAZA' | 'FOOD'; region: string; headline: string; summary: string; engine: string; model: string | null;
  state: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: string; decidedAt: string | null; rejectNote: string | null; board: string; postTitle: string; postState: string;
}
interface Data { state: string; items: Row[]; counts: { pending: number; approved: number; rejected: number }; channel: { ok: boolean; reason: string | null } }
const REASON: Record<string, string> = {
  AGENT_OFF: 'AI 전체 스위치(agent.enabled)가 꺼져 있음', CHANNEL_OFF: '동네픽 스위치(agent.town_pick.enabled)가 꺼져 있음',
  CAP_ZERO: 'AI 월 상한이 0', CAP_REACHED: '이번 달 AI 상한에 닿음',
};
const TABS: [Row['state'], string][] = [['PENDING', '대기'], ['APPROVED', '승인'], ['REJECTED', '거절']];

export function TownPicks() {
  const isSuper = tokenRoles().includes('SUPER');
  const [state, setState] = useState<Row['state']>('PENDING');
  const [edit, setEdit] = useState<Record<string, { headline: string; summary: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useApi<Data>(`/admin/community/town-picks?state=${state}`, [state]);
  const d = q.data;

  async function act(key: string, path: string, body: unknown, done: string) {
    setBusy(key); setMsg(null);
    try { await api(path, { method: 'POST', body: JSON.stringify(body) }); setMsg({ ok: true, text: done }); q.reload?.(); }
    catch (e) { setMsg({ ok: false, text: (e as Error)?.message ?? '처리하지 못했습니다.' }); }
    finally { setBusy(null); }
  }
  const approve = (r: Row) => {
    const e = edit[r.id];
    void act(r.id, `/admin/community/town-picks/${r.id}/approve`, e ? { headline: e.headline, summary: e.summary } : {}, `승인했습니다 — 「${e?.headline ?? r.headline}」`);
  };
  const reject = (r: Row) => {
    const note = window.prompt(`「${r.headline}」을 거절합니다 — 사유(2 ~ 300자)`);
    if (note === null) return;
    void act(r.id, `/admin/community/town-picks/${r.id}/reject`, { note }, '거절했습니다.');
  };
  const run = async () => {
    setBusy('run'); setMsg(null);
    try {
      const r = await api<{ affected: number; detail: Record<string, unknown> }>('/admin/community/town-picks/run', { method: 'POST', body: '{}' });
      setMsg({ ok: true, text: r.detail?.skipped ? `고르지 않음 — ${REASON[String(r.detail.skipped)] ?? String(r.detail.skipped)}` : `새 후보 ${r.affected}개` }); q.reload?.();
    } catch (e) { setMsg({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(null); }
  };

  if (!d) return null;
  return (
    <div data-town-picks style={{ marginTop: 16 }}>
      <h3 className="sec">동네픽 후보 <em>{d.counts.pending}</em>{' '}
        {TABS.map(([k, label]) => <button key={k} className={`btn-sm${k === state ? ' on' : ''}`} onClick={() => setState(k)} aria-pressed={k === state} data-town-pick-tab={k}>{label} {k === 'PENDING' ? d.counts.pending : k === 'APPROVED' ? d.counts.approved : d.counts.rejected}</button>)}
        {isSuper && <>{' '}<button className="btn-sm" disabled={busy === 'run'} onClick={() => void run()} data-town-pick-run>지금 고르기</button></>}
      </h3>
      <p className="hint" data-town-pick-channel={d.channel.ok ? 'on' : 'off'}>
        AI 동네픽 — <b>{d.channel.ok ? '켜짐' : '꺼짐'}</b>{!d.channel.ok && d.channel.reason ? ` (${REASON[d.channel.reason] ?? d.channel.reason})` : ''} · 매일 06:00 시 · 구별로 최근 회원 글 · 맛집 글에서 3개까지 고름 · 승인한 것만 소개광장 맨 위에 30일 보임.
      </p>
      {msg && <p className={msg.ok ? 'form-ok' : 'warn-text'} role="status">{msg.text}</p>}
      {d.items.length === 0 ? <p className="muted">{state === 'PENDING' ? '기다리는 후보가 없습니다.' : '없습니다.'}</p> : (
        <table className="tbl">
          <thead><tr><th>지역</th><th>제목 · 소개</th><th>원글</th><th>만든 날</th><th></th></tr></thead>
          <tbody>{d.items.map((r) => {
            const e = edit[r.id];
            return (
              <tr key={r.id} data-town-pick-row={r.state}>
                <td>{r.region}<br /><span className="muted">{r.source === 'FOOD' ? '맛집' : '소개광장'}{r.engine === 'MOCK' ? ' · 시험 엔진' : ''}</span></td>
                <td>{state === 'PENDING' && e ? (
                  <>
                    <input value={e.headline} maxLength={60} onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, headline: ev.target.value } })} aria-label="제목" style={{ width: '100%' }} />
                    <textarea value={e.summary} maxLength={300} rows={2} onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, summary: ev.target.value } })} aria-label="소개" style={{ width: '100%' }} />
                  </>
                ) : <><b>{r.headline}</b><br />{r.summary}{r.rejectNote ? <><br /><span className="muted">거절 — {r.rejectNote}</span></> : null}</>}</td>
                <td><a href={`/community/${r.postId}`} target="_blank" rel="noreferrer">{r.postTitle}</a>{r.postState !== 'PUBLISHED' && <span className="warn-text"> (공개 아님)</span>}</td>
                <td>{ymdKst(r.createdAt)}</td>
                <td>{state === 'PENDING' && (
                  <span className="row-actions">
                    {!e && <button className="btn-sm" onClick={() => setEdit({ ...edit, [r.id]: { headline: r.headline, summary: r.summary } })} data-town-pick-edit>고치기</button>}
                    <button className="btn-sm" disabled={busy === r.id} onClick={() => approve(r)} data-town-pick-approve>승인</button>
                    <button className="btn-sm" disabled={busy === r.id} onClick={() => reject(r)} data-town-pick-reject>거절</button>
                  </span>)}</td>
              </tr>);
          })}</tbody>
        </table>
      )}
    </div>
  );
}
