/* ===== v10.517 ~ 520 (D277 · docs/655 ~ 658) ㊼ 회원 · 광고 — web/src/app/admin/Prx.tsx 새 파일 =====
 * 노출 › 메인 팝업(SB-ADM-PRX-010)        PrxPopups     만들기(꺼진 채) · 고치기 · 켜기 · 끄기 · 미리 보기(사용자 웹과 같은 모양 · 이 화면 안)
 * 제휴 › 추천 이벤트(SB-ADM-PRX-020)       PrxRefEvents  초안 · 시행 전 확인(약관 · 안내 문구 · 확인한 곳 · 날짜) · 시작 · 끝(SUPER) · 스위치(SUPER)
 * 광고 › 광고 성과 보고서(SB-ADM-PRX-030)  PrxAdReports  달 고르기 · 만들기 · 인쇄 PDF(printDoc) · 메일(SUPER · 처음 꺼짐) · 보내는 주기(하루 · 주 · 달) · 소재 → 광고주 잇기
 * 광고 › 광고 소재 비교(SB-ADM-PRX-040)    PrxAbTests    초안 · 시작 · 끝 · 취소 · 결과(노출 · 클릭 · 클릭률 · z)
 * 새 CSS 없음(기존 tbl · card · pad · btn-sm · btn-ok · btn-plain · inp · dim · mono · warn-text · ad-nt) — 다크 모드는 기존 토큰 그대로.
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { openPrint } from '../../lib/printDoc';   // v10.468 (D264) 문서 PDF(인쇄)

const isSuper = () => tokenRoles().includes('SUPER');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** datetime-local 값 ↔ ISO(한국 시각) */
const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16);
const fromLocal = (v: string) => (v ? `${v}:00+09:00` : '');
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

/* ── v10.517 메인 팝업 ─────────────────────────────────────────── */
interface Popup { id: string; title: string; body: string; linkUrl: string | null; linkLabel: string | null; audience: string[]; startsAt: string; endsAt: string; priority: number; isOn: boolean; live: boolean; updatedAt: string }
const AUD: Record<string, string> = { GUEST: '비로그인', MEMBER: '회원', PARTNER: '파트너' };
const POPUP_EMPTY = { title: '', body: '', linkUrl: '', linkLabel: '', audience: ['GUEST', 'MEMBER'], startsAt: '', endsAt: '', priority: '100' };

function PopupPreview({ p }: { p: { title: string; body: string; linkUrl: string; linkLabel: string } }) {
  return (
    <div className="card pad" data-prx-preview="" role="dialog" aria-label="미리 보기" style={{ maxWidth: 420, borderRadius: 'var(--r-md)', boxShadow: 'var(--sgb-shadow-up)' }}>
      <b style={{ fontSize: 18 }}>{p.title || '(제목)'}</b>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{p.body}</p>
      {p.linkUrl && <p><span className="btn-sm">{p.linkLabel || '자세히'}</span> <span className="mono">{p.linkUrl}</span></p>}
      <p className="dim">[오늘 하루 안 보기] [닫기] — 사용자 웹 메인에 이렇게 뜹니다</p>
    </div>
  );
}

