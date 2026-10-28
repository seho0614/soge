import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.142 (D138 · docs/215 · 설계 docs/213) — 외부 연동 › 「알림톡」 (SB-ADM-SIT-080 안의 한 구역 · 보기 ADMIN · 바꾸기 · 시험 SUPER)
 *
 *   ① 준비 — 방식(NONE · MOCK · HTTP) · 키 2개(위 「연동 키」 › 알림톡) · 발송 주소(.env ALIMTALK_URL) · 켜기(notify.alimtalk_ready)
 *   ② 템플릿 4개 — 대행사 · 카카오 심의에 등록할 글 · 대행사 템플릿 코드 · 심의 상태(승인된 것만 회원에게 보냄)
 *   ③ 시험 발송(SUPER · 하루 alimtalk.test_daily) · ④ 보낸 기록(받는 번호는 끝 4자리만)
 *   저장 — 방식 · 켜기는 PATCH /admin/site-settings(서버가 SUPER · 키 · 템플릿을 다시 검사) · 템플릿은 PUT /admin/alimtalk/templates/{code}
 */

interface KeyState { name: string; set: boolean; source: 'ADMIN' | 'ENV' | 'NONE' }
interface Tpl { code: string; name: string; body: string; vars: string[]; vendorCode: string | null; reviewState: string; updatedAt: string }
interface Status {
  provider: 'NONE' | 'MOCK' | 'HTTP'; setting: string; mockAllowed: boolean; url: { set: boolean }; keys: KeyState[]; missing: string[];
  configured: boolean; switchOn: boolean; templates: Tpl[]; test: { limit: number; used: number; left: number };
}
interface Sends { days: number; sent: number; failed: number; reasons: { reason: string; n: number }[]; recent: { at: string; purpose: string; template: string; toLast4: string | null; status: string; errorKind: string | null }[] }

const MODE: Record<string, string> = { NONE: '보내지 않음', MOCK: '시험(기록만 · 점검판)', HTTP: '대행사(HTTP)' };
const SRC: Record<string, string> = { ADMIN: '연동 키(이 화면)', ENV: '.env', NONE: '없음' };
const STATE: Record<string, string> = { NONE: '심의 전', REVIEW: '심의 중', APPROVED: '승인', REJECTED: '반려' };
const KIND: Record<string, string> = {
  NOT_READY: '방식 · 키가 준비되지 않음', BAD_PHONE: '휴대폰 번호 형식', TEMPLATE: '템플릿 코드 · 심의', NETWORK: '연결 실패', TIMEOUT: '시간 초과',
  AUTH: '키가 맞지 않음', REJECTED: '대행사가 거절', SERVER: '대행사 서버 오류',
};

