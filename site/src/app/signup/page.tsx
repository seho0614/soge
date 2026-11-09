import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
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
 * SB-HOM-AUT-020 회원가입 — v10.31 시안 scJoin(5단계 · SignupWizard). v10.218 — 3단계 「추천 코드」(선택 · ?rc= 로 채움).
 *   유형과 순서는 DB(/signup/types) · 동의 칸은 발행된 약관 전부(/terms/required · v10.27 G-188) ·
 *   알림(개인정보 처리 위탁)은 동의 칸이 아니라 「보기」 줄(/terms 의 isNotice · v10.28 G-218) ·
 *   5단계 문항은 로그인 전에 보는 공개 문항(/signup/profile-questions · 가중치 없음).
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ rc?: string }> }) {
  if (await me()) redirect('/');
  /* v10.218 (D189) — 추천 링크(?rc=코드)로 들어왔거나 앞서 받은 쿠키(sgb_rcm · 30일 · middleware)가 있으면 추천 코드 칸을 채움 */
  const rcRaw = ((await searchParams).rc ?? (await cookies()).get('sgb_rcm')?.value ?? '').trim().toUpperCase();
  const rc = /^[A-HJ-NP-Z2-9]{6}$/.test(rcRaw) ? rcRaw : '';
  const [t, locale] = await Promise.all([getTranslations('signup'), getLocale()]);
  const [terms, all, types, qs, settings] = await Promise.all([
    apiGet<JoinTerm[]>('/terms/required', 60).catch(() => [] as JoinTerm[]),
    apiGet<Array<{ code: string; title: string; isNotice?: boolean }>>('/terms', 60).catch(() => []),
    apiGet<SignupType[]>('/signup/types', 300).catch(() => [
      { code: 'PERSONAL', label: t('types.PERSONAL.label'), sub: t('types.PERSONAL.sub'), needsBiz: false, needsCorp: false },
      { code: 'SOLE', label: t('types.SOLE.label'), sub: t('types.SOLE.sub'), needsBiz: true, needsCorp: false },
      { code: 'CORP', label: t('types.CORP.label'), sub: t('types.CORP.sub'), needsBiz: true, needsCorp: true },
    ] as SignupType[]),
    apiGet<{ questions: Q[] }>('/signup/profile-questions', 300).catch(() => ({ questions: [] as Q[] })),
    apiGet<Record<string, string | null>>('/site-settings/public', 30).catch(() => ({} as Record<string, string | null>)),
  ]);
  /* v10.173 (D162 · docs/266) — 운영이 「가입 잠시 막기」(signup.open off)를 하면 가입 칸 대신 안내만(서버도 422 SIGNUP_CLOSED) */
  const closed = settings['signup.open'] === 'off';

  async function doSignup(email: string, password: string, name: string, agreed: string[], jobTitle: string, recommendCode: string) {
    'use server';
    return signup(email, password, name, agreed, jobTitle || undefined, recommendCode || undefined);
  }

  return (
    <div className="w1 w1-jw" data-screen="SB-HOM-AUT-020">
      <div className="w1-jh">
        <h1>{t('title')}</h1>
        <p>{t.rich('lead', { b: (c) => <b>{c}</b> })}</p>
      </div>
      {closed ? <p className="notice" data-signup-closed="">{t('closed')}</p> : <SignupWizard types={locale === 'ko' ? types : types.map((x) => (isSignupTypeKey(x.code) ? { ...x, label: t(`types.${x.code}.label`), sub: t(`types.${x.code}.sub`) } : x))} action={doSignup}
        terms={terms.map((t) => ({ code: t.code, title: t.title, isRequired: t.isRequired }))}
        notices={all.filter((t) => t.isNotice).map((t) => ({ code: t.code, title: t.title }))}
        questions={qs.questions ?? []} initialCode={rc} />}
    </div>
  );
}
