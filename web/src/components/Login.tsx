import { useState } from 'react';
import { ApiFailure, api, setToken, tokenRoles } from '../lib/api';

/**
 * 운영 BO 로그인 (20260930 신설).
 *
 * 운영 역할(ADMIN · SUPER · REVIEWER · PAYOUT)이 없는 계정은 여기서 돌려보냅니다.
 * 서버도 모든 관리자 API 에서 역할을 다시 보므로 이것은 안내용입니다.
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
    <div className="bo-login" style={{ maxWidth: 360, margin: '12vh auto', padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}>
      <h1 style={{ margin: 0 }}>소개뱅크 운영</h1>
      <p style={{ margin: 0, opacity: 0.75 }}>운영 계정으로 로그인하십시오.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        <label>이메일<input name="email" type="email" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} /></label>
        <label>비밀번호<input name="password" type="password" autoComplete="current-password" required
          value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: '100%' }} /></label>
        <button type="submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
      </form>
      {msg && <p role="alert" style={{ color: 'var(--c-danger, #c0392b)', margin: 0 }}>{msg}</p>}
    </div>
  );
}
