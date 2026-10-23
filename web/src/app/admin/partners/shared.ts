import { n } from '../../../lib/act';
import { ymdKst } from '../../../lib/format';

/** v10.38 (D096 · P2P) — 개인 파트너(개인 활동 정보)는 사업자등록번호가 없습니다 */
export const bizNo = (v?: string | null) => (v ? `사업자 ${v}` : '개인(본인인증)');

export interface Partner {
  id: string; company: string; bizRegNo: string | null;
  grade: string; status: string;
  services: number | string; unpaid: number | string; unpaidCap: number | string;
  appliedAt?: string; bizVerified?: boolean; personal?: boolean; actorOk?: boolean; rejectReason?: string | null;
}

export interface PendingService {
  id: string; title: string; body: string | null; submittedAt: string;
  partnerId: string; partnerStatus: string; grade: string; company: string; bizRegNo: string | null;
  categoryName: string | null; gwanCode: string | null; restrictedCode: string | null;
  leadFee: string | null; qualCode: string | null; qualState: string | null;
  rejectedBefore: number; approvedBefore: number;
}

export interface VoidRequest {
  id: number; feeId: number; state: string; reasonCode: string; reason: string; evidence: string | null;
  requestedAt: string; ruleCode: string | null; decisionReason: string | null; decidedAt: string | null;
  decidedBy: string | null; amount: string; feeState: string; deliveredAt: string; viewedAt: string | null;
  summary: string; sido: string | null; sigungu: string | null; categoryName: string | null;
  partnerId: string; company: string; grade: string; monthReceived: number; monthRequested: number;
}

export interface VoidList { items: VoidRequest[]; rules: Array<{ code: string; name: string }> }

export type View = 'list' | 'apply' | 'services' | 'leads' | 'rejects' | 'wallet' | 'detail';

/* v10.31 (10/10 시안 기준) — 시안 하위 탭 줄 그대로(파트너사 목록 · 입점 신청 · 서비스 검수 · 의료 심의 · 리드 반려 · 리드 배정 · 카테고리 마스터 · 자격 심사 · 리드 이용료 · 정산).
 * 의료 심의 · 카테고리 마스터 · 자격 심사는 같은 API 를 쓰는 「인증 심사 › 자격 심사」 화면에 있어 그 하위 탭으로 바로 보냅니다(두 곳에 두지 않음). */
export type Tab2 = View | 'medical' | 'cats' | 'quals';

/* v10.32 — GET /admin/partners/cards (시안 카드 줄의 칸) · GET /admin/partners/:id/docs (상세 「계약 · 서류」) — 둘 다 읽기 전용 */
export interface PartnerCard { id: string; leads: number; cash: number; category: string | null; form: string | null; formLabel: string | null; qualPending: boolean; qualName: string | null }

export const PST: Record<string, [string, string]> = {
  ACTIVE: ['ok', '운영중'], APPLIED: ['wait', '입점 심사중'], SUSPENDED: ['no', '중지'], WITHDRAWN: ['', '탈퇴'], REJECTED: ['no', '반려'],
};

export const NTS: Record<string, string> = { VALID: '계속사업자', CLOSED: '폐업', SUSPENDED: '휴업', UNKNOWN: '조회 불가' };

export const ymd = (s?: string | null) => (s ? ymdKst(s) : '—');

export function partnerWarn(p: Partner, c?: PartnerCard): string | null {
  if (p.status === 'APPLIED') return '입점 심사 대기 — 승인 전에는 리드가 가지 않습니다';
  if (p.status === 'REJECTED') return `입점 반려${p.rejectReason ? ` — ${p.rejectReason}` : ''}`;
  if (p.status === 'SUSPENDED') return '중지 — 리드 수신이 멈췄습니다';
  if (Number(p.unpaid) >= Number(p.unpaidCap)) return `리드 이용료 미청구 ${n(p.unpaid)}원 — 한도 ${n(p.unpaidCap)}원에 닿아 리드 수신이 막힙니다`;
  if (c?.qualPending) return `${c.qualName ?? '규제 업종'} · 자격 심사 대기(T-21)`;
  return null;
}
