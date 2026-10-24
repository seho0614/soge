/**
 * v10.29 — SB-MNY-MAIN-010 · SB-MAL-MAIN-010 · SB-BIZ-MAIN-010 관 첫 화면 — 시안 gwanLanding() 배치 그대로.
 *
 *   검색줄 + 띠 광고 → (소개장터) 소개하기 · 소개받고 싶어요 · 소개받기 + 퀵메뉴 / (안심소개 · 소개창업) 축 탭
 *   → 왼쪽: 지역 설정 · 상품 분류(골든 · 실버 · 브론즈) · 내 목록 · 등록
 *   → 오른쪽: (축) 급매 띠 · 찾기(상품 구분 · 상품 분류) · 검색 조건 줄 · 사진 카드 · 건수/쪽/정렬 · (축) 먼저 확인할 것
 *   → 아래 안내 6칸
 *
 * v10.31 (w2 · 10/10 「시안 기준」)
 *   · 축 — 시안 AX 그대로.
 *       안심소개 3축: 기계 · 설비 · 시설(실물자산형 · 분류 axis=EQUIP 7개 신설) · 부동산(등기자산형 · 「A-07 법무 회신 대기」 · 노출료) · 생활 · 금융 상담.
 *       소개창업 4축: 창업(거래형) · 인력(매칭형 · 「도급만 · 개인 노출 없음」) · 운영지원(서비스형) · 정보(콘텐츠형) — 서버 GET /biz/axis/* (GwBizAxes).
 *       주소: /mall(기계 · 설비) · /mall?axis=realty · /mall?axis=consult · /biz · /biz?axis=jobs|advisory|info (예전 ?axis=listing 도 받음).
 *       v10.31 합침 — 축 이름 · 성격 · 판정 · 규제 · 노출 여부는 운영 「관 UI/UX 관리」(GET /site/gwan-axes · w6 D083)를 따릅니다(못 받으면 시안 정의).
 *   · 지역 설정 — 서버의 시 · 도로 목록을 실제로 거릅니다(?region= → GET /listings?regionCode=).
 *   · 쪽 번호 — 서버 건수로 전체(?p=). 정렬 — 시안 「소개비순 · 마감임박 · 소개비율 · 최신」 + 인기.
 *   · 관 중지 안내(F-6) — GET /gwans 는 중지한 관을 빼고 줍니다. 목록은 왔는데 이 관이 없으면 중지로 봅니다(소개장터 메인과 같은 판정).
 *   · 좁은 화면 찾기 칸(F-8) — .gw-find.gw-narrow 로 900px 아래에서 한 줄에 하나씩(styles/proto-gwan.css 끝).
 *   · 오른쪽 아래 떠 있는 광고(칸 FLOAT · 시안 AD_FLOAT) · 제한 업종 분류는 공개 분류 목록에서 숨김.
 *   · 생활 · 금융 상담 축의 비로그인 안내 — 「인증업체 등록」 · 「입점 상태 보기」 두 단추(개발에만 있던 것 · 시안 모양 안에 남김 · srv_consult_ui UI-6-2).
 *
 * 자료는 전부 서버 것입니다 — 매물 GET /listings · 분류 GET /categories · 건수 GET /gwans(listingCount) · 지역 GET /market/regions ·
 *   안심소개 상담 업종 GET /consult/categories · 입점 여부 GET /partner/dashboard · 광고 GET /ads/serve?slot=FLOAT.
 */
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { safeSort } from '@/lib/format';
import type { Gwan, ListingCardData, ListingListData } from '@/lib/types';
import type { AdServe } from '@/components/home/types';
import type { MarketRegions } from '@/components/market/types';
import { ConsultRows } from '@/components/mal/ConsultRows';
import { SAFE_CONSULT } from '@/components/mal/copy';
import type { ConsultCat, PartnerDash, PublicSettings } from '@/components/mal/types';
import { GW, GRADES, SORTS, qhref, type GwanCode } from './gw';
import { GwGrid } from './GwCard';
import { CatEmpty, Features, GwFrame, GwSide, Pager, QuickMenu, RoleTabs, SearchRow, type GwCategory } from './GwParts';
import { GradeCat, SortSelect } from './GwClient';
import { GwFloatAd } from './GwAds';
import { AxisInfo, AxisJob, AxisSvc } from './GwBizAxes';

