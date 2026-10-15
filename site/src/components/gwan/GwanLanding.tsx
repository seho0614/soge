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

/** 축 — 시안 AX 그대로(이름 · 부제 · 판정 · 이유 · 급매 띠 · 먼저 확인할 것) */
const AXES: Record<'MAL' | 'BIZ', { nm: string; why: string; tabs: Axis[] }> = {
  MAL: { nm: '자산 성격', why: '등기가 있는 자산과 실물로 넘기는 자산은 확인할 것도 법도 다릅니다.', tabs: [
    { k: 'equip', nm: '기계 · 설비 · 시설', sub: '실물자산형', catAxis: 'EQUIP', judge: '등기 없이 실물 인도로 넘어갑니까?', urg: '급매 · 이전',
      safe: ['장비 가동 상태를 실물로 확인하십시오 — 사진만으로는 확인되지 않습니다', '리스 · 할부 잔액이 남아 있는지 확인하십시오',
        '철거 · 이전 조건과 비용을 계약서에 적으십시오'] },
    { k: 'realty', nm: '부동산', sub: '등기자산형', catAxis: 'RE', gate: 'A-07 법무 회신 대기', judge: '등기부등본이 있습니까?', urg: '급매',
      safe: ['등기부등본으로 소유자 · 근저당 · 가압류를 확인하십시오', '권리금 이중계약 여부를 확인하십시오', '임대인 동의가 필요한 계약인지 확인하십시오',
        '큰 금액일수록 계약서와 세금계산서를 먼저 갖추십시오 — 플랫폼은 대금에 관여하지 않습니다'] },
    { k: 'consult', nm: '생활 · 금융 상담', sub: '상담신청형', body: 'consult', judge: '상담을 신청하면 인증된 업체 1곳이 연락드립니다.',
      why: '상담은 매물 거래가 아닙니다 — 소비자가 신청하고, 입점 승인을 받은 업체가 연락합니다.', safe: SAFE_CONSULT },
  ] },
  BIZ: { nm: '창업 단계', why: '창업은 사고파는 것만이 아닙니다 — 사람도, 자문도, 정보도 오갑니다.', tabs: [
    { k: 'listing', nm: '창업', sub: '거래형', judge: '내일 아침 문을 열고 바로 장사가 됩니까?', urg: '급매 사업체',
      safe: ['권리금 이중계약 여부를 확인하십시오', '인허가가 승계되는 업종인지 확인하십시오', '창업부지는 안심소개 원본을 참조만 합니다(INV-GWAN2)'] },
    { k: 'jobs', nm: '인력', sub: '매칭형', body: 'jobs', gate: '도급만 · 개인 노출 없음', open: true, openNote: '도급으로만 잇습니다 — 개인은 노출하지 않습니다.',
      judge: '고용 관계가 성립합니까?' },
    { k: 'advisory', nm: '운영지원', sub: '서비스형', body: 'advisory', judge: '지속적 자문 · 수행 계약이 성립합니까?' },
    { k: 'info', nm: '정보', sub: '콘텐츠형', body: 'info', judge: '거래가 없습니다 — 열람과 신청만 합니다' },
  ] },
};

/** v10.31 (합침 · w6 D083) — 운영 「관 UI/UX 관리」의 축(GET /site/gwan-axes · 노출 중인 것만). 화면 키 ↔ 서버 축 코드 */
const AXIS_CODE: Record<string, string> = { equip: 'ASSET', realty: 'RE', consult: 'CONSULT', listing: 'STARTUP', jobs: 'STAFF', advisory: 'SUPPORT', info: 'INFO' };
interface ServerAxis { axisCode: string; name: string; nature: string | null; judge: string | null; urgentLabel: string | null; regulation: string | null; isExposed: boolean }

/** 서버 축 값(이름 · 성격 · 판정 · 급매 띠 · 규제)을 시안 정의 위에 얹고, 운영이 노출을 내린 축은 뺍니다.
 *  서버 답을 못 받거나 비면 시안 정의 그대로(첫 축은 늘 남김 — 관 화면이 비지 않게). */
