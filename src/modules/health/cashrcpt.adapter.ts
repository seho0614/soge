import { envInt, FetchLike, httpJson, HttpJsonResult } from '../../common/http-json';

/* ---------------------------------------------------------------------
 * v10.506 (D274 · docs/644) 현금영수증 발급 — 연결 자리(어댑터) · 전자세금계산서 어댑터(etax.adapter.ts)와 같은 모양
 *
 *   assume  간주 — 업체를 부르지 않습니다. 승인번호를 지어내지 않고 「간주 발급」 표시와 내부 문서 번호(CR0000000001)만 남깁니다.
 *   toss    토스페이먼츠 현금영수증 API — 이미 쓰는 결제 연동(PG · 키 TOSS_SECRET_KEY · 기준 주소 TOSS_API_BASE)을 그대로 씁니다.
 *           ★ 새 외부 연동 줄을 더하지 않습니다(registry · integrations · verify-invariants 연동 수 그대로 — NOTES 2-6).
 *
 * 고르는 규칙(health-cashrcpt.ts pickAdapter)
 *   mall.cash_receipt_mode = ASSUME(처음)    → assume
 *   LIVE + TOSS_SECRET_KEY 있음              → toss
 *   LIVE + 키 없음                           → NOT_READY(발급하지 않고 줄에 사유만 · 운영 알림 하루 한 번) — 조용히 간주로 돌아가지 않습니다
 *
 * ★ 요청 · 응답 모양(공개 문서 기준 · **계약 뒤 상점 관리자 · 개발 문서로 대조 필요** — docs/644 4절)
 *   발급  POST {BASE}/v1/cash-receipts            Authorization: Basic base64(secretKey:)
 *         본문 { amount, orderId, orderName, customerIdentityNumber, type: '소득공제' | '지출증빙', taxFreeAmount }
 *         200 { receiptKey, issueNumber, issueStatus: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED', ... }
 *   취소  POST {BASE}/v1/cash-receipts/{receiptKey}/cancel   본문 { amount? }   200 { issueStatus, transactionType: 'CANCEL' }
 *   결제창에서 이미 현금영수증을 받은 결제(계좌이체 · 가상계좌 결제창 「현금영수증 신청」)는 두 번 발급되지 않게 결제창 쪽 설정을 끄고 켭니다(docs/644 5절).
 * ------------------------------------------------------------------- */

export type CrStatus = 'ISSUED' | 'ASSUMED' | 'PENDING' | 'FAILED' | 'CANCELED';

export interface CrDoc {
  /** 우리 문서 번호 — CR + 10자리(업체 주문번호 칸 · 다시 보내도 같은 번호) */
  docKey: string;
  orderName: string;
  purpose: 'INCOME' | 'EXPENSE';
  /** 휴대폰 · 사업자번호 · 자진발급 번호(숫자만) — 화면 · 로그 · 응답에 싣지 않습니다 */
  identity: string;
  amount: number;
  taxFree: number;
}

export interface CrResult {
  status: CrStatus;
  /** 국세청 승인번호(업체가 준 발급 번호) — 간주 · 실패면 null */
  approvalNo: string | null;
  receiptKey: string | null;
  /** 화면 · 기록용 짧은 사유 — 키 · 번호 없음 */
  error?: string;
}

export interface CrAdapter {
  readonly name: 'assume' | 'toss';
  issue(doc: CrDoc): Promise<CrResult>;
  cancel(receiptKey: string | null, amount: number, reason: string): Promise<CrResult>;
}

export class AssumeCrAdapter implements CrAdapter {
  readonly name = 'assume' as const;
  async issue(_doc: CrDoc): Promise<CrResult> { return { status: 'ASSUMED', approvalNo: null, receiptKey: null }; }
  async cancel(): Promise<CrResult> { return { status: 'CANCELED', approvalNo: null, receiptKey: null }; }
}

const KIND_TEXT: Record<string, string> = {
  TIMEOUT: '현금영수증 업체 응답 시간 초과 — 업체 쪽에서는 발급됐을 수 있어 운영 확인이 필요합니다.',
  NETWORK: '현금영수증 업체에 연결하지 못했습니다(주소 · 발신 IP 확인).',
  AUTH: '현금영수증 업체 인증 실패 — 결제 연동 키(TOSS_SECRET_KEY)를 확인하십시오.',
  UPSTREAM: '현금영수증 업체 장애(5xx) — 다음 차례에 다시 보냅니다.',
  BAD_RESPONSE: '현금영수증 업체 응답 형식이 맞지 않습니다 — 어댑터(cashrcpt.adapter.ts) 확인이 필요합니다.',
  HTTP_4XX: '현금영수증 업체가 요청을 거절했습니다.',
};

