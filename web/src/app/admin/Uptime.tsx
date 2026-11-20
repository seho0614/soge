/* ===== v10.497 · 498 (D272 · docs/635 · 636) 가동 감시 · 장애 공지 · 간편 로그인 — web/src/app/admin/Uptime.tsx 새 파일 =====
 * 위험감지 › 가동 · 장애 공지(SB-ADM-UPT-010 · 탭 upt-status)
 *   ADMIN · SUPER  대상별 바깥 감시 상태(24시간 가동률) · 장애 공지 올리기 · 진행 글 · 띠 끄기 · 사이트 점검 예약(D239 MaintenanceBox 그대로)
 *   SUPER          결과 받기 켜기 · 연속 실패 수 · 보관 날수 · 감시 토큰 새로 만들기(원문은 한 번만)
 * 회원 › 간편 로그인(SB-ADM-UPT-020 · 탭 soc-login)
 *   ADMIN · SUPER  카카오 · 네이버 켜짐 · 방식 · 키 준비(카카오 client_id 출처) · 연결 수 · 30일 기록 · 7일 실패
 *   SUPER          켜기 · 끄기 · 방식(ASSUME · LIVE) · 처리방침 확인 표시(사유)
 * 새 CSS 없음 — app.css 의 tbl · card · kpi4 · btn-sm · btn-plain · inp-sm · muted · warn-text · mono · ad-nt 만
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { MaintenanceBox } from './OpsStaffBoxes';   // v10.371 (D239) 사이트 점검 예약 — 장애 공지와 함께 씀

/* ── 가동 · 장애 공지 ─────────────────────────────────────────── */
interface Note { id: number; state: string; body: string; bodyEn: string | null; at: string }
interface Incident { id: string; title: string; titleEn: string | null; level: string; state: string; parts: string[]; banner: boolean; startedAt: string; resolvedAt: string | null; notes: Note[] }
interface Target { target: string; down: boolean; fails: number; downSince: string | null; lastOk: boolean | null; lastAt: string | null; checks24: number | null; fails24: number | null; avgMs24: number | null; uptime24: string | number | null }
interface UptView {
  settings: { report: boolean; tokenSet: boolean; failCount: number; keepDays: number };
  lastReportAt: string | null; targets: Target[]; incidents: Incident[]; canEdit: boolean; isSuper: boolean;
  levels: string[]; states: string[]; parts: string[];
}
const LEVEL: Record<string, string> = { MINOR: '일부 느림', MAJOR: '일부 안 됨', CRITICAL: '전체 안 됨' };
const STATE: Record<string, string> = { INVESTIGATING: '조사 중', IDENTIFIED: '원인 찾음', MONITORING: '지켜보는 중', RESOLVED: '끝남' };
const PART: Record<string, string> = { SITE: '사용자 웹', API: '서버', LOGIN: '로그인', PAY: '결제', MALL: '소개몰', MAIL: '메일 · 알림', ADMIN: '운영 화면' };

