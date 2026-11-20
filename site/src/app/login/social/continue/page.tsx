import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { SOC_NEXT, SOC_TICKET, apiPost, clearSocCookie, safeNext, saveSession, socErrKey } from '@/lib/socialAuth';
import { ContinueForms, type ContAct } from './ContinueForms';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('upt'))('contTitle') };
}
export const dynamic = 'force-dynamic';

interface Pending { provider: 'KAKAO' | 'NAVER'; emailMasked: string | null; emailVerified: boolean; needEmail: boolean; emailMatch: boolean; emailTaken: boolean; nameHint: string | null; expiresAt: string }
interface ReqTerm { code: string; title: string; isRequired: boolean }

/** 서버 액션이 부르는 마무리(모듈 수준 — 닫힘 값으로 넘기지 않음): 성공이면 증표 쿠키 저장 · 이어서 쿠키 지움 · 돌아갈 주소 */
async function finish(out: { status: number; data: any }): Promise<ContAct> {
  if (out.status >= 400 || !out.data?.accessToken) {
    const code = String(out.data?.code ?? 'SOCIAL_FAIL');
    return { ok: false, code, message: socErrKey(code) === 'errDefault' ? String(out.data?.message ?? '') : '' };
  }
  await saveSession(out.data.accessToken, out.data.refreshToken);
  const jar2 = await cookies();
  const next = safeNext(jar2.get(SOC_NEXT)?.value) ?? '/';
  await clearSocCookie(SOC_TICKET); await clearSocCookie(SOC_NEXT);
  return { ok: true, next };
}

/**
 * SB-HOM-UPT-020 간편 로그인 이어서 (v10.498 · D272 · docs/636) — 업체 계정으로 처음 온 회원
 *   ① 확인된 같은 이메일 계정이 있으면 「기존 계정에 연결」(그 계정 비밀번호 확인 — 저절로 합치지 않음)
 *   ② 「새로 가입」(이름 · 업체가 이메일을 주지 않았으면 이메일 · 필수 약관 · 추천 코드)
 *   이어서 표는 httpOnly 쿠키(sgb_st · 15분) — 이 화면 서버 액션만 씀
 */
export default async function SocialContinuePage() {
  const t = await getTranslations('upt');
  const jar = await cookies();
  const ticket = jar.get(SOC_TICKET)?.value ?? '';
  const r = ticket ? await apiPost('/auth/social/pending/view', { ticket }) : { status: 409, data: null };
  if (r.status >= 400 || !r.data) {
    return (
      <div className="w1 w1-lgw" data-screen="SB-HOM-UPT-020" data-soc-continue="expired">
        <div className="w1-lgc"><div className="w1-lgh"><h1>{t('contTitle')}</h1></div>
          <div className="w1-jc w" role="alert">{t('expired')}</div>
          <Link className="w1-bo w1-lgb" href="/login">{t('backLogin')}</Link></div>
      </div>
    );
  }
  const p = r.data as Pending;
  const terms = await apiGet<ReqTerm[]>('/terms/required', 60).catch(() => [] as ReqTerm[]);
  const required = terms.filter((x) => x.isRequired).map((x) => x.code);
  const allCodes = terms.map((x) => x.code);

  async function doLink(password: string): Promise<ContAct> {
    'use server';
    const tk = (await cookies()).get(SOC_TICKET)?.value ?? '';
    const vk = (await cookies()).get('sgb_visitor')?.value;
    return finish(await apiPost('/auth/social/pending/link', { ticket: tk, password, ...(vk && /^[A-Za-z0-9-]{8,64}$/.test(vk) ? { visitorKey: vk } : {}) }));
  }
  async function doSignup(name: string, email: string, agree: boolean, recommendCode: string): Promise<ContAct> {
    'use server';
    const tk = (await cookies()).get(SOC_TICKET)?.value ?? '';
    const vk = (await cookies()).get('sgb_visitor')?.value;
    /* 필수 약관 동의 칸 하나 = 필수 약관 모두(선택 약관은 「거부」로 남음 — 이메일 가입과 같은 기록) */
    return finish(await apiPost('/auth/social/pending/signup', {
      ticket: tk, name, ...(email ? { email } : {}), agreedTerms: agree ? required : [],
      ...(recommendCode.trim() ? { recommendCode: recommendCode.trim() } : {}), ...(vk && /^[A-Za-z0-9-]{8,64}$/.test(vk) ? { visitorKey: vk } : {}),
    }));
  }

  return (
    <div className="w1 w1-lgw" data-screen="SB-HOM-UPT-020" data-soc-continue={p.emailMatch ? 'match' : 'new'}>
      <div className="w1-lgc">
        <div className="w1-lgh"><h1>{t('contTitle')}</h1>
          <p>{t('contLead', { provider: p.provider === 'KAKAO' ? t('provKAKAO') : t('provNAVER') })}</p></div>
        <ContinueForms pending={{ emailMasked: p.emailMasked, needEmail: p.needEmail, emailMatch: p.emailMatch, emailTaken: p.emailTaken, nameHint: p.nameHint }}
          hasTerms={allCodes.length > 0} link={doLink} signup={doSignup} />
        <div className="w1-jc i">{t('verifyNote')}</div>
        <Link className="w1-bo w1-lgb" href="/login">{t('backLogin')}</Link>
      </div>
    </div>
  );
}
