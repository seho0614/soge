import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { login, me } from '@/lib/session';
import { GWAN_PATH } from '@/lib/format';
import { LoginForm } from '@/components/auth/LoginForm';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('login'))('title') };
}

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * 로그인 뒤 돌아갈 주소(?next=) — **우리 사이트 안의 경로만** 받습니다.
 * 바깥 주소(https://… · //남의도메인 · 역슬래시 꼼수)를 따르면, 우리 로그인 화면을 거쳐 남의 사이트로 보내는 링크가 만들어집니다.
 */
function safeNext(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || s.length === 0 || s.length > 500) return null;
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || s.includes('://')) return null;
  if (/[\u0000-\u001f]/.test(s)) return null;
  return s;
}

/**
 * SB-HOM-AUT-030 로그인 — v10.31 시안 scLogin 그대로: 카드 · 안내(개인 회원도 가입) · 약관이 바뀐 뒤 로그인하면(재동의 화면 보기) ·
 *   이메일 · 비밀번호(보기) · 로그인 상태 유지 · 이메일 찾기 · 비밀번호 재설정 · 로그인 · 승인 대기 계정 안내 · 회원가입 · 관심 성향 등록 · 가입 안내.
 */
export default async function LoginPage({ searchParams }: Props) {
  const t = await getTranslations('login');
  const sp = await searchParams;

  /* 로그인 후 도착할 화면은 운영이 정합니다(site.landing_after_login). 비어 있으면 메인입니다.
     ★ v10.21 (G-135) — 설정 값은 **관 코드**(MNY)이고 화면 주소는 /money 입니다. GWAN_PATH 로 주소를 찾습니다. */
  /* v10.36 — 캐시하지 않습니다(전: 60초). 운영 화면에서 바꾼 첫 화면이 1분 넘게 옛 값으로 나와 「저장이 안 된다」로 보였습니다 */
  const landing = await apiGet<{ value: string }>('/site/landing', 0)
    .then(r => r.value).catch(() => '');
  const landingUrl = GWAN_PATH[landing] ? `/${GWAN_PATH[landing]}` : '/';
  /* 로그인이 필요해 이 화면으로 보내진 경우(?next=)는 보던 화면으로 돌려보냅니다 */
  const nextUrl = safeNext(sp.next) ?? landingUrl;

  if (await me()) redirect(nextUrl);

  async function doLogin(email: string, password: string, keep: boolean) {
    'use server';
    return login(email, password, keep);
  }

  return (
    <div className="w1 w1-lgw" data-screen="SB-HOM-AUT-030">
      <div className="w1-lgc">
        <div className="w1-lgh"><h1>{t('title')}</h1>
          <p>{t.rich('lead', { b: (c) => <b>{c}</b> })}</p></div>
        <div className="w1-jc w"><span className="lb">{t('reconsentLb')}</span>
          {t.rich('reconsentBody', { b: (c) => <b>{c}</b> })}
          <div style={{ marginTop: 8 }}><Link className="w1-bo sm" href="/terms/agree">{t('reconsentLink')}</Link></div></div>
        <LoginForm action={doLogin} next={nextUrl} />
        <div className="w1-jc w" style={{ marginTop: 16 }}><span className="lb">{t('pendingLb')}</span>
          {t.rich('pendingBody', { b: (c) => <b>{c}</b> })}
          <div style={{ marginTop: 8 }}><Link className="w1-bo sm" href="/verify">{t('pendingLink')}</Link></div></div>
        <div className="w1-lgd"><span>{t('noAccount')}</span></div>
        <Link className="w1-bo w1-lgb" href="/signup">{t('signup')}</Link>
        <div className="w1-prfcta">
          <div className="pch"><b>{t('profileTitle')}</b><span>{t('profileSub')}</span></div>
          <p>{t.rich('profileBody', { b: (c) => <b>{c}</b> })}</p>
          <Link className="w1-bp w1-lgb" href="/ai/profile">{t('profileLink')}</Link>
        </div>
        <div className="w1-nt3" style={{ textAlign: 'center', marginTop: 12 }}>{t('whoCanJoin')}</div>
      </div>
    </div>
  );
}
