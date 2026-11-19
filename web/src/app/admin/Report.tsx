/* ===== v10.412 ~ 415 (D250 · docs/549 ~ 552) 운영 화면 「보고」 — web/src/app/admin/Report.tsx 로 새 파일 =====
 * adminMenu.ts
 *   탭 이름:  ['rpt-day', '일보'], ['rpt-week', '주보'], ['rpt-month', '월보'], ['rpt-worklog', '업무 일지'], ['rpt-board', '일지 현황판'],
 *   그룹:     { key: 'admrpt',  label: '보고',      tabs: ['rpt-day', 'rpt-week', 'rpt-month', 'rpt-worklog', 'rpt-board'] },   (회계 그룹 뒤)
 *   meta:
 *   'rpt-day':     { title: '일보', sub: '하루(한국 날짜) 회원 · 거래 · 소개몰 · 매출 · 고객센터 · 운영 알림 · 회계 할 일 · 업무 일지를 숫자로 한 장 — 매일 07:00 전날 것을 남김.', screen: 'SB-ADM-WRP-010' },
 *   'rpt-week':    { title: '주보', sub: '월요일 ~ 일요일 합계와 지난주 대비 증감 · 상위 5 — 월요일 07:00 지난주 것을 남김.', screen: 'SB-ADM-WRP-020' },
 *   'rpt-month':   { title: '월보', sub: '1일 ~ 말일 합계와 지난달 대비 증감 · 상위 5 — 1일 07:00 지난달 것을 남김.', screen: 'SB-ADM-WRP-030' },
 *   'rpt-board':   { title: '일지 현황판', sub: '오늘 운영자마다 쓴 일지 · 안 쓴 사람 · 최근 7일 작성률 · 막힌 것 · 확인 안 한 일지(SUPER).', screen: 'SB-ADM-WRP-050' },
 *   'rpt-worklog': { title: '업무 일지', sub: '운영자가 오늘 한 일 · 할 일 · 막힌 것을 남김(고치기 없음 · 덧붙임만) — SUPER 가 확인 · 한 줄 답.', screen: 'SB-ADM-WRP-040' },
 * App.tsx
 *   import { ReportDay, ReportWeek, ReportMonth, ReportWorklog, ReportWorklogBoard } from './app/admin/Report';   // v10.412 ~ 415 (D250) 보고
 *   역할: 'rpt-day': ['ADMIN', 'SUPER'], 'rpt-week': ['ADMIN', 'SUPER'], 'rpt-month': ['ADMIN', 'SUPER'],
 *         'rpt-board': ['SUPER'],
 *         'rpt-worklog': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],
 *   {tab === 'rpt-day' && <ReportDay />}
 *   {tab === 'rpt-week' && <ReportWeek />}
 *   {tab === 'rpt-month' && <ReportMonth />}
 *   {tab === 'rpt-worklog' && <ReportWorklog />}
 *   {tab === 'rpt-board' && <ReportWorklogBoard />}
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

type Kind = 'DAY' | 'WEEK' | 'MONTH';
type M = Record<string, Record<string, number>>;
interface Body { kind: Kind; period: string; from: string; to: string; m: M; prev?: M | null; change?: Record<string, number | null>;
  tops?: { inquiryCategory: Array<{ k: string; n: number }>; mallProduct: Array<{ k: string; n: number }>;
           listingRegion?: Array<{ k: string; n: number }>; dealRegion?: Array<{ k: string; n: number }>; consultRegion?: Array<{ k: string; n: number }> };   // v10.430 지역
  now: { acct: { openAlerts: number; deadlines: Array<{ label: string; due: string; daysLeft: number }> }; server: { diskUsedPct: number | null } } }
interface View { kind: Kind; period: string; from: string; to: string; snapshot: { id: string; createdAt: string; source: string } | null; live: boolean; body: Body; text: string;
  history: Array<{ id: string; period: string; source: string; createdAt: string; sent: number }>; sends: Array<{ channel: string; result: string; createdAt: string }>; note: string;
  control?: { text: string; exceptions: number } | null }   // v10.440 (D257)
interface Settings { on: boolean; kinds: Kind[]; mailTo: string; canEdit: boolean }

const KO: Record<Kind, string> = { DAY: '일보', WEEK: '주보', MONTH: '월보' };
const GROUPS: Array<[string, string, Array<[string, string]>]> = [
  ['members', '회원', [['signups', '가입'], ['withdrawals', '탈퇴']]],
  ['trade', '거래', [['listings', '매물'], ['requests', '요청'], ['deals', '소개'], ['dealsConfirmed', '성사']]],
  ['mall', '소개몰', [['orders', '주문'], ['paidOrders', '결제 주문'], ['paidTotal', '결제 금액'], ['canceled', '취소 · 반품']]],
  ['money', '매출(전표 · 공급가)', [['revenue', '매출'], ['expense', '비용'], ['profit', '이익'], ['entries', '전표']]],
  ['cs', '고객센터', [['inquiries', '문의'], ['answered', '답변'], ['openNow', '답변 전(만들 때)'], ['overdueNow', '기한 넘김(만들 때)']]],
  ['alerts', '운영 알림', [['warn', '경고'], ['critical', '긴급'], ['openCriticalNow', '확인 안 한 긴급(만들 때)']]],
  ['worklog', '업무 일지', [['staff', '쓴 사람'], ['entries', '건'], ['minutes', '시간(분)'], ['reviewed', '확인']]],
];
const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const pct = (v: number | null | undefined) => (v == null ? '' : `${v > 0 ? '+' : ''}${v}%`);
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};
const isSuperTok = () => tokenRoles().includes('SUPER');

function ReportView({ kind }: { kind: Kind }) {
  const first = kind === 'DAY' ? kstDay(-1) : kind === 'WEEK' ? kstDay(-7) : kstDay(-28).slice(0, 7);
  const [period, setPeriod] = useState(first);
  const q = useApi<View>(`/admin/work-reports/view?kind=${kind}&period=${encodeURIComponent(period)}`, [kind, period]);
  const st = useApi<Settings>('/admin/work-reports/settings');
  const a = useAct();
  const make = () => void a.run('make', () => api('/admin/work-reports/make', { method: 'POST', body: JSON.stringify({ kind, period }) }), q.reload);
  const csv = (id: string) => void a.run('csv', () => api<{ csv: string; filename: string }>(`/admin/work-reports/snapshots/${id}/csv`), undefined, () => 'CSV 를 내려받았습니다.')
    .then((r) => { if (r?.csv) save(r.filename, r.csv); });
  const send = (id: string) => void a.run('send', () => api(`/admin/work-reports/snapshots/${id}/send`, { method: 'POST' }), q.reload);
  const d = q.data;
  return (
    <section data-rpt={kind}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <label>{kind === 'MONTH' ? '달' : kind === 'WEEK' ? '그 주 아무 날' : '날짜'}{' '}
          <input type={kind === 'MONTH' ? 'month' : 'date'} value={period} onChange={(e) => setPeriod(e.target.value)} data-rpt-period="" />
        </label>{' '}
        <button className="btn-sm" disabled={a.busy === 'make'} onClick={make} data-rpt-make="">지금 만들어 남기기</button>{' '}
        {d?.snapshot && <button className="btn-sm btn-plain" disabled={a.busy === 'csv'} onClick={() => csv(d.snapshot!.id)} data-rpt-csv="">CSV</button>}{' '}
        <button className="btn-sm btn-plain" onClick={() => window.print()} data-rpt-print="">인쇄</button>{' '}
        {d?.snapshot && st.data?.canEdit && <button className="btn-sm btn-plain" disabled={a.busy === 'send'} onClick={() => send(d.snapshot!.id)} data-rpt-send="">지금 보내기</button>}
      </p>
      {q.error ? <p className="warn-text">{String(q.error)}</p> : null}
      {d && (
        <>
          <h3>{KO[kind]} {d.from === d.to ? d.from : `${d.from} ~ ${d.to}`}{' '}
            <small className="dim">{d.live ? '지금 계산(남긴 보고 없음)' : `남긴 보고 #${d.snapshot!.id} · ${d.snapshot!.source === 'JOB' ? '정기 작업' : '직접'} · ${ymdhm(d.snapshot!.createdAt)}`}</small></h3>
          {d.control && <p className={d.control.exceptions ? 'warn-text' : 'muted'} data-rpt-control="">{d.control.text} — 회계 › 장부 보관 · 통제</p>}
          <table className="tbl" data-rpt-table={kind}><thead><tr><th>구분</th><th>항목</th><th>이번</th><th>지난 기간</th><th>증감</th></tr></thead>
            <tbody>{GROUPS.flatMap(([g, gk, items]) => items.map(([k, label], i) => (
              <tr key={`${g}.${k}`}><td>{i === 0 ? gk : ''}</td><td>{label}</td><td>{num(d.body.m[g]?.[k])}</td><td className="dim">{num(d.body.prev?.[g]?.[k])}</td>
                <td className={(d.body.change?.[`${g}.${k}`] ?? 0) < 0 ? 'warn-text' : ''}>{pct(d.body.change?.[`${g}.${k}`])}</td></tr>)))}</tbody></table>
          {d.body.tops && (d.body.tops.inquiryCategory.length > 0 || d.body.tops.mallProduct.length > 0 || !!d.body.tops.listingRegion?.length || !!d.body.tops.dealRegion?.length || !!d.body.tops.consultRegion?.length) && (
            <div className="card pad" data-rpt-tops="">
              <b>상위 5</b>
              {d.body.tops.inquiryCategory.length > 0 && <p>문의 분야: {d.body.tops.inquiryCategory.map((t) => `${t.k} ${t.n}`).join(' · ')}</p>}
              {d.body.tops.mallProduct.length > 0 && <p>소개몰 상품(수량): {d.body.tops.mallProduct.map((t) => `${t.k} ${t.n}`).join(' · ')}</p>}
              {!!d.body.tops.listingRegion?.length && <p data-rpt-top-region="listing">매물 지역: {d.body.tops.listingRegion.map((t) => `${t.k} ${t.n}`).join(' · ')}</p>}
              {!!d.body.tops.dealRegion?.length && <p data-rpt-top-region="deal">성사 지역: {d.body.tops.dealRegion.map((t) => `${t.k} ${t.n}`).join(' · ')}</p>}
              {!!d.body.tops.consultRegion?.length && <p data-rpt-top-region="consult">상담 신청 지역: {d.body.tops.consultRegion.map((t) => `${t.k} ${t.n}`).join(' · ')}</p>}
            </div>
          )}
          <p className="muted">회계 알림 열림 {d.body.now.acct.openAlerts}{d.body.now.acct.deadlines.length ? ` · 다가오는 기한 ${d.body.now.acct.deadlines.map((x) => `${x.label} ${x.due}`).join(' · ')}` : ''} · 서버 디스크 {d.body.now.server.diskUsedPct ?? '—'}%</p>
          <details><summary>보내는 글 보기</summary><pre data-rpt-text="">{d.text}</pre></details>
          {d.sends.length > 0 && <p className="muted">보낸 결과: {d.sends.map((s) => `${s.channel} ${s.result} (${ymdhm(s.createdAt)})`).join(' · ')}</p>}
          <details data-rpt-history={d.history.length}><summary>남긴 {KO[kind]} {d.history.length}</summary>
            <table className="tbl"><thead><tr><th>#</th><th>기간</th><th>만든 방법</th><th>때</th><th>보냄</th></tr></thead>
              <tbody>{d.history.map((h) => <tr key={h.id}><td>{h.id}</td><td><button className="btn-sm btn-plain" onClick={() => setPeriod(kind === 'MONTH' ? h.period.slice(0, 7) : h.period)}>{h.period}</button></td><td>{h.source === 'JOB' ? '정기 작업' : '직접'}</td><td>{ymdhm(h.createdAt)}</td><td>{h.sent}</td></tr>)}</tbody></table>
          </details>
          <p className="muted">{d.note}</p>
        </>
      )}
      {st.data && kind === 'DAY' && <SendSettings s={st.data} onDone={st.reload} />}
    </section>
  );
}

function SendSettings({ s, onDone }: { s: Settings; onDone: () => void }) {
  const a = useAct();
  const [on, setOn] = useState(s.on);
  const [kinds, setKinds] = useState<Kind[]>(s.kinds);
  const [reason, setReason] = useState('');
  const save2 = () => void a.run('set', () => api('/admin/work-reports/settings', { method: 'PATCH', body: JSON.stringify({ on, kinds, reason }) }), () => { setReason(''); onDone(); });
  return (
    <div className="card pad" data-rpt-settings={s.on ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <b>보고 보내기</b> <small className="dim">운영 알림 채널(텔레그램 · 슬랙 · 메일{s.mailTo ? '' : ' — 메일 주소 없음'}) · 처음 꺼짐 · SUPER</small><br />
      {s.canEdit ? (
        <>
          <label><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> 정기 작업이 만든 보고 보내기</label>{' '}
          {(['DAY', 'WEEK', 'MONTH'] as Kind[]).map((k) => (
            <label key={k}><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} /> {KO[k]} </label>))}{' '}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(꼭)" size={16} />{' '}
          <button className="btn-sm" disabled={a.busy === 'set' || reason.trim().length < 2 || !kinds.length} onClick={save2} data-rpt-settings-save="">저장</button>
        </>
      ) : <span>{s.on ? `켜짐(${s.kinds.map((k) => KO[k]).join(' · ')})` : '꺼짐'}</span>}
    </div>
  );
}

export function ReportDay() { return <ReportView kind="DAY" />; }
export function ReportWeek() { return <ReportView kind="WEEK" />; }
export function ReportMonth() { return <ReportView kind="MONTH" />; }

interface Worklog { id: string; workDate: string; done: string; todo: string | null; blocked: string | null; minutes: number | null; createdAt: string; staffName: string; mine: boolean;
  reviews: Array<{ note: string | null; createdAt: string; by: string }> }
interface Worklogs { from: string; to: string; all: boolean; items: Worklog[]; summary: Array<{ name: string; entries: number; minutes: number; reviewed: number }>; canReview: boolean; today: string; note: string }

export function ReportWorklog() {
  const [from, setFrom] = useState(kstDay(-6));
  const [to, setTo] = useState(kstDay());
  const [mine, setMine] = useState(false);
  const q = useApi<Worklogs>(`/admin/worklogs?from=${from}&to=${to}${mine ? '&mine=1' : ''}`, [from, to, mine]);
  const a = useAct();
  const [f, setF] = useState({ done: '', todo: '', blocked: '', minutes: '' });
  const add = () => void a.run('add', () => api('/admin/worklogs', { method: 'POST', body: JSON.stringify({ done: f.done, todo: f.todo || undefined, blocked: f.blocked || undefined, minutes: f.minutes ? Number(f.minutes) : undefined }) }),
    () => { setF({ done: '', todo: '', blocked: '', minutes: '' }); q.reload(); });
  const review = (id: string) => { const note = prompt('한 줄 답(비우면 읽음만)') ?? null; if (note !== null) void a.run(`r${id}`, () => api(`/admin/worklogs/${id}/review`, { method: 'POST', body: JSON.stringify({ note }) }), q.reload); };
  const d = q.data;
  return (
    <section data-rpt-worklog={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-rpt-worklog-form="">
        <b>오늘({d?.today ?? kstDay()}) 업무 일지</b> <small className="dim">고치기 · 지우기 없음 — 더 쓸 것은 다시 남깁니다 · 회원 개인정보(이름 · 연락처)는 적지 마십시오</small><br />
        <textarea value={f.done} onChange={(e) => setF({ ...f, done: e.target.value })} placeholder="한 일(꼭)" rows={3} cols={60} /><br />
        <input value={f.todo} onChange={(e) => setF({ ...f, todo: e.target.value })} placeholder="할 일" size={28} />{' '}
        <input value={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.value })} placeholder="막힌 것" size={24} />{' '}
        <input value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value.replace(/\D/g, '') })} placeholder="시간(분)" size={8} />{' '}
        <button className="btn-sm" disabled={a.busy === 'add' || f.done.trim().length < 2} onClick={add} data-rpt-worklog-add="">남기기</button>
      </div>
      <p>
        <label>기간 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> ~ <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>{' '}
        {(d?.canReview || isSuperTok()) && <label><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내 것만</label>}
      </p>
      {d && d.summary.length > 0 && (
        <p className="muted" data-rpt-worklog-summary="">{d.summary.map((s) => `${s.name || '—'} ${s.entries}건 · ${Math.round(s.minutes / 6) / 10}시간 · 확인 ${s.reviewed}`).join(' / ')}</p>
      )}
      {d && (
        <table className="tbl"><thead><tr><th>날짜</th>{d.all && <th>누가</th>}<th>한 일</th><th>할 일</th><th>막힌 것</th><th>시간</th><th>확인</th><th /></tr></thead>
          <tbody>{d.items.map((w) => (
            <tr key={w.id} data-rpt-worklog-row={w.id}><td>{w.workDate}<br /><small className="dim">{ymdhm(w.createdAt)}</small></td>{d.all && <td>{w.staffName}</td>}
              <td style={{ whiteSpace: 'pre-wrap' }}>{w.done}</td><td style={{ whiteSpace: 'pre-wrap' }}>{w.todo ?? ''}</td><td className={w.blocked ? 'warn-text' : ''}>{w.blocked ?? ''}</td>
              <td>{w.minutes ?? ''}</td><td>{w.reviews.map((r, i) => <div key={i}><small>{r.by} {r.note ?? '읽음'}</small></div>)}</td>
              <td>{d.canReview && <button className="btn-sm btn-plain" disabled={a.busy === `r${w.id}`} onClick={() => review(w.id)} data-rpt-worklog-review={w.id}>확인</button>}</td></tr>))}</tbody></table>
      )}
      {d && <p className="muted">{d.note}</p>}
    </section>
  );
}

/* v10.414 — 업무 일지 현황판(SUPER · 대표 11/19 「업무일지 현황판」) */
interface BoardP { id: string; name: string; email: string; roles: string; n: number; minutes: number; days7: number; rate7: number; unreviewed: number }
interface Board { date: string; from7: string; total: { staff: number; wrote: number; missing: number; entries: number; minutes: number; unreviewed: number; blocked: number; rate7: number; biz7?: number };
  people: BoardP[]; blocked: Array<{ id: string; date: string; who: string; blocked: string; reviewed: boolean }>; note: string }
