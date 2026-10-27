import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import type { ListingDetailData, ListingReviewList } from '@/lib/types';
import { uiMessages } from '@/lib/content';
import { me } from '@/lib/session';
import { ago, ym, PATH_GWAN, ymdKst } from '@/lib/format';
import { RefShare } from '@/components/refcode/RefShare';
import { BackBar } from '@/components/common/BackBar';
import { GwDetailBar, GwPhotos, GwProfileActions, GwQna } from '@/components/gwan/GwDetailClient';
import { GwOwnerTools } from '@/components/gwan/GwOwnerTools';
import { EarnPromo } from '@/components/gwan/GwParts';
import { manwon, photoSrc, trustCls } from '@/components/gwan/gw';
import { SearchBox } from '@/components/search/SearchBox';
import { KakaoMap, type MapGeo } from '@/components/map/KakaoMap';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import { getFmt } from '@/lib/getFmt';
import { isGwanKey } from '@/i18n/keys';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

type Props = { params: Promise<{ gwan: string; id: string }> };

/* ★ 상세 응답은 **보는 사람마다 다릅니다**(관심 담았는지 · 문의할 수 있는지). 그래서 캐시하지 않는 쪽(apiGetPersonal)으로 읽습니다.
 *   한 요청 안에서 제목(generateMetadata)과 본문이 같은 응답을 쓰도록 묶습니다 — 따로 부르면 조회 수가 두 번 올라갑니다. */
const getItem = cache((id: string) => apiGetPersonal<ListingDetailData>(`/listings/${id}`));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gwan, id } = await params;
  if (!PATH_GWAN[gwan]) return {};
  const item = await getItem(id).catch(() => null);
  if (!item) return {};
  const t = await getTranslations('detail.meta');
  const f = await getFmt();
  return {
    title: item.title,
    description: t('desc', { cat: item.categoryName, fee: f.won(item.desiredFee) }),
  };
}

const day = (iso: string) => ymdKst(iso).replace(/-/g, '.');

/**
 * SB-{G}-DTL-010 매물 상세 — 세 관(소개장터 · 안심소개 · 소개창업)이 한 틀입니다.
 *
 * v10.29 — 시안 detailFor() 배치 그대로:
 *   돌아가기 줄 · 검색줄(+ 「소개로 수익을 만드는 사람들!」) → 큰 사진 · 분류 · 제목 · 금액 · 한 줄 · 조회/관심/시간/지역/매물번호
 *   → 등록자 카드(질문하기 · 전화하기) → 소개자 실적 → 소개 상품 상세 설명(항목 · 내용 표) → 문의 내용
 *   → 소개자 후기 | 소개 내용 → 맨 아래 줄(관심 담기 · 질문 · 공유하기 · 신고 · 1:1 문의 시작) → 귀속 안내
 * 개발에만 있는 「소개코드 공유」(안심소개 · D010)는 시안의 「이 매물 소개하기」 칸에 둡니다.
 *
 * ★ 실제 웹에는 **서버에 있는 값만** 냅니다. 시안의 견본 숫자(128건 · 15,680,000원 · 신용 86점 · 견본 후기)는 넣지 않습니다.
 *   · 소개자 실적 — 서버 집계(v_owner_public_stats) 4칸(시안). 누적수익은 본인이 공개를 켠 경우에만 값이 오고, 아니면 「비공개」.
 *   · 금액 자리 — v10.31: 거래(희망) 금액(시안 「8,500만원」). 없으면 소개비 · 안심소개 부동산은 「금액 협의」(노출료 · A-07).
 *   · 사진 — v10.31: 올린 사진을 넘겨 봅니다(시안 「1/5」 · GwPhotos). 없으면 시안과 같은 분류 그림.
 *   · 「신용 86점」 자리 — v10.31: 서버의 **소개 신뢰도**(v_account_trust = fn_trust_score · 36.5 에서 시작 · 나의공간 「거래신용」과 같은 점수).
 *     합침(10/10 사용자 확인): 점수는 하나(fn_trust_score), 화면 이름은 시안 화면마다 시안 글자 — 상세는 시안 「신용 N점」, 카드는 「소개 신뢰도」, 나의공간은 「거래신용」(×10).
 *   · 매물번호 — v10.31: 서버의 사람이 읽는 번호(L-1024 꼴).
 *   · 안내 — 시안 문구: 단추 아래 「대화가 시작되면 소개코드가 발급됩니다」 · 맨 아래 INV-2 · 소개장터 A-12 · 안심소개 부동산 A-07(운영 문구 ui_messages).
 */
