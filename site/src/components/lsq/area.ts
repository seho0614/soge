/**
 * v10.605 (docs/747) 지역별 소개 — 사용자 웹 공용(형 · 주소 · 사이트 지도 줄)
 *   주소: /area · /area/{시도} · /area/{시도}/{시군구} (한글 이름을 그대로 encodeURIComponent)
 */
export interface LsqRegionList {
  enabled: boolean; min: number;
  sidos: Array<{ code: string; sido: string; n: number; at: string; sigungus: Array<{ name: string; n: number; at: string }> }>;
}
export interface LsqRegionListings {
  enabled: boolean; sido: string; sigungu: string | null; gwan?: string | null; total: number; page: number; pages: number;
  items: Array<{ id: string; gwanCode: string; title: string; summary: string | null; categoryName: string | null; sigungu: string | null; dealAmount: string | null; desiredFee: string | null; updatedAt: string }>;
  gwans: Array<{ code: string; name: string; n: number }>; categories: Array<{ name: string; n: number }>;
}
export const EMPTY_REGIONS: LsqRegionList = { enabled: false, min: 3, sidos: [] };

export const areaPath = (sido: string, sigungu?: string | null) =>
  `/area/${encodeURIComponent(sido)}${sigungu ? `/${encodeURIComponent(sigungu)}` : ''}`;

/** 사이트 지도 줄 — 켜져 있을 때만(꺼져 있으면 빈 배열) */
export function lsqAreaEntries(origin: string, r: LsqRegionList) {
  if (!r.enabled) return [];
  return [
    { url: `${origin}/area`, changeFrequency: 'daily' as const, priority: 0.6 },
    ...r.sidos.flatMap((s) => [
      { url: origin + areaPath(s.sido), lastModified: new Date(s.at), changeFrequency: 'daily' as const, priority: 0.6 },
      ...s.sigungus.map((g) => ({ url: origin + areaPath(s.sido, g.name), lastModified: new Date(g.at), changeFrequency: 'weekly' as const, priority: 0.5 })),
    ]),
  ];
}
