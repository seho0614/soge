/* ===== 13차 인사 · 회계 (v10.581 ~ 584 · docs/723 ~ 726) — web/src/app/admin/Hra.tsx 새 파일 =====
 * 회계 › 인사 › 연차 사용 촉진(HraLeavePromo) · 내 인사 › 연차 촉진 상자(MyLeavePromo)
 * 사무 › 사내 자료실 · 공지(HraLibrary) · 회계 › 인사 › 급여 이체 파일(HraPayFile) · 회계 › 장부 › 마감 체크리스트(AcctCloseCheck)
 * 디자인 — 인라인 글자 크기 · 모서리 · 그림자 없음(기존 class 만) · 계좌는 끝 4자리만 보임
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { uploadFile } from '../../lib/files';
import { exportTicket } from './OpsSafetyBoxes';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const has = (...r: string[]) => tokenRoles().some((x) => x === 'SUPER' || r.includes(x));
const isSuper = () => tokenRoles().includes('SUPER');
const kstYm = (add = 0) => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + add); return d.toISOString().slice(0, 7); };
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};
const datesOf = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/* ── 13차 설정(SUPER) — 화면마다 그 화면 스위치만 ── */
interface HraSet { leavePromo: boolean; firstMonths: number; secondMonths: number; replyDays: number; libUnreadAlert: boolean; payfileExport: boolean; closeAlert: boolean; closeAlertDaysBefore: number }
function HraSwitch({ k, label, onDone }: { k: keyof HraSet; label: string; onDone?: () => void }) {
  const q = useApi<HraSet>('/admin/hra/settings');
  const a = useAct();
  const v = q.data?.[k];
  const flip = () => {
    const reason = prompt(`「${label}」을(를) ${v ? '끕니다' : '켭니다'}. 사유(2 ~ 200자)`);
    if (!reason || reason.trim().length < 2) return;
    void a.run('sw', () => api('/admin/hra/settings', { method: 'PUT', body: JSON.stringify({ [k]: !v, reason }) }), () => { q.reload(); onDone?.(); });
  };
  if (!q.data) return null;
  return (
    <span data-hra-switch={String(k)}>
      <Flash msg={a.msg} err={a.err} />
      {label}: <b>{v ? '켜짐' : '꺼짐'}</b>{' '}
      {isSuper() && <button className="btn-sm btn-plain" disabled={a.busy === 'sw'} onClick={flip}>{v ? '끄기' : '켜기'}</button>}
    </span>
  );
}

/* ── v10.581 연차 사용 촉진(관리자) ── */
interface Promo { id: string; round: number; unusedDays: number; issuedOn: string; replyDue: string; state: string; planDates: string[]; designatedDates: string[]; ackedAt: string | null; outOfWindow: boolean }
interface PromoRowT { employeeId: string; name: string; joinedOn: string; linked: boolean; eligible: boolean; granted: number; used: number; remaining: number; round1: Promo | null; round2: Promo | null; next: string }
interface PromoView { year: number; today: string; phase: string; window: { firstStart: string; firstEnd: string; secondDue: string; end: string }; rows: PromoRowT[]; states: Record<string, string>;
  count: { eligible: number; issued: number; toIssue: number; toDesignate: number; unlinked: number }; note: string }
