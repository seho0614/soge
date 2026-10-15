export type ReviewTargetType =
  | 'LISTING' | 'REQUEST' | 'LEAD_SERVICE' | 'MEDICAL' | 'BUSINESS' | 'CATEGORY';

export type ReviewStatus = 'QUEUED' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';

export interface ReviewItem {
  id: string;
  targetType: ReviewTargetType;
  targetId: string;
  gwanCode: string | null;
  submittedBy: string;
  submittedAt: Date;
  slaDueAt: Date;
  assigneeId: string | null;
  status: ReviewStatus;
  rejectReasonCode: string | null;
  rejectMemo: string | null;
  decidedAt: Date | null;
}

/** SLA 24시간 (B-09R) */
export const REVIEW_SLA_HOURS = 24;
/** 경보 시점 — 마감 4시간 전 */
export const REVIEW_SLA_WARN_HOURS = 20;
