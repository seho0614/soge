import { envInt, FetchLike, httpJson, HttpJsonResult } from '../../common/http-json';
import { EtaxAdapter, EtaxDoc, EtaxResult, normApproval } from './etax.adapter';

/* ---------------------------------------------------------------------
 * v10.34 (D093) 일반 HTTP 어댑터 — **업체를 정하면 이 파일 하나만 그 업체 형식으로 바꿉니다.**
 *
 * 아래 요청 · 응답 모양은 업체 형식이 아니라 **우리가 정한 중립 형식(자리표시)** 입니다.
 * 특정 업체 형식을 지어내지 않았습니다. 업체 문서를 받으면 issue · status · cancel 의 경로 · 본문 · 응답 읽기만 고칩니다.
 * 업체 형식에는 보통 업태 · 종목 · 주소 · 담당자 메일 같은 칸이 더 있습니다 — 그때 EtaxDoc 에 더하십시오.
 *
 * 환경 변수
 *   ETAX_URL         업체 기준 주소 (없으면 이 어댑터를 쓰지 않음 — 서비스가 422 ETAX_NOT_CONFIGURED)
 *   ETAX_KEY         인증 키 — **화면 · 응답 · 로그 · DB 에 싣지 않습니다**(integrations.secret_key_name 에 이름만)
 *   ETAX_TIMEOUT_MS  제한 시간(기본 10000)
 *
 * 중립 형식
 *   발행   POST {URL}/invoices                  Authorization: Bearer {KEY}
 *          본문 { docKey, writeDate, taxType:'TAX', purposeType:'RECEIPT', supplier{bizNo,name,ceoName}, buyer{bizNo,name},
 *                 supplyAmount, taxAmount, totalAmount, items:[{ name, supplyAmount, taxAmount }] }
 *          200 { result:'SENT', approvalNo:'24자리' } · 200 { result:'PENDING' }(접수 · 국세청 승인 대기)
 *          409 { code:'DUPLICATE' }(같은 docKey 가 이미 있음 → 상태 조회로 결과를 읽음) · 4xx { code, message }
 *   조회   GET  {URL}/invoices/{docKey}         200 { result, approvalNo } · 404(없음)
 *   취소   POST {URL}/invoices/{docKey}/cancel  본문 { reason, approvalNo } → 200 { result:'CANCELED', amendApprovalNo? }
 * ------------------------------------------------------------------- */

const KIND_TEXT: Record<string, string> = {
  TIMEOUT: '전자세금계산서 업체 응답 시간 초과 — 업체 쪽에서는 발행됐을 수 있습니다. 「다시 보내기」는 먼저 상태를 조회합니다.',
  NETWORK: '전자세금계산서 업체에 연결하지 못했습니다(주소 · 발신 IP 확인).',
  AUTH: '전자세금계산서 업체 인증 실패 — 키(ETAX_KEY) · 발신 IP 등록을 확인하십시오.',
  UPSTREAM: '전자세금계산서 업체 장애(5xx) — 잠시 뒤 다시 보내십시오.',
  BAD_RESPONSE: '전자세금계산서 업체 응답 형식이 맞지 않습니다 — 어댑터(etax.http.ts) 확인이 필요합니다.',
  HTTP_4XX: '전자세금계산서 업체가 요청을 거절했습니다.',
};

