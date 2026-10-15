/* ---------------------------------------------------------------------
 * 결제 (토스페이먼츠)
 *
 * 구독료가 유일한 매출원이 되면서 이 경로가 매출의 전부입니다.
 *
 * 이전에는 어댑터가 아예 없었습니다. billing.service 가 클라이언트에서
 * 받은 paymentKey 를 그대로 원장에 적었고, 실제로 결제됐는지는
 * 아무도 확인하지 않았습니다. 임의 문자열로 유료 구독이 열렸습니다.
 *
 * ── INV-11 ─────────────────────────────────────────────────────────
 * 이 어댑터는 **구독료와 초과 코드 요금만** 태웁니다.
 * 소개비는 절대 태우지 않습니다 — 플랫폼이 남의 돈을 받았다가 보내주는
 * 구조가 되어 자금 수탁이 되고, 전자금융거래법 검토 대상이 됩니다.
 * confirm() 이 orderName 을 검사하는 이유가 그것입니다.
 * ------------------------------------------------------------------- */

export interface PaymentResult {
  /** 결제가 실제로 승인되었는가 */
  approved: boolean;
  stub: boolean;
  /** 토스가 확인해 준 실제 결제 금액. 요청 금액과 다르면 승인하면 안 됩니다 */
  amount?: number;
  method?: string;
  /** 실패 사유. 화면에 그대로 보여주면 이용자가 이유를 압니다 */
  detail?: string;
  /* ── D006 (소개몰 결제 실연동) — 있으면 채웁니다. 구독 경로는 approved 만 봅니다 ── */
  /** PG 상태 원문 — DONE · WAITING_FOR_DEPOSIT · CANCELED … */
  status?: string;
  /** 가상계좌처럼 **아직 돈이 들어오지 않은** 정상 응답. approved 는 false 입니다 */
  pending?: boolean;
  paymentKey?: string;
  approvedAt?: string;
  /** 마지막 거래 키(lastTransactionKey) */
  transactionKey?: string;
  virtualAccount?: VirtualAccount;
  /** 가상계좌 입금 알림(DEPOSIT_CALLBACK) 대조값. 화면으로 내보내지 않습니다 */
  secret?: string;
  /** PG 오류 코드 (예: ALREADY_PROCESSED_PAYMENT) */
  code?: string;
  /**
   * D022 — **결과를 알 수 없음.** 요청은 보냈는데 답을 받지 못했거나(응답 지연 · 연결 끊김), 결제사 쪽 오류(5xx)입니다.
   * approved:false 이지만 「거절」이 아닙니다 — **승인됐을 수도 있습니다.** 실패로 적거나 새 결제를 보내면 안 되고,
   * 주문번호 · 결제 키로 조회해 확인해야 합니다.
   */
  uncertain?: boolean;
}

/** 가상계좌 안내 — 토스 Payment.virtualAccount 중 화면에 필요한 것만 */
export interface VirtualAccount {
  bankCode?: string;
  accountNumber?: string;
  customerName?: string;
  dueDate?: string;
}

/** 결제 조회(GET /v1/payments/{paymentKey}) 결과 — 웹훅은 본문 대신 이것을 믿습니다 */
export interface PaymentLookup {
  found: boolean;
  stub: boolean;
  status?: string;
  paymentKey?: string;
  orderId?: string;
  totalAmount?: number;
  balanceAmount?: number;
  method?: string;
  approvedAt?: string;
  transactionKey?: string;
  virtualAccount?: VirtualAccount;
  secret?: string;
  detail?: string;
  code?: string;
  /** D022 — 결제사가 「그런 결제가 없다」고 **답한** 것(404 NOT_FOUND_PAYMENT). 조회 자체가 실패한 것(found:false · notFound 없음)과 다릅니다 */
  notFound?: boolean;
}

