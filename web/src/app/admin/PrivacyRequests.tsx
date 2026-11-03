import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Req {
  id: string; kind: string; status: string; dueOn: string; daysLeft: number; extendReason: string | null; resultNote: string | null;
  handledAt: string | null; createdAt: string; body: string | null; accountId: string; accountName: string | null; accountEmail: string; handledByName: string | null;
}
interface Data { items: Req[]; open: number; overdue: number; soon: number; kinds: Record<string, string>; statusLabels: Record<string, string> }

/**
 * SB-ADM-PRQ-010 개인정보 권리 요청 처리 (v10.181 · D170 · docs/283 · ADMIN · SUPER)
 *
 * 회원의 열람 · 정정 · 삭제 · 처리정지 요청. 열린 요청은 기한 가까운 순. 「처리 완료」 · 「거절」은 결과를 남기고 끝(고칠 수 없음) ·
 * 「연장」은 한 번(사유). 결과는 회원에게 알림. 기한 2일 안이면 하루 요약 때 운영 알림 PRIVACY_REQUEST_DUE.
 */
export function PrivacyRequests() {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const q = useApi<Data>(`/admin/privacy-requests?status=${status}`);
  const a = useAct();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const decide = (r: Req, action: 'DONE' | 'REJECT' | 'EXTEND') => {
    const note = (notes[r.id] ?? '').trim();
    if (note.length < 5) { a.setErr(action === 'EXTEND' ? '연장 사유를 5자 이상 적어 주십시오.' : '처리 결과를 5자 이상 적어 주십시오 — 회원에게 그대로 알림으로 갑니다.'); return; }
    const what = action === 'DONE' ? '처리 완료' : action === 'REJECT' ? '거절' : '기한 연장(한 번)';
    if (!confirm(`${d.kinds[r.kind] ?? r.kind} 요청을 「${what}」로 남깁니다.${action === 'EXTEND' ? '' : ' 끝난 요청은 고칠 수 없습니다.'}`)) return;
    void a.run(`d-${r.id}`, () => api(`/admin/privacy-requests/${r.id}/decide`, { method: 'POST', body: JSON.stringify({ action, note }) }),
      () => { setNotes((m) => ({ ...m, [r.id]: '' })); q.reload(); }, `${what}로 남겼습니다.`);
  };
  return (
    <section data-privacy-requests="">
      <Flash msg={a.msg} err={a.err} />
      <p className="muted" data-privacy-summary="">
        처리 중 <b>{d.open}</b>건 · 기한 2일 안 <b className={d.soon ? 'warn-text' : ''}>{d.soon}</b>건 · 기한 넘김 <b className={d.overdue ? 'warn-text' : ''}>{d.overdue}</b>건
        {' · '}
        {(['open', 'closed', 'all'] as const).map((s) => (
          <button key={s} className={status === s ? 'btn-ok' : 'btn'} onClick={() => setStatus(s)} data-privacy-filter={s}>
            {s === 'open' ? '처리 중' : s === 'closed' ? '끝난 것' : '모두'}
          </button>
        ))}
      </p>
      {d.items.length === 0 ? <p className="muted">요청이 없습니다.</p> : (
        <table className="tbl" data-privacy-rows="">
          <thead><tr><th>받은 때</th><th>회원</th><th>종류</th><th>내용</th><th>기한</th><th>상태 · 처리</th></tr></thead>
          <tbody>{d.items.map((r) => {
            const open = r.status === 'OPEN' || r.status === 'EXTENDED';
            return (
              <tr key={r.id} data-privacy-id={r.id} data-privacy-status={r.status}>
                <td className="muted">{ymdhm(r.createdAt)}</td>
                <td>{r.accountName ?? '—'} <small className="dim">{r.accountEmail}</small></td>
                <td>{d.kinds[r.kind] ?? r.kind}</td>
                <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{r.body ?? <span className="dim">(파기됨)</span>}</td>
                <td>{r.dueOn}{open && <><br /><b className={r.daysLeft < 0 ? 'warn-text' : r.daysLeft <= 2 ? 'warn-text' : 'muted'}>
                  {r.daysLeft < 0 ? `${-r.daysLeft}일 넘김` : r.daysLeft === 0 ? '오늘까지' : `${r.daysLeft}일 남음`}</b></>}</td>
                <td>
                  <b>{d.statusLabels[r.status] ?? r.status}</b>
                  {r.extendReason && <div className="muted">연장 사유: {r.extendReason}</div>}
                  {r.resultNote && <div className="muted">{r.handledByName ?? '—'} · {ymdhm(r.handledAt)} · {r.resultNote}</div>}
                  {open && (
                    <div data-privacy-form="">
                      <input name={`privacy-note-${r.id}`} value={notes[r.id] ?? ''} maxLength={1000} style={{ width: '100%' }}
                        onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                        placeholder="처리 결과 또는 연장 사유(5자 이상 · 회원에게 알림)" />
                      <button className="btn-ok" disabled={a.busy === `d-${r.id}`} onClick={() => decide(r, 'DONE')} data-privacy-done="">처리 완료</button>{' '}
                      <button className="btn" disabled={a.busy === `d-${r.id}`} onClick={() => decide(r, 'REJECT')} data-privacy-reject="">거절</button>{' '}
                      {r.status === 'OPEN' && <button className="btn" disabled={a.busy === `d-${r.id}`} onClick={() => decide(r, 'EXTEND')} data-privacy-extend="">기한 연장</button>}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      <div className="ad-nt info">본인 확인 뒤 처리하십시오(회원 상세에서 계정 확인). 처리 기한 · 연장 · 거절 사유의 법 기준은 최신 법령 확인이 필요합니다(docs/283).</div>
    </section>
  );
}
