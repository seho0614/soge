/* ===== v10.546 ~ 548 (D285 · docs/684 ~ 686) (55) 운영 · 보안 — web/src/app/admin/Sfx.tsx 새 파일 =====
 * 대표 11/20 「(55)」 — 운영 화면 관리만(회원 화면은 기기 표지 쿠키 하나 · site/src/lib/session.ts).
 *   SfxDevice     위험감지 › 같은 기기 여러 계정 — 스위치 · 기준 · 최근 30일 표지 묶음 · 누르면 그 표지의 계정(가린 값 · 감사 기록) · 자동 정지 없음
 *   SfxRetention  사무 › 서류 보관 기한 — 보관 기간 표(고치기 SUPER) · 대장(필터) · 대장 맞추기 · 기준일 · 보존(SUPER) · 파기(SUPER · 「파기」 입력) · 파기 기록
 *   SfxTm         관 관리 › 번역 메모리 — 스위치 · 수 · 찾기 · 고치기(사람 번역) · 끄기 · 지금 번역으로 채우기
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · 색 · 글자는 기존 클래스(tbl · btn-sm · btn-plain · warn-text · muted)만 — 새 CSS 없음 · 어두운 테마 그대로
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymd, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const num = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const PURPOSE_KO: Record<string, string> = { ACCT_EVIDENCE: '회계 증빙', HR_DOC: '인사 서류', LGL_DOC: '법무 서류', CORP_DOC: '사내 문서' };
const STATE_KO: Record<string, string> = { KEEP: '보관 중', DESTROYED: '파기함', GONE: '다른 화면에서 지움' };
const STATUS_KO: Record<string, string> = { ACTIVE: '정상', SUSPENDED: '정지', WITHDRAWN: '탈퇴' };

/* ── 같은 기기 여러 계정 (v10.546) ── */
interface DevGroup { mark: string; accounts: number; firstSeen: string; lastSeen: string; seen: number; signups: number; alertOpen: boolean; overThreshold: boolean }
interface DevView { on: boolean; threshold: number; keepDays: number; marks30: number; accounts30: number; groups: DevGroup[]; note: string }
interface DevRow { accountId: string; email: string | null; name: string | null; status: string; joinedAt: string; firstVia: string; firstSeen: string; lastSeen: string; seen: number; staff: boolean }
interface DevDetail { mark: string; accounts: number; alert: { id: string; state: string } | null; rows: DevRow[]; note: string }

/** 표지 한 개의 계정 — 열 때만 부름(감사 기록 SFX_DEVICE_VIEW) */
function SfxDeviceAccounts({ mark }: { mark: string }) {
  const one = useApi<DevDetail>(`/admin/sfx/device/${mark}`, [mark]);
  const d = one.data;
  if (!d) return null;
  return (
    <div data-sfx-dev-detail={d.accounts}>
      <h4>표지 <code>{d.mark}</code> — 계정 {d.accounts}{d.alert ? ` · 경보 #${d.alert.id}(${d.alert.state})` : ''}</h4>
      <p className="muted">{d.note} 이 화면을 연 기록은 감사 기록에 남습니다.</p>
      <table className="tbl"><thead><tr><th>계정</th><th>이름</th><th>상태</th><th>가입</th><th>처음 본 길</th><th>처음</th><th>마지막</th><th className="num">횟수</th></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={r.accountId}>
            <td>{r.email ?? '—'}{r.staff ? <span className="muted"> (운영 역할)</span> : null}<div className="muted">{r.accountId}</div></td>
            <td>{r.name ?? '—'}</td><td>{STATUS_KO[r.status] ?? r.status}</td><td>{ymd(r.joinedAt)}</td>
            <td>{r.firstVia === 'SIGNUP' ? '가입' : '로그인'}</td><td>{ymdhm(r.firstSeen)}</td><td>{ymdhm(r.lastSeen)}</td><td className="num">{num(r.seen)}</td>
          </tr>))}</tbody></table>
    </div>
  );
}

