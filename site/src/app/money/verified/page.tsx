import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { ListingListData } from '@/lib/types';
import { QuickFrame } from '@/components/gwan/GwQuick';
import { GwGrid } from '@/components/gwan/GwCard';
import { Pager, SafePromo } from '@/components/gwan/GwParts';
import { getSafety } from '@/lib/safety';
import type { SafeTradeTerms, SafetyCases } from '@/components/market/types';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('gwan'))('qm.verified') };
}

type Props = { searchParams: Promise<{ cursor?: string; p?: string; type?: string; cp?: string }> };
const CTYPE: Record<string, string> = { CONTRACT: 'c1', PAYMENT: 'c2', GOODS: 'c3', PRIVACY: 'c4', ETC: 'c5' };

const ICON = ['📝', '🧑‍💼', '🛡'];
/* 시안 가이드 카드의 둘째 줄 — 사전(plaza.verified.line2.*) · 모르는 코드는 빈칸 */
const LINE2 = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;
const isLine2 = (c: string): c is (typeof LINE2)[number] => (LINE2 as readonly string[]).includes(c);
/* HOT TIP — [그림, 사전 키, 가이드 유형] */
const HOT = [['🔍', 'h1', 'c1'], ['⚠️', 'h2', 'c2'], ['📢', 'h3', 'c5']] as const;

/**
 * SB-MNY-SAF-010 퀵메뉴 ④ — 시안 「사고예방」(scSafe) 그대로 + 개발의 「서류 확인」 걸러 보기(남김).
 *
 *   · 유형별 예방 가이드 5 · 신고 센터 · 핵심 수칙 · HOT TIP — 고정 글(lib/safety · 사기 예방 가이드와 같은 글).
 * v10.31 (w2 · 10/10 「시안 기준」)
 *   · 신고 센터 — 시안 「소개뱅크 고객센터 24시간 상담」(운영 설정 support.hours · footer.phone · GET /safety/safe-trade).
 *   · 「안전거래 이용 안내 — 5,000만원 이상 거래에서 양측이 합의하면 이용(B-04)」 · 「안전거래 서비스 이용하기」 — 시안대로.
 *       안전거래 = 양측 합의로 그 거래에 당사자 확인 · 분쟁 지원 · 기록 보존을 거는 것(서버 deal_safe_trades · 기준 금액 safe_trade.min_amount).
 *       **대금은 여전히 당사자끼리** — 시안의 같은 칸 첫 줄 「소개뱅크는 대금을 받지도 보관하지도 않습니다」 그대로(INV-11).
 *       개발에 있던 「분쟁 접수 · 처리 현황」 단추는 같은 칸에 남깁니다.
 *   · 피해 사례 게시판 — 서버 신설(GET /safety/cases): 유형 탭 6 · 번호 · 유형 · 제목 · 지역 · 등록일 · 조회수 · 쪽 번호 · 「피해 사례 작성하기」(/safety/cases/new).
 *       작성자는 보이지 않고, 연락처 · 이메일 · 계좌번호는 서버가 저장 전에 가립니다.
 *   · 개발에 있던 「서류 확인 매물」(GET /listings?badge=VERIFIED_DOC)은 게시판 아래 칸으로 남깁니다.
 */
