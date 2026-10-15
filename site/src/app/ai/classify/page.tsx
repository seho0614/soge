import type { Metadata } from 'next';
import { BackBar } from '@/components/common/BackBar';
import { AiEngine, AiHead } from '@/components/ai/Engine';
import { ClassifyView } from '@/components/ai/ClassifyView';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: 'AI 자동 분류' };

/** SB-AIS-CLS-010 AI 자동 카테고리 분류 — v10.31 시안 scAiCls(예문 · 분류하기 · 후보 카드 · 뽑아낸 값 · 광고 연계 · 엔진 설명 4상자) */
export default function ClassifyPage() {
  return (
    <div className="w1 w1-wrap" data-screen="SB-AIS-CLS-010">
      <BackBar href="/" label="메인" wrap={false} />
      <AiHead title="AI 자동 카테고리 분류" sub="등록하려는 글을 그대로 넣으면 관 · 분류 · 등급 후보와 그 근거가 된 어휘를 함께 보여 줍니다." />
      <ClassifyView />
      <AiEngine
        eng={<>규칙 엔진. 서버의 업종 어휘집(classify_vocab) · 제한업종 · 금칙어 목록.</>}
        how={<>어휘마다 가중치가 있고, 글에서 찾은 어휘의 가중치를 분류별로 더한 뒤 비율로 바꿉니다. 금액 · 지역 · 규격은 정규식으로 뽑습니다. 제한업종은 점수를 매기기 전에 막습니다.</>}
        lim={<>학습 모델이 아닙니다. 어휘집에 없으면 <b>분류하지 못했다고 말합니다</b>. 문맥 · 반어 · 오타를 이해하지 못하고, 같은 말이 여러 업종에서 쓰이면 가중치 싸움으로만 갈립니다. 어휘별 가중치는 화면에 내보내지 않습니다(규칙에 맞춰 쓰는 것을 막음).</>}
        next={<>이용자가 실제로 고른 업종(「이 관으로 등록하기」)이 분류 기록에 쌓입니다. 제안과 다른 선택이 반복되면 어휘 가중치를 고칩니다. 실제 모델을 붙일 때 이 기록을 학습 · 평가 자료로 씁니다.</>} />
    </div>
  );
}
