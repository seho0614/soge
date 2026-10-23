

export interface Broker {
  id: string; state: string; licenseNo: string; officeName: string | null; ceoName: string | null;
  lookupResult: string | null; lookupAt: string | null; recheckDue: string | null;
  /** D008 — API 실제 조회 · ASSUMED 간주 · MANUAL 수기. 비면 미조회 */
  lookupSource?: string | null; lookupDetail?: string | null;
  rejectReason: string | null; decidedAt: string | null; decidedBy: string | null; createdAt: string;
  businessId: string; company: string; bizRegNo: string | null; bizCeoName: string; bizVerified: boolean; personal?: boolean;
  ntsStatus: string | null; sido: string | null; sigungu: string | null; accountEmail: string;
  ceoMatch: boolean; canPublish: boolean; malWaiting: number; malPublished: number; assumed?: boolean;
}

/* ── SB-ADM-BRK-010 중개사 인증 심사 ─────────────────────────────── */
export const BST: Record<string, string> = {
  SUBMITTED: '접수', PENDING: '심사 대기', VERIFIED: '인증 완료', REJECTED: '반려', EXPIRED: '기한 만료',
};

const LK: Record<string, string> = { MATCH: '일치', MISMATCH: '불일치', NOT_FOUND: '등록 없음' };

export const lookupView = (b: Broker) => b.lookupResult
  ? <span className={`st ${b.lookupResult === 'MATCH' ? 'ok' : 'no'}`}>{LK[b.lookupResult] ?? b.lookupResult}</span>
  : <span className="st no">미조회</span>;
