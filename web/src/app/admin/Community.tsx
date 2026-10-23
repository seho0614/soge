import { Fragment, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SafetyCases } from './MarketOps';
import { FoodPlaces } from './FoodPlaces';
import { ymdKst } from '../../lib/format';

interface Pending { id: string; board: string; title: string; createdAt: string; author: string; daysWaiting: number }
interface Reported { id: string; board: string; title: string; reportCount: number; hiddenAt: string | null }
interface Found {
  id: string; board: string; title: string; state: string; reportCount: number; commentCount: number;
  createdAt: string; hiddenAt: string | null; hiddenReason: string | null; author: string;
}
interface AdminComment {
  id: string; parentId: string | null; body: string; state: string; createdAt: string; hiddenAt: string | null; author: string;
  reportCount?: number;   // v10.80
}
interface FoundList { items: Found[]; total: number; page: number; size: number; pages: number }
interface ReportedComment {
  id: string; postId: string; postTitle: string; body: string; state: string; reportCount: number; hiddenAt: string | null; author: string;
}
interface Queue { pending: Pending[]; reported: Reported[]; reportedComments?: ReportedComment[]; lateCount: number; note: string | null }

/**
 * SB-ADM-CMU-010 소개광장 검수 큐
 *
 * 첫 글과 신고 3건 이상인 글 · 댓글(v10.80)을 봅니다.
 * 신고가 쌓이면 자동으로 가려지고 여기로 옵니다 — **자동으로 지우지는 않습니다.**
 * 경쟁사 세 명이 신고하면 정상 글이 사라지기 때문입니다.
 *
 * v10.72 — 「글 찾기」: 신고가 쌓이기 전의 글도 찾아 감추고, 감춘 글(신고로 가려진 글 포함)은 되살립니다.
 * v10.75 — 글 찾기 표의 「댓글」 수를 누르면 그 글의 댓글이 펼쳐지고, 댓글을 감추거나 되살립니다.
 */
