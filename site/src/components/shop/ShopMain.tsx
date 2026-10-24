/**
 * 소개몰(쇼핑몰 · 건강관) 메인 — SB-HLT-HUB-010 · 2026-10-07 제시 디자인 · v10.25 → v10.26.
 *
 * 그림의 구역 가운데 **서버에 자료가 있는 것만** 그립니다(사장님 결정: 가짜 값을 넣지 않음).
 *   그림                 실제 웹
 *   사진 띠 · 검색        그대로(제목 · 검색 칸은 실제 글자 · 실제 입력칸 — 그림의 글자는 사진에 박혀 있어 쓰지 않음)
 *   성분으로 찾기        GET /health/ingredients 의 성분 그대로
 *   고민으로 찾기        GET /health/concerns 의 고민 그대로
 *   성분별 최저가        v10.26 — 「N원 / 30일」 = 성분의 한 달 단가(살 수 있는 옵션만) · 규격 = 그 값을 낸 상품의 성분 | 함량 · 그림 = 그 상품의 그림.
 *                        시안의 「정상가」 줄은 성분 단위 자료가 아니라 넣지 않음(10/8 B-13). 개월 수 있는 상품이 없으면 예전처럼 「최저 N원부터」
 *   새로 올라온 상품      v10.26 — 판매 중인 상품을 올린 순서로 4개(별점 · 후기 수는 v10.27)
 *   이번 주 특별 할인     v10.26 — 배지 「특별가격」 상품(값 · 정가 취소선 · 할인율). 별점은 v10.27
 *   오늘의 건강상품 · 많이 찾는 상품    v10.28 (D037) — GET /health/rankings · 최근 7일 판매 수량 · 주문 건수 · 하루 1회 집계 · 기준 · 기간 · 집계 날짜를 적음. 판매가 없으면 그리지 않음
 *   v10.31 (10/10 시안 기준) — 시안 배치 그대로: 「오늘의 건강상품」 = 왼쪽 특가 배너(GET /health/promos · 운영이 바꿈 · 견본이면 「견본 문구」 표시)
 *     + 오른쪽 순위 상자(탭 3개: 실시간 인기 · 새로 올라온 상품 · 많이 찾는 상품 — ShopRankBox) / 그 아래 두 칸 「많이 찾는 상품」(주문 건수 6) ·
 *     「새로 올라온 상품」(별점 · 후기 수). 특가 배너 그림은 시안 조각 promo-right(원본 바이트). 「특가 상품 보러가기」는 시안처럼 전체제품(첫 열린 갈래)으로.
 *   아래 띠               그대로(「특가 상품」 목록 화면이 없어 단추는 「전체 상품 보러가기」)
 * 그림에 없지만 남긴 것: 작은 메뉴 줄(직판관 · 전체제품 · 이용안내 · 장바구니) — 청약철회 안내로 가는 길이 첫 화면에서 끊기면 안 됩니다.
 * v10.25 의 「소개몰 상품」 구역(그림에 없음)은 v10.26 에서 위의 두 구역으로 바꿨습니다.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import type { HltConcern, HltIngredient, HltProduct } from '@/components/health/types';
import { krw } from '@/components/health/util';
import { ProductArt } from '@/components/health/ProductArt';
import { ShopPic } from './Pic';
import { ShopRankBox } from './ShopRankBox';

/* 그림의 아이콘 20개 — 성분 10 · 고민 10. 서버의 코드에 맞는 것이 있으면 그 그림을, 없으면 글자(성분) · 서버의 이모지(고민)를 씁니다 */
const ING_PIC: [RegExp, string][] = [
  [/^VIT/, 'ing-01'], [/^(LACTO|PROBIO)/, 'ing-02'], [/^OMEGA/, 'ing-03'], [/^LUTEIN/, 'ing-04'], [/^MAG/, 'ing-05'],
  [/^COLLA/, 'ing-06'], [/^(GINSENG|RED)/, 'ing-07'], [/^(MILK|SILY)/, 'ing-08'], [/^PROTEIN/, 'ing-09'], [/^(CA$|CALC)/, 'ing-10'],
];
const CON_PIC: Record<string, string> = {
  IMMUNE: 'con-01', EYE: 'con-02', CIRC: 'con-03', GUT: 'con-04', LIVER: 'con-05', BONE: 'con-06', SKIN: 'con-07', DIET: 'con-08', MEN: 'con-09', WOMEN: 'con-10',
};
const ingPic = (code: string) => ING_PIC.find(([re]) => re.test(code))?.[1];

