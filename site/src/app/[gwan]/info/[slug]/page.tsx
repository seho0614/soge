import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet, ApiFailure } from '@/lib/api';
import { GWAN_PATH, PATH_GWAN } from '@/lib/format';
import type { Gwan } from '@/lib/types';
import { BackBar } from '@/components/common/BackBar';
import { siteOrigin } from '@/components/refcode/origin';
import { GwanBlocks, GwanPageMenu, type GwanPageData, type GwanPageMenuItem } from '@/components/gwan/GwanBlocks';
import { ViewPing } from '@/components/gwan/ViewPing';   // v10.667 (D315) 방문 수

/* v10.652 (D311 · docs/793) SB-HOM-GWN-020 관 안 페이지 — /<관 주소>/info/<주소>(새 관은 /g/<코드>/info/<주소>) · 게시된 판만 · 꺼진 관 · 숨긴 페이지는 404 */
type Props = { params: Promise<{ gwan: string; slug: string }> };

async function load(gwan: string, slug: string): Promise<{ code: string; page: GwanPageData; login?: false } | { code: string; login: true } | null> {
  const code = PATH_GWAN[gwan];
  if (!code || slug === 'home' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return null;
  try {
    const page = await apiGet<GwanPageData>(`/gwans/${code}/pages/${slug}`, 60);
    return { code, page };
  } catch (e) {
    /* v10.691 (D320) 회원만 페이지 — 로그인 안 했으면 403 GWAN_PAGE_LOGIN → 로그인 안내 */
    if (e instanceof ApiFailure && e.status === 403 && (e.body as { code?: string })?.code === 'GWAN_PAGE_LOGIN') return { code, login: true };
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 409 || e.status === 400)) return null;
    throw e;
  }
}

/* v10.658 (docs/794) 검색엔진 정보 — 설명(머리 띠 설명 → 첫 글) · 대표 그림(첫 사진 · 배경) · 정식 주소 · 언어 */
const plain = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/^\s*-\s+/gm, '').replace(/\s+/g, ' ').trim();
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gwan, slug } = await params;
  const r = await load(gwan, slug);
  if (!r) return {};
  if (r.login) return { title: '회원만 볼 수 있는 페이지', robots: { index: false, follow: false } };   // v10.691
  const bl = r.page.blocks ?? [];
  /* v10.692 (D320) 직접 쓴 설명 · 그림이 있으면 그것(없으면 블록에서 자동) */
  const desc = (r.page.seoDescription || plain(String(bl.find((b) => b.type === 'HERO' && b.sub)?.sub ?? bl.find((b) => b.type === 'TEXT')?.body ?? bl.find((b) => b.type === 'FAQ')?.items?.[0]?.a ?? ''))).slice(0, 160);
  const img = (r.page.seoImage || bl.find((b) => b.type === 'IMAGE')?.src || bl.find((b) => b.type === 'HERO' && b.image)?.image || bl.find((b) => b.type === 'GALLERY')?.items?.[0]?.src) as string | undefined;
  const o = await siteOrigin();
  const path = `/${GWAN_PATH[r.code]}/info/${slug}`;
  const abs = (u: string) => (u.startsWith('/') ? o + u : u);
  return {
    title: r.page.title, ...(desc ? { description: desc } : {}),
    ...(r.page.noindex || r.page.visibility === 'MEMBER' ? { robots: { index: false, follow: false } } : {}),   // v10.692 · 691
    alternates: { canonical: o + path },
    openGraph: { title: r.page.title, ...(desc ? { description: desc } : {}), url: o + path, type: 'article', ...(img && /^(\/|https:\/\/)/.test(img) ? { images: [abs(img)] } : {}) },
  };
}

export default async function GwanInfoPage({ params }: Props) {
  const { gwan, slug } = await params;
  const r = await load(gwan, slug);
  if (!r) notFound();
  if (r.login) return (   /* v10.691 (D320) 회원만 페이지 — 로그인 안내(본문은 내려오지 않음) */
    <div className="gw-wrap" style={{ paddingTop: 16, paddingBottom: 24 }} data-screen="SB-HOM-GWN-020" data-gwan-page-login>
      <BackBar href={`/${GWAN_PATH[r.code]}`} label={r.code} wrap={false} />
      <div className="card pad"><h1 style={{ marginTop: 0 }}>회원만 볼 수 있는 페이지입니다</h1>
        <p>로그인하면 바로 볼 수 있습니다.</p>
        <Link className="btn-ok" href={`/login?next=${encodeURIComponent(`/${GWAN_PATH[r.code]}/info/${slug}`)}`}>로그인</Link></div>
    </div>);
  const [gws, menu] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    apiGet<GwanPageMenuItem[]>(`/gwans/${r.code}/pages`, 60).catch(() => [] as GwanPageMenuItem[]),
  ]);
  const g = gws.find((x) => x.code === r.code);
  return (
    <div className="gw-wrap" style={{ paddingTop: 16, paddingBottom: 24 }} data-screen="SB-HOM-GWN-020" lang={r.page.lang ?? 'ko'}>
      <BackBar href={`/${GWAN_PATH[r.code]}`} label={g?.name ?? r.code} wrap={false} />
      <GwanPageMenu code={r.code} items={menu} on={slug} />
      <h1>{r.page.title}</h1>
      <GwanBlocks code={r.code} page={r.page} />
      <ViewPing code={r.code} slug={slug} />
    </div>
  );
}
