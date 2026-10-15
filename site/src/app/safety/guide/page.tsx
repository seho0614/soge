import type { Metadata } from 'next';
import Link from 'next/link';
import { SAFETY_GUIDES, SAFETY_PLATFORM, SAFETY_REPORT, SAFETY_RULES } from '@/lib/safety';
import { BackBar } from '@/components/common/BackBar';
import { apiGet } from '@/lib/api';
import type { SafeTradeTerms } from '@/components/market/types';

export const metadata: Metadata = { title: '사기 예방 가이드' };

type Props = { searchParams: Promise<{ t?: string }> };

/**
 * SB-MNY-SAF-020 사기 예방 가이드 · v10.27 (G-130) — 시안 「사기 예방 가이드」와 같은 글 · 유형은 ?t=c1 ~ c5
 * v10.29 — 시안 scSafGd 배치(돌아가기 · 한 장짜리 판 · 유형 칩 · 항목/내용 표 · 맨 아래 「사고 신고하기」)로 그립니다.
 *   개발에 있던 「분쟁 접수」 단추는 맨 아래 줄 왼쪽에 남겼습니다.
 * v10.31 (w2) — 「안전거래 이용 안내」(#safe-trade · B-04 · GET /safety/safe-trade) 칸을 더했습니다(사고예방의 「안전거래 서비스 이용하기」가 오는 곳).
 */
export default async function SafetyGuidePage({ searchParams }: Props) {
  const t = (await searchParams).t;
  const cur = SAFETY_GUIDES.some((g) => g.code === t) ? t : 'all';
  const list = cur === 'all' ? SAFETY_GUIDES : SAFETY_GUIDES.filter((g) => g.code === cur);
  const terms = await apiGet<SafeTradeTerms>('/safety/safe-trade', 300).catch(() => null);
  const min = terms?.minAmount ?? 50000000;
  return (
    <><div className="gw">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/verified" label="사고예방" wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14 }}>
        <div className="gw-panel gw-sgd" data-sgd-page="" style={{ padding: '22px 24px' }}>
          <h1 className="gw-dtt" style={{ margin: '0 0 4px' }}>사기 예방 가이드</h1>
          <p className="gw-ls" style={{ margin: '0 0 14px' }}>거래 전에 확인할 것 · 유형별 수법과 막는 법 · 피해가 났을 때 할 일입니다.</p>

          <nav className="gw-chips" aria-label="사기 유형" style={{ margin: '0 0 14px' }}>
            <Link href="/safety/guide" className={`gw-chip${cur === 'all' ? ' gw-on' : ''}`} aria-current={cur === 'all' ? 'page' : undefined}>전체</Link>
            {SAFETY_GUIDES.map((g) => (
              <Link key={g.code} href={`/safety/guide?t=${g.code}`} className={`gw-chip${cur === g.code ? ' gw-on' : ''}`}
                    aria-current={cur === g.code ? 'page' : undefined} data-sgd-pick={g.code}>{g.name}</Link>
            ))}
          </nav>

          <div className="gw-dsec">
            <h4>거래 전 꼭 확인할 것</h4>
            <ol className="gw-sgd-ol">{SAFETY_RULES.map((r) => <li key={r}>{r}</li>)}</ol>
          </div>

          {list.map((g) => (
            <div key={g.code} className="gw-dsec gw-sgd-sec" data-sgd-sec={g.code}>
              <h4>{g.icon} {g.name} <span className="gw-ls">{g.sub}</span></h4>
              <dl className="gw-spec">
                <dt>대표 수법</dt><dd>{g.how.map((x, i) => <span key={x}>{i > 0 && <br />}{x}</span>)}</dd>
                <dt>이렇게 막으세요</dt><dd>{g.stop.map((x, i) => <span key={x}>{i > 0 && <br />}{x}</span>)}</dd>
              </dl>
            </div>
          ))}

          <div className="gw-dsec">
            <h4>소개뱅크가 하는 일 · 하지 않는 일</h4>
            <dl className="gw-spec">
              {SAFETY_PLATFORM.map(([i, h, d]) => <span key={h} style={{ display: 'contents' }}><dt>{i} {h}</dt><dd>{d}</dd></span>)}
            </dl>
          </div>

          {/* v10.31 (w2) — 시안 사고예방 「안전거래 이용 안내(B-04)」 · 「안전거래 서비스 이용하기」가 오는 자리 */}
          <div className="gw-dsec" id="safe-trade" data-safe-trade="">
            <h4>안전거래 이용 안내 <span className="gw-ls">{(min / 10000).toLocaleString('ko-KR')}만원 이상 거래 · 양측 합의(B-04)</span></h4>
            <dl className="gw-spec">
              <dt>무엇인가</dt><dd>그 거래에 <b>당사자 확인 절차 · 분쟁 지원 · 기록 보존</b>을 거는 것입니다. <b>대금은 당사자끼리 주고받습니다</b> — 소개뱅크는 대금을 받지도 보관하지도 않습니다.</dd>
              <dt>누가 · 언제</dt><dd>계약 조건의 거래 금액이 {(min / 10000).toLocaleString('ko-KR')}만원 이상인 거래에서, 매수자 · 매도자가 <b>둘 다 합의</b>하면 적용됩니다.</dd>
              <dt>어떻게</dt><dd>내 거래 화면에서 「안전거래 합의」를 누르십시오(상대에게 알림이 갑니다). 두 분이 모두 누르면 적용됩니다.</dd>
              {terms?.supportHours && <><dt>상담</dt><dd>소개뱅크 고객센터 {terms.supportHours} 상담{terms.phone ? ` · ${terms.phone}` : ''}</dd></>}
            </dl>
            <div className="gw-abar" style={{ marginTop: 10 }}><span className="gw-sp" />
              <Link className="gw-go" href="/my/deals"><span>내 거래에서 신청하기</span><small>계약 조건의 금액이 기준 이상인 거래</small></Link></div>
          </div>

          <div className="gw-dsec" style={{ marginBottom: 6 }}>
            <h4>피해가 났거나 의심되면</h4>
            <ol className="gw-sgd-ol">
              {SAFETY_REPORT.map(([h, d]) => <li key={h}><b>{h}</b> — {d}</li>)}
              <li><b>금전 피해</b> — 경찰(112) · 경찰청 사이버범죄 신고시스템에 함께 신고하십시오. 대화 · 계약 기록은 소개뱅크가 보존합니다.</li>
            </ol>
            <div className="gw-abar" style={{ marginTop: 12 }}>
              <Link className="gw-bo" href="/support/dispute">분쟁 접수</Link>
              <span className="gw-sp" />
              <Link className="gw-go" href="/support/new"><span>사고 신고하기</span><small>등록글 · 회원 · 거래를 신고합니다</small></Link>
            </div>
          </div>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
