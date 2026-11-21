/* ===== v10.559 (docs/698) 사원 카드 — web/src/app/admin/HrCard.tsx 새 파일 =====
 * 대표 11/21 승인. 회계 › 인사 › 사원 카드(키 hr-card · SUPER · 지급 담당).
 *   위에서 직원을 고르면(GET /admin/acct/employees) 그 사람의 인사 정보를 한 장에(GET /admin/hr/employees/{id}/card · 읽기만).
 *   주소 #/hr-card/{직원 번호} 로 바로 열림 — 급여 탭 「직원」 표의 이름을 누르면 여기로 옴.
 *   칸마다 「자세히」는 그 탭으로(볼 수 있는 탭만 단추). 고치기는 그 탭에서.
 *   개인정보 열람 사유는 App 이 PiiReasonGate 로 감쌈(회원 상세와 같은 방식 · 머리글 X-PII-Reason).
 * (adminMenu · App.tsx · Acct.tsx 연결은 patches/1_wiring.md)
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { hashSub } from '../../lib/hashSub';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const hm = (m: number | null | undefined) => (m == null ? '—' : `${Math.floor(m / 60)}시간 ${m % 60}분`);
const ST_LV: Record<string, string> = { REQUESTED: '신청', APPROVED: '승인', REJECTED: '반려', CANCELED: '취소' };
const HALF: Record<string, string> = { FULL: '종일', AM: '오전 반차', PM: '오후 반차' };
const ST_PAY: Record<string, string> = { DRAFT: '초안', FIXED: '확정', PAID: '지급함' };
const ST_CT: Record<string, string> = { DRAFT: '초안', SENT: '서명 기다림', SIGNED: '서명함', CANCELED: '취소', NONE: '없음' };
const ST_RV: Record<string, string> = { GOALS: '목표', REVIEW: '평가', CLOSED: '닫음' };
const BASIS: Record<string, string> = { PAYROLL: '최근 3개월 급여', BASE: '월 기본급', NONE: '자료 없음' };
const DAY_KIND: Record<string, string> = { WORKDAY: '영업일', OFFDAY: '휴무일', HOLIDAY: '휴일' };
const ROLE_KO: Record<string, string> = { SUPER: '최고 관리자', ADMIN: '운영', REVIEWER: '검수 담당', PAYOUT: '지급 담당', PARTNER_MAL: '안심 파트너 담당', PARTNER_AFF: '제휴 파트너 담당', ACCOUNTANT: '세무사' };
/** 「자세히」 단추를 그릴 탭 — App.tsx TAB_ROLES 와 같게(SUPER 는 모두) */
const TAB_SEE: Record<string, string[]> = {
  'hr-attend': ['ADMIN'], 'hr-leave': ['ADMIN'], 'acct-payroll': ['PAYOUT'], 'acct-payslip': ['PAYOUT', 'ACCOUNTANT'], 'acct-severance': ['PAYOUT'],
  'hr-contract': ['ADMIN'], 'hr-training': ['ADMIN'], 'hr-review': ['ADMIN'], 'hrx-overtime': ['ADMIN'], 'hrx-shifts': ['ADMIN'],
};

interface Emp { id: string; name: string; joinedOn: string; leftOn: string | null; active: boolean }
interface Card {
  employee: { id: string; name: string; joinedOn: string; leftOn: string | null; active: boolean; serviceDays: number; serviceYears: number; memo: string | null;
    account: { linked: boolean; email: string | null; roles: string[] } | null };
  attendance: { ym: string; workStart: string; summary: { days: number; hours: number; late: number; open: number; confirmed: number; leaveDays: number } | null } | null;
  leave: { year: number; granted: number | null; used: number | null; remaining: number | null; suggest: number | null;
    requests: Array<{ id: string; startOn: string; endOn: string; half: string; days: number; state: string }> } | null;
  pay: { monthlyBase: number; nontax: number; dependents: number;
    lines: Array<{ id: string; ym: string; state: string; payDay: string; gross: number; nontax: number; tax: number; ins: number; net: number }>;
    severance: { asOf: string; serviceDays: number; eligible: boolean; dailyAvg: number; estimate: number; basis: string } | null };
  docs: { contractState: string; contracts: Array<{ id: string; title: string; state: string; signedAt: string | null; sentAt: string | null }>;
    training: Array<{ kind: string; name: string; period: string; dueOn: string; minHours: number; hours: number; pending: number; done: boolean }>; trainingUndone: number;
    reviews: Array<{ cycleId: string; title: string; state: string; goals: number; selfSubmittedAt: string | null; selfAvg: number | null; mgrAvg: number | null; grade: string | null }> };
  work: {
    overtime: { monday: string; sunday: string; ym: string; week: { approvedMin: number; requestedMin: number; hours: number }; month: { approvedMin: number; requestedMin: number; hours: number };
      pending: number; limits: { base: number; otMax: number; warn: number }; recent: Array<{ id: string; workOn: string; minutes: number; dayKind: string; state: string }> } | null;
    shifts: { monday: string; sunday: string; plannedHours: number; overBase: boolean; overLimit: boolean;
      cells: Array<{ day: string; inRange: boolean; shift: { name: string; kind: string; startHm: string | null; endHm: string | null } | null; att: { inHm: string; outHm: string | null } | null; leaveDays: number; flagsKo: string[] }> } | null };
  links: Record<string, string>; viewReason: string; errors: string[]; note: string;
}

