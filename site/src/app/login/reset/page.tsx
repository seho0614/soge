import type { Metadata } from 'next';
import Link from 'next/link';
import { resetPassword } from '@/lib/session';
import { ResetForm } from '@/components/auth/PasswordForms';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('reset'))('title'), referrer: 'no-referrer' };
}

type Props = { searchParams: Promise<{ token?: string | string[] }> };

/**
 * SB-HOM-AUT-041 비밀번호 재설정 (v10.48 · D102)
 *   메일 링크(/login/reset?token=…)로 들어옵니다. POST /auth/password/reset — 한 번만 · 30분.
 *   바꾸면 모든 기기의 로그인이 풀리고 로그인 잠금도 풀립니다.
 *   ★ 이 화면에서 다른 사이트로 나가는 링크를 두지 않고 referrer 를 보내지 않습니다 — 주소의 token 이 새지 않게.
 */
export default async function ResetPage({ searchParams }: Props) {
  const t = await getTranslations('reset');
  const sp = await searchParams;
  const raw = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  const token = typeof raw === 'string' && /^[A-Za-z0-9_-]{30,100}$/.test(raw) ? raw : null;

  async function doReset(t: string, password: string) {
    'use server';
    return resetPassword(t, password);
  }
  return (
    <div className="w1 w1-lgw" data-screen="SB-HOM-AUT-041">
      <div className="w1-lgc">
        <div className="w1-lgh"><h1>{t('title')}</h1>
          <p>{t.rich('lead', { b: (c) => <b>{c}</b> })}</p></div>
        {token ? (
          <ResetForm token={token} action={doReset} />
        ) : (
          <div className="w1-jc w" role="alert" data-reset-bad=""><span className="lb">{t('badLb')}</span>
            {t('badBody')}
            <div style={{ marginTop: 8 }}><Link className="w1-bo sm" href="/login/forgot">{t('forgot')}</Link></div></div>
        )}
      </div>
    </div>
  );
}