/** 결제 취소(환불) 결과 */
export interface CancelResult {
  ok: boolean;
  stub: boolean;
  status?: string;
  /** 이번에 취소된 금액 */
  canceledAmount?: number;
  canceledAt?: string;
  transactionKey?: string;
  detail?: string;
  code?: string;
  /** D022 — 결과를 알 수 없음(응답 지연 · 연결 끊김 · 5xx · 같은 멱등 요청이 처리 중). **취소됐을 수도 있습니다** — 조회로 확인해야 합니다 */
  uncertain?: boolean;
}

/** 가상계좌로 입금된 결제를 환불할 때 돌려받을 계좌 — 저장하지 않고 PG 로만 넘깁니다 */
export interface RefundReceiveAccount {
  bank: string;
  accountNumber: string;
  holderName: string;
}

export interface CancelInput {
  paymentKey: string;
  cancelReason: string;
  /** 없으면 전액 취소 */
  cancelAmount?: number;
  /** 같은 키로 다시 보내면 PG 가 한 번만 취소합니다 (재시도 안전) */
  idempotencyKey?: string;
  refundReceiveAccount?: RefundReceiveAccount;
}

export interface BillingKeyResult {
  approved: boolean;
  stub: boolean;
  billingKey?: string;
  cardCompany?: string;
  cardLast4?: string;
  detail?: string;
}

export abstract class PaymentProvider {
  abstract confirm(input: {
    paymentKey: string;
    orderId: string;
    amount: number;
    orderName: string;
    /** 우리 쪽 결제 수단(CARD·TRANSFER·VBANK). 토스는 보내지 않습니다 — 스텁이 가상계좌를 흉내 낼 때만 씁니다 */
    method?: string;
  }): Promise<PaymentResult>;

  /** 결제창이 돌려준 authKey 로 빌링키를 발급받습니다. 카드번호는 다루지 않습니다. */
  abstract issueBillingKey(input: {
    authKey: string; customerKey: string;
  }): Promise<BillingKeyResult>;

  /**
   * 빌링키로 청구합니다. 정기결제의 본체입니다.
   * D022 — idempotencyKey: 같은 키로 다시 보내면 결제사가 한 번만 청구합니다(토스: 모든 POST · 15일).
   *        결과를 알 수 없으면 uncertain:true — 주문번호(orderId)로 조회해 확인합니다.
   */
  abstract chargeWithBillingKey(input: {
    billingKey: string; customerKey: string;
    orderId: string; amount: number; orderName: string;
    idempotencyKey?: string;
  }): Promise<PaymentResult>;

  /** 결제 조회 — 웹훅 본문을 믿지 않고 PG 에 다시 묻습니다 (D006) */
  abstract getPayment(paymentKey: string): Promise<PaymentLookup>;

  /** 주문번호(orderId)로 결제 조회 — paymentKey 가 없는 입금 알림용 (D006) */
  abstract getPaymentByOrderId(orderId: string): Promise<PaymentLookup>;

  /** 결제 취소 = 환불. cancelAmount 가 없으면 전액입니다 (D006) */
  abstract cancel(input: CancelInput): Promise<CancelResult>;
}

/**
 * 계약 전까지 쓰는 스텁. stub:true 를 반드시 화면에 표시하십시오.
 *
 * D006 — 소개몰 가상계좌 흐름을 키 없이 시험할 수 있게 승인한 결제를 프로세스 안에
 * 기억합니다. method 가 VBANK 면 승인 응답이 WAITING_FOR_DEPOSIT(시험 계좌)이고,
 * 그 결제를 **조회하면 입금된 것(DONE)으로** 돌려줍니다 — 웹훅 → 재조회 → 반영 경로를 그대로 탑니다.
 * 서버를 다시 띄우면 잊습니다(그때 조회는 found:false).
 */
export class StubPaymentProvider extends PaymentProvider {
  private static readonly seen = new Map<string, { orderId: string; amount: number; vbank: boolean; canceled: number }>();

