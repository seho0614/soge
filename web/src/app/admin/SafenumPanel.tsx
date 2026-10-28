import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.145 (D141 · docs/221 · 설계 docs/218) — 외부 연동 › 「안심번호」 (SB-ADM-SIT-080 안의 한 구역 · 보기 ADMIN · 바꾸기 SUPER)
 *
 *   ① 준비 — 방식(NONE · MOCK · HTTP) · 키 2개(위 「연동 키」 › 050 안심번호 — API 키 · 웹훅 비밀값) · 업체 주소(.env SAFENUM_URL) · 웹훅 주소
 *   ② 최근 30일 — 번호 발급 · 지금 쓰는 번호 · 통화 · 소개 기록(CALL) · 웹훅(서명 틀림 · 중복 · 모르는 번호)
 *   ③ 통화 기록(1 · 7 · 30일) — 전화번호는 내지 않음(050 끝 4자리)
 */

interface KeyState { name: string; set: boolean; source: 'ADMIN' | 'ENV' | 'NONE' }
interface Status {
  provider: 'NONE' | 'MOCK' | 'HTTP'; setting: string; mockAllowed: boolean; url: { set: boolean }; keys: KeyState[]; missing: string[];
  configured: boolean; webhookUrl: string; hours: number; daily: number;
  last30: { issued: number; active: number; withCode: number; calls: number; seconds: number; attributed: number };
  webhook: { received: number; badSignature: number; duplicate: number; unknown: number };
}
interface Calls { days: number; rows: { id: string; at: string; durationSec: number | null; numberLast4: string; listingTitle: string; attributed: boolean; provider: string | null }[] }

const MODE: Record<string, string> = { NONE: '준비 중 안내(지금)', MOCK: '시험(가짜 번호 · 점검판)', HTTP: '업체(HTTP)' };
const SRC: Record<string, string> = { ADMIN: '연동 키(이 화면)', ENV: '.env', NONE: '없음' };

export function SafenumPanel() {
  const isSuper = tokenRoles().includes('SUPER');
  const [st, setSt] = useState<Status | null>(null);
  const [cv, setCv] = useState<Calls | null>(null);
  const [days, setDays] = useState(7);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<Status>('/admin/safenum/status').then(setSt).catch((e) => setErr(e?.message ?? '불러오지 못했습니다.'));
  useEffect(() => { void load(); }, []);
  useEffect(() => { api<Calls>(`/admin/safenum/calls?days=${days}`).then(setCv).catch(() => setCv(null)); }, [days]);

  async function setMode(m: string) {
    if (!window.confirm(`안심번호 방식을 「${MODE[m]}」로 바꿀까요? ${m === 'NONE' ? '매물 상세 「전화하기」가 「준비 중」 안내로 돌아갑니다.' : '로그인 회원이 「전화하기」로 050 번호를 받습니다(업체 요금).'}`)) return;
    setBusy(true); setRes(null);
    try { await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'safenum.provider', value: m }) }); setRes({ ok: true, text: `안심번호 방식을 ${MODE[m]} 로 바꿨습니다.` }); void load(); }
    catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '바꾸지 못했습니다.' }); }
    finally { setBusy(false); }
  }

  if (err) return <div data-safenum-panel><h2 className="ad-s2">안심번호</h2><p className="warn-text" role="alert">{err}</p></div>;
  if (!st) return null;
  const row = (k: string, label: string, ok: boolean, now: string, fix: string) => (
    <tr key={k} data-safenum-row={k} data-ok={ok ? 'y' : 'n'}><td>{label}</td><td>{ok ? '✓' : '✗'}</td><td>{now}</td><td className="muted">{ok ? '' : fix}</td></tr>
  );
  const l = st.last30;
  return (
    <div data-safenum-panel>
      <h2 className="ad-s2">안심번호 <small className="dim">매물 상세 「전화하기」 050 번호 · 통화를 소개 기록으로(CALL) — 순서는 docs/221</small></h2>
      <p className="hint">{st.provider === 'NONE' ? '지금은 「전화하기」를 누르면 「준비 중」 안내가 나옵니다. 업체가 정해지면 키 · 주소를 넣고 방식을 「업체(HTTP)」로 바꾸십시오.'
        : st.configured ? `로그인 회원이 「전화하기」로 050 번호를 받습니다(${st.hours}시간 · 하루 ${st.daily}번).` : '방식은 바뀌었지만 설정이 빠졌습니다 — ✗ 줄을 채우십시오.'}</p>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th>채우는 곳</th></tr></thead>
        <tbody>
          {row('provider', '방식', st.provider !== 'NONE', MODE[st.provider] ?? st.provider, '아래 방식 단추(SUPER) — 업체 계약 뒤')}
          {st.keys.map((k) => row(k.name, k.name === 'SAFENUM_KEY' ? 'API 키' : '웹훅 비밀값', k.set, SRC[k.source] ?? k.source, '위 「연동 키」 › 050 안심번호'))}
          {row('url', '업체 주소', st.url.set || st.provider !== 'HTTP', st.url.set ? '.env SAFENUM_URL' : '없음', '운영 .env SAFENUM_URL(업체 개발 문서)')}
        </tbody>
      </table>
      <p className="muted" data-safenum-webhook-url>업체에 등록할 통화 알림(웹훅) 주소: <code>{st.webhookUrl}</code></p>
      {isSuper && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          {(['NONE', 'MOCK', 'HTTP'] as const).filter((m) => m !== 'MOCK' || st.mockAllowed).map((m) => (
            <button key={m} className={`btn-sm${st.provider === m ? ' on' : ''}`} aria-pressed={st.provider === m} disabled={busy || st.provider === m}
              onClick={() => void setMode(m)} data-safenum-set={m}>{MODE[m]}</button>
          ))}
        </div>
      )}
      {res && <p className={res.ok ? 'form-ok' : 'warn-text'} role="status" data-safenum-result={res.ok ? 'ok' : 'fail'}>{res.text}</p>}
      <h3 className="sec">최근 30일</h3>
      <p data-safenum-stats>번호 발급 <b data-safenum-stat="issued">{l.issued}</b> · 지금 쓰는 번호 <b>{l.active}</b> · 통화 <b data-safenum-stat="calls">{l.calls}</b>({Math.round(l.seconds / 60)}분) · 소개 기록 <b data-safenum-stat="attributed">{l.attributed}</b></p>
      <p>웹훅 받음 <b>{st.webhook.received}</b> · 서명 틀림 <b data-safenum-stat="bad">{st.webhook.badSignature}</b> · 중복 <b>{st.webhook.duplicate}</b> · 모르는 번호 <b>{st.webhook.unknown}</b></p>
      {cv && (
        <div data-safenum-calls style={{ marginTop: 12 }}>
          <h3 className="sec">통화 기록{' '}
            {[1, 7, 30].map((d) => <button key={d} className={`btn-sm${d === days ? ' on' : ''}`} onClick={() => setDays(d)} aria-pressed={d === days}>{d}일</button>)}</h3>
          {cv.rows.length === 0 ? <p className="muted">통화가 없습니다.</p> : (
            <table className="tbl"><thead><tr><th>시각</th><th>매물</th><th>번호</th><th>통화</th><th>소개 기록</th></tr></thead>
              <tbody>{cv.rows.map((r) => <tr key={r.id} data-safenum-call-row="">
                <td>{ymdKst(r.at)}</td><td>{r.listingTitle}</td><td>***{r.numberLast4}</td><td>{r.durationSec != null ? `${r.durationSec}초` : '-'}</td><td>{r.attributed ? '✓' : '·'}</td>
              </tr>)}</tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
