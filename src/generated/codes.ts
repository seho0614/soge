// 자동 생성 파일 — 직접 수정하지 마십시오.
// 생성: node scripts/gen-codes.js > src/generated/codes.ts
// 원본: code_labels 테이블 (마이그레이션 220_code_registry)

/** account.type */
export const AccountType = {
  INDIVIDUAL: 'INDIVIDUAL',
  BUSINESS: 'BUSINESS',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];
export const AccountTypeOrder: readonly AccountType[] = ['INDIVIDUAL', 'BUSINESS'];

/** ad.status */
export const AdStatus = {
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ENDED: 'ENDED',
} as const;
export type AdStatus = (typeof AdStatus)[keyof typeof AdStatus];
export const AdStatusOrder: readonly AdStatus[] = ['SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED'];

/** alert.severity */
export const AlertSeverity = {
  INFO: 'INFO',
  WARN: 'WARN',
  CRITICAL: 'CRITICAL',
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];
export const AlertSeverityOrder: readonly AlertSeverity[] = ['INFO', 'WARN', 'CRITICAL'];

/** attribution.channel */
export const AttributionChannel = {
  WEB: 'WEB',
  MOBILE: 'MOBILE',
  CALL: 'CALL',
  OFFLINE: 'OFFLINE',
} as const;
export type AttributionChannel = (typeof AttributionChannel)[keyof typeof AttributionChannel];
export const AttributionChannelOrder: readonly AttributionChannel[] = ['WEB', 'MOBILE', 'CALL', 'OFFLINE'];

