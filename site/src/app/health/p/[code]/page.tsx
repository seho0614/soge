/** SB-HLT-PRD-010 상품 상세 — v10.26 시안(spec/proto.html 20184 ~ 20378) 그대로 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet, ApiFailure } from '@/lib/api';
import type { HltProductDetail } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid, SellerBox } from '@/components/health/HltParts';
import { OptionRows } from '@/components/health/OptionRows';
import { Msgs } from '@/i18n/Msgs';
import { ProductArt } from '@/components/health/ProductArt';
import { RETURN_SHIP_ROUND_TRIP, RETURN_WINDOW_DAYS } from '@/components/health/util';
import { QnaPanel, ReviewsPanel, stars } from '@/components/health/ReviewPanels';
import { me } from '@/lib/session';
import { getFmt } from '@/lib/getFmt';

type Props = { params: Promise<{ code: string }>; searchParams?: Promise<{ tab?: string; rating?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const p = await apiGet<HltProductDetail>(`/health/products/${encodeURIComponent(decodeURIComponent(code))}`, 30)
    .catch(() => null);
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: p?.name ?? t('product.title') }) };
}

/**
 * 상품 상세 (v10.26 — 옵션 · 정가 · 할인율 · 한 달 단가 · 고시 · 주의사항 · 교환 배송비).
 *
 * **청약철회 조건이 함께 옵니다** — 사시기 전에 아셔야 나중에 다투지 않습니다(API 설명).
 * 시안과 다른 곳(10/8 확인): 「최대 할인가 한 달 N원」은 살 수 있는 옵션 가운데서(품절 옵션 제외) ·
 *   리뷰 · 문의 탭과 별점은 v10.27(그 자료가 생긴 뒤) · 심의필 번호가 있으면 보입니다(개발분에 남기기로 한 것).
 */
