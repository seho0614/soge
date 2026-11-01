import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/components/refcode/origin';

/**
 * v10.174 (docs/268) — 검색엔진 안내(/robots.txt). 사용자 웹 전체 공개(11/1 · domain-dns #11) 뒤 처음 갖춤.
 *   공개 화면(메인 · 관 · 매물 · 소개광장 · 소개몰 · 안내)은 열고, 로그인해야 보이는 화면 · 거래 · 시험 화면 · 일회용 주소는 뺍니다.
 *   운영 화면(admin.)은 다른 도메인이라 여기와 상관없음. 사이트 지도는 /sitemap.xml.
 */
export const dynamic = 'force-dynamic';

export const DISALLOW = [
  '/api/', '/my', '/login', '/signup/done', '/verify', '/contract', '/contracts', '/deal', '/chat', '/cart-count',
  '/partner', '/partners', '/repair-inbox', '/register', '/report', '/i/', '/r/', '/go/', '/ad/', '/ai/', '/search',
  '/request/new', '/community/write', '/safety/cases/new', '/health/cart', '/health/order', '/health/seller', '/consult', '/support/history', '/support/done', '/terms/agree',
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const o = await siteOrigin();
  return { rules: [{ userAgent: '*', allow: '/', disallow: DISALLOW }], sitemap: `${o}/sitemap.xml`, host: o };
}