  async confirm(input: { amount: number; paymentKey?: string; orderId?: string; method?: string }): Promise<PaymentResult> {
    const vbank = input.method === 'VBANK';
    if (input.paymentKey) {
      StubPaymentProvider.seen.set(input.paymentKey,
        { orderId: input.orderId ?? '', amount: input.amount, vbank, canceled: 0 });
    }
    if (vbank) {
      return { approved: false, pending: true, stub: true, amount: input.amount, method: 'VBANK',
        status: 'WAITING_FOR_DEPOSIT', paymentKey: input.paymentKey,
        virtualAccount: { bankCode: 'STUB', accountNumber: '000-0000-0000-00', customerName: '시험 계좌',
          dueDate: new Date(Date.now() + 3 * 86400_000).toISOString() } };
    }
    return { approved: true, stub: true, amount: input.amount, method: 'STUB',
      status: 'DONE', paymentKey: input.paymentKey, approvedAt: new Date().toISOString() };
  }

  async getPayment(paymentKey: string): Promise<PaymentLookup> {
    const p = StubPaymentProvider.seen.get(paymentKey);
    if (!p) return { found: false, notFound: true, stub: true, detail: '스텁이 기억하는 결제가 아닙니다' };
    return { found: true, stub: true, paymentKey, orderId: p.orderId,
      status: p.canceled ? (p.canceled >= p.amount ? 'CANCELED' : 'PARTIAL_CANCELED') : 'DONE',
      totalAmount: p.amount, balanceAmount: p.amount - p.canceled,
      method: p.vbank ? '가상계좌' : '카드', approvedAt: new Date().toISOString() };
  }

  async getPaymentByOrderId(orderId: string): Promise<PaymentLookup> {
    for (const [k, v] of StubPaymentProvider.seen) if (v.orderId === orderId) return this.getPayment(k);
    return { found: false, notFound: true, stub: true, detail: '스텁이 기억하는 결제가 아닙니다' };
  }

  async cancel(input: CancelInput): Promise<CancelResult> {
    const p = StubPaymentProvider.seen.get(input.paymentKey);
    const amount = input.cancelAmount ?? (p ? p.amount - p.canceled : undefined);
    if (p && amount != null) p.canceled += amount;
    return { ok: true, stub: true, status: 'CANCELED', canceledAmount: amount,
      canceledAt: new Date().toISOString() };
  }
  async issueBillingKey(): Promise<BillingKeyResult> {
    return { approved: true, stub: true, billingKey: 'stub-billing-key',
             cardCompany: '스텁카드', cardLast4: '0000' };
  }
  /** D022 — 청구한 것을 기억합니다(주문번호로 조회 · 환불 흐름을 열쇠 없이 시험). 결제 키는 stub_bill_<주문번호> */
  async chargeWithBillingKey(input: { amount: number; orderId?: string }): Promise<PaymentResult> {
    const paymentKey = `stub_bill_${input.orderId ?? Date.now()}`;
    StubPaymentProvider.seen.set(paymentKey, { orderId: input.orderId ?? '', amount: input.amount, vbank: false, canceled: 0 });
    return { approved: true, stub: true, amount: input.amount, method: 'STUB', status: 'DONE', paymentKey,
      approvedAt: new Date().toISOString() };
  }
}

/** 기준 주소 — TOSS_API_BASE 로 바꿀 수 있습니다(로컬 가짜 서버로 어댑터를 실제 HTTP 로 시험). */
const TOSS_BASE_DEFAULT = 'https://api.tosspayments.com';

type FetchLike = (url: string, init?: any) => Promise<any>;

export class TossPaymentProvider extends PaymentProvider {
  constructor(
    private readonly secretKey: string,
    private readonly http: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 10000,
    private readonly base = (process.env.TOSS_API_BASE || TOSS_BASE_DEFAULT).replace(/\/+$/, ''),
  ) { super(); }