/** badge.status */
export const BadgeStatus = {
  REQUESTED: 'REQUESTED',
  IN_REVIEW: 'IN_REVIEW',
  GRANTED: 'GRANTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type BadgeStatus = (typeof BadgeStatus)[keyof typeof BadgeStatus];
export const BadgeStatusOrder: readonly BadgeStatus[] = ['REQUESTED', 'IN_REVIEW', 'GRANTED', 'REJECTED', 'EXPIRED', 'REVOKED'];

/** badge.type */
export const BadgeType = {
  URGENT: 'URGENT',
  URGENT_SALE: 'URGENT_SALE',
  VERIFIED_DOC: 'VERIFIED_DOC',
} as const;
export type BadgeType = (typeof BadgeType)[keyof typeof BadgeType];
export const BadgeTypeOrder: readonly BadgeType[] = ['URGENT', 'URGENT_SALE', 'VERIFIED_DOC'];

/** broker.doc */
export const BrokerDoc = {
  REG_CERT: 'REG_CERT',
  GUARANTEE: 'GUARANTEE',
  LICENSE: 'LICENSE',
  ETC: 'ETC',
} as const;
export type BrokerDoc = (typeof BrokerDoc)[keyof typeof BrokerDoc];
export const BrokerDocOrder: readonly BrokerDoc[] = ['REG_CERT', 'GUARANTEE', 'LICENSE', 'ETC'];

/** business.status */
export const BusinessStatus = {
  NONE: 'NONE',
  IN_REVIEW: 'IN_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type BusinessStatus = (typeof BusinessStatus)[keyof typeof BusinessStatus];
export const BusinessStatusOrder: readonly BusinessStatus[] = ['NONE', 'IN_REVIEW', 'VERIFIED', 'REJECTED'];

/** category.labor_law */
export const CategoryLaborLaw = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  APPLICABLE: 'APPLICABLE',
} as const;
export type CategoryLaborLaw = (typeof CategoryLaborLaw)[keyof typeof CategoryLaborLaw];
export const CategoryLaborLawOrder: readonly CategoryLaborLaw[] = ['NOT_APPLICABLE', 'REVIEW_REQUIRED', 'APPLICABLE'];

/** category.status */
export const CategoryStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CategoryStatus = (typeof CategoryStatus)[keyof typeof CategoryStatus];
export const CategoryStatusOrder: readonly CategoryStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'];

/** deal.status */
export const DealStatus = {
  INQUIRY: 'INQUIRY',
  NEGOTIATING: 'NEGOTIATING',
  CONTRACTED: 'CONTRACTED',
  PAYMENT_REPORTED: 'PAYMENT_REPORTED',
  CONFIRMED: 'CONFIRMED',
  SETTLED: 'SETTLED',
  DISPUTED: 'DISPUTED',
  CANCELLED: 'CANCELLED',
} as const;
export type DealStatus = (typeof DealStatus)[keyof typeof DealStatus];
export const DealStatusOrder: readonly DealStatus[] = ['INQUIRY', 'NEGOTIATING', 'CONTRACTED', 'PAYMENT_REPORTED', 'CONFIRMED', 'SETTLED', 'DISPUTED', 'CANCELLED'];

/** dispute.reason */
export const DisputeReason = {
  FEE_DISAGREE: 'FEE_DISAGREE',
  NOT_INTRODUCED: 'NOT_INTRODUCED',
  CONTRACT_ISSUE: 'CONTRACT_ISSUE',
  PAYMENT_ISSUE: 'PAYMENT_ISSUE',
  OTHER: 'OTHER',
} as const;
export type DisputeReason = (typeof DisputeReason)[keyof typeof DisputeReason];
export const DisputeReasonOrder: readonly DisputeReason[] = ['FEE_DISAGREE', 'NOT_INTRODUCED', 'CONTRACT_ISSUE', 'PAYMENT_ISSUE', 'OTHER'];

/** dispute.status */
export const DisputeStatus = {
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];
export const DisputeStatusOrder: readonly DisputeStatus[] = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED'];

/** fee.bearer */
export const FeeBearer = {
  BUYER: 'BUYER',
  SELLER: 'SELLER',
  NEGOTIABLE: 'NEGOTIABLE',
} as const;
export type FeeBearer = (typeof FeeBearer)[keyof typeof FeeBearer];
export const FeeBearerOrder: readonly FeeBearer[] = ['BUYER', 'SELLER', 'NEGOTIABLE'];

/** finance.cost */
export const FinanceCost = {
  PAYROLL: 'PAYROLL',
  RENT: 'RENT',
  INFRA: 'INFRA',
  MARKETING: 'MARKETING',
  PG_FEE: 'PG_FEE',
  OUTSOURCE: 'OUTSOURCE',
  TAX: 'TAX',
  ETC: 'ETC',
} as const;
export type FinanceCost = (typeof FinanceCost)[keyof typeof FinanceCost];
export const FinanceCostOrder: readonly FinanceCost[] = ['PAYROLL', 'RENT', 'INFRA', 'MARKETING', 'PG_FEE', 'OUTSOURCE', 'TAX', 'ETC'];

/** gwan.ui_type */
export const GwanUiType = {
  LIST: 'LIST',
  MATCH: 'MATCH',
  SERVICE: 'SERVICE',
  CONTENT: 'CONTENT',
} as const;
export type GwanUiType = (typeof GwanUiType)[keyof typeof GwanUiType];
export const GwanUiTypeOrder: readonly GwanUiType[] = ['LIST', 'MATCH', 'SERVICE', 'CONTENT'];

/** inquiry.category */
export const InquiryCategory = {
  DEAL: 'DEAL',
  SETTLE: 'SETTLE',
  ACCOUNT: 'ACCOUNT',
  DISPUTE: 'DISPUTE',
  ETC: 'ETC',
  HOWTO: 'HOWTO',
  LISTING: 'LISTING',
  FEE: 'FEE',
  BILLING: 'BILLING',
  REPORT: 'REPORT',
} as const;
export type InquiryCategory = (typeof InquiryCategory)[keyof typeof InquiryCategory];
export const InquiryCategoryOrder: readonly InquiryCategory[] = ['DEAL', 'SETTLE', 'ACCOUNT', 'DISPUTE', 'ETC', 'HOWTO', 'LISTING', 'FEE', 'BILLING', 'REPORT'];

/** inquiry.status */
export const InquiryStatus = {
  OPEN: 'OPEN',
  ANSWERED: 'ANSWERED',
  CLOSED: 'CLOSED',
} as const;
export type InquiryStatus = (typeof InquiryStatus)[keyof typeof InquiryStatus];
export const InquiryStatusOrder: readonly InquiryStatus[] = ['OPEN', 'ANSWERED', 'CLOSED'];

/** integration.status */
export const IntegrationStatus = {
  NOT_STARTED: 'NOT_STARTED',
  CONTRACT: 'CONTRACT',
  IP_PENDING: 'IP_PENDING',
  TESTING: 'TESTING',
  LIVE: 'LIVE',
  FAILED: 'FAILED',
} as const;
export type IntegrationStatus = (typeof IntegrationStatus)[keyof typeof IntegrationStatus];
export const IntegrationStatusOrder: readonly IntegrationStatus[] = ['NOT_STARTED', 'CONTRACT', 'IP_PENDING', 'TESTING', 'LIVE', 'FAILED'];

/** introducer.answer */
export const IntroducerAnswer = {
  KNOW: 'KNOW',
  CHECKING: 'CHECKING',
  DONT_KNOW: 'DONT_KNOW',
  NOT_MY_FIELD: 'NOT_MY_FIELD',
} as const;
export type IntroducerAnswer = (typeof IntroducerAnswer)[keyof typeof IntroducerAnswer];
export const IntroducerAnswerOrder: readonly IntroducerAnswer[] = ['KNOW', 'CHECKING', 'DONT_KNOW', 'NOT_MY_FIELD'];

/** introducer.grade */
export const IntroducerGrade = {
  SEED: 'SEED',
  VERIFIED: 'VERIFIED',
  EXPERT: 'EXPERT',
  TOP: 'TOP',
  REGION_PARTNER: 'REGION_PARTNER',
} as const;
export type IntroducerGrade = (typeof IntroducerGrade)[keyof typeof IntroducerGrade];
export const IntroducerGradeOrder: readonly IntroducerGrade[] = ['SEED', 'VERIFIED', 'EXPERT', 'TOP', 'REGION_PARTNER'];

/** invite.state */
export const InviteState = {
  SENT: 'SENT',
  VIEWED: 'VIEWED',
  CONSENTED: 'CONSENTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
} as const;
export type InviteState = (typeof InviteState)[keyof typeof InviteState];
export const InviteStateOrder: readonly InviteState[] = ['SENT', 'VIEWED', 'CONSENTED', 'DECLINED', 'EXPIRED'];

/** ledger.entry_type */
export const LedgerEntryType = {
  SUBSCRIPTION: 'SUBSCRIPTION',
  EXTRA_CODE: 'EXTRA_CODE',
  LEAD_VIEW: 'LEAD_VIEW',
  TOPUP: 'TOPUP',
  REFUND: 'REFUND',
  ADJUST: 'ADJUST',
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];
export const LedgerEntryTypeOrder: readonly LedgerEntryType[] = ['SUBSCRIPTION', 'EXTRA_CODE', 'LEAD_VIEW', 'TOPUP', 'REFUND', 'ADJUST'];

/** listing.grade */
export const ListingGrade = {
  G1: 'G1',
  G2: 'G2',
  G3: 'G3',
} as const;
export type ListingGrade = (typeof ListingGrade)[keyof typeof ListingGrade];
export const ListingGradeOrder: readonly ListingGrade[] = ['G1', 'G2', 'G3'];

/** listing.status */
export const ListingStatus = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];
export const ListingStatusOrder: readonly ListingStatus[] = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED'];