export interface GwQuery {
  sort?: string; cursor?: string; badge?: string; axis?: string; cat?: string; grade?: string; keyword?: string; p?: string;
  region?: string; d?: string; hot?: string;
}

const BADGES = new Set(['URGENT', 'VERIFIED_DOC']);
const PER = 6;   // 시안 pgSlice — 한 쪽 6칸

interface Axis {
  k: string; nm: string; sub: string; judge: string; why?: string; urg?: string; safe?: string[];
  /** 서버 분류 축(GET /listings?axis=) — 매물 목록형 축만 */
  catAxis?: 'EQUIP' | 'RE';
  /** 목록형이 아닌 축의 본문 */
  body?: 'consult' | 'jobs' | 'advisory' | 'info';
  gate?: string; open?: boolean; openNote?: string;
}

/** 축 — 시안 AX 그대로(이름 · 부제 · 판정 · 이유 · 급매 띠 · 먼저 확인할 것) · v10.97 글은 사전 gwan.axes.* */
type GwanT = Awaited<ReturnType<typeof getTranslations<'gwan'>>>;
function axesFor(t: GwanT): Record<'MAL' | 'BIZ', { nm: string; why: string; tabs: Axis[] }> {
  return {
    MAL: { nm: t('axes.MAL.nm'), why: t('axes.MAL.why'), tabs: [
      { k: 'equip', nm: t('axes.MAL.equip.nm'), sub: t('axes.MAL.equip.sub'), catAxis: 'EQUIP', judge: t('axes.MAL.equip.judge'), urg: t('axes.MAL.equip.urg'),
        safe: [t('axes.MAL.equip.s1'), t('axes.MAL.equip.s2'), t('axes.MAL.equip.s3')] },
      { k: 'realty', nm: t('axes.MAL.realty.nm'), sub: t('axes.MAL.realty.sub'), catAxis: 'RE', gate: t('axes.MAL.realty.gate'), judge: t('axes.MAL.realty.judge'), urg: t('axes.MAL.realty.urg'),
        safe: [t('axes.MAL.realty.s1'), t('axes.MAL.realty.s2'), t('axes.MAL.realty.s3'), t('axes.MAL.realty.s4')] },
      { k: 'consult', nm: t('axes.MAL.consult.nm'), sub: t('axes.MAL.consult.sub'), body: 'consult', judge: t('axes.MAL.consult.judge'),
        why: t('axes.MAL.consult.why'), safe: SAFE_CONSULT },
    ] },
    BIZ: { nm: t('axes.BIZ.nm'), why: t('axes.BIZ.why'), tabs: [
      { k: 'listing', nm: t('axes.BIZ.listing.nm'), sub: t('axes.BIZ.listing.sub'), judge: t('axes.BIZ.listing.judge'), urg: t('axes.BIZ.listing.urg'),
        safe: [t('axes.BIZ.listing.s1'), t('axes.BIZ.listing.s2'), t('axes.BIZ.listing.s3')] },
      { k: 'jobs', nm: t('axes.BIZ.jobs.nm'), sub: t('axes.BIZ.jobs.sub'), body: 'jobs', gate: t('axes.BIZ.jobs.gate'), open: true, openNote: t('axes.BIZ.jobs.openNote'),
        judge: t('axes.BIZ.jobs.judge') },
      { k: 'advisory', nm: t('axes.BIZ.advisory.nm'), sub: t('axes.BIZ.advisory.sub'), body: 'advisory', judge: t('axes.BIZ.advisory.judge') },
      { k: 'info', nm: t('axes.BIZ.info.nm'), sub: t('axes.BIZ.info.sub'), body: 'info', judge: t('axes.BIZ.info.judge') },
    ] },
  };
}

