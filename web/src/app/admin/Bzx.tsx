/* ===== v10.609 ~ 614 (docs/751 ~ 756) 18차 파트너 · 고객센터 · 회계 · 인사 — web/src/app/admin/Bzx.tsx 새 파일 =====
 * 파트너사 › 파트너 계약 갱신(SB-ADM-BZX-010)   BzxPartnerContracts  만기 · 갱신 보내기 · 종이 계약 적기 · 상태 확인 · 취소 · 본문
 * 광고 › 광고 예산(SB-ADM-BZX-020)              BzxAdBudgets         소재마다 노출 · 클릭 상한 · 알림 기준 · 자동 정지 · 다시 채움 · 끄기
 * 회원 › 1:1 문의 한 건 안(탭 아님)             BzxInquiryPhotos     접수 첨부 · 더한 사진 · 답변 사진 미리 보기 · 답변 사진 붙이기
 * 회원 › 답변 품질(SB-ADM-BZX-030)              BzxCsQuality         상담원별 지표 · 표본 점검
 * 회계 › 카드 사용 알림(SB-ADM-BZX-040)         BzxCardNotices       사용 알림 목록 · 큰 금액 기준 · 지금 보내기
 * 회계 › 인건비 시뮬레이션(SB-ADM-BZX-050)      BzxHcSim             채용 줄 → 달마다 급여 · 회사 4대보험 · 퇴직금 적립 · 계획 저장
 * 스위치는 각 화면 위 상자(SUPER 만 바꿈 · 사유) · 새 CSS 없음(기존 tbl · card · pad · btn-sm · btn-ok · btn-plain · inp · dim · mono · warn-text)
 * (adminMenu · App.tsx · InquiryDesk 연결 줄은 patches/1_bzx_wiring.md)
 */
import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymd, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { uploadFile, type Purpose } from '../../lib/files';

const isSuper = () => tokenRoles().includes('SUPER');

/* ── 스위치 상자(공통) ── */
interface Sw { key: string; label: string; on: boolean }
function BzxSwitches({ keys }: { keys: string[] }) {
  const q = useApi<Sw[]>('/admin/bzx/switches');
  const a = useAct();
  const rows = (q.data ?? []).filter((s) => keys.includes(s.key));
  const flip = (s: Sw) => {
    const reason = prompt(`${s.label} — ${s.on ? '끕니다' : '켭니다'}. 사유(2 ~ 200자)`);
    if (!reason || reason.trim().length < 2) return;
    void a.run('sw', () => api('/admin/bzx/switch', { method: 'PUT', body: JSON.stringify({ key: s.key, on: !s.on, reason }) }), q.reload);
  };
  if (!rows.length) return null;
  return (
    <div className="card pad" data-bzx-switches={rows.map((r) => `${r.key}=${r.on ? 'on' : 'off'}`).join(',')}>
      <Flash msg={a.msg} err={a.err} />
      {rows.map((s) => (
        <p key={s.key}>
          <b>{s.on ? '켜짐' : '꺼짐'}</b> · {s.label} <span className="mono dim">{s.key}</span>{' '}
          {isSuper() && <button className="btn-sm" disabled={!!a.busy} onClick={() => flip(s)} data-bzx-switch={s.key}>{s.on ? '끄기' : '켜기'}</button>}
        </p>
      ))}
      {!isSuper() && <p className="dim">켜고 끄기는 최고 관리자(SUPER)만 합니다.</p>}
    </div>
  );
}

/* ── ㉕ v10.609 파트너 계약 갱신 ── */
interface Pc { id: string; partnerId: string; company: string; prevId: string | null; title: string; startOn: string; endOn: string; noticeDays: number; autoRenew: boolean;
  state: string; signMode: string; sentAt: string | null; signedAt: string | null; signerName: string | null; cancelReason: string | null; daysLeft: number; due: boolean;
  next: { id: string; state: string } | null }
interface PcList { items: Pc[]; partners: Array<{ id: string; company: string; status: string }>; signMode: string; ready: boolean; template: string | null; partnerNotice: boolean; note: string }
const PC_ST: Record<string, string> = { SENT: '서명 기다림', SIGNED: '효력 있음', EXPIRED: '만기 지남', ENDED: '갱신으로 끝남', CANCELED: '취소' };
const MODE_KO: Record<string, string> = { PAPER: '종이', ASSUME: '간주 서명', STUB: '시험 서명', MOCK: '시험 서명', HTTP: '전자계약' };

