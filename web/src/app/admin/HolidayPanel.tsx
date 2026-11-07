import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

/**
 * v10.206 (D183 · docs/330) — 사이트 기본 정보 · 법정 고지(SB-ADM-SIT-070) › 「공휴일」
 *   영업일 계산(문의 「답변 예정」 · 검수 마감)이 주말과 이 날들을 건너뜁니다. 넣기 · 빼기는 SUPER(감사 기록).
 *   맨 위 「운영 값 확인」 — 다음 해 공휴일이 없음 · 파트너 등급 기준 금액 빈칸.
 */
interface Holiday { day: string; name: string }
interface HolidayList { items: Holiday[]; thisYear: number; nextYear: number; nextBusinessDay: string; checks: string[] }

export function HolidayPanel() {
  const r = useApi<HolidayList>('/admin/holidays');
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const sup = tokenRoles().includes('SUPER');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  const d = r.data;

  async function save() {
    try {
      const x = await api<{ day: string; name: string; created: boolean }>('/admin/holidays', { method: 'PUT', body: JSON.stringify({ day, name }) });
      setRes({ ok: true, text: `${x.day} ${x.name} — ${x.created ? '넣었습니다' : '이름을 고쳤습니다'}` });
      setDay(''); setName(''); r.reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '저장하지 못했습니다.' });
    }
  }
  async function remove(h: Holiday) {
    if (!window.confirm(`${h.day} ${h.name} 을 공휴일에서 뺄까요?\n(그날은 영업일로 셉니다)`)) return;
    try {
      await api(`/admin/holidays/${h.day}`, { method: 'DELETE' });
      setRes({ ok: true, text: `${h.day} ${h.name} — 뺐습니다` }); r.reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '빼지 못했습니다.' });
    }
  }

  return (
    <div data-holidays>
      <h3 className="sec">공휴일</h3>
      <p className="hint">문의 「답변 예정」(영업일 1일)과 검수 마감이 주말과 아래 날들을 건너뜁니다. 지금 문의하면 답변 예정 <b data-holiday-next>{d.nextBusinessDay}</b> · 올해 {d.thisYear}일 · 다음 해 {d.nextYear}일.</p>
      {d.checks.length > 0 && (
        <div className="card" data-holiday-checks>
          <b>운영 값 확인</b>
          <ul>{d.checks.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      <table className="tbl">
        <thead><tr><th style={{ width: 140 }}>날짜</th><th>이름</th>{sup && <th style={{ width: 80 }} />}</tr></thead>
        <tbody>
          {d.items.map((h) => (
            <tr key={h.day} data-holiday={h.day}>
              <td>{h.day}</td><td>{h.name}</td>
              {sup && <td><button className="btn-plain" onClick={() => remove(h)} data-holiday-del>빼기</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {sup && (
        <div className="ad-dact">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} data-holiday-day />
          <input value={name} maxLength={40} placeholder="이름(예: 설날)" onChange={(e) => setName(e.target.value)} data-holiday-name />
          <button className="btn-ok" disabled={!day || !name.trim()} onClick={save} data-holiday-save>넣기</button>
        </div>
      )}
      {res && <p className={res.ok ? 'hint' : 'form-error'} data-holiday-res>{res.text}</p>}
    </div>
  );
}
