/* ===== v10.483 (D268 · docs/621) 문자 · 메일 캠페인 — web/src/app/admin/MktCampaigns.tsx 새 파일 =====
 * 회원 › 문자 · 메일 캠페인(SB-ADM-SCU-010)
 *   ADMIN · SUPER  초안 만들기 · 고치기 · 받을 사람 보기 · 나에게 시험 보내기(광고 표기 붙은 미리보기) · 취소
 *   SUPER          보내기(확인 글자 「보내기」 · 예약) · 지금 한 번 보내기 · 설정(켜기 · 방식 · 보낸 곳 · 연락처 · 080 · 발신번호)
 *   정보통신망법 제50조 — 동의자만 · 야간은 야간 동의자만 · (광고) · 수신 거부는 서버가 붙임(이 화면은 그 결과를 보여 줄 뿐)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface Settings { enabled: boolean; mode: string; senderName: string; smsName: string; contact: string; optoutPhone: string; smsFrom: string; batch: number; baseUrl: string }
interface Row { id: string; title: string; channel: string; audience: string; state: string; scheduledAt: string | null; sendMode: string | null; queuedAt: string | null; finishedAt: string | null;
  lastNote: string | null; createdAt: string; unsubscribed: number; total: number; queued: number; sent: number; assumed: number; skipped: number; failed: number }
interface View { settings: Settings; ready: { mail: boolean; mailReason: string | null; sms: boolean; smsMissing: string[] }; night: boolean; violations: number; items: Row[]; canSend: boolean }
interface Detail { campaign: { id: string; title: string; channel: string; subject: string | null; body: string; audience: string; state: string; cancelReason: string | null; lastNote: string | null };
  counts: Record<string, number>; reasons: Array<{ reason: string; n: number }>; recent: Array<{ id: string; to: string | null; state: string; skipReason: string | null; error: string | null; test: boolean; night: boolean | null; sentAt: string | null }>; unsubscribed: number }
interface Audience { consented: number; stale: number; noAddr: number; suppressed: number; willSend: number; nightOk: number; night: boolean; note: string }

const STATE: Record<string, string> = { DRAFT: '초안', QUEUED: '대기(예약)', SENDING: '보내는 중', DONE: '끝', CANCELED: '취소' };
const CH: Record<string, string> = { EMAIL: '메일', SMS: '문자' };
const AUD: Record<string, string> = { ALL: '동의한 모든 회원', RECENT_90: '90일 안 로그인한 동의 회원', CHURN_RISK: '이탈 위험 신호 회원(동의자만)', MALL_BUYERS: '소개몰 구매 회원(180일 · 동의자만)', MALL_REBUY: '재구매 시기 회원(동의자만)' };   // v10.529 (D280) · v10.541 (D283)
const SKIP: Record<string, string> = { NO_CONSENT: '동의 없음', INACTIVE: '쓰지 않는 계정', NO_ADDRESS: '받는 곳 없음', SUPPRESSED: '반송 · 거부 주소', CANCELED: '취소', UNSUBSCRIBED: '수신 거부' };
const EMPTY = { title: '', channel: 'EMAIL', subject: '', body: '', audience: 'ALL' };

function DetailBox({ id, canSend, onDone }: { id: string; canSend: boolean; onDone: () => void }) {
  const q = useApi<Detail>(`/admin/marketing/campaigns/${id}`, [id]);
  const a = useAct();
  const [aud, setAud] = useState<Audience | null>(null);
  const [pv, setPv] = useState<{ subject: string | null; text: string } | null>(null);
  const [edit, setEdit] = useState<{ title: string; subject: string; body: string } | null>(null);
  const [at, setAt] = useState('');
  const d = q.data;
  if (!d) return null;
  const c = d.campaign;
  const reload = () => { q.reload(); onDone(); };
  return (
    <div className="card pad" data-mkt-detail={c.state}>
      <Flash msg={a.msg} err={a.err} />
      <b>{c.title}</b> · {CH[c.channel]} · {AUD[c.audience] ?? c.audience} · <span data-mkt-state={c.state}>{STATE[c.state] ?? c.state}</span>{c.lastNote ? <span className="dim"> · {c.lastNote}</span> : null}
      {edit == null ? (
        <pre className="card pad" data-mkt-body="">{c.channel === 'EMAIL' ? `제목: ${c.subject ?? ''}\n\n` : ''}{c.body}</pre>
      ) : (
        <div data-mkt-edit="">
          <p><input className="inp" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="캠페인 이름" /></p>
          {c.channel === 'EMAIL' && <p><input className="inp" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} placeholder="메일 제목(앞에 「(광고)」가 붙음)" /></p>}
          <p><textarea value={edit.body} rows={8} cols={70} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></p>
          <p><button className="btn-sm" onClick={() => void a.run('ed', () => api(`/admin/marketing/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(edit) }), () => { setEdit(null); reload(); })}>저장</button>{' '}
            <button className="btn-sm btn-plain" onClick={() => setEdit(null)}>닫기</button></p>
        </div>
      )}
      <p>
        {c.state === 'DRAFT' && <button className="btn-sm btn-plain" onClick={() => setEdit({ title: c.title, subject: c.subject ?? '', body: c.body })}>고치기</button>}{' '}
        <button className="btn-sm" onClick={() => void a.run('au', () => api<Audience>(`/admin/marketing/campaigns/${id}/audience`).then((r) => { setAud(r); return r; }), undefined, '받을 사람을 셌습니다.')} data-mkt-audience="">받을 사람 보기</button>{' '}
        <button className="btn-sm" onClick={() => void a.run('te', () => api<{ ok: boolean; preview: { subject: string | null; text: string }; note: string }>(`/admin/marketing/campaigns/${id}/test`, { method: 'POST' }).then((r) => { setPv(r.preview); q.reload(); return r; }))} data-mkt-test="">나에게 시험 보내기</button>{' '}
        {['DRAFT', 'QUEUED', 'SENDING'].includes(c.state) && <button className="btn-sm btn-plain" onClick={() => { const why = prompt('취소 사유(2 ~ 200자)') ?? ''; if (why.trim().length >= 2) void a.run('cn', () => api(`/admin/marketing/campaigns/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: why }) }), reload); }} data-mkt-cancel="">취소</button>}
      </p>
      {aud && (
        <table className="tbl" data-mkt-aud={aud.willSend}><tbody>
          <tr><th>마케팅 동의</th><td>{n(aud.consented)}명</td><th>보낼 수</th><td><b>{n(aud.willSend)}</b>명</td></tr>
          <tr><th>2년 넘은 동의(뺌)</th><td>{n(aud.stale)}</td><th>받는 곳 없음(뺌)</th><td>{n(aud.noAddr)}</td></tr>
          <tr><th>반송 · 거부 주소(뺌)</th><td>{n(aud.suppressed)}</td><th>야간 동의</th><td>{n(aud.nightOk)}{aud.night ? ' · 지금 야간 — 이분들만 지금 받음' : ''}</td></tr>
          <tr><td colSpan={4} className="dim">{aud.note}</td></tr>
        </tbody></table>
      )}
      {pv && <pre className="card pad" data-mkt-preview="">{pv.subject ? `제목: ${pv.subject}\n\n` : ''}{pv.text}</pre>}
      {canSend && c.state === 'DRAFT' && (
        <p data-mkt-send="">
          <label>예약(비우면 바로) <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>{' '}
          <button className="btn-ok" disabled={!!a.busy} onClick={() => {
            const ok = prompt('받는 사람을 지금 동의자로 고정하고 보냅니다. 확인하려면 「보내기」를 넣으십시오.') ?? '';
            if (ok.trim() !== '보내기') return;
            void a.run('sd', () => api(`/admin/marketing/campaigns/${id}/send`, { method: 'POST', body: JSON.stringify({ confirm: '보내기', scheduledAt: at ? new Date(at).toISOString() : undefined }) }), reload);
          }} data-mkt-send-btn="">보내기</button>
        </p>
      )}
      <table className="tbl"><tbody><tr>{['total', 'queued', 'sent', 'assumed', 'skipped', 'failed', 'tests'].map((k) => <td key={k}><span className="dim">{({ total: '받는 사람', queued: '대기', sent: '보냄', assumed: '간주', skipped: '건너뜀', failed: '실패', tests: '시험' } as Record<string, string>)[k]}</span> {n(d.counts[k])}</td>)}
        <td><span className="dim">수신 거부</span> {n(d.unsubscribed)}</td></tr></tbody></table>
      {!!d.reasons.length && <p className="dim">건너뜀 · 실패 까닭: {d.reasons.map((r) => `${SKIP[r.reason] ?? r.reason} ${r.n}`).join(' · ')}</p>}
      <table className="tbl" data-mkt-recent={d.recent.length}><thead><tr><th>받는 곳</th><th>상태</th><th>까닭</th><th>보낸 때</th></tr></thead>
        <tbody>{d.recent.map((r) => <tr key={r.id}><td className="mono">{r.to}{r.test ? ' · 시험' : ''}</td><td>{r.state}{r.night ? ' · 야간' : ''}</td><td>{r.skipReason ? SKIP[r.skipReason] ?? r.skipReason : r.error ?? ''}</td><td>{ymdhm(r.sentAt)}</td></tr>)}</tbody></table>
    </div>
  );
}

function SettingsBox({ s, onDone }: { s: Settings; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState({ senderName: s.senderName, smsName: s.smsName, contact: s.contact, optoutPhone: s.optoutPhone, smsFrom: s.smsFrom, batch: String(s.batch), mode: s.mode, reason: '' });
  const save = (extra: Record<string, unknown> = {}) => void a.run('st', () => api('/admin/marketing/settings', { method: 'PUT', body: JSON.stringify({
    senderName: f.senderName, smsName: f.smsName, contact: f.contact, optoutPhone: f.optoutPhone, smsFrom: f.smsFrom, batch: Number(f.batch), mode: f.mode, reason: f.reason, ...extra }) }), onDone);
  return (
    <div className="card pad" data-mkt-settings="">
      <Flash msg={a.msg} err={a.err} />
      <b>캠페인 설정(최고 관리자)</b>
      <p>
        <label>보낸 곳 <input className="inp" value={f.senderName} onChange={(e) => setF({ ...f, senderName: e.target.value })} /></label>{' '}
        <label>문자 앞 이름 <input className="inp" value={f.smsName} onChange={(e) => setF({ ...f, smsName: e.target.value })} /></label>{' '}
        <label>연락처 <input className="inp" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="전화 또는 주소" /></label>
      </p>
      <p>
        <label>080 수신 거부 <input className="inp" value={f.optoutPhone} onChange={(e) => setF({ ...f, optoutPhone: e.target.value.replace(/\D/g, '') })} placeholder="080…" /></label>{' '}
        <label>문자 발신번호 <input className="inp" value={f.smsFrom} onChange={(e) => setF({ ...f, smsFrom: e.target.value.replace(/\D/g, '') })} placeholder="사전 등록 번호" /></label>{' '}
        <label>한 번에 <input className="inp" value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value.replace(/\D/g, '') })} /></label>{' '}
        <label>방식 <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="ASSUME">간주(보내지 않음)</option><option value="LIVE">실제로 보냄</option></select></label>
      </p>
      <p>
        <label>사유 <input className="inp" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="2 ~ 200자" /></label>{' '}
        <button className="btn-sm" disabled={!!a.busy} onClick={() => save()} data-mkt-settings-save="">저장</button>{' '}
        <button className="btn-sm" disabled={!!a.busy} onClick={() => { if (confirm(s.enabled ? '캠페인 보내기를 끕니다(보내는 중인 것도 멈춤).' : '캠페인 보내기를 켭니다.')) save({ enabled: !s.enabled, reason: f.reason || (s.enabled ? '캠페인 끔' : '캠페인 켬') }); }} data-mkt-enable="">{s.enabled ? '끄기' : '켜기'}</button>{' '}
        <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => void a.run('run', () => api('/admin/marketing/run', { method: 'POST' }), onDone, (r: unknown) => { const x = r as { on: boolean; sent: number; assumed: number; skipped: number; deferred: number }; return x.on ? `보냄 ${x.sent} · 간주 ${x.assumed} · 건너뜀 ${x.skipped} · 야간 미룸 ${x.deferred}` : '꺼져 있어 보내지 않았습니다.'; })} data-mkt-run="">지금 한 번 보내기</button>
      </p>
    </div>
  );
}

export function MktCampaigns() {
  const q = useApi<View>('/admin/marketing/campaigns');
  const a = useAct();
  const [f, setF] = useState({ ...EMPTY });
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const s = d.settings;
  return (
    <section data-mkt-campaigns="" data-mkt-on={s.enabled ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        <tr><th>보내기</th><td>{s.enabled ? '켜짐' : '꺼짐(처음) — 초안 · 시험 보내기만 됩니다'} · 방식 <b data-mkt-mode={s.mode}>{s.mode === 'LIVE' ? '실제로 보냄' : '간주(보내지 않음)'}</b></td></tr>
        <tr><th>준비</th><td>메일 {d.ready.mail ? '됨' : `안 됨(${d.ready.mailReason ?? ''})`} · 문자 {d.ready.sms ? '됨' : `안 됨(빠짐 ${d.ready.smsMissing.join(' · ')})`}</td></tr>
        <tr><th>광고 표기</th><td>보낸 곳 {s.senderName} · 연락처 {s.contact || <span className="warn-text">없음(보내기 막힘)</span>} · 080 {s.optoutPhone || <span className="warn-text">없음(문자 막힘)</span>}</td></tr>
        <tr><th>지금</th><td>{d.night ? <span className="warn-text">야간(21 ~ 8시) — 야간 동의한 분만 받습니다</span> : '주간'} · 동의 위반 감시 <b data-mkt-violations={d.violations}>{d.violations}</b>건(늘 0)</td></tr>
      </tbody></table>
      <div className="card pad" data-mkt-new="">
        <b>새 캠페인(초안)</b>
        <p>
          <input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="캠페인 이름" />{' '}
          <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="EMAIL">메일</option><option value="SMS">문자</option></select>{' '}
          <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{Object.entries(AUD).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        </p>
        {f.channel === 'EMAIL' && <p><input className="inp" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="메일 제목(앞에 「(광고)」가 붙음)" /></p>}
        <p><textarea value={f.body} rows={6} cols={70} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={f.channel === 'SMS' ? '문자 글(600자까지) — 「(광고)이름」 · 「무료거부 080…」은 서버가 붙임' : '메일 글 — 보낸 곳 · 연락처 · 수신 거부 링크는 서버가 끝에 붙임'} /></p>
        <p><button className="btn-ok" disabled={!!a.busy || f.title.trim().length < 2 || f.body.trim().length < 10} onClick={() => void a.run('new', () => api<{ ok: boolean; id: string }>('/admin/marketing/campaigns', { method: 'POST', body: JSON.stringify({ ...f, subject: f.channel === 'EMAIL' ? f.subject : undefined }) }).then((r) => { setSel(r.id); return r; }), () => { setF({ ...EMPTY }); q.reload(); })} data-mkt-create="">초안 만들기</button></p>
      </div>
      <table className="tbl" data-mkt-list={d.items.length}><thead><tr><th>이름</th><th>채널</th><th>상태</th><th>받는 사람</th><th>보냄 · 간주</th><th>건너뜀 · 실패</th><th>수신 거부</th><th>만든 때</th></tr></thead>
        <tbody>{d.items.map((r) => (
          <tr key={r.id} onClick={() => setSel(r.id)} className={sel === r.id ? 'on' : ''}><td>{r.title}</td><td>{CH[r.channel]}</td><td>{STATE[r.state] ?? r.state}{r.sendMode === 'ASSUME' ? ' · 간주' : ''}</td>
            <td>{n(r.total)}</td><td>{n(r.sent)} · {n(r.assumed)}</td><td>{n(r.skipped)} · {n(r.failed)}</td><td>{n(r.unsubscribed)}</td><td>{ymdhm(r.createdAt)}</td></tr>
        ))}</tbody></table>
      {sel && <DetailBox id={sel} canSend={d.canSend} onDone={q.reload} />}
      {d.canSend && <SettingsBox s={s} onDone={q.reload} />}
      <div className="ad-nt info">광고성 정보(정보통신망법 제50조) — 마케팅 수신 동의자에게만 · 21시 ~ 8시는 야간 동의자에게만 · 제목 · 글 앞 (광고) · 보낸 곳 · 연락처 · 무료 수신 거부는 서버가 붙입니다. 2년 넘은 동의는 재확인 전까지 뺍니다. 문구 · 운영 방식은 법무 확인 뒤 LIVE 로 바꿉니다.</div>
    </section>
  );
}
