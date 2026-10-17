/** OpenAPI 생성 전까지의 최소 계약. 서버 DTO 와 같은 이름을 씁니다. */
export interface ListingCardData {
  id: string;
  gwanCode: string;
  categoryName: string;
  title: string;
  desiredFee: number | null;
  feeBearerLabel: string | null;
  owner: { companyName: string; verified: boolean; confirmedDeals: number };
  badges: { type: string; label: string; validUntil?: string }[];
  isAd: boolean;
  adLabel: string | null;
  publishedAt: string | null;
  likeCount: number;
  /** v10.31 — 등급(골든 · 실버 · 브론즈 — 가칭) · 조회 수 */
  gradeCode?: string; gradeLabel?: string | null; viewCount?: number;
  liked: boolean;
  /* ── v10.31 (w2 · 시안 카드) — 서버가 늘 싣습니다(옛 응답 호환을 위해 선택 항목으로 둠) ── */
  listingNo?: number;
  summary?: string | null;
  dealAmount?: number | null;
  /** 안심소개 부동산 축 — 소개비가 아니라 노출료(A-07) */
  isRealty?: boolean;
  region?: { sidoCode: string | null; sido: string; sigungu: string | null } | null;
  /** 대표 사진(/api/v1/listings/{id}/photos/0) — 없으면 분류 그림 */
  thumbUrl?: string | null;
  photoCount?: number;
  /** 소개 신뢰도(0~100 · 36.5 에서 시작) */
  trustScore?: number | null;
  urgent?: { kind: 'BUY' | 'SELL'; label: string; until: string } | null;
}

/** 광고와 일반을 분리해 받습니다. 섞으면 라벨을 빠뜨립니다 (전상법 · INV-11) */
export interface ListingListData {
  promoted: ListingCardData[];
  organic: ListingCardData[];
  nextCursor: string | null;
  adNotice: string;
  /** v10.31 — page · withTotal 을 줬을 때 */
  total?: number; page?: number; pageCount?: number;
}

/** 상세의 등록자 — 공개 실적이 붙습니다 (v10.21 · D023). 누적수익은 본인이 공개를 켠 경우에만 값이 있습니다 */
export interface ListingOwnerDetail {
  companyName: string; verified: boolean; confirmedDeals: number;
  joinedAt: string; totalDeals: number; successRate: number | null;
  settledAmount: number | null; earningsPublic: boolean;
  reviewCount: number; rating: number | null;
}

export interface ListingReviewList {
  count: number; average: number | null;
  items: { id: string; authorName: string; rating: number; body: string | null; createdAt: string }[];
}

export interface ListingDetailData extends Omit<ListingCardData, 'owner'> {
  owner: ListingOwnerDetail;
  viewCount: number;
  body: string | null;
  status: string;
  statusLabel: string;
  mediaUrls: string[];
  /** v10.31 — 사진 줄 id(주인이 뗄 때) */
  mediaIds?: string[];
  regionNames: string[];
  regionCode?: string | null;
  regionDetail?: string | null;
  /** v10.31 — 소개 신뢰도와 항목 */
  trust?: { score: number | null; business: boolean; identity: boolean; deals: number; successRate: number | null;
    rating: number | null; reviewCount: number; disputes: number; consentRate: number | null } | null;
  version: number;
  /** 서버가 판정합니다. 프런트가 역할·게이트를 재계산하지 않습니다 */
  canInquire: boolean;
  inquireBlockReason?: 'IDENTITY_REQUIRED' | 'OWN_LISTING';
  /* v10.31 (w1) — 수정 화면 · 시안 등록 칸 */
  categoryId?: string; feeBearer?: string | null; isOwn?: boolean;
  summary?: string | null; contractSupport?: string | null; contactHours?: string | null;
  address?: { zip?: string; road?: string; detail?: string; sido?: string; sigungu?: string } | null;
  bizInfo?: { size?: string; sales?: string; premium?: string; wish?: string; handover?: string; etc?: string } | null;
  /** v10.46 (docs/96) — 지도 좌표. 남에게는 REGION(시 · 구 중심) 만, 본인은 EXACT · 상태. 좌표가 없으면 null(남) */
  geo?: ListingGeo | null;
}

export type ListingGeo =
  | { precision: 'REGION'; lat: number; lng: number; radiusM: number; label: string }
  | { precision: 'EXACT'; status: 'OK'; lat: number; lng: number }
  | { precision: 'EXACT'; status: 'PENDING' | 'FAILED' | 'NOT_FOUND'; lat?: undefined; lng?: undefined };

export interface Gwan {
  code: string; name: string; description: string | null;
  isActive: boolean; listingCount: number;
}

export interface FooterLink {
  section: string; label: string; targetType: string;
  targetRef: string | null; available: boolean; tip: string | null;
}
