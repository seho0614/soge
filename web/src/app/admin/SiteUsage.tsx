/* ===== v10.508 (D274 · docs/646) 회원 화면 사용 통계 — web/src/app/admin/SiteUsage.tsx 새 파일 =====
 *   통합 현황 › 화면 사용 통계 — 기간(1 · 7 · 30 · 90일) · 합(보기 · 첫 화면 · 이탈률) · 날마다 · 화면 주소 묶음 100 · 전환(목표 × 첫 화면)
 *   ★ 개인 식별 정보 없음(하루 × 주소 묶음 수만) — 누가 무엇을 봤는지는 이 화면에도 DB 에도 없음
 * 새 CSS 없음 — 어두운 테마 그대로 (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { useApi } from '../../lib/useApi';

interface UsageView {
  on: boolean; sample: number; days: number; from: string; note: string; settings: Record<string, string | null>;
  total: { views: number; entries: number; engaged: number; bouncePct: number | null };
  daily: Array<{ day: string; views: number; entries: number; engaged: number; estViews: number }>;
  paths: Array<{ path: string; views: number; entries: number; engaged: number; estViews: number; bouncePct: string | number | null }>;
  goals: Array<{ goal: string; entryPath: string; n: number; convPct: string | number | null }>;
}
const GOAL_KO: Record<string, string> = { SIGNUP: '가입 완료', ORDER: '주문 완료', POST: '글 올림', INQUIRY: '문의 보냄', LISTING: '매물 등록', REQUEST: '요청 등록' };
const k = (v: number | string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));

export function SiteUsage() {
  const [days, setDays] = useState(7);
  const q = useApi<UsageView>(`/admin/site-usage?days=${days}`, [days]);
  const d = q.data;
  if (!d) return <div className="card pad">{q.error ? '불러오지 못했습니다.' : '불러오는 중…'}</div>;
  return (
    <div data-site-usage={d.paths.length}>
      <div className="card pad">
        <b>회원 화면 사용 통계 {d.on ? '켜짐' : '꺼짐'}</b> <span className="muted">(설정 site.usage_stats · 표본 {d.sample}% · 보관 {d.settings['site.usage_keep_days'] ?? 400}일)</span>
        {!d.on && <p className="warn-text">꺼져 있어 새로 쌓이지 않습니다 — 켜기 전에 처리방침 「자동 수집」 문구를 먼저 고칩니다(docs/646 · 법무 확인).</p>}
        <p className="muted">{d.note}</p>
        <p>
          {[1, 7, 30, 90].map((x) => <button key={x} className={`btn-sm${x === days ? '' : ' btn-plain'}`} onClick={() => setDays(x)} data-usage-days={x}>{x}일</button>)}{' '}
          <span className="muted">{d.from} 부터</span>
        </p>
        <p>보기 <b className="num">{k(d.total.views)}</b> · 첫 화면 {k(d.total.entries)} · 이어 봄 {k(d.total.engaged)} · 이탈률 {d.total.bouncePct == null ? '—' : `${d.total.bouncePct}%`}</p>
      </div>
      <h3>날마다</h3>
      <table className="tbl"><thead><tr><th>날</th><th className="num">보기</th><th className="num">추정 보기</th><th className="num">첫 화면</th><th className="num">이어 봄</th></tr></thead>
        <tbody>{d.daily.length === 0 ? <tr><td colSpan={5} className="muted">쌓인 것이 없습니다.</td></tr> : d.daily.map((r) => (
          <tr key={r.day}><td>{r.day}</td><td className="num">{k(r.views)}</td><td className="num">{k(r.estViews)}</td><td className="num">{k(r.entries)}</td><td className="num">{k(r.engaged)}</td></tr>))}</tbody></table>
      <h3>화면 주소 묶음(보기 많은 차례 100)</h3>
      <table className="tbl"><thead><tr><th>주소</th><th className="num">보기</th><th className="num">추정 보기</th><th className="num">첫 화면</th><th className="num">이탈률</th></tr></thead>
        <tbody>{d.paths.map((r) => (
          <tr key={r.path}><td>{r.path}</td><td className="num">{k(r.views)}</td><td className="num">{k(r.estViews)}</td><td className="num">{k(r.entries)}</td><td className="num">{r.bouncePct == null ? '—' : `${r.bouncePct}%`}</td></tr>))}</tbody></table>
      <h3>전환(완료 화면에 닿은 수 · 들어온 첫 화면별)</h3>
      <table className="tbl"><thead><tr><th>목표</th><th>첫 화면</th><th className="num">수</th><th className="num">전환률</th></tr></thead>
        <tbody>{d.goals.length === 0 ? <tr><td colSpan={4} className="muted">아직 없습니다.</td></tr> : d.goals.map((g) => (
          <tr key={`${g.goal}${g.entryPath}`}><td>{GOAL_KO[g.goal] ?? g.goal}</td><td>{g.entryPath}</td><td className="num">{k(g.n)}</td><td className="num">{g.convPct == null ? '—' : `${g.convPct}%`}</td></tr>))}</tbody></table>
    </div>
  );
}
