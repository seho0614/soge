import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signup, me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { SignupWizard, type JoinTerm, type SignupType } from '@/components/auth/SignupWizard';
import type { Q } from '@/components/ProfileSurvey';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '회원가입' };

/**
 * SB-HOM-AUT-020 회원가입 — v10.31 시안 scJoin(5단계 · SignupWizard).
 *   유형과 순서는 DB(/signup/types) · 동의 칸은 발행된 약관 전부(/terms/required · v10.27 G-188) ·
 *   알림(개인정보 처리 위탁)은 동의 칸이 아니라 「보기」 줄(/terms 의 isNotice · v10.28 G-218) ·
 *   5단계 문항은 로그인 전에 보는 공개 문항(/signup/profile-questions · 가중치 없음).
 */
export default async function SignupPage() {
  if (await me()) redirect('/');
  const [terms, all, types, qs] = await Promise.all([
    apiGet<JoinTerm[]>('/terms/required', 60).catch(() => [] as JoinTerm[]),
    apiGet<Array<{ code: string; title: string; isNotice?: boolean }>>('/terms', 60).catch(() => []),
    apiGet<SignupType[]>('/signup/types', 300).catch(() => [
      { code: 'PERSONAL', label: '개인 회원', sub: '요청 등록과 소개 참여를 하실 수 있습니다.', needsBiz: false, needsCorp: false },
      { code: 'SOLE', label: '개인 사업자', sub: '사업자등록번호로 인증합니다.', needsBiz: true, needsCorp: false },
      { code: 'CORP', label: '법인 사업자', sub: '사업자등록번호와 법인등록번호가 필요합니다.', needsBiz: true, needsCorp: true },
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
        <h1>회원가입</h1>
        <p><b>개인 회원도 가입하실 수 있습니다.</b> 요청 등록과 소개 참여는 개인회원도 가능하며, 본인인증을 하시면 소개비도 받으십니다.
          본인인증을 하시면 모든 업무를 하실 수 있고, 등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다.</p>
      </div>
      <SignupWizard types={types} action={doSignup}
        terms={terms.map((t) => ({ code: t.code, title: t.title, isRequired: t.isRequired }))}
        notices={all.filter((t) => t.isNotice).map((t) => ({ code: t.code, title: t.title }))}
        questions={qs.questions ?? []} />
    </div>
  );
}
