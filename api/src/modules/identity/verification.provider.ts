import { sgb, sgbOk } from '../../core/sgb-client';

/* e3.5 (docs/011) 사업자 휴폐업 조회 — 소개뱅크 identity/verification.provider 의 resolveBizStatusProvider 와 같은 모양
 *   국세청 키 · 간주(stub) 판단은 소개뱅크 한 곳 → POST /internal/erp/biz-status */
export interface BizStatusResult { status: 'VALID' | 'SUSPENDED' | 'CLOSED' | 'UNKNOWN' | string; stub?: boolean; detail?: string }
export function resolveBizStatusProvider() {
  return { async check(bizRegNo: string): Promise<BizStatusResult> { return sgbOk<BizStatusResult>(await sgb.post('/internal/erp/biz-status', { bizRegNo })); } };
}
