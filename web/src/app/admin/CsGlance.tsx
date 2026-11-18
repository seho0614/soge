import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';

interface Data {
  open: number; overdue: number; reopened: number; resolved30: number; unresolved30: number; resolvedRate30: number | null;
  misses: Array<{ word: string; hits30: number }>;
  lead: { active: boolean; requests24h: number; noPartner24h: number; emptyCategories: number };
}

/**
 * 「고객센터 한눈에」 카드 (v10.344 · docs/478) — 운영 화면 첫 화면(SB-ADM-DSH-010) · 읽기만
 *
 * 대표 11/18 「다음개발」 → ①. 1:1 문의 · 못 찾은 낱말 · 리드관을 한 줄씩. 누르면 그 화면.
 * 서버 GET /admin/cs-glance(ADMIN · SUPER). 읽지 못하면 카드를 그리지 않습니다(첫 화면의 다른 칸은 그대로).
 */
export function CsGlance({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const q = useApi<Data>('/admin/cs-glance');
  const [week, setWeek] = useState<string | null>(null);   /* v10.352 (D234 · docs/486) 주간 보고 미리 보기 */
  if (q.error || !q.data) return null;
  const toggleWeek = () => {
    if (week !== null) { setWeek(null); return; }
    void api<{ text: string }>('/admin/cs-glance/weekly').then((r) => setWeek(r.text)).catch(() => setWeek('주간 보고를 읽지 못했습니다.'));
  };
  const d = q.data;
  const btn = (to: string, label: string) => (canGo(to.split('/')[0]!) ? <button className="linkbtn" onClick={() => onGo(to)} data-cs-glance-go={to}>{label}</button> : null);
  const tone = d.overdue > 0 || d.lead.noPartner24h > 0 ? 'warn' : 'info';
  return (
    <>
      <h2 className="ad-s2">고객센터 한눈에</h2>
      <div className={`ad-nt ${tone}`} data-cs-glance={`${d.open}|${d.overdue}|${d.reopened}|${d.lead.active ? 'on' : 'off'}`}>
        <div>
          <b>1:1 문의</b> 답변 전 <b>{d.open}</b> · 기한 넘김 <b className={d.overdue > 0 ? 'warn-text' : undefined}>{d.overdue}</b> · 다시 열림 <b>{d.reopened}</b> ·
          최근 30일 해결률 {d.resolvedRate30 == null ? '—' : `${d.resolvedRate30}%`}(해결됨 {d.resolved30} · 아직 {d.unresolved30}) {btn('inquiries', '1:1 문의로')}
        </div>
        <div data-cs-glance-misses={d.misses.length}>
          <b>못 찾은 낱말</b> {d.misses.length === 0 ? '없음' : d.misses.map((m) => `「${m.word}」 ${m.hits30}`).join(' · ')} {btn('faq', '자주 묻는 질문으로')}
        </div>
        <div data-cs-glance-lead={d.lead.active ? 'on' : 'off'}>
          <b>리드관</b> {d.lead.active
            ? <>켜짐 · 24시간 신청 {d.lead.requests24h} · 받을 업체 없음 <b className={d.lead.noPartner24h > 0 ? 'warn-text' : undefined}>{d.lead.noPartner24h}</b> · 받을 업체 0곳 업종 {d.lead.emptyCategories}</>
            : <>꺼짐</>} {btn('partners/status', '리드 현황으로')}
        </div>
        <div>
          <button className="linkbtn" onClick={toggleWeek} data-cs-weekly-toggle="">{week === null ? '주간 보고 미리 보기' : '주간 보고 닫기'}</button>
          <small className="dim"> 월요일 09:10 텔레그램 · 슬랙 · 운영자 게시판으로 보내는 글(설정 ops.cs_weekly)</small>
          {week !== null && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6 }} data-cs-weekly="">{week}</pre>}
        </div>
      </div>
    </>
  );
}
