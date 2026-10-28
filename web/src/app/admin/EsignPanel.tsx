import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.143 (D139 · docs/217 · 설계 docs/216) — 외부 연동 › 「전자계약」 (SB-ADM-SIT-080 안의 한 구역 · 보기 ADMIN · 바꾸기 SUPER)
 *
 *   ① 준비 — 방식(STUB · MOCK · HTTP) · 키 2개(위 「연동 키」 › 전자계약 — API 키 · 웹훅 비밀값) · 업체 주소(.env ESIGN_URL) · 업체에 등록할 웹훅 주소
 *   ② 최근 30일 — 요청 · 체결 · 대기 · 닫힘(거절 · 만료 · 취소) · 실패와 까닭 · 웹훅 받은 수(서명 틀림 · 중복)
 *   ③ 요청 목록(1 · 7 · 30 · 90일) — 연락처 · 서명 주소는 내지 않음
 *   저장 — 방식은 PATCH /admin/site-settings(서버가 SUPER · 키 · 대기 중 요청을 다시 검사)
 */

interface KeyState { name: string; set: boolean; source: 'ADMIN' | 'ENV' | 'NONE' }
interface Status {
  provider: 'STUB' | 'MOCK' | 'HTTP'; setting: string; mockAllowed: boolean; url: { set: boolean }; keys: KeyState[]; missing: string[];
  configured: boolean; webhookUrl: string;
  last30: { requested: number; signed: number; pending: number; closed: number; failed: number; reasons: { reason: string; n: number }[] };
  webhook: { received: number; badSignature: number; duplicate: number; lastAt: string | null };
}
interface Docs { days: number; rows: { id: string; dealId: string; provider: string; docId: string | null; state: string; hash: string; buyerSigned: boolean; sellerSigned: boolean; errorKind: string | null; createdAt: string; completedAt: string | null; expiresAt: string }[] }

const MODE: Record<string, string> = { STUB: '화면 안 서명(지금)', MOCK: '시험(가짜 서명 · 점검판)', HTTP: '업체(HTTP)' };
const SRC: Record<string, string> = { ADMIN: '연동 키(이 화면)', ENV: '.env', NONE: '없음' };
const STATE: Record<string, string> = { PENDING: '서명 대기', SIGNED: '체결', REJECTED: '거절', EXPIRED: '만료', CANCELLED: '취소', FAILED: '실패' };
const KIND: Record<string, string> = {
  HASH_MISMATCH: '계약서 지문 다름', CANCEL_FAILED: '업체 취소 실패', NOT_CONFIGURED: '설정 없음', TIMEOUT: '시간 초과', NETWORK: '연결 실패',
  AUTH: '키가 맞지 않음', HTTP_4XX: '업체가 거절', UPSTREAM: '업체 서버 오류', BAD_RESPONSE: '모르는 응답', REJECTED: '거절', EXPIRED: '만료', CANCELLED: '취소',
};

