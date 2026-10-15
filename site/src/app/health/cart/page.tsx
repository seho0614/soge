/** SB-HLT-CRT-010 장바구니 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltCart } from '@/components/health/types';
import { HltNav, HltSteps } from '@/components/health/HltParts';
import { CartView } from '@/components/health/CartView';

export const metadata: Metadata = { title: '장바구니 · 소개몰' };
export const dynamic = 'force-dynamic';

/**
 * 장바구니 — GET /me/health/cart (조회) · PATCH /me/health/cart/{code} (수량 · 빼기).
 * 담기(POST /me/health/cart)는 상품 카드 · 상품 상세의 CartAdd 가 부릅니다.
 */
export default async function HltCartPage() {
  if (!(await me())) redirect('/login');

  let cart: HltCart | null = null;
  let err: string | null = null;
  try {
    cart = await apiGetPersonal<HltCart>('/me/health/cart');
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '장바구니를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }

  return (
    <><div className="hlt">
      <HltNav on="cart" />
      <div className="page-head"><h1>장바구니</h1></div>
      <HltSteps at={0} />
      {cart ? <CartView initial={cart} /> : <p className="form-error" role="alert">{err}</p>}
    </div><i hidden data-root-end="" /></>
  );
}
