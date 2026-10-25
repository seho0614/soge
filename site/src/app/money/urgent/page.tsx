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
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';
import { useFmt } from '@/lib/useFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('gwan'))('qm.urgent') };
}

type Props = { searchParams: Promise<{ t?: string; g?: string; sort?: string; p?: string; region?: string }> };

/** 시안 UTABS · UCATS · 정렬 칸 그대로 — 서버 값으로 잇습니다 */
/* v10.101 2-5b — 글자는 사전 키(plaza.urgent.*) */
const UTABS = [['all', 'urgent.tab.all', 'ANY'], ['buy', 'urgent.tab.buy', 'BUY'], ['sell', 'urgent.tab.sell', 'SELL']] as const;
const UCATS = [['', 'urgent.cat.all'], ['RE', 'urgent.cat.RE'], ['CAR', 'urgent.cat.CAR'], ['BIZ', 'urgent.cat.BIZ'], ['MACHINE', 'urgent.cat.MACHINE'], ['LIFE', 'urgent.cat.LIFE']] as const;
const USORT = [['RECENT', 'urgent.sort.RECENT'], ['AMOUNT_ASC', 'urgent.sort.AMOUNT_ASC'], ['AMOUNT_DESC', 'urgent.sort.AMOUNT_DESC'], ['POPULAR', 'urgent.sort.POPULAR'], ['DEADLINE', 'urgent.sort.DEADLINE']] as const;
const ymd = (iso: string | null) => (iso ? ymdKst(iso).replace(/-/g, '.') : '—');
const href = (x: ListingCardData) => `/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`;

function UCard({ x }: { x: ListingCardData }) {
  const t = useTranslations('plaza.urgent');
  const m = useTranslations('money');
  const g = useTranslations('gwan');
  const f = useFmt();
  /* 금액 — 한국어는 억 · 만 줄임 그대로, 다른 언어는 전체 숫자 ₩ (v10.102 · 2-5c) */
  const price = cardPrice(x, (k) => g(k), f.loc);
  return (
    <Link className="gw-uc" href={href(x)} data-listing={x.id} data-urgent={x.urgent?.kind}>
      <div className="gw-uimg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
        <span className="gw-ubadge"><span className="gw-ug" title={x.urgent?.label}>{t('mark')}</span><span className="gw-uct">{x.categoryName}</span></span>
      </div>
      <div className="gw-ub">
        <div className="gw-ut">{x.title}</div>
        <div className="gw-ud">{x.urgent ? `${x.urgent.label} · ~${ymd(x.urgent.until)} · ` : ''}{x.summary ?? `${x.owner.companyName}${x.owner.verified ? ` · ${t('bizVerified')}` : ''}`}</div>
        <div className="gw-up">{price.label && <small className="gw-prl">{price.label}</small>} {price.value}</div>
        <div className="gw-ul">📍 {regionText(x.region) || m('unknownRegion')}</div>
        <div className="gw-um"><span>{t('postedAt', { date: ymd(x.publishedAt) })}</span><span>♡ {x.likeCount}</span></div>
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
  const t = await getTranslations('plaza');
  const g = await getTranslations('gwan');
  const f = await getFmt();
  const tab = UTABS.find(([k]) => k === q.t) ?? UTABS[0];
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
  const catOpts: [string, string][] = UCATS.map(([k, l]) => [k, t(l)]);
  const sortOpts: [string, string][] = USORT.map(([k, l]) => [k, t(l)]);
  const groupKey = UCATS.find(([k]) => k === group)?.[1];

  return (
    <><QuickFrame active="urgent" title={t('urgent.title')} sub={t('urgent.sub')} region={region}>
      <div className="gw-ufilt">
        {UTABS.map(([k, l]) => (
          <Link key={k} className={`gw-uf${tab[0] === k ? ' gw-on' : ''}`} href={qhref(base, { ...keep, t: k === 'all' ? undefined : k, p: undefined })} data-utab={k}>{t(l)}</Link>
        ))}
        <SortSelect className="gw-usel" value={group ?? ''} options={catOpts} hrefs={gHrefs} />
        <SortSelect className="gw-usel gw-usort" value={sort ?? 'DEADLINE'} options={sortOpts} hrefs={sHrefs} />
      </div>
      <div className="gw-ulay">
        <div>
          {!data ? <p className="gw-empty gw-panel">{t('urgent.loadFail')}</p>
            : rows.length === 0 ? (
              <div className="gw-panel gw-empty" data-urgent-empty="">
                {t('urgent.empty', { kind: tab[0] === 'all' ? t('urgent.both') : t(tab[1]), group: group && groupKey ? t('urgent.emptyGroup', { g: t(groupKey) }) : '' })}
              </div>
            ) : (
              <div className="gw-ugrid">{rows.map((x) => <UCard key={x.id} x={x} />)}</div>
            )}
          {data && <Pager base={base} keep={keep} page={page} next={null} pageCount={data.pageCount}
                          left={<span className="gw-tot">{t.rich('urgent.total', { b: (c) => <b>{c}</b>, n: (data.total ?? rows.length).toLocaleString('ko-KR') })}</span>} />}
        </div>
        <aside>
          <div className="gw-urec">
            <b>{t('urgent.recH')}</b>
            {(rec?.organic ?? []).length === 0 ? <p className="gw-urnone">{t('urgent.recNone')}</p>
              : rec!.organic.map((x) => (
                <Link key={x.id} className="gw-ur" href={href(x)}>
                  <span className="gw-uri">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                    <span className="gw-urg">{t('urgent.mark')}</span>
                  </span>
                  <span className="gw-urb"><span className="gw-urc">{x.categoryName}</span><span className="gw-urt">{x.title}</span><span className="gw-urp">{cardPrice(x, (k) => g(k), f.loc).value}</span></span>
                </Link>
              ))}
          </div>
          <div className="gw-uadd">
            <div className="gw-uah"><span>{t('urgent.addH')}</span><span>›</span></div>
            <p>{t('urgent.addP')}</p>
            <Link className="gw-uab" href="/register">{t('urgent.register')}</Link>
            <Link className="gw-uab2" href="/my/listings">{t('urgent.apply')}</Link>
          </div>
        </aside>
      </div>
    </QuickFrame><i hidden data-root-end="" /></>
  );
}
