import { useState } from 'react';
import { ApiFailure, api, setToken, tokenRoles } from '../lib/api';
import { siteUrl } from '../lib/siteUrl';

/**
 * 운영 BO 로그인 (20260930 신설).
 *
 * 운영 역할(ADMIN · SUPER · REVIEWER · PAYOUT)이 없는 계정은 여기서 돌려보냅니다.
 * 서버도 모든 관리자 API 에서 역할을 다시 보므로 이것은 안내용입니다.
 * v10.112 — 모양: 가운데 카드(대표 2026-10-26 「가운데 카드」 · 안내는 「사용자 웹으로 가기」만) · 색 · 글자 · 모서리 · 그림자는 디자인 시트 값.
 */
const OPS = ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT'];

export function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ accessToken: string; refreshToken?: string }>('/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password: pw }),
      });
      setToken(r.accessToken, r.refreshToken ?? null);
      if (!tokenRoles().some((x) => OPS.includes(x))) {
        setToken(null, null);
        setMsg('운영 권한이 없는 계정입니다. 사용자 화면은 소개뱅크 웹에서 이용하십시오.');
      }
    } catch (err) {
      setMsg(err instanceof ApiFailure ? err.body.message : '로그인하지 못했습니다.');
    } finally { setBusy(false); }
  }

  return (
    <main className="bo-login" data-bo-login>
      <section className="bo-login-card" aria-labelledby="bo-login-title">
        <p className="bo-login-brand"><span className="d" aria-hidden />소개뱅크 <b>운영</b></p>
        <h1 id="bo-login-title">운영 화면 로그인</h1>
        <p className="bo-login-sub">운영 계정으로 로그인하십시오.</p>
        <form onSubmit={submit} className="bo-login-form">
          <label>이메일<input name="email" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>비밀번호<input name="password" type="password" autoComplete="current-password" required
            value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {msg && <p role="alert" className="bo-login-err">{msg}</p>}
          <button type="submit" className="sgb-btn sgb-btn--pri bo-login-go" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
        </form>
        <p className="bo-login-foot">허용된 곳에서만 열립니다 · <a href={siteUrl()} data-bo-login-site>사용자 웹으로 가기</a></p>
      </section>
    </main>
  );
}
