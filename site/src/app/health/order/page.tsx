/** SB-HLT-ORD-010 주문서 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, apiGetPersonal } from '@/lib/api';
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
type Props = { searchParams: Promise<{ seller?: string }> };

export default async function HltOrderPage({ searchParams }: Props) {
  const sp = await searchParams;
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('order');

  const allowed = p.roles.some((r) => ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'].includes(r));
  /* v10.170 — 「주문 받기」 꺼짐이면 주문서를 열지 않음 */
  const orderOpen = (await apiGet<{ open: boolean }>('/health/order-config', 15).catch(() => ({ open: true }))).open;
  const [cart0, addresses] = await Promise.all([
    apiGetPersonal<HltCart>('/me/health/cart').catch(() => null),
    apiGetPersonal<HltAddress[]>('/me/health/addresses').catch(() => [] as HltAddress[]),
  ]);
  /* v10.167 — 판매자가 둘 이상이면 한 판매자 것만 주문합니다(?seller=코드 · 없으면 첫 판매자). 나머지는 장바구니에 남습니다 */
  let cart: HltCart | null = cart0;
  let others = 0;
  if (cart0 && (cart0.sellers?.length ?? 0) > 1) {
    const g = cart0.sellers!.find((x) => x.sellerCode === sp.seller) ?? cart0.sellers![0]!;
    const ids = new Set(g.optionIds);
    cart = { ...cart0, items: cart0.items.filter((i) => ids.has(i.optionId)), goods: g.goods, shipFee: g.shipFee, total: g.goods + g.shipFee,
             lines: g.optionIds.length, sellers: [g] };
    others = cart0.sellers!.length - 1;
  }

  return (
    <><div className="hlt">
      <HltNav on="cart" back="/health/cart" />
      <div className="page-head"><h1>{t('orderPage.title')}</h1></div>
      <HltSteps at={1} />

      {!orderOpen ? (
        <div className="notice" data-orders-closed="">{t('cart.closed')}</div>
      ) : !allowed ? (
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
        <>{others > 0 && <p className="notice" data-order-seller={cart.sellers?.[0]?.sellerCode}>{t('orderPage.oneSeller', { name: cart.sellers?.[0]?.sellerName ?? '', n: String(others) })}</p>}
        <Msgs ns={['order']}><OrderForm cart={cart} addresses={addresses} /></Msgs></>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
