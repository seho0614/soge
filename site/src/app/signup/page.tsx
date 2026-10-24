import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signup, me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { SignupWizard, type JoinTerm, type SignupType } from '@/components/auth/SignupWizard';
import type { Q } from '@/components/ProfileSurvey';
import '@/styles/proto-w1.css';
import { getLocale, getTranslations } from 'next-intl/server';
import { isSignupTypeKey } from '@/i18n/keys';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('signup'))('title') };
}

/**
 * SB-HOM-AUT-020 회원가입 — v10.31 시안 scJoin(5단계 · SignupWizard).
 *   유형과 순서는 DB(/signup/types) · 동의 칸은 발행된 약관 전부(/terms/required · v10.27 G-188) ·
 *   알림(개인정보 처리 위탁)은 동의 칸이 아니라 「보기」 줄(/terms 의 isNotice · v10.28 G-218) ·
 *   5단계 문항은 로그인 전에 보는 공개 문항(/signup/profile-questions · 가중치 없음).
 */
export default async function SignupPage() {
  if (await me()) redirect('/');
  const [t, locale] = await Promise.all([getTranslations('signup'), getLocale()]);
  const [terms, all, types, qs] = await Promise.all([
    apiGet<JoinTerm[]>('/terms/required', 60).catch(() => [] as JoinTerm[]),
    apiGet<Array<{ code: string; title: string; isNotice?: boolean }>>('/terms', 60).catch(() => []),
    apiGet<SignupType[]>('/signup/types', 300).catch(() => [
      { code: 'PERSONAL', label: t('types.PERSONAL.label'), sub: t('types.PERSONAL.sub'), needsBiz: false, needsCorp: false },
      { code: 'SOLE', label: t('types.SOLE.label'), sub: t('types.SOLE.sub'), needsBiz: true, needsCorp: false },
      { code: 'CORP', label: t('types.CORP.label'), sub: t('types.CORP.sub'), needsBiz: true, needsCorp: true },
    ] as SignupType[]),
    apiGet<{ questions: Q[] }>('/signup/profile-questions', 300).catch(() => ({ questions: [] as Q[] })),
  ]);

  async function doSignup(email: string, password: string, name: string, agreed: string[], jobTitle: string) {
    'use server';
    return signup(email, password, name, agreed, jobTitle || undefined);
  }

  return (
    <div className="w1 w1-jw" data-screen="SB-HOM-AUT-020">
      <div className="w1-jh">
        <h1>{t('title')}</h1>
        <p>{t.rich('lead', { b: (c) => <b>{c}</b> })}</p>
      </div>
      <SignupWizard types={locale === 'ko' ? types : types.map((x) => (isSignupTypeKey(x.code) ? { ...x, label: t(`types.${x.code}.label`), sub: t(`types.${x.code}.sub`) } : x))} action={doSignup}
        terms={terms.map((t) => ({ code: t.code, title: t.title, isRequired: t.isRequired }))}
        notices={all.filter((t) => t.isNotice).map((t) => ({ code: t.code, title: t.title }))}
        questions={qs.questions ?? []} />
    </div>
  );
}