  async confirm(input: {
    paymentKey: string; orderId: string; amount: number; orderName: string;
  }): Promise<PaymentResult> {

    // INV-11. 소개비를 결제로 태우려는 시도는 여기서 끊습니다.
    if (/소개비|referral|중개비|수수료 대납/i.test(input.orderName)) {
      return { approved: false, stub: false,
        detail: 'INV-11: 소개비는 결제로 처리하지 않습니다. 당사자 간 직접 지급입니다' };
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      return { approved: false, stub: false, detail: '결제 금액이 올바르지 않습니다' };
    }

    // 시크릿 키는 Basic 인증으로만 갑니다. URL 이나 본문에 넣지 않습니다.
    const auth = Buffer.from(`${this.secretKey}:`).toString('base64');

    let body: any;
    try {
      const res = await this.http(`${this.base}/v1/payments/confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paymentKey: input.paymentKey,
          orderId: input.orderId,
          amount: input.amount,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 토스 장애를 결제 성공으로 바꾸지 않습니다.
        // 여기서 approved:true 를 내면 돈을 안 받고 구독을 열어 줍니다.
        // D022 — 그렇다고 「거절」로 단정하지도 않습니다: 5xx 등은 승인됐을 수도 있습니다(uncertain).
        return { approved: false, stub: false, code: body?.code, uncertain: uncertainHttp(res.status, body?.code),
          detail: body?.message || `결제 승인 실패(HTTP ${res.status})` };
      }
    } catch (e: any) {
      const msg = e?.name === 'TimeoutError' ? '결제 응답 지연' : '결제 서버 연결 실패';
      return { approved: false, stub: false, uncertain: true, detail: msg };
    }

    /* D006 — 가상계좌는 승인 응답이 "입금 대기" 입니다. 승인이 아니지만(approved:false)
     * 실패도 아닙니다(pending:true). 금액이 맞을 때만 대기로 인정합니다. */
    if (body?.status === 'WAITING_FOR_DEPOSIT') {
      if (Number(body.totalAmount) !== input.amount) {
        return { approved: false, stub: false, status: body.status,
          detail: `결제 금액 불일치(요청 ${input.amount} · 실제 ${body.totalAmount})` };
      }
      return { approved: false, pending: true, stub: false, status: body.status,
        amount: Number(body.totalAmount), method: body.method ?? undefined,
        paymentKey: body.paymentKey ?? input.paymentKey,
        transactionKey: body.lastTransactionKey ?? undefined,
        virtualAccount: pickVbank(body.virtualAccount), secret: body.secret ?? undefined,
        detail: '입금 대기' };
    }

    if (body?.status !== 'DONE') {
      return { approved: false, stub: false, status: body?.status,
        detail: `결제 상태 ${body?.status ?? '알 수 없음'}` };
    }

    // 토스가 확인해 준 금액과 우리가 청구하려던 금액이 같아야 합니다.
    // 다르면 클라이언트가 금액을 조작한 것입니다.
    if (Number(body.totalAmount) !== input.amount) {
      return { approved: false, stub: false,
        detail: `결제 금액 불일치(요청 ${input.amount} · 실제 ${body.totalAmount})` };
    }

    return {
      approved: true,
      stub: false,
      amount: Number(body.totalAmount),
      method: body.method ?? undefined,
      status: 'DONE',
      paymentKey: body.paymentKey ?? input.paymentKey,
      approvedAt: body.approvedAt ?? undefined,
      transactionKey: body.lastTransactionKey ?? undefined,
    };
  }

  /* ── D006 조회 · 취소 ─────────────────────────────────────────── */

  private async lookup(url: string): Promise<PaymentLookup> {
    let res: any; let body: any;
    try {
      res = await this.http(url, {
        method: 'GET',
        headers: { Authorization: this.auth() },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await res.json().catch(() => ({}));
    } catch (e: any) {
      return { found: false, stub: false,
        detail: e?.name === 'TimeoutError' ? '결제 응답 지연' : '결제 서버 연결 실패' };
    }
    if (!res.ok) {
      /* D022 — 「없다」는 답(404 NOT_FOUND_PAYMENT)과 「조회가 안 됐다」(그 밖)를 가릅니다.
       * 없다는 답만 「그 결제는 일어나지 않았다」의 근거가 됩니다. */
      const notFound = res.status === 404 && (!body?.code || body.code === 'NOT_FOUND_PAYMENT');
      return { found: false, stub: false, code: body?.code, ...(notFound ? { notFound: true } : {}),
        detail: body?.message || `결제 조회 실패(HTTP ${res.status})` };
    }
    if (!body?.paymentKey || !body?.status) {
      return { found: false, stub: false, detail: '결제 조회 응답 형식이 다릅니다' };
    }
    return {
      found: true, stub: false,
      status: body.status, paymentKey: body.paymentKey, orderId: body.orderId,
      totalAmount: body.totalAmount != null ? Number(body.totalAmount) : undefined,
      balanceAmount: body.balanceAmount != null ? Number(body.balanceAmount) : undefined,
      method: body.method ?? undefined, approvedAt: body.approvedAt ?? undefined,
      transactionKey: body.lastTransactionKey ?? undefined,
      virtualAccount: pickVbank(body.virtualAccount), secret: body.secret ?? undefined,
    };
  }

  /** GET /v1/payments/{paymentKey} */
  getPayment(paymentKey: string): Promise<PaymentLookup> {
    return this.lookup(`${this.base}/v1/payments/${encodeURIComponent(paymentKey)}`);
  }

  /** GET /v1/payments/orders/{orderId} */
  getPaymentByOrderId(orderId: string): Promise<PaymentLookup> {
    return this.lookup(`${this.base}/v1/payments/orders/${encodeURIComponent(orderId)}`);
  }

  /**
   * POST /v1/payments/{paymentKey}/cancel  { cancelReason, cancelAmount?, refundReceiveAccount? }
   * Idempotency-Key 헤더를 붙이면 같은 요청이 두 번 가도 한 번만 취소됩니다.
   */
  async cancel(input: CancelInput): Promise<CancelResult> {
    if (input.cancelAmount != null && (!Number.isInteger(input.cancelAmount) || input.cancelAmount <= 0)) {
      return { ok: false, stub: false, detail: '환불 금액이 올바르지 않습니다' };
    }
    const headers: Record<string, string> = {
      Authorization: this.auth(), 'Content-Type': 'application/json',
    };
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
    const payload: any = { cancelReason: input.cancelReason };
    if (input.cancelAmount != null) payload.cancelAmount = input.cancelAmount;
    if (input.refundReceiveAccount) payload.refundReceiveAccount = input.refundReceiveAccount;

    let body: any;
    try {
      const res = await this.http(`${this.base}/v1/payments/${encodeURIComponent(input.paymentKey)}/cancel`, {
        method: 'POST', headers, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok) {
        /* 환불 실패를 성공으로 바꾸지 않습니다 — 고객 돈이 안 돌아갔는데 "환불 완료" 가 됩니다 */
        return { ok: false, stub: false, code: body?.code, uncertain: uncertainHttp(res.status, body?.code),
          detail: body?.message || `결제 취소 실패(HTTP ${res.status})` };
      }
    } catch (e: any) {
      return { ok: false, stub: false, uncertain: true,
        detail: e?.name === 'TimeoutError' ? '결제 응답 지연' : '결제 서버 연결 실패' };
    }

    if (body?.status !== 'CANCELED' && body?.status !== 'PARTIAL_CANCELED') {
      /* D022 — 200 인데 취소 상태가 아님. 거절로 단정하지 않습니다(조회로 확인) */
      return { ok: false, stub: false, status: body?.status, uncertain: true,
        detail: `결제 취소 상태 ${body?.status ?? '알 수 없음'}` };
    }
    const cancels: any[] = Array.isArray(body.cancels) ? body.cancels : [];
    const last = cancels[cancels.length - 1];
    const canceledAmount = last?.cancelAmount != null ? Number(last.cancelAmount) : undefined;
    /* 부분 취소를 요청했으면 그 금액이 취소됐는지 대조합니다 */
    if (input.cancelAmount != null && canceledAmount !== input.cancelAmount) {
      /* D022 — 취소는 일어났는데 금액이 다릅니다. 돈이 움직였으므로 「거절」이 아닙니다(조회로 확인 · 사람이 봐야 합니다) */
      return { ok: false, stub: false, status: body.status, uncertain: true, code: 'AMOUNT_MISMATCH',
        detail: `환불 금액 불일치(요청 ${input.cancelAmount} · 실제 ${canceledAmount ?? '없음'})` };
    }
    return { ok: true, stub: false, status: body.status, canceledAmount,
      canceledAt: last?.canceledAt ?? undefined,
      transactionKey: last?.transactionKey ?? body.lastTransactionKey ?? undefined };
  }

  private auth() {
    return 'Basic ' + Buffer.from(`${this.secretKey}:`).toString('base64');
  }

  async issueBillingKey(input: { authKey: string; customerKey: string }): Promise<BillingKeyResult> {
    let body: any;
    try {
      const res = await this.http(`${this.base}/v1/billing/authorizations/issue`, {
        method: 'POST',
        headers: { Authorization: this.auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey: input.authKey, customerKey: input.customerKey }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { approved: false, stub: false,
          detail: body?.message || `빌링키 발급 실패(HTTP ${res.status})` };
      }
    } catch (e: any) {
      return { approved: false, stub: false,
        detail: e?.name === 'TimeoutError' ? '결제 응답 지연' : '결제 서버 연결 실패' };
    }

    if (!body?.billingKey) {
      return { approved: false, stub: false, detail: '빌링키가 응답에 없습니다' };
    }
    return {
      approved: true, stub: false,
      billingKey: body.billingKey,
      cardCompany: body.card?.company ?? body.cardCompany,
      // 마지막 4자리만 남깁니다. 화면 표시 외에는 쓰지 않습니다.
      cardLast4: (body.card?.number ?? '').replace(/\D/g, '').slice(-4) || undefined,
    };
  }

  async chargeWithBillingKey(input: {
    billingKey: string; customerKey: string;
    orderId: string; amount: number; orderName: string;
    idempotencyKey?: string;
  }): Promise<PaymentResult> {

    // 단건 승인과 같은 문을 지납니다. 소개비는 정기결제로도 태우지 않습니다.
    if (/소개비|referral|중개비/i.test(input.orderName)) {
      return { approved: false, stub: false,
        detail: 'INV-11: 소개비는 결제로 처리하지 않습니다. 당사자 간 직접 지급입니다' };
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      return { approved: false, stub: false, detail: '청구 금액이 올바르지 않습니다' };
    }

    let body: any;
    try {
      const headers: Record<string, string> = { Authorization: this.auth(), 'Content-Type': 'application/json' };
      /* D022 — 같은 청구를 다시 보내도 결제사가 한 번만 처리하게 합니다(응답을 못 받고 다시 보내는 경우) */
      if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
      const res = await this.http(`${this.base}/v1/billing/${encodeURIComponent(input.billingKey)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customerKey: input.customerKey,
          orderId: input.orderId,
          amount: input.amount,
          orderName: input.orderName,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok) {
        /* D022 — 4xx 거절(카드 한도 · 만료 …)은 확정입니다. 5xx · 「이미 처리된 주문」 · 「처리 중」은 승인됐을 수 있습니다 */
        return { approved: false, stub: false, code: body?.code, uncertain: uncertainHttp(res.status, body?.code),
          detail: body?.message || `정기결제 실패(HTTP ${res.status})` };
      }
    } catch (e: any) {
      /* D022 — 응답을 못 받은 것은 「실패」가 아닙니다. 결제사는 승인했을 수 있습니다 */
      return { approved: false, stub: false, uncertain: true,
        detail: e?.name === 'TimeoutError' ? '결제 응답 지연' : '결제 서버 연결 실패' };
    }

    if (body?.status !== 'DONE') {
      /* 200 인데 끝난 상태가 아님 — 거절로 단정하지 않습니다(조회로 확인) */
      return { approved: false, stub: false, uncertain: true, status: body?.status, paymentKey: body?.paymentKey ?? undefined,
        detail: `결제 상태 ${body?.status ?? '알 수 없음'}` };
    }
    if (Number(body.totalAmount) !== input.amount) {
      /* 승인은 됐는데 금액이 다릅니다 — 돈이 움직였으므로 거절이 아닙니다. 완료로도 적지 않습니다(사람이 봐야 합니다) */
      return { approved: false, stub: false, uncertain: true, code: 'AMOUNT_MISMATCH', status: body.status,
        paymentKey: body.paymentKey ?? undefined, amount: Number(body.totalAmount),
        detail: `청구 금액 불일치(요청 ${input.amount} · 실제 ${body.totalAmount})` };
    }
    return { approved: true, stub: false, status: 'DONE',
      amount: Number(body.totalAmount), method: body.method ?? undefined,
      paymentKey: body.paymentKey ?? undefined, approvedAt: body.approvedAt ?? undefined,
      transactionKey: body.lastTransactionKey ?? undefined };
  }
}

/* ---------------------------------------------------------------------
 * 정기결제 (빌링키)
 *
 * 단건 승인만으로는 둘째 달부터 청구가 되지 않습니다.
 * 구독료가 매출의 전부이므로 이 경로가 없으면 매출이 한 달 뒤 멈춥니다.
 *
 * 흐름
 *   1) 결제창에서 카드 등록 → authKey
 *   2) authKey + customerKey → billingKey 발급 (여기)
 *   3) 매월 billingKey 로 청구 (배치)
 *
 * 카드번호는 우리 서버에 들어오지 않습니다. 토스 결제창이 직접 받습니다.
 * ------------------------------------------------------------------- */
/* 빌링 주소도 기준 주소(TOSS_API_BASE) 아래입니다: /v1/billing/authorizations/issue · /v1/billing/{billingKey} */

/**
 * D022 — 실패 응답을 「확정」과 「결과 불명확」으로 가릅니다.
 *
 *   확정(false)    결제사가 요청을 받아 **처리하지 않겠다**고 답한 것 — 4xx 거절(카드 한도 · 만료 · 취소 불가 …)
 *   불명확(true)   5xx(결제사 내부 오류 — 처리됐는지 모름) · 408/429 · 「같은 멱등 요청이 처리 중」 ·
 *                  「이미 처리된 결제 / 중복된 주문번호」(앞서 보낸 요청이 처리됐다는 뜻) · 「일시적인 오류」
 * 토스 문서(코어 API 에러 코드 · 멱등키)의 코드 이름입니다.
 */
function uncertainHttp(status: number, code?: string): boolean {
  if (status >= 500 || status === 408 || status === 429) return true;
  return ['IDEMPOTENT_REQUEST_PROCESSING', 'ALREADY_PROCESSED_PAYMENT', 'DUPLICATED_ORDER_ID', 'PROVIDER_ERROR',
    'FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING', 'FAILED_INTERNAL_SYSTEM_PROCESSING', 'UNKNOWN_PAYMENT_ERROR',
    'ALREADY_CANCELED_PAYMENT'].includes(code ?? '');
}

/** 토스 virtualAccount 중 안내에 필요한 것만 남깁니다 (환불 계좌 · 은행 원문은 버립니다) */
function pickVbank(v: any): VirtualAccount | undefined {
  if (!v || typeof v !== 'object') return undefined;
  return { bankCode: v.bankCode ?? v.bank ?? undefined, accountNumber: v.accountNumber ?? undefined,
    customerName: v.customerName ?? undefined, dueDate: v.dueDate ?? undefined };
}

export function resolvePaymentProvider(): PaymentProvider {
  const key = process.env.TOSS_SECRET_KEY;
  return key ? new TossPaymentProvider(key) : new StubPaymentProvider();
}
