/** SB-HLT-ORD-040 주문 실패 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { HltNav } from '@/components/health/HltParts';

export const metadata: Metadata = { title: '주문 실패 · 소개몰' };
export const dynamic = 'force-dynamic';

/* 토스 결제창 실패 주소는 code · message · orderId 를 붙여 줍니다(D006) — msg 가 없으면 message 를 씁니다 */
type Props = { searchParams: Promise<{ step?: string; no?: string; code?: string; msg?: string; message?: string; orderId?: string }> };

/* 오류코드별 다음 행동 — 서버 오류코드(HealthPaymentService)를 그대로 받습니다 */
const HINT: Record<string, string> = {
  NOT_ON_SALE: '판매가 끝난 상품이 있습니다. 장바구니에서 빼고 다시 주문해 주십시오.',
  EMPTY: '담으신 상품이 없습니다. 장바구니를 확인해 주십시오.',
  ALREADY: '이미 결제되었거나 취소된 주문입니다. 내 주문에서 상태를 확인해 주십시오.',
  BAD_METHOD: '결제수단을 다시 골라 주십시오.',
  /* D006 — 결제 승인 */
  AMOUNT_MISMATCH: '결제 금액이 주문 금액과 달라 승인하지 않았습니다. 돈은 나가지 않았습니다 — 다시 결제해 주십시오.',
  PAY_REJECTED: '결제사가 승인하지 않았습니다. 다른 카드나 수단으로 다시 시도해 주십시오.',
  PAY_PROCESS_CANCELED: '결제를 취소하셨습니다.',
  PAY_PROCESS_ABORTED: '결제가 중단되었습니다. 다시 시도해 주십시오.',
  REJECT_CARD_COMPANY: '카드사가 승인하지 않았습니다. 다른 카드로 시도해 주십시오.',
  VBANK_WAITING: '가상계좌가 이미 발급되어 입금을 기다리고 있습니다. 주문 상세에서 계좌를 확인해 주십시오.',
  NO_READY_PAYMENT: '결제 준비가 끝나지 않았습니다. 결제 화면에서 다시 시작해 주십시오.',
  NOT_FOUND: '주문을 찾을 수 없습니다. 내 주문에서 확인해 주십시오.',
  IDENTITY_REQUIRED: '본인인증 후 다시 주문해 주십시오.',
};

/**
 * 주문 실패 — 전용 API 가 없습니다. 주문서 · 결제 화면이 받은 오류(코드·문구)를
 * 주소로 넘겨받아 보여 주고, 어디서 다시 할지 안내합니다.
 * 문구는 서버가 준 것이므로 여기서 지어내지 않습니다(없을 때만 기본 문구).
 */
export default async function HltOrderFail({ searchParams }: Props) {
  if (!(await me())) redirect('/login');
  const sp = await searchParams;
  const { step, code } = sp;
  const no = sp.no ?? sp.orderId;
  const msg = sp.msg ?? sp.message;
  const safe = (s: string | undefined, n: number) => (s ?? '').slice(0, n);
  const atPay = step === 'pay' && !!no;
  const c = safe(code, 40) || (atPay ? 'PAY_REJECTED' : 'ORDER_FAILED');

  return (
    <><div className="hlt">
      <HltNav back="/health/order" />
      <div className="page-head"><h1>주문을 마치지 못했습니다</h1></div>
      <div className="hlt-box hlt-fail" role="alert">
        <b>{safe(msg, 200) || (atPay ? '결제가 승인되지 않았습니다.' : '주문을 접수하지 못했습니다.')}</b>
        <p className="hint">오류코드 {c}{no && ` · 주문번호 ${safe(no, 40)}`}</p>
        {HINT[c] && <p>{HINT[c]}</p>}
        {atPay && c !== 'ALREADY' && <p className="hint">결제가 되지 않았으므로 돈은 나가지 않았습니다. 주문은 결제 대기로 남아 있습니다.</p>}
      </div>
      <div className="hlt-btns">
        {/* v10.25 — 단추 이름은 시안대로 「다시 시도」. 가는 곳은 실패한 단계에 맞춥니다(결제 단계 → 결제 화면 · 주문 단계 → 장바구니) */}
        {atPay && c !== 'ALREADY'
          ? <Link className="hlt-btn pri" href={`/health/order/pay?no=${encodeURIComponent(safe(no, 40))}`}>다시 시도</Link>
          : atPay
            ? <Link className="hlt-btn pri" href={`/my/health/orders/${encodeURIComponent(safe(no, 40))}`}>주문 상세</Link>
          : c === 'IDENTITY_REQUIRED'
            ? <Link className="hlt-btn pri" href="/verify?next=/health/cart">본인인증하기</Link>
            : <Link className="hlt-btn pri" href="/health/cart">다시 시도</Link>}
        <Link className="hlt-btn" href="/my/health/orders">주문 내역</Link>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
