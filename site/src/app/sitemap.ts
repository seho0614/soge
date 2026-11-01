import type { MetadataRoute } from 'next';
import { apiGet } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import { siteOrigin } from '@/components/refcode/origin';

/**
 * v10.174 (docs/268) — 사이트 지도(/sitemap.xml). 공개 화면 + 서버가 고른 공개 주소(GET /sitemap-entries — 주소 조각 · 바뀐 시각만).
 *   API 가 죽어 있어도 고정 화면만으로 응답(검색엔진이 빈 파일 · 오류를 받지 않게). 1시간 캐시.
 */
export const dynamic = 'force-dynamic';

type Entries = {
  listings: Array<{ id: string; gwan: string; at: string }>;
  posts: Array<{ id: string; at: string }>;
  products: Array<{ code: string; at: string }>;
};
const STATIC: Array<[string, MetadataRoute.Sitemap[number]['changeFrequency'], number]> = [
  ['/', 'daily', 1], ['/money', 'daily', 0.9], ['/mall', 'daily', 0.9], ['/biz', 'daily', 0.9], ['/health', 'daily', 0.9],
  ['/listings', 'daily', 0.8], ['/community', 'daily', 0.8], ['/request', 'daily', 0.7], ['/guide', 'monthly', 0.5],
  ['/safety/guide', 'monthly', 0.5], ['/support/new', 'monthly', 0.3], ['/terms', 'monthly', 0.3],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const o = await siteOrigin();
  const e = await apiGet<Entries>('/sitemap-entries', 3600).catch(() => ({ listings: [], posts: [], products: [] }) as Entries);
  const at = (v: string) => new Date(v);
  return [
    ...STATIC.map(([p, changeFrequency, priority]) => ({ url: o + p, changeFrequency, priority })),
    ...e.listings.filter((l) => GWAN_PATH[l.gwan]).map((l) => ({ url: `${o}/${GWAN_PATH[l.gwan]}/${l.id}`, lastModified: at(l.at), changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...e.posts.map((p) => ({ url: `${o}/community/${p.id}`, lastModified: at(p.at), changeFrequency: 'weekly' as const, priority: 0.5 })),
    ...e.products.map((p) => ({ url: `${o}/health/p/${encodeURIComponent(p.code)}`, lastModified: at(p.at), changeFrequency: 'weekly' as const, priority: 0.6 })),
  ];
}
