import type { Metadata } from 'next';
import Link from 'next/link';
import { getSafety } from '@/lib/safety';
import { BackBar } from '@/components/common/BackBar';
import { apiGet } from '@/lib/api';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';
import type { SafeTradeTerms } from '@/components/market/types';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('guide.title') };
}

type Props = { searchParams: Promise<{ t?: string }> };

/**
 * SB-MNY-SAF-020 사기 예방 가이드 · v10.27 (G-130) — 시안 「사기 예방 가이드」와 같은 글 · 유형은 ?t=c1 ~ c5
 * v10.29 — 시안 scSafGd 배치(돌아가기 · 한 장짜리 판 · 유형 칩 · 항목/내용 표 · 맨 아래 「사고 신고하기」)로 그립니다.
 *   개발에 있던 「분쟁 접수」 단추는 맨 아래 줄 왼쪽에 남겼습니다.
 * v10.31 (w2) — 「안전거래 이용 안내」(#safe-trade · B-04 · GET /safety/safe-trade) 칸을 더했습니다(사고예방의 「안전거래 서비스 이용하기」가 오는 곳).
 */
export default async function SafetyGuidePage({ searchParams }: Props) {
  const tq = (await searchParams).t;
  const t = await getTranslations('plaza.guide');
  const { SAFETY_GUIDES, SAFETY_PLATFORM, SAFETY_REPORT, SAFETY_RULES } = await getSafety();   // v10.119 화면 언어
  const f = await getFmt();
  const g0 = await getTranslations('gwan');
  const cur = SAFETY_GUIDES.some((g) => g.code === tq) ? tq : 'all';
  const list = cur === 'all' ? SAFETY_GUIDES : SAFETY_GUIDES.filter((g) => g.code === cur);
  const terms = await apiGet<SafeTradeTerms>('/safety/safe-trade', 300).catch(() => null);
  const min = terms?.minAmount ?? 50000000;
  /* 한국어는 「5,000만원」 그대로, 다른 언어는 전체 숫자 ₩ (v10.102 · 2-5c) */
  const man = f.manwon(min / 10000, `${(min / 10000).toLocaleString('ko-KR')}만원`);
  return (
    <><div className="gw">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/verified" label={g0('qm.verified')} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14 }}>
        <div className="gw-panel gw-sgd" data-sgd-page="" style={{ padding: '22px 24px' }}>
          <h1 className="gw-dtt" style={{ margin: '0 0 4px' }}>{t('title')}</h1>
          <p className="gw-ls" style={{ margin: '0 0 14px' }}>{t('lead')}</p>

          <nav className="gw-chips" aria-label={t('typesAria')} style={{ margin: '0 0 14px' }}>
            <Link href="/safety/guide" className={`gw-chip${cur === 'all' ? ' gw-on' : ''}`} aria-current={cur === 'all' ? 'page' : undefined}>{t('all')}</Link>
            {SAFETY_GUIDES.map((g) => (
              <Link key={g.code} href={`/safety/guide?t=${g.code}`} className={`gw-chip${cur === g.code ? ' gw-on' : ''}`}
                    aria-current={cur === g.code ? 'page' : undefined} data-sgd-pick={g.code}>{g.name}</Link>
            ))}
          </nav>

          <div className="gw-dsec">
            <h4>{t('before')}</h4>
            <ol className="gw-sgd-ol">{SAFETY_RULES.map((r) => <li key={r}>{r}</li>)}</ol>
          </div>

          {list.map((g) => (
            <div key={g.code} className="gw-dsec gw-sgd-sec" data-sgd-sec={g.code}>
              <h4>{g.icon} {g.name} <span className="gw-ls">{g.sub}</span></h4>
              <dl className="gw-spec">
                <dt>{t('how')}</dt><dd>{g.how.map((x, i) => <span key={x}>{i > 0 && <br />}{x}</span>)}</dd>
                <dt>{t('stop')}</dt><dd>{g.stop.map((x, i) => <span key={x}>{i > 0 && <br />}{x}</span>)}</dd>
              </dl>
            </div>
          ))}

          <div className="gw-dsec">
            <h4>{t('platform')}</h4>
            <dl className="gw-spec">
              {SAFETY_PLATFORM.map(([i, h, d]) => <span key={h} style={{ display: 'contents' }}><dt>{i} {h}</dt><dd>{d}</dd></span>)}
            </dl>
          </div>

          {/* v10.31 (w2) — 시안 사고예방 「안전거래 이용 안내(B-04)」 · 「안전거래 서비스 이용하기」가 오는 자리 */}
          <div className="gw-dsec" id="safe-trade" data-safe-trade="">
            <h4>{t('safe.h')} <span className="gw-ls">{withCodes(t('safe.sub', { amount: man }))}</span></h4>
            <dl className="gw-spec">
              <dt>{t('safe.whatT')}</dt><dd>{t.rich('safe.what', { b: (c) => <b>{c}</b> })}</dd>
              <dt>{t('safe.whoT')}</dt><dd>{t.rich('safe.who', { b: (c) => <b>{c}</b>, amount: man })}</dd>
              <dt>{t('safe.howT')}</dt><dd>{t('safe.how')}</dd>
              {terms?.supportHours && <><dt>{t('safe.supportT')}</dt><dd>{t('safe.support', { hours: terms.supportHours })}{terms.phone ? ` · ${terms.phone}` : ''}</dd></>}
            </dl>
            <div className="gw-abar" style={{ marginTop: 10 }}><span className="gw-sp" />
              <Link className="gw-go" href="/my/deals"><span>{t('safe.apply')}</span><small>{t('safe.applySub')}</small></Link></div>
          </div>

          <div className="gw-dsec" style={{ marginBottom: 6 }}>
            <h4>{t('ifHurt')}</h4>
            <ol className="gw-sgd-ol">
              {SAFETY_REPORT.map(([h, d]) => <li key={h}><b>{h}</b> — {d}</li>)}
              <li><b>{t('moneyLossT')}</b> — {t('moneyLoss')}</li>
            </ol>
            <div className="gw-abar" style={{ marginTop: 12 }}>
              <Link className="gw-bo" href="/support/dispute">{t('dispute')}</Link>
              <span className="gw-sp" />
              <Link className="gw-go" href="/support/new"><span>{t('report')}</span><small>{t('reportSub')}</small></Link>
            </div>
          </div>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