export function SfxDevice() {
  const v = useApi<DevView>('/admin/sfx/device');
  const [open, setOpen] = useState<string | null>(null);
  const d = v.data;
  return (
    <section data-sfx-device={d ? (d.on ? 'on' : 'off') : ''}>
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'}>탐지 {d.on ? '켜짐' : '꺼짐(sfx.device_watch)'} · 기준 {d.threshold}개 계정 · 표지 보관 {d.keepDays}일 · 최근 30일 표지 {num(d.marks30)} · 계정 {num(d.accounts30)} — {d.note}</p>
          <p className="muted">기기 표지는 사용자 웹이 만든 무작위 값의 해시입니다(브라우저 지문 · IP 없음). 경보는 위험감지 › 위험감지에도 남습니다(RSK-SFX). 정지는 회원 화면에서 사람이 판단합니다.</p>
          <table className="tbl"><thead><tr><th>표지</th><th className="num">계정</th><th className="num">가입으로 처음</th><th className="num">본 횟수</th><th>처음</th><th>마지막</th><th>경보</th><th /></tr></thead>
            <tbody>{d.groups.map((g) => (
              <tr key={g.mark} data-sfx-dev-row={g.mark}>
                <td><code>{g.mark}</code></td>
                <td className="num">{g.overThreshold ? <b className="warn-text">{g.accounts}</b> : g.accounts}</td>
                <td className="num">{g.signups}</td><td className="num">{num(g.seen)}</td>
                <td>{ymdhm(g.firstSeen)}</td><td>{ymdhm(g.lastSeen)}</td>
                <td>{g.alertOpen ? '열림' : '—'}</td>
                <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === g.mark ? null : g.mark)}>{open === g.mark ? '닫기' : '계정 보기'}</button></td>
              </tr>))}
              {d.groups.length === 0 && <tr><td colSpan={8} className="muted">최근 30일 계정이 2개 이상인 기기 표지가 없습니다.</td></tr>}
            </tbody></table>
          {open && <SfxDeviceAccounts mark={open} />}
        </>
      )}
    </section>
  );
}

/* ── 서류 보관 기한 (v10.547) ── */
interface RetRule { code: string; name: string; purpose: string; months: number; minMonths: number; basis: string; baseHint: string; active: boolean; keep: number; soon: number; over: number; held: number; destroyed: number; unlisted: number }
interface RetRules { alertOn: boolean; alertDays: number; rules: RetRule[]; note: string }
interface RetRow { fileId: string; purpose: string; ruleName: string; fileName: string; size: number; fileStatus: string; uploadedAt: string; baseDate: string; expiresOn: string; state: string;
  hold: boolean; holdReason: string | null; daysLeft: number; owner: string | null; canDestroy: boolean }
interface RetList { alertDays: number; today: string; rows: RetRow[] }
interface RetDone { rows: { id: string; fileId: string; purpose: string; fileName: string; size: number; baseDate: string; expiresOn: string; reason: string; destroyedAt: string; storageRemoved: boolean; actor: string | null }[] }

/** 파기 기록 — 열 때만 부름 */
function SfxRetentionDone() {
  const done = useApi<RetDone>('/admin/sfx/retention/destroyed');
  const d = done.data;
  if (!d) return null;
  return (
    <table className="tbl" data-sfx-ret-done={d.rows.length}><thead><tr><th>파기한 때</th><th>서류(가린 이름)</th><th>종류</th><th>기준일 · 만료일</th><th>사유</th><th>누가</th><th>저장소</th></tr></thead>
      <tbody>{d.rows.map((x) => (
        <tr key={x.id}><td>{ymdhm(x.destroyedAt)}</td><td>{x.fileName}</td><td>{PURPOSE_KO[x.purpose] ?? x.purpose}</td><td>{x.baseDate} · {x.expiresOn}</td><td>{x.reason}</td><td>{x.actor ?? '—'}</td>
          <td>{x.storageRemoved ? '지움' : <span className="warn-text">못 지움</span>}</td></tr>))}
        {d.rows.length === 0 && <tr><td colSpan={7} className="muted">파기 기록이 없습니다.</td></tr>}
      </tbody></table>
  );
}

