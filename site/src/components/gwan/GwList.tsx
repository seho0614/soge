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
import { getLocale, getTranslations } from 'next-intl/server';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { uiMessages } from '@/lib/content';
import { ago, GWAN_PATH } from '@/lib/format';
import { useFmt } from '@/lib/useFmt';
import type { Gwan, ListingCardData, ListingListData } from '@/lib/types';
import type { AdServe } from '@/components/home/types';
import { BackBar } from '@/components/common/BackBar';
import { GW, photoSrc, qhref, regionText, trustCls, type GwanCode } from './gw';
import { Pager } from './GwParts';
import { cardPrice } from './GwCard';
import { GwFloatAd } from './GwAds';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

/* v10.97 — 이름은 사전 gwan.list.sort.{키} */
const SORTS = ['fee', 'deadline', 'ratio', 'new', 'best', 'urgent', 'verified'] as const;
const API_SORT: Record<string, string> = { fee: 'FEE_DESC', deadline: 'DEADLINE', ratio: 'FEE_RATIO', new: 'RECENT', best: 'POPULAR' };

/** 시안 trustBadge — 70 이상 hi · 50 이상 mid · 그 밖 low */
export function TrustBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  return <TrustBadgeIn v={Number(score)} />;
}
function TrustBadgeIn({ v }: { v: number }) {
  const t = useTranslations('gwan.list');
  return (
    <div className={`gw-trb ${trustCls(v)}`} title={t('trustTitle')}>
      <span className="gw-tv">{v.toFixed(1)}</span><span className="gw-tl">{t('trustLabel')}</span>
    </div>
  );
}

function ListCard({ item }: { item: ListingCardData }) {
  const t = useTranslations('gwan');
  const locale = useLocale();
  const f = useFmt();
  const price = cardPrice(item, (k) => t(k), locale);
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
      <span className="gw-ls" suppressHydrationWarning>{regionText(item.region) || t('list.noRegion')}{item.publishedAt ? ` · ${f.ago(item.publishedAt, ago(item.publishedAt))}` : ''}</span>
      <div className="gw-pf2"><span>{price.label ? `${price.label} ` : ''}{price.value}</span><span className="gw-ls">{t('list.likes', { n: String(item.likeCount) })}</span></div>
    </Link>
  );
}

export async function GwList({ code, q }: { code: GwanCode; q: { sort?: string; cursor?: string; badge?: string; p?: string } }) {
  const g = GW[code];
  const t = await getTranslations('gwan');
  const locale = await getLocale();
  const gname = t(`meta.${code}.name`);
  const base = `/${g.path}/list`;
  const sort = SORTS.find((s) => s === q.sort) ?? 'fee';   // 시안 기본 「소개비순」
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
  const a12 = (messages as Record<string, string>).FEE_A12_LIST ?? t('list.a12Fallback');

  return (
    <div className="gw" data-gw={code}>
      <div className="gw-wrap gw-gwl">{/* 시안도 전체 목록은 관 색 없이(.wrap.gwl) 그립니다 */}
        <BackBar href={`/${g.path}`} label={gname} wrap={false} />
        <div className="gw-pgh">
          <div>
            <h1>{t('list.title', { name: gname })}</h1>
            {/* 시안 문구 — 정책문구차이 10/10 시안 기준(A-12) */}
            <p data-msg="FEE_A12_LIST">{t('list.lead', { sect: t(`meta.${code}.sect`) })} {withCodes(a12)}{/[.)]$/.test(a12) ? '' : '.'} <span className="gw-ls">{t.rich('list.leadMain', { home: (c) => <Link href={`/${g.path}`}>{c}</Link> })}</span></p>
          </div>
          {data?.total != null ? <span className="gw-did">{t('list.count', { n: data.total.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US') })}</span>
            : gw && <span className="gw-did">{t('list.count', { n: gw.listingCount.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US') })}</span>}
        </div>

        <div className="gw-cta3">
          <Link className="gw-c3 gw-c3a" href={give}><b>{t('list.giveT')}</b><span>{t('list.giveS')}</span></Link>
          <Link className="gw-c3 gw-c3b" href="/request/new"><b>{t('list.wantT')}</b><span>{t('list.wantS')}</span></Link>
          <Link className="gw-c3 gw-c3c" href={base}><b>{t('list.getT')}</b><span>{t('list.getS')}</span></Link>
        </div>

        {code === 'MAL' && (
          /* 20261002 — 상담 축 통합(D005): 이 목록은 매물 축만 보여 줍니다. 상담은 매물이 아니라 신청입니다. */
          <div className="gw-nt gw-info">{t.rich('list.consultNote', { consult: (c) => <Link href="/mall?axis=consult">{c}</Link> })}</div>
        )}

        {/* 정렬은 주소에 남깁니다 — 찾은 목록을 그대로 공유할 수 있어야 합니다. */}
        <div className="gw-tabs2" role="tablist" aria-label={t('list.sortAria')}>
          {SORTS.map((k) => (
            <Link key={k} role="tab" aria-selected={k === sort} className={`gw-tb${k === sort ? ' gw-on' : ''}`} href={qhref(base, { sort: k })}>{t(`list.sort.${k}`)}</Link>
          ))}
        </div>

        {!data ? (
          <p className="gw-empty">{t('list.loadFail')}</p>
        ) : data.organic.length === 0 && data.promoted.length === 0 ? (
          <p className="gw-empty gw-panel">{t('list.empty')}</p>
        ) : (
          <>
            {data.promoted.length > 0 && (
              <section aria-label={t('list.adsAria')} className="gw-adz">
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

        <div className="gw-nt gw-info">{t.rich('list.foot', { b: (c) => <b>{c}</b> })}</div>
      </div>
      <GwFloatAd ad={float && !float.empty && float.id ? float : null} />
    </div>
  );
}
