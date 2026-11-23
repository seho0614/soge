

export interface Gwan {
  code: string; name: string; description: string | null;
  isActive: boolean; sortOrder: number;
  openedAt: string | null;
  publishedListings: number; categories: number; reviewPending: number;
  /** v10.642 (docs/786) 오픈 점검 — 허브는 하위 관 · 리드관은 안심소개 상담 업종 */
  isHub?: boolean; childGwans?: number; childCategories?: number; consultCategories?: number | null;
}

/** v10.642 (docs/786) 「업종 1종 이상 승인」 — 허브 관은 해당 없음(하위 관) · 리드관은 안심소개 상담 업종 수로 */
export function categoryCheck(g: Gwan): [boolean, string] {
  if (g.isHub) return [true, `해당 없음 — 허브 관(하위 관 ${g.childGwans ?? 0}곳 · 승인 업종 ${g.childCategories ?? 0}종)`];
  if (g.consultCategories != null) return [g.consultCategories > 0, `상담 업종 ${g.consultCategories}종(안심소개 상담 축 · 리드관은 업종을 따로 두지 않음)`];
  return [g.categories > 0, `${g.categories}종 승인됨`];
}

export interface Manage {
  code: string; name: string; isActive: boolean; isHub: boolean;
  sortOrder: number; categories: number; listings: number; isLanding: boolean;
  /** v10.36 — 신규 가입자 첫 화면(site.landing_new_member) */
  isNewMemberLanding?: boolean;
}

/* ── SB-ADM-SIT-030 관 설정 (8개 탭) ─────────────────────────────── */
export type STab = 'basic' | 'status' | 'order' | 'landing' | 'stats' | 'fixed' | 'category' | 'open';