export function PrxPopups() {
  const q = useApi<{ items: Popup[]; max: number; note: string }>('/admin/prx/popups');
  const a = useAct();
  const [f, setF] = useState({ ...POPUP_EMPTY });
  const [edit, setEdit] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const body = () => JSON.stringify({ title: f.title, body: f.body, linkUrl: f.linkUrl || undefined, linkLabel: f.linkLabel || undefined, audience: f.audience,
    startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), priority: Number(f.priority) });
  const save = () => void a.run('sv', () => edit ? api(`/admin/prx/popups/${edit}`, { method: 'PUT', body: body() }) : api('/admin/prx/popups', { method: 'POST', body: body() }),
    () => { setF({ ...POPUP_EMPTY }); setEdit(null); q.reload(); });
  return (
    <section data-prx-popups={d.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-prx-popup-form={edit ? 'edit' : 'new'}>
        <b>{edit ? '팝업 고치기' : '새 팝업(꺼진 채로 만듦)'}</b>
        <p><input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목(2 ~ 80자)" data-prx-popup-title="" /></p>
        <p><textarea rows={4} cols={60} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="글(1,000자까지)" /></p>
        <p>
          <input className="inp" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} placeholder="단추 주소(/support 또는 https://…) — 비우면 단추 없음" />{' '}
          <input className="inp" value={f.linkLabel} onChange={(e) => setF({ ...f, linkLabel: e.target.value })} placeholder="단추 이름(자세히)" />
        </p>
        <p>
          대상 {Object.entries(AUD).map(([k, t]) => (
            <label key={k}><input type="checkbox" checked={f.audience.includes(k)} onChange={(e) => setF({ ...f, audience: e.target.checked ? [...f.audience, k] : f.audience.filter((x) => x !== k) })} /> {t} </label>
          ))}
          {' '}· 순서 <input className="inp-sm" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value.replace(/\D/g, '') })} /> <span className="dim">작을수록 먼저</span>
        </p>
        <p>
          <label>시작 <input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></label>{' '}
          <label>끝 <input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>
        </p>
        <PopupPreview p={f} />
        <p>
          <button className="btn-ok" disabled={!!a.busy || f.title.trim().length < 2 || !f.startsAt || !f.endsAt || !f.audience.length} onClick={save} data-prx-popup-save="">{edit ? '저장' : '만들기'}</button>{' '}
          {edit && <button className="btn-sm btn-plain" onClick={() => { setEdit(null); setF({ ...POPUP_EMPTY }); }}>닫기</button>}
        </p>
      </div>
      <table className="tbl" data-prx-popup-list={d.items.length}><thead><tr><th>제목</th><th>대상</th><th>기간</th><th>순서</th><th>상태</th><th></th></tr></thead>
        <tbody>{d.items.map((p) => (
          <tr key={p.id} data-prx-popup={p.id}>
            <td>{p.title}</td><td>{p.audience.map((x) => AUD[x] ?? x).join(' · ')}</td><td>{ymdhm(p.startsAt)} ~ {ymdhm(p.endsAt)}</td><td>{p.priority}</td>
            <td>{p.live ? <b>보이는 중</b> : p.isOn ? '켜짐(기간 밖)' : '꺼짐'}</td>
            <td>
              <button className="btn-sm btn-plain" onClick={() => { setEdit(p.id); setF({ title: p.title, body: p.body, linkUrl: p.linkUrl ?? '', linkLabel: p.linkLabel ?? '', audience: p.audience, startsAt: toLocal(p.startsAt), endsAt: toLocal(p.endsAt), priority: String(p.priority) }); }}>고치기</button>{' '}
              <button className="btn-sm" onClick={() => void a.run('tg', () => api(`/admin/prx/popups/${p.id}/toggle`, { method: 'POST', body: JSON.stringify({ on: !p.isOn }) }), q.reload)} data-prx-popup-toggle="">{p.isOn ? '끄기' : '켜기'}</button>
            </td>
          </tr>
        ))}</tbody></table>
      <div className="ad-nt info">{d.note} 회원이 「오늘 하루 안 보기」를 눌러도 서버에는 아무것도 남지 않습니다(그 브라우저에만).</div>
    </section>
  );
}

/* ── v10.518 기간 한정 추천 이벤트 ──────────────────────────────── */
interface RefEvent { id: string; title: string; startsAt: string; endsAt: string; points: number; budget: number; used: number; state: string; endReason: string | null; noticeText: string; noticePreview: string;
  checkTerms: boolean; checkNotice: boolean; checkBy: string | null; checkOn: string | null; checkMemo: string | null; checkedAt: string | null; rewards: number; live: boolean }
interface RefView { ruleOn: boolean; basePoints: number; monthlyCap: number | null; switchOn: boolean; items: RefEvent[]; noticeDefault: string; note: string }
const EV_STATE: Record<string, string> = { DRAFT: '초안', ACTIVE: '진행(예약 포함)', ENDED: '끝', CANCELED: '취소' };
const EV_END: Record<string, string> = { PERIOD: '기간 끝', BUDGET: '예산 다 씀', MANUAL: '운영자가 끝냄', CANCELED: '취소' };