const PHASE_KO: Record<string, string> = { BEFORE: '1차 기간 전', FIRST: '1차 기간', SECOND: '2차 지정 기간', AFTER: '2차 기한 지남', PAST: '지난해' };
const NEXT_KO: Record<string, string> = { FIRST_YEAR: '1년 미만(대상 아님 · 노무 확인)', ISSUE: '1차 알림 만들 차례', NONE: '남은 연차 없음', DESIGNATE: '2차 지정 차례', WAIT: '계획 기다림', DONE: '끝' };
export function HraLeavePromo() {
  const [year, setYear] = useState(Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 4)));
  const q = useApi<PromoView>(`/admin/hr/leave-promo?year=${year}`, [year]);
  const a = useAct();
  const d = q.data;
  const issue = () => { if (confirm(`${year}년 1차 연차 사용 촉진 알림을 만들까요? (이미 있는 직원은 건너뜀)`)) void a.run('issue', () => api('/admin/hr/leave-promo/issue', { method: 'POST', body: JSON.stringify({ year }) }), q.reload); };
  const designate = (r: PromoRowT) => {
    const s = prompt(`${r.name} 님의 쓸 날(남은 ${r.remaining}일) — YYYY-MM-DD 를 쉼표로`);
    if (!s || !r.round1) return;
    void a.run(`d${r.employeeId}`, () => api(`/admin/hr/leave-promo/${r.round1!.id}/designate`, { method: 'POST', body: JSON.stringify({ dates: datesOf(s) }) }), q.reload);
  };
  return (
    <section data-hra-leave-promo={d?.rows.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <button className="btn-sm btn-plain" onClick={() => setYear(year - 1)}>← {year - 1}</button> <b>{year}년</b> <button className="btn-sm btn-plain" onClick={() => setYear(year + 1)}>{year + 1} →</button>{' '}
        <HraSwitch k="leavePromo" label="자동(1차 기간에 저절로 · 알림)" onDone={q.reload} />
        {d && (
          <>
            <p className="muted">{d.note}</p>
            <p data-hra-promo-phase={d.phase}>지금 <b>{PHASE_KO[d.phase] ?? d.phase}</b> · 1차 {d.window.firstStart} ~ {d.window.firstEnd} · 2차 기한 {d.window.secondDue} ·
              대상 {d.count.eligible} · 1차 만듦 {d.count.issued} · <span className={d.count.toIssue ? 'warn-text' : ''}>만들 차례 {d.count.toIssue}</span> ·
              <span className={d.count.toDesignate ? 'warn-text' : ''}> 2차 지정 차례 {d.count.toDesignate}</span>{d.count.unlinked > 0 && <> · 계정 연결 없음 {d.count.unlinked}(서면으로)</>}{' '}
              <button className="btn-sm" disabled={a.busy === 'issue' || !d.count.toIssue} onClick={issue} data-hra-promo-issue="">1차 알림 만들기</button></p>
          </>
        )}
      </div>
      {d && (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl"><thead><tr><th>직원</th><th className="num">생김 · 씀 · 남음</th><th>1차(알림 · 계획)</th><th>2차(지정)</th><th>다음</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.employeeId} data-hra-promo-row={r.employeeId} className={r.eligible ? undefined : 'dim'}>
                <td>{r.name} <small className="dim">{r.joinedOn}{r.linked ? '' : ' · 계정 연결 없음'}</small></td>
                <td className="num">{r.granted} · {r.used} · <b>{r.remaining}</b></td>
                <td>{r.round1 ? <>{d.states[r.round1.state] ?? r.round1.state} <small className="dim">{r.round1.issuedOn} · 기한 {r.round1.replyDue}{r.round1.ackedAt ? ' · 확인함' : ' · 확인 전'}{r.round1.outOfWindow ? ' · 기간 밖' : ''}</small>
                  {r.round1.planDates.length > 0 && <div><small>계획 {r.round1.planDates.join(', ')}</small></div>}</> : '—'}</td>
                <td>{r.round2 ? <><small>{r.round2.designatedDates.join(', ')}</small> <small className="dim">{r.round2.ackedAt ? '확인함' : '확인 전'}{r.round2.outOfWindow ? ' · 기한 밖' : ''}</small></> : '—'}</td>
                <td>{NEXT_KO[r.next] ?? r.next}</td>
                <td>{r.next === 'DESIGNATE' && <button className="btn-sm" disabled={a.busy === `d${r.employeeId}`} onClick={() => designate(r)} data-hra-promo-designate={r.employeeId}>쓸 날 지정</button>}</td>
              </tr>))}</tbody></table>
        </div>
      )}
    </section>
  );
}

