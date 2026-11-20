/* ===== v10.507 (D274 · docs/645) 소개광장 활동 배지 · 랭킹 — web/src/app/admin/PlazaRanking.tsx 새 파일 =====
 *   소개광장 › 활동 배지 · 랭킹 — 달 고르기 · 그 달 순위 200(노출 끈 회원 표시) · 배지(거두기) · 점수 규칙(plaza.* — 정책 › 전체 설정에서 고침) · 다시 셈
 * 새 CSS 없음 — 어두운 테마 그대로 (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface RankView {
  on: boolean; month: string; helpful30: number; badgeNames: Record<string, string>; rules: Record<string, string | null>;
  closed: { closed_at: string; members: number; badges: number } | null;
  items: Array<{ rank: number; accountId: string; name: string | null; score: number; posts: number; answers: number; comments: number; helpful: number; hideRank: boolean; computedAt: string }>;
  badges: Array<{ id: string; badge: string; score: number; accountId: string; name: string | null; awardedAt: string; revokedAt: string | null; revokeReason: string | null }>;
}
const kstMonth = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);

export function PlazaRanking() {
  const [month, setMonth] = useState(kstMonth());
  const q = useApi<RankView>(`/admin/community/ranking?month=${month}`, [month]);
  const a = useAct();
  const d = q.data;
  if (!d) return <div className="card pad">{q.error ? '불러오지 못했습니다.' : '불러오는 중…'}</div>;
  const revoke = (id: string, who: string) => {
    const reason = window.prompt(`${who} 배지를 거둘 사유`);
    if (reason && reason.trim().length >= 2) void a.run(`b${id}`, () => api(`/admin/community/badges/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload);
  };
  return (
    <div data-plz-rank={d.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <b>활동 랭킹 · 배지 {d.on ? '켜짐' : '꺼짐'}</b> <span className="muted">(설정 plaza.ranking — 꺼져 있으면 회원 화면에 랭킹 · 도움돼요 · 배지가 없음 · 점수는 매일 03:30 미리 셈)</span>
        <p className="muted">점수 = 글 × {d.rules['plaza.score_post'] ?? 3} + 답변 × {d.rules['plaza.score_answer'] ?? 2} + 댓글 × {d.rules['plaza.score_comment'] ?? 1} + 받은 도움돼요 × {d.rules['plaza.score_helpful'] ?? 2} · 하루 {d.rules['plaza.daily_cap'] ?? 10}개까지 셈 · 숨김 · 신고된 글 · 댓글 · 공지 · 운영자 빠짐 · 최근 30일 도움돼요 {d.helpful30}</p>
        <p>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || kstMonth())} data-plz-month="" />{' '}
          <button className="btn-sm" disabled={a.busy === 'run'} data-plz-run=""
            onClick={() => void a.run('run', () => api('/admin/community/ranking/run', { method: 'POST', body: JSON.stringify({ month }) }), q.reload,
              (r: any) => `${r?.month ?? month} 점수를 다시 셌습니다(${r?.members ?? 0}명).`)}>이 달 다시 셈</button>{' '}
          {d.closed ? <span className="muted">마감 {ymdhm(d.closed.closed_at)} · 배지 {d.closed.badges}개</span> : <span className="muted">아직 마감 전(달이 끝난 다음 날 03:30 · 스위치 켜져 있을 때)</span>}
        </p>
      </div>
      <h3>{d.month} 순위</h3>
      <table className="tbl"><thead><tr><th className="num">순위</th><th>회원</th><th className="num">점수</th><th className="num">글</th><th className="num">답변</th><th className="num">댓글</th><th className="num">도움돼요</th><th>공개 랭킹</th></tr></thead>
        <tbody>{d.items.length === 0 ? <tr><td colSpan={8} className="muted">이 달 점수가 없습니다.</td></tr> : d.items.map((r) => (
          <tr key={r.accountId}><td className="num">{r.rank}</td><td>{r.name ?? '—'}</td><td className="num">{r.score}</td><td className="num">{r.posts}</td><td className="num">{r.answers}</td><td className="num">{r.comments}</td><td className="num">{r.helpful}</td>
            <td>{r.hideRank ? <span className="muted">숨김(회원이 끔)</span> : '보임'}</td></tr>))}</tbody></table>
      <h3>{d.month} 배지</h3>
      <table className="tbl"><thead><tr><th>배지</th><th>회원</th><th className="num">점수</th><th>받은 때</th><th>거둠</th><th /></tr></thead>
        <tbody>{d.badges.length === 0 ? <tr><td colSpan={6} className="muted">이 달 배지가 없습니다.</td></tr> : d.badges.map((b) => (
          <tr key={b.id}><td>{d.badgeNames[b.badge] ?? b.badge}</td><td>{b.name ?? '—'}</td><td className="num">{b.score}</td><td>{ymdhm(b.awardedAt)}</td>
            <td className="muted">{b.revokedAt ? `${ymdhm(b.revokedAt)} · ${b.revokeReason ?? ''}` : ''}</td>
            <td>{!b.revokedAt && <button className="btn-sm btn-plain" onClick={() => revoke(b.id, b.name ?? '회원')}>거두기</button>}</td></tr>))}</tbody></table>
    </div>
  );
}
