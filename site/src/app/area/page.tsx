import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { areaPath, EMPTY_REGIONS, type LsqRegionList } from '@/components/lsq/area';
import '@/styles/lpx.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lsq.area');
  return { title: t('title'), description: t('sub') };
}

/**
 * v10.605 (docs/747) SB-HOM-LSQ-010 지역별 소개 — 로그인 없이(공개 GET /site/lsq/regions · 5분 캐시)
 *   시 · 도와 그 아래 시 · 군 · 구(게시 매물 lsq.region_min 개 이상만) · 누르면 그 지역 매물(/area/{시도}/{시군구})
 *   스위치(lsq.region_pages · 처음 off)가 꺼져 있으면 「준비 중」 · JS 없이 링크만
 */
export default async function AreaIndexPage() {
  const t = await getTranslations('lsq.area');
  const d = await apiGet<LsqRegionList>('/site/lsq/regions', 300).catch(() => EMPTY_REGIONS);
  return (
    <div className="gw-wrap lpx-page" data-screen="SB-HOM-LSQ-010" data-lsq-areas={d.enabled ? d.sidos.length : 'off'}>
      <h1 className="lpx-h1">{t('title')}</h1>
      <p className="lpx-note">{t('sub')}</p>
      {!d.enabled ? <p className="lpx-empty">{t('off')}</p> : d.sidos.length === 0 ? <p className="lpx-empty">{t('none')}</p> : (
        <ul className="lpx-list">
          {d.sidos.map((s) => (
            <li key={s.sido}>
              <span className="t"><Link href={areaPath(s.sido)}><b>{s.sido}</b></Link><span className="m">{t('count', { n: s.n })}</span></span>
              <span className="m">{s.sigungus.slice(0, 12).map((g, i) => <span key={g.name}>{i ? ' · ' : ''}<Link href={areaPath(s.sido, g.name)}>{g.name}</Link></span>)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