function CheckBox({ ev, onDone }: { ev: RefEvent; onDone: () => void }) {
  const a = useAct();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const [c, setC] = useState({ terms: ev.checkTerms, notice: ev.checkNotice, by: ev.checkBy ?? '', on: ev.checkOn ?? today, memo: ev.checkMemo ?? '' });
  return (
    <div className="card pad" data-prx-check={ev.id}>
      <Flash msg={a.msg} err={a.err} />
      <b>시행 전 확인 — 둘 다 「예」여야 시작할 수 있습니다(DB 도 막음)</b>
      <p><label><input type="checkbox" checked={c.terms} onChange={(e) => setC({ ...c, terms: e.target.checked })} data-prx-check-terms="" /> 약관 확인 — 추천 보상 · 포인트 약관 · 개인정보처리방침과 맞음</label></p>
      <p><label><input type="checkbox" checked={c.notice} onChange={(e) => setC({ ...c, notice: e.target.checked })} data-prx-check-notice="" /> 안내 문구 확인 — 기간 · 금액 · 예산 소진 때 조기 종료 · 지급 시점 · 1단계만</label></p>
      <p>
        <input className="inp" value={c.by} onChange={(e) => setC({ ...c, by: e.target.value })} placeholder="확인한 곳(법무 · 내부 등)" />{' '}
        <input type="date" value={c.on} onChange={(e) => setC({ ...c, on: e.target.value })} />{' '}
        <input className="inp" value={c.memo} onChange={(e) => setC({ ...c, memo: e.target.value })} placeholder="메모" />{' '}
        <button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('ck', () => api(`/admin/prx/ref-events/${ev.id}/check`, { method: 'PUT', body: JSON.stringify(c) }), onDone)} data-prx-check-save="">확인 적기</button>
      </p>
    </div>
  );
}

