import { useEffect, useState } from 'react';
import { ApiFailure, api, setToken } from '../lib/api';

/**
 * 운영자 2단계 인증 (v10.180 · D169 · docs/281 · SB-ADM-MFA-010)
 *
 *   MfaGate  — 설정(admin.mfa_required)상 필요한데 아직 확인 안 됨 → 로그인 뒤 이 화면만(번호 넣기 · 등록 안 했으면 등록)
 *   MfaSetup — 「내 2단계 인증」 화면에서 스스로 등록할 때도 같은 부품
 *   인증 앱 비밀값은 글자(앱의 「설정 키 입력」)와 otpauth 주소(휴대폰에서 누르면 앱이 열림)로 보여 줍니다 — 외부 QR 서비스는 쓰지 않음.
 */
export interface MfaStatus { mode: string; hours: number; required: boolean; enrolled: boolean; verified: boolean; backupLeft: number | null; lockedUntil: string | null }
type Tokens = { accessToken: string; refreshToken: string };

const msgOf = (e: unknown, f: string) => (e instanceof ApiFailure ? e.body.message : f);

export function MfaGate({ status, onDone }: { status: MfaStatus; onDone: () => void }) {
  return (
    <main className="bo-login" data-mfa-gate="">
      <section className="bo-login-card" aria-labelledby="mfa-title">
        <p className="bo-login-brand"><span className="d" aria-hidden />소개뱅크 <b>운영</b></p>
        <h1 id="mfa-title">2단계 인증</h1>
        {status.enrolled ? <MfaVerify onDone={onDone} /> : <MfaSetup onDone={onDone} />}
        <p className="bo-login-foot"><button type="button" className="btn-plain" onClick={() => setToken(null, null)} data-mfa-logout="">다른 계정으로 로그인</button></p>
      </section>
    </main>
  );
}

function MfaVerify({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await api<Tokens & { usedBackup: boolean; backupLeft: number }>('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setToken(r.accessToken, r.refreshToken);
      if (r.usedBackup) alert(`예비 번호를 썼습니다 — 남은 예비 번호 ${r.backupLeft}개. 휴대폰을 잃어버렸다면 최고 관리자에게 초기화를 요청하십시오.`);
      onDone();
    } catch (err) { setMsg(msgOf(err, '확인하지 못했습니다.')); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="bo-login-form" data-mfa-verify="">
      <p className="bo-login-sub">휴대폰 인증 앱의 6자리 번호를 넣으십시오. 휴대폰이 없으면 예비 번호(12345-67890)를 넣으십시오.</p>
      <label>번호<input name="mfa-code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={11}
        value={code} onChange={(e) => setCode(e.target.value)} /></label>
      {msg && <p role="alert" className="bo-login-err">{msg}</p>}
      <button type="submit" className="sgb-btn sgb-btn--pri bo-login-go" disabled={busy}>{busy ? '확인 중…' : '확인'}</button>
    </form>
  );
}

export function MfaSetup({ onDone }: { onDone: () => void }) {
  const [s, setS] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ secret: string; uri: string }>('/auth/mfa/setup', { method: 'POST' }).then(setS).catch((e) => setMsg(msgOf(e, '등록을 시작하지 못했습니다.')));
  }, []);
  async function enable(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await api<Tokens & { backupCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setToken(r.accessToken, r.refreshToken);
      setCodes(r.backupCodes);
    } catch (err) { setMsg(msgOf(err, '등록하지 못했습니다.')); } finally { setBusy(false); }
  }
  const download = () => {
    const blob = new Blob([`소개뱅크 운영 2단계 인증 예비 번호 (${new Date().toLocaleString('ko-KR')})\n한 번씩만 쓸 수 있습니다. 안전한 곳에 보관하십시오.\n\n${codes!.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sogaebank-admin-backup-codes.txt'; a.click(); URL.revokeObjectURL(a.href);
  };
  if (codes) return (
    <div data-mfa-backup="">
      <p className="bo-login-sub"><b>등록했습니다.</b> 아래 예비 번호 10개는 <b>지금 한 번만</b> 보입니다 — 내려받아 휴대폰이 아닌 곳에 보관하십시오. 휴대폰을 잃어버렸을 때 하나씩 쓸 수 있습니다.</p>
      <pre className="card pad" data-mfa-codes="">{codes.join('\n')}</pre>
      <p><button type="button" className="sgb-btn" onClick={download} data-mfa-download="">예비 번호 내려받기</button>{' '}
        <button type="button" className="sgb-btn sgb-btn--pri" onClick={onDone} data-mfa-continue="">보관했습니다 — 계속</button></p>
    </div>
  );
  return (
    <form onSubmit={enable} className="bo-login-form" data-mfa-setup="">
      <ol className="bo-login-sub">
        <li>휴대폰에 인증 앱(구글 OTP · Microsoft Authenticator 등)을 설치합니다.</li>
        <li>앱에서 「설정 키 입력」을 골라 아래 키를 넣습니다(종류: 시간 기준). 휴대폰으로 이 화면을 보고 있다면 「앱에서 열기」를 누릅니다.</li>
        <li>앱에 나온 6자리 번호를 넣습니다.</li>
      </ol>
      {s ? <p className="card pad" data-mfa-secret=""><code style={{ letterSpacing: '0.1em', wordBreak: 'break-all' }}>{s.secret.replace(/(.{4})/g, '$1 ').trim()}</code>{' '}
        <a href={s.uri} data-mfa-uri="">앱에서 열기</a></p> : !msg && <p className="muted">키를 만드는 중…</p>}
      <label>6자리 번호<input name="mfa-code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6}
        value={code} onChange={(e) => setCode(e.target.value)} /></label>
      {msg && <p role="alert" className="bo-login-err">{msg}</p>}
      <button type="submit" className="sgb-btn sgb-btn--pri bo-login-go" disabled={busy || !s}>{busy ? '확인 중…' : '등록'}</button>
    </form>
  );
}
