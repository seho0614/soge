import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';

/**
 * v10.141 (D137 · docs/214 · 설계 docs/213) — 외부 연동 › 「본인인증」 (SB-ADM-SIT-080 안의 한 구역 · 보기 ADMIN · 방식 바꾸기 SUPER)
 *
 *   방식 — STUB(지금처럼 바로 통과 · 시험용 표시) · MOCK(점검판 가짜 표준창 · 운영 서버에서는 못 고름) · NICE(실제 표준창 · 키 3개 필요)
 *   키 3개 — 위 「연동 키」 › 본인인증에서 넣음(값은 보이지 않음 · 어디서 왔는지만)
 *   최근 30일 — 성공 · 실패(까닭별) · 시험용 통과 · 다른 계정에서도 인증한 사람
 *   저장은 PATCH /admin/site-settings(identity.provider · identity.ci_duplicate) — 서버가 SUPER · 키 · MOCK 을 다시 검사.
 *   v10.153 (D146 · docs/233) — 「NICE 키 확인」(POST /admin/identity/nice-check · 토큰만 · 비용 없음) · 「NICE 바꾸기 전 키 확인」(identity.require_check)
 *     켜져 있으면 최근 7일 안 키 확인 성공이 있어야 NICE 로 바꿈(서버 IDENTITY_CHECK_FIRST) — 틀린 키로 바꾸면 모든 가입이 막힘(리허설 docs/228 발견 5)
 */

interface KeyState { name: string; set: boolean; source: 'ADMIN' | 'ENV' | 'NONE' }
interface Status {
  provider: 'STUB' | 'MOCK' | 'NICE'; setting: string; mockAllowed: boolean; keys: KeyState[]; keysMissing: string[];
  ciDuplicate: 'warn' | 'block'; minAge: number;
  last30: { success: number; fail: number; stub: number; pending: number; duplicate: number; reasons: { reason: string; n: number }[] };
  requireCheck: boolean; lastCheckOkAt: string | null; lastCheck: { ok: boolean; errorKind: string | null; detail: string | null; at: string } | null;
}

const MODE: Record<string, string> = { STUB: '시험용(바로 통과)', MOCK: '가짜 표준창(점검판)', NICE: 'NICE 표준창' };
const SRC: Record<string, string> = { ADMIN: '연동 키(이 화면)', ENV: '.env', NONE: '없음' };
const REASON: Record<string, string> = {
  EXPIRED: '10분 지남', INTEGRITY: '결과 확인 실패', REQ_MISMATCH: '요청 번호 다름', NO_CI: 'CI 없음', UNDER_AGE: '나이 미달',
  CI_DUPLICATE: '다른 계정에서 인증한 사람(막음)', UNAVAILABLE: 'NICE 연결 실패',
};

