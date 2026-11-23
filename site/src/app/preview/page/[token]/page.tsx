import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGetPublic, ApiFailure } from '@/lib/api';
import { GwanBlocks, type GwanPageData } from '@/components/gwan/GwanBlocks';

/* v10.666 (D315 · docs/795) SB-HOM-GWN-030 관 페이지 미리보기 — 운영 화면 › 관 관리 › 관 페이지 › 「미리보기 링크」로 만든 주소
 *   로그인 없이 · 링크가 살아 있는 동안(처음 24시간) 지금 초안 · 검색엔진은 막음(noindex · robots /preview/) · 캐시 없음 · 끝났거나 끊긴 링크는 404 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '미리보기', robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };
type Preview = GwanPageData & { gwanCode: string; lang: string; expiresAt: string };

export default async function PagePreview({ params }: Props) {
  const { token } = await params;
  if (!/^[0-9a-f]{40}$/.test(token)) notFound();
  let p: Preview;
  try {
    p = await apiGetPublic<Preview>(`/gwan-pages/preview/${token}`, 0);
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) notFound();
    throw e;
  }
  return (
    <div className="gw-wrap" style={{ paddingTop: 16, paddingBottom: 24 }} data-screen="SB-HOM-GWN-030" data-preview lang={p.lang ?? 'ko'}>
      <p className="card warn" role="status" style={{ marginBottom: 12 }}>
        <b>미리보기 — 아직 게시하지 않은 초안입니다.</b> 이 링크는 {new Date(p.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 열립니다.
      </p>
      {p.slug !== 'home' && <h1>{p.title}</h1>}
      <GwanBlocks code={p.gwanCode} page={{ ...p, version: 0, publishedAt: '' }} />
    </div>
  );
}