/** v10.31 (합침 · w6 D083) — 운영 「관 UI/UX 관리」의 축(GET /site/gwan-axes · 노출 중인 것만). 화면 키 ↔ 서버 축 코드 */
const AXIS_CODE: Record<string, string> = { equip: 'ASSET', realty: 'RE', consult: 'CONSULT', listing: 'STARTUP', jobs: 'STAFF', advisory: 'SUPPORT', info: 'INFO' };
interface ServerAxis { axisCode: string; name: string; nature: string | null; judge: string | null; urgentLabel: string | null; regulation: string | null; isExposed: boolean }

/** 서버 축 값(이름 · 성격 · 판정 · 급매 띠 · 규제)을 시안 정의 위에 얹고, 운영이 노출을 내린 축은 뺍니다.
 *  서버 답을 못 받거나 비면 시안 정의 그대로(첫 축은 늘 남김 — 관 화면이 비지 않게). */
/*  v10.97 — 서버 축 글(이름 · 성격 · 판정 · 급매 띠 · 규제)은 한국어일 때만 얹습니다. 다른 언어는 사전 글 · 노출 여부만 서버를 따름 */
function withServerAxes(def: { nm: string; why: string; tabs: Axis[] }, rows: ServerAxis[] | null, ko = true) {
  if (!rows || rows.length === 0) return def;
  const by = new Map(rows.map((r) => [r.axisCode, r]));
  const tabs = def.tabs.flatMap((t, i) => {
    const r = by.get(AXIS_CODE[t.k] ?? '');
    if (!r) return i === 0 ? [t] : [];
    if (!ko) return [t];
    return [{ ...t, nm: r.name || t.nm, sub: r.nature || t.sub, judge: r.judge || t.judge,
      urg: r.urgentLabel ?? t.urg, gate: r.regulation || t.gate }];
  });
  return { ...def, tabs };
}

