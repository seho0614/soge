import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';

interface Item { code: string; title: string; content: string; basis: string | null; status: 'CONFIRMED' | 'PENDING'; pendingEffect: string | null; live: boolean }

/**
 * SB-ADM-POL-010 정책 원본 표 (v10.31 — 시안 scAdmPol 「항목 · 내용 · 근거 · 상태」 + 미결 경고).
 * 서버 policy_items. 요금제 · 검수 한계 · 초과 코드 단가처럼 서버에 값이 있는 줄은 서버 값으로 그립니다(「서버 값」 표시).
 */
export function PolicyItems() {
  const r = useApi<Item[]>('/admin/policy-items');
  const [edit, setEdit] = useState<{ code: string; content: string; status: string } | null>(null);
  const [msg, setMsg] = useState<[boolean, string] | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      await api(`/admin/policy-items/${edit.code}`, { method: 'PATCH', body: JSON.stringify({ content: edit.content, status: edit.status }) });
      setMsg([true, '정책 원본을 고쳤습니다.']); setEdit(null); r.reload();
    } catch (e) { setMsg([false, e instanceof ApiFailure ? e.body.message : '고치지 못했습니다.']); }
  };
  if (!r.data) return r.error ? <p className="form-error">정책 원본을 불러오지 못했습니다.</p> : <p className="muted">불러오는 중…</p>;
  const pending = r.data.filter((x) => x.status === 'PENDING');
  return (
    <section data-policy-items>
      {msg && <p className={msg[0] ? 'form-ok' : 'form-error'} role="status">{msg[1]}</p>}
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>항목</th><th>내용</th><th>근거</th><th>상태</th><th /></tr></thead>
        <tbody>{r.data.map((x) => (
          <tr key={x.code} className={x.status === 'PENDING' ? 'hl' : undefined}>
            <td><b>{x.title}</b></td>
            <td>{edit?.code === x.code
              ? <input value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} style={{ width: '100%' }} aria-label={`${x.title} 내용`} />
              : <>{x.content}{x.live && <span className="ad-bg" style={{ marginLeft: 6 }}>서버 값</span>}</>}</td>
            <td className="mono">{x.basis ?? '—'}</td>
            <td>{edit?.code === x.code
              ? <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} aria-label="상태"><option value="CONFIRMED">확정</option><option value="PENDING">미결</option></select>
              : <span className={`ad-bg ${x.status === 'CONFIRMED' ? 'ok' : 'wait'}`}>{x.status === 'CONFIRMED' ? '확정' : '미결'}</span>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{edit?.code === x.code
              ? <><button className="btn-ok btn-sm" onClick={save}>저장</button> <button className="btn-plain btn-sm" onClick={() => setEdit(null)}>취소</button></>
              : <button className="btn-plain btn-sm" disabled={x.live} title={x.live ? '서버 값(요금제 · 설정)에서 바꿉니다' : undefined}
                        onClick={() => setEdit({ code: x.code, content: x.content, status: x.status })}>수정</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {pending.length > 0 && (
        <div className="ad-nt warn"><b>미결 {pending.length}건이 화면을 막고 있습니다.</b> {pending.map((x) => x.pendingEffect).filter(Boolean).join(' ')}</div>
      )}
    </section>
  );
}