function withServerAxes(def: { nm: string; why: string; tabs: Axis[] }, rows: ServerAxis[] | null) {
  if (!rows || rows.length === 0) return def;
  const by = new Map(rows.map((r) => [r.axisCode, r]));
  const tabs = def.tabs.flatMap((t, i) => {
    const r = by.get(AXIS_CODE[t.k] ?? '');
    if (!r) return i === 0 ? [t] : [];
    return [{ ...t, nm: r.name || t.nm, sub: r.nature || t.sub, judge: r.judge || t.judge,
      urg: r.urgentLabel ?? t.urg, gate: r.regulation || t.gate }];
  });
  return { ...def, tabs };
}

export async function GwanLanding({ code, q }: { code: GwanCode; q: GwQuery }) {
  const g = GW[code];
  const base = `/${g.path}`;
  const serverAxes = code === 'MNY' ? null
    : await apiGet<ServerAxis[]>(`/site/gwan-axes?gwan=${code}`, 60).catch(() => null);
  const axDef = code === 'MNY' ? null : withServerAxes(AXES[code], serverAxes);
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

  const gradeNm = grade ? GRADES.find((x) => x.code === grade)?.nm : undefined;
  const regionNm = region ? (region === 'ETC' ? '기타 지역' : regions?.all.find((x) => x.code === region)?.name) : undefined;
  const sel = [regionNm, gradeNm, cat?.name, badge === 'URGENT' ? '급구' : badge === 'VERIFIED_DOC' ? '서류 확인' : undefined, keyword && `「${keyword}」`].filter(Boolean).join(' · ');
  const sortHrefs = Object.fromEntries(SORTS.map(([v]) => [v, qhref(base, { ...keep, sort: v === 'RECENT' ? undefined : v })]));
  const register = code === 'MAL'
    ? (partner
      ? [{ href: '/register', label: '✚ 매물 등록 (파트너센터)', role: 'partner' }, { href: '/partner/listings', label: '내 매물 · 입점 상태' }]
      : [{ href: '/mall/give', label: '✚ 소개합니다', role: 'member' }])
    : undefined;
  const axHref = (t: Axis) => (t === axDef?.tabs[0] ? base : qhref(base, { axis: t.k }));
  const allTotal = data?.total ?? gw?.listingCount ?? 0;

  return (
    <GwFrame code={code}>
      <div className="gw-wrap" style={{ paddingTop: 13 }}>
        <h1 className="gw-sr">{gw?.name ?? g.name}</h1>{/* 시안에는 보이는 제목이 없어 읽기 프로그램용으로만 둡니다(시안 .sr) */}
        <SearchRow code={code} />

        {code === 'MNY' && (
          <div className="gw-rrow"><RoleTabs /><QuickMenu /></div>
        )}

        {stopped ? (
          <div className="gw-taboff" role="status" data-gwan-off="1"><b>{g.name}</b> 관이 <b>중지</b> 상태입니다. 신규 등록과 신규 문의만 막히고 진행 중인 거래는 그대로 완주합니다. 관을 다시 열면 이 화면이 그대로 돌아옵니다.</div>
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
                    ? <span className="gw-axw2 gw-ok">이 축은 {ax.openNote ?? ax.gate}</span>
                    : <span className="gw-axw2">이 축은 {ax.gate}라 아직 열지 않았습니다. 지금 보이는 매물은 미리 보기입니다 — 부동산은 소개비가 아니라 노출료이고 정산이 생성되지 않습니다(A-07).</span>)}
                  {code === 'MAL' && ax.catAxis === 'RE' && (
                    <span className="gw-axbrk"><b>공인중개사 매물 연동</b>
                      <span>제휴 중개사무소가 올린 매물을 받는 자리입니다 — A-07 회신 뒤에 엽니다. 중개사 매물은 소유 확인을 먼저 받습니다.</span>
                      <Link className="gw-bo gw-sm" href="/mal/brokers">구조 보기 · 소유 확인 ›</Link></span>
                  )}
                </div>
              </div>
            )}

            {code === 'MAL' && (
              /* 인증업체만 게시 — 운영 스위치(mal.partner_only)를 그대로 알립니다(개발에만 있는 안내 · 시안 모양 안에 둠) */
              <p className={`gw-po${settings['mal.partner_only'] === 'on' ? ' gw-on' : ''}`} data-partner-only={settings['mal.partner_only'] === 'on' ? 'on' : 'off'}>
                {settings['mal.partner_only'] === 'on'
                  ? <><b>인증업체만 게시합니다.</b> 안심소개 매물은 입점 승인을 받은 인증업체만 올립니다.</>
                  : <><b>「인증업체만 게시」는 아직 켜지지 않았습니다.</b> 지금은 입점 승인 전 업체의 매물도 보일 수 있습니다 — 등록자의 「사업자 인증」 표시를 확인하십시오.</>}
              </p>
            )}

            <div className="gw-body2"><div className="gw-lay">
              <GwSide code={code} cats={listing ? cats : []} cat={cat?.id} register={register}
                regions={regions?.all} region={region}
                extra={!listing && ax ? (
                  <div className="gw-axaside"><b>{ax.nm}</b><span>{ax.judge}</span>
                    <span className="gw-ls">{consult ? '업종은 관리자가 관리합니다 — 회원이 업종을 만들 수 없습니다.' : axDef?.why}</span></div>
                ) : undefined} />

              <div>
                {ax?.body === 'jobs' ? <AxisJob d={q.d} hot={q.hot === '1'} />
                  : ax?.body === 'advisory' ? <AxisSvc />
                  : ax?.body === 'info' ? <AxisInfo d={q.d} />
                  : consult ? (
                  <div className="gw-panel gw-cslL">
                    <div className="gw-sh2" style={{ padding: '0 0 12px' }}><b>🤝 생활 · 금융 상담</b>
                      <span className="gw-ls">업종을 고르고 상담을 신청하면 인증된 업체 1곳이 연락드립니다</span></div>
                    <div className="gw-axwarn gw-ok"><b>신청 정보는 업체 1곳에만 전달됩니다.</b> 동의하신 업체 말고는 연락처를 볼 수 없고, 휴대폰 확인을 마친 신청만 전달됩니다.
                      법률 · 세무는 상담 신청 대신 <b>사무소 정보(광고)</b>를 보고 직접 연락합니다.</div>
                    <div className="mal">{/* 업종 줄은 생활 · 금융 상담 화면과 같은 부품(components/mal/ConsultRows) */}
                      <ConsultRows cats={consultCats} label="상담 신청" />
                    </div>
                    {/* 개발에만 있던 「입점 상태 보기」를 시안 안내 줄(axcta) 안에 되살림(srv_consult_ui UI-6-2) */}
                    <div className="gw-axcta mal-cta">
                      {partner ? (
                        <><b>인증업체이십니다.</b><span>배정된 상담 신청은 파트너센터에서 확인하고 연락처를 열 수 있습니다</span>
                          <Link className="gw-bo gw-sm" href="/partner/leads">받은 상담 신청</Link></>
                      ) : (
                        <><b>업체이신가요?</b><span>안심소개 파트너센터에서 입점 신청과 자격 서류를 내면 이 목록에 오릅니다</span>
                          <Link className="gw-bo gw-sm" href="/partner/apply">인증업체 등록</Link>
                          <Link className="gw-bo gw-sm" href="/partner/listings">입점 상태 보기</Link></>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {ax?.urg && (
                      <div className="gw-axurg"><b>🔥 {ax.urg}</b>
                        <span>{badge === 'URGENT' ? '급구 표시가 붙은 건만 보고 있습니다' : '이 축에서 마감이 임박한 건만 모읍니다'}</span>
                        <Link className="gw-bo gw-sm" href={badge === 'URGENT' ? qhref(base, { ...keep, badge: undefined }) : '/money/urgent'}>
                          {badge === 'URGENT' ? '전체 보기' : '보러 가기 ›'}</Link></div>
                    )}

                    <div className="gw-panel gw-find gw-narrow">
                      <div className="gw-fh2">{g.find}</div>
                      <form className="gw-fbar" action={base} method="get" role="search">
                        {axisParam && <input type="hidden" name="axis" value={axisParam} />}
                        <GradeCat grades={GRADES.filter((x) => cats.some((c) => c.gradeCode === x.code)).map((x) => ({ code: x.code, label: x.code === 'G1' ? x.nm : `${x.nm} (가칭)` }))}
                                  cats={cats.map((c) => ({ id: c.id, name: c.name, gradeCode: c.gradeCode ?? '' }))}
                                  grade={grade} cat={cat?.id} allcat={g.allcat} />
                        {badge && <input type="hidden" name="badge" value={badge} />}
                        {sort && <input type="hidden" name="sort" value={sort} />}
                        {keyword && <input type="hidden" name="keyword" value={keyword} />}
                        {region && <input type="hidden" name="region" value={region} />}
                        <button className="gw-fgo" type="submit">🔍 검색</button>
                      </form>
                      <div className="gw-fnote"><span className="gw-rd" />
                        {sel ? <><b>{sel}</b> 조건으로 아래를 걸렀습니다.</> : '선택하신 구분과 분류에 맞는 건이 아래에 표시됩니다.'}</div>
                    </div>

                    {sel && (
                      <div className="gw-catbar"><span className="gw-cbl">검색 조건</span>
                        {regionNm && <><span className="gw-cbv">{regionNm}</span><Link className="gw-cbx" href={qhref(base, { ...keep, region: undefined })}>✕ 지역 해제</Link></>}
                        {gradeNm && <><span className="gw-cbv">{gradeNm}</span><Link className="gw-cbx" href={qhref(base, { ...keep, grade: undefined })}>✕ 구분 해제</Link></>}
                        {cat && <><span className="gw-cbv">{cat.name}</span><Link className="gw-cbx" href={qhref(base, { ...keep, cat: undefined })}>✕ 분류 해제</Link></>}
                        {badge && <><span className="gw-cbv">{badge === 'URGENT' ? '급구' : '서류 확인'}</span><Link className="gw-cbx" href={qhref(base, { ...keep, badge: undefined })}>✕ 표시 해제</Link></>}
                        {keyword && <><span className="gw-cbv">「{keyword}」</span><Link className="gw-cbx" href={qhref(base, { ...keep, keyword: undefined })}>✕ 검색어 해제</Link></>}
                        <Link className="gw-cbx" href={qhref(base, { axis: axisParam })}>전체 해제</Link>
                        <span className="gw-cbn">해제하면 {g.allcat}가 다시 보입니다</span>
                      </div>
                    )}

                    <div className="gw-panel" style={{ marginTop: 12, padding: '16px 17px 17px' }}>
                      <div className="gw-sh2" style={{ padding: '0 0 12px' }}>
                        <b>{cat ? `☰ ${cat.name}` : `🔥 지금 인기 있는 ${code === 'MNY' ? g.sect : ax?.nm ?? g.sect}`}</b>
                        <Link href={`${base}/list`}>더보기 ›</Link>
                      </div>
                      {!data ? (
                        <p className="gw-empty">목록을 불러오지 못했습니다. 조건을 바꾸거나 <Link href={base}>처음 화면</Link>으로 가십시오.</p>
                      ) : organic.length === 0 && data.promoted.length === 0 ? (
                        <CatEmpty what={sel || (ax?.nm ?? g.allcat)} clearHref={qhref(base, { axis: axisParam })} />
                      ) : (
                        <GwGrid promoted={data.promoted} organic={organic} adNotice={data.adNotice} />
                      )}
                      {data && (
                        <Pager base={base} keep={keep} page={page} next={data.nextCursor} pageCount={data.pageCount}
                          left={<span className="gw-tot">{sel
                            ? <><b>{sel}</b> · {data.total != null ? <><b>{data.total}</b>건</> : <>이 쪽 <b>{organic.length}</b>건</>}</>
                            : <>총 <b>{allTotal.toLocaleString('ko-KR')}</b>개의 {ax?.nm ?? g.sect}{/[가-힣]$/.test(ax?.nm ?? g.sect) && ((ax?.nm ?? g.sect).charCodeAt((ax?.nm ?? g.sect).length - 1) - 0xac00) % 28 ? '이' : '가'} 있습니다.</>}</span>}
                          right={<SortSelect value={sort ?? 'RECENT'} options={SORTS} hrefs={sortHrefs} />} />
                      )}
                    </div>
                  </>
                )}

                {ax?.safe && (
                  <div className="gw-panel gw-axsafe">
                    <div className="gw-sh2" style={{ padding: '0 0 9px' }}><b>⚠ {consult ? ax.nm : `${ax.nm} 거래`}에서 먼저 확인할 것</b></div>
                    <ul className="gw-axul">{ax.safe.map((x) => <li key={x}>{x}</li>)}</ul>
                    <div className="gw-ls">축마다 위험이 다릅니다 — 이 목록은 {ax.sub} 전용입니다. <Link href="/safety/guide" data-sgd-link="">사기 예방 가이드 보기 ›</Link></div>
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
