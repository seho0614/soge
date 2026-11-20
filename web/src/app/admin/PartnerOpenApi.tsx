/* ===== v10.521 · 522 (D278 · docs/659 · 660) 파트너 오픈 API · 직원 일괄 등록 — web/src/app/admin/PartnerOpenApi.tsx 새 파일 =====
 * 파트너사 › 오픈 API(SB-ADM-OAPI-010)
 *   ADMIN · 안심 파트너 담당  키 · 웹훅 · 요청 기록 보기 · 키 거두기 · 웹훅 끄기 · 시험(ping) · 실패 줄 다시 보내기
 *   SUPER                    키 발급(원문 한 번) · 키 고치기 · 웹훅 만들기(비밀값 한 번) · 비밀값 바꾸기 · 설정(켜기 · 웹훅 · 방식 · 한도 · 보관) · 지금 보내기
 * 파트너사 › 직원 일괄 등록(SB-ADM-OAPI-020)
 *   CSV(email · can_settle) 올리기 → 미리보기(줄마다 결과) → 확정(확인 글자 「등록」) · 취소 · 묶음 자세히
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface PapiSettingsV { enabled: boolean; hookEnabled: boolean; hookMode: string; defaultRate: number; logKeepDays: number }
interface KeyRow { id: string; partnerId: string; company: string; name: string; prefix: string; scopes: string[]; ratePerMin: number; status: string; expiresAt: string; expired: boolean;
  lastUsedAt: string | null; createdAt: string; revokedAt: string | null; revokeReason: string | null; calls24h: number; errors24h: number }
interface HookRow { id: string; partnerId: string; company: string; url: string; events: string[]; secretLast4: string; status: string; failStreak: number; createdAt: string;
  rotatedAt: string | null; disabledAt: string | null; disabledReason: string | null; waiting: number; giveup: number }
interface PapiView { settings: PapiSettingsV; keys: KeyRow[]; hooks: HookRow[]; partners: Array<{ id: string; company: string; grade: string }>; day: { calls: number; denied: number; invalid: number };
  canIssue: boolean; scopes: string[]; events: string[]; note: string | null }
interface ReqRow { id: string; keyId: string | null; prefix: string | null; method: string; path: string; status: number; ms: number | null; reason: string | null; ipKey: string | null; at: string }
interface EvRow { id: string; event: string; eventUid: string; state: string; attempts: number; nextAt: string; lastStatus: number | null; lastError: string | null; sentAt: string | null; createdAt: string }

const SCOPE_KO: Record<string, string> = { 'leads:read': '배정 리드 읽기', 'services:read': '내 서비스 읽기', 'cash:read': '리드 이용료 읽기' };
const EVENT_KO: Record<string, string> = { 'lead.delivered': '리드 배정', 'lead.state_changed': '배정 상태 바뀜', ping: '시험' };
const EV_STATE: Record<string, string> = { PENDING: '대기', SENT: '보냄', ASSUMED: '간주', FAILED: '실패(다시)', GIVEUP: '포기', CANCELED: '취소' };

function OnceBox({ title, value, onClose }: { title: string; value: string; onClose: () => void }) {
  return (
    <div className="card pad" data-papi-once="">
      <b>{title}</b> — 지금 한 번만 보입니다. 닫으면 다시 볼 수 없습니다.
      <pre className="mono" data-papi-secret="">{value}</pre>
      <button className="btn-sm" onClick={() => { void navigator.clipboard?.writeText(value).catch(() => undefined); }}>복사</button>{' '}
      <button className="btn-sm btn-plain" onClick={onClose}>닫기</button>
    </div>
  );
}

function HookEvents({ id }: { id: string }) {
  const q = useApi<EvRow[]>(`/admin/papi/hooks/${id}/events`, [id]);
  const a = useAct();
  return (
    <div className="card pad" data-papi-events={q.data?.length ?? 0}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><thead><tr><th>일</th><th>상태</th><th>시도</th><th>마지막 응답</th><th>다음 · 보낸 때</th><th></th></tr></thead>
        <tbody>{(q.data ?? []).map((e) => (
          <tr key={e.id}><td>{EVENT_KO[e.event] ?? e.event}</td><td>{EV_STATE[e.state] ?? e.state}</td><td>{e.attempts}</td><td>{e.lastStatus ?? '—'}{e.lastError ? ` · ${e.lastError}` : ''}</td>
            <td>{e.sentAt ? ymdhm(e.sentAt) : ymdhm(e.nextAt)}</td>
            <td>{['FAILED', 'GIVEUP'].includes(e.state) && <button className="btn-sm btn-plain" onClick={() => void a.run('rt' + e.id, () => api(`/admin/papi/events/${e.id}/retry`, { method: 'POST' }), q.reload)}>다시 보내기</button>}</td></tr>
        ))}</tbody></table>
    </div>
  );
}

export function PtnOpenApi() {
  const q = useApi<PapiView>('/admin/papi');
  const a = useAct();
  const [once, setOnce] = useState<{ title: string; value: string } | null>(null);
  const [kf, setKf] = useState({ partnerId: '', name: '', scopes: ['leads:read'] as string[], ratePerMin: '', days: '365' });
  const [hf, setHf] = useState({ partnerId: '', url: '', events: ['lead.delivered'] as string[] });
  const [sf, setSf] = useState({ reason: '', defaultRate: '', logKeepDays: '' });
  const [evOf, setEvOf] = useState<string | null>(null);
  const [reqs, setReqs] = useState<ReqRow[] | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const s = d.settings;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const saveSettings = (extra: Record<string, unknown>) => void a.run('st', () => api('/admin/papi/settings', { method: 'PUT', body: JSON.stringify({
    reason: sf.reason, ...(sf.defaultRate ? { defaultRate: Number(sf.defaultRate) } : {}), ...(sf.logKeepDays ? { logKeepDays: Number(sf.logKeepDays) } : {}), ...extra }) }), q.reload);
  return (
    <section data-papi="" data-papi-on={s.enabled ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      {once && <OnceBox title={once.title} value={once.value} onClose={() => setOnce(null)} />}
      <table className="tbl"><tbody>
        <tr><th>오픈 API</th><td>{s.enabled ? '켜짐' : <span className="warn-text">꺼짐(처음) — 파트너 호출은 503 PAPI_OFF</span>} · 주소 <span className="mono">/api/partner/v1</span></td></tr>
        <tr><th>웹훅</th><td>{s.hookEnabled ? '켜짐' : '꺼짐(처음)'} · 방식 <b data-papi-mode={s.hookMode}>{s.hookMode === 'LIVE' ? '실제로 보냄' : '간주(보내지 않음)'}</b> · 처음 1분 한도 {s.defaultRate} · 기록 보관 {s.logKeepDays}일</td></tr>
        <tr><th>24시간</th><td>호출 {n(d.day?.calls)} · 막힘 {n(d.day?.denied)} · 틀린 키 <b>{n(d.day?.invalid)}</b></td></tr>
      </tbody></table>
      {d.note && <div className="ad-nt info">{d.note}</div>}

      <h3>키</h3>
      <table className="tbl" data-papi-keys={d.keys.length}><thead><tr><th>회사</th><th>이름</th><th>앞머리</th><th>범위</th><th>1분 한도</th><th>기한</th><th>24시간 호출 · 오류</th><th>마지막 사용</th><th></th></tr></thead>
        <tbody>{d.keys.map((k) => (
          <tr key={k.id} data-papi-key={k.status}><td>{k.company}</td><td>{k.name}</td><td className="mono">{k.prefix}</td><td>{k.scopes.map((x) => SCOPE_KO[x] ?? x).join(' · ')}</td><td>{k.ratePerMin}</td>
            <td>{ymdhm(k.expiresAt)}{k.expired ? <span className="warn-text"> · 지남</span> : ''}</td><td>{n(k.calls24h)} · {n(k.errors24h)}</td><td>{ymdhm(k.lastUsedAt)}</td>
            <td>{k.status === 'ACTIVE' ? <button className="btn-sm btn-plain" onClick={() => { const why = prompt('거두는 사유(2 ~ 200자)') ?? ''; if (why.trim().length >= 2) void a.run('rv' + k.id, () => api(`/admin/papi/keys/${k.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: why }) }), q.reload); }} data-papi-revoke="">거두기</button>
              : <span className="dim">거둠 · {k.revokeReason}</span>}{' '}
              <button className="btn-sm btn-plain" onClick={() => void a.run('rq' + k.id, () => api<ReqRow[]>(`/admin/papi/requests?keyId=${k.id}`).then((r) => { setReqs(r); return r; }), undefined, '요청 기록을 불러왔습니다.')}>기록</button></td></tr>
        ))}</tbody></table>
      {d.canIssue && (
        <div className="card pad" data-papi-issue="">
          <b>키 발급(최고 관리자)</b>
          <p>
            <select value={kf.partnerId} onChange={(e) => setKf({ ...kf, partnerId: e.target.value })}><option value="">파트너 고르기</option>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.company}</option>)}</select>{' '}
            <input className="inp" value={kf.name} onChange={(e) => setKf({ ...kf, name: e.target.value })} placeholder="키 이름(예: 상담 연동 서버)" />{' '}
            <label>1분 한도 <input className="inp" value={kf.ratePerMin} onChange={(e) => setKf({ ...kf, ratePerMin: e.target.value.replace(/\D/g, '') })} placeholder={String(s.defaultRate)} /></label>{' '}
            <label>기한(일) <input className="inp" value={kf.days} onChange={(e) => setKf({ ...kf, days: e.target.value.replace(/\D/g, '') })} /></label>
          </p>
          <p>{d.scopes.map((x) => <label key={x}><input type="checkbox" checked={kf.scopes.includes(x)} onChange={() => setKf({ ...kf, scopes: toggle(kf.scopes, x) })} /> {SCOPE_KO[x] ?? x}</label>)}{' '}
            <button className="btn-ok" disabled={!!a.busy || !kf.partnerId || kf.name.trim().length < 2 || !kf.scopes.length} onClick={() => void a.run('is', () => api<{ ok: boolean; key: string }>('/admin/papi/keys', { method: 'POST', body: JSON.stringify({
              partnerId: kf.partnerId, name: kf.name, scopes: kf.scopes, ...(kf.ratePerMin ? { ratePerMin: Number(kf.ratePerMin) } : {}), days: Number(kf.days || 365) }) }).then((r) => { setOnce({ title: 'API 키 원문', value: r.key }); return r; }), q.reload)} data-papi-issue-btn="">발급</button></p>
        </div>
      )}
      {reqs && (
        <table className="tbl" data-papi-reqs={reqs.length}><thead><tr><th>때</th><th>키</th><th>주소</th><th>응답</th><th>ms</th><th>까닭</th><th>IP 지문</th></tr></thead>
          <tbody>{reqs.map((r) => <tr key={r.id}><td>{ymdhm(r.at)}</td><td className="mono">{r.prefix ?? '—'}</td><td className="mono">{r.method} {r.path}</td><td>{r.status}</td><td>{r.ms ?? '—'}</td><td>{r.reason ?? ''}</td><td className="mono">{r.ipKey ?? ''}</td></tr>)}</tbody></table>
      )}

      <h3>웹훅</h3>
      <table className="tbl" data-papi-hooks={d.hooks.length}><thead><tr><th>회사</th><th>주소</th><th>받는 일</th><th>비밀값</th><th>상태</th><th>연속 실패</th><th>대기 · 포기</th><th></th></tr></thead>
        <tbody>{d.hooks.map((h) => (
          <tr key={h.id}><td>{h.company}</td><td className="mono">{h.url}</td><td>{h.events.map((x) => EVENT_KO[x] ?? x).join(' · ')}</td><td className="mono">••••{h.secretLast4}</td>
            <td>{h.status === 'ACTIVE' ? '켜짐' : `꺼짐 · ${h.disabledReason ?? ''}`}</td><td>{h.failStreak}</td><td>{h.waiting} · {h.giveup}</td>
            <td>
              <button className="btn-sm btn-plain" onClick={() => setEvOf(evOf === h.id ? null : h.id)}>보낸 줄</button>{' '}
              {h.status === 'ACTIVE' && <>
                <button className="btn-sm btn-plain" onClick={() => void a.run('pg' + h.id, () => api(`/admin/papi/hooks/${h.id}/test`, { method: 'POST' }), q.reload)} data-papi-ping="">시험</button>{' '}
                {d.canIssue && <button className="btn-sm btn-plain" onClick={() => { if (confirm('서명 비밀값을 바꿉니다. 파트너에게 새 값을 전해야 합니다.')) void a.run('ro' + h.id, () => api<{ secret: string }>(`/admin/papi/hooks/${h.id}/rotate`, { method: 'POST' }).then((r) => { setOnce({ title: '웹훅 서명 비밀값', value: r.secret }); return r; }), q.reload); }}>비밀값 바꾸기</button>}{' '}
                <button className="btn-sm btn-plain" onClick={() => { const why = prompt('끄는 사유(2 ~ 200자)') ?? ''; if (why.trim().length >= 2) void a.run('of' + h.id, () => api(`/admin/papi/hooks/${h.id}/disable`, { method: 'POST', body: JSON.stringify({ reason: why }) }), q.reload); }}>끄기</button>
              </>}
            </td></tr>
        ))}</tbody></table>
      {evOf && <HookEvents id={evOf} />}
      {d.canIssue && (
        <div className="card pad" data-papi-hook-new="">
          <b>웹훅 만들기(최고 관리자 · 파트너마다 하나)</b>
          <p>
            <select value={hf.partnerId} onChange={(e) => setHf({ ...hf, partnerId: e.target.value })}><option value="">파트너 고르기</option>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.company}</option>)}</select>{' '}
            <input className="inp" value={hf.url} onChange={(e) => setHf({ ...hf, url: e.target.value.trim() })} placeholder="https://partner.example.com/webhook" />{' '}
            {d.events.map((x) => <label key={x}><input type="checkbox" checked={hf.events.includes(x)} onChange={() => setHf({ ...hf, events: toggle(hf.events, x) })} /> {EVENT_KO[x] ?? x}</label>)}{' '}
            <button className="btn-ok" disabled={!!a.busy || !hf.partnerId || !hf.url.startsWith('https://') || !hf.events.length} onClick={() => void a.run('hk', () => api<{ secret: string }>('/admin/papi/hooks', { method: 'POST', body: JSON.stringify(hf) }).then((r) => { setOnce({ title: '웹훅 서명 비밀값', value: r.secret }); return r; }), q.reload)}>만들기</button>
          </p>
        </div>
      )}
      {d.canIssue && (
        <div className="card pad" data-papi-settings="">
          <b>설정(최고 관리자)</b>
          <p>
            <label>사유 <input className="inp" value={sf.reason} onChange={(e) => setSf({ ...sf, reason: e.target.value })} placeholder="2 ~ 200자" /></label>{' '}
            <label>처음 1분 한도 <input className="inp" value={sf.defaultRate} onChange={(e) => setSf({ ...sf, defaultRate: e.target.value.replace(/\D/g, '') })} placeholder={String(s.defaultRate)} /></label>{' '}
            <label>기록 보관(일) <input className="inp" value={sf.logKeepDays} onChange={(e) => setSf({ ...sf, logKeepDays: e.target.value.replace(/\D/g, '') })} placeholder={String(s.logKeepDays)} /></label>{' '}
            <button className="btn-sm" disabled={!!a.busy} onClick={() => saveSettings({})}>저장</button>
          </p>
          <p>
            <button className="btn-sm" disabled={!!a.busy} onClick={() => { if (confirm(s.enabled ? '오픈 API 를 끕니다(파트너 호출이 바로 503).' : '보안 검토(docs/659 6절)를 마쳤습니까? 오픈 API 를 켭니다.')) saveSettings({ enabled: !s.enabled, reason: sf.reason || (s.enabled ? '오픈 API 끔' : '오픈 API 켬') }); }} data-papi-enable="">{s.enabled ? 'API 끄기' : 'API 켜기'}</button>{' '}
            <button className="btn-sm" disabled={!!a.busy} onClick={() => saveSettings({ hookEnabled: !s.hookEnabled, reason: sf.reason || (s.hookEnabled ? '웹훅 끔' : '웹훅 켬') })}>{s.hookEnabled ? '웹훅 끄기' : '웹훅 켜기'}</button>{' '}
            <button className="btn-sm" disabled={!!a.busy} onClick={() => saveSettings({ hookMode: s.hookMode === 'LIVE' ? 'ASSUME' : 'LIVE', reason: sf.reason || '웹훅 방식 바꿈' })}>{s.hookMode === 'LIVE' ? '간주로' : '실제로 보내기로'}</button>{' '}
            <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => void a.run('run', () => api('/admin/papi/run', { method: 'POST' }), q.reload, (r: unknown) => { const x = r as { on: boolean; sent: number; assumed: number; failed: number }; return x.on ? `보냄 ${x.sent} · 간주 ${x.assumed} · 실패 ${x.failed}` : '꺼져 있어 보내지 않았습니다.'; })}>지금 한 번 보내기</button>
          </p>
        </div>
      )}
      <div className="ad-nt info">키 원문 · 웹훅 비밀값은 발급 때 한 번만 보입니다(DB 에는 지문 · 암호문만). 범위는 읽기 3종뿐이고 연락처는 API 로 나가지 않습니다. 켜기 전 보안 검토 · 파트너 이용 약정(docs/659 6절)을 마치십시오.</div>
    </section>
  );
}

/* ── 직원 일괄 등록 ─────────────────────────────────────────────── */
interface PbulkView { settings: { inviteMail: boolean; maxRows: number; pendingDays: number }; items: Array<{ id: string; company: string; fileName: string | null; state: string; total: number; nMember: number; nPending: number; nBad: number;
  createdAt: string; confirmedAt: string | null; waiting: number; matched: number }>; partners: Array<{ id: string; company: string }>; canConfirm: boolean; columns: string[] }
