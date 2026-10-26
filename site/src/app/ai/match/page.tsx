import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { AiEngine, AiHead } from '@/components/ai/Engine';
import { MatchView, type Ad, type Cand, type Weight } from '@/components/ai/MatchView';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.ai.match'))('title') };
}

interface Res {
  request: { id: string; title: string; gwanCode: string; region: string | null; categoryName: string | null } | null;
  mine: Array<{ id: string; title: string; status: string }>;
  weights: Weight[]; candidates: Cand[]; note?: string;
}

/**
 * SB-AIS-REC-010 AI 추천 결과 — v10.31 시안 scAiRec 그대로.
 *   요청 줄(내 요청 고르기) · 가중치 밀대 5개 · 스폰서 칸(RECS · 점수 밖) · 후보 카드 · 엔진 설명 4상자.
 *   전: 「정렬 기준」 표만 있고 비중이 3000% · 2000% 로 보였습니다(서버 값 30 이 이미 % 인데 ×100 — 결함 중) · 후보가 없었습니다(결함 중).
 * 자료: GET /ai/recommend/request?id= (v10.31 — 실제 자료로 계산 · 요청한 본인만) · GET /ads/serve?slot=RECS.
 */
export default async function MatchPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const p = await me();
  if (!p) redirect('/login?next=/ai/match');
  const rid = (await searchParams).request;
  const [t, ta] = await Promise.all([getTranslations('join.ai.match'), getTranslations('join.ai')]);

  const [res0, ad] = await Promise.all([
    apiGetPersonal<Res>(`/ai/recommend/request${rid ? `?id=${encodeURIComponent(rid)}` : ''}`).catch(() => null),
    apiGetPersonal<Ad>('/ads/serve?slot=RECS').catch(() => null),
  ]);
  /* v10.122 — 가중치 이름(recommend_weights.name)은 코드(loc · cat · win · spd · trust)로 화면 언어 글자 · 한국어는 서버 글자 그대로 */
  const f = await getFmt();
  const tw = await getTranslations('join.ai.match.w');
  const res = res0 && { ...res0, weights: res0.weights.map((w) => ({ ...w, name: f.srv(w.name, tw.has(w.code as never) ? tw(w.code as never) : w.name) })) };

  return (
    <div className="w1 w1-wrap" data-screen="SB-AIS-REC-010">
      <BackBar href="/" label={ta('backMain')} wrap={false} />
      <AiHead title={t('title')} sub={t('sub')} />

      {!res ? (
        <div className="w1-empty">{t('loadFail')}</div>
      ) : !res.request ? (
        <div className="w1-nt">
          {t.rich('noRequest', { b: (c) => <b>{c}</b> })}{' '}
          <Link href="/request/new">{t('newRequest')}</Link>
          <div className="w1-ls" style={{ marginTop: 6 }}>{t('sortBy', { list: res.weights.map((w) => `${w.name} ${w.weight}%`).join(' · ') })}</div>
        </div>
      ) : (
        <>
          <div className="w1-nt">
            <b>{t('requestB')}</b> — {res.request.title}{res.request.region ? ` · ${res.request.region}` : ''}{res.request.categoryName ? ` · ${res.request.categoryName}` : ''}.{' '}
            {t.rich('oneToOne', { b: (c) => <b>{c}</b> })}
            {res.mine.length > 1 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {res.mine.map((m) => (
                  <Link key={m.id} href={`/ai/match?request=${m.id}`} className={`w1-bo sm`} aria-current={m.id === res.request!.id ? 'true' : undefined}
                    style={m.id === res.request!.id ? { borderColor: 'var(--pp)', color: 'var(--pp-d)', fontWeight: 700 } : undefined}>{m.title}</Link>
                ))}
              </div>
            )}
          </div>
          <Msgs ns={['join']}><MatchView weights={res.weights} cands={res.candidates} gwanCode={res.request.gwanCode} ad={ad} /></Msgs>
        </>
      )}

      <AiEngine
        eng={<>{t('eng')}</>}
        how={<>{t.rich('how', { b: (c) => <b>{c}</b> })}</>}
        lim={<>{t.rich('lim', { b: (c) => <b>{c}</b> })}</>}
        next={<>{t('next')}</>}
      />
    </div>
  );
}