export function PrxRefEvents() {
  const q = useApi<RefView>('/admin/prx/ref-events');
  const a = useAct();
  const [f, setF] = useState({ title: '', startsAt: '', endsAt: '', points: '', budget: '', noticeText: '' });
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const sup = isSuper();
  const cur = d.items.find((x) => x.id === sel) ?? null;
  return (
    <section data-prx-refevents={d.items.length} data-prx-switch={d.switchOn ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        <tr><th>평소 직접 추천 보상</th><td>{d.ruleOn ? '켜짐' : <span className="warn-text">꺼짐 — 이벤트를 시작할 수 없습니다</span>} · {n(d.basePoints)}점 · 한 달 상한 {d.monthlyCap ?? '없음'}</td></tr>
        <tr><th>이벤트 스위치</th><td>{d.switchOn ? '켜짐' : '꺼짐(처음)'}{sup && <> {' '}<button className="btn-sm" onClick={() => { const why = prompt(d.switchOn ? '끄는 사유' : '켜는 사유(법무 확인 뒤)') ?? ''; if (why.trim().length >= 2) void a.run('sw', () => api('/admin/prx/ref-events/switch', { method: 'PUT', body: JSON.stringify({ on: !d.switchOn, reason: why }) }), q.reload); }} data-prx-switch-btn="">{d.switchOn ? '끄기' : '켜기'}</button></>}</td></tr>
      </tbody></table>
      <div className="card pad" data-prx-event-new="">
        <b>새 이벤트(초안)</b>
        <p>
          <input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="이벤트 이름" />{' '}
          <label>시작 <input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></label>{' '}
          <label>끝 <input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>
        </p>
        <p>
          <label>이벤트 점수 <input className="inp-sm" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value.replace(/\D/g, '') })} /></label>{' '}
          <label>예산(점수 합) <input className="inp" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value.replace(/\D/g, '') })} /></label>
        </p>
        <p><textarea rows={6} cols={80} value={f.noticeText} onChange={(e) => setF({ ...f, noticeText: e.target.value })} placeholder={d.noticeDefault} /></p>
        <p className="dim">비우면 위 처음 틀 — {'{from} {until} {points} {base} {budget}'} 은 저장 뒤 채워 보여 드립니다.</p>
        <p><button className="btn-ok" disabled={!!a.busy || f.title.trim().length < 2 || !f.startsAt || !f.endsAt || !f.points || !f.budget}
          onClick={() => void a.run('new', () => api<{ id: string }>('/admin/prx/ref-events', { method: 'POST', body: JSON.stringify({ title: f.title, startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), points: Number(f.points), budget: Number(f.budget), noticeText: f.noticeText || undefined }) }).then((r) => { setSel(r.id); return r; }),
            () => { setF({ title: '', startsAt: '', endsAt: '', points: '', budget: '', noticeText: '' }); q.reload(); })} data-prx-event-create="">초안 만들기</button></p>
      </div>
      <table className="tbl" data-prx-event-list={d.items.length}><thead><tr><th>이름</th><th>기간</th><th>점수</th><th>예산 · 씀</th><th>보상</th><th>확인</th><th>상태</th></tr></thead>
        <tbody>{d.items.map((e) => (
          <tr key={e.id} onClick={() => setSel(e.id)} className={sel === e.id ? 'on' : ''} data-prx-event={e.state}>
            <td>{e.title}</td><td>{ymdhm(e.startsAt)} ~ {ymdhm(e.endsAt)}</td><td>{n(e.points)}</td><td>{n(e.budget)} · {n(e.used)}</td><td>{n(e.rewards)}</td>
            <td>{e.checkTerms && e.checkNotice ? `예 · ${e.checkBy ?? ''} ${e.checkOn ?? ''}` : <span className="warn-text">아직</span>}</td>
            <td>{EV_STATE[e.state] ?? e.state}{e.live ? ' · 지금 적용' : ''}{e.endReason ? ` · ${EV_END[e.endReason] ?? e.endReason}` : ''}</td>
          </tr>
        ))}</tbody></table>
      {cur && (
        <div className="card pad" data-prx-event-detail={cur.state}>
          <b>{cur.title}</b>
          <pre className="card pad" data-prx-notice="">{cur.noticePreview}</pre>
          {cur.state === 'DRAFT' && <CheckBox ev={cur} onDone={q.reload} />}
          <p>
            {sup && cur.state === 'DRAFT' && <button className="btn-ok" disabled={!!a.busy || !(cur.checkTerms && cur.checkNotice)} onClick={() => { if (confirm('이 이벤트를 시작합니다. 기간 안 첫 본인인증부터 이벤트 점수가 나갑니다.')) void a.run('st', () => api(`/admin/prx/ref-events/${cur.id}/start`, { method: 'POST' }), q.reload); }} data-prx-event-start="">시작(최고 관리자)</button>}{' '}
            {sup && ['DRAFT', 'ACTIVE'].includes(cur.state) && <button className="btn-sm btn-plain" onClick={() => { if (confirm(cur.state === 'ACTIVE' ? '이벤트를 지금 끝냅니다(이미 준 보상은 그대로).' : '초안을 취소합니다.')) void a.run('ed', () => api(`/admin/prx/ref-events/${cur.id}/end`, { method: 'POST' }), q.reload); }} data-prx-event-end="">{cur.state === 'ACTIVE' ? '끝내기' : '취소'}</button>}
          </p>
        </div>
      )}
      <div className="ad-nt info">{d.note} 회원에게 알릴 때는 「노출 › 메인 팝업」에 안내 문구를 붙여 쓰십시오. 여러 단계 추천 보상은 만들지 않습니다(다단계 아님 — 제휴 결정 기록).</div>
    </section>
  );
}

/* ── v10.519 광고 성과 보고서 ──────────────────────────────────── */
type Cycle = 'DAILY' | 'WEEKLY' | 'MONTHLY';
interface RepRow { id: string; advertiserId: string; advertiser: string; code: string; cycle: Cycle; period: string; impressions: number; clicks: number; cost: number; costTotal: number; ctr: number | null; cpc: number | null; cpm: number | null;
  madeAt: string; mailState: string | null; mailedAt: string | null; to: string | null; hasMail: boolean }
