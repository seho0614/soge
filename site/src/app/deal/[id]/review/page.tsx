import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { ReviewForm } from '@/components/ReviewForm';
import { loadDeal } from '@/components/deal/load';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '후기 작성' };

/** SB-HOM-RVW-010 — 후기는 Deal 종속입니다 (INV-5). v10.31 시안 scReview(거래 카드 · 별점 · 칩 · 안내). */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await me())) redirect('/login');
  const { id } = await params;
  const r = await loadDeal(id);
  if ('error' in r) return <div className="w1 w1-wrap"><div className="w1-empty">{r.error}</div></div>;
  const d = r.d;
  const partner = d.myRole === 'BUYER' ? d.seller : d.buyer;
  const ok = ['CONFIRMED', 'SETTLED'].includes(d.status) && d.myRole !== 'INTRODUCER';
  return (
    <div className="w1 w1-wrap w1-rvw" data-screen="SB-HOM-RVW-010">{/* v10.32 — 시안 폭(가운데 좁은 폭 820px 를 뺌) */}
      <BackBar href="/my/deals" label="소개 내역" wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>후기 작성</h1>
        <p>소개자 등급은 건수가 아니라 후기와 수락률로 정해집니다. 솔직하게 적어 주시면 다음 사람이 덜 헤맵니다.</p>
      </div>
      <div className="w1-subnow" style={{ marginTop: 12 }}>
        <span className="w1-ls">거래</span><b>{d.title ?? '소개 거래'}</b>
        <span className="w1-ls">{[partner, d.introducer ? `소개자 ${d.introducer}` : null, d.confirmedAt ? `${ymdKst(d.confirmedAt)} 성사` : d.statusLabel].filter(Boolean).join(' · ')}</span>
      </div>
      {ok ? <ReviewForm dealId={d.id} initial={d.myReview ? { rating: d.myReview.rating, body: d.myReview.body, tags: (d.myReview as { tags?: string[] }).tags } : null} />
        : <div className="w1-nt warn" style={{ marginTop: 12 }}><b>{d.myRole === 'INTRODUCER' ? '소개자는 자기 거래에 후기를 남길 수 없습니다.' : '성사가 확정된 거래에만 후기를 남길 수 있습니다.'}</b></div>}
    </div>
  );
}