export function EsignPanel() {
  const isSuper = tokenRoles().includes('SUPER');
  const [st, setSt] = useState<Status | null>(null);
  const [dv, setDv] = useState<Docs | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<Status>('/admin/esign/status').then(setSt).catch((e) => setErr(e?.message ?? '불러오지 못했습니다.'));
  useEffect(() => { void load(); }, []);
  useEffect(() => { api<Docs>(`/admin/esign/documents?days=${days}`).then(setDv).catch(() => setDv(null)); }, [days]);

  async function setMode(m: string) {
    if (!window.confirm(`전자계약 방식을 「${MODE[m]}」로 바꿀까요? ${m === 'STUB' ? '회원 화면이 화면 안 「서명」 단추로 돌아갑니다.' : '회원 화면의 「서명」 단추가 「전자서명 요청」으로 바뀝니다.'}`)) return;
    setBusy(true); setRes(null);
    try { await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'esign.provider', value: m }) }); setRes({ ok: true, text: `전자계약 방식을 ${MODE[m]} 로 바꿨습니다.` }); void load(); }
    catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '바꾸지 못했습니다.' }); }
    finally { setBusy(false); }
  }

  if (err) return <div data-esign-panel><h2 className="ad-s2">전자계약</h2><p className="warn-text" role="alert">{err}</p></div>;
  if (!st) return null;
  const row = (k: string, label: string, ok: boolean, now: string, fix: string) => (
    <tr key={k} data-esign-row={k} data-ok={ok ? 'y' : 'n'}><td>{label}</td><td>{ok ? '✓' : '✗'}</td><td>{now}</td><td className="muted">{ok ? '' : fix}</td></tr>
  );
  const l = st.last30;
  return (
    <div data-esign-panel>
      <h2 className="ad-s2">전자계약 <small className="dim">거래 계약서 전자서명(업체가 서명 시각 · 서명자 증명) — 순서는 docs/217</small></h2>
      <p className="hint" data-esign-ready={st.provider !== 'STUB' && st.configured ? 'y' : 'n'}>
        {st.provider === 'STUB' ? '지금은 화면 안 「서명」 단추로 체결합니다. 업체가 정해지면 키 · 주소를 넣고 방식을 「업체(HTTP)」로 바꾸십시오.'
          : st.configured ? '회원 계약은 전자서명으로 체결됩니다.' : '방식은 바뀌었지만 설정이 빠졌습니다 — ✗ 줄을 채우십시오.'}
      </p>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th>채우는 곳</th></tr></thead>
        <tbody>
          {row('provider', '방식', st.provider !== 'STUB', MODE[st.provider] ?? st.provider, '아래 방식 단추(SUPER) — 업체 계약 뒤')}
          {st.keys.map((k) => row(k.name, k.name === 'ESIGN_API_KEY' ? 'API 키' : '웹훅 비밀값', k.set, SRC[k.source] ?? k.source, '위 「연동 키」 › 전자계약'))}
          {row('url', '업체 주소', st.url.set || st.provider !== 'HTTP', st.url.set ? '.env ESIGN_URL' : '없음', '운영 .env ESIGN_URL(업체 개발 문서)')}
        </tbody>
      </table>
      <p className="muted" data-esign-webhook-url>업체에 등록할 완료 알림(웹훅) 주소: <code>{st.webhookUrl}</code></p>
      {isSuper && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          {(['STUB', 'MOCK', 'HTTP'] as const).filter((m) => m !== 'MOCK' || st.mockAllowed).map((m) => (
            <button key={m} className={`btn-sm${st.provider === m ? ' on' : ''}`} aria-pressed={st.provider === m} disabled={busy || st.provider === m}
              onClick={() => void setMode(m)} data-esign-set={m}>{MODE[m]}</button>
          ))}
        </div>
      )}
      {res && <p className={res.ok ? 'form-ok' : 'warn-text'} role="status" data-esign-result={res.ok ? 'ok' : 'fail'}>{res.text}</p>}

      <h3 className="sec">최근 30일</h3>
      <p data-esign-stats>요청 <b data-esign-stat="requested">{l.requested}</b> · 체결 <b data-esign-stat="signed">{l.signed}</b> · 대기 <b>{l.pending}</b> · 닫힘 <b>{l.closed}</b> · 실패 <b data-esign-stat="failed">{l.failed}</b>
        {l.reasons.length > 0 && <> — {l.reasons.map((r) => `${KIND[r.reason] ?? r.reason} ${r.n}`).join(' · ')}</>}</p>
      <p data-esign-hooks>웹훅 받음 <b>{st.webhook.received}</b> · 서명 틀림 <b data-esign-stat="bad">{st.webhook.badSignature}</b> · 중복 <b>{st.webhook.duplicate}</b>
        {st.webhook.lastAt && <> · 마지막 {ymdKst(st.webhook.lastAt)}</>}</p>

      {dv && (
        <div data-esign-docs style={{ marginTop: 12 }}>
          <h3 className="sec">요청 목록{' '}
            {[1, 7, 30, 90].map((d) => <button key={d} className={`btn-sm${d === days ? ' on' : ''}`} onClick={() => setDays(d)} aria-pressed={d === days}>{d}일</button>)}</h3>
          {dv.rows.length === 0 ? <p className="muted">요청이 없습니다.</p> : (
            <table className="tbl"><thead><tr><th>요청</th><th>방식</th><th>상태</th><th>서명(매수 · 매도)</th><th>지문</th><th>끝남</th></tr></thead>
              <tbody>{dv.rows.map((r) => <tr key={r.id} data-esign-doc={r.state}>
                <td>{ymdKst(r.createdAt)}</td><td>{r.provider}</td>
                <td>{STATE[r.state] ?? r.state}{r.errorKind ? ` · ${KIND[r.errorKind] ?? r.errorKind}` : ''}</td>
                <td>{r.buyerSigned ? '✓' : '·'} {r.sellerSigned ? '✓' : '·'}</td><td><code>{r.hash}</code></td><td>{r.completedAt ? ymdKst(r.completedAt) : `기한 ${ymdKst(r.expiresAt)}`}</td>
              </tr>)}</tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
