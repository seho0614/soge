import { useState } from 'react';
import { useApi } from '../../../lib/useApi';
import { ymdhm } from '../../../lib/act';
import { siteHref } from '../../../lib/siteUrl';
import { ErrorView } from '../../../components/ErrorView';

interface Row {
  code: string; name: string; status: string; partners: number; requests: number; delivered: number; noPartner: number;
  rejects: number; rejectsAccepted: number; warn: boolean;
}
interface Data {
  days: number;
  hall: { active: boolean; legalOk: string; openedAt: string | null; notifyReady: boolean };
  rows: Row[];
  total: { requests: number; delivered: number; noPartner: number; rejects: number; rejectsAccepted: number };
  warnings: number;
}

/**
 * SB-ADM-PTN-100 리드 현황 (v10.338 · docs/471) — 읽기만
 *
 * 대표 11/17 「다음개발」 → ③ 리드관 운영 현황. 리드관(소개리드 · LED)을 켠 뒤 한 장으로 봅니다.
 * 관 상태 · 법무 설정 · 신청 받을 길 · 상담 업종별 신청 · 전달 · 받을 업체 없음 · 반려 · 받을 업체 수 · 0곳 경고.
 */
export function LeadStatus({ onGo }: { onGo?: (tab: string) => void }) {
  const [days, setDays] = useState(30);
  const q = useApi<Data>(`/admin/lead-status?days=${days}`);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { hall, rows, total, warnings } = q.data;
  const go = (t: string) => (onGo ? <button className="btn-sm btn-plain" onClick={() => onGo(t)}>열기</button> : null);
  return (
    <section data-lead-status={`${hall.active ? 'on' : 'off'}|${rows.length}`}>
      <table className="tbl" data-lead-hall-state="">
        <tbody>
          <tr><th>리드관(소개리드 · Leeds)</th>
            <td>{hall.active ? <span className="badge badge-verified">켜짐</span> : <b>꺼짐</b>}{hall.openedAt ? ` · 처음 연 때 ${ymdhm(hall.openedAt)}` : ''}
              {hall.active && <> · <a href={siteHref('/lead')} target="_blank" rel="noreferrer">사용자 웹 /lead</a></>}</td>
            <td>노출 › 메인 운영 › 관 노출 {go('mainops/gwan')}</td></tr>
          <tr><th>법무 확인 설정 <code>lead.legal_ok</code></th>
            <td>{hall.legalOk === 'on' ? <span className="badge badge-verified">on</span> : <b className="warn-text">off — 켜기 전에 on(SUPER)</b>}</td>
            <td>정책 › 전체 설정 {go('settings')}</td></tr>
          <tr><th>상담 신청 받을 길(알림톡 · 메일)</th>
            <td>{hall.notifyReady ? <span className="badge badge-verified">준비됨</span> : <b className="warn-text">준비 안 됨 — 신청 화면이 「준비 중」</b>}</td>
            <td>통합 현황 › 외부 연동 {go('integrations')}</td></tr>
        </tbody>
      </table>
      <p>
        {[7, 30, 90].map((n) => (
          <button key={n} className={`btn-sm ${days === n ? 'btn-ok' : 'btn-plain'}`} onClick={() => setDays(n)}>{n}일</button>
        ))}{' '}
        최근 {q.data.days}일 신청 <b>{total.requests}</b> · 전달 {total.delivered} · 받을 업체 없음 {total.noPartner} · 반려 요청 {total.rejects}(인정 {total.rejectsAccepted})
      </p>
      {warnings > 0 && (
        <div className="ad-nt warn" data-lead-warn={warnings}>
          공개 업종 <b>{warnings}</b>개에 받을 인증 업체가 0곳입니다 — 신청이 와도 전달되지 않습니다(「받을 업체 없음」). 파트너사 › 입점 신청 · 인증 심사 › 자격 심사를 보십시오.
        </div>
      )}
      <table className="tbl" data-lead-status-rows={rows.length}>
        <thead><tr><th>업종</th><th>상태</th><th>받을 업체</th><th>신청</th><th>전달</th><th>받을 업체 없음</th><th>반려(인정)</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} data-lead-row={r.code}>
              <td>{r.name} <small className="dim">{r.code}</small></td>
              <td>{r.status === 'APPROVED' ? '공개' : '준비 중'}</td>
              <td>{r.warn ? <b className="warn-text">0</b> : r.partners}</td>
              <td>{r.requests}</td><td>{r.delivered}</td><td>{r.noPartner}</td><td>{r.rejects}({r.rejectsAccepted})</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">읽기만 합니다. 신청 = 휴대폰 확인을 마친 것. 법률 · 세무(정액 노출형)는 리드가 아니라 빠집니다. 연락처 · 업체 이름은 보이지 않습니다.</p>
    </section>
  );
}
