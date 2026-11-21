/* ===== v10.567 (docs/709) 내 사원 카드(본인) — web/src/app/admin/MyHrCard.tsx 새 파일 =====
 * 대표 11/21 승인. 사무 › 내 인사(my-hr) 맨 위 「내 카드」 접는 칸.
 *   펼치면 GET /admin/me/hr/card 를 한 번 부름(읽기만 · 본인 것만 · 열람 사유 묻지 않음).
 *   칸 그리기는 관리자 사원 카드(HrCard.tsx · v10.559)의 Sec · 이름표를 그대로 씀 — 칸 모양이 같음.
 *   「자세히」는 관리자 탭으로 가지 않고 같은 화면(내 인사) 안의 그 칸으로 내려감.
 *   급여는 금액 대신 내 급여명세서 목록 · 「보기 · 인쇄」는 기존 내 명세서(GET /admin/me/hr/payslips/{lineId}) · 퇴직금 추계 없음.
 *   연결된 직원이 없으면 「연결된 직원이 없습니다」.
 * (App.tsx 연결은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { Sec, hm, ST_LV, HALF, ST_CT, ST_RV, DAY_KIND } from './HrCard';
import { printSlip, type Slip } from './Hr';

const ROLE_KO: Record<string, string> = { SUPER: '최고 관리자', ADMIN: '운영', REVIEWER: '검수 담당', PAYOUT: '지급 담당', PARTNER_MAL: '안심 파트너 담당', PARTNER_AFF: '제휴 파트너 담당' };
const ST_SLIP: Record<string, string> = { FIXED: '확정', PAID: '지급함' };

interface MyCard {
  linked: boolean; self?: boolean; note: string;
  employee?: { id: string; name: string; joinedOn: string; leftOn: string | null; active: boolean; serviceDays: number; serviceYears: number; dependents: number | null;
    account: { linked: boolean; roles: string[] } | null };
  attendance?: { ym: string; workStart: string; today: { inHm: string; outHm: string | null } | null;
    summary: { days: number; hours: number; late: number; open: number; confirmed: number; leaveDays: number } | null } | null;
  leave?: { year: number; granted: number | null; used: number | null; remaining: number | null;
    requests: Array<{ id: string; startOn: string; endOn: string; half: string; days: number; state: string }> };
  pay?: { payslips: Array<{ lineId: string; ym: string; payDay: string | null; state?: string }> };
  docs?: { contractState: string; contracts: Array<{ id: string; title: string; state: string; sentAt: string | null; signedAt: string | null }>;
    training: Array<{ kind: string; name: string; period: string; dueOn: string; minHours: number; hours: number; pending: number; done: boolean }>; trainingUndone: number;
    reviews: Array<{ cycleId: string; title: string; state: string; goals: number; selfSubmittedAt: string | null; selfAvg: number | null; mgrAvg: number | null; grade: string | null }> };
  work?: {
    overtime: { week: { approvedMin: number; requestedMin: number; hours: number }; month: { approvedMin: number; requestedMin: number; hours: number };
      pending: number; limits: { base: number; otMax: number; warn: number }; recent: Array<{ id: string; workOn: string; minutes: number; dayKind: string; state: string }> } | null;
    shifts: { plannedHours: number; overBase: boolean; overLimit: boolean;
      cells: Array<{ day: string; inRange: boolean; shift: { name: string; startHm: string | null; endHm: string | null } | null; att: { inHm: string; outHm: string | null } | null; leaveDays: number; flagsKo: string[] }> } | null };
  errors?: string[];
}

/** 같은 화면(내 인사) 안의 그 칸으로 내려감 — 칸이 없으면(연결 · 자료 없음) 아무것도 안 함 */
function Jump({ to, label }: { to: string; label: string }) {
  return (
    <button className="btn-sm btn-plain" data-my-hr-card-more={to}
      onClick={() => document.querySelector(`[${to}]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label} ›</button>
  );
}

export function MyHrCard() {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<MyCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true); setErr(null);
    api<MyCard>('/admin/me/hr/card').then(setC).catch((x: Error) => { setC(null); setErr(x.message); }).finally(() => setBusy(false));
  };
  const toggle = (on: boolean) => { setOpen(on); if (on && !c && !busy) load(); };
  const slip = (lineId: string) => {
    setErr(null); setMsg(null);
    api<Slip>(`/admin/me/hr/payslips/${lineId}`).then((s) => { printSlip(s); setMsg('명세서를 새 창에 열었습니다.'); }).catch((x: Error) => setErr(x.message));
  };

  const ot = c?.work?.overtime, sh = c?.work?.shifts;
  return (
    <details className="card pad" data-my-hr-card={c ? (c.linked ? c.employee?.id ?? '' : 'none') : ''} open={open}
      onToggle={(e) => toggle((e.target as HTMLDetailsElement).open)}>
      <summary data-my-hr-card-open=""><b>내 카드</b> <small className="dim">기본 · 근태 · 휴가 · 명세서 · 계약 · 교육 · 평가 · 근무를 한 장으로(읽기만)</small></summary>
      {busy && <p className="muted">불러오는 중…</p>}
      {err && <p className="warn-text" data-my-hr-card-err="">{err}</p>}
      {msg && <p className="muted">{msg}</p>}
      {c && !c.linked && <p className="muted" data-my-hr-card-none="">연결된 직원이 없습니다 — {c.note}</p>}
      {c?.linked && c.employee && (
        <>
          {(c.errors?.length ?? 0) > 0 && <p className="warn-text" data-my-hr-card-errors={c.errors!.join(',')}>불러오지 못한 칸: {c.errors!.join(', ')}</p>}
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <Sec k="basic" title="기본">
              <table className="tbl"><tbody>
                <tr><th>이름</th><td><b>{c.employee.name}</b></td></tr>
                <tr><th>입사</th><td>{c.employee.joinedOn}{c.employee.leftOn ? ` ~ ${c.employee.leftOn}` : ' · 재직 중'}</td></tr>
                <tr><th>재직일</th><td data-my-hr-card-service={c.employee.serviceDays}>{c.employee.serviceDays.toLocaleString('ko-KR')}일 ({c.employee.serviceYears}년)</td></tr>
                {c.employee.dependents != null && <tr><th>부양가족</th><td>{c.employee.dependents}명(본인 포함)</td></tr>}
                <tr><th>운영 역할</th><td>{(c.employee.account?.roles ?? []).map((r) => ROLE_KO[r] ?? r).join(' · ') || '—'}</td></tr>
              </tbody></table>
            </Sec>

            <Sec k="attend" title="근태 · 휴가">
              {c.attendance?.summary ? (
                <p data-my-hr-card-attend={c.attendance.summary.days}>{c.attendance.ym} — 일한 날 <b>{c.attendance.summary.days}</b>일 · {c.attendance.summary.hours}시간 · 늦음 {c.attendance.summary.late} · 퇴근 없음 {c.attendance.summary.open} · 휴가 {c.attendance.summary.leaveDays}일
                  <br /><small className="dim">오늘 출근 {c.attendance.today?.inHm ?? '—'} · 퇴근 {c.attendance.today?.outHm ?? '—'} · 기준 {c.attendance.workStart}</small></p>
              ) : <p className="muted">이번 달 근태가 없습니다.</p>}
              <p data-my-hr-card-leave={c.leave?.remaining ?? ''}>{c.leave?.year}년 연차 — 생김 {c.leave?.granted ?? '—'} · 씀 {c.leave?.used ?? '—'} · <b>남음 {c.leave?.remaining ?? '—'}</b>일</p>
              {(c.leave?.requests.length ?? 0) > 0 ? (
                <table className="tbl"><thead><tr><th>기간</th><th>나눔</th><th className="num">일수</th><th>상태</th></tr></thead>
                  <tbody>{c.leave!.requests.map((r) => <tr key={r.id}><td>{r.startOn}{r.endOn !== r.startOn ? ` ~ ${r.endOn}` : ''}</td><td>{HALF[r.half] ?? r.half}</td><td className="num">{r.days}</td><td>{ST_LV[r.state] ?? r.state}</td></tr>)}</tbody></table>
              ) : <p className="muted">휴가 신청이 없습니다.</p>}
              <p><Jump to="data-my-hr-today" label="출퇴근" /> <Jump to="data-my-leave" label="휴가 신청" /></p>
            </Sec>

            <Sec k="pay" title="내 급여명세서">
              {(c.pay?.payslips.length ?? 0) > 0 ? (
                <table className="tbl" data-my-hr-card-payslips={c.pay!.payslips.length}><thead><tr><th>달</th><th>지급일</th><th></th></tr></thead>
                  <tbody>{c.pay!.payslips.map((p) => <tr key={p.lineId}><td>{p.ym}{p.state ? ` · ${ST_SLIP[p.state] ?? p.state}` : ''}</td><td>{p.payDay ?? '—'}</td>
                    <td><button className="btn-sm btn-plain" onClick={() => slip(p.lineId)} data-my-hr-card-slip={p.lineId}>보기 · 인쇄</button></td></tr>)}</tbody></table>
              ) : <p className="muted">확정된 급여명세서가 없습니다.</p>}
              <p className="muted"><small>금액은 명세서 안에 있습니다.</small></p>
            </Sec>

            <Sec k="docs" title="계약 · 교육 · 평가">
              <p data-my-hr-card-contract={c.docs?.contractState}>근로계약서 <b>{ST_CT[c.docs?.contractState ?? 'NONE'] ?? c.docs?.contractState}</b>
                {(c.docs?.contracts ?? []).slice(0, 3).map((x) => <small key={x.id} className="dim"> · {x.title}({ST_CT[x.state] ?? x.state})</small>)}</p>
              {(c.docs?.training.length ?? 0) > 0 ? (
                <table className="tbl" data-my-hr-card-training={c.docs!.trainingUndone}><thead><tr><th>의무교육</th><th>기간</th><th>기한</th><th className="num">이수</th></tr></thead>
                  <tbody>{c.docs!.training.map((t) => <tr key={t.kind}><td>{t.name}</td><td>{t.period}</td><td>{t.dueOn}</td>
                    <td className={t.done ? 'num' : 'num warn-text'}>{t.hours}/{t.minHours}시간{t.pending ? ` · 확인 기다림 ${t.pending}` : ''}</td></tr>)}</tbody></table>
              ) : <p className="muted">의무교육 종류가 없습니다.</p>}
              {(c.docs?.reviews.length ?? 0) > 0 ? (
                <table className="tbl" data-my-hr-card-reviews={c.docs!.reviews.length}><thead><tr><th>평가(닫힌 것)</th><th>목표</th><th>내 평균</th><th>상사 평균</th><th>등급</th></tr></thead>
                  <tbody>{c.docs!.reviews.map((r) => <tr key={r.cycleId} data-my-hr-card-review={r.state}><td>{r.title} <small className="dim">{ST_RV[r.state] ?? r.state}</small></td><td>{r.goals}</td>
                    <td>{r.selfAvg ?? '—'}</td><td>{r.mgrAvg ?? '—'}</td><td><b>{r.grade ?? '—'}</b></td></tr>)}</tbody></table>
              ) : <p className="muted">닫힌 평가가 없습니다(진행 중인 평가는 아래 「평가」 칸).</p>}
              <p><Jump to="data-my-training" label="교육 제출" /> <Jump to="data-my-contracts" label="계약서" /> <Jump to="data-my-reviews" label="목표 · 자기 평가" /></p>
            </Sec>

            <Sec k="work" title="근무">
              {ot ? (
                <p data-my-hr-card-ot={ot.week.approvedMin + ot.week.requestedMin}>연장 · 휴일 근로 — 이번 주 <b>{ot.week.hours}</b>시간(승인 {hm(ot.week.approvedMin)} · 신청 {hm(ot.week.requestedMin)}) · 이번 달 {ot.month.hours}시간
                  {ot.pending > 0 && <> · 기다리는 신청 {ot.pending}</>}
                  <br /><small className="dim">한도 주 {ot.limits.base} + {ot.limits.otMax}시간 · 최근 {ot.recent.map((r) => `${r.workOn} ${DAY_KIND[r.dayKind] ?? r.dayKind} ${hm(r.minutes)}(${ST_LV[r.state] ?? r.state})`).join(' · ') || '없음'}</small></p>
              ) : <p className="muted">연장 근로 자료가 없습니다.</p>}
              {sh && sh.cells.length > 0 ? (
                <table className="tbl" data-my-hr-card-shifts={sh.cells.filter((x) => x.shift).length}><thead><tr><th>날</th><th>근무</th><th>근태</th></tr></thead>
                  <tbody>{sh.cells.map((x) => <tr key={x.day} className={x.inRange ? undefined : 'dim'}><td>{x.day.slice(5)}</td>
                    <td>{x.shift ? `${x.shift.name}${x.shift.startHm ? ` ${x.shift.startHm} ~ ${x.shift.endHm}` : ''}` : '—'}</td>
                    <td>{x.att ? `${x.att.inHm} ~ ${x.att.outHm ?? ''}` : (x.leaveDays > 0 ? '휴가' : '—')}{x.flagsKo.length > 0 && <small className="warn-text"> {x.flagsKo.join(' · ')}</small>}</td></tr>)}</tbody></table>
              ) : <p className="muted">이번 주 근무표가 없습니다.</p>}
              <p><Jump to="data-my-hrx" label="연장 근로 신청" /> <Jump to="data-my-shifts" label="근무표 2주" /></p>
            </Sec>
          </div>
          <p className="muted"><small>{c.note}</small></p>
        </>
      )}
    </details>
  );
}
