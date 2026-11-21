import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGet, ApiFailure } from '@/lib/api';
import { GWAN_PATH, ymdKst } from '@/lib/format';
import { getFmt } from '@/lib/getFmt';
import { areaPath, EMPTY_REGIONS, type LsqRegionList, type LsqRegionListings } from './area';

/**
 * v10.605 (docs/747) SB-HOM-LSQ-020 지역 하나의 매물 소개 — 로그인 없이(공개 GET /site/lsq/regions/listings · 5분 캐시)
 *   제목 · 한줄 소개 · 업종 · 금액 · 게시일만(등록자 · 연락처 · 상세 주소 없음) · 관 거르기 · 많이 올라온 업종 · 아래 시 · 군 · 구 · 30개씩
 *   스위치(lsq.region_pages · 처음 off)가 꺼져 있으면 「준비 중」 · 매물이 문턱보다 적은 지역은 404
 */
export async function AreaView({ sido, sigungu, gwan, page }: { sido: string; sigungu?: string; gwan?: string; page?: string }) {
  const t = await getTranslations('lsq.area');
  const f = await getFmt();
  const q = new URLSearchParams({ sido, sigungu: sigungu ?? '', gwan: gwan ?? '', page: page ?? '1' });
  let d: LsqRegionListings | null = null;
  try {
    d = await apiGet<LsqRegionListings>(`/site/lsq/regions/listings?${q.toString()}`, 300);
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 422)) notFound();
  }
  const regions = sigungu ? EMPTY_REGIONS : await apiGet<LsqRegionList>('/site/lsq/regions', 300).catch(() => EMPTY_REGIONS);
  const region = [sido, sigungu].filter(Boolean).join(' ');
  const here = (o: Record<string, string>) => `${areaPath(sido, sigungu)}?${new URLSearchParams(o).toString()}`;
  const subs = regions.sidos.find((s) => s.sido === sido)?.sigungus ?? [];
  return (
    <div className="gw-wrap lpx-page" data-screen="SB-HOM-LSQ-020" data-lsq-area={d?.enabled ? region : 'off'}>
      <p className="lpx-note"><Link href="/area">{t('back')}</Link></p>
      <h1 className="lpx-h1">{t('regionTitle', { region })}</h1>
      {!d || !d.enabled ? <p className="lpx-empty">{t('off')}</p> : (
        <>
          <p className="lpx-note">{t('regionSub', { region, n: d.total })}</p>
          <div className="lpx-row" role="group" aria-label={t('title')}>
            <Link className={`lpx-btn${!d.gwan ? ' pri' : ''}`} href={areaPath(sido, sigungu)}>{t('all')}</Link>
            {d.gwans.map((g) => <Link key={g.code} className={`lpx-btn${d!.gwan === g.code ? ' pri' : ''}`} href={here({ gwan: g.code })}>{g.name} {g.n}</Link>)}
          </div>
          {d.categories.length > 0 && <p className="lpx-stat-line">{t('categories')}: {d.categories.map((c) => `${c.name} ${c.n}`).join(' · ')}</p>}
          <ul className="lpx-list" data-lsq-area-items={d.items.length}>
            {d.items.map((x) => (
              <li key={x.id}>
                <span className="t"><Link href={`/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`}><b>{x.title}</b></Link>
                  <span className="m">{[x.categoryName, x.sigungu, x.summary, ymdKst(x.updatedAt)].filter(Boolean).join(' · ')}</span></span>
                <span className="m">{x.dealAmount ? t('deal', { v: f.won(x.dealAmount) }) : ''}{x.desiredFee ? ` · ${t('fee', { v: f.won(x.desiredFee) })}` : ''}</span>
              </li>
            ))}
          </ul>
          {d.pages > 1 && (
            <p className="lpx-row">
              {d.page > 1 && <Link className="lpx-btn" href={here({ ...(d.gwan ? { gwan: d.gwan } : {}), page: String(d.page - 1) })}>{t('prev')}</Link>}
              <span className="lpx-note">{t('page', { page: d.page, pages: d.pages })}</span>
              {d.page < d.pages && <Link className="lpx-btn" href={here({ ...(d.gwan ? { gwan: d.gwan } : {}), page: String(d.page + 1) })}>{t('next')}</Link>}
            </p>
          )}
          {subs.length > 0 && (
            <>
              <h2 className="lpx-h2">{t('sigungus')}</h2>
              <p className="lpx-row">{subs.map((g) => <Link key={g.name} className="lpx-btn" href={areaPath(sido, g.name)}>{g.name} {g.n}</Link>)}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
