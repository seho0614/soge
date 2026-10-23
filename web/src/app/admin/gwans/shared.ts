

export interface Gwan {
  code: string; name: string; description: string | null;
  isActive: boolean; sortOrder: number;
  openedAt: string | null;
  publishedListings: number; categories: number; reviewPending: number;
}

export interface Manage {
  code: string; name: string; isActive: boolean; isHub: boolean;
  sortOrder: number; categories: number; listings: number; isLanding: boolean;
  /** v10.36 — 신규 가입자 첫 화면(site.landing_new_member) */
  isNewMemberLanding?: boolean;
}

/* ── SB-ADM-SIT-030 관 설정 (8개 탭) ─────────────────────────────── */
export type STab = 'basic' | 'status' | 'order' | 'landing' | 'stats' | 'fixed' | 'category' | 'open';