interface RepView { period: string; cycle: Cycle; label: string; settings: { mailOn: boolean; cycle: Cycle }; lastKeys: Record<Cycle, string>; items: RepRow[]; advertisers: Array<{ id: string; name: string; code: string }>;
  creatives: Array<{ id: string; code: string | null; advertiser: string | null; slot: string | null; advertiserId: string | null; linked: boolean }>; unlinked: number; note: string }
interface RepDetail { label: string; advertiser: string; code: string; bizRegNo: string | null; impressions: number; clicks: number; cost: number; costTotal: number; ctr: number | null; cpc: number | null; cpm: number | null;
  lines: Array<{ code: string | null; slot: string | null; impressions: number; clicks: number; ctr: number | null }>; mailText: string }
const MAIL: Record<string, string> = { SENT: '보냄', FAILED: '실패', NOT_READY: '메일 준비 안 됨', NO_ADDRESS: '메일 주소 없음', OFF: '꺼짐' };
const CYCLE: Record<Cycle, string> = { DAILY: '매일(어제 하루)', WEEKLY: '매주 월요일(지난주)', MONTHLY: '매달 1일(지난달)' };

function printReport(r: RepDetail) {
  const body = `<h1>광고 성과 보고서</h1>
    <table class="meta"><tr><td>광고주</td><td><b>${esc(r.advertiser)}</b> (${esc(r.code)})${r.bizRegNo ? ' · ' + esc(r.bizRegNo) : ''}</td><td>기간</td><td>${esc(r.label)}</td></tr></table>
    <table><thead><tr><th>노출</th><th>클릭</th><th>클릭률</th><th>광고비(부가세 별도)</th><th>부가세 포함</th><th>클릭당</th><th>천 회 노출당</th></tr></thead>
      <tbody><tr class="sum"><td class="r">${n(r.impressions)}</td><td class="r">${n(r.clicks)}</td><td class="r">${esc(pct(r.ctr))}</td><td class="r">${n(r.cost)}원</td><td class="r">${n(r.costTotal)}원</td>
        <td class="r">${r.cpc == null ? '—' : n(r.cpc) + '원'}</td><td class="r">${r.cpm == null ? '—' : n(r.cpm) + '원'}</td></tr></tbody></table>
    <table><thead><tr><th>소재</th><th>자리</th><th>노출</th><th>클릭</th><th>클릭률</th></tr></thead>
      <tbody>${r.lines.map((l) => `<tr><td>${esc(l.code ?? '—')}</td><td>${esc(l.slot ?? '—')}</td><td class="r">${n(l.impressions)}</td><td class="r">${n(l.clicks)}</td><td class="r">${esc(pct(l.ctr))}</td></tr>`).join('')}</tbody></table>
    <p class="small">노출 · 클릭은 소개뱅크 광고 기록, 광고비는 청구서를 그 기간에 걸친 날수로 나눈 값입니다. 이용자 개인 정보는 들어 있지 않습니다.</p>`;
  if (!openPrint({ title: `광고성과_${r.label.replace(/[^0-9A-Za-z~-]/g, '')}_${r.advertiser}`, body, kind: 'OTHER' })) alert('팝업이 막혀 보고서 창을 열지 못했습니다 — 팝업 차단을 풀고 다시 누르십시오.');
}