/** payment.method */
export const PaymentMethod = {
  BANK_TRANSFER: 'BANK_TRANSFER',
  CASH: 'CASH',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PaymentMethodOrder: readonly PaymentMethod[] = ['BANK_TRANSFER', 'CASH', 'OTHER'];

/** post.badge */
export const PostBadge = {
  WANTED: 'WANTED',
  INTRO_WANT: 'INTRO_WANT',
  ON_SALE: 'ON_SALE',
} as const;
export type PostBadge = (typeof PostBadge)[keyof typeof PostBadge];
export const PostBadgeOrder: readonly PostBadge[] = ['WANTED', 'INTRO_WANT', 'ON_SALE'];

/** proposal.relation */
export const ProposalRelation = {
  OTHER: 'OTHER',
  CLIENT: 'CLIENT',
  PARTNER: 'PARTNER',
  ACQUAINTANCE: 'ACQUAINTANCE',
  OWN: 'OWN',
} as const;
export type ProposalRelation = (typeof ProposalRelation)[keyof typeof ProposalRelation];
export const ProposalRelationOrder: readonly ProposalRelation[] = ['OTHER', 'CLIENT', 'PARTNER', 'ACQUAINTANCE', 'OWN'];

/** proposal.status */
export const ProposalStatus = {
  PROPOSED: 'PROPOSED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];
export const ProposalStatusOrder: readonly ProposalStatus[] = ['PROPOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'];

/** register.role */
export const RegisterRole = {
  OFFER: 'OFFER',
  REQUEST: 'REQUEST',
} as const;
export type RegisterRole = (typeof RegisterRole)[keyof typeof RegisterRole];
export const RegisterRoleOrder: readonly RegisterRole[] = ['OFFER', 'REQUEST'];

/** request.kind */
export const RequestKind = {
  GOODS: 'GOODS',
  SERVICE: 'SERVICE',
  EXPERT: 'EXPERT',
  COMPANY: 'COMPANY',
  USED: 'USED',
} as const;
export type RequestKind = (typeof RequestKind)[keyof typeof RequestKind];
export const RequestKindOrder: readonly RequestKind[] = ['GOODS', 'SERVICE', 'EXPERT', 'COMPANY', 'USED'];

/** request.status */
export const RequestStatus = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];
export const RequestStatusOrder: readonly RequestStatus[] = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'REJECTED', 'CLOSED', 'ARCHIVED'];

/** request.visibility */
export const RequestVisibility = {
  ALL: 'ALL',
  MEMBER: 'MEMBER',
  VERIFIED: 'VERIFIED',
} as const;
export type RequestVisibility = (typeof RequestVisibility)[keyof typeof RequestVisibility];
export const RequestVisibilityOrder: readonly RequestVisibility[] = ['ALL', 'MEMBER', 'VERIFIED'];

/** restriction.mode */
export const RestrictionMode = {
  BLOCK: 'BLOCK',
  GATED: 'GATED',
  ALLOW: 'ALLOW',
} as const;
export type RestrictionMode = (typeof RestrictionMode)[keyof typeof RestrictionMode];
export const RestrictionModeOrder: readonly RestrictionMode[] = ['BLOCK', 'GATED', 'ALLOW'];

/** review.decision_mode */
export const ReviewDecisionMode = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
} as const;
export type ReviewDecisionMode = (typeof ReviewDecisionMode)[keyof typeof ReviewDecisionMode];
export const ReviewDecisionModeOrder: readonly ReviewDecisionMode[] = ['AUTO', 'MANUAL'];