export class HttpEtaxAdapter implements EtaxAdapter {
  readonly name = 'http' as const;
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchFn?: FetchLike,
    private readonly timeoutMs = envInt('ETAX_TIMEOUT_MS', 10000),
  ) {}

  private get headers() { return { Authorization: `Bearer ${this.key}` }; }
  private base() { return this.url.replace(/\/+$/, ''); }

  /** 실패를 사유 한 줄로 — 업체 문구는 100자까지만, 키는 절대 싣지 않음 */
  private fail(r: HttpJsonResult): EtaxResult {
    const base = KIND_TEXT[r.errorKind ?? 'BAD_RESPONSE'] ?? '전송 실패';
    const vendor = r.body && (r.body.message || r.body.code) ? ` (업체: ${String(r.body.code ?? '')} ${String(r.body.message ?? '').slice(0, 100)})`.replace(/\s+\)/, ')') : '';
    return { status: 'FAILED', approvalNo: null, errorKind: r.errorKind, error: base + vendor, httpStatus: r.status || undefined };
  }

  /** 업체 응답 → 결과. SENT 인데 승인번호 형식이 아니면 받아들이지 않습니다(지어낸 번호 · 잘못 읽은 칸) */
  private read(body: any, httpStatus: number): EtaxResult {
    const res = String(body?.result ?? '').toUpperCase();
    if (res === 'SENT') {
      const no = normApproval(body?.approvalNo);
      if (!no) return { status: 'FAILED', approvalNo: null, errorKind: 'BAD_RESPONSE', httpStatus,
        error: '업체가 「발행됨」이라 했지만 국세청 승인번호(24자리) 형식이 아닙니다 — 어댑터 · 업체 확인 필요' };
      return { status: 'SENT', approvalNo: no, httpStatus };
    }
    if (res === 'PENDING') return { status: 'SENDING', approvalNo: null, httpStatus };
    if (res === 'CANCELED') return { status: 'CANCELED', approvalNo: normApproval(body?.approvalNo), amendApprovalNo: normApproval(body?.amendApprovalNo), httpStatus };
    if (res === 'FAILED') return { status: 'FAILED', approvalNo: null, errorKind: 'REJECTED', httpStatus,
      error: `전자세금계산서 업체가 발행하지 못했습니다${body?.message ? ` (업체: ${String(body.message).slice(0, 100)})` : ''}` };
    return { status: 'FAILED', approvalNo: null, errorKind: 'BAD_RESPONSE', httpStatus, error: KIND_TEXT.BAD_RESPONSE };
  }

  async issue(doc: EtaxDoc): Promise<EtaxResult> {
    const r = await httpJson({
      url: `${this.base()}/invoices`, method: 'POST', headers: this.headers, timeoutMs: this.timeoutMs, fetchFn: this.fetchFn,
      body: {
        docKey: doc.docKey, writeDate: doc.writeDate, taxType: 'TAX', purposeType: 'RECEIPT',
        supplier: { bizNo: doc.supplier.bizNo.replace(/\D/g, ''), name: doc.supplier.name, ceoName: doc.supplier.ceoName ?? null },
        buyer: { bizNo: doc.buyer.bizNo.replace(/\D/g, ''), name: doc.buyer.name },
        supplyAmount: doc.supply, taxAmount: doc.vat, totalAmount: doc.total,
        items: [{ name: doc.itemName, supplyAmount: doc.supply, taxAmount: doc.vat }],
      },
    });
    /* 같은 문서 번호가 이미 업체에 있음 — 두 번 발행하지 않고 그 문서의 상태를 읽습니다 */
    if (!r.ok && r.status === 409) return this.status(doc.docKey);
    if (!r.ok) return this.fail(r);
    return this.read(r.body, r.status);
  }

  async status(docKey: string): Promise<EtaxResult> {
    const r = await httpJson({ url: `${this.base()}/invoices/${encodeURIComponent(docKey)}`, method: 'GET',
      headers: this.headers, timeoutMs: this.timeoutMs, fetchFn: this.fetchFn });
    if (!r.ok && r.status === 404) return { status: 'NOT_FOUND', approvalNo: null, httpStatus: 404 };
    if (!r.ok) return this.fail(r);
    return this.read(r.body, r.status);
  }

  async cancel(docKey: string, approvalNo: string | null, reason: string): Promise<EtaxResult> {
    const r = await httpJson({ url: `${this.base()}/invoices/${encodeURIComponent(docKey)}/cancel`, method: 'POST',
      headers: this.headers, timeoutMs: this.timeoutMs, fetchFn: this.fetchFn, body: { reason, approvalNo } });
    if (!r.ok) return this.fail(r);
    const out = this.read(r.body, r.status);
    return out.status === 'CANCELED' ? out
      : { status: 'FAILED', approvalNo: null, errorKind: 'BAD_RESPONSE', httpStatus: r.status, error: '업체가 취소 결과를 돌려주지 않았습니다' };
  }
}
