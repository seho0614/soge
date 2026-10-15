import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, ApiFailure } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame } from '@/components/gwan/GwParts';
import { manwon, photoSrc, trustCls } from '@/components/gwan/gw';

export const metadata: Metadata = { title: '업체 프로필' };

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
  return (
    <><GwFrame code={code}>
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href={`/supplier?gwan=${code}`} label="서비스 업체" wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel" style={{ overflow: 'hidden' }} data-supplier={p.id}>
          <div className="gw-dtprof">
            <span className="gw-av gw-avx" aria-hidden="true">{[...p.companyName][0]}</span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <h1 className="gw-nm" style={{ fontSize: 20, margin: 0 }}>{p.companyName}<span className="gw-vbdg">사업자 인증</span>{p.broker && <span className="gw-vbdg">중개사 인증</span>}</h1>
              <div className="gw-mt2">활동지역 &nbsp; {p.sido ? `${p.sido}${p.sigungu ? ` ${p.sigungu}` : ''}` : '—'} &nbsp;&nbsp; 인증 &nbsp; {p.verifiedSince ?? '—'} &nbsp;&nbsp; 가입 &nbsp; {p.joinedAt ?? '—'}</div>
            </div>
            {p.listings[0] && <Link className="gw-go" href={`/${GWAN_PATH[p.listings[0].gwanCode] ?? 'money'}/${p.listings[0].id}#ask`}><span>제안 하기</span><small>매물에서 1:1 문의 — 대화가 시작되면 소개코드가 발급됩니다</small></Link>}
          </div>
          <div className="gw-sth">소개 신뢰도 · 실적</div>
          <div className="gw-stat">
            <div><div className="gw-k">소개 신뢰도</div><div className={`gw-v gw-trv ${trustCls(Number(t.score))}`}>{Number(t.score).toFixed(1)}</div></div>
            <div><div className="gw-k">성사(확정)</div><div className="gw-v">{p.confirmedDeals}건</div></div>
            <div><div className="gw-k">평점</div><div className="gw-v">{p.rating != null ? `★ ${Number(p.rating).toFixed(1)}` : '—'} <small>({p.reviewCount})</small></div></div>
            <div><div className="gw-k">성사율</div><div className="gw-v">{p.successRate != null ? `${p.successRate}%` : '—'}</div></div>
          </div>
          <div className="gw-dsec"><h4>신뢰도는 이렇게 셉니다</h4>
            <dl className="gw-spec">
              <dt>시작</dt><dd>36.5</dd>
              <dt>사업자 인증</dt><dd>{t.business ? '+10' : '없음'}</dd>
              <dt>본인인증</dt><dd>{t.identity ? '+5' : '없음'}</dd>
              <dt>성사 확정</dt><dd>{t.deals}건 × 1.5 (15점까지)</dd>
              <dt>동의율</dt><dd>{t.consentRate != null ? `${t.consentRate}%` : '자료 없음'}</dd>
              <dt>분쟁(최근 1년)</dt><dd>{t.disputes}건</dd>
            </dl>
          </div>
          <div className="gw-dsec"><h4>게시 중인 매물 {p.listings.length}건</h4>
            <div className="gw-pgrid">
              {p.listings.map((x) => (
                <Link key={x.id} className="gw-pgc" href={`/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`}>
                  <div className="gw-pgt">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                    <span className="gw-cc">{x.categoryName}</span>
                  </div>
                  <div className="gw-pgb"><div className="gw-tt">{x.title}</div>
                    <div className="gw-pr">{x.dealAmount != null ? manwon(x.dealAmount) : x.isRealty ? '금액 협의' : <><small className="gw-prl">소개비</small> {manwon(x.desiredFee)}</>}</div>
                    <div className="gw-mt2"><span>L-{x.listingNo}</span><span>♡ {x.likeCount}</span></div></div>
                </Link>
              ))}
            </div>
          </div>
          <div className="gw-dsec" style={{ marginBottom: 16 }}><h4>받은 후기 {p.reviewCount}</h4>
            {p.reviews.length === 0 ? <p className="gw-rvempty">아직 후기가 없습니다. 성사가 확정된 거래의 당사자만 후기를 남길 수 있습니다.</p> : (
              <div className="gw-revs">{p.reviews.map((r, i) => (
                <div key={i} className="gw-rv2"><div className="gw-rvtop"><span className="gw-av gw-avx gw-avs" aria-hidden="true">{[...r.author][0]}</span>
                  <div className="gw-rvid"><div className="gw-t2"><span className="gw-nm">{r.author}</span><span className="gw-dt3">{r.date}</span></div></div></div>
                  <div className="gw-stars" aria-label={`평점 ${r.rating}점`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                  {r.body && <div className="gw-tx">{r.body}</div>}</div>
              ))}</div>
            )}
          </div>
        </div>
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}