function More({ tab, label }: { tab: string; label?: string }) {
  const roles = tokenRoles();
  if (!roles.includes('SUPER') && !(TAB_SEE[tab] ?? []).some((r) => roles.includes(r))) return null;
  return <button className="btn-sm btn-plain" onClick={() => { location.hash = `#/${tab}`; }} data-hr-card-more={tab}>{label ?? '자세히'} ›</button>;
}

function Sec({ k, title, more, children }: { k: string; title: string; more?: Array<[string, string?]>; children: ReactNode }) {
  return (
    <div className="card pad" data-hr-card-sec={k}>
      <h3 className="sec">{title} {more?.map(([t, l]) => <More key={t} tab={t} label={l} />)}</h3>
      {children}
    </div>
  );
}

export function HrCard() {
  const emps = useApi<{ items: Emp[] }>('/admin/acct/employees');
  const [id, setId] = useState<string>(() => (/^\d{1,18}$/.test(hashSub() ?? '') ? hashSub()! : ''));
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* 급여 탭에서 이름을 눌러 주소만 바뀐 경우도 따라감 */
  useEffect(() => {
    const on = () => { const s = hashSub(); if (location.hash.startsWith('#/hr-card') && s && /^\d{1,18}$/.test(s)) setId(s); };
    window.addEventListener('hashchange', on); window.addEventListener('bo-sub', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('bo-sub', on); };
  }, []);
  useEffect(() => {
    if (!id) { setCard(null); return; }
    setBusy(true); setErr(null);
    api<Card>(`/admin/hr/employees/${id}/card`).then(setCard).catch((x: Error) => { setCard(null); setErr(x.message); }).finally(() => setBusy(false));
  }, [id]);
  const pick = (v: string) => {
    setId(v);
    history.replaceState(null, '', v ? `#/hr-card/${v}` : '#/hr-card');
  };

  const c = card;
  const ot = c?.work.overtime, sh = c?.work.shifts;
  return (
    <section data-hr-card={c?.employee.id ?? ''}>
      <p>
        <label>직원 <select value={id} onChange={(x) => pick(x.target.value)} data-hr-card-pick="" aria-label="직원 고르기">
          <option value="">— 고르기 —</option>
          {(emps.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' (퇴사)'} · {x.joinedOn} 입사</option>)}
        </select></label>{' '}
        {busy && <span className="muted">불러오는 중…</span>}
      </p>
      {err && <p className="warn-text" data-hr-card-err="">{err}</p>}
      {!id && <p className="muted">직원을 고르면 기본 · 근태 · 휴가 · 급여 · 계약 · 교육 · 평가 · 근무를 한 장에 봅니다(읽기만). 급여 탭 「직원」 표에서 이름을 눌러도 옵니다.</p>}
      {c && (
        <>
          {c.errors.length > 0 && <p className="warn-text" data-hr-card-errors={c.errors.join(',')}>불러오지 못한 칸: {c.errors.join(', ')}</p>}
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <Sec k="basic" title="기본" more={[['acct-payroll', '직원 대장']]}>
              <table className="tbl"><tbody>
                <tr><th>이름</th><td><b>{c.employee.name}</b> {!c.employee.active && <small className="warn-text">퇴사</small>}</td></tr>
                <tr><th>입사 · 퇴사</th><td>{c.employee.joinedOn} ~ {c.employee.leftOn ?? '재직 중'}</td></tr>
                <tr><th>재직일</th><td data-hr-card-service={c.employee.serviceDays}>{c.employee.serviceDays.toLocaleString('ko-KR')}일 ({c.employee.serviceYears}년)</td></tr>
                <tr><th>운영 계정</th><td>{c.employee.account?.linked ? <>{c.employee.account.email ?? '—'} <small className="dim">{c.employee.account.roles.map((r) => ROLE_KO[r] ?? r).join(' · ') || '역할 없음'}</small></> : <span className="muted">연결 안 됨</span>}</td></tr>
                {c.employee.memo && <tr><th>메모</th><td>{c.employee.memo}</td></tr>}
              </tbody></table>
            </Sec>

            <Sec k="attend" title="근태 · 휴가" more={[['hr-attend', '근태'], ['hr-leave', '휴가']]}>
              {c.attendance?.summary ? (
                <p data-hr-card-attend={c.attendance.summary.days}>{c.attendance.ym} — 일한 날 <b>{c.attendance.summary.days}</b>일 · {c.attendance.summary.hours}시간 · 늦음 {c.attendance.summary.late} · 퇴근 없음 {c.attendance.summary.open} · 휴가 {c.attendance.summary.leaveDays}일
                  <br /><small className="dim">출근 기준 {c.attendance.workStart} · 확인 {c.attendance.summary.confirmed}일</small></p>
              ) : <p className="muted">이번 달 근태가 없습니다.</p>}
              <p data-hr-card-leave={c.leave?.remaining ?? ''}>{c.leave?.year}년 연차 — 생김 {c.leave?.granted ?? '—'} · 씀 {c.leave?.used ?? '—'} · <b>남음 {c.leave?.remaining ?? '—'}</b>일{c.leave?.suggest != null && <small className="dim"> (제안 {c.leave.suggest}일)</small>}</p>
              {(c.leave?.requests.length ?? 0) > 0 ? (
                <table className="tbl"><thead><tr><th>기간</th><th>나눔</th><th className="num">일수</th><th>상태</th></tr></thead>
                  <tbody>{c.leave!.requests.map((r) => <tr key={r.id} data-hr-card-leave-req={r.state}><td>{r.startOn}{r.endOn !== r.startOn ? ` ~ ${r.endOn}` : ''}</td><td>{HALF[r.half] ?? r.half}</td><td className="num">{r.days}</td><td>{ST_LV[r.state] ?? r.state}</td></tr>)}</tbody></table>
              ) : <p className="muted">휴가 신청이 없습니다.</p>}
            </Sec>

            <Sec k="pay" title="급여" more={[['acct-payroll', '급여'], ['acct-payslip', '명세서'], ['acct-severance', '퇴직금']]}>
              <p>월 기본급 <b>{won(c.pay.monthlyBase)}</b>원 · 비과세 {won(c.pay.nontax)}원 · 부양가족 {c.pay.dependents}명(본인 포함)</p>
              {c.pay.lines.length > 0 ? (
                <table className="tbl" data-hr-card-paylines={c.pay.lines.length}><thead><tr><th>달</th><th>상태</th><th className="num">지급액</th><th className="num">세금</th><th className="num">4대보험</th><th className="num">실지급</th></tr></thead>
                  <tbody>{c.pay.lines.map((l) => <tr key={l.id}><td>{l.ym}</td><td>{ST_PAY[l.state] ?? l.state}</td><td className="num">{won(l.gross)}</td><td className="num">{won(l.tax)}</td><td className="num">{won(l.ins)}</td><td className="num"><b>{won(l.net)}</b></td></tr>)}</tbody></table>
              ) : <p className="muted">급여 줄이 없습니다.</p>}
              {c.pay.severance ? (
                <p data-hr-card-severance={c.pay.severance.estimate}>퇴직금 추계({c.pay.severance.asOf}) <b>{won(c.pay.severance.estimate)}</b>원 · 1일 평균 {won(c.pay.severance.dailyAvg)}원 · {BASIS[c.pay.severance.basis] ?? c.pay.severance.basis}
                  {!c.pay.severance.eligible && <small className="dim"> · 1년 미만(지급 대상 아님)</small>}</p>
              ) : <p className="muted">퇴직금 추계가 없습니다(이번 달 말 재직자가 아님).</p>}
            </Sec>

            <Sec k="docs" title="계약 · 교육 · 평가" more={[['hr-contract', '계약서'], ['hr-training', '교육'], ['hr-review', '평가']]}>
              <p data-hr-card-contract={c.docs.contractState}>근로계약서 <b>{ST_CT[c.docs.contractState] ?? c.docs.contractState}</b>
                {c.docs.contracts.slice(0, 3).map((x) => <small key={x.id} className="dim"> · {x.title}({ST_CT[x.state] ?? x.state})</small>)}</p>
              {c.docs.training.length > 0 ? (
                <table className="tbl" data-hr-card-training={c.docs.trainingUndone}><thead><tr><th>의무교육</th><th>기간</th><th>기한</th><th className="num">이수</th></tr></thead>
                  <tbody>{c.docs.training.map((t) => <tr key={t.kind}><td>{t.name}</td><td>{t.period}</td><td>{t.dueOn}</td>
                    <td className={t.done ? 'num' : 'num warn-text'}>{t.hours}/{t.minHours}시간{t.pending ? ` · 제출 ${t.pending}` : ''}</td></tr>)}</tbody></table>
              ) : <p className="muted">의무교육 종류가 없습니다.</p>}
              {c.docs.reviews.length > 0 ? (
                <table className="tbl"><thead><tr><th>평가</th><th>단계</th><th>목표</th><th>자기</th><th>등급</th></tr></thead>
                  <tbody>{c.docs.reviews.map((r) => <tr key={r.cycleId} data-hr-card-review={r.state}><td>{r.title}</td><td>{ST_RV[r.state] ?? r.state}</td><td>{r.goals}</td>
                    <td>{r.selfSubmittedAt ? (r.selfAvg ?? '제출') : '—'}</td><td>{r.grade ?? (r.state === 'CLOSED' ? '—' : <small className="dim">닫은 뒤</small>)}</td></tr>)}</tbody></table>
              ) : <p className="muted">인사 평가 차례가 없습니다.</p>}
            </Sec>

            <Sec k="work" title="근무" more={[['hrx-overtime', '연장 근로'], ['hrx-shifts', '근무표']]}>
              {ot ? (
                <p data-hr-card-ot={ot.week.approvedMin + ot.week.requestedMin}>연장 · 휴일 근로 — 이번 주 <b>{ot.week.hours}</b>시간(승인 {hm(ot.week.approvedMin)} · 신청 {hm(ot.week.requestedMin)}) · 이번 달 {ot.month.hours}시간
                  {ot.pending > 0 && <> · 기다리는 신청 {ot.pending}</>}
                  {ot.week.hours > Math.max(0, ot.limits.warn - ot.limits.base) && <small className="warn-text"> · 주 {ot.limits.warn}시간 넘음</small>}
                  <br /><small className="dim">한도 주 {ot.limits.base} + {ot.limits.otMax}시간 · 최근 {ot.recent.map((r) => `${r.workOn} ${DAY_KIND[r.dayKind] ?? r.dayKind} ${hm(r.minutes)}(${ST_LV[r.state] ?? r.state})`).join(' · ') || '없음'}</small></p>
              ) : <p className="muted">연장 근로 자료가 없습니다.</p>}
              {sh && sh.cells.length > 0 ? (
                <table className="tbl" data-hr-card-shifts={sh.cells.filter((x) => x.shift).length}><thead><tr><th>날</th><th>근무</th><th>근태</th></tr></thead>
                  <tbody>{sh.cells.map((x) => <tr key={x.day} className={x.inRange ? undefined : 'dim'}><td>{x.day.slice(5)}</td>
                    <td>{x.shift ? `${x.shift.name}${x.shift.startHm ? ` ${x.shift.startHm} ~ ${x.shift.endHm}` : ''}` : '—'}</td>
                    <td>{x.att ? `${x.att.inHm} ~ ${x.att.outHm ?? ''}` : (x.leaveDays > 0 ? '휴가' : '—')}{x.flagsKo.length > 0 && <small className="warn-text"> {x.flagsKo.join(' · ')}</small>}</td></tr>)}</tbody></table>
              ) : <p className="muted">이번 주 근무표가 없습니다.</p>}
              {sh && sh.cells.length > 0 && <p className="muted">이번 주 계획 {sh.plannedHours}시간{sh.overLimit ? ' · 한도 넘음' : sh.overBase ? ' · 기본 넘음' : ''}</p>}
            </Sec>
          </div>
          <p className="muted">{c.note} 열람 사유: {c.viewReason}.</p>
        </>
      )}
    </section>
  );
}


/* v10.567 (docs/709) 내 사원 카드(MyHrCard.tsx)가 같은 칸 모양을 쓰도록 내보냄 */
export { Sec, won, hm, ST_LV, HALF, ST_CT, ST_RV, DAY_KIND };
