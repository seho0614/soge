import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';

interface E {
  id: string; code: string; title: string; summary?: string; benefit: string;
  status: string; joinType: string; maxJoins?: number;
  startsAt: string; endsAt: string; joins: number; ungranted: number;
}
interface U {
  id: string; eventCode: string; title: string; name: string; email: string;
  benefit: string; joinedAt: string; waitingDays: number;
}

const ST: Record<string, string> = {
  DRAFT: '초안', PUBLISHED: '진행 중', ENDED: '종료', CANCELED: '취소',
};

/**
 * SB-ADM-EVT-010 이벤트 관리
 *
 * ── 지급 대기를 먼저 보여 줍니다 ────────────────────────────────────
 * 이벤트를 여는 것보다 **약속한 것을 주는 일**이 중합니다.
 * 방치되면 다음 이벤트에 아무도 참여하지 않습니다.
 */
export function Events() {
  const { data, error, reload } = useApi<E[]>('/admin/events');
  const { data: ung, reload: reloadU } = useApi<U[]>('/admin/events/ungranted');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  if (error) return <ErrorView error={error} />;
  if (!data) return <p className="dim">불러오는 중…</p>;

  async function setStatus(code: string, status: string) {
    /* v10.26 (G-178) — 공용 함수 api() 로 보냅니다. 전에는 fetch 로 바로 보내 로그인 토큰(Authorization)이 빠졌고, 서버가 403 으로 거절해 눌러도 처리되지 않았습니다 */
    try {
      await api(`/admin/events/${code}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    } catch (e) {
      setMsg(e instanceof ApiFailure ? e.body.message : '바꾸지 못했습니다.');
      return;
    }
    setMsg(null); reload();
  }

  async function grant(id: string) {
    if (note.trim().length < 2) { setMsg('무엇을 어떻게 드렸는지 적어 주십시오.'); return; }
    try {
      await api(`/admin/event-joins/${id}/grant`, { method: 'PATCH', body: JSON.stringify({ note: note.trim() }) });
    } catch { setMsg('처리하지 못했습니다.'); return; }
    setOpen(null); setNote(''); setMsg(null); reloadU(); reload();
  }

  const old = (ung ?? []).filter((u) => u.waitingDays > 7);

  return (
    <div>
      {old.length > 0 && (
        <div className="notice warn">
          <b>7일 넘게 못 드린 참여가 {old.length}건 있습니다.</b>
          약속한 것을 안 주면 다음 이벤트에 아무도 참여하지 않습니다.
        </div>
      )}

      <h3>지급 대기 {(ung ?? []).length}건</h3>
      {(ung ?? []).length === 0 ? (
        <p className="dim">지급할 것이 없습니다.</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr><th>이벤트</th><th>참여자</th><th>드릴 것</th><th>대기</th><th>처리</th></tr>
          </thead>
          <tbody>
            {(ung ?? []).map((u) => (
              <>
                <tr key={u.id}>
                  <td>{u.title}</td>
                  <td>{u.name}<span className="dim"> {u.email}</span></td>
                  <td>{u.benefit}</td>
                  <td>
                    {u.waitingDays > 7
                      ? <b style={{ color: 'var(--sgb-rd-text)' }}>{u.waitingDays}일</b>
                      : <span className="dim">{u.waitingDays}일</span>}
                  </td>
                  <td>
                    <button className="btn-sm"
                      onClick={() => { setOpen(open === u.id ? null : u.id); setNote(''); }}>
                      {open === u.id ? '닫기' : '지급'}
                    </button>
                  </td>
                </tr>
                {open === u.id && (
                  <tr key={u.id + '-f'}>
                    <td colSpan={5} style={{ background: '#FAFBFD' }}>
                      <input value={note} maxLength={200}
                        placeholder="무엇을 어떻게 드렸는지 적어 주십시오. 참여자에게 전달됩니다."
                        onChange={(e) => setNote(e.target.value)}
                        style={{ width: '70%', padding: 8, borderRadius: 7 }} />
                      <button className="btn-primary" style={{ marginLeft: 7 }}
                        onClick={() => void grant(u.id)}>지급 처리</button>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 26 }}>이벤트 {data.length}건</h3>
      <table className="tbl">
        <thead>
          <tr><th>이벤트</th><th>혜택</th><th>기간</th><th>참여</th><th>상태</th><th></th></tr>
        </thead>
        <tbody>
          {data.map((e) => (
            <tr key={e.id}>
              <td><b>{e.title}</b><span className="dim"> {e.code}</span></td>
              <td>{e.benefit}</td>
              <td className="dim">{e.startsAt?.slice(5, 10)} ~ {e.endsAt?.slice(5, 10)}</td>
              <td>
                {e.joins}{e.maxJoins ? ` / ${e.maxJoins}` : ''}
                {e.ungranted > 0 && <b style={{ color: 'var(--sgb-rd-text)' }}> · 미지급 {e.ungranted}</b>}
              </td>
              <td><span className={`badge ${e.status === 'PUBLISHED' ? '' : 'badge-urgent'}`}>
                {ST[e.status] ?? e.status}</span></td>
              <td>
                {e.status === 'DRAFT' && (
                  <button className="btn-sm" onClick={() => void setStatus(e.code, 'PUBLISHED')}>
                    발행
                  </button>
                )}
                {e.status === 'PUBLISHED' && (
                  <button className="btn-sm" onClick={() => void setStatus(e.code, 'ENDED')}>
                    중단
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {msg && <p className="dim" style={{ color: 'var(--sgb-rd-text)' }}>{msg}</p>}

      <div className="notice">
        <b>끝난 이벤트는 다시 열 수 없습니다.</b>
        기간을 늘리시려면 새 이벤트를 만드십시오 —
        끝났다고 알린 분들에게 할 말이 없어집니다.
      </div>
    </div>
  );
}