export function PrxAdReports() {
  const [period, setPeriod] = useState('');
  const q = useApi<RepView>(`/admin/prx/ad-reports${period ? `?period=${encodeURIComponent(period)}` : ''}`, [period]);
  const a = useAct();
  const [mailPv, setMailPv] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const sup = isSuper();
  const st = d.settings;
  const open = (id: string, then: (r: RepDetail) => void) => void a.run('op', () => api<RepDetail>(`/admin/prx/ad-reports/${id}`).then((r) => { then(r); return r; }), undefined, '보고서를 열었습니다.');
  const saveSet = (b: { on?: boolean; cycle?: Cycle }, ask: string) => { const why = prompt(ask) ?? ''; if (why.trim().length >= 2) void a.run('sw', () => api('/admin/prx/ad-reports/switch', { method: 'PUT', body: JSON.stringify({ ...b, reason: why }) }), q.reload); };
  return (
    <section data-prx-adreports={d.items.length} data-prx-mail={st.mailOn ? 'on' : 'off'} data-prx-cycle={st.cycle}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        <tr><th>메일</th><td>{st.mailOn ? '켜짐' : '꺼짐(처음) — 메일 준비가 된 뒤 최고 관리자가 켭니다'}{sup && <> <button className="btn-sm" onClick={() => saveSet({ on: !st.mailOn }, st.mailOn ? '끄는 사유' : '켜는 사유(법무 확인 대표 11/20 · 메일 준비 됨)')} data-prx-mail-btn="">{st.mailOn ? '끄기' : '켜기'}</button></>}</td></tr>
        <tr><th>보내는 주기</th><td>{CYCLE[st.cycle]}{sup && <> {' '}
          <select value={st.cycle} onChange={(e) => saveSet({ cycle: e.target.value as Cycle }, '주기를 바꾸는 사유')} data-prx-cycle-sel="">{(Object.keys(CYCLE) as Cycle[]).map((c) => <option key={c} value={c}>{CYCLE[c]}</option>)}</select></>}
          <span className="dim"> · 매일 08:10 지난 기간 보고서를 만들고(메일 켜짐이면) 보냅니다 · 같은 기간은 두 번 보내지 않습니다</span></td></tr>
      </tbody></table>
      <p>
        <label>기간 <select value={d.cycle} onChange={(e) => setPeriod(d.lastKeys[e.target.value as Cycle])}>{(Object.keys(CYCLE) as Cycle[]).map((c) => <option key={c} value={c}>{c === 'DAILY' ? '하루' : c === 'WEEKLY' ? '주' : '달'}</option>)}</select></label>{' '}
        {d.cycle === 'MONTHLY' && <input type="month" value={d.period} onChange={(e) => setPeriod(e.target.value)} />}
        {d.cycle === 'DAILY' && <input type="date" value={d.period} onChange={(e) => setPeriod(e.target.value)} />}
        {d.cycle === 'WEEKLY' && <input type="date" value={d.period.slice(1)} onChange={(e) => { const t = new Date(`${e.target.value}T00:00:00Z`); if (!isNaN(t.getTime())) { t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); setPeriod(`W${t.toISOString().slice(0, 10)}`); } }} title="고른 날의 그 주(월 ~ 일)" />}
        {' '}<b>{d.label}</b>{' '}
        <button className="btn-ok" disabled={!!a.busy} onClick={() => void a.run('mk', () => api('/admin/prx/ad-reports/make', { method: 'POST', body: JSON.stringify({ period: d.period }) }), q.reload)} data-prx-report-make="">보고서 만들기</button>
      </p>
      <table className="tbl" data-prx-report-list={d.items.length}><thead><tr><th>광고주</th><th>노출</th><th>클릭</th><th>클릭률</th><th>광고비</th><th>클릭당</th><th>메일</th><th></th></tr></thead>
        <tbody>{d.items.map((r) => (
          <tr key={r.id} data-prx-report={r.id}>
            <td>{r.advertiser}</td><td>{n(r.impressions)}</td><td>{n(r.clicks)}</td><td>{pct(r.ctr)}</td><td>{n(r.cost)}원</td><td>{r.cpc == null ? '—' : `${n(r.cpc)}원`}</td>
            <td>{r.mailState ? `${MAIL[r.mailState] ?? r.mailState}${r.to ? ` · ${r.to}` : ''}` : r.hasMail ? '안 보냄' : '주소 없음'}</td>
            <td>
              <button className="btn-sm" onClick={() => open(r.id, printReport)} data-prx-report-print="">인쇄 · PDF</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => open(r.id, (x) => setMailPv(x.mailText))}>메일 미리 보기</button>{' '}
              {sup && st.mailOn && r.mailState !== 'SENT' && <button className="btn-sm" onClick={() => { if (confirm(`${r.advertiser} 담당자에게 보고서 메일을 보냅니다.`)) void a.run('sd', () => api(`/admin/prx/ad-reports/${r.id}/send`, { method: 'POST' }), q.reload); }}>메일 보내기</button>}
            </td>
          </tr>
        ))}</tbody></table>
      {mailPv && <pre className="card pad" data-prx-mail-preview="">{mailPv}</pre>}
      <details className="card pad" data-prx-owners={d.unlinked}>
        <summary>소재 → 광고주 잇기 · 광고주를 못 찾은 소재 {d.unlinked}개</summary>
        <table className="tbl"><thead><tr><th>소재</th><th>자리</th><th>소재의 광고주 이름</th><th>보고서 광고주</th></tr></thead>
          <tbody>{d.creatives.map((c) => (
            <tr key={c.id}><td className="mono">{c.code ?? '—'}</td><td>{c.slot ?? '—'}</td><td>{c.advertiser ?? '—'}</td>
              <td><select value={c.linked ? c.advertiserId ?? '' : ''} onChange={(e) => void a.run('ow', () => api(`/admin/prx/ad-owners/${c.id}`, { method: 'PUT', body: JSON.stringify({ advertiserId: e.target.value }) }), q.reload)}>
                <option value="">{c.advertiserId && !c.linked ? `이름으로 찾음: ${d.advertisers.find((x) => x.id === c.advertiserId)?.name ?? ''}` : '(이름으로 찾기)'}</option>
                {d.advertisers.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
              </select>{!c.advertiserId && <span className="warn-text"> 못 찾음</span>}</td></tr>
          ))}</tbody></table>
      </details>
      <div className="ad-nt info">{d.note} 메일은 법무 확인을 마쳤습니다(대표 11/20) — 켜는 것은 메일 준비가 된 뒤입니다.</div>
    </section>
  );
}

