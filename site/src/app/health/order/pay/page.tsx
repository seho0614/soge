/** SB-HLT-ORD-020 결제 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import type { HltOrder } from '@/components/health/types';
import { HltEmpty, HltNav, HltSteps } from '@/components/health/HltParts';
import { PayForm } from '@/components/health/PayForm';
import { krw, ORDER_LABEL } from '@/components/health/util';

export const metadata: Metadata = { title: '결제 · 소개몰' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ no?: string; m?: string }> };

/**
 * 결제 — 주문번호(?no=)의 결제 대기 주문만 결제합니다.
 * 내 주문 목록의 "결제하기" 도 여기로 옵니다.
 * D006 — 결제창(토스) → /health/order/pay/success 에서 승인(POST /health/orders/{no}/pay/confirm).
 */
export default async function HltPayPage({ searchParams }: Props) {
  const p = await me();
  if (!p) redirect('/login');
  const { no, m } = await searchParams;

  let o: HltOrder | null = null;
  let err: string | null = null;
  if (no) {
    try {
      o = await apiGetPersonal<HltOrder>(`/me/health/orders/${encodeURIComponent(no)}`);
    } catch (e) {
      err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '주문을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
    }
  }

  return (
    <><div className="hlt">
      <HltNav on="cart" back="/health/order" />
      <div className="page-head"><h1>결제</h1></div>
      <HltSteps at={2} />

      {!no ? (
        <HltEmpty msg="진행 중인 결제가 없습니다." href="/my/health/orders" label="내 주문" />
      ) : !o ? (
        <HltEmpty msg={err ?? '주문을 찾을 수 없습니다.'} href="/my/health/orders" label="내 주문" />
      ) : o.status !== 'PENDING' ? (
        <div className="notice notice-act">
          <div>
            <strong>이미 결제되었거나 취소된 주문입니다.</strong>
            <p>주문번호 {o.orderNo} · 지금 상태 {ORDER_LABEL[o.status] ?? o.status}</p>
          </div>
          <Link className="cta-primary as-link" href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>주문 상세</Link>
        </div>
      ) : o.cancelRequested ? (
        /* v10.26 (G-183) — 취소 신청이 접수된 주문은 결제를 받지 않습니다(서버도 409 CANCEL_REQUESTED) */
        <div className="notice notice-act">
          <div>
            <strong>취소 신청이 접수된 주문입니다.</strong>
            <p>주문번호 {o.orderNo} · 취소가 처리될 때까지 결제하실 수 없습니다.</p>
          </div>
          <Link className="cta-primary as-link" href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>주문 상세</Link>
        </div>
      ) : o.items.length === 0 ? (
        /* ★ 주문 생성이 중간에 실패하면 품목 없는 주문이 남습니다(백엔드 결함 보고) — 결제를 받지 않습니다 */
        <div className="notice">담긴 상품이 없는 주문입니다(주문번호 {o.orderNo}). 결제할 수 없습니다 — 고객센터로 알려 주십시오.</div>
      ) : !p.identityVerifiedAt ? (
        <div className="notice notice-act">
          <div><strong>결제하시려면 본인인증이 필요합니다.</strong></div>
          <Link className="cta-primary as-link" href={`/verify?next=${encodeURIComponent(`/health/order/pay?no=${o.orderNo}`)}`}>본인인증하기</Link>
        </div>
      ) : (
        <section className="hlt-box">
          <h3>주문번호 {o.orderNo}</h3>
          {o.items.map((i) => (
            <div key={i.optionId ?? i.code} className="hlt-sum" data-item={i.code}><span>{i.name}{i.optionLabel && i.optionLabel !== '단품' && <span className="hlt-optnm"> {i.optionLabel}</span>} × {i.qty}</span><span>{krw(i.amount)}</span></div>
          ))}
          <div className="hlt-sum"><span>배송비</span><span>{Number(o.shipFee) === 0 ? '무료' : krw(o.shipFee)}</span></div>
          <div className="hlt-sum tot"><span>결제 금액</span><span>{krw(o.total)}</span></div>
          <PayForm orderNo={o.orderNo} total={Number(o.total)} initialMethod={m ?? 'CARD'} />
          <p className="hint">
            카드번호는 저희 쪽에 남지 않습니다 — 토스페이먼츠 결제창이 처리하고 저희는 거래번호만 받습니다.
            결제 금액은 서버가 주문 금액과 다시 대조합니다. 가상계좌는 입금이 확인되면 결제 완료로 바뀝니다.
          </p>
          {/* v10.27 (G-201) — 결제를 나중에 하려는 분이 주문을 다시 찾을 길(전에는 이 화면에서 내 주문으로 가는 링크가 없었음) */}
          <p className="hint" data-pay-myorders>
            지금 결제하지 않아도 주문은 결제 대기로 남습니다 — <Link href={`/my/health/orders/${encodeURIComponent(o.orderNo)}`}>주문 상세</Link> · <Link href="/my/health/orders">내 주문</Link>에서 이어서 결제하실 수 있습니다.
          </p>
        </section>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
