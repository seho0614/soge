import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Month { month: string; views: number; reviewedAt: string | null; reviewedBy: string | null; closed: boolean }
interface Actor { actorId: string; name: string | null; email: string | null; roles: string; views: number; exports: number; targets: number; maxPerDay: number; nightViews: number; flagged: boolean }
interface Detail {
  month: string; closed: boolean; flagDaily: number; total: number; flagged: number; actors: Actor[]; kinds: Array<{ k: string; n: number }>;
  review: { reviewedAt: string; reviewedBy: string | null; note: string } | null;
}

/**
 * SB-ADM-PII-010 개인정보 접속기록 월 점검 (v10.179 · D168 · docs/279 · SUPER)
 *
 * 운영자가 회원 · 사업자 · 리드 개인정보를 본 기록(조회 감사 · 회원 상세 · 리드 보기)을 달마다 모아 봅니다.
 * 하루 최다가 기준(pii.review_flag_daily) 이상이거나 밤(22 ~ 06시) 조회가 10건 이상인 운영자는 「살펴볼 것」.
 * 끝난 달만 메모를 남겨 「점검 완료」 — 한 달에 한 번 · 고칠 수 없음. 매달 5일부터 지난달 점검이 없으면 운영 알림 PII_REVIEW_DUE.
 */
export function PiiReview() {
  const ms = useApi<Month[]>('/admin/pii-review');
  const [month, setMonth] = useState<string | null>(null);
  const cur = month ?? ms.data?.find((m) => m.closed)?.month ?? ms.data?.[0]?.month ?? null;
  if (ms.error) return <ErrorView error={ms.error} onRetry={ms.reload} />;
  if (!ms.data) return <p className="muted">불러오는 중…</p>;
  return (
    <section data-pii-review="">
      <table className="tbl" data-pii-months="">
        <thead><tr><th>달</th><th>개인정보 조회</th><th>점검</th></tr></thead>
        <tbody>{ms.data.map((m) => (
          <tr key={m.month} data-pii-month={m.month} className={m.month === cur ? 'on' : ''}>
            <td><button className="btn-plain" onClick={() => setMonth(m.month)}>{m.month}</button>{!m.closed && <small className="dim"> 이번 달</small>}</td>
            <td className="num-cell">{n(m.views)}</td>
            <td>{m.reviewedAt ? <span className="muted">{m.reviewedBy ?? '—'} · {ymdhm(m.reviewedAt)}</span> : m.closed ? <b className="warn-text">점검 안 함</b> : <span className="dim">달이 끝난 뒤</span>}</td>
          </tr>))}</tbody>
      </table>
      {cur && <MonthDetail key={cur} month={cur} onDone={ms.reload} />}
      <div className="ad-nt info">법이 정한 점검 주기 · 접속기록 보관 기간은 최신 고시로 확인이 필요합니다(docs/279). 이 화면은 조회 사실만 모으고, 무엇을 봤는지 내용은 담지 않습니다.</div>
    </section>
  );
}

function MonthDetail({ month, onDone }: { month: string; onDone: () => void }) {
  const q = useApi<Detail>(`/admin/pii-review/${month}`);
  const a = useAct();
  const [note, setNote] = useState('');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const save = () => {
    if (note.trim().length < 5) { a.setErr('점검 메모를 5자 이상 적어 주십시오 — 무엇을 보고 어떻게 판단했는지.'); return; }
    if (!confirm(`${d.month} 점검 완료를 남깁니다. 고칠 수 없습니다.`)) return;
    void a.run('review', () => api('/admin/pii-review', { method: 'POST', body: JSON.stringify({ month: d.month, note: note.trim() }) }), () => { q.reload(); onDone(); }, '점검을 남겼습니다.');
  };
  return (
    <section className="card pad" data-pii-detail={d.month}>
      <h3 className="sec">{d.month} <small className="dim">조회 {n(d.total)}건 · 살펴볼 것 {d.flagged}명 · 기준 하루 {n(d.flagDaily)}건 또는 밤 10건</small></h3>
      <Flash msg={a.msg} err={a.err} />
      {d.actors.length === 0 ? <p className="muted">이 달에 개인정보를 본 기록이 없습니다.</p> : (
        <table className="tbl" data-pii-actors="">
          <thead><tr><th>운영자</th><th>역할</th><th>조회</th><th>대상 수</th><th>하루 최다</th><th>밤</th><th>내려받기</th><th></th></tr></thead>
          <tbody>{d.actors.map((x) => (
            <tr key={x.actorId} data-flagged={x.flagged ? '1' : '0'}>
              <td>{x.name ?? '(이름 없음)'} <small className="dim">{x.email}</small></td><td className="muted">{x.roles}</td>
              <td className="num-cell">{n(x.views)}</td><td className="num-cell">{n(x.targets)}</td><td className="num-cell">{n(x.maxPerDay)}</td>
              <td className="num-cell">{n(x.nightViews)}</td><td className="num-cell">{n(x.exports)}</td>
              <td>{x.flagged && <b className="warn-text">살펴볼 것</b>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {d.kinds.length > 0 && <p className="muted">종류: {d.kinds.map((k) => `${k.k} ${n(k.n)}`).join(' · ')}</p>}
      {d.review
        ? <p className="card" data-pii-reviewed="">점검 완료 — {d.review.reviewedBy ?? '—'} · {ymdhm(d.review.reviewedAt)} · {d.review.note}</p>
        : d.closed
          ? <p data-pii-review-form="">
              <label>점검 메모(5자 이상 · 고칠 수 없음){' '}
                <input name="pii-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ width: '60%' }} placeholder="예) 살펴볼 것 0명 — 업무 범위 안의 조회로 판단" /></label>{' '}
              <button className="btn-ok" disabled={a.busy === 'review'} onClick={save} data-pii-save="">점검 완료</button>
            </p>
          : <p className="muted">이번 달은 달이 끝난 뒤 점검합니다.</p>}
    </section>
  );
}
