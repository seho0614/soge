/**
 * SB-HOM-MAIN-010 · 011 — 메인 전용 머리 · 바닥 (v10.13 「hero 페이지」 디자인).
 *
 * 사장님 결정(2026-10-02): 새 헤더 · 푸터는 **메인에서만** 씁니다. 다른 화면의 머리 · 바닥(app/layout.tsx)은 그대로입니다.
 * 메뉴 이름은 관 이름 그대로입니다— v10.25 에서 관 이름이 그림대로 「소개몰」이 됐습니다(10/7 결정 · 마이그레이션 D024).
 *
 * 로고 · 사회관계망 아이콘은 주신 그림에서 그대로 잘라 낸 것입니다.
 *
 * 그림에 없지만 넣은 것 세 가지:
 *   ① 사업자 정보 · 통신판매중개자 고지 — 첫 화면에서 빠지면 안 되는 법정 표시입니다.
 *   ② 바로가기 줄(소개받기 · 파트너센터 · AI 기능 · 나의공간) — 새 헤더에서 빠진 곳을 메인에서 갈 수 있게 합니다.
 *   ③ 「예시입니다」 한 줄 — 그림의 내용(평점 · 인물)을 실제 웹에도 그대로 두기로 해서, 실제 데이터가 아님을 적어 둡니다.
 *      (v10.14 — 「이건 어때?」의 참여 수는 예시가 아니라 실제 표 수입니다. 사회관계망 아이콘은 운영이 넣은 주소로 연결됩니다.)
 */
import Link from 'next/link';
import type { FooterLink, Gwan } from '@/lib/types';
import { GWAN_PATH } from '@/lib/format';
import { Line, Pic } from './Icons';
import { footerHref, isOps } from '@/components/common/links';
import { HomeLogout } from './HomeLogout';
import type { MeSummary } from './types';

export function Logo() {
  return (
    <Link href="/" className="home-logo" aria-label="소개뱅크 메인으로">
      <Pic name="logo" h={48} alt="소개뱅크" />
    </Link>
  );
}

/**
 * v10.31 — 로그인 뒤 오른쪽: 시안 「🔍 · 👤 이름 · 나의공간 · 로그아웃 · 관리자 페이지(운영 역할만)」.
 *   개발에만 있던 「소개받기」 단추는 남겨 둡니다(지시 ③ — 시안 모양 안에 · 옅게).
 */