export function UptStatus() {
  const q = useApi<UptView>('/admin/uptime');
  const a = useAct();
  const [f, setF] = useState<{ title: string; titleEn: string; level: string; parts: string[]; body: string; bodyEn: string; banner: boolean; notifyOps: boolean } | null>(null);
  const [nt, setNt] = useState<{ id: string; state: string; body: string; bodyEn: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const s = d.settings;
  const open = d.incidents.filter((x) => x.state !== 'RESOLVED');
  const putSet = (body: Record<string, unknown>) => void a.run('set', () => api('/admin/uptime/settings', { method: 'PUT', body: JSON.stringify(body) }), q.reload);
  const ask = (t: string) => { const w = prompt(t) ?? ''; return w.trim().length >= 2 ? w.trim() : null; };
  return (
    <section data-upt-status="" data-upt-report={s.report ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <div className="kpi4">
        <div><b data-upt-open={open.length}>{open.length}</b><span>진행 중 장애 공지</span></div>
        <div><b>{d.targets.filter((t) => t.down).length}</b><span>내려간 감시 대상</span></div>
        <div><b>{d.targets.length}</b><span>감시 대상</span></div>
        <div><b>{d.lastReportAt ? ymdhm(d.lastReportAt) : '—'}</b><span>마지막 n8n 결과</span></div>
      </div>

      <h3>바깥 감시(자동화 서버 n8n)</h3>
      <table className="tbl"><tbody>
        <tr><th>결과 받기</th><td>{s.report ? '켜짐 — n8n 이 보낸 결과를 받음' : '꺼짐(처음) — 토큰을 만든 뒤 켭니다'}</td></tr>
        <tr><th>감시 토큰</th><td>{s.tokenSet ? '있음(지문만 저장)' : '없음'}</td></tr>
        <tr><th>알림 기준</th><td>연속 {s.failCount}번 실패면 운영 알림 UPTIME_DOWN(긴급 — 텔레그램 길) · 다시 되면 UPTIME_RECOVERED · 결과 {s.keepDays}일 보관</td></tr>
      </tbody></table>
      {d.isSuper && (
        <p data-upt-super="">
          <button className="btn-sm" disabled={!!a.busy} onClick={() => { const w = ask(s.report ? '결과 받기를 끄는 사유' : '결과 받기를 켜는 사유'); if (w) putSet({ report: !s.report, reason: w }); }} data-upt-report-toggle="">{s.report ? '받기 끄기' : '받기 켜기'}</button>{' '}
          <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => {
            const w = ask('토큰을 새로 만드는 사유 — 옛 토큰은 바로 못 씁니다(n8n 자격 증명도 바꿔야 함)');
            if (w) void a.run('tok', async () => { const r = await api<{ ok: boolean; token: string; note: string }>('/admin/uptime/token', { method: 'POST', body: JSON.stringify({ reason: w }) }); setToken(r.token); return r; }, q.reload);
          }} data-upt-token="">토큰 새로 만들기</button>{' '}
          <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => {
            const n = Number(prompt('연속 실패 몇 번이면 알림(1 ~ 10)', String(s.failCount)) ?? ''); const w = Number.isInteger(n) ? ask('바꾸는 사유') : null;
            if (w) putSet({ failCount: n, reason: w });
          }}>알림 기준 바꾸기</button>
        </p>
      )}
      {token && <div className="ad-nt warn" data-upt-token-once="">새 토큰(지금 한 번만 보임): <span className="mono">{token}</span> — n8n 의 Header Auth 자격 증명(이름 X-Uptime-Token)에 넣으십시오. <button className="btn-sm btn-plain" onClick={() => setToken(null)}>닫기</button></div>}
      <table className="tbl" data-upt-targets={d.targets.length}><thead><tr><th>대상</th><th>지금</th><th>연속 실패</th><th>24시간 가동률</th><th>평균 ms</th><th>마지막</th></tr></thead>
        <tbody>{d.targets.length === 0 ? <tr><td colSpan={6} className="muted">아직 받은 결과가 없습니다 — docs/635 의 n8n 워크플로를 자동화 서버에 넣고 결과 받기를 켜십시오.</td></tr>
          : d.targets.map((t) => (
            <tr key={t.target} data-upt-target={t.target}><td className="mono">{t.target}</td>
              <td className={t.down ? 'warn-text' : ''}>{t.down ? `내려감(${ymdhm(t.downSince)}부터)` : t.lastOk === false ? '실패(기준 아래)' : '정상'}</td>
              <td>{t.fails}</td><td>{t.uptime24 == null ? '—' : `${t.uptime24}%`} <span className="muted">({t.checks24 ?? 0}번 중 실패 {t.fails24 ?? 0})</span></td>
              <td>{t.avgMs24 ?? '—'}</td><td>{ymdhm(t.lastAt)}</td></tr>
          ))}</tbody></table>

      <h3>장애 공지</h3>
      {d.canEdit && (f == null ? (
        <p><button className="btn-sm" onClick={() => setF({ title: '', titleEn: '', level: 'MINOR', parts: [], body: '', bodyEn: '', banner: true, notifyOps: true })} data-upt-new="">장애 공지 올리기</button></p>
      ) : (
        <div className="card" data-upt-form="">
          <p><label>제목 <input className="inp-sm" style={{ width: 260 }} value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예: 결제 화면이 느립니다" /></label>{' '}
            <label>영어 제목 <input className="inp-sm" style={{ width: 260 }} value={f.titleEn} maxLength={160} onChange={(e) => setF({ ...f, titleEn: e.target.value })} placeholder="선택" /></label></p>
          <p><label>정도 <select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{d.levels.map((l) => <option key={l} value={l}>{LEVEL[l] ?? l}</option>)}</select></label>{' '}
            영향 {d.parts.map((p) => (
              <label key={p}><input type="checkbox" checked={f.parts.includes(p)} onChange={(e) => setF({ ...f, parts: e.target.checked ? [...f.parts, p] : f.parts.filter((x) => x !== p) })} /> {PART[p] ?? p}</label>
            ))}</p>
          <p><label>첫 안내 글 <input className="inp-sm" style={{ width: 260 }} value={f.body} maxLength={1000} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="예: 원인을 찾고 있습니다." /></label>{' '}
            <label>영어 <input className="inp-sm" style={{ width: 260 }} value={f.bodyEn} maxLength={1500} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} placeholder="선택" /></label></p>
          <p><label><input type="checkbox" checked={f.banner} onChange={(e) => setF({ ...f, banner: e.target.checked })} /> 사용자 웹 맨 위 띠</label>{' '}
            <label><input type="checkbox" checked={f.notifyOps} onChange={(e) => setF({ ...f, notifyOps: e.target.checked })} /> 운영 알림(일부 안 됨 · 전체 안 됨은 긴급)</label></p>
          <p><button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('new', () => api('/admin/uptime/incidents', { method: 'POST', body: JSON.stringify({ ...f, titleEn: f.titleEn || undefined, bodyEn: f.bodyEn || undefined }) }), () => { setF(null); q.reload(); })} data-upt-save="">올리기</button>{' '}
            <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button></p>
        </div>
      ))}
      <table className="tbl" data-upt-incidents={d.incidents.length}><thead><tr><th>시작</th><th>제목</th><th>정도</th><th>영향</th><th>상태</th><th>띠</th><th /></tr></thead>
        <tbody>{d.incidents.map((x) => { const last = x.notes.length ? x.notes[0] : undefined; return (
          <tr key={x.id} data-upt-incident={x.state}>
            <td>{ymdhm(x.startedAt)}{x.resolvedAt && <><br /><span className="muted">끝 {ymdhm(x.resolvedAt)}</span></>}</td>
            <td><b>{x.title}</b>{last && <><br /><span className="muted">{last.body}</span></>}</td>
            <td className={x.level !== 'MINOR' ? 'warn-text' : ''}>{LEVEL[x.level] ?? x.level}</td>
            <td>{x.parts.map((p) => PART[p] ?? p).join(' · ') || '—'}</td>
            <td>{STATE[x.state] ?? x.state}</td>
            <td>{x.banner ? '켬' : '끔'}</td>
            <td>{d.canEdit && (<>
              {x.state !== 'RESOLVED' && <button className="btn-sm" onClick={() => setNt({ id: x.id, state: x.state === 'INVESTIGATING' ? 'IDENTIFIED' : 'RESOLVED', body: '', bodyEn: '' })} data-upt-note-open="">진행 글</button>}{' '}
              <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => void a.run('b' + x.id, () => api(`/admin/uptime/incidents/${x.id}`, { method: 'PUT', body: JSON.stringify({ banner: !x.banner }) }), q.reload)}>{x.banner ? '띠 끄기' : '띠 켜기'}</button>
            </>)}</td>
          </tr>
        ); })}</tbody></table>
      {nt && (
        <div className="card" data-upt-note-form="">
          <p><label>상태 <select value={nt.state} onChange={(e) => setNt({ ...nt, state: e.target.value })}>{d.states.map((st) => <option key={st} value={st}>{STATE[st] ?? st}</option>)}</select></label>{' '}
            <label>글 <input className="inp-sm" style={{ width: 260 }} value={nt.body} maxLength={1000} onChange={(e) => setNt({ ...nt, body: e.target.value })} placeholder="예: 원인을 찾았습니다 — 복구 중" /></label>{' '}
            <label>영어 <input className="inp-sm" style={{ width: 260 }} value={nt.bodyEn} maxLength={1500} onChange={(e) => setNt({ ...nt, bodyEn: e.target.value })} placeholder="선택" /></label></p>
          <p><button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('note', () => api(`/admin/uptime/incidents/${nt.id}/notes`, { method: 'POST', body: JSON.stringify({ state: nt.state, body: nt.body, bodyEn: nt.bodyEn || undefined }) }), () => { setNt(null); q.reload(); })} data-upt-note-save="">더하기</button>{' '}
            <button className="btn-sm btn-plain" onClick={() => setNt(null)}>닫기</button></p>
        </div>
      )}
      <h3>사이트 점검 예약(점검 중 화면)</h3>
      <MaintenanceBox />
      <div className="ad-nt info">서버가 아예 응답하지 않으면 이 화면도 열리지 않습니다 — 그때는 자동화 서버 n8n 이 텔레그램으로 직접 알립니다(docs/635). 장애 공지 띠는 점검 중 화면 위에도 나옵니다.</div>
    </section>
  );
}

