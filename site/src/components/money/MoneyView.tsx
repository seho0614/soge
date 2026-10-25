'use client';
/**
 * SB-MNY-MAIN-010 소개장터 메인 — 화면. v10.30 → v10.31 (w2 · 10/10 「시안 기준」)
 *   MoneyMain(서버)이 조회한 **자료만** 받아 그립니다(왜 클라이언트 컴포넌트인지는 MoneyMain.tsx 머리말 — 수화 오류 #418).
 *   그래서 이 파일과 여기서 쓰는 부품은 서버 전용 기능(쿠키 · 조회)을 쓰면 안 됩니다. 조회는 MoneyMain 에서만 합니다.
 *   서버와 브라우저에서 달라질 수 있는 글자(「3시간 전」)는 그 칸에 suppressHydrationWarning 을 둡니다(관 화면 카드 GwCard 와 같은 규칙).
 *
 * v10.31 — 시안(mnyMain)의 구역을 전부 그립니다. v10.30 에서 서버 자료가 없어 뺐던 7구역은 서버를 만들어 실제 자료로 채웠습니다:
 *   많이 찾는 키워드 · 서비스 업체 추천 · AI 추천 맞춤 공급자 · 띠 광고 · 최근 실제 연결 사례 · 지역으로 찾기 · 요청 종류 탭(+ 요청 사진 · 지역).
 *   자료가 없으면 구역은 그대로 두고 안에 「아직 없습니다」를 냅니다(견본을 진짜처럼 보이게 하지 않음). 광고 칸(띠 · 떠 있는 광고)은 소재가 없으면 그리지 않습니다.
 *   사진 — 업체 · 사례 · 요청에 실제 사진이 없으면 분류 그림(시안 PHOTO_MAP 규칙 · photoSrc)을 씁니다. 그림의 견본 사진(svc_* · ai_* · req_* · case_*)은 쓰지 않습니다.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ListingCardData } from '@/lib/types';
import type { AdServe } from '@/components/home/types';
import { ago } from '@/lib/format';
import { won as fwon } from '@/lib/fmt';
import { useFmt } from '@/lib/useFmt';
import { QM, SORTS, photoSrc } from '@/components/gwan/gw';
import { GwGrid } from '@/components/gwan/GwCard';
import { CatEmpty, GwFrame, Pager } from '@/components/gwan/GwParts';
import { GradeCat, SortSelect } from '@/components/gwan/GwClient';
import { GwFloatAd, MoneyBand } from '@/components/gwan/GwAds';
import type { MarketRegions, MarketReqs, Recommended, SuccessCase, Supplier } from '@/components/market/types';
import { MnyPic } from './pics';
import { TILES, listHref } from './menu';
import { MoneySide } from './MoneySide';
import { MoneyAd } from './MoneyAd';
import { MoneySearch } from './MoneySearch';

/** 예산 — 그림의 모양(「300 ~ 500만원」 · 「협의」). 만 원으로 떨어지지 않으면 원 단위 그대로
 *  v10.97 — 글자는 사전(money.budget.*). 「만원」 묶음은 한국어에서만 씁니다(다른 언어는 원 단위 그대로) */
type MoneyT = ReturnType<typeof useTranslations<'money'>>;
export function budget(a: number | null, b: number | null, t: MoneyT, locale: string): string {
  const won = (n: number) => fwon(n, locale);   // v10.102 (2-5c) — ko 「1,200,000원」 그대로 · 다른 언어 「₩1,200,000」
  const man = (n: number) => (locale === 'ko' && n % 10000 === 0 ? (n / 10000).toLocaleString('ko-KR') : null);
  if (!a && !b) return t('budget.nego');
  if (a && b) {
    const x = man(a), y = man(b);
    if (a === b) return x ? t('budget.man', { n: x }) : won(a);
    return x && y ? t('budget.manRange', { a: x, b: y }) : `${won(a)} ~ ${won(b)}`;
  }
  const v = (a || b) as number, m = man(v);
  const s = m ? t('budget.man', { n: m }) : won(v);
  return a ? t('budget.over', { v: s }) : t('budget.under', { v: s });
}
/** 분류 딱지의 색 — 그림은 분류마다 파랑 · 주황 · 보라입니다. 같은 이름은 늘 같은 색이 되게 이름으로 고릅니다 */
const TONES = ['is-blue', 'is-orange', 'is-purple'] as const;
const tone = (s: string) => TONES[[...s].reduce((n, c) => (n + c.codePointAt(0)!) % 3, 0)];
const where = (sido: string | null, sigungu: string | null, unknown: string) => (sido ? `${sido}${sigungu ? ` ${sigungu}` : ''}` : unknown);