/** review.manual_reason */
export const ReviewManualReason = {
  UNVERIFIED_BUSINESS: 'UNVERIFIED_BUSINESS',
  FIRST_LISTING: 'FIRST_LISTING',
  HIGH_FEE: 'HIGH_FEE',
  PRIOR_REJECT: 'PRIOR_REJECT',
  GATED_CATEGORY: 'GATED_CATEGORY',
  THIN_CONTENT: 'THIN_CONTENT',
  AUTO_DISABLED: 'AUTO_DISABLED',
  BANNED_WORD_WARN: 'BANNED_WORD_WARN',
} as const;
export type ReviewManualReason = (typeof ReviewManualReason)[keyof typeof ReviewManualReason];
export const ReviewManualReasonOrder: readonly ReviewManualReason[] = ['UNVERIFIED_BUSINESS', 'FIRST_LISTING', 'HIGH_FEE', 'PRIOR_REJECT', 'GATED_CATEGORY', 'THIN_CONTENT', 'AUTO_DISABLED', 'BANNED_WORD_WARN'];

/** review.status */
export const ReviewStatus = {
  QUEUED: 'QUEUED',
  IN_PROGRESS: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];
export const ReviewStatusOrder: readonly ReviewStatus[] = ['QUEUED', 'IN_PROGRESS', 'APPROVED', 'REJECTED'];

/** review.target_type */
export const ReviewTargetType = {
  LISTING: 'LISTING',
  REQUEST: 'REQUEST',
  BUSINESS: 'BUSINESS',
  CATEGORY: 'CATEGORY',
  LISTING_BADGE: 'LISTING_BADGE',
} as const;
export type ReviewTargetType = (typeof ReviewTargetType)[keyof typeof ReviewTargetType];
export const ReviewTargetTypeOrder: readonly ReviewTargetType[] = ['LISTING', 'REQUEST', 'BUSINESS', 'CATEGORY', 'LISTING_BADGE'];

/** risk.rule */
export const RiskRule = {
  'RSK-01': 'RSK-01',
  'RSK-02': 'RSK-02',
  'RSK-03': 'RSK-03',
  'RSK-04': 'RSK-04',
  'RSK-05': 'RSK-05',
  'RSK-06': 'RSK-06',
  'RSK-07': 'RSK-07',
} as const;
export type RiskRule = (typeof RiskRule)[keyof typeof RiskRule];
export const RiskRuleOrder: readonly RiskRule[] = ['RSK-01', 'RSK-02', 'RSK-03', 'RSK-04', 'RSK-05', 'RSK-06', 'RSK-07'];

/** safety.case_type */
export const SafetyCaseType = {
  CONTRACT: 'CONTRACT',
  PAYMENT: 'PAYMENT',
  GOODS: 'GOODS',
  PRIVACY: 'PRIVACY',
  ETC: 'ETC',
} as const;
export type SafetyCaseType = (typeof SafetyCaseType)[keyof typeof SafetyCaseType];
export const SafetyCaseTypeOrder: readonly SafetyCaseType[] = ['CONTRACT', 'PAYMENT', 'GOODS', 'PRIVACY', 'ETC'];

/** settlement.status */
export const SettlementStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  HELD: 'HELD',
  REJECTED: 'REJECTED',
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];
export const SettlementStatusOrder: readonly SettlementStatus[] = ['REQUESTED', 'APPROVED', 'PAID', 'HELD', 'REJECTED'];

/** subscription.status */
export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];
export const SubscriptionStatusOrder: readonly SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'];

