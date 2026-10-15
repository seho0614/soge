import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { GWAN_PATH, ymdKst } from '@/lib/format';
import type { ListingCardData, ListingListData } from '@/lib/types';
import { QuickFrame } from '@/components/gwan/GwQuick';
import { Pager } from '@/components/gwan/GwParts';
import { SortSelect } from '@/components/gwan/GwClient';
import { photoSrc, qhref, regionText } from '@/components/gwan/gw';
import { cardPrice } from '@/components/gwan/GwCard';

export const metadata: Metadata = { title: '급구 · 급매' };

type Props = { searchParams: Promise<{ t?: string; g?: string; sort?: string; p?: string; region?: string }> };

/** 시안 UTABS · UCATS · 정렬 칸 그대로 — 서버 값으로 잇습니다 */
const UTABS: [string, string, string][] = [['all', '전체', 'ANY'], ['buy', '급구', 'BUY'], ['sell', '급매', 'SELL']];
const UCATS: [string, string][] = [['', '전체 상품'], ['RE', '부동산'], ['CAR', '자동차'], ['BIZ', '창업/프랜차이즈'], ['MACHINE', '기계/설비'], ['LIFE', '생활/기타']];
const USORT: [string, string][] = [['RECENT', '최신순'], ['AMOUNT_ASC', '낮은 가격순'], ['AMOUNT_DESC', '높은 가격순'], ['POPULAR', '관심 많은순'], ['DEADLINE', '마감임박순']];
const ymd = (iso: string | null) => (iso ? ymdKst(iso).replace(/-/g, '.') : '—');
const href = (x: ListingCardData) => `/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`;

function UCard({ x }: { x: ListingCardData }) {
  const price = cardPrice(x);
  return (
    <Link className="gw-uc" href={href(x)} data-listing={x.id} data-urgent={x.urgent?.kind}>
      <div className="gw-uimg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
        <span className="gw-ubadge"><span className="gw-ug" title={x.urgent?.label}>급</span><span className="gw-uct">{x.categoryName}</span></span>
      </div>
      <div className="gw-ub">
        <div className="gw-ut">{x.title}</div>
        <div className="gw-ud">{x.urgent ? `${x.urgent.label} · ~${ymd(x.urgent.until)} · ` : ''}{x.summary ?? `${x.owner.companyName}${x.owner.verified ? ' · 사업자 인증' : ''}`}</div>
        <div className="gw-up">{price.label && <small className="gw-prl">{price.label}</small>} {price.value}</div>
        <div className="gw-ul">📍 {regionText(x.region) || '지역 미상'}</div>
        <div className="gw-um"><span>등록일 {ymd(x.publishedAt)}</span><span>♡ {x.likeCount}</span></div>
      </div>
    </Link>
  );
}

/**
 * SB-MNY-URG-010 퀵메뉴 ③ — 시안 「급구, 급매」(scUrg) 그대로.
 *
 * v10.31 (w2 · 10/10 「시안 기준」) — 서버에 「급매」(URGENT_SALE) 표시를 새로 두고 급구(URGENT)와 나눴습니다.
 *   · 탭 전체 · 급구 · 급매(?t=) → GET /listings?urgent=ANY|BUY|SELL · 분류 묶음 6(?g= → group=RE · CAR · BIZ · MACHINE · LIFE) ·
 *     정렬(최신순 · 낮은 가격순 · 높은 가격순 · 관심 많은순 + 마감임박순) · 지역 설정(?region=)
 *   · 소개장터 · 안심소개 · 소개창업 매물을 함께 봅니다(시안의 부동산 · 창업 묶음).
 *   · 카드 — 사진 · 「급」 · 분류 · 제목 · 한 줄(급구/급매 · 기한 · 한줄 소개) · 금액 · 📍 지역 · 등록일 · 관심.
 *   · 오른쪽 「급구/급매 추천 매물」 = 같은 조건의 관심 많은 순 5건 · 「급구, 급매 등록 안내」 → 매물 등록(등록 뒤 내 매물에서 급구 · 급매 신청).
 *   · 급구 · 급매 표시는 등록자가 신청하고(POST /listings/{id}/badges) 운영 심사 뒤에 붙으며, 기한이 지나면 자동으로 내려갑니다.
 */