export function Community() {
  const q = useApi<Queue>('/admin/community/queue');
  const a = useAct();

  const approve = (id: string) => a.run(id, () => api(`/admin/community/posts/${id}/approve`, { method: 'POST' }), q.reload);
  const hide = (id: string, title: string, after?: () => void) => {
    const reason = prompt(`'${title}' 을(를) 감춥니다.\n사유 — 작성자에게 그대로 보입니다`) ?? '';
    if (!reason.trim()) { a.setErr('감추실 때는 사유를 반드시 적으십시오. 안 적으면 작성자가 같은 글을 다시 씁니다.'); return; }
    void a.run(id, () => api(`/admin/community/posts/${id}/hide`, {
      method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
    }), () => { q.reload(); after?.(); });
  };
  /* v10.72 — 되살리기: 처리 전 신고는 서버가 기각으로 닫고 신고 수를 0 으로 둡니다(대표 결정 A) */
  const unhide = (id: string, title: string, after: () => void) => {
    const reason = prompt(`'${title}' 을(를) 다시 올립니다.\n사유 — 감사 기록에 남습니다. 처리 전 신고는 기각으로 닫히고 신고한 사람에게 알립니다`) ?? '';
    if (!reason.trim()) { a.setErr('되살리실 때도 사유를 적으십시오. 감사 기록에 남습니다.'); return; }
    void a.run(id, () => api(`/admin/community/posts/${id}/unhide`, {
      method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
    }), () => { q.reload(); after(); });
  };

  /* v10.80 — 신고된 댓글 감추기 · 되살리기(되살리면 처리 전 신고는 기각 · 신고 수 0 — 글과 같음) */
  const commentAct = (c: ReportedComment, kind: 'hide' | 'unhide') => {
    const head = c.body.length > 30 ? `${c.body.slice(0, 30)}…` : c.body;
    const reason = prompt(`댓글 '${head}' 을(를) ${kind === 'hide' ? '감춥니다' : '다시 보이게 합니다'}.\n사유 — 감사 기록에 남습니다${kind === 'unhide' ? '. 처리 전 신고는 기각으로 닫히고 신고한 사람에게 알립니다' : ''}`) ?? '';
    if (!reason.trim()) { a.setErr('사유를 반드시 적으십시오. 감사 기록에 남습니다.'); return; }
    void a.run(c.id, () => api(`/admin/community/comments/${c.id}/${kind}`, {
      method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
    }), q.reload);
  };

  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { pending, reported, lateCount, note } = q.data;
  const reportedComments = q.data.reportedComments ?? [];

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
          <thead><tr><th>제목</th><th>게시판</th><th>신고</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>
            {reported.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td><td className="muted">{p.board}</td>
                <td className="num-cell"><b className="warn-text">{p.reportCount}</b></td>
                <td className="muted">{p.hiddenAt ? '감춤' : '공개'}</td>
                <td>
                  {p.hiddenAt
                    ? <button className="btn-sm" disabled={a.busy === p.id} onClick={() => unhide(p.id, p.title, () => undefined)}>되살리기</button>
                    : <button className="btn-no" disabled={a.busy === p.id} onClick={() => hide(p.id, p.title)}>감추기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="sec">신고된 댓글 <em>{reportedComments.length}</em></h3>
      {reportedComments.length === 0 && <p className="muted">신고가 쌓인 댓글이 없습니다.</p>}
      {reportedComments.length > 0 && (
        <table className="tbl" data-reported-comments="">
          <thead><tr><th>댓글</th><th>글</th><th>작성자</th><th>신고</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>
            {reportedComments.map((c) => (
              <tr key={c.id}>
                <td>{c.body}</td><td className="muted">{c.postTitle}</td><td>{c.author}</td>
                <td className="num-cell"><b className="warn-text">{c.reportCount}</b></td>
                <td className="muted">{COMMENT_STATE[c.state] ?? c.state}</td>
                <td>
                  {c.state === 'HIDDEN' && <button className="btn-sm" disabled={a.busy === c.id} onClick={() => commentAct(c, 'unhide')}>되살리기</button>}
                  {c.state === 'PUBLISHED' && <button className="btn-no" disabled={a.busy === c.id} onClick={() => commentAct(c, 'hide')}>감추기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card">
        <b>신고 3건이 쌓이면 자동으로 가려지고 여기로 옵니다.</b> 자동으로 지우지는 않습니다 —
        경쟁사 세 명이 신고하면 정상 글이 사라지기 때문입니다. 정상 글 · 댓글이면 「되살리기」를 누르십시오.
      </p>
      <PostFinder busy={a.busy} onHide={hide} onUnhide={unhide} reloadQueue={q.reload} />
      <p className="card warn"><b>감추실 때는 사유를 반드시 적으십시오.</b> 안 적으면 작성자가 같은 글을 다시 씁니다.</p>
      {/* v10.31 — 안심거래 › 피해 사례 게시판(W2)의 운영 숨기기 — 같은 「글 검수」 일이라 여기 둡니다 */}
      <h3 className="sec">피해 사례 게시판 <small className="dim">안심거래 · 작성자는 공개 화면에 나오지 않음</small></h3>
      <SafetyCases />
      {/* v10.47 (D100) — 우리동네 맛집 가게 숨기기(지도 사용이 꺼져 있고 가게가 없으면 그리지 않음) */}
      <FoodPlaces />
    </section>
  );
}

const STATE_LABEL: Record<string, string> = { PENDING: '검수 대기', PUBLISHED: '공개', HIDDEN: '감춤', DELETED: '작성자 삭제' };
const BOARD_LABEL: Record<string, string> = { REVIEW: '소개 후기', TRADE: '거래', QNA: '묻고 답하기', NOTICE: '공지', FOOD: '맛집' };

/**
 * v10.72 — 글 찾기.
 *
 * 검수 큐에는 첫 글과 신고 3건 이상인 글만 옵니다. 그 밖의 글은 여기서 상태 · 게시판 · 검색어로 찾아
 * 공개 글은 감추고, 감춘 글은 되살립니다. 작성자가 지운 글은 보기만 합니다.
 */
function PostFinder({ busy, onHide, onUnhide, reloadQueue }: {
  busy: string | null;
  onHide: (id: string, title: string, after?: () => void) => void;
  onUnhide: (id: string, title: string, after: () => void) => void;
  reloadQueue: () => void;
}) {
  const [state, setState] = useState('PUBLISHED');
  const [board, setBoard] = useState('');
  const [kw, setKw] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useApi<FoundList>(`/admin/community/posts?page=${page}&size=20${state ? `&state=${state}` : ''}${board ? `&board=${board}` : ''}${kw ? `&q=${encodeURIComponent(kw)}` : ''}`);
  const after = () => { list.reload(); reloadQueue(); };

  return (
    <div data-post-finder>
      <h3 className="sec">글 찾기 {list.data && <em>{list.data.total}</em>}</h3>
      <form className="acts" onSubmit={(e) => { e.preventDefault(); setKw(String(new FormData(e.currentTarget).get('q') ?? '').trim()); setPage(1); }}>
        <select aria-label="상태" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
          <option value="">모든 상태</option>
          {Object.entries(STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="게시판" value={board} onChange={(e) => { setBoard(e.target.value); setPage(1); }}>
          <option value="">모든 게시판</option>
          {Object.entries(BOARD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input name="q" defaultValue={kw} placeholder="제목 · 본문의 낱말" aria-label="글 찾기" style={{ minWidth: 240 }} />
        <button className="btn-plain" type="submit">찾기</button>
        {kw && <button className="btn-plain" type="button" onClick={() => { setKw(''); setPage(1); }}>찾기 지우기</button>}
        {list.data && <span className="muted">{list.data.total.toLocaleString('ko-KR')}건 · {list.data.page}/{Math.max(list.data.pages, 1)}쪽</span>}
      </form>
      {list.error ? <ErrorView error={list.error} onRetry={list.reload} />
        : !list.data ? <p className="muted">불러오는 중…</p>
        : list.data.items.length === 0 ? <p className="muted">찾는 글이 없습니다.</p>
        : (
          <table className="tbl">
            <thead><tr><th>제목</th><th>게시판</th><th>작성자</th><th>쓴 날</th><th>신고</th><th>댓글</th><th>상태</th><th>처리</th></tr></thead>
            <tbody>
              {list.data.items.map((p) => (
                <Fragment key={p.id}>
                <tr>
                  <td>{p.title}{p.hiddenReason && <div className="muted">감춘 사유: {p.hiddenReason}</div>}</td>
                  <td className="muted">{BOARD_LABEL[p.board] ?? p.board}</td>
                  <td>{p.author}</td>
                  <td className="muted">{ymdKst(p.createdAt)}</td>
                  <td className="num-cell">{p.reportCount > 0 ? <b className="warn-text">{p.reportCount}</b> : 0}</td>
                  <td className="num-cell">
                    <button className="btn-plain" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                      {p.commentCount}{open === p.id ? ' ▲' : ' ▼'}
                    </button>
                  </td>
                  <td>{STATE_LABEL[p.state] ?? p.state}</td>
                  <td>
                    {(p.state === 'PUBLISHED' || p.state === 'PENDING') && <button className="btn-no" disabled={busy === p.id} onClick={() => onHide(p.id, p.title, after)}>감추기</button>}
                    {p.state === 'HIDDEN' && <button className="btn-sm" disabled={busy === p.id} onClick={() => onUnhide(p.id, p.title, after)}>되살리기</button>}
                  </td>
                </tr>
                {open === p.id && <tr><td colSpan={8}><CommentPanel postId={p.id} onChanged={list.reload} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      {(list.data?.pages ?? 1) > 1 && (
        <div className="acts">
          <button className="btn-plain" disabled={page <= 1} onClick={() => setPage(page - 1)}>← 앞 쪽</button>
          <span className="muted">{page} / {list.data?.pages}</span>
          <button className="btn-plain" disabled={page >= (list.data?.pages ?? 1)} onClick={() => setPage(page + 1)}>다음 쪽 →</button>
        </div>
      )}
    </div>
  );
}

/**
 * v10.75 — 글의 댓글 감추기 · 되살리기.
 *
 * 댓글 표에는 사유 칸이 없어(마이그레이션 없음) 사유는 감사 기록에만 남습니다.
 * 회원 화면에는 「운영 기준에 따라 가려진 댓글입니다.」로만 보입니다. 지운 댓글은 보기만 합니다.
 */
function CommentPanel({ postId, onChanged }: { postId: string; onChanged: () => void }) {
  const c = useApi<{ items: AdminComment[] }>(`/admin/community/posts/${postId}/comments`);
  const a = useAct();
  const act = (x: AdminComment, kind: 'hide' | 'unhide') => {
    const head = x.body.length > 30 ? `${x.body.slice(0, 30)}…` : x.body;
    const reason = prompt(`댓글 '${head}' 을(를) ${kind === 'hide' ? '감춥니다' : '다시 보이게 합니다'}.\n사유 — 감사 기록에 남습니다`) ?? '';
    if (!reason.trim()) { a.setErr('사유를 반드시 적으십시오. 감사 기록에 남습니다.'); return; }
    void a.run(x.id, () => api(`/admin/community/comments/${x.id}/${kind}`, {
      method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
    }), () => { c.reload(); onChanged(); });
  };

  if (c.error) return <ErrorView error={c.error} onRetry={c.reload} />;
  if (!c.data) return <p className="muted">불러오는 중…</p>;
  return (
    <div data-comment-panel>
      <Flash msg={a.msg} err={a.err} />
      {c.data.items.length === 0 ? <p className="muted">댓글이 없습니다.</p> : (
        <table className="tbl">
          <thead><tr><th>댓글</th><th>작성자</th><th>쓴 날</th><th>신고</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>
            {c.data.items.map((x) => (
              <tr key={x.id}>
                <td>{x.parentId && <span className="muted">↳ </span>}{x.body}</td>
                <td>{x.author}</td>
                <td className="muted">{ymdKst(x.createdAt)}</td>
                <td className="num-cell">{(x.reportCount ?? 0) > 0 ? <b className="warn-text">{x.reportCount}</b> : 0}</td>
                <td>{COMMENT_STATE[x.state] ?? x.state}</td>
                <td>
                  {x.state === 'PUBLISHED' && <button className="btn-no" disabled={a.busy === x.id} onClick={() => act(x, 'hide')}>감추기</button>}
                  {x.state === 'HIDDEN' && <button className="btn-sm" disabled={a.busy === x.id} onClick={() => act(x, 'unhide')}>되살리기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const COMMENT_STATE: Record<string, string> = { PUBLISHED: '공개', HIDDEN: '감춤', DELETED: '작성자 삭제' };
