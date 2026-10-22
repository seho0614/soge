/** SB-HLT-PRD-010 상품 상세 — v10.26 시안(spec/proto.html 20184 ~ 20378) 그대로 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, ApiFailure } from '@/lib/api';
import type { HltProductDetail } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid, SellerBox } from '@/components/health/HltParts';
import { OptionRows } from '@/components/health/OptionRows';
import { ProductArt } from '@/components/health/ProductArt';
import { krw, RETURN_SHIP_ROUND_TRIP, RETURN_WINDOW_DAYS } from '@/components/health/util';
import { QnaPanel, ReviewsPanel, stars } from '@/components/health/ReviewPanels';
import { me } from '@/lib/session';

type Props = { params: Promise<{ code: string }>; searchParams?: Promise<{ tab?: string; rating?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const p = await apiGet<HltProductDetail>(`/health/products/${encodeURIComponent(decodeURIComponent(code))}`, 30)
    .catch(() => null);
  return { title: `${p?.name ?? '상품 상세'} · 소개몰` };
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

  let p: HltProductDetail | null = null;
  let err: string | null = null;
  try {
    p = await apiGet<HltProductDetail>(`/health/products/${encodeURIComponent(code)}`, 30);
  } catch (e) {
    err = e instanceof ApiFailure && e.status < 500 ? e.body.message : '상품을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.';
  }

  if (!p) {
    return (
      <><div className="hlt">
        <HltNav />
        <Crumb items={[{ label: '상품 상세' }]} />
        <HltEmpty msg={err ?? '판매 중인 상품이 아닙니다.'} href="/health/c/ALL" label="전체제품 보기" />
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
        ing ? { href: `/health/i/${encodeURIComponent(ing.code)}`, label: ing.name } : { href: '/health/c/ALL', label: '전체제품' },
        { label: p.name },
      ]} />

      <div className="hlt-pd26">
        <div><div className="hlt-gal"><ProductArt p={p} size={300} /></div></div>
        <div>
          {(p.badge || p.soldOut) && (
            <div>
              {p.badge && <span className="hlt-bdg st ok" data-badge={p.badge}>{p.badge}</span>}
              {/* 옵션이 하나뿐인 상품은 옵션 줄(품절 표)을 그리지 않아 여기에 품절을 적습니다 */}
              {p.soldOut && <>{p.badge && ' '}<span className="hlt-bdg soldout" data-soldout>품절</span></>}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <span className={`hlt-bdg ${seller ? 'direct' : 'tenant'}`}>{seller ? '직판' : '입점'}</span>
            {' '}<span className="hlt-sm hlt-mut">{p.sellerName ?? '소개뱅크 직판관'}</span>
          </div>
          {ing && <div className="hlt-ingline" data-ingline="1" style={{ fontSize: 14, marginTop: 9 }}>{ing.name}{ing.amount && <> <span className="bar">|</span> {ing.amount}</>}</div>}
          <h1>{p.name}</h1>
          {(p.reviewCount ?? 0) > 0 && <Link className="hlt-rvline" href={`/health/p/${encodeURIComponent(code)}?tab=reviews#reviews`} data-rating-line>
            <span className="hlt-stars">{stars(Number(p.ratingAvg ?? 0))}</span> {Number(p.ratingAvg ?? 0).toFixed(1)} · 리뷰 {p.reviewCount}개</Link>}
          {p.summary && <p className="hlt-mut hlt-sm">{p.summary}</p>}

          <div className="hlt-p26" style={{ margin: '14px 0 2px' }}>{p.offPct ? <span className="was">{krw(p.listPrice)}</span> : null}</div>
          <div className="hlt-p26">
            {p.offPct ? <span className="off" style={{ fontSize: 20 }}>{p.offPct}%</span> : null}
            <span className="now" style={{ fontSize: 24 }}>{krw(p.price)}</span>
          </div>
          {p.minUnit != null && (p.optionCount ?? 1) > 1 && (
            <div className="hlt-u26 big" data-unit="1" style={{ marginTop: 6 }}>최대 할인가 <b>한 달 {krw(p.minUnit)}</b> (지금 살 수 있는 옵션 기준)</div>
          )}
          {p.reviewNo && <p className="hlt-rev">광고 사전심의 {p.reviewNo}</p>}

          <OptionRows code={p.code} name={p.name} options={p.options ?? []} />

          <div style={{ marginTop: 18 }}><SellerBox /></div>

          <section className="hlt-box" data-withdrawal-block="1" data-ship-block style={{ marginTop: 12 }}>
            <h3>배송 · 교환 · 반품</h3>
            <table className="tbl hlt-tbl">
              <tbody>
                <tr><th>배송비</th><td>전 상품 무료</td></tr>
                <tr><th>반품 배송비</th><td>왕복 {krw(RETURN_SHIP_ROUND_TRIP)} (단순 변심 · 잘못 주문 시 환불액에서 뺍니다)</td></tr>
                {/* v10.26 — 시안의 「교환 배송비」 줄. 회원 사정(단순 변심 · 잘못 주문) 교환만 · 신청 때 결제(약관 제3조) */}
                <tr data-exchange-fee={p.exchangeFee}><th>교환 배송비</th><td>왕복 {krw(p.exchangeFee)} (단순 변심 · 잘못 주문 시 신청 때 결제 · 하자 · 오배송은 무료)</td></tr>
                {p.returnAddr && <tr><th>반품 주소</th><td>{p.returnAddr}</td></tr>}
                <tr><th>청약철회</th><td>수령 후 {days}일 이내 (전자상거래법 제17조)</td></tr>
                {p.withdrawalBlockedIf && <tr><th>철회 제한</th><td className="hlt-warn">{p.withdrawalBlockedIf}</td></tr>}
                {p.withdrawalLaw && <tr><th>근거</th><td>{p.withdrawalLaw}</td></tr>}
              </tbody>
            </table>
            <p className="hint">자세한 것은 <Link href="/health/guide">이용안내 · 청약철회</Link></p>
          </section>
        </div>
      </div>

      {p.notMedicine && (
        <div className="hlt-note26" data-notdrug="1" style={{ marginTop: 14 }}>
          건강기능식품은 질병의 예방이나 치료를 위한 의약품이 아닙니다. 복용 중인 약이 있으시면 의사나 약사와 상의하십시오.
        </div>
      )}

      <section className="hlt-sec">
        {/* 시안의 탭 줄 — v10.28 (D036) 리뷰 · 문의 */}
        <div className="hlt-tabs26" role="tablist">
          {([['detail', '상세 설명'], ['reviews', `리뷰 ${p.reviewCount ?? 0}`], ['qna', '문의']] as const).map(([k, label]) =>
            <Link key={k} href={`/health/p/${encodeURIComponent(code)}${k === 'detail' ? '' : `?tab=${k}`}`} role="tab" aria-selected={tab === k}
              className={tab === k ? 'on' : undefined} data-tab={k} scroll={false}>{label}</Link>)}
        </div>
        {tab === 'reviews' && <ReviewsPanel code={code} rating={rating} />}
        {tab === 'qna' && <QnaPanel code={code} loggedIn={!!(await me().catch(() => null))} />}
        {tab === 'detail' && <>
        <div className="hlt-box">
          {p.summary && <p>{p.summary}</p>}
          <div className="hlt-note26 warn" style={{ marginTop: 12 }}>
            <b>성분이 같아도 제조사는 다를 수 있습니다</b><br />
            소개몰은 성분으로 정리해 파는 곳이라, 같은 성분·같은 함량이어도 회차에 따라 제조사나 포장이 달라질 수 있습니다. 성분과 함량은 표시된 값 그대로입니다.
          </div>
        </div>
        {(p.notice ?? []).length > 0 && (
          <div className="hlt-box" data-notice-block="1" style={{ marginTop: 12 }}>
            <h3>상품정보제공고시</h3>
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
          <h2>{ing.name} 의 다른 상품 <Link className="hlt-more" href={`/health/i/${encodeURIComponent(ing.code)}`}>전체 보기</Link></h2>
          <ProductGrid list={same} />
        </section>
      )}
      {cons.length > 0 && (
        <section className="hlt-sec">
          <h2>관련 고민</h2>
          <div className="hlt-chips">
            {cons.map((c) => <Link key={c.code} className="hlt-chip" href={`/health/w/${c.code}`}>{c.icon} {c.name}</Link>)}
          </div>
        </section>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
