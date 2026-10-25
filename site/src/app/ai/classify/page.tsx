import type { Metadata } from 'next';
import { BackBar } from '@/components/common/BackBar';
import { AiEngine, AiHead } from '@/components/ai/Engine';
import { ClassifyView } from '@/components/ai/ClassifyView';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.ai.classify'))('metaTitle') };
}

/** SB-AIS-CLS-010 AI 자동 카테고리 분류 — v10.31 시안 scAiCls(예문 · 분류하기 · 후보 카드 · 뽑아낸 값 · 광고 연계 · 엔진 설명 4상자) */
export default async function ClassifyPage() {
  const [t, ta] = await Promise.all([getTranslations('join.ai.classify'), getTranslations('join.ai')]);
  return (
    <div className="w1 w1-wrap" data-screen="SB-AIS-CLS-010">
      <BackBar href="/" label={ta('backMain')} wrap={false} />
      <AiHead title={t('title')} sub={t('sub')} />
      <Msgs ns={['join']}><ClassifyView /></Msgs>
      <AiEngine
        eng={<>{t('eng')}</>}
        how={<>{t('how')}</>}
        lim={<>{t.rich('lim', { b: (c) => <b>{c}</b> })}</>}
        next={<>{t('next')}</>} />
    </div>
  );
}
