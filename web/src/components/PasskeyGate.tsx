import { useState } from 'react';
import { ApiFailure, setToken } from '../lib/api';
import { passkeySupported, verifyPasskey } from '../lib/passkey';

/**
 * 운영자 패스키 확인 (v10.484 · D268 · docs/622 · SB-ADM-SCU-020)
 *
 *   mode EXTRA       비밀번호 · 2단계 인증 뒤 한 번 더 — 패스키를 등록한 운영자만(서버 403 PASSKEY_REQUIRED)
 *   mode REPLACE_MFA 2단계 인증 화면 대신 — 「인증 앱 번호로」를 누르면 원래 번호 넣기 화면(onSkip)
 */
const msgOf = (e: unknown, f: string) => (e instanceof ApiFailure ? e.body.message : e instanceof Error ? e.message : f);

export function PasskeyGate({ mode, onDone, onSkip }: { mode: 'EXTRA' | 'REPLACE_MFA'; onDone: () => void; onSkip?: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const r = await verifyPasskey();
      if (r.accessToken && r.refreshToken) setToken(r.accessToken, r.refreshToken);
      onDone();
    } catch (err) { setMsg(msgOf(err, '확인하지 못했습니다.')); } finally { setBusy(false); }
  }
  return (
    <main className="bo-login" data-passkey-gate={mode}>
      <section className="bo-login-card" aria-labelledby="pk-title">
        <p className="bo-login-brand"><span className="d" aria-hidden />소개뱅크 <b>운영</b></p>
        <h1 id="pk-title">패스키로 확인</h1>
        <p className="bo-login-sub">{mode === 'EXTRA'
          ? '등록한 패스키(지문 · 얼굴 · 보안 키)로 한 번 더 확인해야 운영 화면을 씁니다.'
          : '인증 앱 번호 대신 등록한 패스키(지문 · 얼굴 · 보안 키)로 2단계 확인을 할 수 있습니다.'}</p>
        {!passkeySupported() && <p role="alert" className="bo-login-err">이 브라우저는 패스키를 지원하지 않습니다.</p>}
        {msg && <p role="alert" className="bo-login-err">{msg}</p>}
        <button type="button" className="sgb-btn sgb-btn--pri bo-login-go" disabled={busy || !passkeySupported()} onClick={() => void go()} data-passkey-go="">{busy ? '확인 중…' : '패스키로 확인'}</button>
        <p className="bo-login-foot">
          {onSkip && <><button type="button" className="btn-plain" onClick={onSkip} data-passkey-skip="">인증 앱 번호로</button>{' · '}</>}
          <button type="button" className="btn-plain" onClick={() => setToken(null, null)} data-passkey-logout="">다른 계정으로 로그인</button>
        </p>
      </section>
    </main>
  );
}
