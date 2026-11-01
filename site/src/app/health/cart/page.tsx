/** SB-HLT-CRT-010 장바구니 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltCart } from '@/components/health/types';
import { HltNav, HltSteps } from '@/components/health/HltParts';
import { CartView } from '@/components/health/CartView';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('order'))('meta.cart') };
}
export const dynamic = 'force-dynamic';

/**
 * 장바구니 — GET /me/health/cart (조회) · PATCH /me/health/cart/{code} (수량 · 빼기).
 * 담기(POST /me/health/cart)는 상품 카드 · 상품 상세의 CartAdd 가 부릅니다.
 */
export default async function HltCartPage() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('order');

  /* v10.170 — 「주문 받기」가 꺼져 있으면 담기 · 보기만(주문 단추 대신 안내) */
  const orderOpen = (await apiGet<{ open: boolean }>('/health/order-config', 15).catch(() => ({ open: true }))).open;
  let cart: HltCart | null = null;
  let err: string | null = null;
  try {
    cart = await apiGetPersonal<HltCart>('/me/health/cart');
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : t('common.cartLoadFail');
  }

  return (
    <><div className="hlt">
      <HltNav on="cart" />
      <div className="page-head"><h1>{t('cartPage.title')}</h1></div>
      <HltSteps at={0} />
      {cart ? <Msgs ns={['order']}><CartView initial={cart} orderOpen={orderOpen} /></Msgs> : <p className="form-error" role="alert">{err}</p>}
    </div><i hidden data-root-end="" /></>
  );
}
