import { RequestCtx } from '../../core/request-context';
import { PaymentProvider, PaymentResult } from './payment.provider';

/**
 * 결제창 승인(confirm) — **이미 승인된 결제를 또 받지 않고, 결제사에 물어 확인합니다.** (v10.18 · D022)
 *
 * 왜 필요한가
 *   결제는 승인됐는데 우리 쪽에서 요청이 끝나지 못하는 경우가 있습니다.
 *     · 승인 응답을 받기 전에 연결이 끊김 · 서버가 죽음
 *     · 승인 뒤 DB 저장이 실패(롤백)
 *   이용자가 같은 결제로 다시 요청하면 결제사는 「이미 처리된 결제」라고 답합니다. 전에는 그것을 결제 실패로 돌려줘
 *   **돈은 나갔는데 구독 · 코드가 열리지 않는** 상태로 끝났습니다(실측 — 같은 키 재시도 422 PAYMENT_FAILED).
 *
 * 하는 일
 *   1. 승인 요청 전에 「결과 불명확」 표시를 남깁니다 — 여기서 죽으면 그 표시가 남습니다.
 *   2. 승인되면 그대로. 결제사가 거절(확정)하면 거절.
 *   3. 「이미 처리됨」이거나 답을 못 받았으면 결제 키로 **조회**합니다.
 *        승인 완료(DONE) · 금액 · 주문번호가 이 요청과 같음   → 승인으로 인정(recovered)
 *        결제사에 그런 결제가 없음                          → 거절(확정)
 *        있기는 한데 이 요청의 것이 아님(금액 · 주문번호 · 상태) → 거절(확정) — 남의 결제 · 취소된 결제를 쓰려는 것
 *        조회도 안 됨                                      → 결과 불명확으로 남김(uncertain)
 *
 * ★ 부르는 쪽이 지킬 것 — 「이 결제 키를 이미 다른 곳에 썼는가」는 부르는 쪽이 자기 표에서 먼저 봅니다
 *   (청구서 payment_key · 소개코드 결제). 이 함수는 결제사의 상태만 봅니다.
 */
export async function confirmOrRecover(
  provider: PaymentProvider,
  input: { paymentKey: string; orderId: string; amount: number; orderName: string; method?: string },
): Promise<PaymentResult & { recovered?: boolean }> {
  const ref = { paymentKey: input.paymentKey, orderId: input.orderId, amount: input.amount };
  RequestCtx.markPayment({ state: 'UNCERTAIN', ...ref });

  const pay = await provider.confirm(input);
  if (pay.approved) {
    RequestCtx.markPayment({ state: 'APPROVED', ...ref });
    return pay;
  }
  if (!pay.uncertain) {
    RequestCtx.markPayment({ state: 'DECLINED', ...ref });
    return pay;
  }

  const got = await provider.getPayment(input.paymentKey);
  if (got.found) {
    if (got.status === 'DONE' && Number(got.totalAmount) === input.amount && got.orderId === input.orderId) {
      RequestCtx.markPayment({ state: 'APPROVED', ...ref });
      return {
        approved: true, stub: got.stub, amount: input.amount, method: got.method, status: 'DONE',
        paymentKey: got.paymentKey ?? input.paymentKey, approvedAt: got.approvedAt,
        transactionKey: got.transactionKey, recovered: true,
      };
    }
    RequestCtx.markPayment({ state: 'DECLINED', ...ref });
    return {
      approved: false, stub: got.stub, status: got.status, code: 'PAYMENT_NOT_USABLE',
      detail: got.status === 'CANCELED'
        ? '취소된 결제입니다. 다시 결제해 주십시오.'
        : '이 요청에 쓸 수 없는 결제입니다(금액 · 주문번호 · 상태가 다릅니다).',
    };
  }
  if (got.notFound) {
    RequestCtx.markPayment({ state: 'DECLINED', ...ref });
    return { ...pay, uncertain: false };
  }
  /* 조회도 안 됨 — 승인됐을 수 있습니다. 실패로 단정하지 않습니다 */
  return { ...pay, uncertain: true, detail: pay.detail ?? '결제 결과를 확인하지 못했습니다' };
}