export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const t = await getTranslations('plaza.verified');
  const { SAFETY_GUIDES, SAFETY_PLATFORM, SAFETY_REPORT, SAFETY_RULES } = await getSafety();   // v10.119 화면 언어
  const g0 = await getTranslations('gwan');
  const f = await getFmt();
  const page = Math.max(1, Number(q.p) || 1);
  const cpage = Math.max(1, Number(q.cp) || 1);
  const ctype = q.type && CTYPE[q.type] ? q.type : undefined;
  const [data, settings, cases, terms] = await Promise.all([
    apiGet<ListingListData>(`/listings?gwanCode=MNY&badge=VERIFIED_DOC&limit=8${q.cursor ? `&cursor=${encodeURIComponent(q.cursor)}` : ''}`, 30).catch(() => null),
    apiGet<Record<string, string | null>>('/site-settings/public', 300).catch(() => ({} as Record<string, string | null>)),
    apiGet<SafetyCases>(`/safety/cases?limit=5&page=${cpage}${ctype ? `&type=${ctype}` : ''}`, 10).catch(() => null),
    apiGet<SafeTradeTerms>('/safety/safe-trade', 300).catch(() => null),
  ]);
  const phone = terms?.phone ?? settings['footer.phone'];
  const hours = terms?.supportHours ?? null;
  const min = terms?.minAmount ?? 50000000;
  /* 한국어는 억 · 만 줄임 그대로, 다른 언어는 전체 숫자 ₩ (v10.102 · 2-5c) */
  const minTxt = !f.ko ? f.won(min) : min % 100000000 === 0 ? `${min / 100000000}억원` : `${(min / 10000).toLocaleString('ko-KR')}만원`;
  const tabs: [string, string][] = [['', t('all')], ...(cases?.types ?? []).map((x) => [x.code, x.label] as [string, string])];
  const chref = (t?: string, p?: number) => {
    const u = new URLSearchParams(); if (t) u.set('type', t); if (p && p > 1) u.set('cp', String(p));
    const x = u.toString(); return `/money/verified${x ? `?${x}` : ''}#cases`;
  };
  return (
    <><QuickFrame active="verified" title={g0('qm.verified')} sub={t('sub')} aside={<SafePromo />}>
      <div className="gw-sflay">
        <div className="gw-sfp">
          <div className="gw-hh"><b>{t('guideH')}</b></div>
          <div className="gw-gdl">
            {SAFETY_GUIDES.map((g) => (
              <Link key={g.code} className={`gw-gd2 gw-${g.code}`} href={`/safety/guide?t=${g.code}`} data-sgd={g.code}>
                <span className="gw-gi2">{g.icon}</span>
                <span className="gw-gb2"><span className="gw-gt2">{g.name}</span><span className="gw-gs2">{g.sub}<br />{isLine2(g.code) ? t(`line2.${g.code}`) : ''}</span></span>
                <span className="gw-gx2">›</span>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="gw-sfp">
            <div className="gw-hh"><b>{t('reportH')}</b><span>{t('reportSub')}</span></div>
            <div className="gw-rstep">
              <div className="gw-rsl">
                {SAFETY_REPORT.map(([h, d], i) => (
                  <span key={h} style={{ display: 'contents' }}>
                    {i > 0 && <span className="gw-rarw">›</span>}
                    <div className="gw-rs2"><span className="gw-ri">{ICON[i]}</span><span className="gw-rt2">{i + 1}. {h}</span><span className="gw-rd2">{d}</span></div>
                  </span>
                ))}
              </div>
              <div>
                <Link className="gw-rbtn" href="/support/new">🚨 {t('report')}</Link>
                <div className="gw-rnote">{t.rich('reportNote', { br: () => <br /> })}</div>
                {phone && (
                  <div className="gw-rcall">
                    <span className="gw-rci">🎧</span>
                    <span><span className="gw-rck">{t('urgentCall')}</span><span className="gw-rcs" data-support-hours={hours ?? ''}>{t('center')}{hours ? ` ${t('hours', { hours })}` : ''}</span><a className="gw-rcn" href={`tel:${phone}`}>{phone}</a></span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="gw-sf2">
            <div className="gw-sfp">
              <div className="gw-hh"><b>{t('rulesH')}</b></div>
              <div className="gw-rul">{SAFETY_RULES.map((r, i) => <div key={r} className="gw-ru"><span className="gw-rn2">0{i + 1}</span><span className="gw-rx">{r}</span></div>)}</div>
            </div>
            <div className="gw-sfp" data-safe-trade="">
              <div className="gw-hh"><b>{t('safeH')}</b><span>{t('safeSub', { amount: minTxt })}</span></div>
              <div className="gw-s4g">
                {(terms?.items.map((x, n) => [SAFETY_PLATFORM[n]?.[0] ?? '•', x.title, x.body] as [string, string, string]) ?? SAFETY_PLATFORM).map(([i, h, d]) => (
                  <div key={h} className="gw-s4"><span className="gw-s4i">{i}</span><span><span className="gw-s4t">{h}</span><span className="gw-s4d">{d}</span></span></div>
                ))}
              </div>
              <Link className="gw-s4b" href="/safety/guide#safe-trade">{t('safeGo')}</Link>
              <Link className="gw-s4b gw-s4b2" href="/support/dispute">{t('dispute')}</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="gw-bdlay" id="cases">
        <div>
          <div className="gw-sfp" data-cases={cases?.total ?? 0}>
            <div className="gw-bdt">
              <b className="gw-bdh">{t('casesH')}</b>
              {tabs.map(([k, l]) => <Link key={k || 'all'} className={`gw-bt4${(ctype ?? '') === k ? ' gw-on' : ''}`} href={chref(k || undefined)} data-stab={k ? CTYPE[k] : 'all'}>{l}</Link>)}
              <Link className="gw-bwr" href="/safety/cases/new">✏ {t('write')}</Link>
            </div>
            <div className="gw-tw"><table className="gw-bdtab"><thead><tr><th className="gw-c">{t('th.no')}</th><th className="gw-c">{t('th.type')}</th>
              <th>{t('th.title')}</th><th className="gw-c">{t('th.region')}</th><th className="gw-c">{t('th.date')}</th><th className="gw-c">{t('th.views')}</th></tr></thead><tbody>
              {!cases ? <tr><td colSpan={6} className="gw-c" style={{ padding: 26, color: 'var(--ink3)' }}>{t('casesFail')}</td></tr>
                : cases.items.length === 0 ? <tr><td colSpan={6} className="gw-c" style={{ padding: 26, color: 'var(--ink3)' }}>{t('casesNone')}</td></tr>
                : cases.items.map((r) => (
                  <tr key={r.no}><td className="gw-c">{r.no}</td>
                    <td className="gw-c"><span className={`gw-tg gw-${CTYPE[r.type] ?? 'c5'}`}>{r.typeLabel}</span></td>
                    <td className="gw-ti"><Link href={`/safety/cases/${r.no}`}>{r.title}</Link> <span style={{ color: 'var(--g300)' }}>⧉</span></td>
                    <td className="gw-c">{r.region ?? '—'}</td><td className="gw-c">{r.date}</td><td className="gw-c">{r.views.toLocaleString('ko-KR')}</td></tr>
                ))}
            </tbody></table></div>
            {cases && cases.pageCount > 1 && (
              <div className="gw-pgw"><span /><div className="gw-pager">
                {Array.from({ length: Math.min(cases.pageCount, 10) }, (_, i) => i + 1).map((n) => n === cpage
                  ? <span key={n} className="gw-on" aria-current="page">{n}</span> : <Link key={n} href={chref(ctype, n)}>{n}</Link>)}
              </div></div>
            )}
            <div className="gw-bdcase">{t('casesNote')}</div>
          </div>
          {/* 개발에 있던 「서류 확인 매물」 — 시안 모양 안(게시판 아래 칸)에 남김 */}
          <div className="gw-sfp" style={{ marginTop: 12 }}>
            <div className="gw-bdt">
              <b className="gw-bdh">{t('docH')}</b>
              <span className="gw-bdn">{settings['badge.verified_notice'] ?? t('docNote')}</span>
            </div>
            {!data ? <p className="gw-empty">{t('docFail')}</p>
              : data.organic.length + data.promoted.length === 0 ? <p className="gw-empty" data-verified-empty="">{t('docNone')}</p>
              : <GwGrid promoted={data.promoted} organic={data.organic} adNotice={data.adNotice} />}
            {data && (data.nextCursor || page > 1) && <Pager base="/money/verified" keep={{}} page={page} next={data.nextCursor} />}
          </div>
        </div>
        <aside className="gw-hot2">
          <b>{t('hotH')}</b>
          {HOT.map(([i, k, c]) => (
            <Link key={k} className="gw-ht" href={`/safety/guide?t=${c}`}><span className="gw-hi">{i}</span><span><span className="gw-hk">{t(`hot.${k}.t`)}</span><span className="gw-hd2">{t(`hot.${k}.d`)}</span></span></Link>
          ))}
          <Link className="gw-hotb" href="/safety/guide">{t('guideMore')}</Link>
        </aside>
      </div>
    </QuickFrame><i hidden data-root-end="" /></>
  );
}