/* ── v10.581 내 인사 › 연차 사용 촉진(본인) ── */
interface MyPromo { linked: boolean; items: Array<Promo & { year: number; stateKo: string }>; leave?: { granted: number; used: number; remaining: number }; pending?: number; note: string }
export function MyLeavePromo() {
  const q = useApi<MyPromo>('/admin/me/hr/leave-promo');
  const a = useAct();
  const d = q.data;
  if (!d || !d.linked || !d.items.length) return null;
  const plan = (p: Promo) => {
    const s = prompt(`쓸 날을 적어 주십시오(남은 ${p.unusedDays}일까지 · YYYY-MM-DD 를 쉼표로)`);
    if (s) void a.run(`p${p.id}`, () => api(`/admin/me/hr/leave-promo/${p.id}/plan`, { method: 'POST', body: JSON.stringify({ dates: datesOf(s) }) }), q.reload);
  };
  const ack = (p: Promo) => void a.run(`a${p.id}`, () => api(`/admin/me/hr/leave-promo/${p.id}/ack`, { method: 'POST' }), q.reload);
  return (
    <div className="card pad" data-my-leave-promo={d.pending ?? 0}>
      <Flash msg={a.msg} err={a.err} />
      <b>연차 사용 촉진</b> <small className="dim">남은 연차 {d.leave?.remaining ?? '—'}일</small>
      <p className="muted">{d.note}</p>
      <ul>{d.items.map((p) => (
        <li key={p.id} data-my-leave-promo-item={p.id}>
          {p.year}년 {p.round}차 · {p.stateKo} · 남은 연차 {p.unusedDays}일 · 알린 날 {p.issuedOn}{p.round === 1 && ` · 계획 기한 ${p.replyDue}`}
          {p.planDates.length > 0 && <> · 낸 계획 {p.planDates.join(', ')}</>}{p.designatedDates.length > 0 && <> · 회사가 지정한 날 <b>{p.designatedDates.join(', ')}</b></>}{' '}
          {p.round === 1 && p.state === 'ISSUED' && <button className="btn-sm" disabled={a.busy === `p${p.id}`} onClick={() => plan(p)}>쓸 날 내기</button>}{' '}
          {!p.ackedAt ? <button className="btn-sm btn-plain" disabled={a.busy === `a${p.id}`} onClick={() => ack(p)} data-my-leave-promo-ack={p.id}>받았습니다</button> : <small className="dim">확인 {ymdhm(p.ackedAt)}</small>}
        </li>))}</ul>
    </div>
  );
}

/* ── v10.582 사내 자료실 · 공지 ── */
interface LibItem { id: string; kind: string; kindKo: string; title: string; audience: string[]; mustRead: boolean; readDue: string | null; pinned: boolean; state: string; fileId: string | null; corpDocId: string | null;
  fileName: string | null; corpDocTitle: string | null; author: string; createdAt: string; readAt?: string | null; target?: number; read?: number }
interface LibMine { items: LibItem[]; mustReadLeft: number; canManage: boolean; note: string }
interface LibManage { items: LibItem[]; groups: Array<{ key: string; name: string }>; corpDocs: Array<{ id: string; category: string; title: string }>; note: string }
const BLANK_LIB = { kind: 'NOTICE', title: '', body: '', audience: [] as string[], mustRead: false, readDue: '', pinned: false, corpDocId: '' };
export function HraLibrary() {
  const [kind, setKind] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState<{ id: string; body: string | null } | null>(null);
  const q = useApi<LibMine>(`/admin/hra/library?kind=${kind}`, [kind]);
  const a = useAct();
  const show = (x: LibItem) => void a.run(`o${x.id}`, async () => { const r = await api<{ id: string; body: string | null }>(`/admin/hra/library/${x.id}`); setBody(r); setOpen(x.id); return { note: '' }; }, undefined, () => '');
  const markRead = (x: LibItem) => void a.run(`r${x.id}`, () => api(`/admin/hra/library/${x.id}/read`, { method: 'POST' }), q.reload);
  const openFile = (x: LibItem) => void a.run(`f${x.id}`, async () => {
    const w = window.open('', '_blank');
    try { const r = await api<{ url: string }>(`/admin/hra/library/${x.id}/file`); if (w) w.location.href = r.url; else window.location.assign(r.url); } catch (e) { w?.close(); throw e; }
    return { note: '' };
  }, undefined, () => '');
  const d = q.data;
  return (
    <section data-hra-library={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <div className="card pad">
          <p className="muted">{d.note}</p>
          <p>{d.mustReadLeft > 0 ? <b className="warn-text" data-hra-lib-left={d.mustReadLeft}>꼭 읽을 글 {d.mustReadLeft}개가 남았습니다</b> : <span data-hra-lib-left="0">꼭 읽을 글을 모두 읽었습니다</span>}{' '}
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류"><option value="">모두</option><option value="NOTICE">공지</option><option value="FILE">자료</option></select></p>
          <table className="tbl"><thead><tr><th>종류</th><th>제목</th><th>올린 사람 · 날</th><th>읽음</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-hra-lib-item={x.id} data-hra-lib-read={x.readAt ? '1' : '0'}>
                <td>{x.kindKo}{x.pinned && ' · 고정'}</td>
                <td><button className="btn-sm btn-plain" onClick={() => show(x)}>{x.title}</button>{x.mustRead && <small className="warn-text"> 꼭 읽기{x.readDue ? ` · ${x.readDue}까지` : ''}</small>}
                  {open === x.id && body && <div className="card pad" data-hra-lib-body={x.id}>{(body.body ?? '').split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>}</td>
                <td><small>{x.author} · {ymdhm(x.createdAt)}</small></td>
                <td>{x.readAt ? <small className="dim">{ymdhm(x.readAt)}</small> : <button className="btn-sm" disabled={a.busy === `r${x.id}`} onClick={() => markRead(x)} data-hra-lib-mark={x.id}>읽었습니다</button>}</td>
                <td>{(x.fileId || x.corpDocId) && <button className="btn-sm btn-plain" onClick={() => openFile(x)} data-hra-lib-file={x.id}>{x.fileName ?? x.corpDocTitle ?? '파일'}</button>}</td>
              </tr>))}</tbody></table>
        </div>
      )}
      {(d?.canManage ?? false) && <HraLibManage onChange={q.reload} />}
    </section>
  );
}

