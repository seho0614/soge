import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, apiGetPersonal } from '@/lib/api';
import type { Recommended, Supplier } from '@/components/market/types';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame } from '@/components/gwan/GwParts';
import { photoSrc } from '@/components/gwan/gw';

export const metadata: Metadata = { title: '서비스 업체' };

type Props = { searchParams: Promise<{ gwan?: string; ai?: string; region?: string }> };
const GWAN: Record<string, [string, string]> = { MNY: ['소개장터', '/money'], MAL: ['안심소개', '/mall'], BIZ: ['소개창업', '/biz'] };

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
  const [nm, base] = GWAN[code]!;
  return (
    <><GwFrame code={code as 'MNY'}>
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href={base} label={nm} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-pgh"><div><h1>{ai ? 'AI 추천 맞춤 공급자' : '서비스 업체'}</h1>
          <p>{ai ? '지역 · 관심 분류 · 성사 이력 · 응답 속도 · 신뢰도를 서버가 가중 합산했습니다(협업 필터링이 아닙니다). 광고는 순위에 들어가지 않습니다.'
            : `${nm}에 게시 중인 매물이 있는 인증 사업자입니다. 소개 신뢰도 · 평점 · 성사 순이며 광고가 아닙니다.`}</p></div>
          <span className="gw-did">{rows.length}곳</span></div>
        <div className="gw-tabs2" role="tablist" aria-label="보기">
          <Link role="tab" aria-selected={!ai} className={`gw-tb${!ai ? ' gw-on' : ''}`} href={`/supplier?gwan=${code}`}>업체 추천</Link>
          <Link role="tab" aria-selected={ai} className={`gw-tb${ai ? ' gw-on' : ''}`} href={`/supplier?gwan=${code}&ai=1`}>AI 추천</Link>
        </div>
        {rows.length === 0 ? <p className="gw-empty gw-panel">아직 업체가 없습니다.</p> : (
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
                  <div className="gw-mt2"><span>{s.sido ? `${s.sido}${s.sigungu ? ` ${s.sigungu}` : ''}` : '지역 미상'} · 매물 {s.listingCount}</span>
                    <span>{ai && s.score != null ? `점수 ${s.score}` : s.trustScore != null ? `신뢰 ${Number(s.trustScore).toFixed(1)}` : ''}</span></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}
