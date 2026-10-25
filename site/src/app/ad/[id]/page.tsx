import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { getTranslations } from 'next-intl/server';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('ad.title') };
}

interface Creative {
  found: boolean; id?: string; code?: string; advertiser?: string; title?: string; body?: string | null;
  cta?: string | null; category?: string | null; label?: string;
}
const BACK: Record<string, [string, 'ad.backRecs' | 'ad.backHome']> = { recs: ['/ai/match', 'ad.backRecs'], home: ['/', 'ad.backHome'] };

/**
 * SB-ADS-LND-010 광고주 랜딩 미리보기 — v10.31 시안 scAdLand 그대로. 전: 주소가 없어 「없는 주소입니다」(결함 중).
 *   랜딩 주소가 없는 소재를 누르면 여기로 옵니다(메인 HERO · AI 추천 스폰서). 지금 내보내지 않는 소재 · 없는 번호면
 *   「광고를 다시 눌러 주십시오」 빈 상태(시안 그대로).
 *   소개뱅크가 광고주에게 넘기는 것은 없습니다 — 클릭 수만(이름 · 연락처 안 감).
 * 자료: GET /ads/{id} (v10.31 — 노출 중 소재 한 건).
 */
export default async function AdLanding({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const from = (await searchParams).from;
  const t = await getTranslations('plaza');
  const [bh, blk] = BACK[from ?? ''] ?? BACK.home!;
  const bl = t(blk);
  const c = await apiGet<Creative>(`/ads/${encodeURIComponent(id)}`, 30).catch(() => ({ found: false } as Creative));

  if (!c.found) {
    return (
      <div className="w1 w1-wrap" data-screen="SB-ADS-LND-010" data-adland="none">
        <BackBar href={bh} label={bl} wrap={false} />
        <div className="w1-panel" style={{ padding: 30, marginTop: 14 }}>
          <b>{t('ad.again')}</b>
          <p className="w1-ls">{t('ad.unknown')}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="w1 w1-wrap" data-screen="SB-ADS-LND-010" data-adland={c.id}>
      <BackBar href={bh} label={bl} wrap={false} />
      <div className="w1-panel" style={{ padding: 24, marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="w1-blind" style={{ background: 'var(--g200)', color: 'var(--g900)' }}>{c.label ?? t('ad.tag')}</span>
          <span className="w1-ls">{[c.advertiser, c.category, c.code].filter(Boolean).join(' · ')}</span>
        </div>
        <h1 style={{ margin: '10px 0 6px', fontSize: 20, fontWeight: 900, letterSpacing: '-.6px' }}>{c.title}</h1>
        {c.body && <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', lineHeight: 1.7 }}>{c.body}</p>}
        <h2 className="w1-h2" style={{ marginTop: 18 }}>{t('ad.preview')}</h2>
        <div className="w1-nt" data-adl-cta="1"><b>{c.cta ?? t('ad.more')}</b><br />
          <span className="w1-ls">{t('ad.ctaNote')}</span></div>
        <h2 className="w1-h2" style={{ marginTop: 18 }}>{t('ad.when')}</h2>
        <dl className="w1-spec" style={{ gridTemplateColumns: '170px minmax(0,1fr)' }}>
          <dt>{t('ad.withUrlT')}</dt><dd>{t('ad.withUrl')}</dd>
          <dt>{t('ad.noUrlT')}</dt><dd>{t('ad.noUrl')}</dd>
          <dt>{t('ad.shareT')}</dt><dd>{t('ad.share')}</dd>
        </dl>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <Link className="w1-bdone" href="/ai/match">{t('ad.toRecs')}</Link>
        </div>
      </div>
    </div>
  );
}
