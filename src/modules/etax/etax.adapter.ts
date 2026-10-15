import { IntegrationErrorKind } from '../../common/integration/errors';

/* ---------------------------------------------------------------------
 * v10.34 (D093 · 2026-10-11 대표 결정) — 국세청 전자세금계산서 전송: 연결 자리(어댑터)
 *
 * 업체(ASP · 예: 팝빌 · 바로빌)를 아직 정하지 않았습니다. 계약 · 공동인증서 · 키가 없습니다.
 * 그래서 **공급자 무관 인터페이스** 하나와 구현 두 개만 둡니다.
 *
 *   assume  간주 — 국세청에 보내지 않습니다. 승인번호를 지어내지 않고 「간주」 표시와 내부 문서 번호만 남깁니다.
 *   http    일반 HTTP — 환경 변수 ETAX_URL · ETAX_KEY 로 부릅니다(가짜 서버로 시험).
 *           **업체를 정하면 etax.http.ts 한 파일만 그 업체 형식으로 바꿉니다** — 서비스 · 화면 · DB 는 그대로.
 *
 * 고르는 규칙(EtaxService.adapter)
 *   설정 assume.etax = on  → assume (기본값 · 오픈 체크리스트 「간주 모드 켜짐」에 남음)
 *   off + ETAX_URL 있음    → http
 *   off + ETAX_URL 없음    → 422 ETAX_NOT_CONFIGURED (조용히 간주로 돌아가지 않습니다)
 *
 * 다시 보내도 같은 문서 번호(docKey)를 씁니다 — 업체가 같은 번호를 두 번 발행하지 않게.
 * 시간 초과처럼 결과를 모르는 실패 뒤에는 「다시 보내기」가 먼저 상태 조회(status)를 합니다 —
 * 업체 쪽에서는 이미 발행됐을 수 있기 때문입니다.
 * ------------------------------------------------------------------- */

export type EtaxStatus = 'ASSUMED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELED';
/** v10.44 — 공통 연동 오류 종류 그대로(common/integration/errors.ts) */
export type EtaxErrorKind = IntegrationErrorKind;

/** 세금계산서 한 장 — 공급자 = 소개뱅크(운영 법인) · 공급받는 자 = 업체 */
export interface EtaxDoc {
  /** 우리 쪽 문서 번호(업체 관리 번호) — 24자 이하 · 영문 숫자 - 만 */
  docKey: string;
  kind: 'DIRECTORY' | 'LEAD_CASH';
  /** 작성일자 YYYY-MM-DD (한국 시각 · 발행하는 날) */
  writeDate: string;
  supplier: { bizNo: string; name: string; ceoName?: string | null };
  buyer: { bizNo: string; name: string };
  supply: number;
  vat: number;
  total: number;
  /** 품목 한 줄 — 예: 「법률 · 세무 정액 노출료 2회차(2026-11-01 ~ 2026-12-31)」 */
  itemName: string;
}

export interface EtaxResult {
  status: EtaxStatus | 'NOT_FOUND';
  /** 국세청 승인번호 24자리(숫자만) — 간주 · 실패 · 승인 대기면 null */
  approvalNo: string | null;
  /** 취소 · 수정 발행 때 업체가 돌려준 수정세금계산서 승인번호 */
  amendApprovalNo?: string | null;
  errorKind?: EtaxErrorKind;
  /** 화면 · 기록용 짧은 사유 — 키 · 개인정보 없음 */
  error?: string;
  httpStatus?: number;
}

export interface EtaxAdapter {
  readonly name: 'assume' | 'http';
  /** 발행 요청 → (승인번호) */
  issue(doc: EtaxDoc): Promise<EtaxResult>;
  /** 상태 조회 — 업체에 그 문서 번호가 없으면 NOT_FOUND */
  status(docKey: string): Promise<EtaxResult>;
  /** 취소 · 수정 발행 — 국세청 전송 전이면 발행 취소, 전송 뒤면 수정세금계산서(업체 형식) */
  cancel(docKey: string, approvalNo: string | null, reason: string): Promise<EtaxResult>;
}

/** 국세청 승인번호 — 24자리 숫자(화면은 8-8-8). 하이픈 · 공백을 걷어 내고 형식이 맞을 때만 돌려줍니다 */
export const NTS_APPROVAL_RE = /^\d{24}$/;
export function normApproval(v: unknown): string | null {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  return NTS_APPROVAL_RE.test(d) ? d : null;
}
export function fmtApproval(v: string | null | undefined): string | null {
  if (!v || !NTS_APPROVAL_RE.test(v)) return v ?? null;
  return `${v.slice(0, 8)}-${v.slice(8, 16)}-${v.slice(16)}`;
}
