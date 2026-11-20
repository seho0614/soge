'use client';
/**
 * SB-HOM-UPT-020 간편 로그인 이어서 — 기존 계정 연결(비밀번호 확인) · 새로 가입(이름 · 이메일 · 필수 약관 · 추천 코드)
 *   서버 액션은 page.tsx(이어서 표 쿠키 · 증표 저장은 서버에서만)
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

export type ContAct = { ok: true; next: string } | { ok: false; code: string; message: string };
type P = { emailMasked: string | null; needEmail: boolean; emailMatch: boolean; emailTaken: boolean; nameHint: string | null };

const ERR = {
  SOCIAL_TICKET_INVALID: 'expired', INVALID_CREDENTIALS: 'password', DUPLICATE: 'emailTaken', SOCIAL_STAFF_NOT_ALLOWED: 'errStaff',
  SOCIAL_PROVIDER_TAKEN: 'errTaken', REQUIRED_TERM: 'needAgree',
} as const;

export function ContinueForms({ pending, hasTerms, link, signup }: {
  pending: P; hasTerms: boolean; link: (password: string) => Promise<ContAct>;
  signup: (name: string, email: string, agree: boolean, recommendCode: string) => Promise<ContAct>;
}) {
  const t = useTranslations('upt');
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(pending.nameHint ?? '');
  const [agree, setAgree] = useState(false);

  const show = (r: ContAct) => {
    if (r.ok) { window.location.assign(r.next); return; }
    const k = r.code in ERR ? ERR[r.code as keyof typeof ERR] : null;
    setErr(r.message || (k ? (k === 'password' ? `${t('password')} — ${t('errDefault')}` : t(k)) : t('errDefault')));
  };

  function onLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(null);
    const pw = String(new FormData(e.currentTarget).get('password') ?? '');
    if (!pw) return;
    start(async () => show(await link(pw)));
  }
  function onSignup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(null);
    const fd = new FormData(e.currentTarget);
    if (!name.trim()) { setErr(t('needName')); return; }
    if (hasTerms && !agree) { setErr(t('needAgree')); return; }
    start(async () => show(await signup(name.trim(), String(fd.get('email') ?? '').trim(), agree, String(fd.get('recommendCode') ?? ''))));
  }

  return (
    <div data-soc-forms="">
      {err && <div className="w1-jc w" role="alert" data-soc-err="">{err}</div>}
      {pending.emailMatch && (
        <form className="w1-lgf" onSubmit={onLink} data-soc-link-form="">
          <h2>{t('linkTitle')}</h2>
          <p>{t('linkLead', { email: pending.emailMasked ?? '' })}</p>
          <div className="w1-fld"><label htmlFor="soc-pw">{t('password')}</label>
            <input className="w1-in" id="soc-pw" type="password" name="password" autoComplete="current-password" /></div>
          <button className="w1-bp w1-lgb" type="submit" disabled={busy}>{busy ? t('working') : t('linkBtn')}</button>
        </form>
      )}
      <form className="w1-lgf" onSubmit={onSignup} data-soc-signup-form="">
        <h2>{t('signupTitle')}</h2>
        {pending.emailTaken && <div className="w1-jc w">{t('emailTaken')}</div>}
        <div className="w1-fld"><label htmlFor="soc-name">{t('name')}</label>
          <input className="w1-in" id="soc-name" name="name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
        {pending.needEmail ? (
          <div className="w1-fld"><label htmlFor="soc-mail">{t('email')}</label>
            <input className="w1-in" id="soc-mail" type="email" name="email" maxLength={254} autoComplete="email" /></div>
        ) : <p className="w1-nt3">{t('emailFromProvider', { email: pending.emailMasked ?? '' })}</p>}
        {hasTerms && (
          <div className="w1-fld"><label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-soc-agree="" /> {t('agreeAll')}</label>{' '}
            <Link href="/terms" target="_blank">{t('termsLink')}</Link></div>
        )}
        <div className="w1-fld"><label htmlFor="soc-rc">{t('recommend')}</label>
          <input className="w1-in" id="soc-rc" name="recommendCode" maxLength={20} autoComplete="off" /></div>
        <button className="w1-bp w1-lgb" type="submit" disabled={busy || pending.emailTaken}>{busy ? t('working') : t('signupBtn')}</button>
      </form>
    </div>
  );
}
