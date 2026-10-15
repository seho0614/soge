/** v10.31 (w2) — 관 화면 시안 구역의 서버 응답(GET /market/* · /search/keywords · /safety/* · /biz/*) */

export interface MarketRegion { code: string; name: string; count?: number }
export interface MarketRegions { items: MarketRegion[]; etc: MarketRegion & { includes: string[] }; all: MarketRegion[] }

export interface Keywords { items: { term: string; hits: number }[] }

export interface MarketReq {
  id: string; gwanCode: string; title: string; categoryName: string | null;
  budgetMin: number | null; budgetMax: number | null; createdAt: string | null; proposalCount: number;
  kind: string | null; kindLabel: string | null; sido: string | null; sigungu: string | null; photoUrl: string | null;
}
export interface MarketReqs { items: MarketReq[]; kinds: { code: string; label: string; n: number }[] }

export interface Supplier {
  id: string; companyName: string; mainCategory: string | null; summary: string | null;
  sido: string | null; sigungu: string | null; listingCount: number; rating: number | null; reviewCount: number;
  confirmedDeals: number; trustScore: number | null; topListingId: string | null; thumbUrl: string | null;
  score?: number; parts?: Record<string, number>;
}
export interface Recommended { items: Supplier[]; personal: boolean; note: string; weights: { code: string; name: string; weight: number }[] }

export interface SuccessCase {
  listingId: string | null; title: string; categoryName: string | null; gwanCode: string; fee: number; tradeAmount: number | null;
  days: number; region: string | null; date: string; thumbUrl: string | null; inquiries: number; proposals: number;
}

export interface SuccessStats {
  asOf: string; period: string;
  kpi: {
    total: { value: number; deltaToday: number; deltaPct: number | null };
    fee: { value: number; deltaToday: number };
    inProgress: { value: number; newToday: number };
    month: { value: number; prevMonth: number; deltaPct: number | null };
    monthFee: { value: number; prevMonth: number; deltaPct: number | null };
  };
  trend: { days: string[]; counts: number[]; fees: number[] };
  categories: { name: string; count: number; pct: number; fee: number }[];
  regions: { name: string; count: number; fee: number }[];
  top: { rank: number; name: string; company: string; deals: number; fee: number | null; feePublic: boolean; lastTitle: string | null }[];
  recent: SuccessCase[];
  notes: string[];
}

export interface BestStory {
  id: string; storyNo: number; headline: string; summary: string | null; reasons: string[];
  sellerComment: string | null; sellerRating: number | null; listingId: string | null; title: string; categoryName: string | null;
  fee: number; tradeAmount: number | null; days: number; region: string | null; gradeCode: string; date: string; thumbUrl: string | null;
  steps: { step: number; code: string; label: string; at: string | null }[];
}

export interface SafetyCaseRow { no: number; type: string; typeLabel: string; title: string; region: string | null; date: string; views: number }
export interface SafetyCases { items: SafetyCaseRow[]; total: number; page: number; pageCount: number; types: { code: string; label: string }[] }
export interface SafeTradeTerms { minAmount: number; supportHours: string | null; phone: string | null; items: { key: string; title: string; body: string }[] }

export interface AxisItem {
  id: string; no: number; kind: 'JOB' | 'SVC' | 'POL' | 'EDU'; badge: string; hot: boolean; title: string;
  price: string | null; cond: string | null; sub: string | null; org: string | null; region: string | null;
  headcount: number | null; period: string | null; due: string | null; dDay: number | null; sample: boolean; status: string;
  postedBy: string; requestCount: number; myRequest?: { status: string; at: string; answer?: string | null } | null;
  description?: string | null; spec?: [string, string][]; mine?: boolean; hasSource?: boolean | null;
}
export interface QuickRow { id: string; when: 'TODAY' | 'TOMORROW' | 'WEEK'; headcount: number; task: string; region: string; createdAt: string; offers: number; mine: boolean; offered: boolean }