export default async function HltProductPage({ params, searchParams }: Props) {
  const { code: raw } = await params;
  /* v10.28 (D036) — 탭: 상세 · 리뷰 · 문의(주소 ?tab= 로 — 새로 고침 · 공유해도 같은 탭) */
  const sp = (await searchParams) ?? {};
  const tab = sp.tab === 'reviews' || sp.tab === 'qna' ? sp.tab : 'detail';
  const rating = Number(sp.rating) >= 1 && Number(sp.rating) <= 5 ? Number(sp.rating) : undefined;
  const code = decodeURIComponent(raw);
  const t = await getTranslations('hlt.product');
  const f = await getFmt();
  const tc = await getTranslations('hlt.common');
  const tk = await getTranslations('hlt.card');

  let p: HltProductDetail | null = null;
  let err: string | null = null;
  try {
    p = await apiGet<HltProductDetail>(`/health/products/${encodeURIComponent(code)}`, 30);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : tc('loadFailProduct');
  }

  if (!p) {
    return (
      <><div className="hlt">
        <HltNav />
        <Crumb items={[{ label: t('title') }]} />
        <HltEmpty msg={err ?? t('notOnSale')} href="/health/c/ALL" label={tc('viewAllProducts')} />
      </div><i hidden data-root-end="" /></>
    );
  }

  const ing = p.mainIngredient ?? null;
  const cons = p.concerns ?? [];
  const same = (p.sameIngredient ?? []).slice(0, 4);
  const days = p.withdrawalDays ?? RETURN_WINDOW_DAYS;
  const seller = p.sellerType === 'DIRECT' || !p.sellerType;

  return (
    <><div className="hlt" data-screen="SB-HLT-PRD-010">
      <HltNav back="/health" />
      <Crumb items={[
        ing ? { href: `/health/i/${encodeURIComponent(ing.code)}`, label: ing.name } : { href: '/health/c/ALL', label: tc('allProducts') },
        { label: p.name },
      ]} />

      <div className="hlt-pd26">
        <div><div className="hlt-gal"><ProductArt p={p} size={300} /></div></div>
        <div>
          {(p.badge || p.soldOut) && (
            <div>
              {p.badge && <span className="hlt-bdg st ok" data-badge={p.badge}>{p.badge}</span>}
              {/* 옵션이 하나뿐인 상품은 옵션 줄(품절 표)을 그리지 않아 여기에 품절을 적습니다 */}
              {p.soldOut && <>{p.badge && ' '}<span className="hlt-bdg soldout" data-soldout>{tk('soldOut')}</span></>}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <span className={`hlt-bdg ${seller ? 'direct' : 'tenant'}`}>{seller ? tk('direct') : tk('tenant')}</span>
            {' '}<span className="hlt-sm hlt-mut">{p.sellerName ?? tk('defaultSeller')}</span>
          </div>
          {ing && <div className="hlt-ingline" data-ingline="1" style={{ fontSize: 14, marginTop: 9 }}>{ing.name}{ing.amount && <> <span className="bar">|</span> {ing.amount}</>}</div>}
          <h1>{p.name}</h1>
          {(p.reviewCount ?? 0) > 0 && <Link className="hlt-rvline" href={`/health/p/${encodeURIComponent(code)}?tab=reviews#reviews`} data-rating-line>
            <span className="hlt-stars">{stars(Number(p.ratingAvg ?? 0))}</span> {t('ratingLine', { avg: Number(p.ratingAvg ?? 0).toFixed(1), n: String(p.reviewCount) })}</Link>}
          {p.summary && <p className="hlt-mut hlt-sm">{p.summary}</p>}

          <div className="hlt-p26" style={{ margin: '14px 0 2px' }}>{p.offPct ? <span className="was">{f.won(p.listPrice, '-')}</span> : null}</div>
          <div className="hlt-p26">
            {p.offPct ? <span className="off" style={{ fontSize: 20 }}>{p.offPct}%</span> : null}
            <span className="now" style={{ fontSize: 24 }}>{f.won(p.price, '-')}</span>
          </div>
          {p.minUnit != null && (p.optionCount ?? 1) > 1 && (
            <div className="hlt-u26 big" data-unit="1" style={{ marginTop: 6 }}>{t.rich('maxDiscount', { amt: f.won(p.minUnit, '-'), b: (c) => <b>{c}</b> })}</div>
          )}
          {p.reviewNo && <p className="hlt-rev">{t('adReview', { no: p.reviewNo })}</p>}

          <Msgs ns={['order']}><OptionRows code={p.code} name={p.name} options={p.options ?? []} /></Msgs>

          <div style={{ marginTop: 18 }}><SellerBox /></div>

          <section className="hlt-box" data-withdrawal-block="1" data-ship-block style={{ marginTop: 12 }}>
            <h3>{t('shipTitle')}</h3>
            <table className="tbl hlt-tbl">
              <tbody>
                <tr><th>{t('shipFee')}</th><td>{t('shipFeeVal')}</td></tr>
                <tr><th>{t('returnFee')}</th><td>{t('returnFeeVal', { amt: f.won(RETURN_SHIP_ROUND_TRIP, '-') })}</td></tr>
                {/* v10.26 — 시안의 「교환 배송비」 줄. 회원 사정(단순 변심 · 잘못 주문) 교환만 · 신청 때 결제(약관 제3조) */}
                <tr data-exchange-fee={p.exchangeFee}><th>{t('exchangeFee')}</th><td>{t('exchangeFeeVal', { amt: f.won(p.exchangeFee, '-') })}</td></tr>
                {p.returnAddr && <tr><th>{t('returnAddr')}</th><td>{p.returnAddr}</td></tr>}
                <tr><th>{t('withdrawal')}</th><td>{t('withdrawalVal', { days: String(days) })}</td></tr>
                {p.withdrawalBlockedIf && <tr><th>{t('withdrawalBlocked')}</th><td className="hlt-warn">{p.withdrawalBlockedIf}</td></tr>}
                {p.withdrawalLaw && <tr><th>{t('law')}</th><td>{p.withdrawalLaw}</td></tr>}
              </tbody>
            </table>
            <p className="hint">{t.rich('more', { link: (c) => <Link href="/health/guide">{c}</Link> })}</p>
          </section>
        </div>
      </div>

      {p.notMedicine && (
        <div className="hlt-note26" data-notdrug="1" style={{ marginTop: 14 }}>
          {tc('notMedicine')}
        </div>
      )}

      <section className="hlt-sec">
        {/* 시안의 탭 줄 — v10.28 (D036) 리뷰 · 문의 */}
        <div className="hlt-tabs26" role="tablist">
          {([['detail', t('tabDetail')], ['reviews', t('tabReviews', { n: String(p.reviewCount ?? 0) })], ['qna', t('tabQna')]] as const).map(([k, label]) =>
            <Link key={k} href={`/health/p/${encodeURIComponent(code)}${k === 'detail' ? '' : `?tab=${k}`}`} role="tab" aria-selected={tab === k}
              className={tab === k ? 'on' : undefined} data-tab={k} scroll={false}>{label}</Link>)}
        </div>
        {tab === 'reviews' && <ReviewsPanel code={code} rating={rating} />}
        {tab === 'qna' && <QnaPanel code={code} loggedIn={!!(await me().catch(() => null))} />}
        {tab === 'detail' && <>
        <div className="hlt-box">
          {p.summary && <p>{p.summary}</p>}
          <div className="hlt-note26 warn" style={{ marginTop: 12 }}>
            <b>{t('mfrTitle')}</b><br />
            {t('mfrBody')}
          </div>
        </div>
        {(p.notice ?? []).length > 0 && (
          <div className="hlt-box" data-notice-block="1" style={{ marginTop: 12 }}>
            <h3>{t('noticeTitle')}</h3>
            <table className="tbl hlt-tbl" style={{ marginTop: 8 }}>
              <tbody>{p.notice.map((r) => <tr key={r.label}><th>{r.label}</th><td>{r.value}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {p.caution && (
          <div className="hlt-box" data-caution-block="1" style={{ marginTop: 12 }}>
            <h3>{p.cautionTitle}</h3>
            <div className="hlt-note26 warn" style={{ marginTop: 8 }}>{p.caution}</div>
          </div>
        )}
        </>}
      </section>

      {same.length > 0 && ing && (
        <section className="hlt-sec">
          <h2>{t('sameTitle', { name: ing.name })} <Link className="hlt-more" href={`/health/i/${encodeURIComponent(ing.code)}`}>{t('viewAll')}</Link></h2>
          <ProductGrid list={same} />
        </section>
      )}
      {cons.length > 0 && (
        <section className="hlt-sec">
          <h2>{t('related')}</h2>
          <div className="hlt-chips">
            {cons.map((c) => <Link key={c.code} className="hlt-chip" href={`/health/w/${c.code}`}>{c.icon} {c.name}</Link>)}
          </div>
        </section>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
