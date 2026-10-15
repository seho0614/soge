/**
 * v10.29 — SB-MNY-LST-010 · SB-MAL-LST-010 · SB-BIZ-LST-010 관 전체 목록 — 시안 gwanList 배치 그대로.
 *   돌아가기 줄 → 제목 · 설명 · 건수 → 큰 갈래 3칸(소개하기 · 소개받고 싶어요 · 소개받기) → 정렬 탭 → 사진 카드 6열 → 안내
 *
 * ── 관 메인과 무엇이 다른가 ──────────────────────────────────────────
 * 관 메인은 **골라서** 보여 주고(분류 · 찾기), 이 화면은 **전부** 보여 줍니다. 정렬로 직접 찾는 사람용입니다.
 *
 * v10.31 (w2 · 10/10 「시안 기준」)
 *   정렬 — 시안 「소개비순 · 마감임박 · 소개비율 · 최신」 그대로(서버 정렬 DEADLINE · FEE_RATIO 신설) + 개발에 있던 베스트(POPULAR) ·
 *     급한 건(급구 · 급매) · 인증된 곳(VERIFIED_DOC)은 같은 탭 줄 뒤에 남김(주소 ?sort= 그대로).
 *   카드 — 시안의 「급구」 표 · 「소개 신뢰도」 점수 띠(서버 v_account_trust · 36.5 에서 시작) · 지역 · 거래 금액 · 사진.
 *   제목 아래 설명 — 시안 문구(A-12 · 운영 문구 FEE_A12_LIST). 쪽 번호 — 서버 건수로 전체.
 *   오른쪽 아래 떠 있는 광고(칸 FLOAT) — 시안 AD_FLOAT(전체 목록 포함).
 */
import Link from 'next/link';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { uiMessages } from '@/lib/content';
import { ago, GWAN_PATH } from '@/lib/format';
import type { Gwan, ListingCardData, ListingListData } from '@/lib/types';
import type { AdServe } from '@/components/home/types';
import { BackBar } from '@/components/common/BackBar';
import { GW, photoSrc, qhref, regionText, trustCls, type GwanCode } from './gw';
import { Pager } from './GwParts';
import { cardPrice } from './GwCard';
import { GwFloatAd } from './GwAds';

const SORTS = [
  ['fee', '소개비순'],
  ['deadline', '마감임박'],
  ['ratio', '소개비율'],
  ['new', '최신'],
  ['best', '베스트'],
  ['urgent', '급한 건'],
  ['verified', '인증된 곳'],
] as const;
const API_SORT: Record<string, string> = { fee: 'FEE_DESC', deadline: 'DEADLINE', ratio: 'FEE_RATIO', new: 'RECENT', best: 'POPULAR' };

/** 시안 trustBadge — 70 이상 hi · 50 이상 mid · 그 밖 low */
export function TrustBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const v = Number(score);
  return (
    <div className={`gw-trb ${trustCls(v)}`} title="소개 신뢰도 — 인증 · 동의율 · 성사 기록으로 산출(36.5 에서 시작)">
      <span className="gw-tv">{v.toFixed(1)}</span><span className="gw-tl">소개 신뢰도</span>
    </div>
  );
}

function ListCard({ item }: { item: ListingCardData }) {
  const price = cardPrice(item);
  return (
    <Link className="gw-pc" href={`/${GWAN_PATH[item.gwanCode] ?? 'money'}/${item.id}`} data-listing={item.id} data-urgent={item.urgent?.kind}>
      <div className="gw-pcimg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gw-thp" src={photoSrc(item.categoryName, item.thumbUrl ? [item.thumbUrl] : null)} alt="" loading="lazy" />
      </div>
      <div className="gw-pt">
        {item.urgent && <span className="gw-bg gw-no">{item.urgent.label}</span>}
        {item.isAd && item.adLabel && <span className="gw-bg gw-ad">{item.adLabel}</span>}
        {item.badges.filter((b) => b.type === 'VERIFIED_DOC').map((b) => <span key={b.type} className="gw-bg gw-ok">{b.label}</span>)}
        <span className="gw-ck">{item.categoryName}</span>
      </div>
      <TrustBadge score={item.trustScore} />
      <b>{item.title}</b>
      <span className="gw-ls" suppressHydrationWarning>{regionText(item.region) || '지역 미상'}{item.publishedAt ? ` · ${ago(item.publishedAt)}` : ''}</span>
      <div className="gw-pf2"><span>{price.label ? `${price.label} ` : ''}{price.value}</span><span className="gw-ls">관심 {item.likeCount}</span></div>
    </Link>
  );
}