export class TossCrAdapter implements CrAdapter {
  readonly name = 'toss' as const;
  constructor(
    private readonly secretKey: string,
    private readonly fetchFn?: FetchLike,
    private readonly timeoutMs = envInt('TOSS_TIMEOUT_MS', 10000),
    private readonly base = (process.env.TOSS_API_BASE || 'https://api.tosspayments.com').replace(/\/+$/, ''),
  ) {}

  private get headers() { return { Authorization: 'Basic ' + Buffer.from(`${this.secretKey}:`).toString('base64') }; }

  private fail(r: HttpJsonResult): CrResult {
    const base = KIND_TEXT[r.errorKind ?? 'BAD_RESPONSE'] ?? '현금영수증 업체 호출 실패';
    const vendor = r.body && (r.body.code || r.body.message) ? ` (업체: ${String(r.body.code ?? '')} ${String(r.body.message ?? '').slice(0, 100)})` : '';
    return { status: 'FAILED', approvalNo: null, receiptKey: null, error: (base + vendor).slice(0, 500) };
  }

  private read(body: any): CrResult {
    const st = String(body?.issueStatus ?? '').toUpperCase();
    const key = typeof body?.receiptKey === 'string' ? body.receiptKey.slice(0, 200) : null;
    const no = typeof body?.issueNumber === 'string' && /^[0-9A-Za-z-]{4,40}$/.test(body.issueNumber) ? body.issueNumber : null;
    if (st === 'COMPLETED') return no && key ? { status: 'ISSUED', approvalNo: no, receiptKey: key }
      : { status: 'FAILED', approvalNo: null, receiptKey: key, error: '업체가 「발급됨」이라 했지만 승인번호 · 영수증 키가 없습니다 — 어댑터 확인 필요' };
    /* 접수됨(처리 중) — 영수증 키가 있으면 발급으로 봄(다시 보내면 두 번 발급될 수 있어서) · 승인번호는 업체 화면에서 확인 */
    if (st === 'IN_PROGRESS' && key) return { status: 'ISSUED', approvalNo: no, receiptKey: key, error: '업체 처리 중으로 접수됨 — 승인번호는 업체 관리 화면에서 확인' };
    return { status: 'FAILED', approvalNo: null, receiptKey: key, error: `현금영수증 업체가 발급하지 못했습니다(${st || '상태 없음'})` };
  }

  async issue(doc: CrDoc): Promise<CrResult> {
    const r = await httpJson({
      url: `${this.base}/v1/cash-receipts`, method: 'POST', headers: this.headers, timeoutMs: this.timeoutMs, fetchFn: this.fetchFn,
      body: { amount: doc.amount, orderId: doc.docKey, orderName: doc.orderName.slice(0, 100), customerIdentityNumber: doc.identity,
              type: doc.purpose === 'EXPENSE' ? '지출증빙' : '소득공제', taxFreeAmount: doc.taxFree },
    });
    if (!r.ok) return this.fail(r);
    return this.read(r.body);
  }

  async cancel(receiptKey: string | null, amount: number, _reason: string): Promise<CrResult> {
    if (!receiptKey) return { status: 'FAILED', approvalNo: null, receiptKey: null, error: '영수증 키가 없어 업체에 취소를 보낼 수 없습니다 — 업체 관리 화면에서 취소한 뒤 운영이 닫으십시오.' };
    const r = await httpJson({ url: `${this.base}/v1/cash-receipts/${encodeURIComponent(receiptKey)}/cancel`, method: 'POST',
      headers: this.headers, timeoutMs: this.timeoutMs, fetchFn: this.fetchFn, body: { amount } });
    if (!r.ok) return this.fail(r);
    const st = String(r.body?.issueStatus ?? '').toUpperCase();
    const tt = String(r.body?.transactionType ?? '').toUpperCase();
    return st === 'COMPLETED' && tt === 'CANCEL' ? { status: 'CANCELED', approvalNo: null, receiptKey }
      : st === 'IN_PROGRESS' ? { status: 'PENDING', approvalNo: null, receiptKey }
      : { status: 'FAILED', approvalNo: null, receiptKey, error: '업체가 취소 결과를 돌려주지 않았습니다' };
  }
}
