import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { AiHead } from '@/components/ai/Engine';
import { ProfileDrop } from '@/components/ai/ProfileDrop';
import { dtKst } from '@/lib/format';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.ai.done'))('metaTitle') };
}

interface Mine {
  registered: boolean; segment?: string; name?: string; description?: string;
  scores?: Record<string, number>; consentedAt?: string; ranking?: Array<{ code: string; name: string; score: number }>;
  upcomingAds?: Array<{ code: string; advertiser: string; title: string; slot: string }>;
}

/**
 * SB-AIS-PRF-020 성향 등록 — v10.31 시안 scAiPrfDone 그대로.
 *   미등록: 「아직 등록된 성향이 없습니다」 + 성향 분석하러 가기 · 메인으로.
 *     전: 등록 여부를 보지 않고 「성향이 등록되었습니다 · 답변이 저장되었습니다」를 보였습니다(결함 중).
 *   등록: ✓ 세그먼트 이름 · 코드 · 설명 · 등록 시각 + 근거 점수 · 이 성향에 나갈 광고 + 다음에 할 일 + 메인에서 확인 · 다시 진단 · 등록 해지.
 */
export default async function ProfileDonePage() {
  const p = await me();
  if (!p) redirect('/login?next=/ai/profile/done');

  const m = await apiGetPersonal<Mine>('/me/profile').catch(() => null);
  const [t, ta] = await Promise.all([getTranslations('join.ai.done'), getTranslations('join.ai')]);

  if (!m?.registered) {
    return (
      <div className="w1 w1-wrap" data-screen="SB-AIS-PRF-020" data-registered="false">
        <BackBar href="/" label={ta('backMain')} wrap={false} />
        <AiHead title={t('metaTitle')} sub={t('noneSub')} />
        <div className="w1-nt warn">{t.rich('none', { b: (c) => <b>{c}</b> })}</div>
        <div className="w1-prfact" style={{ marginTop: 12 }}>
          <Link className="w1-bp" href="/ai/profile">{t('goAnalyze')}</Link>
          <Link className="w1-bo" href="/">{t('toMain')}</Link>
        </div>
      </div>
    );
  }

  const rank: Array<[string, number]> = m.ranking?.length
    ? m.ranking.map((x) => [x.name, x.score])
    : Object.entries(m.scores ?? {}).sort((a, b) => b[1] - a[1]);
  const max = rank[0]?.[1] ?? 0;
  return (
    <div className="w1 w1-wrap" data-screen="SB-AIS-PRF-020" data-registered="true">
      <BackBar href="/" label={ta('backMain')} wrap={false} />
      <AiHead title={t('doneTitle')} sub={t('doneSub')} />
      <div className="w1-prfdone">
        <div className="w1-pdic">✓</div>
        <h2>{m.name}</h2>
        <span className="w1-ls" style={{ fontFamily: 'var(--mono, monospace)' }}>{m.segment}</span>
        {m.description && <p>{m.description}</p>}
        {m.consentedAt && <div className="w1-ls">{t('savedAt', { at: dtKst(m.consentedAt) })}</div>}
      </div>
      <div className="w1-prfw2">
        <div className="w1-segbox">
          <span className="w1-lb">{t('scoresLb')}</span>
          <div className="w1-segbars">
            {rank.map(([code, sc]) => (
              <div key={code} className="w1-segb"><span>{code}</span><i style={{ width: `${max ? Math.round((sc / max) * 100) : 0}%` }} /><em>{sc}</em></div>
            ))}
          </div>
          <div className="w1-ls">{t('scoresNote')}</div>
        </div>
        <div className="w1-segad">
          <span className="w1-lb">{t('adsLb')}</span>
          {m.upcomingAds?.length
            ? m.upcomingAds.map((c) => <div key={c.code} className="w1-segcr"><b>{c.title}</b><span>{c.advertiser} · {c.code} · {t('slot', { slot: c.slot })}</span></div>)
            : <div className="w1-segcr none">{t('adsNone')}</div>}
          <div className="w1-ls">{t.rich('adsNote', { b: (c) => <b>{c}</b> })}</div>
        </div>
      </div>
      <div className="w1-nt">{t.rich('nextNote', { b: (c) => <b>{c}</b> })}</div>
      <div className="w1-prfact" style={{ marginTop: 12 }}>
        <Link className="w1-bp" href="/">{t('checkMain')}</Link>
        <Link className="w1-bo" href="/ai/profile">{t('redo')}</Link>
        <Msgs ns={['join']}><ProfileDrop /></Msgs>
      </div>
    </div>
  );
}
