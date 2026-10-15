/** SB-HLT-ORD-010 주문서 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltAddress, HltCart } from '@/components/health/types';
import { HltEmpty, HltNav, HltSteps } from '@/components/health/HltParts';
import { OrderForm } from '@/components/health/OrderForm';

export const metadata: Metadata = { title: '주문서 · 소개몰' };
export const dynamic = 'force-dynamic';

/**
 * 주문서 — 게이트 IDENTITY_VERIFIED (POST /health/orders 가 요구합니다).
 * 본인인증 전이면 폼을 열지 않고 인증으로 안내합니다 — 끝까지 채운 뒤 403 을 보여 주지 않습니다.
 */
export default async function HltOrderPage() {
  const p = await me();
  if (!p) redirect('/login');

  const allowed = p.roles.some((r) => ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'].includes(r));
  const [cart, addresses] = await Promise.all([
    apiGetPersonal<HltCart>('/me/health/cart').catch(() => null),
    apiGetPersonal<HltAddress[]>('/me/health/addresses').catch(() => [] as HltAddress[]),
  ]);

  return (
    <><div className="hlt">
      <HltNav on="cart" back="/health/cart" />
      <div className="page-head"><h1>주문서</h1></div>
      <HltSteps at={1} />

      {!allowed ? (
        <div className="notice">회원 계정으로만 주문하실 수 있습니다. 운영 계정으로는 주문하지 않습니다.</div>
      ) : !p.identityVerifiedAt ? (
        <div className="notice notice-act">
          <div>
            <strong>주문하시려면 본인인증이 필요합니다.</strong>
            <p>건강상품은 소개뱅크가 직접 팔기 때문에 구매자 확인이 필요합니다.</p>
          </div>
          <Link className="cta-primary as-link" href="/verify?next=/health/order">본인인증하기</Link>
        </div>
      ) : cart === null ? (
        <p className="form-error" role="alert">장바구니를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
      ) : cart.items.length === 0 ? (
        <HltEmpty msg="주문할 상품이 없습니다." href="/health/cart" label="장바구니" />
      ) : (
        <OrderForm cart={cart} addresses={addresses} />
      )}
    </div><i hidden data-root-end="" /></>
  );
}
