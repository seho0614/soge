/** SB-HLT-ORD-010 주문서 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltAddress, HltCart } from '@/components/health/types';
import { HltEmpty, HltNav, HltSteps } from '@/components/health/HltParts';
import { OrderForm } from '@/components/health/OrderForm';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('order'))('meta.order') };
}
export const dynamic = 'force-dynamic';

/**
 * 주문서 — 게이트 IDENTITY_VERIFIED (POST /health/orders 가 요구합니다).
 * 본인인증 전이면 폼을 열지 않고 인증으로 안내합니다 — 끝까지 채운 뒤 403 을 보여 주지 않습니다.
 */
export default async function HltOrderPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('order');

  const allowed = p.roles.some((r) => ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'].includes(r));
  const [cart, addresses] = await Promise.all([
    apiGetPersonal<HltCart>('/me/health/cart').catch(() => null),
    apiGetPersonal<HltAddress[]>('/me/health/addresses').catch(() => [] as HltAddress[]),
  ]);

  return (
    <><div className="hlt">
      <HltNav on="cart" back="/health/cart" />
      <div className="page-head"><h1>{t('orderPage.title')}</h1></div>
      <HltSteps at={1} />

      {!allowed ? (
        <div className="notice">{t('orderPage.memberOnly')}</div>
      ) : !p.identityVerifiedAt ? (
        <div className="notice notice-act">
          <div>
            <strong>{t('orderPage.needVerify')}</strong>
            <p>{t('orderPage.verifyWhy')}</p>
          </div>
          <Link className="cta-primary as-link" href="/verify?next=/health/order">{t('common.verify')}</Link>
        </div>
      ) : cart === null ? (
        <p className="form-error" role="alert">{t('common.cartLoadFail')}</p>
      ) : cart.items.length === 0 ? (
        <HltEmpty msg={t('orderPage.noItems')} href="/health/cart" label={t('common.cart')} />
      ) : (
        <Msgs ns={['order']}><OrderForm cart={cart} addresses={addresses} /></Msgs>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