export async function GwanLanding({ code, q }: { code: GwanCode; q: GwQuery }) {
  const g = GW[code];
  const t = await getTranslations('gwan');
  const locale = await getLocale();
  const gname = t(`meta.${code}.name`), gsect = t(`meta.${code}.sect`), gallcat = t(`meta.${code}.allcat`);
  const base = `/${g.path}`;
  const serverAxes = code === 'MNY' ? null
    : await apiGet<ServerAxis[]>(`/site/gwan-axes?gwan=${code}`, 60).catch(() => null);
  const axDef = code === 'MNY' ? null : withServerAxes(axesFor(t)[code], serverAxes, locale === 'ko');
  /* 예전 주소 ?axis=listing(안심소개 매물 전체)은 첫 축으로 */
  const ax = axDef ? (axDef.tabs.find((a) => a.k === q.axis) ?? axDef.tabs[0]) : null;
  const consult = ax?.body === 'consult';
  const region = q.region && /^(\d{10}|ETC)$/.test(q.region) ? q.region : undefined;

  const [gwans, allCats, consultCats, p, settings, regions, float] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    apiGet<(GwCategory & { restricted?: boolean; axis?: string | null })[]>(`/categories?gwanCode=${code}`, 300).catch(() => []),
    code === 'MAL' ? apiGet<ConsultCat[]>('/consult/categories', 60).catch(() => [] as ConsultCat[]) : Promise.resolve([] as ConsultCat[]),
    me().catch(() => null),
    code === 'MAL' ? apiGet<PublicSettings>('/site-settings/public', 60).catch(() => ({} as PublicSettings)) : Promise.resolve({} as PublicSettings),
    apiGet<MarketRegions>(`/market/regions?gwanCode=${code}`, 60).catch(() => null),
    apiGetPersonal<AdServe>('/ads/serve?slot=FLOAT').catch(() => null),
  ]);
  const gw = gwans.find((x) => x.code === code);
  /* F-6 — GET /gwans 는 중지한 관을 빼고 줍니다. 목록은 왔는데 이 관이 없으면 중지(목록 자체를 못 받은 것은 중지로 보지 않음) */
  const stopped = (gw && !gw.isActive) || (!gw && gwans.length > 0);
  const dash = code === 'MAL' && p ? await apiGetPersonal<PartnerDash>('/partner/dashboard').catch(() => null) : null;
  const partner = dash?.status === 'ACTIVE';

  /* 이 축의 매물 분류 — 안심소개는 서버 분류의 axis(EQUIP · RE)로 나눔. 제한 업종은 공개 분류 목록에서 숨김(v10.31) */
  const consultIds = new Set(consultCats.map((c) => c.id));
  const cats = allCats.filter((c) => !consultIds.has(c.id) && !c.restricted && (!ax?.catAxis || c.axis === ax.catAxis));
  const cat = cats.find((c) => c.id === q.cat);
  const grade = GRADES.find((x) => x.code === q.grade && cats.some((c) => c.gradeCode === x.code)) ? q.grade : undefined;
  const badge = q.badge && BADGES.has(q.badge) ? q.badge : undefined;
  const sort = safeSort(q.sort);
  const keyword = (q.keyword ?? '').trim().slice(0, 50) || undefined;
  const page = Math.max(1, Number(q.p) || 1);
  const axisParam = ax && ax !== axDef?.tabs[0] ? ax.k : undefined;
  const keep = { axis: axisParam, sort, badge, cat: cat?.id, grade, keyword, region };
  const listing = !!ax ? !ax.body : true;

  /* 구분(등급)만 고르면 그 구분의 분류로 거릅니다 — 목록 API 는 분류 하나만 받으므로, 여러 분류면 한 번에 받아 화면에서 거릅니다. */
  const gradeCats = grade && !cat ? cats.filter((c) => c.gradeCode === grade) : null;
  let data: ListingListData | null = null;
  let organic: ListingCardData[] = [];
  if (listing && !stopped) {
    const qs = new URLSearchParams({ gwanCode: code, limit: String(gradeCats ? 50 : PER) });
    if (sort) qs.set('sort', sort);
    if (q.cursor && !gradeCats) qs.set('cursor', q.cursor); else if (!gradeCats) qs.set('page', String(page));
    if (badge) qs.set('badge', badge);
    if (cat) qs.set('categoryId', cat.id);
    else if (gradeCats?.length === 1 && gradeCats[0]) qs.set('categoryId', gradeCats[0].id);
    if (keyword) qs.set('keyword', keyword);
    if (region) qs.set('regionCode', region);
    if (ax?.catAxis) qs.set('axis', ax.catAxis);
    data = gradeCats && gradeCats.length === 0
      ? { promoted: [], organic: [], nextCursor: null, adNotice: '' }
      : await apiGet<ListingListData>(`/listings?${qs}`).catch(() => null);
    if (data) {
      const names = gradeCats ? new Set(gradeCats.map((c) => c.name)) : null;
      organic = names ? data.organic.filter((x) => names.has(x.categoryName)) : data.organic;
      if (gradeCats) data = { ...data, nextCursor: null, pageCount: undefined };
    }
  }

  const gradeX = grade ? GRADES.find((x) => x.code === grade) : undefined;
  const gradeNm = gradeX ? t(`grade.${gradeX.code}.nm`) : undefined;
  const regionNm = region ? (region === 'ETC' ? t('region.etc') : regions?.all.find((x) => x.code === region)?.name) : undefined;
  const sel = [regionNm, gradeNm, cat?.name, badge === 'URGENT' ? t('badge.URGENT') : badge === 'VERIFIED_DOC' ? t('badge.VERIFIED_DOC') : undefined, keyword && t('landing.quote', { keyword })].filter(Boolean).join(' · ');
  const sortHrefs = Object.fromEntries(SORTS.map(([v]) => [v, qhref(base, { ...keep, sort: v === 'RECENT' ? undefined : v })]));
  const register = code === 'MAL'
    ? (partner
      ? [{ href: '/register', label: t('landing.registerPartner'), role: 'partner' }, { href: '/partner/listings', label: t('landing.myPartnerListings') }]
      : [{ href: '/mall/give', label: t('landing.registerGive'), role: 'member' }])
    : undefined;
  const axHref = (t: Axis) => (t === axDef?.tabs[0] ? base : qhref(base, { axis: t.k }));
  const allTotal = data?.total ?? gw?.listingCount ?? 0;

  return (
    <GwFrame code={code}>
      <div className="gw-wrap" style={{ paddingTop: 13 }}>
        <h1 className="gw-sr">{locale === 'ko' ? gw?.name ?? gname : gname}</h1>{/* 시안에는 보이는 제목이 없어 읽기 프로그램용으로만 둡니다(시안 .sr) */}
        <SearchRow code={code} />

        {code === 'MNY' && (
          <div className="gw-rrow"><RoleTabs /><QuickMenu /></div>
        )}

        {stopped ? (
          <div className="gw-taboff" role="status" data-gwan-off="1">{t.rich('landing.stopped', { name: gname, b: (c) => <b>{c}</b> })}</div>
        ) : (
          <>
            {axDef && ax && (
              <div className="gw-axw">
                <div className="gw-axbar" role="tablist" aria-label={axDef.nm}>
                  {axDef.tabs.map((t) => (
                    <Link key={t.k} role="tab" aria-selected={t.k === ax.k} className={`gw-axt${t.k === ax.k ? ' gw-on' : ''}${t.gate && !t.open ? ' gw-gate' : ''}`}
                          href={axHref(t)} data-axis={t.k}>
                      <b>{t.nm}</b><span>{t.sub}</span>
                      {t.gate && <i className={`gw-axg${t.open ? ' gw-ok' : ''}`}>{t.gate}</i>}
                    </Link>
                  ))}
                </div>
                <div className="gw-axnote">
                  <b>{ax.nm}</b> — {ax.judge} <span className="gw-ls">{ax.why ?? axDef.why}</span>
                  {ax.gate && (ax.open
                    ? <span className="gw-axw2 gw-ok">{t('landing.axOpen', { note: ax.openNote ?? ax.gate })}</span>
                    : <span className="gw-axw2">{t('landing.axGated', { gate: ax.gate })}</span>)}
                  {code === 'MAL' && ax.catAxis === 'RE' && (
                    <span className="gw-axbrk"><b>{t('landing.brokerTitle')}</b>
                      <span>{t('landing.brokerBody')}</span>
                      <Link className="gw-bo gw-sm" href="/mal/brokers">{t('landing.brokerLink')}</Link></span>
                  )}
                </div>
              </div>
            )}

            {code === 'MAL' && (
              /* 인증업체만 게시 — 운영 스위치(mal.partner_only)를 그대로 알립니다(개발에만 있는 안내 · 시안 모양 안에 둠) */
              <p className={`gw-po${settings['mal.partner_only'] === 'on' ? ' gw-on' : ''}`} data-partner-only={settings['mal.partner_only'] === 'on' ? 'on' : 'off'}>
                {settings['mal.partner_only'] === 'on'
                  ? <>{t.rich('landing.partnerOnlyOn', { b: (c) => <b>{c}</b> })}</>
                  : <>{t.rich('landing.partnerOnlyOff', { b: (c) => <b>{c}</b> })}</>}
              </p>
            )}

            <div className="gw-body2"><div className="gw-lay">
              <GwSide code={code} cats={listing ? cats : []} cat={cat?.id} register={register}
                regions={regions?.all} region={region}
                extra={!listing && ax ? (
                  <div className="gw-axaside"><b>{ax.nm}</b><span>{ax.judge}</span>
                    <span className="gw-ls">{consult ? t('landing.consultCatNote') : axDef?.why}</span></div>
                ) : undefined} />

              <div>
                {ax?.body === 'jobs' ? <AxisJob d={q.d} hot={q.hot === '1'} />
                  : ax?.body === 'advisory' ? <AxisSvc />
                  : ax?.body === 'info' ? <AxisInfo d={q.d} />
                  : consult ? (
                  <div className="gw-panel gw-cslL">
                    <div className="gw-sh2" style={{ padding: '0 0 12px' }}><b>{t('landing.consultTitle')}</b>
                      <span className="gw-ls">{t('landing.consultLead')}</span></div>
                    <div className="gw-axwarn gw-ok">{t.rich('landing.consultWarn', { b: (c) => <b>{c}</b> })}</div>
                    <div className="mal">{/* 업종 줄은 생활 · 금융 상담 화면과 같은 부품(components/mal/ConsultRows) */}
                      <ConsultRows cats={consultCats} label={t('landing.consultRowLabel')} />
                    </div>
                    {/* 개발에만 있던 「입점 상태 보기」를 시안 안내 줄(axcta) 안에 되살림(srv_consult_ui UI-6-2) */}
                    <div className="gw-axcta mal-cta">
                      {partner ? (
                        <><b>{t('landing.partnerYes')}</b><span>{t('landing.partnerYesBody')}</span>
                          <Link className="gw-bo gw-sm" href="/partner/leads">{t('landing.partnerLeads')}</Link></>
                      ) : (
                        <><b>{t('landing.partnerNo')}</b><span>{t('landing.partnerNoBody')}</span>
                          <Link className="gw-bo gw-sm" href="/partner/apply">{t('landing.partnerApply')}</Link>
                          <Link className="gw-bo gw-sm" href="/partner/listings">{t('landing.partnerStatus')}</Link></>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {ax?.urg && (
                      <div className="gw-axurg"><b>🔥 {ax.urg}</b>
                        <span>{badge === 'URGENT' ? t('landing.urgOnly') : t('landing.urgDefault')}</span>
                        <Link className="gw-bo gw-sm" href={badge === 'URGENT' ? qhref(base, { ...keep, badge: undefined }) : '/money/urgent'}>
                          {badge === 'URGENT' ? t('landing.viewAll') : t('landing.goSee')}</Link></div>
                    )}

                    <div className="gw-panel gw-find gw-narrow">
                      <div className="gw-fh2">{t(`meta.${code}.find`)}</div>
                      <form className="gw-fbar" action={base} method="get" role="search">
                        {axisParam && <input type="hidden" name="axis" value={axisParam} />}
                        <GradeCat grades={GRADES.filter((x) => cats.some((c) => c.gradeCode === x.code)).map((x) => ({ code: x.code, label: x.code === 'G1' ? t(`grade.${x.code}.nm`) : t('grade.tentative', { nm: t(`grade.${x.code}.nm`) }) }))}
                                  cats={cats.map((c) => ({ id: c.id, name: c.name, gradeCode: c.gradeCode ?? '' }))}
                                  grade={grade} cat={cat?.id} allcat={gallcat} />
                        {badge && <input type="hidden" name="badge" value={badge} />}
                        {sort && <input type="hidden" name="sort" value={sort} />}
                        {keyword && <input type="hidden" name="keyword" value={keyword} />}
                        {region && <input type="hidden" name="region" value={region} />}
                        <button className="gw-fgo" type="submit">{t('landing.search')}</button>
                      </form>
                      <div className="gw-fnote"><span className="gw-rd" />
                        {sel ? <>{t.rich('landing.filtered', { sel, b: (c) => <b>{c}</b> })}</> : t('landing.filterHint')}</div>
                    </div>

                    {sel && (
                      <div className="gw-catbar"><span className="gw-cbl">{t('landing.condLabel')}</span>
                        {regionNm && <><span className="gw-cbv">{regionNm}</span><Link className="gw-cbx" href={qhref(base, { ...keep, region: undefined })}>{t('landing.clearRegion')}</Link></>}
                        {gradeNm && <><span className="gw-cbv">{gradeNm}</span><Link className="gw-cbx" href={qhref(base, { ...keep, grade: undefined })}>{t('landing.clearGrade')}</Link></>}
                        {cat && <><span className="gw-cbv">{cat.name}</span><Link className="gw-cbx" href={qhref(base, { ...keep, cat: undefined })}>{t('landing.clearCat')}</Link></>}
                        {badge && <><span className="gw-cbv">{badge === 'URGENT' ? t('badge.URGENT') : t('badge.VERIFIED_DOC')}</span><Link className="gw-cbx" href={qhref(base, { ...keep, badge: undefined })}>{t('landing.clearBadge')}</Link></>}
                        {keyword && <><span className="gw-cbv">{t('landing.quote', { keyword })}</span><Link className="gw-cbx" href={qhref(base, { ...keep, keyword: undefined })}>{t('landing.clearKeyword')}</Link></>}
                        <Link className="gw-cbx" href={qhref(base, { axis: axisParam })}>{t('landing.clearAll')}</Link>
                        <span className="gw-cbn">{t('landing.clearNote', { allcat: gallcat })}</span>
                      </div>
                    )}

                    <div className="gw-panel" style={{ marginTop: 12, padding: '16px 17px 17px' }}>
                      <div className="gw-sh2" style={{ padding: '0 0 12px' }}>
                        <b>{cat ? `☰ ${cat.name}` : t('landing.popular', { what: code === 'MNY' ? gsect : ax?.nm ?? gsect })}</b>
                        <Link href={`${base}/list`}>{t('landing.more')}</Link>
                      </div>
                      {!data ? (
                        <p className="gw-empty">{t.rich('landing.loadFail', { home: (c) => <Link href={base}>{c}</Link> })}</p>
                      ) : organic.length === 0 && data.promoted.length === 0 ? (
                        <CatEmpty what={sel || (ax?.nm ?? gallcat)} clearHref={qhref(base, { axis: axisParam })} />
                      ) : (
                        <GwGrid promoted={data.promoted} organic={organic} adNotice={data.adNotice} />
                      )}
                      {data && (
                        <Pager base={base} keep={keep} page={page} next={data.nextCursor} pageCount={data.pageCount}
                          left={<span className="gw-tot">{sel
                            ? <><b>{sel}</b> · {data.total != null ? <>{t.rich('landing.countN', { n: String(data.total), b: (c) => <b>{c}</b> })}</> : <>{t.rich('landing.countPage', { n: String(organic.length), b: (c) => <b>{c}</b> })}</>}</>
                            : <>{t.rich(/[가-힣]$/.test(ax?.nm ?? gsect) && ((ax?.nm ?? gsect).charCodeAt((ax?.nm ?? gsect).length - 1) - 0xac00) % 28 ? 'landing.totalI' : 'landing.totalGa',
                                { n: allTotal.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'), what: ax?.nm ?? gsect, b: (c) => <b>{c}</b> })}</>}</span>}
                          right={<SortSelect value={sort ?? 'RECENT'} options={SORTS} hrefs={sortHrefs} />} />
                      )}
                    </div>
                  </>
                )}

                {ax?.safe && (
                  <div className="gw-panel gw-axsafe">
                    <div className="gw-sh2" style={{ padding: '0 0 9px' }}><b>{consult ? t('landing.safeHeadConsult', { nm: ax.nm }) : t('landing.safeHead', { nm: ax.nm })}</b></div>
                    <ul className="gw-axul">{ax.safe.map((x) => <li key={x}>{x}</li>)}</ul>
                    <div className="gw-ls">{t.rich('landing.safeFoot', { sub: ax.sub, guide: (c) => <Link href="/safety/guide" data-sgd-link="">{c}</Link> })}</div>
                  </div>
                )}
              </div>
            </div></div>
          </>
        )}
        <Features />
      </div>
      <GwFloatAd ad={float && !float.empty && float.id ? float : null} />
    </GwFrame>
  );
}