export function IdentityPanel() {
  const isSuper = tokenRoles().includes('SUPER');
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<Status>('/admin/identity/status').then(setSt).catch((e) => setErr(e?.message ?? '불러오지 못했습니다.'));
  useEffect(() => { void load(); }, []);

  async function save(key: string, value: string, done: string) {
    if (key === 'identity.provider' && value === 'NICE' && !window.confirm('본인인증을 NICE 표준창으로 바꿀까요? 회원은 실제 휴대폰 확인을 해야 인증됩니다.')) return;
    setBusy(true); setRes(null);
    try {
      await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key, value }) });
      setRes({ ok: true, text: done }); void load();
    } catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '바꾸지 못했습니다.' }); }
    finally { setBusy(false); }
  }

  async function niceCheck() {
    setBusy(true); setRes(null);
    try {
      const r = await api<{ ok: boolean; detail: string }>('/admin/identity/nice-check', { method: 'POST', body: '{}' });
      setRes({ ok: r.ok, text: r.detail }); void load();
    } catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '확인하지 못했습니다.' }); }
    finally { setBusy(false); }
  }

  if (err) return <div data-identity-panel><h2 className="ad-s2">본인인증</h2><p className="warn-text" role="alert">{err}</p></div>;
  if (!st) return null;
  const l = st.last30;
  const needCheck = st.requireCheck && !st.lastCheckOkAt;
  return (
    <div data-identity-panel>
      <h2 className="ad-s2">본인인증 <small className="dim">휴대폰 본인확인(NICE 표준창) — 순서는 docs/214</small></h2>
      <p className="hint" data-identity-mode={st.provider}>
        지금 방식: <b>{MODE[st.provider] ?? st.provider}</b>
        {st.provider === 'STUB' && ' — 실제 확인 없이 통과합니다(회원 화면에 「실제 확인이 이루어지지 않았습니다」). NICE 계약 · 키 뒤에 바꾸십시오.'}
        {st.setting !== st.provider && ` (설정 값 ${st.setting} — 운영 서버라 ${st.provider} 로 읽음)`}
      </p>
      <table className="tbl">
        <thead><tr><th>키</th><th></th><th>지금</th></tr></thead>
        <tbody>{st.keys.map((k) => (
          <tr key={k.name} data-identity-key={k.name} data-ok={k.set ? 'y' : 'n'}><td>{k.name}</td><td>{k.set ? '✓' : '✗'}</td><td>{SRC[k.source] ?? k.source}{k.set ? '' : ' — 위 「연동 키」 › 본인인증'}</td></tr>
        ))}</tbody>
      </table>
      {isSuper && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          {(['STUB', 'MOCK', 'NICE'] as const).filter((m) => m !== 'MOCK' || st.mockAllowed).map((m) => (
            <button key={m} className={`btn-sm${st.provider === m ? ' on' : ''}`} aria-pressed={st.provider === m} disabled={busy || st.provider === m || (m === 'NICE' && (st.keysMissing.length > 0 || needCheck))}
              title={m === 'NICE' && st.keysMissing.length ? `키가 없습니다: ${st.keysMissing.join(' · ')}` : m === 'NICE' && needCheck ? '「NICE 키 확인」이 최근 7일 안에 성공해야 합니다' : ''}
              onClick={() => void save('identity.provider', m, `본인인증 방식을 ${MODE[m]} 로 바꿨습니다.`)} data-identity-set={m}>{MODE[m]}</button>
          ))}
          <span className="muted">같은 사람 다른 계정:</span>
          {(['warn', 'block'] as const).map((v) => (
            <button key={v} className={`btn-sm${st.ciDuplicate === v ? ' on' : ''}`} aria-pressed={st.ciDuplicate === v} disabled={busy || st.ciDuplicate === v}
              onClick={() => void save('identity.ci_duplicate', v, v === 'warn' ? '같은 사람의 다른 계정 인증을 표시만 합니다.' : '같은 사람의 다른 계정 인증을 막습니다.')} data-identity-dup={v}>{v === 'warn' ? '표시만' : '막음'}</button>
          ))}
        </div>
      )}
      <p className="hint" data-identity-check={st.lastCheckOkAt ? 'ok' : 'none'} style={{ marginTop: 10 }}>
        NICE 키 확인(토큰만 받아 봄 · 표준창 · 비용 없음): {st.lastCheckOkAt ? <b>최근 7일 안 성공 — {new Date(st.lastCheckOkAt).toLocaleString('ko-KR')}</b> : <b>최근 7일 안 성공 없음</b>}
        {st.lastCheck && !st.lastCheck.ok && <> · 마지막 확인 실패({st.lastCheck.errorKind}) — {st.lastCheck.detail}</>}
        {isSuper && <>{' '}<button className="btn-sm" disabled={busy} onClick={() => void niceCheck()} data-identity-nice-check>NICE 키 확인</button></>}
      </p>
      <p className="hint" data-identity-require-check={st.requireCheck ? 'on' : 'off'}>
        NICE 바꾸기 전 키 확인: <b>{st.requireCheck ? '켜짐 — 키 확인이 성공해야 NICE 로 바꿈' : '꺼짐 — 키 3개만 보고 바꿈(틀린 키면 가입이 막힐 수 있음)'}</b>
        {isSuper && <>{' '}<button className="btn-sm" disabled={busy}
          onClick={() => { if (!st.requireCheck || window.confirm('「NICE 바꾸기 전 키 확인」을 끌까요? 키가 틀려도 NICE 로 바꿀 수 있게 되어, 틀리면 모든 가입 · 본인인증이 막힙니다.')) void save('identity.require_check', st.requireCheck ? 'off' : 'on', st.requireCheck ? 'NICE 바꾸기 전 키 확인을 껐습니다.' : 'NICE 바꾸기 전 키 확인을 켰습니다.'); }}
          data-identity-require-flip>{st.requireCheck ? '끄기' : '켜기'}</button></>}
      </p>
      {res && <p className={res.ok ? 'form-ok' : 'warn-text'} role="status" data-identity-result={res.ok ? 'ok' : 'fail'}>{res.text}</p>}
      <p data-identity-stats>
        최근 30일 — 성공 <b data-identity-stat="success">{l.success}</b> · 실패 <b data-identity-stat="fail">{l.fail}</b> · 시험용 통과 <b data-identity-stat="stub">{l.stub}</b>
        {' '}· 진행 중 <b>{l.pending}</b> · 다른 계정에서도 인증 <b data-identity-stat="duplicate">{l.duplicate}</b> · 나이 하한 만 {st.minAge}세
        {l.reasons.length > 0 && <> — 실패 까닭 {l.reasons.map((r) => `${REASON[r.reason] ?? r.reason} ${r.n}`).join(' · ')}</>}
      </p>
    </div>
  );
}