export function BzxPartnerContracts() {
  const [st, setSt] = useState('');
  const [due, setDue] = useState(false);
  const q = useApi<PcList>(`/admin/bzx/partner-contracts?state=${st}&due=${due ? 1 : 0}`);
  const a = useAct();
  const [f, setF] = useState({ partnerId: '', title: '', startOn: '', endOn: '', noticeDays: '30', autoRenew: false, paper: false });
  const [body, setBody] = useState<{ id: string; text: string } | null>(null);
  const d = q.data;
  const canEdit = tokenRoles().some((r) => r === 'ADMIN' || r === 'SUPER');
  if (!d) return <p className="muted">불러오는 중…</p>;
  const create = () => void a.run('new', () => api('/admin/bzx/partner-contracts', { method: 'POST', body: JSON.stringify({
    partnerId: f.partnerId, title: f.title || undefined, startOn: f.startOn || undefined, endOn: f.endOn, noticeDays: Number(f.noticeDays) || 30, autoRenew: f.autoRenew, paper: f.paper }) }),
    () => { setF({ ...f, title: '', startOn: '', endOn: '' }); q.reload(); });
  const renew = (c: Pc) => {
    const end = prompt(`${c.company} · ${c.title}\n갱신 계약 만기일(YYYY-MM-DD) — 시작은 지금 만기 다음 날`, '');
    if (!end) return;
    void a.run(`r${c.id}`, () => api('/admin/bzx/partner-contracts', { method: 'POST', body: JSON.stringify({ prevId: c.id, endOn: end.trim() }) }), q.reload);
  };
  const cancel = (c: Pc) => {
    const reason = prompt('취소 사유(2 ~ 200자)');
    if (!reason) return;
    void a.run(`c${c.id}`, () => api(`/admin/bzx/partner-contracts/${c.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload);
  };
  const show = (c: Pc) => void api<{ body: string | null; docHash: string | null; legal: string }>(`/admin/bzx/partner-contracts/${c.id}`)
    .then((r) => setBody({ id: c.id, text: `${r.legal}\n지문 ${r.docHash ?? '—'}\n\n${r.body ?? '(종이 계약 — 본문 없음)'}` })).catch(() => a.setErr('본문을 읽지 못했습니다.'));
  return (
    <section data-bzx-pc={d.items.length}>
      <BzxSwitches keys={['bzx.partner_esign', 'bzx.partner_notice']} />
      <p className={d.ready ? 'dim' : 'warn-text'} data-bzx-pc-mode={d.signMode}>{d.note} · 양식 파트너 표준계약서 {d.template ?? '없음'}판</p>
      <Flash msg={a.msg} err={a.err} />
      {canEdit && (
        <div className="card pad" data-bzx-pc-form="">
          <b>새 계약 보내기 · 종이 계약 적기</b>
          <p>
            <select value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })} data-bzx-pc-partner="">
              <option value="">파트너 고르기</option>
              {d.partners.map((p) => <option key={p.id} value={p.id}>{p.company}{p.status === 'SUSPENDED' ? ' (정지)' : ''}</option>)}
            </select>{' '}
            <input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="계약 이름(비우면 자동)" />
          </p>
          <p>
            <label>시작 <input type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></label>{' '}
            <label>만기 <input type="date" value={f.endOn} onChange={(e) => setF({ ...f, endOn: e.target.value })} data-bzx-pc-end="" /></label>{' '}
            <label>알림 <input className="inp-sm" value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value.replace(/\D/g, '') })} />일 전</label>{' '}
            <label><input type="checkbox" checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} /> 자동 갱신</label>{' '}
            <label><input type="checkbox" checked={f.paper} onChange={(e) => setF({ ...f, paper: e.target.checked })} data-bzx-pc-paper="" /> 이미 종이로 맺음(적기만)</label>
          </p>
          <button className="btn-ok" disabled={!!a.busy || !f.partnerId || !f.endOn} onClick={create} data-bzx-pc-create="">{f.paper ? '종이 계약 적기' : '서명 요청 보내기'}</button>
        </div>
      )}
      <p>
        <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">모든 상태</option>{Object.entries(PC_ST).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>{' '}
        <label><input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} data-bzx-pc-due="" /> 갱신할 때 된 것만</label>
      </p>
      <table className="tbl" data-bzx-pc-list={d.items.length}>
        <thead><tr><th>파트너</th><th>계약</th><th>기간</th><th>남은 날</th><th>상태</th><th>서명</th><th></th></tr></thead>
        <tbody>{d.items.map((c) => (
          <tr key={c.id} data-bzx-pc-row={c.id} className={c.due ? 'warn-text' : undefined}>
            <td>{c.company}</td><td>{c.title}{c.prevId ? <small className="dim"> · 갱신</small> : null}{c.autoRenew ? <small className="dim"> · 자동 갱신</small> : null}</td>
            <td>{c.startOn} ~ {c.endOn}</td><td>{c.state === 'SIGNED' ? `${c.daysLeft}일` : '—'}{c.due ? ' · 갱신할 때' : ''}</td>
            <td>{PC_ST[c.state] ?? c.state}{c.next ? <small className="dim"> · 갱신 {PC_ST[c.next.state] ?? c.next.state}</small> : null}</td>
            <td>{MODE_KO[c.signMode] ?? c.signMode}{c.signedAt ? ` · ${ymd(c.signedAt)}` : ''}</td>
            <td>
              <button className="btn-sm btn-plain" onClick={() => show(c)}>본문</button>{' '}
              {canEdit && c.state === 'SIGNED' && !c.next && <button className="btn-sm" disabled={!!a.busy} onClick={() => renew(c)} data-bzx-pc-renew={c.id}>갱신 보내기</button>}{' '}
              {canEdit && c.state === 'SENT' && c.signMode === 'HTTP' && <button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run(`k${c.id}`, () => api(`/admin/bzx/partner-contracts/${c.id}/check`, { method: 'POST' }), q.reload)}>상태 확인</button>}{' '}
              {canEdit && c.state === 'SENT' && <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => cancel(c)} data-bzx-pc-cancel={c.id}>취소</button>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {body && <div className="card pad" data-bzx-pc-body={body.id}><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{body.text}</pre><button className="btn-sm btn-plain" onClick={() => setBody(null)}>닫기</button></div>}
    </section>
  );
}

/* ── ㉖ v10.610 광고 예산 ── */
interface Ab { id: string; creativeId: string; code: string | null; title: string | null; advertiser: string | null; status: string; capKind: string; capValue: number; period: string;
  alertPct: number; autoPause: boolean; state: string; used: number; pct: number; nearAt: string | null; spentAt: string | null; pausedAt: string | null }
interface AbList { items: Ab[]; free: Array<{ creativeId: string; code: string | null; title: string | null; advertiser: string | null; status: string; suggest: number | null }>;
  events: Array<{ id: string; code: string | null; kind: string; used: number | null; cap: number | null; note: string | null; createdAt: string }>; autoPause: boolean; note: string }
const AB_ST: Record<string, string> = { ON: '셈 중', PAUSED_BY_BUDGET: '예산으로 멈춤', OFF: '끔' };
const EV_KO: Record<string, string> = { SET: '넣음 · 고침', NEAR: '기준 넘음', SPENT: '다 씀', PAUSED: '자동 정지', RESUMED: '다시 노출', RESET: '다시 채움', OFF: '끔' };

export function BzxAdBudgets() {
  const q = useApi<AbList>('/admin/bzx/ad-budgets');
  const a = useAct();
  const [f, setF] = useState({ creativeId: '', capKind: 'IMPRESSION', capValue: '', period: 'TOTAL', alertPct: '80', autoPause: false });
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const edit = (x: Ab) => setF({ creativeId: x.creativeId, capKind: x.capKind, capValue: String(x.capValue), period: x.period, alertPct: String(x.alertPct), autoPause: x.autoPause });
  const save = () => void a.run('save', () => api(`/admin/bzx/ad-budgets/${f.creativeId}`, { method: 'PUT', body: JSON.stringify({
    capKind: f.capKind, capValue: Number(f.capValue), period: f.period, alertPct: Number(f.alertPct), autoPause: f.autoPause }) }), () => { setF({ ...f, creativeId: '', capValue: '' }); q.reload(); });
  return (
    <section data-bzx-ad={d.items.length}>
      <BzxSwitches keys={['bzx.ad_autopause']} />
      <p className="dim">{d.note}</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-bzx-ad-form="">
        <b>예산 넣기 · 고치기</b>
        <p>
          <select value={f.creativeId} onChange={(e) => { const fr = d.free.find((x) => x.creativeId === e.target.value); setF({ ...f, creativeId: e.target.value, capValue: fr?.suggest ? String(fr.suggest) : f.capValue }); }} data-bzx-ad-pick="">
            <option value="">소재 고르기</option>
            {d.free.map((x) => <option key={x.creativeId} value={x.creativeId}>{x.code ?? x.creativeId.slice(0, 8)} · {x.title ?? ''}{x.suggest ? ` (예상 노출 ${n(x.suggest)})` : ''}</option>)}
            {d.items.map((x) => <option key={x.creativeId} value={x.creativeId}>{x.code ?? x.creativeId.slice(0, 8)} · 고치기</option>)}
          </select>{' '}
          <select value={f.capKind} onChange={(e) => setF({ ...f, capKind: e.target.value })}><option value="IMPRESSION">노출</option><option value="CLICK">클릭</option></select>{' '}
          <input className="inp-sm" value={f.capValue} onChange={(e) => setF({ ...f, capValue: e.target.value.replace(/\D/g, '') })} placeholder="상한" data-bzx-ad-cap="" />{' '}
          <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="TOTAL">기간 전체</option><option value="DAY">하루</option></select>{' '}
          알림 <input className="inp-sm" value={f.alertPct} onChange={(e) => setF({ ...f, alertPct: e.target.value.replace(/\D/g, '') })} />%{' '}
          <label><input type="checkbox" checked={f.autoPause} onChange={(e) => setF({ ...f, autoPause: e.target.checked })} /> 다 쓰면 자동 정지</label>
        </p>
        <button className="btn-ok" disabled={!!a.busy || !f.creativeId || !f.capValue} onClick={save} data-bzx-ad-save="">저장</button>{' '}
        <button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('run', () => api<{ checked?: number; near?: number; spent?: number; paused?: number }>('/admin/bzx/ad-budgets/run', { method: 'POST' }), q.reload,
          (r) => `점검 ${r.checked ?? 0} · 기준 넘음 ${r.near ?? 0} · 다 씀 ${r.spent ?? 0} · 멈춤 ${r.paused ?? 0}`)} data-bzx-ad-run="">지금 점검</button>
      </div>
      <table className="tbl" data-bzx-ad-list={d.items.length}>
        <thead><tr><th>소재</th><th>광고주</th><th>상한</th><th>쓴 양</th><th>상태</th><th></th></tr></thead>
        <tbody>{d.items.map((x) => (
          <tr key={x.id} data-bzx-ad-row={x.id} className={x.pct >= 100 ? 'warn-text' : undefined}>
            <td>{x.code ?? x.creativeId.slice(0, 8)} <small className="dim">{x.status}</small></td><td>{x.advertiser ?? '—'}</td>
            <td>{x.capKind === 'CLICK' ? '클릭' : '노출'} {n(x.capValue)} · {x.period === 'DAY' ? '하루' : '전체'} · 알림 {x.alertPct}%{x.autoPause ? ' · 자동 정지' : ''}</td>
            <td>{n(x.used)} ({x.pct}%)</td><td>{AB_ST[x.state] ?? x.state}</td>
            <td>
              <button className="btn-sm btn-plain" onClick={() => edit(x)}>고치기</button>{' '}
              {x.state !== 'OFF' && <button className="btn-sm" disabled={!!a.busy} onClick={() => confirm('셈을 다시 시작합니다(예산으로 멈춘 소재는 다시 노출).') && void a.run(`r${x.id}`, () => api(`/admin/bzx/ad-budgets/${x.id}/reset`, { method: 'POST' }), q.reload)} data-bzx-ad-reset={x.id}>다시 채움</button>}{' '}
              {x.state !== 'OFF' && <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => void a.run(`o${x.id}`, () => api(`/admin/bzx/ad-budgets/${x.id}/off`, { method: 'POST' }), q.reload)}>끄기</button>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      <details><summary>최근 기록 {d.events.length}</summary>
        <table className="tbl"><tbody>{d.events.map((e) => <tr key={e.id}><td>{ymdhm(e.createdAt)}</td><td>{e.code ?? '—'}</td><td>{EV_KO[e.kind] ?? e.kind}</td><td>{e.used != null ? n(e.used) : ''}{e.cap != null ? ` / ${n(e.cap)}` : ''}</td><td>{e.note ?? ''}</td></tr>)}</tbody></table>
      </details>
    </section>
  );
}

/* ── ㉗ v10.611 1:1 문의 사진(InquiryDesk 한 건 화면 안) ── */
interface PhotoRow { fileId: string; side: string; name: string; contentType: string }
const SIDE_KO: Record<string, string> = { ASK: '접수 첨부', MEMBER: '회원이 더함', STAFF: '답변 사진' };
function Thumb({ p }: { p: PhotoRow }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!p.contentType.startsWith('image/')) return;
    let live = true;
    api<{ url?: string }>(`/files/${p.fileId}?disposition=inline`).then((r) => { if (live && r.url) setUrl(r.url); }).catch(() => undefined);
    return () => { live = false; };
  }, [p.fileId, p.contentType]);
  const open = () => void api<{ url?: string }>(`/files/${p.fileId}?disposition=inline`).then((r) => { if (r.url) window.open(r.url, '_blank', 'noopener'); }).catch(() => undefined);
  return (
    <button type="button" className="btn-plain" onClick={open} data-bzx-inq-thumb={p.side} title={`${SIDE_KO[p.side] ?? p.side} · ${p.name}`}>
      {url ? <img src={url} alt={p.name} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 'var(--r-sm)' }} /> : <span className="mono">{p.contentType === 'application/pdf' ? 'PDF' : '그림'}</span>}
      <br /><small className="dim">{SIDE_KO[p.side] ?? p.side}</small>
    </button>
  );
}
export function BzxInquiryPhotos({ id, closed }: { id: string; closed?: boolean }) {
  const q = useApi<{ on: boolean; max: number; first: PhotoRow[]; items: PhotoRow[] }>(`/admin/bzx/inquiries/${id}/photos`);
  const a = useAct();
  const d = q.data;
  if (!d) return null;
  const all = [...d.first, ...d.items];
  const staff = d.items.filter((x) => x.side === 'STAFF').length;
  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, 3);
    if (!list.length) return;
    void a.run('up', async () => {
      const ids: string[] = [];
      for (const f of list) ids.push((await uploadFile(f, 'INQUIRY_ATTACHMENT' as unknown as Purpose)).fileId);
      return api(`/admin/bzx/inquiries/${id}/photos`, { method: 'POST', body: JSON.stringify({ fileIds: ids }) });
    }, q.reload);
  };
  return (
    <div data-bzx-inq-photos={all.length}>
      <Flash msg={a.msg} err={a.err} />
      {all.length > 0 && <p>{all.map((p) => <Thumb key={`${p.side}${p.fileId}`} p={p} />)}</p>}
      {d.on && !closed && staff < d.max && (
        <p><label className="btn-sm">답변 사진 붙이기(JPG · PNG · 한 번에 3장 · 문의마다 {d.max}장)
          <input type="file" accept="image/jpeg,image/png" multiple hidden disabled={!!a.busy} onChange={(e) => pick(e.target.files)} data-bzx-inq-upload="" /></label></p>
      )}
    </div>
  );
}

/* ── ㉘ v10.612 상담원별 답변 품질 ── */
interface Agent { agent: string; email: string | null; answered: number; edits: number; avgHours: number | null; inTimeRate: number | null; resolved: number; unresolved: number;
  resolvedRate: number | null; reopenRate: number | null; reviews: number; score: number | null; watch: string[] }
interface Sample { id: string; no: string; title: string; status: string; feedback: string | null; agent: string; email: string | null; answeredAt: string }
const pc = (v: number | null) => (v == null ? '—' : `${v}%`);

export function BzxCsQuality() {
  const [days, setDays] = useState(30);
  const q = useApi<{ days: number; agents: Agent[]; note: string }>(`/admin/bzx/cs-quality?days=${days}`);
  const [agent, setAgent] = useState('');
  const sq = useApi<{ items: Sample[] }>(`/admin/bzx/cs-quality/samples${agent ? `?agent=${agent}` : ''}`);
  const a = useAct();
  const [rv, setRv] = useState<{ id: string; accuracy: number; kindness: number; completeness: number; note: string } | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const send = () => rv && void a.run('rv', () => api('/admin/bzx/cs-quality/reviews', { method: 'POST', body: JSON.stringify({
    inquiryId: rv.id, accuracy: rv.accuracy, kindness: rv.kindness, completeness: rv.completeness, note: rv.note || undefined }) }), () => { setRv(null); sq.reload(); q.reload(); });
  const score = (k: 'accuracy' | 'kindness' | 'completeness', label: string) => rv && (
    <label>{label} <select value={rv[k]} onChange={(e) => setRv({ ...rv, [k]: Number(e.target.value) })} data-bzx-csq-score={k}>{[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{v}</option>)}</select> </label>
  );
  return (
    <section data-bzx-csq={d.agents.length}>
      <BzxSwitches keys={['bzx.inquiry_photos']} />
      <p>기간 <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 180].map((v) => <option key={v} value={v}>최근 {v}일</option>)}</select> <span className="dim">{d.note}</span></p>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl" data-bzx-csq-list={d.agents.length}>
        <thead><tr><th>상담원</th><th>처음 답</th><th>평균 시간</th><th>기한 안</th><th>해결률</th><th>다시 열림</th><th>고친 답</th><th>점검</th><th></th></tr></thead>
        <tbody>{d.agents.map((x) => (
          <tr key={x.agent} data-bzx-csq-agent={x.agent} className={x.watch.length ? 'warn-text' : undefined}>
            <td>{x.email ?? '—'}{x.watch.length ? <small> · 살펴볼 상담원({x.watch.join(' · ')})</small> : null}</td><td>{x.answered}</td><td>{x.avgHours ?? '—'}시간</td>
            <td>{pc(x.inTimeRate)}</td><td>{pc(x.resolvedRate)} <small className="dim">({x.resolved} / {x.resolved + x.unresolved})</small></td><td>{pc(x.reopenRate)}</td><td>{x.edits}</td>
            <td>{x.reviews ? `${x.score} 점 · ${x.reviews}건` : '—'}</td>
            <td><button className="btn-sm btn-plain" onClick={() => setAgent(x.agent)}>표본 고르기</button></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="card pad" data-bzx-csq-samples={(sq.data?.items ?? []).length}>
        <b>표본 점검</b> <span className="dim">남이 답한 · 내가 아직 점검 안 한 최근 문의{agent ? ' · 고른 상담원' : ''}</span>{agent && <button className="btn-sm btn-plain" onClick={() => setAgent('')}>모두</button>}
        <table className="tbl"><tbody>{(sq.data?.items ?? []).map((s) => (
          <tr key={s.id} data-bzx-csq-sample={s.id}>
            <td className="mono">{s.no}</td><td>{s.title}</td><td>{s.email ?? '—'}</td><td>{ymdhm(s.answeredAt)}</td>
            <td><a href="#/inquiries" title="1:1 문의에서 번호 · 제목으로 찾기">1:1 문의에서 보기</a>{' '}<button className="btn-sm" onClick={() => setRv({ id: s.id, accuracy: 5, kindness: 5, completeness: 5, note: '' })}>점검</button></td>
          </tr>
        ))}</tbody></table>
        {rv && (
          <p data-bzx-csq-form={rv.id}>
            {score('accuracy', '정확')}{score('kindness', '친절')}{score('completeness', '충분')}
            <input className="inp" value={rv.note} onChange={(e) => setRv({ ...rv, note: e.target.value })} placeholder="메모(300자까지 · 회원 정보는 적지 마십시오)" />{' '}
            <button className="btn-ok" disabled={!!a.busy} onClick={send} data-bzx-csq-send="">남기기</button> <button className="btn-sm btn-plain" onClick={() => setRv(null)}>닫기</button>
          </p>
        )}
      </div>
    </section>
  );
}

/* ── ㉙ v10.613 법인카드 사용 알림 ── */
interface Cn { id: string; txnId: string; tail: string | null; usedOn: string; merchant: string | null; amount: number; rules: string[]; state: string; sentAt: string | null; holder: string | null; cardName: string | null }
const CN_ST: Record<string, string> = { PENDING: '보낼 차례', SENT: '보냄', SKIPPED: '건너뜀(꺼진 동안)' };

export function BzxCardNotices() {
  const [ym, setYm] = useState(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7));
  const q = useApi<{ ym: string; items: Cn[]; counts: { pending: number; sent: number; skipped: number }; on: boolean; bigAmount: number; rules: Record<string, string>; note: string }>(`/admin/bzx/card-notices?ym=${ym}`);
  const a = useAct();
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const setBig = () => {
    const v = prompt('한 건 이 금액 이상이면 운영 알림(원 · 10,000 ~ 100,000,000)', String(d.bigAmount));
    if (!v) return;
    const reason = prompt('사유(2 ~ 200자)');
    if (!reason) return;
    void a.run('big', () => api('/admin/bzx/card-notices/settings', { method: 'PUT', body: JSON.stringify({ bigAmount: Number(v.replace(/\D/g, '')), reason }) }), q.reload);
  };
  return (
    <section data-bzx-cn={d.items.length}>
      <BzxSwitches keys={['bzx.card_notify']} />
      <p className="dim">{d.note}</p>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />{' '}
        보낼 차례 {d.counts.pending} · 보냄 {d.counts.sent} · 건너뜀 {d.counts.skipped}(최근 30일) · 큰 금액 기준 {n(d.bigAmount)}원{' '}
        {isSuper() && <button className="btn-sm btn-plain" onClick={setBig} data-bzx-cn-big="">기준 바꾸기</button>}{' '}
        <button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('run', () => api<{ on?: boolean; sent?: number; alerted?: number }>('/admin/bzx/card-notices/run', { method: 'POST' }), q.reload,
          (r) => (r.on ? `보냄 ${r.sent ?? 0} · 운영 알림 ${r.alerted ?? 0}` : '스위치가 꺼져 있어 보내지 않았습니다.'))} data-bzx-cn-run="">지금 보내기</button>
      </p>
      <table className="tbl" data-bzx-cn-list={d.items.length}>
        <thead><tr><th>날짜</th><th>카드</th><th>쓰는 사람</th><th>가맹점</th><th>금액</th><th>살펴볼 것</th><th>알림</th></tr></thead>
        <tbody>{d.items.map((x) => (
          <tr key={x.id} data-bzx-cn-row={x.id} className={x.rules.some((r) => r !== 'CANCEL' && r !== 'NEAR') ? 'warn-text' : undefined}>
            <td>{x.usedOn}</td><td>{x.cardName ?? '—'} <span className="mono">{x.tail ?? '—'}</span></td><td>{x.holder ?? '정하지 않음'}</td><td>{x.merchant ?? '—'}</td>
            <td>{n(x.amount)}</td><td>{x.rules.map((r) => d.rules[r] ?? r).join(' · ') || '—'}</td><td>{CN_ST[x.state] ?? x.state}{x.sentAt ? ` · ${ymdhm(x.sentAt)}` : ''}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

/* ── ㉚ v10.614 인건비 시뮬레이션 ── */
interface HcLine { role: string; count: number; monthlyBase: number; nontax: number; startYm: string; endYm: string | null }
interface HcResult { months: Array<{ ym: string; people: number; hires: number; gross: number; companyIns: number; severance: number; total: number; current: number }>;
  lines: Array<{ role: string; count: number; gross: number; companyIns: number; severance: number; total: number; shortStay: boolean }>;
  total: { gross: number; companyIns: number; severance: number; total: number; current: number; added: number }; draft: boolean; missingRates: string[]; note: string }
const ymNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const EMPTY_LINE = (): HcLine => ({ role: '', count: 1, monthlyBase: 3000000, nontax: 200000, startYm: ymNow(), endYm: null });

export function BzxHcSim() {
  const q = useApi<{ items: Array<{ id: string; title: string; startYm: string; months: number; lineCount: number; updatedBy: string | null; updatedAt: string }> }>('/admin/bzx/hc-plans');
  const a = useAct();
  const [id, setId] = useState<string | null>(null);
  const [p, setP] = useState({ title: '', startYm: ymNow(), months: 12, raisePct: 0, includeCurrent: true, lines: [EMPTY_LINE()] });
  const [res, setRes] = useState<HcResult | null>(null);
  const body = () => JSON.stringify({ ...p, lines: p.lines.filter((l) => l.role.trim()).map((l) => ({ ...l, endYm: l.endYm || null })) });
  /* v10.617 셈하기는 저장이 아니라 계획 이름이 비어도 됨 — 서버 검사(2 ~ 80자)를 넘도록 임시 이름 · 저장은 이름 필수 그대로 */
  const simBody = () => JSON.stringify({ ...JSON.parse(body()), title: p.title.trim().length >= 2 ? p.title : '셈하기' });
  const sim = () => void a.run('sim', () => api<HcResult>('/admin/bzx/hc-sim', { method: 'POST', body: simBody() }).then((r) => { setRes(r); return r; }), undefined, '셈했습니다.');
  const save = () => void a.run('save', () => id ? api(`/admin/bzx/hc-plans/${id}`, { method: 'PUT', body: body() }) : api<{ id: string }>('/admin/bzx/hc-plans', { method: 'POST', body: body() }).then((r) => { setId(r.id); return r; }), q.reload);
  const load = (pid: string) => void api<{ id: string; plan: typeof p } & HcResult>(`/admin/bzx/hc-plans/${pid}`).then((r) => {
    setId(r.id); setP({ ...r.plan, lines: r.plan.lines.length ? r.plan.lines.map((l) => ({ ...l, nontax: l.nontax ?? 0, endYm: l.endYm ?? null })) : [EMPTY_LINE()] }); setRes(r);
  }).catch(() => a.setErr('계획을 읽지 못했습니다.'));
  const line = (i: number, v: Partial<HcLine>) => setP({ ...p, lines: p.lines.map((l, k) => (k === i ? { ...l, ...v } : l)) });
  const num = (s: string) => Number(s.replace(/\D/g, '')) || 0;
  return (
    <section data-bzx-hc={(q.data?.items ?? []).length}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        저장한 계획 {(q.data?.items ?? []).map((x) => <button key={x.id} className="btn-sm btn-plain" onClick={() => load(x.id)} data-bzx-hc-plan={x.id}>{x.title} ({x.startYm} · {x.months}개월)</button>)}
        {' '}<button className="btn-sm" onClick={() => { setId(null); setP({ title: '', startYm: ymNow(), months: 12, raisePct: 0, includeCurrent: true, lines: [EMPTY_LINE()] }); setRes(null); }}>새 계획</button>
      </p>
      <div className="card pad" data-bzx-hc-form={id ?? 'new'}>
        <p>
          <input className="inp" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} placeholder="계획 이름(2 ~ 80자)" data-bzx-hc-title="" />{' '}
          <label>시작 <input type="month" value={p.startYm} onChange={(e) => setP({ ...p, startYm: e.target.value })} /></label>{' '}
          <label>기간 <input className="inp-sm" value={p.months} onChange={(e) => setP({ ...p, months: num(e.target.value) })} />개월</label>{' '}
          <label>해마다 인상 <input className="inp-sm" value={p.raisePct} onChange={(e) => setP({ ...p, raisePct: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />%</label>{' '}
          <label><input type="checkbox" checked={p.includeCurrent} onChange={(e) => setP({ ...p, includeCurrent: e.target.checked })} /> 지금 직원 함께</label>
        </p>
        <table className="tbl" data-bzx-hc-lines={p.lines.length}>
          <thead><tr><th>자리</th><th>인원</th><th>월 기본급</th><th>비과세</th><th>입사 달</th><th>퇴사 달</th><th></th></tr></thead>
          <tbody>{p.lines.map((l, i) => (
            <tr key={i}>
              <td><input className="inp" value={l.role} onChange={(e) => line(i, { role: e.target.value })} placeholder="예: 개발자" data-bzx-hc-role={i} /></td>
              <td><input className="inp-sm" value={l.count} onChange={(e) => line(i, { count: num(e.target.value) })} /></td>
              <td><input className="inp-sm" value={l.monthlyBase} onChange={(e) => line(i, { monthlyBase: num(e.target.value) })} /></td>
              <td><input className="inp-sm" value={l.nontax} onChange={(e) => line(i, { nontax: num(e.target.value) })} /></td>
              <td><input type="month" value={l.startYm} onChange={(e) => line(i, { startYm: e.target.value })} /></td>
              <td><input type="month" value={l.endYm ?? ''} onChange={(e) => line(i, { endYm: e.target.value || null })} /></td>
              <td><button className="btn-sm btn-plain" onClick={() => setP({ ...p, lines: p.lines.filter((_, k) => k !== i) })}>빼기</button></td>
            </tr>
          ))}</tbody>
        </table>
        <p>
          <button className="btn-sm btn-plain" disabled={p.lines.length >= 30} onClick={() => setP({ ...p, lines: [...p.lines, EMPTY_LINE()] })}>줄 더하기</button>{' '}
          <button className="btn-ok" disabled={!!a.busy} onClick={sim} data-bzx-hc-sim="">셈하기</button>{' '}
          <button className="btn-sm" disabled={!!a.busy || p.title.trim().length < 2} onClick={save} data-bzx-hc-save="">{id ? '계획 고치기' : '계획 저장'}</button>{' '}
          {id && <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => confirm('이 계획을 보관합니다(목록에서 빠짐).') && void a.run('arc', () => api(`/admin/bzx/hc-plans/${id}/archive`, { method: 'POST' }), () => { setId(null); setRes(null); q.reload(); })}>보관</button>}
        </p>
      </div>
      {res && (
        <div data-bzx-hc-result={res.months.length}>
          <p className={res.draft || res.missingRates.length ? 'warn-text' : 'dim'}>{res.note}{res.draft ? ' · 요율 「초안」 있음' : ''}{res.missingRates.length ? ` · 빠진 요율 ${res.missingRates.join(', ')}` : ''}</p>
          <p data-bzx-hc-total={res.total.total}><b>합계 {n(res.total.total)}원</b> · 지급액 {n(res.total.gross)} · 회사 4대보험 {n(res.total.companyIns)} · 퇴직금 적립 {n(res.total.severance)} · 지금 직원만 {n(res.total.current)} · 늘어나는 몫 {n(res.total.added)}</p>
          <table className="tbl">
            <thead><tr><th>달</th><th>인원(채용)</th><th>지급액</th><th>회사 4대보험</th><th>퇴직금 적립</th><th>합계</th></tr></thead>
            <tbody>{res.months.map((m) => <tr key={m.ym}><td>{m.ym}</td><td>{m.people}({m.hires})</td><td>{n(m.gross)}</td><td>{n(m.companyIns)}</td><td>{n(m.severance)}</td><td>{n(m.total)}</td></tr>)}</tbody>
          </table>
          {res.lines.length > 0 && (
            <table className="tbl"><thead><tr><th>자리</th><th>인원</th><th>기간 합계</th><th></th></tr></thead>
              <tbody>{res.lines.map((l, i) => <tr key={i}><td>{l.role}</td><td>{l.count}</td><td>{n(l.total)}</td><td>{l.shortStay ? '1년 미만 — 퇴직금 실제 지급 없음' : ''}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </section>
  );
}
