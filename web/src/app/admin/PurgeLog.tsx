import { useApi } from '../../lib/useApi';
import { n } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';

type Counts = { accounts: number; ipMasked: number; leads: number; consultRequests: number; authRecords: number; overdue: number };
interface Run { id: string; startedAt: string; endedAt: string | null; ok: boolean | null; affected: number | null; counts: Counts; error: string | null }
interface Data { days: number; items: Run[]; months: Record<string, Omit<Counts, 'overdue'> & { overdue: number }>; last: string | null; hoursSinceLast: number | null; overdueNow: number }

const COLS: Array<[keyof Counts, string]> = [
  ['accounts', '탈퇴 계정'], ['ipMasked', 'IP 가리기'], ['leads', '리드 연락처'], ['consultRequests', '상담 신청'], ['authRecords', '인증 기록'],
];

/**
 * SB-ADM-PURGE-010 파기 실행 기록 (v10.180 · D169 · docs/281)
 *
 * 매일 03:00 개인정보 파기 작업(pii_purge)이 지운 건수를 날짜별 · 달별로 봅니다(job_runs 그대로 · 건수만 · 개인정보 없음).
 * 작업이 실패하면 운영 알림 PII_PURGE_FAILED, 30시간 넘게 돌지 않으면 PII_PURGE_MISSED(하루 요약 때).
 */
export function PurgeLog() {
  const q = useApi<Data>('/admin/purge-log?days=60');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const late = d.hoursSinceLast === null || d.hoursSinceLast > 30;
  const months = Object.entries(d.months).sort(([a], [b]) => b.localeCompare(a));
  return (
    <section data-purge-log="">
      <p className="muted" data-purge-summary="">
        마지막 실행 {d.last ?? '없음'}{d.hoursSinceLast !== null && ` (${d.hoursSinceLast}시간 전)`}
        {late && <b className="warn-text"> · 30시간 넘게 돌지 않음</b>}
        {' · '}지금 기한 넘긴 건 <b className={d.overdueNow ? 'warn-text' : ''}>{n(d.overdueNow)}</b>
      </p>
      {months.length > 0 && (
        <table className="tbl" data-purge-months="">
          <thead><tr><th>달</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
          <tbody>{months.map(([m, c]) => (
            <tr key={m}><td>{m}</td>{COLS.map(([k]) => <td key={k} className="num-cell">{n(c[k])}</td>)}</tr>))}</tbody>
        </table>
      )}
      <h3 className="sec">날짜별(지난 {d.days}일)</h3>
      {d.items.length === 0 ? <p className="muted">이 기간에 파기 작업 기록이 없습니다.</p> : (
        <table className="tbl" data-purge-runs="">
          <thead><tr><th>시작</th><th>결과</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>기한 넘김</th></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.id} data-purge-ok={r.ok === false ? '0' : '1'}>
              <td className="muted">{r.startedAt}</td>
              <td>{r.ok === null ? '도는 중' : r.ok ? '완료' : <b className="warn-text" title={r.error ?? ''}>실패</b>}</td>
              {COLS.map(([k]) => <td key={k} className="num-cell">{r.ok ? n(r.counts[k]) : '—'}</td>)}
              <td className="num-cell">{r.ok ? <span className={r.counts.overdue ? 'warn-text' : ''}>{n(r.counts.overdue)}</span> : '—'}</td>
            </tr>))}</tbody>
        </table>
      )}
      <div className="ad-nt info">건수만 보여 줍니다 — 무엇을 지웠는지 내용은 남기지 않습니다. 파기 기록 보관 기간은 최신 고시로 확인이 필요합니다(docs/281).</div>
    </section>
  );
}
