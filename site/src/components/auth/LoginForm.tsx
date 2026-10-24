'use client';
/**
 * SB-HOM-AUT-030 로그인 폼 — v10.31 시안 scLogin: 이메일 · 비밀번호(보기) · 로그인 상태 유지 · 이메일 찾기 · 비밀번호 재설정 · 로그인.
 *   로그인 상태 유지를 끄면 브라우저를 닫을 때 로그인이 풀립니다(쿠키 — lib/session · middleware).
 *   v10.48 — 비밀번호 찾기는 /login/forgot(메일 링크 · SB-HOM-AUT-040). 이메일 찾기는 고객센터 「계정」 문의.
 *   5번 연속 틀리면 30분 잠금(423 ACCOUNT_LOCKED) — 서버 문구를 그대로 보이고 비밀번호 찾기 단추를 함께 둡니다.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Result = { ok: true; reconsent?: boolean } | { ok: false; code: string; message: string };

export function LoginForm({ action, next }: { action: (email: string, password: string, keep: boolean) => Promise<Result>; next: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState(true);
  const t = useTranslations('loginForm');
  const [err, setErr] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim(), pw = String(fd.get('password') ?? '');
    if (!email || !pw) { setErr(t('needBoth')); return; }
    setErr(null);
    start(async () => {
      const r = await action(email, pw, keep);
      if (r.ok) router.push(r.reconsent ? `/terms/agree?next=${encodeURIComponent(next)}` : next);
      else { setErr(r.message); setLocked(r.code === 'ACCOUNT_LOCKED' || r.code === 'TOO_MANY_ATTEMPTS'); }
    });
  }

  return (
    /* class auth · cta-primary · form-error — 기존 화면 시험(qa · `form.auth button`)이 그대로 쓰는 손잡이. 모양은 .w1-lgc 안에서 덮어씀 */
    <form className="auth w1-lgf" onSubmit={submit} noValidate>
      <div className="w1-fld"><label htmlFor="lg-mail">{t('email')}</label>
        <input className="w1-in" id="lg-mail" type="email" name="email" autoComplete="username" placeholder={t('emailPh')} /></div>
      <div className="w1-fld"><label htmlFor="lg-pw">{t('password')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="w1-in" id="lg-pw" type={show ? 'text' : 'password'} name="password" autoComplete="current-password" placeholder={t('password')} />
          {/* 폼 안 첫 단추가 「로그인」이 되도록 보기 전환은 단추 요소가 아닌 role=button */}
          <span role="button" tabIndex={0} className="w1-bo" onClick={() => setShow((x) => !x)} aria-pressed={show}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShow((x) => !x); } }}>{show ? t('hide') : t('show')}</span>
        </div></div>
      <div className="w1-lgo2">
        <label className="w1-chk"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {t('keep')}</label>
        {/* v10.48 — 비밀번호는 메일 링크로 재설정(SB-HOM-AUT-040). 이메일 찾기는 지금처럼 고객센터 「계정」 문의 */}
        <span><Link className="w1-lnk2" href="/login/forgot">{t('forgotPw')}</Link>{' · '}
          <Link className="w1-lnk2" href="/support/new#inquiry">{t('forgotEmail')}</Link></span>
      </div>
      {err && <p className="w1-err form-error" role="alert">{err}{locked && <> <Link className="w1-lnk2" href="/login/forgot">{t('forgotPw')}</Link></>}</p>}
      <button className="w1-bp w1-lgb cta-primary" disabled={pending}>{pending ? t('working') : t('submit')}</button>
    </form>
  );
}