/** success_fee.status */
export const SuccessFeeStatus = {
  BILLED: 'BILLED',
  PAID: 'PAID',
  WAIVED: 'WAIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type SuccessFeeStatus = (typeof SuccessFeeStatus)[keyof typeof SuccessFeeStatus];
export const SuccessFeeStatusOrder: readonly SuccessFeeStatus[] = ['BILLED', 'PAID', 'WAIVED', 'CANCELLED'];

/** 화면 표시용 메타. 라벨은 DB 가 정본이며 이 값은 폴백입니다. */
export const CodeMeta: Record<string, Record<string, {
  label: string; shortLabel?: string; tone?: string; audience: string;
}>> = {
  'account.type': {
    INDIVIDUAL: { label: "개인 회원", shortLabel: "개인", tone: 'neutral', audience: 'ALL' },
    BUSINESS: { label: "사업자 회원", shortLabel: "사업자", tone: 'neutral', audience: 'ALL' },
  },
  'ad.status': {
    SCHEDULED: { label: "게재 예정", tone: 'info', audience: 'ADMIN' },
    ACTIVE: { label: "게재 중", tone: 'success', audience: 'ADMIN' },
    PAUSED: { label: "일시 중지", tone: 'warning', audience: 'ADMIN' },
    ENDED: { label: "종료됨", tone: 'muted', audience: 'ADMIN' },
  },
  'alert.severity': {
    INFO: { label: "알림", tone: 'info', audience: 'ADMIN' },
    WARN: { label: "주의", tone: 'warning', audience: 'ADMIN' },
    CRITICAL: { label: "긴급", tone: 'danger', audience: 'ADMIN' },
  },
  'attribution.channel': {
    WEB: { label: "웹", tone: 'neutral', audience: 'ADMIN' },
    MOBILE: { label: "모바일", tone: 'neutral', audience: 'ADMIN' },
    CALL: { label: "통화", tone: 'neutral', audience: 'ADMIN' },
    OFFLINE: { label: "오프라인", tone: 'neutral', audience: 'ADMIN' },
  },
  'badge.status': {
    REQUESTED: { label: "신청됨", tone: 'info', audience: 'ALL' },
    IN_REVIEW: { label: "검수 중", tone: 'info', audience: 'ALL' },
    GRANTED: { label: "표시 중", tone: 'success', audience: 'ALL' },
    REJECTED: { label: "반려됨", tone: 'danger', audience: 'ALL' },
    EXPIRED: { label: "기간 만료", tone: 'muted', audience: 'ALL' },
    REVOKED: { label: "회수됨", tone: 'muted', audience: 'ALL' },
  },
  'badge.type': {
    URGENT: { label: "급구", shortLabel: "급구", tone: 'warning', audience: 'ALL' },
    URGENT_SALE: { label: "급매", shortLabel: "급매", tone: 'warning', audience: 'ALL' },
    VERIFIED_DOC: { label: "서류 확인", shortLabel: "서류 확인", tone: 'info', audience: 'ALL' },
  },
  'broker.doc': {
    REG_CERT: { label: "중개사무소 등록증", shortLabel: "등록증", audience: 'ALL' },
    GUARANTEE: { label: "보증(공제) 증서", shortLabel: "보증 증서", audience: 'ALL' },
    LICENSE: { label: "공인중개사 자격증", shortLabel: "자격증", audience: 'ALL' },
    ETC: { label: "기타", shortLabel: "기타", audience: 'ALL' },
  },
  'business.status': {
    NONE: { label: "미신청", shortLabel: "미신청", tone: 'muted', audience: 'ALL' },
    IN_REVIEW: { label: "인증 심사 중", shortLabel: "심사 중", tone: 'info', audience: 'ALL' },
    VERIFIED: { label: "인증 완료", shortLabel: "인증", tone: 'success', audience: 'ALL' },
    REJECTED: { label: "인증 반려", shortLabel: "반려", tone: 'danger', audience: 'ALL' },
  },
  'category.labor_law': {
    NOT_APPLICABLE: { label: "해당 없음", tone: 'success', audience: 'ADMIN' },
    REVIEW_REQUIRED: { label: "검토 필요", tone: 'warning', audience: 'ADMIN' },
    APPLICABLE: { label: "등록 대상", tone: 'danger', audience: 'ADMIN' },
  },
  'category.status': {
    PENDING: { label: "승인 대기", tone: 'info', audience: 'ADMIN' },
    APPROVED: { label: "승인됨", tone: 'success', audience: 'ADMIN' },
    REJECTED: { label: "반려됨", tone: 'danger', audience: 'ADMIN' },
    ARCHIVED: { label: "보관됨", tone: 'muted', audience: 'ADMIN' },
  },
  'deal.status': {
    INQUIRY: { label: "문의 중", shortLabel: "문의", tone: 'info', audience: 'ALL' },
    NEGOTIATING: { label: "협의 중", shortLabel: "협의", tone: 'info', audience: 'ALL' },
    CONTRACTED: { label: "계약 진행", shortLabel: "계약", tone: 'info', audience: 'ALL' },
    PAYMENT_REPORTED: { label: "대금 지급 신고됨", shortLabel: "지급 신고", tone: 'info', audience: 'ALL' },
    CONFIRMED: { label: "성사 확정", shortLabel: "성사", tone: 'success', audience: 'ALL' },
    SETTLED: { label: "정산 완료", shortLabel: "정산 완료", tone: 'success', audience: 'ALL' },
    DISPUTED: { label: "분쟁", shortLabel: "분쟁", tone: 'danger', audience: 'ALL' },
    CANCELLED: { label: "취소됨", shortLabel: "취소", tone: 'muted', audience: 'ALL' },
  },
  'dispute.reason': {
    FEE_DISAGREE: { label: "소개비 금액에 이견이 있습니다", audience: 'ALL' },
    NOT_INTRODUCED: { label: "소개 사실이 없습니다", audience: 'ALL' },
    CONTRACT_ISSUE: { label: "계약 내용과 다릅니다", audience: 'ALL' },
    PAYMENT_ISSUE: { label: "대금이 지급되지 않았습니다", audience: 'ALL' },
    OTHER: { label: "기타", audience: 'ALL' },
  },
  'dispute.status': {
    OPEN: { label: "접수됨", tone: 'warning', audience: 'ALL' },
    IN_REVIEW: { label: "검토 중", tone: 'info', audience: 'ALL' },
    RESOLVED: { label: "처리 완료", tone: 'success', audience: 'ALL' },
    REJECTED: { label: "기각됨", tone: 'muted', audience: 'ALL' },
  },
  'fee.bearer': {
    BUYER: { label: "매수인 부담", shortLabel: "매수인", tone: 'neutral', audience: 'ALL' },
    SELLER: { label: "매도인 부담", shortLabel: "매도인", tone: 'neutral', audience: 'ALL' },
    NEGOTIABLE: { label: "협의", shortLabel: "협의", tone: 'neutral', audience: 'ALL' },
  },
  'finance.cost': {
    PAYROLL: { label: "인건비", audience: 'ADMIN' },
    RENT: { label: "임차료", audience: 'ADMIN' },
    INFRA: { label: "서버 · 인프라", audience: 'ADMIN' },
    MARKETING: { label: "마케팅", audience: 'ADMIN' },
    PG_FEE: { label: "결제 수수료", audience: 'ADMIN' },
    OUTSOURCE: { label: "외주 · 용역", audience: 'ADMIN' },
    TAX: { label: "세금 · 공과", audience: 'ADMIN' },
    ETC: { label: "기타", audience: 'ADMIN' },
  },
  'gwan.ui_type': {
    LIST: { label: "목록형", audience: 'ALL' },
    MATCH: { label: "매칭형", audience: 'ALL' },
    SERVICE: { label: "서비스형", audience: 'ALL' },
    CONTENT: { label: "콘텐츠형", audience: 'ALL' },
  },
  'inquiry.category': {
    DEAL: { label: "거래 · 매칭", audience: 'ALL' },
    SETTLE: { label: "정산 · 소개비", audience: 'ALL' },
    ACCOUNT: { label: "계정 · 사업자 인증", audience: 'ALL' },
    DISPUTE: { label: "신고 · 분쟁", audience: 'ALL' },
    ETC: { label: "기타", audience: 'ALL' },
    HOWTO: { label: "이용 방법", audience: 'ALL' },
    LISTING: { label: "등록·검수", audience: 'ALL' },
    FEE: { label: "소개비·정산", audience: 'ALL' },
    BILLING: { label: "구독·결제", audience: 'ALL' },
    REPORT: { label: "신고", audience: 'ALL' },
  },
  'inquiry.status': {
    OPEN: { label: "접수됨", tone: 'info', audience: 'ALL' },
    ANSWERED: { label: "답변 완료", tone: 'success', audience: 'ALL' },
    CLOSED: { label: "종료됨", tone: 'muted', audience: 'ALL' },
  },
  'integration.status': {
    NOT_STARTED: { label: "미착수", tone: 'muted', audience: 'ADMIN' },
    CONTRACT: { label: "계약 진행", tone: 'info', audience: 'ADMIN' },
    IP_PENDING: { label: "IP 심사중", tone: 'warning', audience: 'ADMIN' },
    TESTING: { label: "연동 시험", tone: 'info', audience: 'ADMIN' },
    LIVE: { label: "운영중", tone: 'success', audience: 'ADMIN' },
    FAILED: { label: "중단", tone: 'danger', audience: 'ADMIN' },
  },
  'introducer.answer': {
    KNOW: { label: "제가 알아요", shortLabel: "알아요", tone: 'success', audience: 'ALL' },
    CHECKING: { label: "확인해 보겠습니다", shortLabel: "확인중", tone: 'info', audience: 'ALL' },
    DONT_KNOW: { label: "잘 모릅니다", shortLabel: "모름", tone: 'muted', audience: 'ALL' },
    NOT_MY_FIELD: { label: "관심 없는 분야입니다", shortLabel: "관심없음", tone: 'muted', audience: 'ALL' },
  },
  'introducer.grade': {
    SEED: { label: "새싹 소개자", shortLabel: "새싹", tone: 'muted', audience: 'ALL' },
    VERIFIED: { label: "인증 소개자", shortLabel: "인증", tone: 'info', audience: 'ALL' },
    EXPERT: { label: "전문 소개자", shortLabel: "전문", tone: 'success', audience: 'ALL' },
    TOP: { label: "우수 소개자", shortLabel: "우수", tone: 'success', audience: 'ALL' },
    REGION_PARTNER: { label: "지역 파트너", shortLabel: "파트너", tone: 'success', audience: 'ALL' },
  },
  'invite.state': {
    SENT: { label: "초대 발송", shortLabel: "발송", tone: 'info', audience: 'ALL' },
    VIEWED: { label: "열람함", shortLabel: "열람", tone: 'info', audience: 'ALL' },
    CONSENTED: { label: "동의 완료", shortLabel: "동의", tone: 'success', audience: 'ALL' },
    DECLINED: { label: "거절", shortLabel: "거절", tone: 'muted', audience: 'ALL' },
    EXPIRED: { label: "기간 만료", shortLabel: "만료", tone: 'muted', audience: 'ALL' },
  },
  'ledger.entry_type': {
    SUBSCRIPTION: { label: "구독료", tone: 'neutral', audience: 'ADMIN' },
    EXTRA_CODE: { label: "초과 코드 요금", tone: 'neutral', audience: 'ADMIN' },
    LEAD_VIEW: { label: "리드 열람권", tone: 'neutral', audience: 'ADMIN' },
    TOPUP: { label: "충전", tone: 'neutral', audience: 'ADMIN' },
    REFUND: { label: "환불", tone: 'warning', audience: 'ADMIN' },
    ADJUST: { label: "조정", tone: 'warning', audience: 'ADMIN' },
  },
  'listing.grade': {
    G1: { label: "골든", audience: 'ALL' },
    G2: { label: "실버", audience: 'ALL' },
    G3: { label: "브론즈", audience: 'ALL' },
  },
  'listing.status': {
    DRAFT: { label: "작성 중", shortLabel: "작성 중", tone: 'muted', audience: 'ALL' },
    IN_REVIEW: { label: "검수 중", shortLabel: "검수 중", tone: 'info', audience: 'ALL' },
    PUBLISHED: { label: "노출 중", shortLabel: "노출 중", tone: 'success', audience: 'ALL' },
    REJECTED: { label: "반려됨", shortLabel: "반려", tone: 'danger', audience: 'ALL' },
    SUSPENDED: { label: "노출 중단", shortLabel: "중단", tone: 'warning', audience: 'ALL' },
    ARCHIVED: { label: "보관됨", shortLabel: "보관", tone: 'muted', audience: 'ALL' },
  },
  'payment.method': {
    BANK_TRANSFER: { label: "계좌 이체", tone: 'neutral', audience: 'ALL' },
    CASH: { label: "현금", tone: 'neutral', audience: 'ALL' },
    OTHER: { label: "기타", tone: 'neutral', audience: 'ALL' },
  },
  'post.badge': {
    WANTED: { label: "찾습니다", shortLabel: "찾음", tone: 'info', audience: 'ALL' },
    INTRO_WANT: { label: "소개해주세요", shortLabel: "소개", tone: 'info', audience: 'ALL' },
    ON_SALE: { label: "판매 중", shortLabel: "판매", tone: 'success', audience: 'ALL' },
  },
  'proposal.relation': {
    OTHER: { label: "기타", audience: 'ALL' },
    CLIENT: { label: "거래처", audience: 'ALL' },
    PARTNER: { label: "협력사", audience: 'ALL' },
    ACQUAINTANCE: { label: "지인 업체", audience: 'ALL' },
    OWN: { label: "우리 회사", audience: 'ALL' },
  },
  'proposal.status': {
    PROPOSED: { label: "제안됨", tone: 'info', audience: 'ALL' },
    ACCEPTED: { label: "수락됨", tone: 'success', audience: 'ALL' },
    REJECTED: { label: "거절됨", tone: 'muted', audience: 'ALL' },
    WITHDRAWN: { label: "철회됨", tone: 'muted', audience: 'ALL' },
  },
  'register.role': {
    OFFER: { label: "소개합니다", audience: 'ALL' },
    REQUEST: { label: "소개받기", audience: 'ALL' },
  },
  'request.kind': {
    GOODS: { label: "상품 구매", shortLabel: "상품 구매", audience: 'ALL' },
    SERVICE: { label: "서비스 의뢰", shortLabel: "서비스 의뢰", audience: 'ALL' },
    EXPERT: { label: "전문가 문의", shortLabel: "전문가 문의", audience: 'ALL' },
    COMPANY: { label: "업체 찾기", shortLabel: "업체 찾기", audience: 'ALL' },
    USED: { label: "중고 구하기", shortLabel: "중고 구하기", audience: 'ALL' },
  },
  'request.status': {
    DRAFT: { label: "작성 중", shortLabel: "작성 중", tone: 'muted', audience: 'ALL' },
    IN_REVIEW: { label: "검수 중", shortLabel: "검수 중", tone: 'info', audience: 'ALL' },
    PUBLISHED: { label: "모집 중", shortLabel: "모집 중", tone: 'success', audience: 'ALL' },
    REJECTED: { label: "반려됨", shortLabel: "반려", tone: 'danger', audience: 'ALL' },
    CLOSED: { label: "마감됨", shortLabel: "마감", tone: 'muted', audience: 'ALL' },
    ARCHIVED: { label: "보관됨", shortLabel: "보관", tone: 'muted', audience: 'ALL' },
  },
  'request.visibility': {
    ALL: { label: "전체", audience: 'ALL' },
    MEMBER: { label: "회원", audience: 'ALL' },
    VERIFIED: { label: "인증 회원", audience: 'ALL' },
  },
  'restriction.mode': {
    BLOCK: { label: "등록 차단", tone: 'danger', audience: 'ADMIN' },
    GATED: { label: "자격 확인 후 허용", tone: 'warning', audience: 'ADMIN' },
    ALLOW: { label: "허용", tone: 'muted', audience: 'ADMIN' },
  },
  'review.decision_mode': {
    AUTO: { label: "자동", tone: 'success', audience: 'ADMIN' },
    MANUAL: { label: "수동", tone: 'info', audience: 'ADMIN' },
  },
  'review.manual_reason': {
    UNVERIFIED_BUSINESS: { label: "본인 · 사업자 인증 전", tone: 'warning', audience: 'ADMIN' },
    FIRST_LISTING: { label: "첫 등록", tone: 'info', audience: 'ADMIN' },
    HIGH_FEE: { label: "고액", tone: 'warning', audience: 'ADMIN' },
    PRIOR_REJECT: { label: "반려 이력", tone: 'warning', audience: 'ADMIN' },
    GATED_CATEGORY: { label: "자격 확인 필요", tone: 'warning', audience: 'ADMIN' },
    THIN_CONTENT: { label: "본문 부실", tone: 'info', audience: 'ADMIN' },
    AUTO_DISABLED: { label: "자동검수 중지", tone: 'muted', audience: 'ADMIN' },
    BANNED_WORD_WARN: { label: "주의 단어", tone: 'warning', audience: 'ADMIN' },
  },
  'review.status': {
    QUEUED: { label: "대기", tone: 'info', audience: 'ADMIN' },
    IN_PROGRESS: { label: "처리 중", tone: 'info', audience: 'ADMIN' },
    APPROVED: { label: "승인", tone: 'success', audience: 'ADMIN' },
    REJECTED: { label: "반려", tone: 'danger', audience: 'ADMIN' },
  },
  'review.target_type': {
    LISTING: { label: "매물", tone: 'neutral', audience: 'ADMIN' },
    REQUEST: { label: "소개받기", tone: 'neutral', audience: 'ADMIN' },
    BUSINESS: { label: "사업자", tone: 'neutral', audience: 'ADMIN' },
    CATEGORY: { label: "업종", tone: 'neutral', audience: 'ADMIN' },
    LISTING_BADGE: { label: "매물 배지", tone: 'neutral', audience: 'ADMIN' },
  },
  'risk.rule': {
    'RSK-01': { label: "귀속 우회 의심", shortLabel: "귀속 우회 ", tone: 'danger', audience: 'ADMIN' },
    'RSK-02': { label: "허위 · 중복 매물", shortLabel: "허위 · 중", tone: 'warning', audience: 'ADMIN' },
    'RSK-03': { label: "반려율 상한 초과", shortLabel: "반려율 상한", tone: 'warning', audience: 'ADMIN' },
    'RSK-04': { label: "소개캐시 중복 차감", shortLabel: "소개캐시 중", tone: 'info', audience: 'ADMIN' },
    'RSK-05': { label: "제한업종 우회 등록", shortLabel: "제한업종 우", tone: 'danger', audience: 'ADMIN' },
    'RSK-06': { label: "자전거래 의심", shortLabel: "자전거래 의", tone: 'info', audience: 'ADMIN' },
    'RSK-07': { label: "광고 소재 규제 위반", shortLabel: "규제위반", tone: 'danger', audience: 'ADMIN' },
  },
  'safety.case_type': {
    CONTRACT: { label: "계약사기", shortLabel: "계약사기", audience: 'ALL' },
    PAYMENT: { label: "대금사기", shortLabel: "대금사기", audience: 'ALL' },
    GOODS: { label: "물품/서비스 사기", shortLabel: "물품/서비스", audience: 'ALL' },
    PRIVACY: { label: "개인정보/보이스피싱", shortLabel: "개인정보", audience: 'ALL' },
    ETC: { label: "기타 사기", shortLabel: "기타", audience: 'ALL' },
  },
  'settlement.status': {
    REQUESTED: { label: "승인 대기", shortLabel: "승인 대기", tone: 'info', audience: 'ALL' },
    APPROVED: { label: "승인됨 · 지급 대기", shortLabel: "승인됨", tone: 'info', audience: 'ALL' },
    PAID: { label: "당사자 지급 표시", shortLabel: "표시됨", tone: 'success', audience: 'ALL' },
    HELD: { label: "분쟁으로 보류", shortLabel: "보류", tone: 'warning', audience: 'ALL' },
    REJECTED: { label: "반려됨", shortLabel: "반려", tone: 'danger', audience: 'ALL' },
  },
  'subscription.status': {
    ACTIVE: { label: "이용 중", shortLabel: "이용 중", tone: 'success', audience: 'ALL' },
    PAST_DUE: { label: "결제 실패", shortLabel: "결제 실패", tone: 'warning', audience: 'ALL' },
    CANCELLED: { label: "해지됨", shortLabel: "해지", tone: 'muted', audience: 'ALL' },
    EXPIRED: { label: "기간 만료", shortLabel: "만료", tone: 'muted', audience: 'ALL' },
  },
  'success_fee.status': {
    BILLED: { label: "청구됨", shortLabel: "청구", tone: 'info', audience: 'ALL' },
    PAID: { label: "납부 완료", shortLabel: "완료", tone: 'success', audience: 'ALL' },
    WAIVED: { label: "면제", shortLabel: "면제", tone: 'muted', audience: 'ALL' },
    CANCELLED: { label: "청구 취소", shortLabel: "취소", tone: 'muted', audience: 'ALL' },
  },
};

export function codeLabel(domain: string, code: string): string {
  return CodeMeta[domain]?.[code]?.label ?? code;
}