interface PreviewRes { ok: boolean; id: string; company: string; total: number; counts: Record<string, number>; rows: Array<{ line: number; email: string | null; result: string; canSettle: boolean }>; note: string }
interface DetailRes { batch: { id: string; company: string; state: string; total: number }; rows: Array<{ line: number; email: string | null; canSettle: boolean; result: string; state: string; mailState: string | null; expiresAt: string | null; doneAt: string | null }> }

const RESULT_KO: Record<string, string> = { MEMBER: '가입 회원 → 초대', PENDING: '가입 대기', DUPLICATE: '파일 안 중복', INVALID: '이메일 모양 아님', ALREADY: '이미 직원', OTHER_BUSINESS: '다른 사업자 소속', SELF: '대표 계정' };
const ROW_STATE: Record<string, string> = { PREVIEW: '미리보기', INVITED: '초대함', PENDING: '가입 대기', MATCHED: '가입 → 초대', EXPIRED: '기한 지남', SKIPPED: '건너뜀', CANCELED: '취소' };
const BATCH_STATE: Record<string, string> = { PREVIEW: '미리보기', CONFIRMED: '확정', CANCELED: '취소' };

function BulkDetail({ id }: { id: string }) {
  const q = useApi<DetailRes>(`/admin/pbulk/${id}`, [id]);
  const d = q.data;
  if (!d) return null;
  return (
    <table className="tbl" data-pbulk-detail={d.rows.length}><thead><tr><th>줄</th><th>이메일(가림)</th><th>정산 권한</th><th>결과</th><th>상태</th><th>메일</th><th>기한 · 끝난 때</th></tr></thead>
      <tbody>{d.rows.map((r) => <tr key={r.line}><td>{r.line}</td><td className="mono">{r.email ?? '—'}</td><td>{r.canSettle ? '있음' : ''}</td><td>{RESULT_KO[r.result] ?? r.result}</td><td>{ROW_STATE[r.state] ?? r.state}</td><td>{r.mailState ?? ''}</td><td>{r.doneAt ? ymdhm(r.doneAt) : ymdhm(r.expiresAt)}</td></tr>)}</tbody></table>
  );
}

