import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import type { ListingDetailData, ListingReviewList } from '@/lib/types';
import { uiMessages } from '@/lib/content';
import { me } from '@/lib/session';
import { won, ago, ym, PATH_GWAN, ymdKst } from '@/lib/format';
import { RefShare } from '@/components/refcode/RefShare';
import { BackBar } from '@/components/common/BackBar';
import { GwDetailBar, GwPhotos, GwProfileActions, GwQna } from '@/components/gwan/GwDetailClient';
import { GwOwnerTools } from '@/components/gwan/GwOwnerTools';
import { EarnPromo } from '@/components/gwan/GwParts';
import { manwon, photoSrc, trustCls } from '@/components/gwan/gw';
import { SearchBox } from '@/components/search/SearchBox';
import { KakaoMap, type MapGeo } from '@/components/map/KakaoMap';

type Props = { params: Promise<{ gwan: string; id: string }> };

const GWAN_NAME: Record<string, string> = { MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개몰' };

/* ★ 상세 응답은 **보는 사람마다 다릅니다**(관심 담았는지 · 문의할 수 있는지). 그래서 캐시하지 않는 쪽(apiGetPersonal)으로 읽습니다.
 *   한 요청 안에서 제목(generateMetadata)과 본문이 같은 응답을 쓰도록 묶습니다 — 따로 부르면 조회 수가 두 번 올라갑니다. */
const getItem = cache((id: string) => apiGetPersonal<ListingDetailData>(`/listings/${id}`));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gwan, id } = await params;
  if (!PATH_GWAN[gwan]) return {};
  const item = await getItem(id).catch(() => null);
  if (!item) return {};
  return {
    title: item.title,
    description: `${item.categoryName} · 소개비 ${won(item.desiredFee)}`,
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
  const when = ago(item.publishedAt);
  const tags = Array.from(new Set(`${item.regionNames[0] ?? ''} ${item.categoryName}`.split(/[\s/·,]+/).filter(Boolean))).slice(0, 5);
  const realty = !!item.isRealty;
  const fee = realty ? '협의 (부동산은 노출료 · A-07)' : `${won(item.desiredFee)}${item.feeBearerLabel ? ` · ${item.feeBearerLabel}` : ''}`;
  const price = item.dealAmount != null ? manwon(item.dealAmount) : realty ? '금액 협의' : null;
  const trust = item.trust?.score ?? item.trustScore ?? null;
  const no = item.listingNo ? `L-${item.listingNo}` : item.id.slice(0, 8).toUpperCase();
  const msg = messages as Record<string, string>;
  /* v10.46 (docs/96) — 지도에 넘길 좌표(좌표가 없거나 아직 찾는 중이면 null → 지도 칸 없음) */
  const g = item.geo;
  const mapGeo: MapGeo | null = !g || g.lat == null || g.lng == null ? null
    : g.precision === 'REGION' ? { precision: 'REGION', lat: g.lat, lng: g.lng, radiusM: g.radiusM, label: g.label }
    : { precision: 'EXACT', lat: g.lat as number, lng: g.lng as number };

  return (
    <><div className="gw" data-gw={code}>
      <div className="gw-wrap" style={{ paddingTop: 16 }}>
        <BackBar href={`/${gwan}`} label={GWAN_NAME[code] ?? '목록'} wrap={false} />
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
              <div className="gw-dtprice">{price ?? <><small className="gw-prl">소개비</small> {manwon(item.desiredFee)}</>}</div>
              <div className="gw-dtsub">{item.summary ? <>{item.summary}<br /></> : null}{[reg, item.categoryName].filter(Boolean).join(' · ')}
                {!realty && price && item.desiredFee != null && <><br />소개비 {manwon(item.desiredFee)}{item.feeBearerLabel ? ` · ${item.feeBearerLabel}` : ''}</>}
                {!realty && !price && item.feeBearerLabel && <><br />소개비 {item.feeBearerLabel}</>}
                {realty && <><br />부동산 — 소개비가 아니라 노출료(A-07)</>}</div>
              <div className="gw-dtmeta">
                <span>👁 조회 {item.viewCount.toLocaleString('ko-KR')}</span>
                <span>♡ 관심 {item.likeCount.toLocaleString('ko-KR')}</span>
                {when && <span suppressHydrationWarning>🕐 {when}</span>}
                {reg && <span className="gw-dtloc">📍 {reg}</span>}
                {trust != null && <span className={`gw-dttr ${trustCls(Number(trust))}`} title="소개 신뢰도 — 인증 · 동의율 · 성사 기록 · 거래 후기로 산출(36.5 에서 시작). 대출 · 금융 신용평가가 아닙니다">🛡 신용 {Math.round(Number(trust))}점</span>}
                <span className="gw-dtno">매물번호 {no}</span>
              </div>
            </div>
          </div>

          <div className="gw-dtprof">
            <span className="gw-av gw-avx" aria-hidden="true">{[...o.companyName][0]}</span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="gw-nm">{o.companyName}{o.verified && <span className="gw-vbdg">사업자 인증</span>}</div>
              <div className="gw-mt2">{reg && <>활동지역 &nbsp; {reg} &nbsp;&nbsp; </>}가입일 &nbsp; {ym(o.joinedAt)}</div>
            </div>
            <GwProfileActions />
          </div>

          <div className="gw-sth">소개자 실적 <span title="서버가 성사 기록으로 집계한 값입니다">?</span></div>
          <div className="gw-stat">
            <div><div className="gw-k">총 소개</div><div className="gw-v">{o.totalDeals.toLocaleString('ko-KR')}건</div></div>
            <div><div className="gw-k">성사(계약)</div><div className="gw-v">{o.confirmedDeals.toLocaleString('ko-KR')}건</div></div>
            <div><div className="gw-k">성사율</div><div className="gw-v">{o.successRate != null ? `${o.successRate}%` : '—'}</div></div>
            {/* 누적수익은 등록자 본인이 마이 > 내 정보에서 공개를 켠 경우에만 서버가 값을 줍니다(그 밖은 「비공개」 — 시안 4칸) */}
            <div title="누적수익은 소개자가 「누적수익 공개」를 켠 경우에만 보입니다"><div className="gw-k">누적수익</div><div className="gw-v">{o.settledAmount != null ? won(o.settledAmount) : <span className="gw-ls">비공개</span>}</div></div>
          </div>

          <div className="gw-dsec">
            <h4>소개 상품 상세 설명</h4>
            {item.body ? <p className="gw-body">{item.body}</p> : <p>{GWAN_NAME[code]}에 등록된 <b>{item.title}</b> 건입니다. 분류 · 지역 · 소개비는 아래 표와 같습니다.</p>}
            <dl className="gw-spec">
              <dt>분류</dt><dd>{item.categoryName}</dd>
              <dt>지역</dt><dd>{reg || '협의'}</dd>
              <dt>금액</dt><dd>{item.dealAmount != null ? manwon(item.dealAmount) : '금액 협의'}</dd>
              <dt>소개비</dt><dd>{fee}</dd>
              <dt>등록</dt><dd suppressHydrationWarning>{when || '—'}</dd>
              <dt>상태</dt><dd>{item.statusLabel}</dd>
            </dl>
            {/* v10.46 (docs/96) — 좌표가 있고 지도 사용이 켜져 있을 때만 그립니다(아니면 아무것도 더하지 않음 — 지금 화면 그대로).
                남에게는 서버가 시 · 구 중심(REGION)만 줍니다 — 정확한 위치는 본인에게만 */}
            {mapGeo && (
              <KakaoMap geo={mapGeo}
                caption={mapGeo.precision === 'REGION' ? <>ⓘ {mapGeo.label} 둘레입니다 — 정확한 위치는 문의 뒤 당사자끼리 확인합니다.</>
                  : <>ⓘ 내 매물이라 정확한 위치가 보입니다 — 다른 회원에게는 시 · 구 둘레 원으로만 보입니다.</>} />
            )}
            <p style={{ marginTop: 11 }}>조건과 일정은 1:1 문의에서 등록자와 직접 맞추실 수 있습니다.</p>
          </div>

          <div style={{ marginTop: 18 }}>
            <GwQna listingId={item.id} canAsk={item.canInquire} notice={messages.QNA_MASKED} allHref={`/${gwan}/${id}/qna`} />
          </div>

          <div className="gw-dsec" style={{ marginTop: 20 }}>
            <div className="gw-dgrid">
              <div>
                <h4>소개자 후기 <span className="gw-rvc">{reviews.count}</span>{reviews.average != null && <span className="gw-rva">평균 {reviews.average}</span>}</h4>
                {reviews.items.length === 0 ? (
                  <p className="gw-rvempty">아직 후기가 없습니다. 성사가 확정된 거래의 당사자만 후기를 남길 수 있습니다.</p>
                ) : (
                  <div className="gw-revs">
                    {reviews.items.slice(0, 6).map((r) => (
                      <div key={r.id} className="gw-rv2">
                        <div className="gw-rvtop">
                          <span className="gw-av gw-avx gw-avs" aria-hidden="true">{[...r.authorName][0]}</span>
                          <div className="gw-rvid"><div className="gw-t2"><span className="gw-nm">{r.authorName}</span><span className="gw-dt3">{day(r.createdAt)}</span></div></div>
                        </div>
                        <div className="gw-stars" aria-label={`평점 ${r.rating}점`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                        {r.body && <div className="gw-tx">{r.body}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>소개 내용</h4>
                <dl className="gw-spec gw-ic" style={{ gridTemplateColumns: '78px 1fr' }}>
                  <dt><i>📁</i>분류</dt><dd>{item.categoryName}</dd>
                  <dt><i>📍</i>지역</dt><dd>{reg || '협의'}</dd>
                  <dt><i>💰</i>금액</dt><dd>{item.dealAmount != null ? manwon(item.dealAmount) : realty ? '금액 협의' : `소개비 ${won(item.desiredFee)}`}</dd>
                  <dt><i>🕑</i>등록</dt><dd suppressHydrationWarning>{when || '—'}</dd>
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
        {realty && <div className="gw-nt gw-warn" data-msg="RE_EXPOSURE_A07">{msg.RE_EXPOSURE_A07 ? <AttrNote text={msg.RE_EXPOSURE_A07} /> : <><b>부동산은 소개비가 아니라 노출료입니다 (A-07).</b> 금액 체계가 아직 정해지지 않아 이 관의 부동산 건은 정산이 생성되지 않습니다.</>}</div>}
        {code === 'MNY' && <div className="gw-nt gw-info" data-msg="FEE_A12_DETAIL">{msg.FEE_A12_DETAIL ? <AttrNote text={msg.FEE_A12_DETAIL} /> : <><b>소개비는 요율표로 산정하지 않습니다 (A-12).</b> 1:1 대화에서 당사자끼리 정합니다.</>}</div>}

        {/* SB-MAL-DTL-010 「소개코드 공유」 (D010) — 안심소개 매물만. 시안의 「이 매물 소개하기」 칸 */}
        {code === 'MAL' && (
          <div className="gw-panel gw-refp" style={{ marginTop: 14 }}>
            <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>이 매물 소개하기</b><span className="gw-ls">일반 회원도 소개코드로 소개합니다</span></div>
            <RefShare path={`/mall/${item.id}`} listingId={item.id} />
          </div>
        )}

        <div className="gw-nt gw-info" data-msg="CTA_ATTRIBUTION_NOTE">{msg.CTA_ATTRIBUTION_NOTE
          ? <AttrNote text={msg.CTA_ATTRIBUTION_NOTE} />
          : <><b>1:1 대화가 시작되는 순간 소개코드가 발급되고 귀속이 시작됩니다 (INV-2).</b> 전화나 외부 연락으로 진행하면 귀속되지 않습니다.</>} <Link href="/safety/guide">사기 예방 가이드 ›</Link></div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

/** 운영 문구의 첫 문장(마침표까지)을 굵게 — 시안 .nt 의 「<b>첫 문장</b> 나머지」 모양 */
function AttrNote({ text }: { text: string }) {
  const m = text.match(/^(.+?[.)。])\s+(.*)$/s);
  return m ? <><b>{m[1]}</b> {m[2]}</> : <b>{text}</b>;
}