export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const tab = UTABS.find(([k]) => k === q.t) ?? UTABS[0]!;
  const group = UCATS.some(([k]) => k === q.g) ? q.g : undefined;
  const sort = USORT.some(([k]) => k === q.sort) ? q.sort : undefined;
  const region = q.region && /^(\d{10}|ETC)$/.test(q.region) ? q.region : undefined;
  const page = Math.max(1, Number(q.p) || 1);
  const qs = (extra: string) => `/listings?urgent=${tab[2]}${group ? `&group=${group}` : ''}${region ? `&regionCode=${region}` : ''}${extra}`;
  const [data, rec] = await Promise.all([
    apiGet<ListingListData>(qs(`&limit=12&page=${page}&sort=${sort ?? 'DEADLINE'}`), 30).catch(() => null),
    apiGet<ListingListData>(qs('&limit=5&sort=POPULAR'), 30).catch(() => null),
  ]);
  const keep = { t: tab[0] === 'all' ? undefined : tab[0], g: group, sort, region };
  const base = '/money/urgent';
  const gHrefs = Object.fromEntries(UCATS.map(([k]) => [k, qhref(base, { ...keep, g: k || undefined, p: undefined })]));
  const sHrefs = Object.fromEntries(USORT.map(([k]) => [k, qhref(base, { ...keep, sort: k, p: undefined })]));
  const rows = data ? [...data.promoted, ...data.organic] : [];

  return (
    <><QuickFrame active="urgent" title="급구, 급매" sub="급하게 구하거나 빠르게 판매해야 하는 매물/상품을 한눈에 확인하세요!" region={region}>
      <div className="gw-ufilt">
        {UTABS.map(([k, t]) => (
          <Link key={k} className={`gw-uf${tab[0] === k ? ' gw-on' : ''}`} href={qhref(base, { ...keep, t: k === 'all' ? undefined : k, p: undefined })} data-utab={k}>{t}</Link>
        ))}
        <SortSelect className="gw-usel" value={group ?? ''} options={UCATS} hrefs={gHrefs} />
        <SortSelect className="gw-usel gw-usort" value={sort ?? 'DEADLINE'} options={USORT} hrefs={sHrefs} />
      </div>
      <div className="gw-ulay">
        <div>
          {!data ? <p className="gw-empty gw-panel">목록을 불러오지 못했습니다.</p>
            : rows.length === 0 ? (
              <div className="gw-panel gw-empty" data-urgent-empty="">
                지금 {tab[0] === 'all' ? '급구 · 급매' : tab[1]} 표시가 붙은 {group ? `「${UCATS.find(([k]) => k === group)?.[1]}」 ` : ''}건이 없습니다.
                급하게 구하시거나 파시려면 매물을 올린 뒤 내 매물에서 「급구 · 급매」를 신청하십시오(운영 심사 · 기한이 지나면 자동 해제).
              </div>
            ) : (
              <div className="gw-ugrid">{rows.map((x) => <UCard key={x.id} x={x} />)}</div>
            )}
          {data && <Pager base={base} keep={keep} page={page} next={null} pageCount={data.pageCount}
                          left={<span className="gw-tot">총 <b>{(data.total ?? rows.length).toLocaleString('ko-KR')}</b>건 · 급하게 찾는 건은 <b>먼저 노출</b>됩니다(마감이 가까운 순).</span>} />}
        </div>
        <aside>
          <div className="gw-urec">
            <b>급구/급매 추천 매물</b>
            {(rec?.organic ?? []).length === 0 ? <p className="gw-urnone">추천할 급구 · 급매 매물이 아직 없습니다.</p>
              : rec!.organic.map((x) => (
                <Link key={x.id} className="gw-ur" href={href(x)}>
                  <span className="gw-uri">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                    <span className="gw-urg">급</span>
                  </span>
                  <span className="gw-urb"><span className="gw-urc">{x.categoryName}</span><span className="gw-urt">{x.title}</span><span className="gw-urp">{cardPrice(x).value}</span></span>
                </Link>
              ))}
          </div>
          <div className="gw-uadd">
            <div className="gw-uah"><span>급구, 급매 등록 안내</span><span>›</span></div>
            <p>급하게 구인/판매를 원하신다면 빠르고 간편하게 등록하세요.</p>
            <Link className="gw-uab" href="/register">매물 등록하기</Link>
            <Link className="gw-uab2" href="/my/listings">내 매물에서 급구 · 급매 신청 ›</Link>
          </div>
        </aside>
      </div>
    </QuickFrame><i hidden data-root-end="" /></>
  );
}