export const Star = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
    <circle cx="15" cy="15" r="15" fill="#17A34A" />
    <path fill="#fff" d="m15 6.6 2.5 5.3 5.8.7-4.3 4 1.1 5.8L15 19.5l-5.1 2.9 1.1-5.8-4.3-4 5.8-.7z" />
  </svg>
);
const Chev = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
);

export function SecHead({ title, lead, all }: { title: string; lead?: string; all?: string }) {
  const t = useTranslations('shop');
  return (
    <div className="shop-sech">
      <Star />
      <h2>{title}</h2>
      {lead && <p>{lead}</p>}
      {all && <Link className="shop-all" href={all}>{t('seeAll')} <Chev /></Link>}
    </div>
  );
}

export async function ShopMain() {
  const t = await getTranslations('shop');
  type RankBlock = { basis: string; from: string | null; to: string | null; madeAt: string | null; items: Array<HltProduct & { rank: number; qty: number; orders: number }> };
  const noRank: RankBlock = { basis: '', from: null, to: null, madeAt: null, items: [] };
  type Promo = { id: string; tag: string; title: string; titleEm: string | null; body: string | null; linkUrl: string; cta: string; isSample: boolean };
  const [ings, cons, prods, ranks, promos] = await Promise.all([
    apiGet<HltIngredient[]>('/health/ingredients', 60).catch(() => [] as HltIngredient[]),
    apiGet<HltConcern[]>('/health/concerns', 60).catch(() => [] as HltConcern[]),
    apiGet<HltProduct[]>('/health/products', 60).catch(() => [] as HltProduct[]),
    apiGet<{ sales: RankBlock; orders: RankBlock }>('/health/rankings', 300).catch(() => ({ sales: noRank, orders: noRank })),
    apiGet<Promo[]>('/health/promos', 60).catch(() => [] as Promo[]),
  ]);
  const promo = promos[0] ?? null;
  const star = (p: HltProduct) => (p.reviewCount ? <span className="shop-star">{Number(p.ratingAvg ?? 0).toFixed(1)} <i>({Number(p.reviewCount).toLocaleString('ko-KR')})</i></span> : null);
  const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : '');
  const basisLine = (r: RankBlock) => `${r.basis} · ${md(r.from)} ~ ${md(r.to)} · ${t('madeAt', { date: r.madeAt ? md(ymdKst(r.madeAt)) : '' })}`;      /* G-201 규칙 — toLocale… 쓰지 않음 */
  /* 성분별 최저가 — 한 달 단가가 있는 성분(살 수 있는 옵션 기준). 값을 낸 상품 = 그 성분이 대표 성분이고 한 달 단가가 같은 상품 */
  const monthly = ings.filter((g) => !g.isGroup && g.minUnit != null).sort((a, b) => Number(a.minUnit) - Number(b.minUnit));
  const priced = monthly.length ? [] : ings.filter((g) => g.minPrice != null).sort((a, b) => (a.minPrice ?? 0) - (b.minPrice ?? 0));
  const lowOf = (code: string, unit: number) => prods.find((p) => p.mainIngredient?.code === code && p.minUnit === unit && !p.soldOut)
    ?? prods.filter((p) => p.mainIngredient?.code === code && p.minUnit != null && !p.soldOut).sort((a, b) => Number(a.minUnit) - Number(b.minUnit))[0];
  const fresh = prods.filter((p) => !p.soldOut).slice(0, 4);           // API 가 올린 순서(최근 먼저)로 줍니다
  const deals = prods.filter((p) => p.badge === '특별가격' && p.offPct && !p.soldOut).slice(0, 6);

  return (
    <>
      <section className="shop-hero" data-shop-hero="1">
        <div className="shop-hero-in">
          <ShopPic name="hero-right" h={326} />
          <h1>{t.rich('hero.title', { br: () => <br />, em: (c) => <em>{c}</em> })}</h1>
          <p className="shop-lead">{t('hero.lead')}</p>
          <form className="shop-find" action="/health/search" role="search">
            <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden><path fill="#1D6BF3" d="M12 1.5c.7 5.6 4.9 9.8 10.5 10.5C16.9 12.7 12.7 16.9 12 22.5 11.3 16.9 7.1 12.7 1.5 12 7.1 11.3 11.3 7.1 12 1.5z" /></svg>
            <label>
              <b>{t('hero.ask')}</b>
              <input name="q" type="search" maxLength={50} placeholder={t('hero.placeholder')} aria-label={t('hero.inputAria')} />
            </label>
            <button aria-label={t('hero.submit')}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
            </button>
          </form>
        </div>
      </section>

      <div className="shop-in">
        <nav className="shop-lnav" aria-label={t('nav.aria')}>
          <Link href="/health/direct">{t('nav.direct')}</Link>
          <Link href="/health/c/ALL">{t('nav.all')}</Link>
          <Link href="/health/ingredients">{t('nav.ingredients')}</Link>
          <Link href="/health/concerns">{t('nav.concerns')}</Link>
          <span className="sp" />
          <Link href="/health/guide">{t('nav.guide')}</Link>
          <Link href="/my/health/orders">{t('nav.orders')}</Link>
          <Link href="/health/cart">{t('nav.cart')}</Link>
        </nav>

        {ings.length > 0 && (
          <section className="shop-sec cream" data-shop-ing="1">
            <SecHead title={t('sec.ing')} lead={t('sec.ingLead')} all="/health/ingredients" />
            <div className="shop-tiles">
              {ings.filter((g) => !g.isGroup).slice(0, 10).map((g) => {
                const pic = ingPic(g.code);
                return (
                  <Link key={g.code} className="shop-tile" href={`/health/i/${encodeURIComponent(g.code)}`} data-code={g.code}>
                    {pic ? <ShopPic name={pic} /> : <span className="ini">{g.name.slice(0, 1)}</span>}
                    <b>{g.name}</b>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {cons.length > 0 && (
          <section className="shop-sec cream" data-shop-con="1">
            <SecHead title={t('sec.con')} lead={t('sec.conLead')} all="/health/concerns" />
            <div className="shop-tiles">
              {cons.slice(0, 10).map((c) => {
                const pic = CON_PIC[c.code];
                return (
                  <Link key={c.code} className="shop-tile" href={`/health/w/${encodeURIComponent(c.code)}`} data-code={c.code}>
                    {pic ? <ShopPic name={pic} /> : <span className="emo" aria-hidden>{c.icon ?? '•'}</span>}
                    <b>{c.name}</b>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {monthly.length > 0 && (
          <section className="shop-sec" data-shop-low="1">
            <SecHead title={t('sec.low')} lead={t('sec.lowLead')} all="/health/ingredients" />
            <div className="shop-low">
              {monthly.slice(0, 8).map((g) => {
                const p = lowOf(g.code, Number(g.minUnit));
                const pic = ingPic(g.code);
                return (
                  <Link key={g.code} className="shop-lowc" href={`/health/i/${encodeURIComponent(g.code)}`} data-code={g.code} data-unit={g.minUnit}>
                    <span className="ph">{p ? <ProductArt p={p} size={110} /> : pic ? <ShopPic name={pic} h={64} /> : <span className="ini">{g.name.slice(0, 1)}</span>}</span>
                    <b>{g.name}</b>
                    <b>{t('perMonth', { price: krw(g.minUnit) })}</b>
                    <span className="spec">{p?.mainIngredient ? `${p.mainIngredient.name}${p.mainIngredient.amount ? ` ${p.mainIngredient.amount}` : ''}` : t('productCount', { n: String(g.productCount) })}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
        {priced.length > 0 && (
          <section className="shop-sec" data-shop-low="1">
            <SecHead title={t('sec.low')} lead={t('sec.lowLeadPriced')} all="/health/ingredients" />
            <div className="shop-low">
              {priced.slice(0, 8).map((g) => {
                const pic = ingPic(g.code);
                return (
                  <Link key={g.code} className="shop-lowc" href={`/health/i/${encodeURIComponent(g.code)}`} data-code={g.code}>
                    <span className="ph">{pic ? <ShopPic name={pic} h={64} /> : <span className="ini">{g.name.slice(0, 1)}</span>}</span>
                    <b>{g.name}</b>
                    <b>{t('from', { price: krw(g.minPrice) })}</b>
                    <span className="spec">{t('productCount', { n: String(g.productCount) })}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {(promo || ranks.sales.items.length > 0 || ranks.orders.items.length > 0 || fresh.length > 0) && (
          <section className="shop-sec pale" data-shop-today="1">
            <SecHead title={t('sec.today')} lead={t('sec.todayLead')} all="/health/c/ALL" />
            <div className="shop-today">
              {promo ? (
                <div className="shop-promo" data-shop-promo={promo.id}>
                  <ShopPic name="promo-right" h={393} />
                  <span className="tag">{promo.tag}</span>
                  <h3>{promo.title}{promo.titleEm && <em>{promo.titleEm}</em>}</h3>
                  {promo.body && <p>{promo.body}</p>}
                  <Link className="go" href={promo.linkUrl}>{promo.cta} →</Link>
                  {promo.isSample && <span className="sample" title={t('sampleTip')}>{t('sample')}</span>}
                </div>
              ) : <div />}
              <ShopRankBox hot={ranks.sales.items} fresh={fresh} many={ranks.orders.items}
                madeAt={ranks.sales.madeAt ? md(ymdKst(ranks.sales.madeAt)) : undefined}
                periods={{ hot: ranks.sales.from ? `${md(ranks.sales.from)} ~ ${md(ranks.sales.to)}` : '', many: ranks.orders.from ? `${md(ranks.orders.from)} ~ ${md(ranks.orders.to)}` : '' }} />
            </div>
          </section>
        )}

        {(ranks.orders.items.length > 0 || fresh.length > 0) && (
          <div className="shop-two">
            {ranks.orders.items.length > 0 ? (
              <section className="shop-sec" data-shop-many="1">
                <SecHead title={t('sec.many')} lead={basisLine(ranks.orders)} all="/health/c/ALL" />
                <div className="shop-many">
                  {ranks.orders.items.slice(0, 6).map((p, i) => (
                    <Link key={p.code} href={`/health/p/${encodeURIComponent(p.code)}`} data-many-pid={p.code}>
                      <span className="shop-no">{p.rank ?? i + 1}</span>
                      <span className="th"><ProductArt p={p} size={50} /></span>
                      <span className="tx"><b>{p.name}</b><span>{krw(p.price)}</span></span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : (
              <section className="shop-sec" data-shop-many="0">
                <SecHead title={t('sec.many')} />
                <p className="shop-basis">{t('noOrders')}</p>
              </section>
            )}
            {fresh.length > 0 && (
              <section className="shop-sec" data-shop-new="1">
                <SecHead title={t('sec.fresh')} all="/health/c/ALL" />
                <div className="shop-new">
                  {fresh.map((p) => (
                    <Link key={p.code} className="shop-newc" href={`/health/p/${encodeURIComponent(p.code)}`} data-product={p.code}>
                      <span className="ph"><ProductArt p={p} size={84} /></span>
                      <span className="bd"><b>{p.name}</b><span className="pr">{krw(p.price)}</span>{star(p)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {deals.length > 0 && (
          <section className="shop-sec" data-shop-deal="1">
            <SecHead title={t('sec.deal')} lead={t('sec.dealLead')} all="/health/c/ALL" />
            <div className="shop-deal">
              {deals.map((p) => (
                <Link key={p.code} className="shop-dealc" href={`/health/p/${encodeURIComponent(p.code)}`} data-product={p.code}>
                  <span className="ph"><ProductArt p={p} size={76} /></span>
                  <b>{p.name}</b>
                  {p.mainIngredient && <span className="ds">{p.mainIngredient.name}{p.mainIngredient.amount ? ` | ${p.mainIngredient.amount}` : ''}</span>}
                  <span className="ds">{p.summary ?? p.category ?? ''}</span>
                  <span className="pr"><strong>{krw(p.price)}</strong><s>{krw(p.listPrice)}</s><i>{p.offPct}%</i></span>
                  {star(p)}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="shop-band" data-shop-band="1">
          <ShopPic name="band-left" h={110} className="l" />
          <ShopPic name="band-right" h={110} className="r" />
          <div className="tx">
            <b>{t.rich('band.title', { em: (c) => <em>{c}</em> })}</b>
            <span>{t('band.lead')}</span>
          </div>
          {/* v10.31 (시안 「특가 상품 보러가기」) */}
          <Link className="go" href="/health/c/ALL">{t('band.go')}</Link>
        </section>
      </div>
    </>
  );
}
