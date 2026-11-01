/** SB-HLT-SEL-010 입점 신청 (v10.165 · D155 · docs/256) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { SellerApply, type MySeller } from '@/components/health/SellerApply';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('tenant.title') }) };
}
export const dynamic = 'force-dynamic';

/**
 * 소개몰 입점 신청 — GET /health/tenant/config · GET /me/health/seller · POST /me/health/seller.
 * 설정 mall.tenant 가 꺼져 있으면 「아직 열리지 않음」만 보입니다(입점 약관 게시 · 결제대행사 계약 전).
 */
export default async function HltSellerPage() {
  const t = await getTranslations('hlt.tenant');
  const cfg = await apiGet<{ enabled: boolean }>('/health/tenant/config', 30).catch(() => ({ enabled: false }));
  if (!cfg.enabled) {
    return (
      <><div className="hlt" data-tenant-off="">
        <HltNav />
        <Crumb items={[{ label: t('title') }]} />
        <div className="page-head"><h1>{t('title')}</h1></div>
        <HltEmpty msg={t('closed')} href="/health" label={t('toMall')} />
      </div><i hidden data-root-end="" /></>
    );
  }
  if (!(await me())) redirect('/login');
  const mine = await apiGetPersonal<MySeller>('/me/health/seller').catch(() => null);
  return (
    <><div className="hlt">
      <HltNav />
      <Crumb items={[{ label: t('title') }]} />
      <div className="page-head"><h1>{t('title')}</h1><p className="hint">{t('lead')}</p></div>
      {mine ? <Msgs ns={['hlt']}><SellerApply initial={mine} /></Msgs> : <p className="form-error" role="alert">{t('errLoad')}</p>}
    </div><i hidden data-root-end="" /></>
  );
}
