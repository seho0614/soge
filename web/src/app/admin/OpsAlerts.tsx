import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Alert {
  id: string; code: string; severity: 'INFO' | 'WARN' | 'CRITICAL'; title: string; detail: unknown; raisedAt: string;
  acknowledgedAt: string | null; acknowledgedBy: string | null; ackNote: string | null;
}
interface Code { code: string; open: number; last7d: number; lastAt: string; openSeverity: string | null }
interface Data { items: Alert[]; total: number; page: number; size: number; pages: number; codes: Code[] }

const SEV: Record<string, string> = { CRITICAL: '긴급', WARN: '경고', INFO: '안내' };
/* 알림 종류 이름 — 모르는 종류는 코드 그대로 */
const NAME: Record<string, string> = {
  SERVER_ERROR_SPIKE: '서버 오류 몰림', SLOW_API: '느린 응답', UPLOADS_BACKUP_STALE: '올린 파일 백업 멈춤', UPLOADS_BACKUP_SKIPPED: '올린 파일 백업 건너뜀',
  POLL_HIDDEN_BY_REPORTS: '회원 투표 신고 감춤', DAILY_DIGEST: '하루 요약', STUB_PAYMENT_ORDER: '시험 결제 주문', SIGNUP_SPIKE: '가입 급증',
  PII_REVIEW_DUE: '개인정보 접속기록 점검',
  SETTING_CHANGED: '중요 설정 바뀜',   // v10.195 (D174) — 주문 받기 · 가입 · 2단계 인증 · 간주 · 기능 스위치
};

/**
 * SB-ADM-OPS-010 운영 알림 (v10.179 · D168 · docs/279)
 *
 * 정기 작업 · 스크립트가 남긴 운영 알림을 보고 「확인」합니다. 확인은 한 번만(누가 · 언제 · 메모가 남고 되돌릴 수 없음).
 * 알림 내용은 바꾸거나 지우지 않습니다. 「지켜보기」의 「확인 안 한 알림」 칸 · 대시보드 긴급 경보가 여기로 옵니다.
 */
export function OpsAlerts() {
  const [state, setState] = useState<'open' | 'all'>('open');
  const [code, setCode] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useApi<Data>(`/admin/ops-alerts?state=${state}${code ? `&code=${code}` : ''}&page=${page}`);
  const a = useAct();

  const ack = (x: Alert) => {
    const note = prompt(`「${x.title.slice(0, 40)}」을(를) 확인합니다.\n메모(선택 · 200자) — 무엇을 했는지`, '') ;
    if (note === null) return;
    void a.run(x.id, () => api(`/admin/ops-alerts/${x.id}/ack`, { method: 'POST', body: JSON.stringify({ note: note.trim() || undefined }) }), q.reload, '확인했습니다.');
  };
  const ackCode = (c: Code) => {
    const note = prompt(`${NAME[c.code] ?? c.code} 확인 안 한 알림 ${c.open}건을 모두 확인합니다.\n메모(선택 · 200자)`, '');
    if (note === null) return;
    void a.run(`code:${c.code}`, () => api<{ note: string }>('/admin/ops-alerts/ack-code', { method: 'POST', body: JSON.stringify({ code: c.code, note: note.trim() || undefined }) }), q.reload);
  };

  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  return (
    <section data-ops-alerts="">
      <Flash msg={a.msg} err={a.err} />
      <section className="card pad">
        <h3 className="sec">종류별 <small className="dim">확인 안 한 수 · 지난 7일</small></h3>
        {d.codes.length === 0 ? <p className="muted">확인할 알림이 없습니다.</p> : (
          <table className="tbl" data-alert-codes="">
            <thead><tr><th>종류</th><th>확인 안 함</th><th>지난 7일</th><th>가장 최근</th><th>처리</th></tr></thead>
            <tbody>{d.codes.map((c) => (
              <tr key={c.code} data-alert-code={c.code}>
                <td><button className="btn-plain" onClick={() => { setCode(code === c.code ? '' : c.code); setPage(1); }}>{NAME[c.code] ?? c.code}</button> <small className="dim mono">{c.code}</small></td>
                <td className="num-cell">{c.open > 0 ? <b className={c.openSeverity === 'INFO' ? '' : 'warn-text'}>{n(c.open)}</b> : 0}</td>
                <td className="num-cell">{n(c.last7d)}</td><td className="muted">{ymdhm(c.lastAt)}</td>
                <td>{c.open > 0 && <button className="btn-sm" disabled={a.busy === `code:${c.code}`} onClick={() => ackCode(c)} data-ack-code="">모두 확인</button>}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>
      <p>
        <label><input type="radio" name="alert-state" checked={state === 'open'} onChange={() => { setState('open'); setPage(1); }} /> 확인 안 한 것</label>{' '}
        <label><input type="radio" name="alert-state" checked={state === 'all'} onChange={() => { setState('all'); setPage(1); }} /> 전부</label>
        {code && <> · 종류 <b>{NAME[code] ?? code}</b> <button className="btn-plain" onClick={() => setCode('')}>모든 종류</button></>}
        {' '}<span className="dim">{n(d.total)}건</span>
      </p>
      {d.items.length === 0 ? <p className="muted">알림이 없습니다.</p> : (
        <table className="tbl" data-alert-list="">
          <thead><tr><th>때</th><th>등급</th><th>종류</th><th>내용</th><th>확인</th></tr></thead>
          <tbody>{d.items.map((x) => (
            <tr key={x.id} data-alert={x.id} data-acked={x.acknowledgedAt ? '1' : '0'}>
              <td className="muted">{ymdhm(x.raisedAt)}</td>
              <td>{x.severity === 'INFO' ? SEV[x.severity] : <b className="warn-text">{SEV[x.severity]}</b>}</td>
              <td>{NAME[x.code] ?? x.code}</td>
              <td>
                {x.title}{' '}
                {x.detail != null && <button className="btn-plain" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '접기' : '자세히'}</button>}
                {open === x.id && <pre className="card pad" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(x.detail, null, 1)}</pre>}
              </td>
              <td>{x.acknowledgedAt
                ? <span className="muted">{x.acknowledgedBy ?? '—'} · {ymdhm(x.acknowledgedAt)}{x.ackNote ? ` · ${x.ackNote}` : ''}</span>
                : <button className="btn-sm" disabled={a.busy === x.id} onClick={() => ack(x)} data-ack="">확인</button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {d.pages > 1 && <p><button className="btn-plain" disabled={page <= 1} onClick={() => setPage(page - 1)}>앞</button> {page} / {d.pages} <button className="btn-plain" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>뒤</button></p>}
      <div className="ad-nt info">확인은 한 번만 됩니다 — 누가 · 언제 · 메모가 남고 되돌릴 수 없습니다. 알림 내용은 바뀌지 않습니다. 긴급(CRITICAL)이 확인 안 된 채 남아 있으면 배포 점검(postcheck)이 실패로 봅니다.</div>
    </section>
  );
}
