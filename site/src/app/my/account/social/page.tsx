import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { apiPost, socErrKey } from '@/lib/socialAuth';
import { MyHead, Note } from '@/components/my/ui';
import { SocialLinks, type SocAct } from './SocialLinks';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('upt'))('myTitle') };
}

interface Mine { links: Array<{ provider: 'KAKAO' | 'NAVER'; emailMasked: string | null; linkedAt: string; lastLoginAt: string | null }>; hasPassword: boolean; providers: Array<{ provider: 'KAKAO' | 'NAVER'; path: string }> }
type Props = { searchParams: Promise<{ linked?: string | string[]; error?: string | string[] }> };

/**
 * SB-MYP-UPT-010 간편 로그인 연결 (v10.498 · D272 · docs/636)
 *   GET /me/social — 연결된 업체 · 비밀번호가 있는지 · 켜진 업체
 *   연결하기 → /login/social/{p}?mode=link(시작 처리기) · 끊기 DELETE /me/social/{p} · 첫 비밀번호 POST /me/social/password
 */
export default async function MySocialPage({ searchParams }: Props) {
  if (!(await me())) redirect('/login?next=/my/account/social');
  const t = await getTranslations('upt');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const m = await apiGetPersonal<Mine>('/me/social').catch(() => null);

  async function doUnlink(provider: string): Promise<SocAct> {
    'use server';
    if (!/^(kakao|naver)$/.test(provider)) return { ok: false, message: '' };
    const r = await apiPost(`/me/social/${provider}`, null, true, 'DELETE');
    return r.status >= 400 ? { ok: false, message: String(r.data?.message ?? '') } : { ok: true, message: String(r.data?.note ?? '') };
  }
  async function doPassword(password: string): Promise<SocAct> {
    'use server';
    const r = await apiPost('/me/social/password', { password }, true);
    return r.status >= 400 ? { ok: false, message: String(r.data?.message ?? '') } : { ok: true, message: String(r.data?.note ?? '') };
  }

  const err = one(sp.error);
  return (
    <div data-my-social="">
      <MyHead title={t('myTitle')} sub={t('mySub')} right={<Link className="my-bo" href="/my/account/security">{t('backSecurity')}</Link>} />
      {one(sp.linked) === '1' && <Note kind="ok" data-social-linked="">{t('myLinkedOk')}</Note>}
      {err && <Note kind="warn" role="alert" data-social-error={err.slice(0, 40)}>{t(socErrKey(err))}</Note>}
      {!m ? <Note kind="warn" role="alert">{t('myLoadFail')}</Note> : (
        <SocialLinks links={m.links} providers={m.providers.map((p) => p.provider)} hasPassword={m.hasPassword} unlink={doUnlink} createPassword={doPassword} />
      )}
    </div>
  );
}
