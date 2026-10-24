'use client';
/**
 * v10.48 (D102) — SB-HOM-AUT-040 비밀번호 찾기 · SB-HOM-AUT-041 비밀번호 재설정 폼
 *   찾기: 가입 이메일 → 재설정 링크(30분 · 1회). 계정이 있든 없든 같은 안내가 나옵니다(서버가 같은 답).
 *         메일 발송 준비 전(운영)에는 서버가 MAIL_NOT_READY — 고객센터 「계정」 문의로 잇습니다.
 *         개발 PC 에서는 서버가 devLink 를 주므로 그 링크를 화면에 보입니다(운영에서는 나오지 않음).
 *   재설정: 새 비밀번호 두 번 → 바꾸면 모든 기기의 로그인이 풀리고 로그인 화면으로.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Act = { ok: true; note?: string; devLink?: string } | { ok: false; code: string; message: string };

/** 서버 규칙과 같음 — 영문 · 숫자 · 특수문자를 섞어 10자 이상. v10.95 — 문장 대신 사전 키(pwForm.weak)를 돌려줍니다 */
export function weakPassword(pw: string): 'weak' | null {
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
    return 'weak';
  }
  return null;
}

export function ForgotForm({ action }: { action: (email: string) => Promise<Act> }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ msg: string; code: string } | null>(null);
  const [done, setDone] = useState<{ note: string; devLink?: string } | null>(null);
  const t = useTranslations('pwForm');

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr({ msg: t('emailInvalid'), code: 'EMAIL_INVALID' }); return; }
    setErr(null); setDone(null);
    start(async () => {
      const r = await action(email);
      if (r.ok) setDone({ note: r.note ?? t('sentDefault'), devLink: r.devLink });
      else setErr({ msg: r.message, code: r.code });
    });
  }

  return (
    <form className="auth w1-lgf" onSubmit={submit} noValidate data-forgot-form="">
      <div className="w1-fld"><label htmlFor="fg-mail">{t('joinedEmail')}</label>
        <input className="w1-in" id="fg-mail" type="email" name="email" autoComplete="username" placeholder={t('emailPh')} maxLength={120} /></div>
      {err && (
        <p className="w1-err form-error" role="alert">{err.msg}
          {err.code === 'MAIL_NOT_READY' && <> <Link className="w1-lnk2" href="/support/new#inquiry">{t('support')}</Link></>}
        </p>
      )}
      {done && (
        <div className="w1-jc w" role="status" data-forgot-done="">
          <span className="lb">{t('checkMail')}</span>{done.note}
          {done.devLink && (
            <div style={{ marginTop: 8 }} data-dev-link="">
              {t.rich('devLink', { b: (c) => <b>{c}</b> })} <Link className="w1-lnk2" href={done.devLink}>{t('openReset')}</Link>
            </div>
          )}
        </div>
      )}
      <button className="w1-bp w1-lgb cta-primary" disabled={pending}>{pending ? t('sending') : t('sendLink')}</button>
    </form>
  );
}

export function ResetForm({ token, action }: { token: string; action: (token: string, password: string) => Promise<Act> }) {
  const t = useTranslations('pwForm');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<{ msg: string; code: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get('password') ?? ''), pw2 = String(fd.get('password2') ?? '');
    const weak = weakPassword(pw);
    if (weak) { setErr({ msg: t(weak), code: 'WEAK_PASSWORD' }); return; }
    if (pw !== pw2) { setErr({ msg: t('mismatch'), code: 'MISMATCH' }); return; }
    setErr(null);
    start(async () => {
      const r = await action(token, pw);
      if (r.ok) { setDone(r.note ?? t('changedDefault')); setTimeout(() => router.push('/login'), 2500); }
      else setErr({ msg: r.message, code: r.code });
    });
  }

  if (done) {
    return (
      <div className="w1-jc w" role="status" data-reset-done="">
        <span className="lb">{t('changedLb')}</span>{done}
        <div style={{ marginTop: 8 }}><Link className="w1-bp sm" href="/login">{t('goLogin')}</Link></div>
      </div>
    );
  }
  return (
    <form className="auth w1-lgf" onSubmit={submit} noValidate data-reset-form="">
      <div className="w1-fld"><label htmlFor="rs-pw">{t('newPw')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="w1-in" id="rs-pw" type={show ? 'text' : 'password'} name="password" autoComplete="new-password" placeholder={t('newPwPh')} maxLength={100} />
          <span role="button" tabIndex={0} className="w1-bo" onClick={() => setShow((x) => !x)} aria-pressed={show}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShow((x) => !x); } }}>{show ? t('hide') : t('show')}</span>
        </div></div>
      <div className="w1-fld"><label htmlFor="rs-pw2">{t('newPw2')}</label>
        <input className="w1-in" id="rs-pw2" type={show ? 'text' : 'password'} name="password2" autoComplete="new-password" placeholder={t('newPw2Ph')} maxLength={100} /></div>
      {err && (
        <p className="w1-err form-error" role="alert">{err.msg}
          {err.code === 'RESET_TOKEN_INVALID' && <> <Link className="w1-lnk2" href="/login/forgot">{t('requestAgain')}</Link></>}
        </p>
      )}
      <button className="w1-bp w1-lgb cta-primary" disabled={pending}>{pending ? t('changing') : t('change')}</button>
    </form>
  );
}