/* ── v10.520 광고 소재 비교 시험 ───────────────────────────────── */
interface AbRow { id: string; title: string; slot: string; codeA: string; codeB: string; advertiser: string | null; startsAt: string; endsAt: string; state: string; served: number; result: AbResult | null }
interface Side { code: string; impressions: number; clicks: number; ctr: number | null }
interface AbResult { a: Side; b: Side; z: number | null; winner: 'A' | 'B' | null; verdict: string; minImpr: number; from: string; until: string }
const AB_STATE: Record<string, string> = { DRAFT: '초안', RUNNING: '진행', ENDED: '끝', CANCELED: '취소' };
const VERDICT: Record<string, string> = { A: 'A 가 더 많이 눌림', B: 'B 가 더 많이 눌림', TIE: '차이 없음(95% 기준)', LOW_SAMPLE: '표본 부족' };

function AbResultBox({ id }: { id: string }) {
  const q = useApi<{ state: string; fixed: boolean; result: AbResult }>(`/admin/prx/ab-tests/${id}`, [id]);
  const r = q.data?.result;
  if (!r) return null;
  return (
    <table className="tbl" data-prx-ab-result={r.verdict}><thead><tr><th></th><th>소재</th><th>노출</th><th>클릭</th><th>클릭률</th></tr></thead>
      <tbody>
        {(['a', 'b'] as const).map((k) => <tr key={k}><td>{k.toUpperCase()}</td><td className="mono">{r[k].code}</td><td>{n(r[k].impressions)}</td><td>{n(r[k].clicks)}</td><td>{pct(r[k].ctr)}</td></tr>)}
        <tr><td colSpan={5}>{q.data?.fixed ? '결과(고정)' : '지금까지'} — <b>{VERDICT[r.verdict] ?? r.verdict}</b> · z {r.z ?? '—'} · 소재마다 {n(r.minImpr)}회 넘게 노출돼야 판단</td></tr>
      </tbody></table>
  );
}

