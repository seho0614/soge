/** SB-HLT-SEL-020 판매자센터 (v10.166 · D156 · docs/257) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { SellerCenter, type SellerCenterInfo, type SellerProduct } from '@/components/health/SellerCenter';
import type { HltSaleCategory } from '@/components/health/types';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('center.title') }) };
}
export const dynamic = 'force-dynamic';

/**
 * 판매자센터 — GET /me/health/seller/center · GET /me/health/seller/products · GET /health/categories.
 * 입점 승인된 판매자가 아니면(403 NOT_SELLER) 입점 신청 화면으로 안내합니다.
 */
export default async function HltSellerCenterPage() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('hlt.center');
  let info: SellerCenterInfo | null = null;
  let notSeller = false;
  try {
    info = await apiGetPersonal<SellerCenterInfo>('/me/health/seller/center');
  } catch (e) {
    notSeller = e instanceof ApiFailure && e.status === 403;
  }
  const head = (
    <><HltNav back="/health/seller" /><Crumb items={[{ href: '/health/seller', label: t('apply') }, { label: t('title') }]} />
      <div className="page-head"><h1>{t('title')}</h1></div></>
  );
  if (!info) {
    return (
      <><div className="hlt" data-center-none="">{head}
        {notSeller ? <HltEmpty msg={t('notSeller')} href="/health/seller" label={t('apply')} /> : <p className="form-error" role="alert">{t('errLoad')}</p>}
      </div><i hidden data-root-end="" /></>
    );
  }
  const [items, cats] = await Promise.all([
    apiGetPersonal<SellerProduct[]>('/me/health/seller/products').catch(() => [] as SellerProduct[]),
    apiGet<HltSaleCategory[]>('/health/categories', 60).catch(() => [] as HltSaleCategory[]),
  ]);
  return (
    <><div className="hlt">{head}
      <Msgs ns={['hlt']}><SellerCenter info={info} items={items} cats={cats} /></Msgs>
    </div><i hidden data-root-end="" /></>
  );
}
