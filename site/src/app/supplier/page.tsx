import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, apiGetPersonal } from '@/lib/api';
import type { Recommended, Supplier } from '@/components/market/types';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame } from '@/components/gwan/GwParts';
import { photoSrc } from '@/components/gwan/gw';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('billing.supplier'))('title') };
}

type Props = { searchParams: Promise<{ gwan?: string; ai?: string; region?: string }> };
/* v10.100 — 관 이름은 사전(header.gwan.*) */
const GWAN: Record<string, ['MNY' | 'MAL' | 'BIZ', string]> = { MNY: ['MNY', '/money'], MAL: ['MAL', '/mall'], BIZ: ['BIZ', '/biz'] };

/**
 * v10.31 (w2) — 소개장터 메인 「서비스 업체 추천」 · 「AI 추천 맞춤 공급자」의 「전체보기」(시안에는 견본 안내만 있던 단추).
 *   업체 = 그 관에 게시 매물이 있는 인증 사업자(GET /market/suppliers · 신뢰도 · 평점 · 성사 순 — 광고 아님).
 *   ai=1 이면 AI 추천(GET /market/suppliers/recommended — 서버 가중 합산 · 광고는 순위에 넣지 않음).
 */
export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const code = q.gwan && GWAN[q.gwan] ? q.gwan : 'MNY';
  const ai = q.ai === '1';
  const region = q.region && /^\d{10}$/.test(q.region) ? q.region : undefined;
  const rq = region ? `&regionCode=${region}` : '';
  const rows: Supplier[] = ai
    ? (await apiGetPersonal<Recommended>(`/market/suppliers/recommended?gwanCode=${code}&limit=20${rq}`).catch(() => null))?.items ?? []
    : await apiGet<Supplier[]>(`/market/suppliers?gwanCode=${code}&limit=40${rq}`, 30).catch(() => [] as Supplier[]);
  const t = await getTranslations('billing.supplier');
  const tg = await getTranslations('header.gwan');
  const [gk, base] = GWAN[code]!;
  const nm = tg(gk);
  return (
    <><GwFrame code={code as 'MNY'}>
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href={base} label={nm} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-pgh"><div><h1>{ai ? t('aiTitle') : t('title')}</h1>
          <p>{ai ? t('aiDesc')
            : t('desc', { gwan: nm })}</p></div>
          <span className="gw-did">{t('count', { n: String(rows.length) })}</span></div>
        <div className="gw-tabs2" role="tablist" aria-label={t('tabsAria')}>
          <Link role="tab" aria-selected={!ai} className={`gw-tb${!ai ? ' gw-on' : ''}`} href={`/supplier?gwan=${code}`}>{t('tabRec')}</Link>
          <Link role="tab" aria-selected={ai} className={`gw-tb${ai ? ' gw-on' : ''}`} href={`/supplier?gwan=${code}&ai=1`}>{t('tabAi')}</Link>
        </div>
        {rows.length === 0 ? <p className="gw-empty gw-panel">{t('empty')}</p> : (
          <div className="gw-pgrid">
            {rows.map((s) => (
              <Link key={s.id} className="gw-pgc" href={`/supplier/${s.id}?gwan=${code}`} data-supplier={s.id}>
                <div className="gw-pgt">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gw-thp" src={photoSrc(s.mainCategory, s.thumbUrl ? [s.thumbUrl] : null)} alt="" loading="lazy" />
                  {s.mainCategory && <span className="gw-cc">{s.mainCategory}</span>}
                </div>
                <div className="gw-pgb">
                  <div className="gw-tt">{s.companyName}</div>
                  <div className="gw-pr"><small className="gw-prl">★</small> {s.rating != null ? Number(s.rating).toFixed(1) : '—'} <small className="gw-prl">({s.reviewCount})</small></div>
                  <div className="gw-mt2"><span>{s.sido ? `${s.sido}${s.sigungu ? ` ${s.sigungu}` : ''}` : t('noRegion')} · {t('listings', { n: String(s.listingCount) })}</span>
                    <span>{ai && s.score != null ? t('score', { n: String(s.score) }) : s.trustScore != null ? t('trust', { n: Number(s.trustScore).toFixed(1) }) : ''}</span></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}
