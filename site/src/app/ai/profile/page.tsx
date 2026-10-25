import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { ProfileSurvey, type Mine, type Q } from '@/components/ProfileSurvey';
import { AiEngine, AiHead } from '@/components/ai/Engine';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.ai.profile'))('title') };
}

/**
 * SB-AIS-PRF-010 관심 성향 분석 — v10.31 시안 scAiPrf 그대로(문항 카드 · 오른쪽 분석 결과 · 지금 적용된 값 · 엔진 설명 4상자).
 *   전: 화면이 문항 글을 text 로 읽어(서버는 question · label) 문항 · 보기가 회색 막대로만 보였습니다(결함 상) → 서버 모양 그대로 읽음.
 *   등록한 회원도 이 화면에 머뭅니다(시안 — 「등록 결과 보기」 단추 · 다시 하기).
 *
 * ── 추론하지 않습니다 ───────────────────────────────────────────────
 * 본인이 고른 답만 씁니다. 동의가 없으면 저장되지 않습니다(INV-AD1~4). 가중치는 화면에 내려보내지 않습니다.
 */
export default async function ProfilePage() {
  const p = await me();
  if (!p) redirect('/login?next=/ai/profile');
  const [t, ta] = await Promise.all([getTranslations('join.ai.profile'), getTranslations('join.ai')]);

  const [q, mine] = await Promise.all([
    apiGet<{ questions: Q[]; note?: string }>('/profile/questions', 300).catch(() => null),
    apiGetPersonal<Mine>('/me/profile').catch(() => null),
  ]);

  return (
    <div className="w1 w1-wrap" data-screen="SB-AIS-PRF-010">
      <BackBar href="/" label={ta('backMain')} wrap={false} />
      <AiHead title={t('title')} sub={<>{t.rich('sub', { b: (c) => <b>{c}</b> })}</>} />
      <div className="w1-nt"><b>{q?.note ?? t('noteFallback')}</b></div>

      {q?.questions?.length ? (
        <Msgs ns={['join']}><ProfileSurvey questions={q.questions} mine={mine} /></Msgs>
      ) : (
        <div className="w1-empty" style={{ marginTop: 14 }}>{t('loadFail')}</div>
      )}

      <AiEngine
        eng={<>{t('eng', { n: String(q?.questions?.length ?? 6) })}</>}
        how={<>{t('how')}</>}
        lim={<>{t.rich('lim', { b: (c) => <b>{c}</b> })}</>}
        next={<>{t.rich('next', { b: (c) => <b>{c}</b> })}</>}
      />
    </div>
  );
}
