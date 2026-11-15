import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { Flash } from '../../components/Flash';

/**
 * v10.308 (docs/431) — 소개몰 › 「소개몰 정산」 › 「요율 변경 예정」 › 「자동 다시 알림 — 켜면 어떻게 되나」
 *
 *   일수(1 ~ 30 · 처음 7)를 넣으면 지금 예정 예약마다 다시 알림이 언제(매일 00:05 정기 작업) · 몇 곳(공지를 안 펼친 대상 판매자)에 가는지
 *   (GET /admin/health/rate-schedules/auto-remind-preview · 읽기만). 최고 관리자에게는 「이 값으로 켜기」 · 켜져 있으면 「끄기」 —
 *   확인 창 · 사유 뒤 기존 설정 저장 길(PATCH /admin/site-settings · hlt.rate_auto_remind_days · 바뀐 기록 · 중요 설정 알림)을 그대로 씀.
 */
interface Row { id: string; label: string | null; scope: string; effectiveDate: string; targets: number; unread: number; runDate: string | null; skipped: boolean; state: string }
interface Preview { days: number; current: number; nextRun: string; rows: Row[];
  summary: { schedules: number; nextSchedules: number; nextSellers: number; laterSchedules: number } }

const STATE: Record<string, string> = {
  next: '다음 정기 작업에 감', later: '그날 감', done: '자동 다시 알림 이미 보냄', 'no-notice': '공지를 아직 게시하지 않음 — 게시 뒤부터',
  none: '시행 전에 돌 차례가 없음(일수를 늘리십시오)', 'all-read': '대상이 모두 읽음 — 지금은 보낼 곳 없음',
};

export function RateAutoRemindPreview({ onChanged }: { onChanged?: () => void }) {
  const [days, setDays] = useState(7);
  const [ask, setAsk] = useState(7);
  const q = useApi<Preview>(`/admin/health/rate-schedules/auto-remind-preview?days=${ask}`);
  const a = useAct();
  const isSuper = tokenRoles().includes('SUPER');
  const p = q.data;
  const set = (value: number) => {
    const on = value > 0;
    const lines = on
      ? [`요율 공지 자동 다시 알림을 「시행 ${value}일 전」으로 켤까요?`, '',
         p && p.summary.nextSchedules > 0 ? `다음 정기 작업(${p.nextRun})에 예약 ${p.summary.nextSchedules}건 · 판매자 ${p.summary.nextSellers}곳에 다시 알림이 갑니다.` : '지금 바로 나갈 다시 알림은 없습니다.',
         '판매자마다 사이트 안 알림(켜진 길이면 메일 · 문자)이 한 번 갑니다 — 보낸 알림은 되돌릴 수 없습니다.']
      : ['요율 공지 자동 다시 알림을 끌까요?', '', '이미 보낸 알림은 그대로 남습니다. 운영자가 보내는 「다시 알림」 단추는 그대로 씁니다.'];
    if (!window.confirm(lines.join('\n'))) return;
    const reason = window.prompt('바꾸는 사유(운영 알림 「중요 설정 바뀜」에 남음 · 2자 이상)', on ? `요율 공지 자동 다시 알림 시행 ${value}일 전으로 켬` : '요율 공지 자동 다시 알림 끔');
    if (!reason || reason.trim().length < 2) { a.setErr('사유를 2자 이상 적어 주십시오.'); return; }
    void a.run('set', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'hlt.rate_auto_remind_days', value: String(value), reason: reason.trim() }) }),
      () => { q.reload(); onChanged?.(); }, on ? `자동 다시 알림을 시행 ${value}일 전으로 켰습니다.` : '자동 다시 알림을 껐습니다.');
  };
  return (
    <details style={{ margin: '4px 0' }} data-rate-auto-preview={p ? p.current : ''}>
      <summary>자동 다시 알림 — 켜면 어떻게 되나(미리보기)</summary>
      <div className="row-actions" style={{ margin: '6px 0', flexWrap: 'wrap' }}>
        <label>시행 <input className="inp-sm" type="number" min={1} max={30} style={{ width: 64 }} value={days}
                         onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} aria-label="며칠 전" data-rate-auto-days /> 일 전</label>
        <button className="btn-sm" onClick={() => setAsk(days)} data-rate-auto-see>미리보기</button>
        {p && <span className="dim">지금 설정: <b data-rate-auto-current={p.current}>{p.current > 0 ? `시행 ${p.current}일 전` : '꺼짐'}</b> · 다음 정기 작업 {p.nextRun}</span>}
        {isSuper && p && p.days !== p.current && <button className="btn-sm btn-ok" disabled={a.busy === 'set'} onClick={() => set(p.days)} data-rate-auto-on>이 값({p.days}일)으로 켜기</button>}
        {isSuper && p && p.current > 0 && <button className="btn-sm ghost" disabled={a.busy === 'set'} onClick={() => set(0)} data-rate-auto-off>끄기</button>}
      </div>
      <Flash msg={a.msg} err={a.err} />
      {q.error ? <p className="warn-text">미리보기를 불러오지 못했습니다.</p> : !p ? null : p.rows.length === 0 ? (
        <p className="dim" data-rate-auto-empty>예정 예약이 없습니다 — 켜 두어도 지금은 보낼 곳이 없고, 다음 예약부터 시행 {p.days}일 전에 한 번 갑니다.</p>
      ) : (
        <>
          <p data-rate-auto-sum={`${p.summary.nextSchedules}|${p.summary.nextSellers}|${p.summary.laterSchedules}`}>
            시행 {p.days}일 전으로 켜면 — 다음 정기 작업({p.nextRun})에 <b>예약 {p.summary.nextSchedules}건 · 판매자 {p.summary.nextSellers}곳</b> · 그 뒤 날짜에 예약 {p.summary.laterSchedules}건
          </p>
          <table className="tbl">
            <thead><tr><th>대상</th><th>시행일</th><th>대상 판매자</th><th>안 읽음</th><th>다시 알림</th></tr></thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} data-rate-auto-row={r.state}>
                  <td>{r.label ?? '—'}</td>
                  <td className="mono">{r.effectiveDate}</td>
                  <td className="num-cell">{n(r.targets)}곳</td>
                  <td className="num-cell">{n(r.unread)}곳</td>
                  <td>{r.runDate ? <span className="mono">{r.runDate}</span> : null} {STATE[r.state] ?? r.state}{r.skipped ? <span className="dim"> · 운영자가 24시간 안에 다시 알려 하루 미룸</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="dim" style={{ margin: '4px 0 0' }}>예약마다 자동은 한 번 · 공지를 안 펼친 대상 판매자에게만 · 운영자가 24시간 안에 다시 알렸으면 그날은 건너뜀. 읽기만 — 켜기 · 끄기는 최고 관리자.</p>
    </details>
  );
}
