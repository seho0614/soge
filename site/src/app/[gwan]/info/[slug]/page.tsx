import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet, ApiFailure } from '@/lib/api';
import { GWAN_PATH, PATH_GWAN } from '@/lib/format';
import type { Gwan } from '@/lib/types';
import { BackBar } from '@/components/common/BackBar';
import { GwanBlocks, GwanPageMenu, type GwanPageData, type GwanPageMenuItem } from '@/components/gwan/GwanBlocks';

/* v10.652 (D311 · docs/793) SB-HOM-GWN-020 관 안 페이지 — /<관 주소>/info/<주소>(새 관은 /g/<코드>/info/<주소>) · 게시된 판만 · 꺼진 관 · 숨긴 페이지는 404 */
type Props = { params: Promise<{ gwan: string; slug: string }> };

async function load(gwan: string, slug: string) {
  const code = PATH_GWAN[gwan];
  if (!code || slug === 'home' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return null;
  try {
    const page = await apiGet<GwanPageData>(`/gwans/${code}/pages/${slug}`, 60);
    return { code, page };
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 409 || e.status === 400)) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gwan, slug } = await params;
  const r = await load(gwan, slug);
  return r ? { title: r.page.title } : {};
}

export default async function GwanInfoPage({ params }: Props) {
  const { gwan, slug } = await params;
  const r = await load(gwan, slug);
  if (!r) notFound();
  const [gws, menu] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    apiGet<GwanPageMenuItem[]>(`/gwans/${r.code}/pages`, 60).catch(() => [] as GwanPageMenuItem[]),
  ]);
  const g = gws.find((x) => x.code === r.code);
  return (
    <div className="gw-wrap" style={{ paddingTop: 16, paddingBottom: 24 }} data-screen="SB-HOM-GWN-020">
      <BackBar href={`/${GWAN_PATH[r.code]}`} label={g?.name ?? r.code} wrap={false} />
      <GwanPageMenu code={r.code} items={menu} on={slug} />
      <h1>{r.page.title}</h1>
      <GwanBlocks code={r.code} page={r.page} />
    </div>
  );
}