const Chev = () => <i className="mny-chev" aria-hidden />;
const Arrow = () => (
  <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 5h12M9 1l4 4-4 4" /></svg>
);

const BASE = '/money';
const AT = '#mny-list';
/** 요청 종류 탭 — 시안 MNY_TABS(이름 그대로) ↔ 서버 request.kind · v10.97 이름은 사전 money.reqTabs.* */
const REQ_TABS = [['', 'all'], ['GOODS', 'goods'], ['SERVICE', 'service'], ['EXPERT', 'expert'], ['COMPANY', 'company'], ['USED', 'used']] as const;

/** 업체 카드 — 시안 mnyCards(사진 · 이름 · 설명 · 별점(후기 수) · 지역 · 프로필 보기 · 제안 하기) */
function SupplierCards({ rows, ai }: { rows: Supplier[]; ai?: boolean }) {
  const t = useTranslations('money');
  return (
    <div className={`mny-cards${ai ? ' is-ai' : ''}`}>
      {rows.map((c) => (
        <article className="mny-card" key={c.id} data-supplier={c.id} title={ai && c.score != null ? t('card.score', { score: String(c.score) }) : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoSrc(c.mainCategory, c.thumbUrl ? [c.thumbUrl] : null)} alt="" loading="lazy" />
          <div className="mny-card-b">
            <h3>{c.companyName}</h3>
            <p>{c.summary ?? c.mainCategory ?? '　'}</p>
            <div className="mny-meta">
              <span className="is-star"><MnyPic name="star" alt={t('card.rating')} />{c.rating != null ? Number(c.rating).toFixed(1) : '—'}<small>({c.reviewCount})</small></span>
              <span className="is-pin"><MnyPic name="pin" alt={t('card.region')} />{where(c.sido, c.sigungu, t('unknownRegion'))}</span>
            </div>
            <div className="mny-btns">
              <Link className="mny-btn is-line" href={`/supplier/${c.id}?gwan=MNY`}>{t('card.profile')}</Link>
              <Link className="mny-btn is-fill" href={c.topListingId ? `/money/${c.topListingId}#ask` : `/supplier/${c.id}?gwan=MNY`}>{t('card.propose')}</Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export interface MoneyViewProps {
  keyword: string;
  reqs: MarketReqs;
  ad: AdServe | null;
  /** v10.31 — 7구역 자료 */
  keywords: { term: string; hits: number }[];
  regions: MarketRegions | null; region?: string;
  suppliers: Supplier[]; ai: Recommended | null; cases: SuccessCase[];
  band: AdServe | null; float: AdServe | null;
  /** 지금 있던 구역의 제목 · 검색 조건을 한 줄로 · 관의 게시 매물 수 · 「이/가」 */
  title: string; sel: string; total: number; josa: string;
  grades: { code: string; label: string }[];
  cats: { id: string; name: string; gradeCode: string }[];
  grade?: string; cat?: string; badge?: string; sort?: string; page: number; pageCount?: number;
  /** 검색 조건 줄 — 고른 것 · 풀기 글자 · 풀었을 때의 주소 */
  bar: { label: string; clear: string; href: string }[];
  /** 목록 — 못 받았으면 null. next = 다음 쪽 주소(없으면 마지막 쪽) */
  data: { promoted: ListingCardData[]; adNotice: string; next: string | null } | null;
  organic: ListingCardData[];
  firstHref: string;
  sortHrefs: Record<string, string>;
  keep: Record<string, string | undefined>;
}

export function MoneyView({ keyword, reqs, ad, keywords, regions, region, suppliers, ai, cases, band, float, title, sel, total, josa, grades, cats, grade, cat, badge, sort, page, pageCount, bar, data, organic, sortHrefs, keep }: MoneyViewProps) {
  const t = useTranslations('money');
  const locale = useLocale();
  const f = useFmt();
  const tg = useTranslations('gwan.meta.MNY'), tq = useTranslations('gwan.qm');   // v10.97 — 관 안내 이름 · 퀵메뉴도 사전
  const [tab, setTab] = useState('');
  const shown = reqs.items.filter((r) => !tab || r.kind === tab).slice(0, 4);
  return (
    <div className="mny" data-sgb-gwan="money" data-design="money_main_20261009">
      {/* 시안 「본문으로 건너뛰기」(키보드 · 화면 읽기) — 눌러서 초점이 올 때만 보입니다 */}
      <a className="mny-skip" href="#mny-main">{t('view.skip')}</a>
      {/* 1. 맨 위 구역 */}
      <section className="mny-hero" id="mny-main" tabIndex={-1} aria-labelledby="mny-h1"><div className="mny-hero-in">
        <div className="mny-hero-l">
          <h1 className="mny-h1" id="mny-h1">{t.rich('view.h1', { br: () => <br />, em: (c) => <em>{c}</em> })}</h1>
          <p className="mny-lead">{t.rich('view.lead', { br: () => <br /> })}</p>
          <MoneySearch />
          {/* v10.31 — 많이 찾는 키워드(검색어 통계 · 결과가 나온 말 · 제한 업종 낱말 뺌). 누르면 그 말로 검색 결과
               v10.41 (대표 결정 2026-10-14 「시안대로」) — 시안 그대로 통합 검색 결과의 「전체」 탭으로(시안: S.q = 그 말 · stab2 = 「전체」 · go("src")).
               전: 소개장터 탭(&gwanCode=MNY) */}
          <div className="mny-kw" data-mny-kws={keywords.length}>
            <span className="mny-kw-t"><MnyPic name="flame" />{t('view.hotKeywords')}</span>
            {keywords.length === 0
              ? <span className="mny-kw-none">{t('view.noKeywords')}</span>
              : keywords.map((k) => (
                <Link key={k.term} className="mny-chip" href={`/search?q=${encodeURIComponent(k.term)}`} data-mny-kw={k.term}>{k.term}</Link>
              ))}
          </div>
        </div>
        {ad && <MoneyAd ad={ad} />}
      </div></section>

      <div className="mny-wrap">
        {/* 2. 바로가기 3장 */}
        <nav className="mny-quick" aria-label={t('view.quickAria')}>
          <Link className="mny-qc" href="/register"><i className="mny-qc-i"><MnyPic name="quick_send" /></i><div><b>{t('view.quickSend')}</b><span>{t('view.quickSendSub')}</span></div><Chev /></Link>
          <Link className="mny-qc" href="/request/new"><i className="mny-qc-i"><MnyPic name="quick_want" /></i><div><b>{t('view.quickWant')}</b><span>{t('view.quickWantSub')}</span></div><Chev /></Link>
          <Link className="mny-qc" href="/request"><i className="mny-qc-i"><MnyPic name="quick_recv" /></i><div><b>{t('view.quickRecv')}</b><span>{t('view.quickRecvSub')}</span></div><Chev /></Link>
        </nav>

        {/* 3. 분야 고르기 — 「전체」 칸의 옅은 주황 바탕은 그림에 든 것이라 늘 그대로입니다. 지금 고른 칸에는 주황 테두리를 둘러 알립니다(styles/money.css) */}
        <section className="mny-cat" aria-labelledby="mny-cat-t">
          <div className="mny-cat-h">
            <h2 id="mny-cat-t">{t('view.catTitle')}</h2>
            <p>{t('view.catLead')}</p>
            <Link className="mny-more" href="/money/list">{t('view.seeAll')}<Chev /></Link>
          </div>
          <div className="mny-tiles">
            {TILES.map(([pic, name, kw], i) => {
              const on = keyword ? kw === keyword : i === 0;
              return (
                <Link key={pic} className={`mny-tile${i === 0 ? ' is-all' : ''}`} href={listHref(kw)} data-mny-kw={kw} aria-current={on ? 'true' : undefined}><i><MnyPic name={pic} /></i>{t(`tiles.${name}`)}</Link>
              );
            })}
          </div>
        </section>

        <div className="mny-cols">
          {/* 4. 왼쪽 분류 목록 + 지역으로 찾기(v10.31 · 시 · 도로 아래 목록을 거름) */}
          <MoneySide now={keyword} regions={regions} region={region} />

          <div className="mny-main">
            {/* 5. 서비스 업체 추천(v10.31) — 그 관에 게시 매물이 있는 인증 사업자 · 신뢰도 · 평점 · 성사 순(광고 아님) */}
            <section className="mny-panel" aria-labelledby="mny-p1" data-mny-suppliers={suppliers.length}>
              <div className="mny-ph"><MnyPic name="badge" /><h2 id="mny-p1">{t('view.suppliers')}</h2><Link className="mny-more" href="/supplier?gwan=MNY">{t('view.seeAll')}<Chev /></Link></div>
              {suppliers.length === 0
                ? <p className="mny-req-none">{region ? t('view.noSuppliersRegion') : t('view.noSuppliers')} <Link href="/register">{t('view.registerSupplier')}</Link></p>
                : <SupplierCards rows={suppliers} />}
            </section>

            {/* 6. 지금 올라온 소개 요청 — 종류 탭(서버 request.kind) · 사진 · 지역 */}
            <section className="mny-panel is-req" aria-labelledby="mny-p2" data-mny-reqs={reqs.items.length}>
              <div className="mny-ph"><MnyPic name="badge" /><h2 id="mny-p2">{t('view.requests')}</h2><Link className="mny-more" href="/request">{t('view.seeAll')}<Chev /></Link></div>
              <div className="mny-tabs" role="tablist" aria-label={t('view.reqKinds')}>
                {REQ_TABS.map(([k, nm]) => (
                  <button key={k || 'all'} type="button" className="mny-tab" role="tab" aria-selected={tab === k} data-mny-tab={k || 'all'} onClick={() => setTab(k)}>{t(`reqTabs.${nm}`)}</button>
                ))}
              </div>
              <div className="mny-reqs" role="tabpanel">
                {shown.map((r) => (
                  <div className="mny-req" key={r.id} data-type={r.kind ?? ''}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoSrc(r.categoryName, r.photoUrl ? [r.photoUrl] : null)} alt="" loading="lazy" />
                    <div className="mny-req-m">
                      <Link href={`/request/${r.id}`}>{r.title}</Link>
                      <div>{r.categoryName && <span className={`mny-tag ${tone(r.categoryName)}`}>{r.categoryName}</span>}<MnyPic name="pin_s" alt={t('card.region')} />{where(r.sido, r.sigungu, t('unknownRegion'))}</div>
                    </div>
                    <span className="mny-req-c is-time" suppressHydrationWarning>{f.ago(r.createdAt, ago(r.createdAt))}</span>
                    <span className="mny-req-c is-price">{budget(r.budgetMin, r.budgetMax, t, locale)}</span>
                    <span className="mny-req-c is-n">{t.rich('view.proposals', { n: String(r.proposalCount ?? 0), b: (c) => <b>{c}</b> })}</span>
                    <Link className="mny-btn is-ghost" href={`/request/${r.id}`} aria-label={t('view.proposeAria', { title: r.title })}>{t('card.propose')}</Link>
                  </div>
                ))}
                {shown.length === 0 && (
                  <p className="mny-empty">{tab ? t('view.noReqKind') : t.rich('view.noReqs', { link: (c) => <Link href="/request/new">{c}</Link> })}</p>
                )}
              </div>
            </section>

            {/* 7. AI 추천 맞춤 공급자(v10.31) — 서버 계산 가중 합산(지역 · 관심 분류 · 성사 · 응답 · 신뢰도) · 광고는 순위에 넣지 않음 */}
            <section className="mny-panel is-aip" aria-labelledby="mny-p3" data-mny-ai={ai?.items.length ?? 0}>
              <div className="mny-ph"><MnyPic name="badge" /><h2 id="mny-p3">{t('view.aiSuppliers')}</h2><Link className="mny-more" href="/supplier?gwan=MNY&ai=1">{t('view.seeAll')}<Chev /></Link></div>
              {!ai || ai.items.length === 0
                ? <p className="mny-req-none">{t('view.noAi')}</p>
                : <><SupplierCards rows={ai.items} ai /><p className="mny-ai-note">{ai.note}</p></>}
            </section>
          </div>

          {/* 8. 지금 메인에 있던 것 — 디자인의 구역 아래에 남깁니다(10/9 답 ②). 시안과 같은 자리입니다 — 오른쪽 칸의 디자인 구역 바로 아래(styles/money.css 의 .mny-cols > .mny-old).
              안쪽은 v10.29 관 화면 부품 그대로입니다(.gw-… · styles/proto-gwan.css). 고르면 주소에 조건이 붙고 이 구역(#mny-list)으로 돌아옵니다. */}
          <section className="mny-old" id="mny-list" aria-labelledby="mny-old-t" data-mny-old="1">
            <div className="mny-old-h">
              <h2 id="mny-old-t">{title}</h2>
              <nav className="mny-old-q" aria-label={t('view.quickMenu')} data-mny-qm="">
                {QM.map((x) => <Link key={x.key} href={x.href} data-qm={x.key}>{tq(x.key)}</Link>)}
              </nav>
              <nav className="mny-old-q" aria-label={t('view.listsAria')}>
                <Link href="/my/listings">{tg('mine')}</Link>
                <Link href="/money/list">{t('view.allList')}</Link>
              </nav>
            </div>
            <div className="mny-old-b">
              <GwFrame code="MNY">
                <div className="gw-panel gw-find">
                  <div className="gw-fh2">{tg('find')}</div>
                  <form className="gw-fbar" action={BASE + AT} method="get" role="search" aria-label={tg('find')}>
                    <GradeCat grades={grades} cats={cats} grade={grade} cat={cat} allcat={tg('allcat')} />
                    {badge && <input type="hidden" name="badge" value={badge} />}
                    {sort && <input type="hidden" name="sort" value={sort} />}
                    {keyword && <input type="hidden" name="keyword" value={keyword} />}
                    {region && <input type="hidden" name="region" value={region} />}
                    <button className="gw-fgo" type="submit">{t('view.searchBtn')}</button>
                  </form>
                  <div className="gw-fnote"><span className="gw-rd" />
                    {sel ? t.rich('view.filtered', { sel, b: (c) => <b>{c}</b> }) : t('view.filterHint')}</div>
                </div>

                {bar.length > 0 && (
                  <div className="gw-catbar"><span className="gw-cbl">{t('view.conditions')}</span>
                    {bar.map((b) => <span key={b.label} style={{ display: 'contents' }}><span className="gw-cbv">{b.label}</span><Link className="gw-cbx" href={b.href}>{b.clear}</Link></span>)}
                    <Link className="gw-cbx" href={BASE + AT}>{t('view.clearAll')}</Link>
                    <span className="gw-cbn">{t('view.clearHint', { allcat: tg('allcat') })}</span>
                  </div>
                )}

                <div className="mny-old-l" data-mny-list={organic.length}>
                  {!data ? (
                    <p className="gw-empty">{t.rich('view.listFail', { link: (c) => <Link href={BASE}>{c}</Link> })}</p>
                  ) : organic.length === 0 && data.promoted.length === 0 ? (
                    <CatEmpty what={sel || tg('allcat')} clearHref={BASE + AT} />
                  ) : (
                    <GwGrid promoted={data.promoted} organic={organic} adNotice={data.adNotice} />
                  )}
                  {data && (
                    /* 쪽 줄 — 시안처럼 쪽 번호 전체(서버 건수 · v10.31). 넘겨도 이 구역에 머물게 주소 끝에 #mny-list */
                    <Pager base={BASE} keep={keep} page={page} next={data.next} pageCount={pageCount} hash={AT}
                      left={<span className="gw-tot">{sel
                        ? t.rich('view.pageCount', { sel, n: String(organic.length), b: (c) => <b>{c}</b> })
                        : t.rich(josa === '이' ? 'view.totalI' : 'view.totalGa', { n: String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ','), sect: tg('sect'), b: (c) => <b>{c}</b> })}</span>}
                      right={<SortSelect value={sort ?? 'RECENT'} options={SORTS} hrefs={sortHrefs} />} />
                  )}
                </div>
              </GwFrame>
            </div>
          </section>
        </div>

        {/* 9. 띠 광고(v10.31 · 칸 GBAND) — 소재가 없으면 그리지 않습니다 */}
        <MoneyBand ad={band} />

        {/* 10. 최근 실제 연결 사례(v10.31 · 성사 확정 거래) + 공급자 등록 */}
        <div className="mny-bottom">
          <section className="mny-cases" aria-labelledby="mny-p4" data-mny-cases={cases.length}>
            <div className="mny-cases-h"><MnyPic name="badge_s" /><h2 id="mny-p4">{t('view.cases')}</h2></div>
            {cases.length === 0 ? (
              <p className="mny-req-none">{t('view.noCases')}</p>
            ) : (
              <div className="mny-case-l">
                {cases.map((c, i) => (
                  <div className="mny-case" key={`${c.listingId}-${i}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoSrc(c.categoryName, c.thumbUrl ? [c.thumbUrl] : null)} alt="" loading="lazy" />
                    <div>
                      <b title={c.title}>{c.title}</b>
                      <p>{c.inquiries > 0 ? t('view.caseInq', { n: String(c.inquiries) }) : c.proposals > 0 ? t('view.caseProp', { n: String(c.proposals) }) : t('view.caseOne')}</p>
                      <span><MnyPic name="pin" alt={t('card.region')} />{c.region ?? t('unknownRegion')}</span>
                      <span><MnyPic name="pin" alt={t('card.date')} />{c.date.replace(/\./g, '. ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <div className="mny-cta">
            <p>{t.rich('view.ctaText', { br: () => <br /> })}</p>
            <Link href="/register">{t('view.registerSupplier')}<Arrow /></Link>
          </div>
        </div>

      </div>
      {/* 오른쪽 아래 떠 있는 광고(칸 FLOAT) — 소재가 없거나 이 세션에서 닫았으면 그리지 않습니다 */}
      <GwFloatAd ad={float} />
    </div>
  );
}