export async function GwList({ code, q }: { code: GwanCode; q: { sort?: string; cursor?: string; badge?: string; p?: string } }) {
  const g = GW[code];
  const base = `/${g.path}/list`;
  const sort = SORTS.some((s) => s[0] === q.sort) ? q.sort! : 'fee';   // 시안 기본 「소개비순」
  const page = Math.max(1, Number(q.p) || 1);
  const badge = q.badge === 'URGENT' || q.badge === 'VERIFIED_DOC' ? q.badge : undefined;

  const [data, gwans, messages, float] = await Promise.all([
    /* 20260930 — 인증된 곳은 정렬이 아니라 배지 필터입니다(서버 계약). v10.31 — 급한 건 = 급구 · 급매 표시가 있는 것(urgent=ANY) · 마감임박 순 */
    apiGet<ListingListData>(
      `/listings?gwanCode=${code}&limit=12&page=${page}` +
      (sort === 'urgent' ? '&urgent=ANY&sort=DEADLINE' : sort === 'verified' ? '&badge=VERIFIED_DOC'
        : `&sort=${API_SORT[sort] ?? 'FEE_DESC'}`) +
      (badge && sort !== 'verified' ? `&badge=${badge}` : ''), 60).catch(() => null),
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    uiMessages().catch(() => ({} as Record<string, string>)),
    apiGetPersonal<AdServe>('/ads/serve?slot=FLOAT').catch(() => null),
  ]);
  const gw = gwans.find((x) => x.code === code);
  const give = code === 'MAL' ? '/mall/give' : code === 'BIZ' ? '/biz/register' : '/register';
  const a12 = (messages as Record<string, string>).FEE_A12_LIST ?? '소개비는 요율표가 아니라 당사자 협의로 정합니다 (A-12)';

  return (
    <div className="gw" data-gw={code}>
      <div className="gw-wrap gw-gwl">{/* 시안도 전체 목록은 관 색 없이(.wrap.gwl) 그립니다 */}
        <BackBar href={`/${g.path}`} label={g.name} wrap={false} />
        <div className="gw-pgh">
          <div>
            <h1>{g.name} 전체 목록</h1>
            {/* 시안 문구 — 정책문구차이 10/10 시안 기준(A-12) */}
            <p data-msg="FEE_A12_LIST">이 관에 등록된 {g.sect} 전체입니다. {a12}{/[.)]$/.test(a12) ? '' : '.'} <span className="gw-ls">묶어서 보시려면 <Link href={`/${g.path}`}>관 메인</Link>을 이용하십시오.</span></p>
          </div>
          {data?.total != null ? <span className="gw-did">{data.total.toLocaleString('ko-KR')}건</span>
            : gw && <span className="gw-did">{gw.listingCount.toLocaleString('ko-KR')}건</span>}
        </div>

        <div className="gw-cta3">
          <Link className="gw-c3 gw-c3a" href={give}><b>소개하기</b><span>내가 아는 곳을 올립니다</span></Link>
          <Link className="gw-c3 gw-c3b" href="/request/new"><b>소개받고 싶어요</b><span>찾는 것을 올립니다</span></Link>
          <Link className="gw-c3 gw-c3c" href={base}><b>소개받기</b><span>올라온 것 중에서 고릅니다</span></Link>
        </div>

        {code === 'MAL' && (
          /* 20261002 — 상담 축 통합(D005): 이 목록은 매물 축만 보여 줍니다. 상담은 매물이 아니라 신청입니다. */
          <div className="gw-nt gw-info">이사 · 렌탈 · 중고차 · 보험 같은 생활 · 금융 상담은 매물이 아니라 신청으로 받습니다 —{' '}
            <Link href="/mall?axis=consult">생활 · 금융 상담</Link></div>
        )}

        {/* 정렬은 주소에 남깁니다 — 찾은 목록을 그대로 공유할 수 있어야 합니다. */}
        <div className="gw-tabs2" role="tablist" aria-label="정렬">
          {SORTS.map(([k, label]) => (
            <Link key={k} role="tab" aria-selected={k === sort} className={`gw-tb${k === sort ? ' gw-on' : ''}`} href={qhref(base, { sort: k })}>{label}</Link>
          ))}
        </div>

        {!data ? (
          <p className="gw-empty">목록을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
        ) : data.organic.length === 0 && data.promoted.length === 0 ? (
          <p className="gw-empty gw-panel">아직 등록된 건이 없습니다.</p>
        ) : (
          <>
            {data.promoted.length > 0 && (
              <section aria-label="광고" className="gw-adz">
                <p className="gw-adn">{data.adNotice}</p>
                <div className="gw-pgrid">{data.promoted.map((x) => <ListCard key={x.id} item={x} />)}</div>
              </section>
            )}
            <div className="gw-pgrid">{data.organic.map((x) => <ListCard key={x.id} item={x} />)}</div>
          </>
        )}
        {data && (data.pageCount ?? 1) > 1 && (
          <Pager base={base} keep={{ sort }} page={page} next={null} pageCount={data.pageCount} />
        )}

        <div className="gw-nt gw-info"><b>목록은 관 랜딩과 다릅니다.</b> 랜딩은 이 관의 메인이고, 여기는 이 관에 등록된 것 전부입니다.</div>
      </div>
      <GwFloatAd ad={float && !float.empty && float.id ? float : null} />
    </div>
  );
}
