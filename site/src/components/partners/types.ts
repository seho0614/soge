/**
 * 파트너센터(제휴수수료) 응답 모양 — /partner/affiliate/* (2026-10-02 실측).
 *
 * ★ 파트너가 아니면 오류가 아니라 **200 + ok:false** 로 옵니다.
 *   목록 API 는 빈 배열로 옵니다. 그래서 화면은 ok 를 먼저 봅니다.
 */

export interface AffDashboard {
  ok: boolean;
  note?: string | null;
  month?: { clicks: number; orders: number; earned: number | string; payable: number | string;
    /* v10.31 (W5) */ lastMonthEarned?: number; lastMonthSamePeriod?: number; deltaPct?: number | null };
  goal?: { target: number | string; reward: number | string | null; source: string; rate: number | null } | null;
  recent?: Array<{ orderNo: string; product: string; commission: number | string; state: string; orderedAt: string }>;
  /* v10.31 (W5 · SB-AFC-DSH-010) — 오늘 · 어제 · 소개 고객 · 등급 · 정산 예정일 · 알림 · 이름 · 응원 문구 · 구매 소식 */
  today?: { earned: number; yesterdayEarned: number; earnedDelta: number; orders: number; yesterdayOrders: number; ordersDelta: number };
  customers?: { today: number; yesterday: number; delta: number; month: number };
  tier?: { grade: string | null; next: string | null; nextMin: number | null; remaining: number | null; progress: number | null; note: string | null };
  payoutDate?: string;
  unread?: number;
  displayName?: string | null;
  goalCheer?: string | null;
  feed?: Array<{ at: string; kind: string; product: string; area: string | null; amount: number }>;
}

export interface AffLink {
  id: string; code: string; label: string | null; isActive: boolean;
  product: string | null; commission: number | string | null; productStatus: string | null;
  clicks: number; orders: number;
  /** D001 — 오늘 클릭(하루·방문자당 1회) · 공유 주소의 경로(/r/{code}) */
  clicksToday?: number; sharePath?: string;
}

export interface AffOrder {
  orderNo: string; product: string; linkLabel: string | null;
  commission: number | string; state: string; attributed: boolean;
  clickedAt: string | null; orderedAt: string; noteIfUnattributed: string | null;
}

export interface AffRevenues {
  items: Array<{ date: string; track: string; amount: number | string; memo: string | null }>;
  note: string | null;
}

export interface AffSettlements {
  items: Array<{
    id: string; track: string; from: string; to: string;
    gross: number | string; withholding: number | string; net: number | string;
    state: string; paidAt: string | null;
  }>;
  account: {
    bankName: string; last4: string; holderName: string; verifiedAt: string | null;
    /** D001 — 1원 인증 진행 상태 */
    verifyPending?: boolean; verifyExpiresAt?: string | null; verifyTries?: number;
    verifyLocked?: boolean; verifyStub?: boolean;
  } | null;
  note?: string | null;
}

export interface AffProduct {
  id: string; code: string; name: string; advertiser: string | null;
  commission: number | string; landingUrl: string; description: string | null;
  startedAt: string | null; endedAt: string | null;
  /* v10.31 (W5) — 🔥인기 · ❤고수익 표지(운영 · 비면 최근 7일 주문 상위) · 사진(운영) */
  tag?: 'HOT' | 'HIGH' | null; imagePath?: string | null; orders7d?: number;
}

/** 첨부 파일 (D007) — 내려받기는 GET /files/{fileId} */
export interface AffFileRef { fileId: string | null; fileName: string | null; fileType: string | null; fileSize: number | null }

export interface AffMaterial extends AffFileRef {
  id: string; title: string; kind: string; fileKey: string | null; body: string | null; createdAt: string;
}

export interface AffGuide extends AffFileRef { id: string; title: string; body: string; sortOrder: number }

export interface AffInquiry {
  id: string; subject: string; body: string; state: string;
  answer: string | null; answeredAt: string | null; createdAt: string;
}

export interface Notice {
  id: string; gwanCode: string | null; title: string; body: string;
  isPinned: boolean; publishedAt: string | null;
}

/** 변경 API 공통 — 파트너가 아니면 201 + ok:false 로 옵니다 */
export interface AffResult { ok: boolean; note?: string; id?: string; code?: string; last4?: string }
