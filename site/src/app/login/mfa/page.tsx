import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { memberMfaPending } from '@/lib/scxAuth';
import { MfaLoginForm } from '@/components/scx/MfaLoginForm';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('scx'))('loginTitle') };
}

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/** 로그인 화면(login/page.tsx safeNext)과 같은 규칙 — 우리 사이트 안 경로만 */
function safeNext(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || s.length === 0 || s.length > 500) return '/';
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || s.includes('://') || /[\u0000-\u001f]/.test(s)) return '/';
  return s;
}

/**
 * SB-HOM-SCX-010 회원 2단계 로그인 (v10.592 · docs/734)
 *   비밀번호가 맞고 2단계를 켠 회원 — 표는 HttpOnly 쿠키(5분) · 번호 → POST /auth/mfa/member-login(서버 액션 memberMfaLogin)
 *   표가 없으면(시간 지남 · 바로 들어옴) 로그인 화면으로 안내
 */
export default async function MfaLoginPage({ searchParams }: Props) {
  const t = await getTranslations('scx');
  const next = safeNext((await searchParams).next);
  if (await me()) redirect(next);
  const pending = await memberMfaPending();
  return (
    <div className="w1 w1-lgw" data-screen="SB-HOM-SCX-010">
      <div className="w1-lgc">
        <div className="w1-lgh"><h1>{t('loginTitle')}</h1><p>{t('loginLead')}</p></div>
        {pending
          ? <MfaLoginForm next={next} labels={{ code: t('loginCode'), submit: t('loginSubmit'), working: t('working'), need: t('loginNeed') }} />
          : <p className="w1-err form-error" role="alert" data-mfa-expired="">{t('loginExpired')}</p>}
        <div className="w1-nt3" style={{ marginTop: 12 }}>{t('loginLost')}</div>
        <div style={{ marginTop: 12 }}><Link className="w1-bo sm" href={`/login?next=${encodeURIComponent(next)}`}>{t('loginBack')}</Link></div>
      </div>
    </div>
  );
}