export function ReportWorklogBoard() {
  const [date, setDate] = useState(kstDay());
  const q = useApi<Board>(`/admin/worklogs/board?date=${date}`, [date]);
  const d = q.data;
  return (
    <section data-rpt-board={d?.people.length ?? ''}>
      <p><label>날짜 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></p>
      {q.error ? <p className="warn-text">{String(q.error)}</p> : null}
      {d && (
        <>
          <div className="card pad" data-rpt-board-total="">
            <b>{d.date}</b> 운영자 {d.total.staff}명 · 쓴 사람 <b>{d.total.wrote}</b> · <span className={d.total.missing ? 'warn-text' : ''}>안 쓴 사람 {d.total.missing}</span> ·
            일지 {d.total.entries}건 · {Math.round(d.total.minutes / 6) / 10}시간 · 최근 7일 작성률 {d.total.rate7}% · 확인 안 함 {d.total.unreviewed} · 막힌 것 {d.total.blocked}
          </div>
          <table className="tbl"><thead><tr><th>운영자</th><th>역할</th><th>오늘</th><th>시간</th><th>7일 작성률</th><th>확인 안 함</th></tr></thead>
            <tbody>{d.people.map((p) => (
              <tr key={p.id} data-rpt-board-person={p.n > 0 ? 'wrote' : 'missing'}>
                <td>{p.name || p.email}</td><td className="dim"><small>{p.roles}</small></td>
                <td>{p.n > 0 ? `${p.n}건` : <span className="warn-text">안 씀</span>}</td><td>{p.minutes ? `${p.minutes}분` : '—'}</td>
                <td>{p.rate7}% <small className="dim">({p.days7}/{d.total.biz7 ?? 7} 영업일)</small></td><td>{p.unreviewed || '—'}</td></tr>))}</tbody></table>
          <h3>막힌 것 (최근 7일 · {d.from7} ~ {d.date})</h3>
          {d.blocked.length ? (
            <table className="tbl" data-rpt-board-blocked={d.blocked.length}><thead><tr><th>날짜</th><th>누가</th><th>막힌 것</th><th>확인</th></tr></thead>
              <tbody>{d.blocked.map((b) => <tr key={b.id}><td>{b.date}</td><td>{b.who}</td><td>{b.blocked}</td><td>{b.reviewed ? '함' : <span className="warn-text">안 함</span>}</td></tr>)}</tbody></table>
          ) : <p className="muted">막힌 것이 없습니다.</p>}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* v10.429 (D254 · docs/566) 경영 대시보드 그래프 — SVG 직접(라이브러리 없음) · 운영 화면 › 보고 › 추세 */
interface TrendPoint { key: string; label: string; revenue: number; expense: number; profit: number; cash: number; signups: number; orders: number; mallPaid: number }
interface TrendT { unit: 'MONTH' | 'WEEK'; points: TrendPoint[]; change: Record<string, number | null> | null; note: string }
const TREND_SERIES: Array<{ key: keyof TrendPoint; label: string; color: string; money: boolean }> = [
  { key: 'revenue', label: '매출', color: 'var(--c-brand, #2563eb)', money: true },
  { key: 'profit', label: '이익', color: 'var(--c-ok, #16a34a)', money: true },
  { key: 'cash', label: '현금(기간 끝)', color: 'var(--c-warn, #d97706)', money: true },
  { key: 'signups', label: '가입', color: 'var(--c-brand, #2563eb)', money: false },
  { key: 'orders', label: '소개몰 결제 주문', color: 'var(--c-ok, #16a34a)', money: false },
];
function TrendChart({ points, keys, title }: { points: TrendPoint[]; keys: Array<keyof TrendPoint>; title: string }) {
  const W = 640, H = 180, P = 36;
  const series = TREND_SERIES.filter((s) => keys.includes(s.key));
  const vals = points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0));
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const x = (i: number) => P + (points.length <= 1 ? 0 : (i * (W - P * 2)) / (points.length - 1));
  const y = (v: number) => H - P / 2 - ((v - min) / (max - min || 1)) * (H - P);
  const fmt = (v: number) => (Math.abs(v) >= 1e8 ? `${Math.round(v / 1e7) / 10}억` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3) / 10}만` : String(Math.round(v)));
  return (
    <figure className="card pad" data-rpt-trend-chart={title} style={{ margin: 0 }}>
      <figcaption><b>{title}</b> {series.map((s) => <small key={String(s.key)} style={{ color: s.color, marginLeft: 8 }}>■ {s.label}</small>)}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="currentColor" opacity={0.2} />
        <text x={2} y={y(max) + 4} fontSize={10} fill="currentColor" opacity={0.6}>{fmt(max)}</text>
        {min < 0 && <text x={2} y={y(min) + 4} fontSize={10} fill="currentColor" opacity={0.6}>{fmt(min)}</text>}
        {points.map((p, i) => (i % Math.ceil(points.length / 7) === 0 || i === points.length - 1) &&
          <text key={p.key} x={x(i)} y={H - 2} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.6}>{p.label}</text>)}
        {series.map((s) => (
          <g key={String(s.key)}>
            <polyline fill="none" stroke={s.color} strokeWidth={2} points={points.map((p, i) => `${x(i)},${y(Number(p[s.key]) || 0)}`).join(' ')} />
            {points.map((p, i) => <circle key={p.key} cx={x(i)} cy={y(Number(p[s.key]) || 0)} r={2.5} fill={s.color}><title>{`${p.label} ${s.label} ${(Number(p[s.key]) || 0).toLocaleString('ko-KR')}`}</title></circle>)}
          </g>))}
      </svg>
    </figure>
  );
}
export function ReportTrend() {
  const [unit, setUnit] = useState<'MONTH' | 'WEEK'>('MONTH');
  const q = useApi<TrendT>(`/admin/work-reports/trend?unit=${unit}`, [unit]);
  const d = q.data;
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
  const last = d?.points[d.points.length - 1];
  return (
    <section data-rpt-trend={d?.points.length ?? ''}>
      <p><label><input type="radio" checked={unit === 'MONTH'} onChange={() => setUnit('MONTH')} /> 12달</label>{' '}
        <label><input type="radio" checked={unit === 'WEEK'} onChange={() => setUnit('WEEK')} /> 13주</label></p>
      {q.error ? <p className="warn-text">{String(q.error)}</p> : null}
      {d && last && (
        <>
          <div className="card pad" data-rpt-trend-latest="">
            이번 {unit === 'MONTH' ? '달' : '주'}: 매출 <b>{last.revenue.toLocaleString('ko-KR')}</b>({pct(d.change?.revenue)}) · 이익 <b>{last.profit.toLocaleString('ko-KR')}</b>({pct(d.change?.profit)}) ·
            현금 {last.cash.toLocaleString('ko-KR')} · 가입 {last.signups}({pct(d.change?.signups)}) · 소개몰 결제 {last.orders}건({pct(d.change?.orders)})
          </div>
          <TrendChart points={d.points} keys={['revenue', 'profit', 'cash']} title="돈(원)" />
          <TrendChart points={d.points} keys={['signups', 'orders']} title="회원 · 주문(건)" />
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
