import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { ymdKst } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { ReviewForm } from '@/components/ReviewForm';
import { loadDeal } from '@/components/deal/load';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('review') };
}

/** SB-HOM-RVW-010 — 후기는 Deal 종속입니다 (INV-5). v10.31 시안 scReview(거래 카드 · 별점 · 칩 · 안내). */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await me())) redirect('/login');
  const { id } = await params;
  const r = await loadDeal(id);
  if ('error' in r) return <div className="w1 w1-wrap"><div className="w1-empty">{r.error}</div></div>;
  const d = r.d;
  const t = await getTranslations('deal');
  const partner = d.myRole === 'BUYER' ? d.seller : d.buyer;
  const ok = ['CONFIRMED', 'SETTLED'].includes(d.status) && d.myRole !== 'INTRODUCER';
  return (
    <div className="w1 w1-wrap w1-rvw" data-screen="SB-HOM-RVW-010">{/* v10.32 — 시안 폭(가운데 좁은 폭 820px 를 뺌) */}
      <BackBar href="/my/deals" label={t('common.backDeals')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{t('review.title')}</h1>
        <p>{t('review.lead')}</p>
      </div>
      <div className="w1-subnow" style={{ marginTop: 12 }}>
        <span className="w1-ls">{t('review.deal')}</span><b>{d.title ?? t('review.dealDefault')}</b>
        <span className="w1-ls">{[partner, d.introducer ? t('review.introducer', { name: d.introducer }) : null, d.confirmedAt ? t('review.confirmedOn', { date: ymdKst(d.confirmedAt) }) : d.statusLabel].filter(Boolean).join(' · ')}</span>
      </div>
      {ok ? <Msgs ns={['deal']}><ReviewForm dealId={d.id} initial={d.myReview ? { rating: d.myReview.rating, body: d.myReview.body, tags: (d.myReview as { tags?: string[] }).tags } : null} /></Msgs>
        : <div className="w1-nt warn" style={{ marginTop: 12 }}><b>{d.myRole === 'INTRODUCER' ? t('review.introOnly') : t('review.confirmedOnly')}</b></div>}
    </div>
  );
}