export function PrxAbTests() {
  const q = useApi<{ items: AbRow[]; creatives: Array<{ code: string; advertiser: string | null; slot: string; status: string; title: string | null }>; minImpr: number; note: string }>('/admin/prx/ab-tests');
  const a = useAct();
  const [f, setF] = useState({ title: '', codeA: '', codeB: '', startsAt: '', endsAt: '' });
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const ca = d.creatives.find((c) => c.code === f.codeA);
  const pairs = d.creatives.filter((c) => !ca || (c.slot === ca.slot && (c.advertiser ?? '').trim().toLowerCase() === (ca.advertiser ?? '').trim().toLowerCase() && c.code !== ca.code));
  const act = (id: string, what: 'start' | 'end' | 'cancel') => void a.run(what, () => api(`/admin/prx/ab-tests/${id}/${what}`, { method: 'POST' }), q.reload);
  return (
    <section data-prx-abtests={d.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-prx-ab-new="">
        <b>새 비교 시험(초안)</b>
        <p>
          <input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="시험 이름" />{' '}
          <select value={f.codeA} onChange={(e) => setF({ ...f, codeA: e.target.value, codeB: '' })}><option value="">소재 A</option>{d.creatives.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.slot} · {c.advertiser ?? ''} · {c.status}</option>)}</select>{' '}
          <select value={f.codeB} onChange={(e) => setF({ ...f, codeB: e.target.value })} disabled={!f.codeA}><option value="">소재 B(같은 자리 · 같은 광고주)</option>{pairs.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.status}</option>)}</select>
        </p>
        <p>
          <label>시작 <input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></label>{' '}
          <label>끝 <input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>{' '}
          <button className="btn-ok" disabled={!!a.busy || f.title.trim().length < 2 || !f.codeA || !f.codeB || !f.startsAt || !f.endsAt}
            onClick={() => void a.run('new', () => api('/admin/prx/ab-tests', { method: 'POST', body: JSON.stringify({ ...f, startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt) }) }), () => { setF({ title: '', codeA: '', codeB: '', startsAt: '', endsAt: '' }); q.reload(); })} data-prx-ab-create="">초안 만들기</button>
        </p>
      </div>
      <table className="tbl" data-prx-ab-list={d.items.length}><thead><tr><th>이름</th><th>자리</th><th>A · B</th><th>기간</th><th>번갈아 낸 수</th><th>상태</th><th></th></tr></thead>
        <tbody>{d.items.map((t) => (
          <tr key={t.id} onClick={() => setSel(t.id)} className={sel === t.id ? 'on' : ''} data-prx-ab={t.state}>
            <td>{t.title}</td><td>{t.slot}</td><td className="mono">{t.codeA} · {t.codeB}</td><td>{ymdhm(t.startsAt)} ~ {ymdhm(t.endsAt)}</td><td>{n(t.served)}</td>
            <td>{AB_STATE[t.state] ?? t.state}{t.result ? ` · ${VERDICT[t.result.verdict] ?? t.result.verdict}` : ''}</td>
            <td>
              {t.state === 'DRAFT' && <button className="btn-sm" onClick={(e) => { e.stopPropagation(); act(t.id, 'start'); }} data-prx-ab-start="">시작</button>}{' '}
              {t.state === 'RUNNING' && <button className="btn-sm" onClick={(e) => { e.stopPropagation(); if (confirm('지금 끝내고 결과를 고정합니다.')) act(t.id, 'end'); }}>끝내기</button>}{' '}
              {['DRAFT', 'RUNNING'].includes(t.state) && <button className="btn-sm btn-plain" onClick={(e) => { e.stopPropagation(); if (confirm('시험을 취소합니다(결과 없음).')) act(t.id, 'cancel'); }}>취소</button>}
            </td>
          </tr>
        ))}</tbody></table>
      {sel && <AbResultBox id={sel} />}
      <div className="ad-nt info">{d.note} 결과는 소재마다 노출 · 클릭 숫자뿐이며 누가 봤는지는 남기지 않습니다.</div>
    </section>
  );
}
