import type { Metadata } from 'next';
import Link from 'next/link';
import { forgotPassword } from '@/lib/session';
import { ForgotForm } from '@/components/auth/PasswordForms';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('forgot'))('title') };
}

/**
 * SB-HOM-AUT-040 비밀번호 찾기 (v10.48 · D102)
 *   POST /auth/password/forgot — 가입한 이메일로 30분짜리 1회용 재설정 링크.
 *   ★ 계정이 있든 없든 같은 안내가 나옵니다 — 이 화면으로 가입 여부를 알아낼 수 없게.
 *   같은 이메일 · 같은 IP 1시간 5회까지. 메일 발송 준비 전(운영)에는 고객센터 「계정」 문의로 안내합니다.
 */
export default async function ForgotPage() {
  const t = await getTranslations('forgot');
  async function doForgot(email: string) {
    'use server';
    return forgotPassword(email);
  }
  return (
    <div className="w1 w1-lgw" data-screen="SB-HOM-AUT-040">
      <div className="w1-lgc">
        <div className="w1-lgh"><h1>{t('title')}</h1>
          <p>{t.rich('lead', { b: (c) => <b>{c}</b> })}</p></div>
        <ForgotForm action={doForgot} />
        <div className="w1-jc w" style={{ marginTop: 16 }}><span className="lb">{t('noMailLb')}</span>
          {t('noMailBody')}
          <div style={{ marginTop: 8 }}><Link className="w1-bo sm" href="/support/new#inquiry">{t('support')}</Link></div></div>
        <div className="w1-lgd"><span>{t('remembered')}</span></div>
        <Link className="w1-bo w1-lgb" href="/login">{t('login')}</Link>
      </div>
    </div>
  );
}