export default async function DetailPage({ params }: Props) {
  const { gwan, id } = await params;
  /* 20261002 — 없는 관(/proto/…)이나 형식이 틀린 번호는 404 입니다(전에는 API 400 이 그대로 던져져 500). */
  if (!PATH_GWAN[gwan]) notFound();
  const messages = await uiMessages();
  const t = await getTranslations('detail.page');
  const tg = await getTranslations('header.gwan');
  const f = await getFmt();
  /* 금액 — 한국어는 억 · 만 줄임 그대로, 다른 언어는 전체 숫자 ₩ (v10.102 · 2-5c) */
  const mw = (n: number | null | undefined) => (f.ko ? manwon(n) : f.won(n));
  let item: ListingDetailData;
  try {
    item = await getItem(id);
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const [reviews, questions] = await Promise.all([
    apiGet<ListingReviewList>(`/listings/${id}/reviews`, 10).catch(() => ({ count: 0, average: null, items: [] } as ListingReviewList)),
    apiGet<unknown[]>(`/listings/${id}/questions`, 10).catch(() => [] as unknown[]),
  ]);
  const o = item.owner;
  const code = PATH_GWAN[gwan];
  const viewer = await me();
  const reg = item.regionNames.join(' · ');
  const when = f.ago(item.publishedAt, ago(item.publishedAt));
  const tags = Array.from(new Set(`${item.regionNames[0] ?? ''} ${item.categoryName}`.split(/[\s/·,]+/).filter(Boolean))).slice(0, 5);
  const realty = !!item.isRealty;
  const fee = realty ? t('feeRealty') : `${f.won(item.desiredFee)}${item.feeBearerLabel ? ` · ${item.feeBearerLabel}` : ''}`;
  const price = item.dealAmount != null ? mw(item.dealAmount) : realty ? t('negotiableAmount') : null;
  const trust = item.trust?.score ?? item.trustScore ?? null;
  const no = item.listingNo ? `L-${item.listingNo}` : item.id.slice(0, 8).toUpperCase();
  const msg = messages as Record<string, string>;
  /* 관 이름 — 이 화면에 정해 둔 글자(서버 이름 아님) → 사전 header.gwan.* */
  const gwanName = isGwanKey(code) ? tg(code) : undefined;
  /* v10.46 (docs/96) — 지도에 넘길 좌표(좌표가 없거나 아직 찾는 중이면 null → 지도 칸 없음) */
  const g = item.geo;
  const mapGeo: MapGeo | null = !g || g.lat == null || g.lng == null ? null
    : g.precision === 'REGION' ? { precision: 'REGION', lat: g.lat, lng: g.lng, radiusM: g.radiusM, label: g.label }
    : { precision: 'EXACT', lat: g.lat as number, lng: g.lng as number };

  return (
    <><Msgs ns={['detail']}><div className="gw" data-gw={code}>
      <div className="gw-wrap" style={{ paddingTop: 16 }}>
        <BackBar href={`/${gwan}`} label={gwanName ?? t('list')} wrap={false} />
        <SearchBox variant="gwan" gwanCode={code === 'HLT' ? 'HLT' : (code as 'MNY' | 'MAL' | 'BIZ')} blue aside={<EarnPromo />} />
      </div>

      <div className="gw-wrap" style={{ paddingTop: 14 }}>
        <div className="gw-panel gw-dtp" style={{ overflow: 'hidden' }}>
          <div className="gw-dt">
            <div>
              <GwPhotos urls={item.mediaUrls} fallback={photoSrc(item.categoryName)} alt={item.title} status={item.statusLabel} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <span className="gw-dtcat">{item.categoryName}</span>
                <span className="gw-dtbadges">
                  {item.badges.map((b) => <span key={b.type} className={`gw-bdg gw-bdg-${b.type.toLowerCase()}`}>{b.label}</span>)}
                  {/* 유료 노출은 라벨과 함께만 나갑니다 (전상법) */}
                  {item.isAd && item.adLabel && <span className="gw-bdg gw-bdg-ad">{item.adLabel}</span>}
                </span>
              </div>
              <h1 className="gw-dtt">{item.title}</h1>
              <div className="gw-dtprice">{price ?? <><small className="gw-prl">{t('fee')}</small> {mw(item.desiredFee)}</>}</div>
              <div className="gw-dtsub">{item.summary ? <>{item.summary}<br /></> : null}{[reg, item.categoryName].filter(Boolean).join(' · ')}
                {!realty && price && item.desiredFee != null && <><br />{t('feeValue', { v: mw(item.desiredFee) })}{item.feeBearerLabel ? ` · ${item.feeBearerLabel}` : ''}</>}
                {!realty && !price && item.feeBearerLabel && <><br />{t('feeValue', { v: item.feeBearerLabel })}</>}
                {realty && <><br />{withCodes(t('realtyNote'))}</>}</div>
              <div className="gw-dtmeta">
                <span>{t('views', { n: item.viewCount.toLocaleString('ko-KR') })}</span>
                <span>{t('likes', { n: item.likeCount.toLocaleString('ko-KR') })}</span>
                {when && <span suppressHydrationWarning>🕐 {when}</span>}
                {reg && <span className="gw-dtloc">📍 {reg}</span>}
                {trust != null && <span className={`gw-dttr ${trustCls(Number(trust))}`} title={t('trustTitle')}>{t('trust', { n: String(Math.round(Number(trust))) })}</span>}
                <span className="gw-dtno">{t('listingNo', { no })}</span>
              </div>
            </div>
          </div>

          <div className="gw-dtprof">
            <span className="gw-av gw-avx" aria-hidden="true">{[...o.companyName][0]}</span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="gw-nm">{o.companyName}{o.verified && <span className="gw-vbdg">{t('verified')}</span>}</div>
              <div className="gw-mt2">{reg && <>{t('activeRegion')} &nbsp; {reg} &nbsp;&nbsp; </>}{t('joined')} &nbsp; {ym(o.joinedAt)}</div>
            </div>
            <GwProfileActions />
          </div>

          <div className="gw-sth">{t('statsHead')} <span title={t('statsTip')}>?</span></div>
          <div className="gw-stat">
            <div><div className="gw-k">{t('statTotal')}</div><div className="gw-v">{t('count', { n: o.totalDeals.toLocaleString('ko-KR') })}</div></div>
            <div><div className="gw-k">{t('statConfirmed')}</div><div className="gw-v">{t('count', { n: o.confirmedDeals.toLocaleString('ko-KR') })}</div></div>
            <div><div className="gw-k">{t('statRate')}</div><div className="gw-v">{o.successRate != null ? `${o.successRate}%` : '—'}</div></div>
            {/* 누적수익은 등록자 본인이 마이 > 내 정보에서 공개를 켠 경우에만 서버가 값을 줍니다(그 밖은 「비공개」 — 시안 4칸) */}
            <div title={t('statSettledTip')}><div className="gw-k">{t('statSettled')}</div><div className="gw-v">{o.settledAmount != null ? f.won(o.settledAmount) : <span className="gw-ls">{t('private')}</span>}</div></div>
          </div>

          <div className="gw-dsec">
            <h4>{t('descHead')}</h4>
            {item.body ? <p className="gw-body">{item.body}</p> : <p>{t.rich('descFallback', { gwan: gwanName ?? '', title: item.title, b: (c) => <b>{c}</b> })}</p>}
            <dl className="gw-spec">
              <dt>{t('specCat')}</dt><dd>{item.categoryName}</dd>
              <dt>{t('specRegion')}</dt><dd>{reg || t('negotiable')}</dd>
              <dt>{t('specAmount')}</dt><dd>{item.dealAmount != null ? mw(item.dealAmount) : t('negotiableAmount')}</dd>
              <dt>{t('specFee')}</dt><dd>{withCodes(fee)}</dd>
              <dt>{t('specRegistered')}</dt><dd suppressHydrationWarning>{when || '—'}</dd>
              <dt>{t('specStatus')}</dt><dd>{item.statusLabel}</dd>
            </dl>
            {/* v10.46 (docs/96) — 좌표가 있고 지도 사용이 켜져 있을 때만 그립니다(아니면 아무것도 더하지 않음 — 지금 화면 그대로).
                남에게는 서버가 시 · 구 중심(REGION)만 줍니다 — 정확한 위치는 본인에게만 */}
            {mapGeo && (
              <KakaoMap geo={mapGeo}
                caption={mapGeo.precision === 'REGION' ? <>{t('mapRegion', { label: mapGeo.label ?? '' })}</>
                  : <>{t('mapExact')}</>} />
            )}
            <p style={{ marginTop: 11 }}>{t('termsNote')}</p>
          </div>

          <div style={{ marginTop: 18 }}>
            <GwQna listingId={item.id} canAsk={item.canInquire} notice={messages.QNA_MASKED} allHref={`/${gwan}/${id}/qna`} />
          </div>

          <div className="gw-dsec" style={{ marginTop: 20 }}>
            <div className="gw-dgrid">
              <div>
                <h4>{t('reviewsHead')} <span className="gw-rvc">{reviews.count}</span>{reviews.average != null && <span className="gw-rva">{t('reviewsAvg', { avg: String(reviews.average) })}</span>}</h4>
                {reviews.items.length === 0 ? (
                  <p className="gw-rvempty">{t('reviewsEmpty')}</p>
                ) : (
                  <div className="gw-revs">
                    {reviews.items.slice(0, 6).map((r) => (
                      <div key={r.id} className="gw-rv2">
                        <div className="gw-rvtop">
                          <span className="gw-av gw-avx gw-avs" aria-hidden="true">{[...r.authorName][0]}</span>
                          <div className="gw-rvid"><div className="gw-t2"><span className="gw-nm">{r.authorName}</span><span className="gw-dt3">{day(r.createdAt)}</span></div></div>
                        </div>
                        <div className="gw-stars" aria-label={t('ratingAria', { n: String(r.rating) })}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                        {r.body && <div className="gw-tx">{r.body}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>{t('introHead')}</h4>
                <dl className="gw-spec gw-ic" style={{ gridTemplateColumns: '78px 1fr' }}>
                  <dt><i>📁</i>{t('specCat')}</dt><dd>{item.categoryName}</dd>
                  <dt><i>📍</i>{t('specRegion')}</dt><dd>{reg || t('negotiable')}</dd>
                  <dt><i>💰</i>{t('specAmount')}</dt><dd>{item.dealAmount != null ? mw(item.dealAmount) : realty ? t('negotiableAmount') : t('feeValue', { v: f.won(item.desiredFee) })}</dd>
                  <dt><i>🕑</i>{t('specRegistered')}</dt><dd suppressHydrationWarning>{when || '—'}</dd>
                </dl>
                <div className="gw-tags">{tags.map((t) => <span key={t}>#{t}</span>)}</div>
              </div>
            </div>
          </div>

          <GwDetailBar id={item.id} path={`/${gwan}/${item.id}`} loggedIn={!!viewer} liked={item.liked}
                       canInquire={item.canInquire} blockReason={item.inquireBlockReason}
                       questionCount={questions.length} ctaNote={msg.CTA_ATTRIBUTION} />
        </div>

        {/* v10.31 — 주인에게만: 사진 올리기 · 급구/급매 신청 */}
        {item.inquireBlockReason === 'OWN_LISTING' && (
          <GwOwnerTools id={item.id} mediaIds={item.mediaIds ?? []} mediaUrls={item.mediaUrls} urgent={item.urgent} published={item.status === 'PUBLISHED'} />
        )}

        {/* 관마다 다른 안내(시안 그대로) — 안심소개 부동산: 노출료(A-07) · 소개장터: 소개비 협의(A-12) */}
        {realty && <div className="gw-nt gw-warn" data-msg="RE_EXPOSURE_A07">{msg.RE_EXPOSURE_A07 ? <AttrNote text={msg.RE_EXPOSURE_A07} /> : withCodes(t.rich('realtyA07', { b: (c) => <b>{c}</b> }))}</div>}
        {code === 'MNY' && <div className="gw-nt gw-info" data-msg="FEE_A12_DETAIL">{msg.FEE_A12_DETAIL ? <AttrNote text={msg.FEE_A12_DETAIL} /> : withCodes(t.rich('feeA12', { b: (c) => <b>{c}</b> }))}</div>}

        {/* SB-MAL-DTL-010 「소개코드 공유」 (D010) — 안심소개 매물만. 시안의 「이 매물 소개하기」 칸 */}
        {code === 'MAL' && (
          <div className="gw-panel gw-refp" style={{ marginTop: 14 }}>
            <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>{t('refHead')}</b><span className="gw-ls">{t('refSub')}</span></div>
            <RefShare path={`/mall/${item.id}`} listingId={item.id} />
          </div>
        )}

        <div className="gw-nt gw-info" data-msg="CTA_ATTRIBUTION_NOTE">{msg.CTA_ATTRIBUTION_NOTE
          ? <AttrNote text={msg.CTA_ATTRIBUTION_NOTE} />
          : withCodes(t.rich('ctaAttr', { b: (c) => <b>{c}</b> }))} <Link href="/safety/guide">{t('safetyGuide')}</Link></div>
      </div>
    </div></Msgs><i hidden data-root-end="" /></>
  );
}

/** 운영 문구의 첫 문장(마침표까지)을 굵게 — 시안 .nt 의 「<b>첫 문장</b> 나머지」 모양 */
function AttrNote({ text }: { text: string }) {
  const m = text.match(/^(.+?[.)。])\s+(.*)$/s);
  return m ? <><b>{m[1]}</b> {m[2]}</> : <b>{text}</b>;
}
