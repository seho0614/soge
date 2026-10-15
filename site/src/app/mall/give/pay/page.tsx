/** SB-MAL-GIV-010 안심소개에서 소개하기 — 추가 소개코드 결제창 성공 주소 (D010) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import { siteOrigin } from '@/components/refcode/origin';
import { refScope } from '@/components/refcode/RefShare';
import { RefPayConfirm } from '@/components/refcode/RefPayConfirm';
import '@/styles/mal.css';
import '@/components/refcode/refcode.css';

export const metadata: Metadata = { title: '소개코드 결제 확인' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string; listing?: string }> };

/**
 * 토스 결제창이 성공하면 이 주소로 돌아옵니다 — ?paymentKey=&orderId=&amount=&listing=
 * (listing 은 결제창에 가기 전의 매물 — refcode.scope=listing 이면 필수입니다)
 * ★ 여기까지 왔다고 결제된 것이 아닙니다. 서버가 승인(confirm)해야 돈이 움직이고 코드가 나옵니다.
 *   amount 는 주소에 있어 고칠 수 있으므로 서버가 「초과 건수 × 단가」와 대조합니다(다르면 422 AMOUNT_MISMATCH).
 */
export default async function RefPayPage({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const { paymentKey, orderId, amount, listing } = await searchParams;
  const amt = Number(amount);
  const valid = !!paymentKey && /^[A-Za-z0-9_-]{1,200}$/.test(paymentKey)
    && !!orderId && /^[A-Za-z0-9_-]{6,64}$/.test(orderId) && Number.isInteger(amt) && amt > 0;
  const lid = listing && /^[0-9a-fA-F-]{36}$/.test(listing) ? listing : undefined;
  /* D012 — 소개코드는 매물별입니다(운영 설정 refcode.scope=listing). 결제창에 가기 전의 매물을 이어받아 그 매물 코드로 발급합니다.
   * 공유 링크는 그 매물의 관 경로로 만듭니다(GET /listings/{id} 의 gwanCode). 매물이 없으면 발급하지 않습니다. */
  const [scope, origin, item] = await Promise.all([
    refScope(), siteOrigin(),
    lid ? apiGet<{ gwanCode: string }>(`/listings/${lid}`, 30).catch(() => null) : Promise.resolve(null),
  ]);
  const gwanPath = (item && GWAN_PATH[item.gwanCode]) || 'mall';
  const base = `${origin}/${gwanPath}${lid ? `/${lid}` : ''}`;
  const ok = valid && (scope === 'all' || !!lid);

  return (
    <><div className="mal mal-narrow">
      <a className="mal-back" href="/mall/give">‹ 안심소개에서 소개하기</a>
      <div className="page-head mal-head"><h1>소개코드 결제 확인</h1></div>
      {ok
        ? <RefPayConfirm paymentKey={paymentKey!} orderId={orderId!} amount={amt} base={base} listingId={lid} />
        : <p className="mal-empty">결제 정보가 올바르지 않습니다. <a href="/mall/give">안심소개에서 소개하기</a>에서 내 소개코드를 확인해 주십시오.</p>}
    </div><i hidden data-root-end="" /></>
  );
}
