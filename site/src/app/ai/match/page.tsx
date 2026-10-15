import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { AiEngine, AiHead } from '@/components/ai/Engine';
import { MatchView, type Ad, type Cand, type Weight } from '@/components/ai/MatchView';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: 'AI 추천 결과' };

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

  const [res, ad] = await Promise.all([
    apiGetPersonal<Res>(`/ai/recommend/request${rid ? `?id=${encodeURIComponent(rid)}` : ''}`).catch(() => null),
    apiGetPersonal<Ad>('/ads/serve?slot=RECS').catch(() => null),
  ]);

  return (
    <div className="w1 w1-wrap" data-screen="SB-AIS-REC-010">
      <BackBar href="/" label="메인" wrap={false} />
      <AiHead title="AI 추천 결과" sub="요청 1건에 붙일 사업자 후보를 5항목 가중 점수로 줄 세웁니다. 가중치를 움직이면 순위가 즉시 다시 계산됩니다." />

      {!res ? (
        <div className="w1-empty">추천을 불러오지 못했습니다. 잠시 후 다시 시도해 주십시오.</div>
      ) : !res.request ? (
        <div className="w1-nt">
          <b>아직 올린 요청이 없습니다.</b> 추천은 내가 올린 소개받기 요청 1건을 기준으로 후보를 줄 세웁니다.{' '}
          <Link href="/request/new">소개받기 요청 올리기 →</Link>
          <div className="w1-ls" style={{ marginTop: 6 }}>정렬 기준: {res.weights.map((w) => `${w.name} ${w.weight}%`).join(' · ')}</div>
        </div>
      ) : (
        <>
          <div className="w1-nt">
            <b>요청</b> — {res.request.title}{res.request.region ? ` · ${res.request.region}` : ''}{res.request.categoryName ? ` · ${res.request.categoryName}` : ''}.{' '}
            이 요청은 <b>1건 = 1사업자</b>로만 나갑니다. 같은 요청을 여러 곳에 팔지 않습니다(재판매 금지). 그래서 순위가 곧 배분입니다.
            {res.mine.length > 1 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {res.mine.map((m) => (
                  <Link key={m.id} href={`/ai/match?request=${m.id}`} className={`w1-bo sm`} aria-current={m.id === res.request!.id ? 'true' : undefined}
                    style={m.id === res.request!.id ? { borderColor: 'var(--pp)', color: 'var(--pp-d)', fontWeight: 700 } : undefined}>{m.title}</Link>
                ))}
              </div>
            )}
          </div>
          <MatchView weights={res.weights} cands={res.candidates} gwanCode={res.request.gwanCode} ad={ad} />
        </>
      )}

      <AiEngine
        eng={<>규칙 엔진. 5항목 가중 평균 — 지역 · 카테고리 · 성사 이력 · 응답 속도 · 신뢰지표(서버 fn_request_candidates).</>}
        how={<>후보마다 항목 점수(0~100)를 실제 자료로 냅니다 — 지역(사업자 주소 · 시 · 구) · 카테고리(같은 업종 매물) · 성사 확정 × 20 · 첫 답 평균 시간(72시간 이상 0) · 인증 40 + 후기 별점. 화면의 가중치로 가중 평균을 냅니다. 인증 미완은 점수를 깎지 않고 <b>카드에 그대로 표시</b>합니다.</>}
        lim={<>협업 필터링이 아닙니다. 성사 데이터가 쌓이기 전까지는 <b>이 가중치가 곧 추천 근거</b>이고, 가중치를 정하는 사람이 곧 알고리즘입니다. 기록이 없는 항목은 0점입니다.</>}
        next={<>성사 로그가 쌓이면 가중치를 성사율로 학습합니다. 붙일 자리는 항목 점수를 만드는 서버 함수(fn_request_candidates)입니다.</>}
      />
    </div>
  );
}
