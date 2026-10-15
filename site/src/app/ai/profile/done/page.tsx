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

export const metadata: Metadata = { title: '성향 등록' };

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

  if (!m?.registered) {
    return (
      <div className="w1 w1-wrap" data-screen="SB-AIS-PRF-020" data-registered="false">
        <BackBar href="/" label="메인" wrap={false} />
        <AiHead title="성향 등록" sub="등록된 성향이 없습니다." />
        <div className="w1-nt warn"><b>아직 등록된 성향이 없습니다.</b> 문항에 답하고 <b>성향 등록하기</b>를 누르면 이 화면으로 옵니다.</div>
        <div className="w1-prfact" style={{ marginTop: 12 }}>
          <Link className="w1-bp" href="/ai/profile">성향 분석하러 가기</Link>
          <Link className="w1-bo" href="/">메인으로</Link>
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
      <BackBar href="/" label="메인" wrap={false} />
      <AiHead title="성향 등록 완료" sub="등록한 값이 지금부터 광고와 추천에 쓰입니다." />
      <div className="w1-prfdone">
        <div className="w1-pdic">✓</div>
        <h2>{m.name}</h2>
        <span className="w1-ls" style={{ fontFamily: 'var(--mono, monospace)' }}>{m.segment}</span>
        {m.description && <p>{m.description}</p>}
        {m.consentedAt && <div className="w1-ls">등록 시각 {dtKst(m.consentedAt)} · 저장 위치는 소개뱅크 서버(내 계정)입니다</div>}
      </div>
      <div className="w1-prfw2">
        <div className="w1-segbox">
          <span className="w1-lb">근거 점수</span>
          <div className="w1-segbars">
            {rank.map(([code, sc]) => (
              <div key={code} className="w1-segb"><span>{code}</span><i style={{ width: `${max ? Math.round((sc / max) * 100) : 0}%` }} /><em>{sc}</em></div>
            ))}
          </div>
          <div className="w1-ls">문항 가중치를 세그먼트별로 더한 값입니다. 추론이 아닙니다.</div>
        </div>
        <div className="w1-segad">
          <span className="w1-lb">이 성향에 나갈 광고</span>
          {m.upcomingAds?.length
            ? m.upcomingAds.map((c) => <div key={c.code} className="w1-segcr"><b>{c.title}</b><span>{c.advertiser} · {c.code} · {c.slot} 슬롯</span></div>)
            : <div className="w1-segcr none">지정된 소재가 없어 전체 공개 광고가 나갑니다.</div>}
          <div className="w1-ls">성향은 <b>광고를 고르는 데만</b> 씁니다 — 광고주에게 넘기지 않습니다.</div>
        </div>
      </div>
      <div className="w1-nt"><b>다음에 할 일</b> — 나의공간 → <b>관심 성향</b>에서 언제든 다시 하거나 지울 수 있습니다. 검색 결과와 순위는 바뀌지 않습니다.</div>
      <div className="w1-prfact" style={{ marginTop: 12 }}>
        <Link className="w1-bp" href="/">메인에서 확인하기</Link>
        <Link className="w1-bo" href="/ai/profile">다시 진단</Link>
        <ProfileDrop />
      </div>
    </div>
  );
}