export function HomeHeader({ gwans, loggedIn, summary }: { gwans: Gwan[]; loggedIn: boolean; summary?: MeSummary | null }) {
  const name = summary?.displayName?.trim() || null;
  return (
    <header className="home-hd">
      <div className="home-in">
        <Logo />
        <nav className="home-nav" aria-label="주 메뉴">
          {/* 주소가 없는 관(허브 EARN 등)과 중지된 관은 뺍니다 — 공통 헤더와 같은 규칙 */}
          {gwans.filter((g) => g.isActive !== false && GWAN_PATH[g.code]).map((g) => (
            <Link key={g.code} href={`/${GWAN_PATH[g.code]}`}>{g.name}</Link>
          ))}
          <Link href="/community">소개광장</Link>
          <Link href="/guide">이용안내</Link>
        </nav>
        <div className="home-hdr">
          {/* v10.40 — 시안: 머리줄 돋보기는 히어로 검색칸으로 가서 검색 팝업을 엽니다(HeroSearch 가 #home-q 를 받음 · 전: 결과 화면 링크) */}
          <Link className="home-icbtn" href="#home-q" aria-label="검색"><Line name="search" size={22} w={2.4} /></Link>
          {loggedIn ? (
            <>
              <span className="home-who" title={name ?? undefined}>👤 {name ? (name.length > 10 ? name.slice(0, 10) + '…' : name) : '회원'}</span>
              <Link className="home-pill" href="/my">나의공간</Link>
              <Link className="home-pill dev" href="/request">소개받기</Link>
              <HomeLogout />
              {isOps(summary?.principal?.roles) && <a className="home-pill p" href="/go/admin">관리자 페이지</a>}
            </>
          ) : (
            <>
              <Link className="home-pill" href="/login">로그인</Link>
              <Link className="home-pill p" href="/signup">무료 회원가입</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* 사회관계망 계정은 아직 정해지지 않았습니다 — 목적지 없는 링크는 숨기지 않고 「준비 중」으로 보입니다(푸터 규칙). 아이콘은 그림 그대로 */
/* 사회관계망 — [이름, 그림, 설정 키]. 주소는 운영 화면 「사이트 기본 정보」에서 넣습니다(D021 · 설정 sns.*).
 * 주소가 있으면 새 창으로 그 계정에, 비어 있으면 「준비 중」(누를 수 없음)입니다. https 주소만 받습니다(서버 · DB 가 같은 규칙). */
const SNS: [string, string, string][] = [['페이스북', 'sns-1', 'sns.facebook'], ['인스타그램', 'sns-2', 'sns.instagram'], ['엑스', 'sns-3', 'sns.x'], ['유튜브', 'sns-4', 'sns.youtube']];
const snsUrl = (v: string | null | undefined) => (v && /^https:\/\/[^\s]{4,200}$/.test(v) ? v : null);

/* v10.31 — 시안 mxFooter 바로가기: 고객센터 더함 · 「제휴 파트너센터」는 로그인했을 때만 · 「광고 관리」는 운영 역할만(→ 운영 화면) */
const QUICK: [string, string, 0 | 1 | 2][] = [
  ['소개받기', '/request', 0], ['제휴 파트너센터', '/partners', 1], ['안심소개 파트너센터', '/partner', 0],
  ['AI 자동 분류', '/ai/classify', 0], ['AI 추천', '/ai/match', 0], ['성향 분석', '/ai/profile', 0], ['나의공간', '/my', 0],
  ['고객센터', '/support/new', 0], ['광고 관리', '/go/admin', 2],
];

export function HomeFooter({ links, settings, sample, year, loggedIn = false, ops = false }: {
  links: FooterLink[]; settings: Record<string, string | null>; sample: boolean; year: number; loggedIn?: boolean; ops?: boolean;
}) {
  /* v10.31 — 서버 순서 그대로(시안 다섯 · 개발에만 있는 것 순) · 주소 규칙은 common/links */
  const all = links;
  return (
    <footer className="home-ft">
      <div className="home-in">
        <div className="home-ftr">
          <Logo />
          <div className="home-ftl">
            {all.map((l) => l.available ? (
              <Link key={l.label} href={footerHref(l)}>{l.label}</Link>
            ) : (
              <span key={l.label} className="tbd" title={l.tip ?? '준비 중입니다'}>{l.label}</span>
            ))}
          </div>
          <div className="home-ftend">
          <div className="home-sns">
            {SNS.map(([name, pic, key]) => {
              const url = snsUrl(settings[key]);
              return url ? (
                <a key={name} className="home-snsi on" href={url} target="_blank" rel="noopener noreferrer" aria-label={`소개뱅크 ${name} (새 창)`} title={`소개뱅크 ${name}`} data-sns={key}>
                  <Pic name={pic} h={30} />
                </a>
              ) : (
                <span key={name} className="home-snsi" role="img" aria-label={`${name} — 준비 중`} title={`${name} 계정은 준비 중입니다`} data-sns={key}>
                  <Pic name={pic} h={30} />
                </span>
              );
            })}
          </div>
          <span className="home-copy">© {year} 소개뱅크. All rights reserved.</span>
          </div>
        </div>

        <nav className="home-quick" aria-label="바로가기">
          {QUICK.filter(([, , k]) => k === 0 || (k === 1 && loggedIn) || (k === 2 && ops))
            .map(([t, href]) => (href.startsWith('/go/') ? <a key={href} href={href}>{t}</a> : <Link key={href} href={href}>{t}</Link>))}
        </nav>

        {/* 법정 표시 — 공통 푸터(components/Footer.tsx)와 같은 값 · 같은 규칙입니다 */}
        <div className="home-legal">
          <p>
            {settings['footer.ceo_name'] && <>대표 {settings['footer.ceo_name']} · </>}
            {settings['footer.biz_reg_no']
              ? <>사업자등록번호 {settings['footer.biz_reg_no']}</>
              : <span className="tbd" title="오픈 전 입력 필요">사업자등록번호 —</span>}
            {' · '}
            {settings['footer.mail_order_no']
              ? <>통신판매업 신고 {settings['footer.mail_order_no']}</>
              : <span className="tbd" title="C-07 신고 대상 확정. 오픈 차단 항목">통신판매업 신고번호 —</span>}
            {/* v10.31 (합침 · w6 D080) — 직업정보제공사업 신고번호(footer.job_info_no) */}
            {settings['footer.job_info_no'] && <>{' · '}직업정보제공사업 신고번호 {settings['footer.job_info_no']}</>}
          </p>
          {settings['legal.intermediary_notice'] && (
            <p className="home-notice">{(() => {
              const n = settings['legal.intermediary_notice']!;
              const m = n.match(/^(.+?[.。])\s*(.*)$/);
              return m ? <><b>{m[1]}</b>{m[2] ? ' ' + m[2] : ''}</> : <b>{n}</b>;
            })()}</p>
          )}
          <p className="home-artnote">{sample
            ? '메인의 사진 · 순위 · 평점 · 인물은 디자인 예시입니다 — 실제 매물 · 상품 · 후기가 아닙니다. 「이건 어때?」의 참여 수는 실제로 넣은 표 수입니다.'
            : '메인의 그림은 분류를 나타내는 그림입니다 — 실제 매물 · 상품의 사진이 아닙니다.'}</p>
        </div>
      </div>
    </footer>
  );
}

/* v10.31 — 시안 demoBar 「AI 시연」 10칸 중 실제 웹에 화면이 있는 것. 운영 화면 두 칸은 운영 역할에게만(→ /go/admin).
 *   시안의 「서버 연동 (v10.2)」 칸은 시안 안의 시험 화면이라 넣지 않습니다(결정 기록). */
const DEMO: [string, string, string, string, boolean][] = [
  ['/ai/classify', '🧭', 'AI 자동 분류', '등록 글을 관 · 분류 · 등급으로', false],
  ['/ai/match', '🎯', 'AI 추천 결과', '가중치를 만지면 순위가 바뀝니다', false],
  ['/ai/profile', '🧩', '성향 분석', '광고와 추천을 이 값으로 고릅니다', false],
  ['/go/admin', '📣', '광고 관리 (운영)', '슬롯 · 세그먼트 지정', true],
  ['/go/admin', '🛡', 'AI 위험감지 (운영)', '규칙 7종과 오탐 가능성', true],
  ['/search#prompt', '🔎', '프롬프트 검색', '문장을 읽어 후보를 고릅니다', false],
  ['/partner', '🤝', '안심소개 파트너센터', '입점 신청 · 내 매물 · 상담 · 정산', false],
  ['/partners', '📋', '제휴 영업', '파트너가 쓰는 화면', false],
];
export function DemoBar({ ops }: { ops: boolean }) {
  return (
    <section className="home-demo" aria-labelledby="home-demo-h">
      <div className="home-in">
        <div className="home-demob">
          <div className="dbh"><b id="home-demo-h">AI 시연</b><span>규칙 엔진입니다 — 모델 API 를 부르지 않습니다.</span></div>
          <div className="dbg">
            {DEMO.filter((d) => !d[4] || ops).map(([href, em, t, sub]) => (
              href.startsWith('/go/')
                ? <a key={t} className="dbc" href={href}><span className="dbe" aria-hidden="true">{em}</span><b>{t}</b><span className="dbs">{sub}</span></a>
                : <Link key={t} className="dbc" href={href}><span className="dbe" aria-hidden="true">{em}</span><b>{t}</b><span className="dbs">{sub}</span></Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
