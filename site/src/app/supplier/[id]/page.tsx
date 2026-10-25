import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, ApiFailure } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame } from '@/components/gwan/GwParts';
import { manwon, photoSrc, trustCls } from '@/components/gwan/gw';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('billing.profile'))('title') };
}

interface Profile {
  id: string; companyName: string; sido: string | null; sigungu: string | null; verifiedSince: string | null; broker: boolean;
  rating: number | null; reviewCount: number; confirmedDeals: number; totalDeals: number; successRate: number | null; joinedAt: string | null;
  trust: { score: number; business: boolean; identity: boolean; deals: number; successRate: number | null; rating: number | null; reviewCount: number; disputes: number; consentRate: number | null };
  listings: { id: string; gwanCode: string; title: string; summary: string | null; categoryName: string; desiredFee: number | null; dealAmount: number | null; listingNo: number; isRealty: boolean; thumbUrl: string | null; likeCount: number }[];
  reviews: { rating: number; body: string | null; date: string; author: string }[];
}

/**
 * v10.31 (w2) — 업체 프로필(시안 업체 카드 「프로필 보기」 — 시안에는 「업체 프로필 화면은 아직 없습니다」 안내만 있던 자리).
 *   GET /market/suppliers/{id}: 공개 정보(업체명 · 지역 · 인증 시점) · 소개 신뢰도와 항목 · 성사 · 게시 매물 · 후기(이름 첫 글자).
 *   대표자 · 연락처 · 사업자번호는 내보내지 않습니다. 「제안 하기」 = 그 업체의 매물에서 1:1 문의(귀속 · INV-2).
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gwan?: string }> }) {
  const { id } = await params;
  const g = (await searchParams).gwan;
  const code = g === 'MAL' || g === 'BIZ' ? g : 'MNY';
  const p = await apiGet<Profile>(`/market/suppliers/${encodeURIComponent(id)}`, 30).catch((e) => {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) return null;
    throw e;
  });
  if (!p) notFound();
  const t = p.trust;
  const m = await getTranslations('billing.profile');
  const ts = await getTranslations('billing.supplier');
  return (
    <><GwFrame code={code}>
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href={`/supplier?gwan=${code}`} label={ts('title')} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel" style={{ overflow: 'hidden' }} data-supplier={p.id}>
          <div className="gw-dtprof">
            <span className="gw-av gw-avx" aria-hidden="true">{[...p.companyName][0]}</span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <h1 className="gw-nm" style={{ fontSize: 20, margin: 0 }}>{p.companyName}<span className="gw-vbdg">{m('bizVerified')}</span>{p.broker && <span className="gw-vbdg">{m('brokerVerified')}</span>}</h1>
              <div className="gw-mt2">{m('region')} &nbsp; {p.sido ? `${p.sido}${p.sigungu ? ` ${p.sigungu}` : ''}` : '—'} &nbsp;&nbsp; {m('verified')} &nbsp; {p.verifiedSince ?? '—'} &nbsp;&nbsp; {m('joined')} &nbsp; {p.joinedAt ?? '—'}</div>
            </div>
            {p.listings[0] && <Link className="gw-go" href={`/${GWAN_PATH[p.listings[0].gwanCode] ?? 'money'}/${p.listings[0].id}#ask`}><span>{m('propose')}</span><small>{m('proposeSub')}</small></Link>}
          </div>
          <div className="gw-sth">{m('hTrust')}</div>
          <div className="gw-stat">
            <div><div className="gw-k">{m('trust')}</div><div className={`gw-v gw-trv ${trustCls(Number(t.score))}`}>{Number(t.score).toFixed(1)}</div></div>
            <div><div className="gw-k">{m('deals')}</div><div className="gw-v">{m('countN', { n: String(p.confirmedDeals) })}</div></div>
            <div><div className="gw-k">{m('rating')}</div><div className="gw-v">{p.rating != null ? `★ ${Number(p.rating).toFixed(1)}` : '—'} <small>({p.reviewCount})</small></div></div>
            <div><div className="gw-k">{m('successRate')}</div><div className="gw-v">{p.successRate != null ? `${p.successRate}%` : '—'}</div></div>
          </div>
          <div className="gw-dsec"><h4>{m('hCalc')}</h4>
            <dl className="gw-spec">
              <dt>{m('start')}</dt><dd>36.5</dd>
              <dt>{m('bizVerified')}</dt><dd>{t.business ? '+10' : m('none')}</dd>
              <dt>{m('identity')}</dt><dd>{t.identity ? '+5' : m('none')}</dd>
              <dt>{m('dealsConfirmed')}</dt><dd>{m('dealsFormula', { n: String(t.deals) })}</dd>
              <dt>{m('consent')}</dt><dd>{t.consentRate != null ? `${t.consentRate}%` : m('noData')}</dd>
              <dt>{m('disputes')}</dt><dd>{m('countN', { n: String(t.disputes) })}</dd>
            </dl>
          </div>
          <div className="gw-dsec"><h4>{m('hListings', { n: String(p.listings.length) })}</h4>
            <div className="gw-pgrid">
              {p.listings.map((x) => (
                <Link key={x.id} className="gw-pgc" href={`/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`}>
                  <div className="gw-pgt">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                    <span className="gw-cc">{x.categoryName}</span>
                  </div>
                  <div className="gw-pgb"><div className="gw-tt">{x.title}</div>
                    <div className="gw-pr">{x.dealAmount != null ? manwon(x.dealAmount) : x.isRealty ? m('negotiable') : <><small className="gw-prl">{m('fee')}</small> {manwon(x.desiredFee)}</>}</div>
                    <div className="gw-mt2"><span>L-{x.listingNo}</span><span>♡ {x.likeCount}</span></div></div>
                </Link>
              ))}
            </div>
          </div>
          <div className="gw-dsec" style={{ marginBottom: 16 }}><h4>{m('hReviews', { n: String(p.reviewCount) })}</h4>
            {p.reviews.length === 0 ? <p className="gw-rvempty">{m('noReviews')}</p> : (
              <div className="gw-revs">{p.reviews.map((r, i) => (
                <div key={i} className="gw-rv2"><div className="gw-rvtop"><span className="gw-av gw-avx gw-avs" aria-hidden="true">{[...r.author][0]}</span>
                  <div className="gw-rvid"><div className="gw-t2"><span className="gw-nm">{r.author}</span><span className="gw-dt3">{r.date}</span></div></div></div>
                  <div className="gw-stars" aria-label={m('ratingAria', { n: String(r.rating) })}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                  {r.body && <div className="gw-tx">{r.body}</div>}</div>
              ))}</div>
            )}
          </div>
        </div>
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}
