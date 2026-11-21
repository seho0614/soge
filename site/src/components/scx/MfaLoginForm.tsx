'use client';
/**
 * SB-HOM-SCX-010 회원 2단계 로그인 폼 (v10.592 · docs/734) — 번호 → 서버 액션 memberMfaLogin(표는 HttpOnly 쿠키)
 *   글자는 서버 화면이 사전(scx)에서 골라 넘김(이 부품에는 한글 없음)
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { memberMfaLogin } from '@/lib/scxAuth';

export function MfaLoginForm({ next, labels }: { next: string; labels: { code: string; submit: string; working: string; need: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    if (!/^(\d{6}|\d{5}-?\d{5})$/.test(code)) { setErr(labels.need); return; }
    setErr(null);
    start(async () => {
      const r = await memberMfaLogin(code);
      if (r.ok) { router.push(next); router.refresh(); return; }
      setErr(r.message);
    });
  }

  return (
    <form className="auth w1-lgf" onSubmit={submit} noValidate data-mfa-login="">
      <div className="w1-fld"><label htmlFor="mfa-code">{labels.code}</label>
        <input className="w1-in" id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} autoFocus /></div>
      {err && <p className="w1-err form-error" role="alert" data-mfa-err="">{err}</p>}
      <button className="w1-bp w1-lgb cta-primary" disabled={pending}>{pending ? labels.working : labels.submit}</button>
    </form>
  );
}
