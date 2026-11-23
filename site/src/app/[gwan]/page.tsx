import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { isGwanKey } from '@/i18n/keys';
import { apiGet } from '@/lib/api';
import type { Gwan, ListingListData } from '@/lib/types';
import { ListingList } from '@/components/ListingList';
import { GWAN_PATH, PATH_GWAN, isFixedGwan, safeSort } from '@/lib/format';
import { SecHead, ShopMain } from '@/components/shop/ShopMain';
import { GwanLanding } from '@/components/gwan/GwanLanding';
import { MoneyMain } from '@/components/money/MoneyMain';
import { HltBand } from '@/components/health/HltParts';
import { GwanBlocks, GwanPageMenu, type GwanPageData, type GwanPageMenuItem } from '@/components/gwan/GwanBlocks';   // v10.652 (D311)
import '@/styles/mal.css';

type Props = {
  params: Promise<{ gwan: string }>;
  searchParams: Promise<{ sort?: string; cursor?: string; badge?: string; axis?: string; cat?: string; grade?: string; keyword?: string; p?: string;
    /* v10.31 (w2) — 지역 · 소개창업 축의 갈래(d) · 초단기(hot) */ region?: string; d?: string; hot?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gwan } = await params;
  const code = PATH_GWAN[gwan];
  if (!code) return {};
  const list = await apiGet<Gwan[]>('/gwans', 300).catch(() => []);
  const g = list.find((x) => x.code === code);
  const t = await getTranslations('gwan.page');
  const [locale, th] = await Promise.all([getLocale(), getTranslations('header.gwan')]);
  /* v10.97 — 관 이름: 한국어는 서버 이름 · 다른 언어만 사전 */
  return { title: locale !== 'ko' && isGwanKey(code) ? th(code) : g?.name ?? t('fallbackTitle'), description: g?.description ?? undefined };
}

/** SB-{G}-MAIN-010 · SB-{G}-LST-010 — 관 랜딩 겸 목록 */
export default async function GwanPage({ params, searchParams }: Props) {
  const { gwan } = await params;
  const q0 = await searchParams;
  const q = { ...q0, sort: safeSort(q0.sort) };
  const code = PATH_GWAN[gwan];
  if (!code) notFound();
  /* v10.646 (D309 · docs/791) 새 관 — 고정 표에 없는 관은 켠 관(/gwans)이고 허브가 아닐 때만 · 주소는 /g/<코드 소문자> 하나로 */
  if (!isFixedGwan(code)) {
    const on = await apiGet<Gwan[]>('/gwans', 300).catch(() => []);
    if (!on.some((x) => x.code === code && !x.isHub)) notFound();
  }
  /* v10.29 — 소개장터 · 안심소개 · 소개창업 첫 화면은 시안 배치(gwanLanding)로 그립니다(components/gwan/GwanLanding).
   *   안심소개의 「상담 축 통합」(?axis=consult · D005)도 그 안에 그대로 있습니다. 소개몰(HLT)만 아래 전용 메인입니다. */
  /* v10.30 — 소개장터 첫 화면만 2026-10-09 제시 디자인입니다(components/money/MoneyMain · 10/9 답 ①~④).
   *   v10.29 의 관 화면 부품 · 조회 규칙은 그 화면 아래 「지금 있던 구역」(#mny-list)에 그대로 씁니다. 안심소개 · 소개창업은 v10.29 그대로입니다. */
  /* v10.652 (D311 · docs/793) 관 안 페이지 메뉴(게시된 것이 있을 때만 · 없으면 아무것도 안 그림) */
  const menu = await apiGet<GwanPageMenuItem[]>(`/gwans/${code}/pages`, 60).catch(() => [] as GwanPageMenuItem[]);
  const pm = menu.length ? <div className="gw-wrap"><GwanPageMenu code={code} items={menu} /></div> : null;
  if (code === 'MNY') return <><MoneyMain q={q0} />{pm}</>;
  if (code === 'MAL' || code === 'BIZ') return <><GwanLanding code={code} q={q0} />{pm}<i hidden data-root-end="" /></>;
  /* v10.652 새 관 — 게시된 첫 화면(home)이 있으면 블록으로 그림(없으면 아래 일반 화면) */
  const home = !isFixedGwan(code) ? await apiGet<GwanPageData>(`/gwans/${code}/pages/home`, 60).catch(() => null) : null;
  if (home) return <div className="gw-wrap" style={{ paddingTop: 16, paddingBottom: 24 }} data-screen="SB-HOM-GWN-010"><GwanPageMenu code={code} items={menu} /><GwanBlocks code={code} page={home} /></div>;

  const qs = new URLSearchParams({ gwanCode: code, limit: '20' });
  if (q.sort) qs.set('sort', q.sort);
  if (q.cursor) qs.set('cursor', q.cursor);
  if (q.badge) qs.set('badge', q.badge);

  const data = await apiGet<ListingListData>(`/listings?${qs}`);
  const gwans = await apiGet<Gwan[]>('/gwans', 300).catch(() => []);
  const g = gwans.find((x) => x.code === code);
  const t = await getTranslations('gwan');
  /* v10.97 — 빠른 탭 이름은 사전(값 · 주소는 그대로) */
  const tabs = [['', t('page.all')], ['URGENT', t('badge.URGENT')], ['VERIFIED_DOC', t('badge.VERIFIED_DOC')]];
  /* 20261007 (v10.25) — 소개몰(HLT)은 제시 디자인의 메인을 씁니다(components/shop/ShopMain). 도매 · 납품 매물 목록은 그 아래 한 구역으로 남깁니다(지금 있던 것). */
  if (code === 'HLT') {
    return (
      <><div className="shop">
        <HltBand />
        <ShopMain />
        <div className="shop-in">
          <section className="shop-sec" data-shop-listings="1">
            <SecHead title={t('page.hltTitle')} lead={t('page.hltLead')} />
            <div className="quick" style={{ margin: '0 10px 14px' }}>
              {tabs.map(([v, l]) => (
                <a key={l} href={`/${gwan}${v ? `?badge=${v}` : ''}`} className={q.badge === v || (!q.badge && !v) ? 'on' : ''}>{l}</a>
              ))}
            </div>
            <ListingList data={data} />
            {data.nextCursor && (
              <a className="more" href={`/${gwan}?${new URLSearchParams({ ...(q.sort ? { sort: q.sort } : {}), ...(q.badge ? { badge: q.badge } : {}), cursor: data.nextCursor })}`}>{t('page.more')}</a>
            )}
          </section>
        </div>
      </div>{pm}<i hidden data-root-end="" /></>
    );
  }

  return (
    <>
      {pm}
      <div className="page-head">
        <h1>{g?.name ?? t('page.fallbackTitle')}</h1>
        <div className="quick">
          {tabs.map(([v, l]) => (
            <a key={l} href={`/${GWAN_PATH[code]}${v ? `?badge=${v}` : ''}`}
               className={q.badge === v || (!q.badge && !v) ? 'on' : ''}>{l}</a>
          ))}
        </div>
      </div>
      <ListingList data={data} />
      {data.nextCursor && (
        <a className="more" href={`/${GWAN_PATH[code]}?${new URLSearchParams({ ...(q.sort ? { sort: q.sort } : {}), ...(q.badge ? { badge: q.badge } : {}), cursor: data.nextCursor })}`} /* 20261001 — 정렬·배지를 이어 붙입니다. 빠지면 2쪽이 다른 정렬의 커서로 500 이었습니다 */>
          {t('page.more')}
        </a>
      )}
    </>
  );
}
