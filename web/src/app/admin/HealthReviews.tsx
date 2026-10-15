import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Rv { id: string; state: string; rating: number; body: string; holdWord: string | null; hiddenReason: string | null; createdAt: string; decidedAt: string | null; productCode: string; productName: string; orderNo: string; writer: string }
interface Qn { id: string; body: string; isPrivate: boolean; state: string; answer: string | null; answeredAt: string | null; createdAt: string; productCode: string; productName: string; writer: string }

const RS: Array<[string, string]> = [['PENDING', '확인 대기'], ['VISIBLE', '보이는 리뷰'], ['HIDDEN', '가린 리뷰']];

/**
 * SB-ADM-HRV-010 소개몰 리뷰 · 문의 — v10.28 (D036 · 10/9 답 「권장대로」).
 * 리뷰: 금칙어에 걸려 「확인 대기」인 것을 보이게 하거나 가림(지우지 않음 · 사유를 쓴 분에게 알림).
 * 문의: 답할 것 · 답한 것 — 답하면 쓴 분에게 알림. 비공개 문의도 운영자는 봅니다.
 */
export function HealthReviews({ onGo }: { onGo?: (tab: string) => void } = {}) {
  const [sub, setSub] = useState<'reviews' | 'qna'>('reviews');
  return (
    <section data-screen="SB-ADM-HRV-010">
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      {onGo && <div className="ad-dact" style={{ marginTop: 0 }}><button className="btn-plain btn-sm" onClick={() => onGo('hlt-orders')}>← 소개몰 주문</button></div>}
      <p className="lead">운영자는 리뷰를 지우지 않고 가립니다(사유를 쓴 분에게 알림).</p>
      <div className="acts" style={{ margin: '8px 0' }}>
        <button type="button" className={sub === 'reviews' ? 'btn-ok' : 'btn-plain'} onClick={() => setSub('reviews')} data-hrv-sub="reviews">리뷰</button>
        <button type="button" className={sub === 'qna' ? 'btn-ok' : 'btn-plain'} onClick={() => setSub('qna')} data-hrv-sub="qna">상품 문의</button>
      </div>
      {sub === 'reviews' ? <Reviews /> : <Qna />}
    </section>
  );
}

function Reviews() {
  const [st, setSt] = useState('PENDING');
  const list = useApi<Rv[]>(`/admin/health/reviews?state=${st}`);
  const a = useAct();
  const [why, setWhy] = useState<Record<string, string>>({});
  const decide = (id: string, action: 'SHOW' | 'HIDE') =>
    void a.run(`${action}-${id}`, () => api<{ note: string }>(`/admin/health/reviews/${id}/decide`, { method: 'POST', body: JSON.stringify({ action, reason: why[id] }) }), list.reload);
  if (list.error) return <ErrorView error={list.error} />;
  return (
    <>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts" style={{ margin: '6px 0' }}>
        {RS.map(([k, l]) => <button key={k} type="button" className={st === k ? 'btn-ok' : 'btn-plain'} onClick={() => setSt(k)} data-hrv-state={k}>{l}</button>)}
      </div>
      {!list.data ? <p className="muted">불러오는 중…</p> : list.data.length === 0 ? <p className="muted" data-hrv-empty>해당하는 리뷰가 없습니다.</p> : (
        <table className="tbl" data-hrv-table>
          <thead><tr><th>상품</th><th>별점</th><th>글</th><th>쓴 분 · 주문</th><th>처리</th></tr></thead>
          <tbody>{list.data.map((r) => (
            <tr key={r.id} data-hrv-row={r.id}>
              <td>{r.productName}<div className="muted mono">{r.productCode}</div></td>
              <td>{'★'.repeat(r.rating)}</td>
              <td style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{r.body}
                {r.holdWord && <div className="warn-text">걸린 말: 「{r.holdWord}」</div>}
                {r.hiddenReason && <div className="muted">가린 사유: {r.hiddenReason}</div>}</td>
              <td>{r.writer}<div className="muted mono">{r.orderNo}</div><div className="muted">{ymdhm(r.createdAt)}</div></td>
              <td className="acts">
                {r.state !== 'VISIBLE' && <button type="button" className="btn-ok" onClick={() => decide(r.id, 'SHOW')} data-hrv-show>보이기</button>}
                {r.state !== 'HIDDEN' && <>
                  <input placeholder="가리는 사유(쓴 분에게 알림)" value={why[r.id] ?? ''} onChange={(e) => setWhy((s) => ({ ...s, [r.id]: e.target.value }))} style={{ width: 180 }} data-hrv-why />
                  <button type="button" className="btn-plain" onClick={() => decide(r.id, 'HIDE')} data-hrv-hide>가리기</button></>}
              </td>
            </tr>))}</tbody>
        </table>)}
    </>
  );
}

function Qna() {
  const [open, setOpen] = useState(true);
  const list = useApi<Qn[]>(`/admin/health/qna?open=${open}`);
  const a = useAct();
  const [ans, setAns] = useState<Record<string, string>>({});
  if (list.error) return <ErrorView error={list.error} />;
  return (
    <>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts" style={{ margin: '6px 0' }}>
        <button type="button" className={open ? 'btn-ok' : 'btn-plain'} onClick={() => setOpen(true)} data-hqn-open="true">답할 문의</button>
        <button type="button" className={!open ? 'btn-ok' : 'btn-plain'} onClick={() => setOpen(false)} data-hqn-open="false">답한 문의</button>
      </div>
      {!list.data ? <p className="muted">불러오는 중…</p> : list.data.length === 0 ? <p className="muted" data-hqn-empty>해당하는 문의가 없습니다.</p> : (
        <table className="tbl" data-hqn-table>
          <thead><tr><th>상품</th><th>문의</th><th>쓴 분</th><th>답</th></tr></thead>
          <tbody>{list.data.map((q) => (
            <tr key={q.id} data-hqn-row={q.id}>
              <td>{q.productName}<div className="muted mono">{q.productCode}</div></td>
              <td style={{ maxWidth: 380, whiteSpace: 'pre-wrap' }}>{q.isPrivate && <b>🔒 비공개 · </b>}{q.body}</td>
              <td>{q.writer}<div className="muted">{ymdhm(q.createdAt)}</div></td>
              <td className="acts" style={{ minWidth: 300 }}>
                <textarea rows={2} style={{ width: '100%' }} placeholder={q.answer ?? '답을 적어 주십시오(쓴 분에게 알림)'} value={ans[q.id] ?? ''} onChange={(e) => setAns((s) => ({ ...s, [q.id]: e.target.value }))} data-hqn-ans />
                <button type="button" className="btn-ok" disabled={!(ans[q.id] ?? '').trim()} data-hqn-send
                  onClick={() => void a.run(`a-${q.id}`, () => api<{ note: string }>(`/admin/health/qna/${q.id}/answer`, { method: 'POST', body: JSON.stringify({ answer: ans[q.id] }) }), list.reload)}>{q.answer ? '답 고치기' : '답하기'}</button>
                <button type="button" className="btn-plain" data-hqn-hide
                  onClick={() => void a.run(`h-${q.id}`, () => api<{ note: string }>(`/admin/health/qna/${q.id}/hide`, { method: 'POST', body: JSON.stringify({ reason: '운영 가림' }) }), list.reload)}>가리기</button>
                {q.answer && <div className="muted">지금 답: {q.answer}</div>}
              </td>
            </tr>))}</tbody>
        </table>)}
    </>
  );
}
