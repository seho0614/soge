import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { ProfileSurvey, type Mine, type Q } from '@/components/ProfileSurvey';
import { AiEngine, AiHead } from '@/components/ai/Engine';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '관심 성향 분석' };

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

  const [q, mine] = await Promise.all([
    apiGet<{ questions: Q[]; note?: string }>('/profile/questions', 300).catch(() => null),
    apiGetPersonal<Mine>('/me/profile').catch(() => null),
  ]);

  return (
    <div className="w1 w1-wrap" data-screen="SB-AIS-PRF-010">
      <BackBar href="/" label="메인" wrap={false} />
      <AiHead title="관심 성향 분석" sub={<>여섯 문항으로 관심 분야를 나눕니다. 이 값이 <b>메인 광고</b>와 <b>추천 정렬</b>에 쓰입니다.</>} />
      <div className="w1-nt"><b>{q?.note ?? '선택한 값을 더해서 가장 높은 세그먼트를 씁니다. 추론이 아닙니다.'}</b></div>

      {q?.questions?.length ? (
        <ProfileSurvey questions={q.questions} mine={mine} />
      ) : (
        <div className="w1-empty" style={{ marginTop: 14 }}>문항을 불러오지 못했습니다. 잠시 후 다시 시도해 주십시오.</div>
      )}

      <AiEngine
        eng={<>규칙 엔진. 문항 {q?.questions?.length ?? 6} · 선택지별 세그먼트 가중치 표(서버) · 세그먼트 6종.</>}
        how={<>고른 선택지의 가중치를 세그먼트별로 더하고 가장 높은 것을 씁니다. 동점이면 앞선 세그먼트를 씁니다.</>}
        lim={<>행동 데이터를 보지 않습니다. 스스로 답한 것만 반영하므로 <b>실제 관심과 다를 수 있고</b>, 답을 바꾸면 즉시 바뀝니다. 여섯 문항으로 사람을 규정하지 않습니다.</>}
        next={<>열람 · 검색 · 성사 이력을 넣으면 문항 없이도 세그먼트가 나옵니다. 그때는 <b>수집 항목과 보관 기간을 개인정보 처리방침에 먼저 적어야 합니다</b>.</>}
      />
    </div>
  );
}
