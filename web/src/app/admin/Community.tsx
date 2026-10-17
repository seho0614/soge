import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SafetyCases } from './MarketOps';
import { FoodPlaces } from './FoodPlaces';

interface Pending { id: string; board: string; title: string; createdAt: string; author: string; daysWaiting: number }
interface Reported { id: string; board: string; title: string; reportCount: number }
interface Queue { pending: Pending[]; reported: Reported[]; lateCount: number; note: string | null }

/**
 * SB-ADM-CMU-010 소개광장 검수 큐
 *
 * 첫 글과 신고 3건 이상인 글을 봅니다.
 * 신고가 쌓이면 자동으로 가려지고 여기로 옵니다 — **자동으로 지우지는 않습니다.**
 * 경쟁사 세 명이 신고하면 정상 글이 사라지기 때문입니다.
 */
export function Community() {
  const q = useApi<Queue>('/admin/community/queue');
  const a = useAct();

  const approve = (id: string) => a.run(id, () => api(`/admin/community/posts/${id}/approve`, { method: 'POST' }), q.reload);
  const hide = (id: string, title: string) => {
    const reason = prompt(`'${title}' 을(를) 감춥니다.\n사유 — 작성자에게 그대로 보입니다`) ?? '';
    if (!reason.trim()) { a.setErr('감추실 때는 사유를 반드시 적으십시오. 안 적으면 작성자가 같은 글을 다시 씁니다.'); return; }
    void a.run(id, () => api(`/admin/community/posts/${id}/hide`, {
      method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
    }), q.reload);
  };

  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { pending, reported, lateCount, note } = q.data;

  return (
    <section>
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <p className={`card ${lateCount > 0 ? 'warn' : ''}`}>
        <b>2일 넘게 밀리면 새 회원이 &ldquo;글이 안 올라간다&rdquo;고 합니다.</b> 지금 밀린 글 <b>{lateCount}건</b>입니다.
        {note && <> {note}</>}
      </p>
      <Flash msg={a.msg} err={a.err} />

      <h3 className="sec">첫 글 검수 <em>{pending.length}</em></h3>
      {pending.length === 0 && <p className="muted">검수를 기다리는 글이 없습니다.</p>}
      {pending.length > 0 && (
        <table className="tbl">
          <thead><tr><th>제목</th><th>게시판</th><th>작성자</th><th>기다린 날</th><th>처리</th></tr></thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td><td className="muted">{p.board}</td><td>{p.author}</td>
                <td className="num-cell">{p.daysWaiting >= 2 ? <b className="warn-text">{p.daysWaiting}일</b> : `${p.daysWaiting}일`}</td>
                <td>
                  <button className="btn-sm" disabled={a.busy === p.id} onClick={() => void approve(p.id)}>승인</button>{' '}
                  <button className="btn-no" disabled={a.busy === p.id} onClick={() => hide(p.id, p.title)}>감추기</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">신고된 글 <em>{reported.length}</em></h3>
      {reported.length === 0 && <p className="muted">신고가 쌓인 글이 없습니다.</p>}
      {reported.length > 0 && (
        <table className="tbl">
          <thead><tr><th>제목</th><th>게시판</th><th>신고</th><th>처리</th></tr></thead>
          <tbody>
            {reported.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td><td className="muted">{p.board}</td>
                <td className="num-cell"><b className="warn-text">{p.reportCount}</b></td>
                <td><button className="btn-no" disabled={a.busy === p.id} onClick={() => hide(p.id, p.title)}>감추기</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card">
        <b>신고 3건이 쌓이면 자동으로 가려지고 여기로 옵니다.</b> 자동으로 지우지는 않습니다 —
        경쟁사 세 명이 신고하면 정상 글이 사라지기 때문입니다.
      </p>
      <p className="card warn"><b>감추실 때는 사유를 반드시 적으십시오.</b> 안 적으면 작성자가 같은 글을 다시 씁니다.</p>
      {/* v10.31 — 안심거래 › 피해 사례 게시판(W2)의 운영 숨기기 — 같은 「글 검수」 일이라 여기 둡니다 */}
      <h3 className="sec">피해 사례 게시판 <small className="dim">안심거래 · 작성자는 공개 화면에 나오지 않음</small></h3>
      <SafetyCases />
      {/* v10.47 (D100) — 우리동네 맛집 가게 숨기기(지도 사용이 꺼져 있고 가게가 없으면 그리지 않음) */}
      <FoodPlaces />
    </section>
  );
}