/* ── 간편 로그인 ─────────────────────────────────────────────── */
interface SocView {
  settings: { kakao: boolean; naver: boolean; mode: string; privacyOk: boolean };
  ready: Record<'KAKAO' | 'NAVER', { ready: boolean; clientFrom: 'OWN' | 'MAP' | null; secret: boolean }>;
  prod: boolean; links: Array<{ provider: string; n: number; assumed: number }>;
  events30: Array<{ provider: string; kind: string; n: number }>; fails7: Array<{ provider: string; reason: string | null; n: number }>;
  canEdit: boolean;
}
const KIND: Record<string, string> = { LOGIN: '로그인', SIGNUP: '가입', LINK: '연결', UNLINK: '해제', FAIL: '실패' };
const PNAME: Record<string, string> = { KAKAO: '카카오', NAVER: '네이버' };

export function SocLogin() {
  const q = useApi<SocView>('/admin/social');
  const a = useAct();
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const s = d.settings;
  const put = (body: Record<string, unknown>, t: string) => { const w = prompt(t) ?? ''; if (w.trim().length >= 2) void a.run('soc', () => api('/admin/social/settings', { method: 'PUT', body: JSON.stringify({ ...body, reason: w.trim() }) }), q.reload); };
  const cnt = (p: string, k: string) => d.events30.find((e) => e.provider === p && e.kind === k)?.n ?? 0;
  return (
    <section data-soc-login="" data-soc-mode={s.mode}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><thead><tr><th>업체</th><th>켜짐</th><th>키</th><th>연결 수</th><th>30일 로그인 · 가입 · 연결 · 해제 · 실패</th><th /></tr></thead>
        <tbody>{(['KAKAO', 'NAVER'] as const).map((p) => {
          const on = p === 'KAKAO' ? s.kakao : s.naver; const r = d.ready[p];
          return (
            <tr key={p} data-soc-provider={p} data-soc-on={on ? 'on' : 'off'}>
              <td>{PNAME[p]}</td><td>{on ? '켜짐' : '꺼짐'}</td>
              <td>{r.ready ? (p === 'KAKAO' ? `있음 — client_id ${r.clientFrom === 'MAP' ? '카카오맵 REST 키를 다시 씀' : '간편 로그인 전용 키'}${r.secret ? ' · Client Secret 있음' : ''}` : '있음') : <span className="warn-text">없음</span>}</td>
              <td>{d.links.find((x) => x.provider === p)?.n ?? 0}</td>
              <td>{['LOGIN', 'SIGNUP', 'LINK', 'UNLINK', 'FAIL'].map((k) => `${KIND[k]} ${cnt(p, k)}`).join(' · ')}</td>
              <td>{d.canEdit && <button className="btn-sm" disabled={!!a.busy} onClick={() => put(p === 'KAKAO' ? { kakao: !on } : { naver: !on }, `${PNAME[p]} 간편 로그인을 ${on ? '끄는' : '켜는'} 사유`)} data-soc-toggle={p}>{on ? '끄기' : '켜기'}</button>}</td>
            </tr>
          );
        })}</tbody></table>
      <table className="tbl"><tbody>
        <tr><th>방식</th><td>{s.mode === 'LIVE' ? '업체(LIVE)' : `간주(ASSUME) — 업체를 부르지 않음${d.prod ? ' · 운영 서버라 간주 로그인은 막힘' : ' · 점검판 시험용'}`}</td></tr>
        <tr><th>처리방침 확인</th><td>{s.privacyOk ? '마침 — 처리방침에 간편 로그인 항목 게시 · 법무 확인' : <span className="warn-text">아직 — LIVE 로 켜기 전에 처리방침을 고쳐 게시하십시오(docs/636 5절)</span>}</td></tr>
      </tbody></table>
      {d.canEdit && (
        <p>
          <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => put({ mode: s.mode === 'LIVE' ? 'ASSUME' : 'LIVE' }, s.mode === 'LIVE' ? '간주로 되돌리는 사유' : 'LIVE 로 바꾸는 사유(키 · 처리방침 확인이 먼저)')} data-soc-mode-toggle="">{s.mode === 'LIVE' ? '간주로' : 'LIVE 로'}</button>{' '}
          <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => put({ privacyOk: !s.privacyOk }, s.privacyOk ? '처리방침 확인을 되돌리는 사유' : '처리방침 게시 · 법무 확인을 마쳤다는 근거(게시일 · 판)')} data-soc-privacy="">{s.privacyOk ? '처리방침 확인 되돌리기' : '처리방침 확인 마침'}</button>
        </p>
      )}
      {d.fails7.length > 0 && (
        <table className="tbl" data-soc-fails={d.fails7.length}><thead><tr><th>업체</th><th>7일 실패 코드</th><th>건수</th></tr></thead>
          <tbody>{d.fails7.map((x, i) => <tr key={i}><td>{PNAME[x.provider] ?? x.provider}</td><td className="mono">{x.reason ?? '—'}</td><td>{x.n}</td></tr>)}</tbody></table>
      )}
      <div className="ad-nt info">키는 외부 연동 › 연동 키(간편 로그인 — KAKAO_LOGIN_CLIENT_ID · KAKAO_LOGIN_SECRET · NAVER_CLIENT_ID · NAVER_CLIENT_SECRET)에 넣습니다. 카카오 client_id 를 비우면 카카오맵 REST 키를 씁니다(같은 카카오 앱일 때만). 업체 회원 번호는 지문만 저장하고, 같은 이메일 계정이 있어도 저절로 합치지 않습니다(비밀번호 확인 뒤 연결). 운영 역할 계정은 간편 로그인을 쓸 수 없습니다.</div>
    </section>
  );
}