export function AlimtalkPanel() {
  const isSuper = tokenRoles().includes('SUPER');
  const [st, setSt] = useState<Status | null>(null);
  const [dv, setDv] = useState<Sends | null>(null);
  const [days, setDays] = useState(7);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [to, setTo] = useState('');
  const [tpl, setTpl] = useState('NOTICE_GENERAL');

  const load = () => api<Status>('/admin/alimtalk/status').then(setSt).catch((e) => setErr(e?.message ?? '불러오지 못했습니다.'));
  useEffect(() => { void load(); }, []);
  useEffect(() => { api<Sends>(`/admin/alimtalk/sends?days=${days}`).then(setDv).catch(() => setDv(null)); }, [days]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setRes(null);
    try { await fn(); setRes({ ok: true, text: done }); void load(); }
    catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '바꾸지 못했습니다.' }); }
    finally { setBusy(false); }
  }
  const setting = (key: string, value: string, done: string) => run(() => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }), done);
  const saveTpl = (t: Tpl, reviewState: string) => run(() => api(`/admin/alimtalk/templates/${t.code}`, {
    method: 'PUT', body: JSON.stringify({ vendorCode: (edit[t.code] ?? t.vendorCode ?? '').trim() || null, reviewState }),
  }), `${t.name} — ${STATE[reviewState] ?? reviewState}로 저장했습니다.`);

  async function test() {
    if (!/^01[016789]\d{7,8}$/.test(to.replace(/\D/g, ''))) { setRes({ ok: false, text: '받을 휴대폰 번호를 넣으십시오.' }); return; }
    if (!window.confirm(`${to} 로 알림톡 시험 발송을 한 통 보낼까요? 회원 알림은 보내지 않습니다.`)) return;
    setBusy(true); setRes(null);
    try {
      const r = await api<{ ok: boolean; to: string; errorKind: string | null; error: string | null; left: number }>('/admin/alimtalk/test', { method: 'POST', body: JSON.stringify({ to, template: tpl }) });
      setRes(r.ok ? { ok: true, text: `보냄 — ${r.to}. 휴대폰에 왔는지 확인하십시오. 오늘 남은 시험 ${r.left}통.` }
        : { ok: false, text: `보내지 못함 — ${KIND[r.errorKind ?? ''] ?? ''} ${r.error ?? ''}. 오늘 남은 시험 ${r.left}통.` });
      void load();
    } catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(false); }
  }

  if (err) return <div data-alimtalk-panel><h2 className="ad-s2">알림톡</h2><p className="warn-text" role="alert">{err}</p></div>;
  if (!st) return null;
  const approved = st.templates.filter((t) => t.reviewState === 'APPROVED' && t.vendorCode).length;
  const row = (k: string, label: string, ok: boolean, now: string, fix: string) => (
    <tr key={k} data-alimtalk-row={k} data-ok={ok ? 'y' : 'n'}><td>{label}</td><td>{ok ? '✓' : '✗'}</td><td>{now}</td><td className="muted">{ok ? '' : fix}</td></tr>
  );
  return (
    <div data-alimtalk-panel>
      <h2 className="ad-s2">알림톡 <small className="dim">상담 인증번호 · 알림 문자(카카오 알림톡 대행사) — 순서는 docs/215</small></h2>
      <p className="hint" data-alimtalk-ready={st.switchOn && st.configured ? 'y' : 'n'}>
        {st.switchOn && st.configured ? '회원에게 알림톡이 나가고 있습니다(승인된 템플릿만).'
          : st.configured ? '방식 · 키는 갖춰졌습니다 — 템플릿 승인 · 시험 발송 뒤 「알림톡 켜기」를 누르십시오.' : '아직 알림톡을 보낼 수 없습니다 — ✗ 줄을 채우십시오. 대행사가 정해지기 전에는 그대로 두면 됩니다.'}
      </p>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th>채우는 곳</th></tr></thead>
        <tbody>
          {row('provider', '방식', st.provider !== 'NONE', MODE[st.provider] ?? st.provider, '아래 방식 단추(SUPER)')}
          {st.keys.map((k) => row(k.name, k.name === 'ALIMTALK_KEY' ? 'API 키' : '발신 프로필 키', k.set, SRC[k.source] ?? k.source, '위 「연동 키」 › 알림톡'))}
          {row('url', '발송 주소', st.url.set || st.provider !== 'HTTP', st.url.set ? '.env ALIMTALK_URL' : '없음', '운영 .env ALIMTALK_URL(대행사 안내서)')}
          {row('templates', '승인된 템플릿', approved > 0, `${approved} / ${st.templates.length}`, '아래 템플릿 표')}
          {row('switch', '알림톡 켜기', st.switchOn, st.switchOn ? '켜짐' : '꺼짐(회원에게 안 나감)', '시험 발송 확인 뒤 아래 「알림톡 켜기」')}
        </tbody>
      </table>
      {isSuper && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          {(['NONE', 'MOCK', 'HTTP'] as const).filter((m) => m !== 'MOCK' || st.mockAllowed).map((m) => (
            <button key={m} className={`btn-sm${st.provider === m ? ' on' : ''}`} aria-pressed={st.provider === m} disabled={busy || st.provider === m}
              onClick={() => void setting('alimtalk.provider', m, `알림톡 방식을 ${MODE[m]} 로 바꿨습니다.`)} data-alimtalk-set={m}>{MODE[m]}</button>
          ))}
          <button className="btn-sm" disabled={busy} data-alimtalk-switch={st.switchOn ? 'off' : 'on'}
            onClick={() => void setting('notify.alimtalk_ready', st.switchOn ? 'off' : 'on', st.switchOn ? '알림톡을 껐습니다.' : '알림톡을 켰습니다.')}>{st.switchOn ? '알림톡 끄기' : '알림톡 켜기'}</button>
        </div>
      )}
      {res && <p className={res.ok ? 'form-ok' : 'warn-text'} role="status" data-alimtalk-result={res.ok ? 'ok' : 'fail'}>{res.text}</p>}

      <h3 className="sec">템플릿 <small className="dim">대행사 · 카카오 심의에 아래 글 그대로 등록 — #{'{'}이름{'}'} 자리만 바뀜</small></h3>
      <table className="tbl" data-alimtalk-templates>
        <thead><tr><th>템플릿</th><th>글</th><th>대행사 코드</th><th>심의</th></tr></thead>
        <tbody>{st.templates.map((t) => (
          <tr key={t.code} data-alimtalk-tpl={t.code} data-state={t.reviewState}>
            <td>{t.name}<br /><small className="dim">{t.code}</small></td>
            <td><pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{t.body}</pre></td>
            <td>{isSuper ? <input value={edit[t.code] ?? t.vendorCode ?? ''} onChange={(e) => setEdit({ ...edit, [t.code]: e.target.value })} size={14} aria-label={`${t.name} 대행사 코드`} data-alimtalk-vendor={t.code} /> : (t.vendorCode ?? '-')}</td>
            <td>{STATE[t.reviewState] ?? t.reviewState}{isSuper && (
              <div className="row-actions">{(['REVIEW', 'APPROVED', 'REJECTED'] as const).map((s) => (
                <button key={s} className="btn-sm" disabled={busy} onClick={() => void saveTpl(t, s)} data-alimtalk-tpl-set={`${t.code}:${s}`}>{STATE[s]}</button>
              ))}</div>
            )}</td>
          </tr>
        ))}</tbody>
      </table>

      {isSuper && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="시험 받을 휴대폰 번호" size={16} aria-label="시험 받을 휴대폰 번호" data-alimtalk-to />
          <select value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="시험 템플릿">{st.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
          <button className="btn-sm" disabled={busy || !st.configured || st.test.left <= 0} onClick={() => void test()} data-alimtalk-test>시험 발송</button>
          <span className="muted">오늘 남은 시험 {st.test.left} / {st.test.limit}통</span>
        </div>
      )}

      {dv && (
        <div data-alimtalk-sends style={{ marginTop: 12 }}>
          <h3 className="sec">보낸 기록{' '}
            {[1, 7, 30].map((d) => <button key={d} className={`btn-sm${d === days ? ' on' : ''}`} onClick={() => setDays(d)} aria-pressed={d === days}>{d}일</button>)}</h3>
          <p>보냄 <b data-alimtalk-stat="sent">{dv.sent}</b> · 실패 <b data-alimtalk-stat="failed">{dv.failed}</b>
            {dv.reasons.length > 0 && <> — 실패 까닭 {dv.reasons.map((r) => `${KIND[r.reason] ?? r.reason} ${r.n}`).join(' · ')}</>}</p>
          {dv.recent.length > 0 && (
            <table className="tbl"><thead><tr><th>시각</th><th>목적</th><th>템플릿</th><th>받는 번호</th><th>결과</th></tr></thead>
              <tbody>{dv.recent.map((r, i) => <tr key={i} data-alimtalk-send={r.status}><td>{ymdKst(r.at)}</td><td>{r.purpose}</td><td>{r.template}</td><td>{r.toLast4 ? `***${r.toLast4}` : '-'}</td><td>{r.status === 'SENT' ? '보냄' : `실패 · ${KIND[r.errorKind ?? ''] ?? r.errorKind ?? ''}`}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