export function SfxRetention({ isSuper }: { isSuper: boolean }) {
  const rules = useApi<RetRules>('/admin/sfx/retention/rules');
  const [state, setState] = useState('KEEP');
  const [purpose, setPurpose] = useState('');
  const [due, setDue] = useState('');
  const qs = [`state=${state}`, purpose ? `purpose=${purpose}` : '', due === 'hold' ? 'hold=1' : due ? `due=${due}` : ''].filter(Boolean).join('&');
  const list = useApi<RetList>(`/admin/sfx/retention?${qs}`, [qs]);
  const [showDone, setShowDone] = useState(false);
  const a = useAct();
  const reload = () => { rules.reload(); list.reload(); };
  const r = rules.data;

  const editRule = (x: RetRule) => {
    const m = prompt(`${x.name} 보관 개월(법정 최소 ${x.minMonths} ~ 600):`, String(x.months));
    if (m && /^\d{1,3}$/.test(m.trim())) void a.run(`ru${x.code}`, () => api(`/admin/sfx/retention/rules/${x.code}`, { method: 'PUT', body: JSON.stringify({ months: Number(m.trim()) }) }), reload);
  };
  const editBase = (x: RetRow) => {
    const b = prompt(`기준일(YYYY-MM-DD · 오늘까지) — 만료일 = 기준일 + 보관 개월:`, x.baseDate);
    if (!b) return;
    const why = prompt('사유(2자 이상 · 감사 기록):', '');
    if (why && why.trim().length >= 2) void a.run(`bd${x.fileId}`, () => api(`/admin/sfx/retention/${x.fileId}`, { method: 'PUT', body: JSON.stringify({ baseDate: b.trim(), reason: why.trim() }) }), reload);
  };
  const toggleHold = (x: RetRow) => {
    if (x.hold) {
      const why = prompt('법정 보관(보존)을 풉니다. 사유(2자 이상):', '');
      if (why && why.trim().length >= 2) void a.run(`hd${x.fileId}`, () => api(`/admin/sfx/retention/${x.fileId}`, { method: 'PUT', body: JSON.stringify({ hold: false, reason: why.trim() }) }), reload);
    } else {
      const hr = prompt('법정 보관(보존) 까닭(예: 소송 · 세무조사 · 수사 협조 · 2자 이상) — 걸면 어떤 화면에서도 지우지 못합니다:', '');
      if (hr && hr.trim().length >= 2) void a.run(`hd${x.fileId}`, () => api(`/admin/sfx/retention/${x.fileId}`, { method: 'PUT', body: JSON.stringify({ hold: true, holdReason: hr.trim(), reason: hr.trim() }) }), reload);
    }
  };
  const destroy = (x: RetRow) => {
    const why = prompt(`「${x.fileName}」(${PURPOSE_KO[x.purpose] ?? x.purpose} · 만료 ${x.expiresOn})을 파기합니다. 되돌릴 수 없습니다.\n파기 사유(2자 이상):`, '');
    if (!why || why.trim().length < 2) return;
    const ok = prompt('확인 — 「파기」 두 글자를 입력하십시오:', '');
    if (ok !== null) void a.run(`ds${x.fileId}`, () => api(`/admin/sfx/retention/${x.fileId}/destroy`, { method: 'POST', body: JSON.stringify({ reason: why.trim(), confirm: ok.trim() }) }), reload);
  };

  return (
    <section data-sfx-retention={r ? (r.alertOn ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {r && (
        <>
          <p className={r.alertOn ? '' : 'warn-text'}>만료 알림 {r.alertOn ? `켜짐 · ${r.alertDays}일 전` : '꺼짐(sfx.retention_alert)'} — {r.note}</p>
          <table className="tbl" data-sfx-ret-rules={r.rules.length}><thead><tr><th>서류 종류</th><th className="num">보관</th><th>근거 · 기준일</th><th className="num">보관 중</th><th className="num">곧 만료</th><th className="num">지남</th><th className="num">보존</th><th className="num">파기</th><th className="num">대장에 없음</th><th /></tr></thead>
            <tbody>{r.rules.map((x) => (
              <tr key={x.code}>
                <td>{x.name}{x.active ? null : <span className="muted"> (꺼짐)</span>}<div className="muted">{x.purpose}</div></td>
                <td className="num">{x.months}개월<div className="muted">최소 {x.minMonths}</div></td>
                <td><div>{x.basis}</div><div className="muted">기준일: {x.baseHint}</div></td>
                <td className="num">{num(x.keep)}</td><td className="num">{num(x.soon)}</td><td className="num">{x.over ? <b className="warn-text">{num(x.over)}</b> : 0}</td>
                <td className="num">{num(x.held)}</td><td className="num">{num(x.destroyed)}</td><td className="num">{num(x.unlisted)}</td>
                <td>{isSuper && <button className="btn-sm btn-plain" disabled={a.busy === `ru${x.code}`} onClick={() => editRule(x)}>개월 고치기</button>}</td>
              </tr>))}</tbody></table>
          <p className="muted">보관 기간 처음 값은 일반 원칙입니다 — 세무사 · 노무사 · 법무 확인 뒤 SUPER 가 고칩니다(법정 최소 밑으로는 못 내림). 「대장에 없음」은 「대장 맞추기」로 넣습니다.</p>
        </>
      )}
      <p>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="상태">
          <option value="KEEP">보관 중</option><option value="DESTROYED">파기함</option><option value="GONE">다른 화면에서 지움</option><option value="ALL">모두</option>
        </select>{' '}
        <select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="서류 종류">
          <option value="">모든 종류</option>{Object.entries(PURPOSE_KO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>{' '}
        <select value={due} onChange={(e) => setDue(e.target.value)} aria-label="기한">
          <option value="">모든 기한</option><option value="soon">곧 만료</option><option value="over">기한 지남</option><option value="hold">보존만</option>
        </select>{' '}
        <button className="btn-sm" disabled={a.busy === 'sync'} onClick={() => void a.run('sync', () => api('/admin/sfx/retention/sync', { method: 'POST' }), reload)} data-sfx-ret-sync="">대장 맞추기</button>{' '}
        <button className="btn-sm btn-plain" onClick={() => setShowDone(!showDone)}>{showDone ? '파기 기록 닫기' : '파기 기록'}</button>
      </p>
      {list.data && (
        <table className="tbl" data-sfx-ret-list={list.data.rows.length}><thead><tr><th>서류</th><th>종류</th><th>올린 사람 · 날</th><th>기준일</th><th>만료일</th><th className="num">남은 날</th><th>상태 · 보존</th><th /></tr></thead>
          <tbody>{list.data.rows.map((x) => (
            <tr key={x.fileId} data-sfx-ret-row={x.fileId}>
              <td>{x.fileName}<div className="muted">{num(Math.round(x.size / 1024))}KB</div></td>
              <td>{PURPOSE_KO[x.purpose] ?? x.purpose}</td>
              <td>{x.owner ?? '—'}<div className="muted">{ymd(x.uploadedAt)}</div></td>
              <td>{x.baseDate}</td><td>{x.expiresOn}</td>
              <td className="num">{x.state === 'KEEP' ? (x.daysLeft <= 0 ? <b className="warn-text">지남</b> : x.daysLeft) : '—'}</td>
              <td>{STATE_KO[x.state] ?? x.state}{x.hold ? <div className="warn-text">보존 — {x.holdReason}</div> : null}</td>
              <td>{isSuper && x.state === 'KEEP' && (
                <>
                  <button className="btn-sm btn-plain" disabled={a.busy === `bd${x.fileId}`} onClick={() => editBase(x)}>기준일</button>{' '}
                  <button className="btn-sm btn-plain" disabled={a.busy === `hd${x.fileId}`} onClick={() => toggleHold(x)}>{x.hold ? '보존 풀기' : '보존 걸기'}</button>{' '}
                  {x.canDestroy && <button className="btn-sm" disabled={a.busy === `ds${x.fileId}`} onClick={() => destroy(x)} data-sfx-ret-destroy="">파기</button>}
                </>
              )}</td>
            </tr>))}
            {list.data.rows.length === 0 && <tr><td colSpan={8} className="muted">해당하는 서류가 없습니다.</td></tr>}
          </tbody></table>
      )}
      {showDone && <SfxRetentionDone />}
    </section>
  );
}

/* ── 번역 메모리 (v10.548) ── */
interface TmRow { id: string; lang: string; origin: string; fromType: string; active: boolean; hits: number; lastUsedAt: string | null; updatedAt: string; src: string; tr: string; srcLen: number; trLen: number; editor: string | null }
interface TmView { on: boolean; keepDays: number; total: number; human: number; machine: number; off: number; hits: number; used30: number; page: number; rows: TmRow[]; note: string }

export function SfxTm() {
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const [origin, setOrigin] = useState('');
  const [page, setPage] = useState(1);
  const qs = [kw ? `q=${encodeURIComponent(kw)}` : '', origin ? `origin=${origin}` : '', `page=${page}`].filter(Boolean).join('&');
  const v = useApi<TmView>(`/admin/sfx/tm?${qs}`, [qs]);
  const a = useAct();
  const d = v.data;
  const fix = (r: TmRow) => {
    if (r.trLen > 300) { alert('300자가 넘는 번역은 이 창에서 고치지 않습니다 — 관 관리 › 번역에서 그 글의 번역을 고친 뒤 승인하면 메모리도 바뀝니다.'); return; }
    const t = prompt(`번역 고치기(${r.lang}) — 고치면 사람 번역이 되어 엔진 번역이 덮지 못합니다.\n원문: ${r.src}`, r.tr);
    if (t && t.trim() && t.trim() !== r.tr) void a.run(`fx${r.id}`, () => api(`/admin/sfx/tm/${r.id}`, { method: 'PUT', body: JSON.stringify({ text: t.trim() }) }), v.reload);
  };
  const toggle = (r: TmRow) => void a.run(`tg${r.id}`, () => api(`/admin/sfx/tm/${r.id}`, { method: 'PUT', body: JSON.stringify({ active: !r.active }) }), v.reload);
  return (
    <section data-sfx-tm={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'}>번역 메모리 {d.on ? '켜짐' : '꺼짐(sfx.tm)'} · 줄 {num(d.total)}(사람 {num(d.human)} · 엔진 {num(d.machine)} · 끔 {num(d.off)}) · 쓰인 횟수 {num(d.hits)} · 최근 30일 쓰인 줄 {num(d.used30)} · 보관 {d.keepDays}일 — {d.note}</p>
          <p>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setKw(q.trim()); setPage(1); } }} placeholder="원문 · 번역 글자" aria-label="찾기" />{' '}
            <button className="btn-sm btn-plain" onClick={() => { setKw(q.trim()); setPage(1); }}>찾기</button>{' '}
            <select value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(1); }} aria-label="출처">
              <option value="">모든 출처</option><option value="HUMAN">사람</option><option value="MACHINE">엔진</option>
            </select>{' '}
            {d.on && <button className="btn-sm" disabled={a.busy === 'bf'} onClick={() => void a.run('bf', () => api('/admin/sfx/tm/backfill', { method: 'POST' }), v.reload)} data-sfx-tm-backfill="">지금 번역으로 채우기</button>}
          </p>
          <table className="tbl"><thead><tr><th>언어</th><th>원문</th><th>번역</th><th>출처</th><th className="num">쓰임</th><th>고친 때</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-sfx-tm-row={r.id} className={r.active ? '' : 'muted'}>
                <td>{r.lang}<div className="muted">{r.fromType}</div></td>
                <td>{r.src}{r.srcLen > 300 ? '…' : ''}</td><td>{r.tr}{r.trLen > 300 ? '…' : ''}</td>
                <td>{r.origin === 'HUMAN' ? '사람' : '엔진'}{r.editor ? <span className="muted"> {r.editor}</span> : null}{r.active ? null : <div className="warn-text">꺼짐</div>}</td>
                <td className="num">{num(r.hits)}{r.lastUsedAt ? <div className="muted">{ymd(r.lastUsedAt)}</div> : null}</td>
                <td>{ymdhm(r.updatedAt)}</td>
                <td>
                  <button className="btn-sm btn-plain" disabled={a.busy === `fx${r.id}`} onClick={() => fix(r)}>고치기</button>{' '}
                  <button className="btn-sm btn-plain" disabled={a.busy === `tg${r.id}`} onClick={() => toggle(r)}>{r.active ? '끄기' : '켜기'}</button>
                </td>
              </tr>))}
              {d.rows.length === 0 && <tr><td colSpan={7} className="muted">번역 메모리 줄이 없습니다.</td></tr>}
            </tbody></table>
          <p>
            <button className="btn-sm btn-plain" disabled={page <= 1} onClick={() => setPage(page - 1)}>앞</button>{' '}
            <span className="muted">{page}쪽</span>{' '}
            <button className="btn-sm btn-plain" disabled={d.rows.length < 50} onClick={() => setPage(page + 1)}>뒤</button>
          </p>
        </>
      )}
    </section>
  );
}