/** 글 올리기 · 관리(ADMIN · SUPER) — 관리 권한이 있을 때만 그림(다른 역할은 관리 주소를 부르지 않음) */
function HraLibManage({ onChange }: { onChange: () => void }) {
  const m = useApi<LibManage>('/admin/hra/library/manage');
  const a = useAct();
  const [f, setF] = useState(BLANK_LIB);
  const [file, setFile] = useState<File | null>(null);
  const [reads, setReads] = useState<{ id: string; title: string; target: number; read: number; rows: Array<{ accountId: string; name: string | null; email: string | null; readAt: string | null }> } | null>(null);
  const reloadAll = () => { m.reload(); onChange(); };
  const add = () => void a.run('add', async () => {
    const up = f.kind === 'FILE' && file ? await uploadFile(file, 'CORP_DOC') : null;
    return api('/admin/hra/library', { method: 'POST', body: JSON.stringify({ kind: f.kind, title: f.title, body: f.body || undefined, audience: f.audience, mustRead: f.mustRead,
      readDue: f.mustRead && f.readDue ? f.readDue : undefined, pinned: f.pinned, fileId: up?.fileId, corpDocId: !up && f.corpDocId ? f.corpDocId : undefined }) });
  }, () => { setF(BLANK_LIB); setFile(null); reloadAll(); });
  const archive = (x: LibItem) => { const reason = prompt(`「${x.title}」 보관 끝 사유(되돌리지 않음)`); if (reason) void a.run(`x${x.id}`, () => api(`/admin/hra/library/${x.id}/archive`, { method: 'POST', body: JSON.stringify({ reason }) }), reloadAll); };
  const showReads = (x: LibItem) => void a.run(`s${x.id}`, async () => { setReads(await api(`/admin/hra/library/${x.id}/reads`)); return { note: '' }; }, undefined, () => '');
  const mg = m.data;
  if (!mg) return null;
  return (
    <div className="card pad" data-hra-lib-manage={mg.items.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>글 올리기 · 관리</b> <HraSwitch k="libUnreadAlert" label="꼭 읽기 기한 지남 알림" />
      <p className="muted">{mg.note}</p>
      <div data-hra-lib-form="">
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류"><option value="NOTICE">공지</option><option value="FILE">자료</option></select>{' '}
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" size={30} aria-label="제목" />{' '}
        <label><input type="checkbox" checked={f.mustRead} onChange={(e) => setF({ ...f, mustRead: e.target.checked })} /> 꼭 읽기</label>{' '}
        {f.mustRead && <label>기한 <input type="date" value={f.readDue} onChange={(e) => setF({ ...f, readDue: e.target.value })} /></label>}{' '}
        <label><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> 맨 위 고정</label><br />
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={f.kind === 'NOTICE' ? '본문(꼭)' : '설명(선택)'} rows={3} style={{ width: '100%' }} aria-label="본문" /><br />
        {f.kind === 'FILE' && <>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-hra-lib-upload="" /> 또는 사내 문서함{' '}
          <select value={f.corpDocId} onChange={(e) => setF({ ...f, corpDocId: e.target.value })} aria-label="사내 문서함 문서"><option value="">고르지 않음</option>{mg.corpDocs.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select><br /></>}
        <small className="dim">공개 범위(비우면 운영 계정 모두 · 세무사 빠짐):</small>{' '}
        {mg.groups.map((g) => <label key={g.key} style={{ marginRight: 8 }}><input type="checkbox" checked={f.audience.includes(g.key)} onChange={(e) => setF({ ...f, audience: e.target.checked ? [...f.audience, g.key] : f.audience.filter((x) => x !== g.key) })} /> {g.name}</label>)}{' '}
        <button className="btn-sm" disabled={a.busy === 'add' || f.title.trim().length < 2 || (f.kind === 'NOTICE' ? f.body.trim().length < 2 : !file && !f.corpDocId)} onClick={add} data-hra-lib-add="">올리기</button>
      </div>
      <table className="tbl"><thead><tr><th>종류</th><th>제목</th><th>공개 범위</th><th className="num">읽음 / 대상</th><th /></tr></thead>
        <tbody>{mg.items.map((x) => (
          <tr key={x.id} data-hra-lib-manage-row={x.id}>
            <td>{x.kindKo}</td><td>{x.title}{x.mustRead && <small className="warn-text"> 꼭 읽기{x.readDue ? ` · ${x.readDue}` : ''}</small>}</td>
            <td><small>{x.audience.length ? x.audience.map((k) => mg.groups.find((g) => g.key === k)?.name ?? k).join(', ') : '운영 계정 모두'}</small></td>
            <td className="num">{x.read ?? 0} / {x.target ?? 0}</td>
            <td><button className="btn-sm btn-plain" onClick={() => showReads(x)} data-hra-lib-reads={x.id}>읽음 현황</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => archive(x)}>보관 끝</button></td>
          </tr>))}</tbody></table>
      {reads && (
        <div className="card pad" data-hra-lib-reads-box={reads.id}>
          <b>「{reads.title}」 읽음 {reads.read} / {reads.target}</b> <button className="btn-sm btn-plain" onClick={() => setReads(null)}>닫기</button>
          <ul>{reads.rows.map((r) => <li key={r.accountId}>{r.name ?? '—'} <small className="dim">{r.email}</small> — {r.readAt ? ymdhm(r.readAt) : <b className="warn-text">안 읽음</b>}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/* ── v10.583 급여 이체 파일 ── */
interface PayLine { lineId: string; employeeId: string; name: string; net: number; bank: string | null; account: string | null; holder: string | null }
interface PayBank { employeeId: string; name: string; leftOn: string | null; bank: string | null; account: string | null; holder: string | null; updatedAt: string | null }
interface PayView { ym: string; run: { id: string; state: string; payDay: string } | null; lines: PayLine[]; banks: PayBank[]; exportOn: boolean; ready: boolean;
  changes: Array<{ id: string; name: string; before: string | null; after: string; reason: string; changedBy: string | null; changedAt: string }>;
  logs: Array<{ id: string; formatName: string; lines: number; total: number; sha256: string; madeBy: string | null; madeAt: string }>;
  formats: Array<{ id: string; name: string; columns: Array<{ field: string; title: string }>; header: boolean; dateStyle: string; isDefault: boolean }>;
  fields: Record<string, string>; total: { people: number; amount: number; missing: number }; note: string }
const RUN_KO: Record<string, string> = { DRAFT: '초안(확정 전)', FIXED: '확정', PAID: '지급' };
export function HraPayFile() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<PayView>(`/admin/hra/payfile?ym=${ym}`, [ym]);
  const a = useAct();
  const [fmt, setFmt] = useState('');
  const [bk, setBk] = useState<{ employeeId: string; name: string; bank: string; acct: string; holder: string; reason: string } | null>(null);
  const [fe, setFe] = useState<{ id: string | null; name: string; cols: string; header: boolean; dateStyle: string; isDefault: boolean } | null>(null);
  const d = q.data;
  const saveBank = () => bk && void a.run('bk', () => api(`/admin/hra/pay-banks/${bk.employeeId}`, { method: 'PUT', body: JSON.stringify({ bank: bk.bank, acct: bk.acct, holder: bk.holder, reason: bk.reason }) }), () => { setBk(null); q.reload(); });
  const download = () => void a.run('dl', async () => {
    const t = await exportTicket(('HRA_PAY_FILE' as string) as Parameters<typeof exportTicket>[0]);   // v10.583 — OpsSafetyBoxes 대상 글자 목록은 고치지 않음(서버 EXPORT_TARGETS 끝에서 붙임)
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ filename: string; csv: string; note: string }>(`/admin/hra/payfile/export?ym=${ym}${fmt ? `&formatId=${fmt}` : ''}&ticket=${t}`);
    save(r.filename, r.csv); q.reload(); return r;
  }, undefined, (r) => r?.note ?? '');
  const saveFmt = () => fe && void a.run('fmt', () => {
    const columns = fe.cols.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [field, title] = x.split(':'); return { field: (field ?? '').trim(), title: (title ?? '').trim() || undefined }; });
    const b = JSON.stringify({ name: fe.name, columns, header: fe.header, dateStyle: fe.dateStyle, isDefault: fe.isDefault });
    return fe.id ? api(`/admin/hra/bank-formats/${fe.id}`, { method: 'PUT', body: b }) : api('/admin/hra/bank-formats', { method: 'POST', body: b });
  }, () => { setFe(null); q.reload(); });
  return (
    <section data-hra-payfile={d?.lines.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <label>급여 달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>{' '}
        <HraSwitch k="payfileExport" label="이체 파일 내려받기" onDone={q.reload} />
        {d && (
          <>
            <p className="muted">{d.note}</p>
            <p>급여 대장 <b>{d.run ? RUN_KO[d.run.state] ?? d.run.state : '없음'}</b>{d.run && ` · 지급일 ${d.run.payDay}`} · {d.total.people}명 · 실지급 합계 <b>{won(d.total.amount)}</b>원 ·
              <span className={d.total.missing ? 'warn-text' : ''}> 계좌 없음 {d.total.missing}</span>{' '}
              <select value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="양식"><option value="">기본 양식</option>{d.formats.map((x) => <option key={x.id} value={x.id}>{x.name}{x.isDefault ? ' (기본)' : ''}</option>)}</select>{' '}
              <button className="btn-sm" disabled={!d.ready || a.busy === 'dl'} onClick={download} data-hra-payfile-dl="">이체 파일 내려받기(승인)</button></p>
          </>
        )}
      </div>
      {d && (
        <>
          <table className="tbl"><thead><tr><th>직원</th><th className="num">실지급</th><th>은행</th><th>계좌</th><th>예금주</th></tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.lineId} data-hra-payfile-line={l.employeeId} className={l.bank ? undefined : 'warn-text'}>
                <td>{l.name}</td><td className="num">{won(l.net)}</td><td>{l.bank ?? '—'}</td><td data-hra-acct-masked={l.account ?? ''}>{l.account ?? '계좌 없음'}</td><td>{l.holder ?? '—'}</td>
              </tr>))}</tbody></table>
          <div className="card pad" data-hra-pay-banks={d.banks.length}>
            <b>직원 급여 계좌</b> <small className="dim">끝 4자리만 보입니다 · 바꾸면 기록 · 운영 알림</small>
            {bk && (
              <div data-hra-pay-bank-form={bk.employeeId}>
                {bk.name} — <input value={bk.bank} onChange={(e) => setBk({ ...bk, bank: e.target.value })} placeholder="은행 코드 3자리" size={8} aria-label="은행 코드" />{' '}
                <input value={bk.acct} onChange={(e) => setBk({ ...bk, acct: e.target.value })} placeholder="계좌번호" size={18} autoComplete="off" aria-label="계좌번호" />{' '}
                <input value={bk.holder} onChange={(e) => setBk({ ...bk, holder: e.target.value })} placeholder="예금주" size={10} aria-label="예금주" />{' '}
                <input value={bk.reason} onChange={(e) => setBk({ ...bk, reason: e.target.value })} placeholder="사유(본인 요청 등)" size={20} aria-label="사유" />{' '}
                <button className="btn-sm" disabled={a.busy === 'bk'} onClick={saveBank}>저장</button> <button className="btn-sm btn-plain" onClick={() => setBk(null)}>닫기</button>
              </div>
            )}
            <table className="tbl"><thead><tr><th>직원</th><th>은행</th><th>계좌</th><th>예금주</th><th>바꾼 때</th><th /></tr></thead>
              <tbody>{d.banks.map((b) => (
                <tr key={b.employeeId} className={b.leftOn ? 'dim' : undefined}>
                  <td>{b.name}{b.leftOn && <small> · 퇴사 {b.leftOn}</small>}</td><td>{b.bank ?? '—'}</td><td>{b.account ?? '—'}</td><td>{b.holder ?? '—'}</td><td><small>{b.updatedAt ? ymdhm(b.updatedAt) : '—'}</small></td>
                  <td><button className="btn-sm btn-plain" onClick={() => setBk({ employeeId: b.employeeId, name: b.name, bank: b.bank ?? '', acct: '', holder: b.holder ?? b.name, reason: '' })} data-hra-pay-bank-edit={b.employeeId}>{b.bank ? '바꾸기' : '넣기'}</button></td>
                </tr>))}</tbody></table>
            {d.changes.length > 0 && <><b>바뀐 기록</b><ul>{d.changes.map((c) => <li key={c.id}><small>{ymdhm(c.changedAt)} · {c.name} · {c.before ?? '없음'} → {c.after} · {c.reason} · {c.changedBy ?? '—'}</small></li>)}</ul></>}
          </div>
          <div className="card pad" data-hra-bank-formats={d.formats.length}>
            <b>이체 파일 양식</b> <small className="dim">칸은 「field:칸 이름」을 쉼표로 · field = {Object.entries(d.fields).map(([k, v]) => `${k}(${v})`).join(' · ')}</small>
            <ul>{d.formats.map((x) => <li key={x.id}>{x.name}{x.isDefault && ' (기본)'} — <small>{x.columns.map((c) => c.title).join(' | ')} · 머리줄 {x.header ? '있음' : '없음'} · {x.dateStyle}</small>{' '}
              {isSuper() && <button className="btn-sm btn-plain" onClick={() => setFe({ id: x.id, name: x.name, cols: x.columns.map((c) => `${c.field}:${c.title}`).join(', '), header: x.header, dateStyle: x.dateStyle, isDefault: x.isDefault })}>고치기</button>}</li>)}</ul>
            {isSuper() && !fe && <button className="btn-sm btn-plain" onClick={() => setFe({ id: null, name: '', cols: 'bank:은행코드, acct:계좌번호, amount:금액, holder:예금주', header: true, dateStyle: 'YYYYMMDD', isDefault: false })}>양식 만들기</button>}
            {fe && (
              <div data-hra-bank-format-form={fe.id ?? 'new'}>
                <input value={fe.name} onChange={(e) => setFe({ ...fe, name: e.target.value })} placeholder="양식 이름" size={20} aria-label="양식 이름" />{' '}
                <input value={fe.cols} onChange={(e) => setFe({ ...fe, cols: e.target.value })} size={60} aria-label="칸" />{' '}
                <label><input type="checkbox" checked={fe.header} onChange={(e) => setFe({ ...fe, header: e.target.checked })} /> 머리줄</label>{' '}
                <select value={fe.dateStyle} onChange={(e) => setFe({ ...fe, dateStyle: e.target.value })} aria-label="날짜 모양">{['YYYYMMDD', 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY.MM.DD'].map((s) => <option key={s}>{s}</option>)}</select>{' '}
                <label><input type="checkbox" checked={fe.isDefault} onChange={(e) => setFe({ ...fe, isDefault: e.target.checked })} /> 기본</label>{' '}
                <button className="btn-sm" disabled={a.busy === 'fmt'} onClick={saveFmt}>저장</button> <button className="btn-sm btn-plain" onClick={() => setFe(null)}>닫기</button>
              </div>
            )}
          </div>
          {d.logs.length > 0 && <div className="card pad"><b>내려받은 기록</b><ul>{d.logs.map((g) => <li key={g.id}><small>{ymdhm(g.madeAt)} · {g.formatName} · {g.lines}줄 · {won(g.total)}원 · {g.madeBy ?? '—'} · SHA-256 {g.sha256.slice(0, 12)}…</small></li>)}</ul></div>}
        </>
      )}
    </section>
  );
}

/* ── v10.584 회계 마감 체크리스트 ── */
interface CloseRow { key: string; label: string; kind: string; where: string | null; status: string; statusKo: string; detail: string; mark: { done: boolean; note: string | null; by: string | null; at: string } | null }
interface CloseView { ym: string; closed: boolean; closedAt: string | null; closeBy: number; rows: CloseRow[]; errors: string[]; count: { total: number; done: number; left: number }; ready: boolean; note: string }
const ST_CLASS: Record<string, string | undefined> = { TODO: 'warn-text', ERROR: 'warn-text' };
export function AcctCloseCheck() {
  const [ym, setYm] = useState(kstYm(-1));
  const q = useApi<CloseView>(`/admin/acct/close-check?ym=${ym}`, [ym]);
  const a = useAct();
  const canMark = has('PAYOUT');
  const d = q.data;
  const mark = (r: CloseRow, done: boolean) => {
    let note: string | null = '';
    if (done && r.kind === 'AUTO') { note = prompt(`「${r.label}」을(를) 예외로 확인합니다 — 사유(꼭)`); if (!note || note.trim().length < 2) return; }
    else if (done) { note = prompt('메모(비워도 됨)'); if (note === null) return; }
    void a.run(`m${r.key}`, () => api('/admin/acct/close-check/marks', { method: 'POST', body: JSON.stringify({ ym, key: r.key, done, note: note || undefined }) }), q.reload);
  };
  const addItem = () => {
    const label = prompt('사람 확인 항목 이름(2 ~ 60자)'); if (!label) return;
    const key = prompt('열쇠(영어 소문자 · 숫자 · _ · 예: card_return)'); if (!key) return;
    void a.run('item', () => api('/admin/acct/close-check/items', { method: 'POST', body: JSON.stringify({ key, label }) }), q.reload);
  };
  const off = (r: CloseRow) => { if (confirm(`「${r.label}」 항목을 끌까요? (지우지 않고 체크리스트에서 뺌)`)) void a.run(`o${r.key}`, () => api(`/admin/acct/close-check/items/${r.key}`, { method: 'PUT', body: JSON.stringify({ active: false }) }), q.reload); };
  return (
    <section data-acct-close-check={d ? d.count.left : ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <label>달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>{' '}
        {has('ADMIN', 'PAYOUT') && <HraSwitch k="closeAlert" label="남은 일 알림" />}
        {d && (
          <>
            <p className="muted">{d.note}</p>
            <p>{d.closed ? <b data-acct-close-state="closed">마감함({d.closedAt ? ymdhm(d.closedAt) : ''})</b>
              : d.ready ? <b data-acct-close-state="ready">마감할 준비가 됐습니다</b>
              : <b className="warn-text" data-acct-close-state="todo">남은 일 {d.count.left}개</b>} · 끝 {d.count.done} / {d.count.total}{d.errors.length > 0 && <small className="warn-text"> · 셈 실패 {d.errors.join(', ')}</small>}{' '}
              {isSuper() && <button className="btn-sm btn-plain" onClick={addItem}>사람 확인 항목 더하기</button>}</p>
          </>
        )}
      </div>
      {d && (
        <table className="tbl"><thead><tr><th>항목</th><th>상태</th><th>근거</th><th>마지막 확인</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.key} data-acct-close-row={r.key} data-acct-close-status={r.status}>
              <td>{r.label} <small className="dim">{r.kind === 'AUTO' ? '저절로 셈' : '사람 확인'}{r.where ? ` · ${r.where}` : ''}</small></td>
              <td className={ST_CLASS[r.status]}>{r.statusKo}</td>
              <td><small>{r.detail || '—'}</small></td>
              <td><small>{r.mark ? `${r.mark.done ? '확인' : '풂'} · ${r.mark.by ?? '—'} · ${ymdhm(r.mark.at)}${r.mark.note ? ` · ${r.mark.note}` : ''}` : '—'}</small></td>
              <td>{canMark && !d.closed && (r.status === 'OK' && r.kind === 'AUTO' ? null : r.mark?.done
                ? <button className="btn-sm btn-plain" disabled={a.busy === `m${r.key}`} onClick={() => mark(r, false)}>풀기</button>
                : <button className="btn-sm" disabled={a.busy === `m${r.key}`} onClick={() => mark(r, true)} data-acct-close-mark={r.key}>{r.kind === 'AUTO' ? '예외 확인' : '확인'}</button>)}{' '}
                {isSuper() && r.kind === 'MANUAL' && <button className="btn-sm btn-plain" onClick={() => off(r)}>끄기</button>}</td>
            </tr>))}</tbody></table>
      )}
    </section>
  );
}