export function PtnBulkInvite() {
  const q = useApi<PbulkView>('/admin/pbulk');
  const a = useAct();
  const [partnerId, setPartnerId] = useState('');
  const [csv, setCsv] = useState('email,can_settle\n');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pv, setPv] = useState<PreviewRes | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200_000) { a.setErr('CSV 는 200KB 까지입니다 — 나눠서 올리십시오.'); return; }
    const r = new FileReader();
    r.onload = () => { setCsv(String(r.result ?? '')); setFileName(f.name); };
    r.readAsText(f, 'utf-8');
  };
  return (
    <section data-pbulk="" data-pbulk-mail={d.settings.inviteMail ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        <tr><th>받는 칸</th><td><span className="mono">{d.columns.join(',')}</span> — 이름 · 전화 같은 칸은 받지 않습니다(개인정보 최소)</td></tr>
        <tr><th>초대 메일</th><td>{d.settings.inviteMail ? '켜짐' : '꺼짐(처음) — 기록만 · 회원에게 직접 알려 주십시오'} · 한 번에 {n(d.settings.maxRows)}줄 · 가입 대기 {d.settings.pendingDays}일</td></tr>
      </tbody></table>
      <div className="card pad" data-pbulk-new="">
        <p>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}><option value="">파트너 고르기</option>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.company}</option>)}</select>{' '}
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => pick(e.target.files?.[0])} data-pbulk-file="" />
        </p>
        <p><textarea value={csv} rows={8} cols={60} onChange={(e) => { setCsv(e.target.value); setFileName(null); }} data-pbulk-csv="" /></p>
        <p><button className="btn-ok" disabled={!!a.busy || !partnerId || csv.trim().split(/\r?\n/).length < 2} onClick={() => void a.run('pv', () => api<PreviewRes>('/admin/pbulk/preview', { method: 'POST', body: JSON.stringify({ partnerId, csv, ...(fileName ? { fileName } : {}) }) }).then((r) => { setPv(r); return r; }), q.reload)} data-pbulk-preview="">미리보기</button></p>
      </div>
      {pv && (
        <div className="card pad" data-pbulk-pv={pv.total}>
          <b>{pv.company}</b> · {pv.total}줄 — {Object.entries(pv.counts).filter(([, v]) => v).map(([k, v]) => `${RESULT_KO[k] ?? k} ${v}`).join(' · ')}
          <table className="tbl"><thead><tr><th>줄</th><th>이메일(가림)</th><th>정산 권한</th><th>결과</th></tr></thead>
            <tbody>{pv.rows.map((r) => <tr key={r.line}><td>{r.line}</td><td className="mono">{r.email ?? '—'}</td><td>{r.canSettle ? '있음' : ''}</td><td>{RESULT_KO[r.result] ?? r.result}</td></tr>)}</tbody></table>
          <p>
            {d.canConfirm && <button className="btn-ok" disabled={!!a.busy} onClick={() => { const ok = prompt('가입 회원은 직원 초대 · 미가입은 가입 대기로 둡니다. 확인하려면 「등록」을 넣으십시오.') ?? ''; if (ok.trim() === '등록') void a.run('cf', () => api(`/admin/pbulk/${pv.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirm: '등록' }) }), () => { setPv(null); q.reload(); }); }} data-pbulk-confirm="">확정</button>}{' '}
            <button className="btn-sm btn-plain" onClick={() => { const why = prompt('취소 사유(2 ~ 200자)') ?? ''; if (why.trim().length >= 2) void a.run('cn', () => api(`/admin/pbulk/${pv.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: why }) }), () => { setPv(null); q.reload(); }); }}>취소</button>
          </p>
        </div>
      )}
      <table className="tbl" data-pbulk-list={d.items.length}><thead><tr><th>회사</th><th>파일</th><th>상태</th><th>줄</th><th>초대 · 가입 대기 · 건너뜀</th><th>지금 대기 · 짝 맞춤</th><th>만든 때</th></tr></thead>
        <tbody>{d.items.map((b) => (
          <tr key={b.id} onClick={() => setSel(sel === b.id ? null : b.id)} className={sel === b.id ? 'on' : ''}><td>{b.company}</td><td>{b.fileName ?? '—'}</td><td>{BATCH_STATE[b.state] ?? b.state}</td><td>{b.total}</td>
            <td>{b.nMember} · {b.nPending} · {b.nBad}</td><td>{b.waiting} · {b.matched}</td><td>{ymdhm(b.createdAt)}</td></tr>
        ))}</tbody></table>
      {sel && <BulkDetail id={sel} />}
      <div className="ad-nt info">계정을 대신 만들지 않습니다 — 이미 가입한 회원은 직원 초대(받아들이면 합류), 아직 안 한 분은 가입 대기(같은 이메일로 가입하면 15분 안에 초대로 바뀜 · 기한이 지나면 이메일을 지움). 줄마다 감사 기록이 남습니다.</div>
    </section>
  );
}
