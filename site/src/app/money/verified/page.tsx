import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { ListingListData } from '@/lib/types';
import { QuickFrame } from '@/components/gwan/GwQuick';
import { GwGrid } from '@/components/gwan/GwCard';
import { Pager, SafePromo } from '@/components/gwan/GwParts';
import { SAFETY_GUIDES, SAFETY_PLATFORM, SAFETY_REPORT, SAFETY_RULES } from '@/lib/safety';
import type { SafeTradeTerms, SafetyCases } from '@/components/market/types';

export const metadata: Metadata = { title: '사고예방' };

type Props = { searchParams: Promise<{ cursor?: string; p?: string; type?: string; cp?: string }> };
const CTYPE: Record<string, string> = { CONTRACT: 'c1', PAYMENT: 'c2', GOODS: 'c3', PRIVACY: 'c4', ETC: 'c5' };

const ICON = ['📝', '🧑‍💼', '🛡'];
/* 시안 가이드 카드의 둘째 줄 */
const LINE2: Record<string, string> = { c1: '계약 관련 사기를 예방하세요.', c2: '대금 관련 사기를 예방하세요.', c3: '물품/서비스 관련 사기를 예방하세요.', c4: '정보 관련 사기를 예방하세요.', c5: '다양한 사기 유형을 예방하세요.' };

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
  const minTxt = min % 100000000 === 0 ? `${min / 100000000}억원` : `${(min / 10000).toLocaleString('ko-KR')}만원`;
  const tabs: [string, string][] = [['', '전체'], ...(cases?.types ?? []).map((t) => [t.code, t.label] as [string, string])];
  const chref = (t?: string, p?: number) => {
    const u = new URLSearchParams(); if (t) u.set('type', t); if (p && p > 1) u.set('cp', String(p));
    const x = u.toString(); return `/money/verified${x ? `?${x}` : ''}#cases`;
  };
  return (
    <><QuickFrame active="verified" title="사고예방" sub="안전한 거래, 예방이 최고의 성공입니다." aside={<SafePromo />}>
      <div className="gw-sflay">
        <div className="gw-sfp">
          <div className="gw-hh"><b>사고 유형별 예방 가이드</b></div>
          <div className="gw-gdl">
            {SAFETY_GUIDES.map((g) => (
              <Link key={g.code} className={`gw-gd2 gw-${g.code}`} href={`/safety/guide?t=${g.code}`} data-sgd={g.code}>
                <span className="gw-gi2">{g.icon}</span>
                <span className="gw-gb2"><span className="gw-gt2">{g.name}</span><span className="gw-gs2">{g.sub}<br />{LINE2[g.code]}</span></span>
                <span className="gw-gx2">›</span>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="gw-sfp">
            <div className="gw-hh"><b>사고 신고 센터</b><span>사기 피해가 의심되거나 피해를 입으셨다면 즉시 신고해주세요.</span></div>
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
                <Link className="gw-rbtn" href="/support/new">🚨 사고 신고하기</Link>
                <div className="gw-rnote">신고 내용은 담당 관리팀으로 전달되어<br />신속하게 처리됩니다.</div>
                {phone && (
                  <div className="gw-rcall">
                    <span className="gw-rci">🎧</span>
                    <span><span className="gw-rck">긴급상담이 필요하신가요?</span><span className="gw-rcs" data-support-hours={hours ?? ''}>소개뱅크 고객센터{hours ? ` ${hours} 상담` : ''}</span><a className="gw-rcn" href={`tel:${phone}`}>{phone}</a></span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="gw-sf2">
            <div className="gw-sfp">
              <div className="gw-hh"><b>사고 예방을 위한 5가지 핵심 수칙</b></div>
              <div className="gw-rul">{SAFETY_RULES.map((r, i) => <div key={r} className="gw-ru"><span className="gw-rn2">0{i + 1}</span><span className="gw-rx">{r}</span></div>)}</div>
            </div>
            <div className="gw-sfp" data-safe-trade="">
              <div className="gw-hh"><b>안전거래 이용 안내</b><span>{minTxt} 이상 거래에서 양측이 합의하면 이용할 수 있습니다(B-04).</span></div>
              <div className="gw-s4g">
                {(terms?.items.map((x, n) => [SAFETY_PLATFORM[n]?.[0] ?? '•', x.title, x.body] as [string, string, string]) ?? SAFETY_PLATFORM).map(([i, h, d]) => (
                  <div key={h} className="gw-s4"><span className="gw-s4i">{i}</span><span><span className="gw-s4t">{h}</span><span className="gw-s4d">{d}</span></span></div>
                ))}
              </div>
              <Link className="gw-s4b" href="/safety/guide#safe-trade">안전거래 서비스 이용하기 ›</Link>
              <Link className="gw-s4b gw-s4b2" href="/support/dispute">분쟁 접수 · 처리 현황 ›</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="gw-bdlay" id="cases">
        <div>
          <div className="gw-sfp" data-cases={cases?.total ?? 0}>
            <div className="gw-bdt">
              <b className="gw-bdh">피해 사례 게시판</b>
              {tabs.map(([k, t]) => <Link key={k || 'all'} className={`gw-bt4${(ctype ?? '') === k ? ' gw-on' : ''}`} href={chref(k || undefined)} data-stab={k ? CTYPE[k] : 'all'}>{t}</Link>)}
              <Link className="gw-bwr" href="/safety/cases/new">✏ 피해 사례 작성하기</Link>
            </div>
            <div className="gw-tw"><table className="gw-bdtab"><thead><tr><th className="gw-c">번호</th><th className="gw-c">유형</th>
              <th>제목</th><th className="gw-c">지역</th><th className="gw-c">등록일</th><th className="gw-c">조회수</th></tr></thead><tbody>
              {!cases ? <tr><td colSpan={6} className="gw-c" style={{ padding: 26, color: 'var(--ink3)' }}>게시판을 불러오지 못했습니다.</td></tr>
                : cases.items.length === 0 ? <tr><td colSpan={6} className="gw-c" style={{ padding: 26, color: 'var(--ink3)' }}>해당 유형의 사례가 아직 없습니다.</td></tr>
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
            <div className="gw-bdcase">작성자는 공개되지 않고, 연락처 · 이메일 · 계좌번호는 가려서 저장됩니다. 상대 실명 등 개인정보는 쓰지 마십시오 — 특정인을 지목하는 글은 운영이 숨길 수 있습니다.</div>
          </div>
          {/* 개발에 있던 「서류 확인 매물」 — 시안 모양 안(게시판 아래 칸)에 남김 */}
          <div className="gw-sfp" style={{ marginTop: 12 }}>
            <div className="gw-bdt">
              <b className="gw-bdh">서류 확인 매물</b>
              <span className="gw-bdn">{settings['badge.verified_notice'] ?? '등록자가 제출한 서류가 확인되었다는 표시입니다.'}</span>
            </div>
            {!data ? <p className="gw-empty">목록을 불러오지 못했습니다.</p>
              : data.organic.length + data.promoted.length === 0 ? <p className="gw-empty" data-verified-empty="">아직 서류 확인 표시가 붙은 매물이 없습니다.</p>
              : <GwGrid promoted={data.promoted} organic={data.organic} adNotice={data.adNotice} />}
            {data && (data.nextCursor || page > 1) && <Pager base="/money/verified" keep={{}} page={page} next={data.nextCursor} />}
          </div>
        </div>
        <aside className="gw-hot2">
          <b>사기 예방 HOT TIP</b>
          {[['🔍', '계약 전 필수 확인사항', '계약서, 사업자등록증, 법인등기부 확인은 기본 중의 기본!', 'c1'],
            ['⚠️', '의심되는 상황 체크리스트', '사기 징후를 미리 파악하고 피해를 예방하세요.', 'c2'],
            ['📢', '최신 사기 수법 안내', '최근 발생하는 신종 사기 수법과 대응 방법을 확인하세요.', 'c5']].map(([i, k, d, t]) => (
            <Link key={k} className="gw-ht" href={`/safety/guide?t=${t}`}><span className="gw-hi">{i}</span><span><span className="gw-hk">{k}</span><span className="gw-hd2">{d}</span></span></Link>
          ))}
          <Link className="gw-hotb" href="/safety/guide">사기 예방 가이드 더보기 ›</Link>
        </aside>
      </div>
    </QuickFrame><i hidden data-root-end="" /></>
  );
}
