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
import { useLocale, useTranslations } from 'next-intl';
import { LangAuto } from '@/i18n/LangAuto';
import { isGwanKey } from '@/i18n/keys';

export function Logo() {
  const h = useTranslations('header');
  return (
    <Link href="/" className="home-logo" aria-label={h('logoHome')}>
      <Pic name="logo" h={48} alt={h('brand')} />
    </Link>
  );
}

/**
 * v10.31 — 로그인 뒤 오른쪽: 시안 「🔍 · 👤 이름 · 나의공간 · 로그아웃 · 관리자 페이지(운영 역할만)」.
 *   개발에만 있던 「소개받기」 단추는 남겨 둡니다(지시 ③ — 시안 모양 안에 · 옅게).
 */
export function HomeHeader({ gwans, loggedIn, summary }: { gwans: Gwan[]; loggedIn: boolean; summary?: MeSummary | null }) {
  const name = summary?.displayName?.trim() || null;
  const h = useTranslations('header');
  const locale = useLocale();
  return (
    <header className="home-hd">
      <div className="home-in">
        <Logo />
        <nav className="home-nav" aria-label={h('mainMenu')}>
          {/* 주소가 없는 관(허브 EARN 등)과 중지된 관은 뺍니다 — 공통 헤더와 같은 규칙 */}
          {gwans.filter((g) => g.isActive !== false && GWAN_PATH[g.code]).map((g) => (
            <Link key={g.code} href={`/${GWAN_PATH[g.code]}`}>{locale !== 'ko' && isGwanKey(g.code) ? h(`gwan.${g.code}`) : g.name}</Link>
          ))}
          <Link href="/community">{h('community')}</Link>
          <Link href="/guide">{h('guide')}</Link>
        </nav>
        <div className="home-hdr">
          {/* v10.40 — 시안: 머리줄 돋보기는 히어로 검색칸으로 가서 검색 팝업을 엽니다(HeroSearch 가 #home-q 를 받음 · 전: 결과 화면 링크) */}
          <LangAuto />
          <Link className="home-icbtn" href="#home-q" aria-label={h('search')}><Line name="search" size={22} w={2.4} /></Link>
          {loggedIn ? (
            <>
              <span className="home-who" title={name ?? undefined}>👤 {name ? (name.length > 10 ? name.slice(0, 10) + '…' : name) : h('member')}</span>
              <Link className="home-pill" href="/my">{h('my')}</Link>
              <Link className="home-pill dev" href="/request">{h('request')}</Link>
              <HomeLogout />
              {isOps(summary?.principal?.roles) && <a className="home-pill p" href="/go/admin">{h('admin')}</a>}
            </>
          ) : (
            <>
              <Link className="home-pill" href="/login">{h('login')}</Link>
              <Link className="home-pill p" href="/signup">{h('signup')}</Link>
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
/* v10.95 — 이름은 사전 키(b2.sns.*) */
const SNS: ['facebook' | 'instagram' | 'x' | 'youtube', string, string][] = [['facebook', 'sns-1', 'sns.facebook'], ['instagram', 'sns-2', 'sns.instagram'], ['x', 'sns-3', 'sns.x'], ['youtube', 'sns-4', 'sns.youtube']];
const snsUrl = (v: string | null | undefined) => (v && /^https:\/\/[^\s]{4,200}$/.test(v) ? v : null);

/* v10.31 — 시안 mxFooter 바로가기: 고객센터 더함 · 「제휴 파트너센터」는 로그인했을 때만 · 「광고 관리」는 운영 역할만(→ 운영 화면) */
const QUICK: ['request' | 'affPartners' | 'ansimPartner' | 'aiClassify' | 'aiMatch' | 'aiProfile' | 'my' | 'support' | 'ads', string, 0 | 1 | 2][] = [
  /* v10.95 — 글자는 사전 키(home.quick.*) */
  ['request', '/request', 0], ['affPartners', '/partners', 1], ['ansimPartner', '/partner', 0],
  ['aiClassify', '/ai/classify', 0], ['aiMatch', '/ai/match', 0], ['aiProfile', '/ai/profile', 0], ['my', '/my', 0],
  ['support', '/support/new', 0], ['ads', '/go/admin', 2],
];

export function HomeFooter({ links, settings, sample, year, loggedIn = false, ops = false }: {
  links: FooterLink[]; settings: Record<string, string | null>; sample: boolean; year: number; loggedIn?: boolean; ops?: boolean;
}) {
  /* v10.31 — 서버 순서 그대로(시안 다섯 · 개발에만 있는 것 순) · 주소 규칙은 common/links */
  const all = links;
  const t = useTranslations('home');
  const b = useTranslations('b2');
  return (
    <footer className="home-ft">
      <div className="home-in">
        <div className="home-ftr">
          <Logo />
          <div className="home-ftl">
            {all.map((l, i) => l.available ? (
              <Link key={`${l.section}-${i}`} href={footerHref(l)}>{l.label}</Link>
            ) : (
              <span key={`${l.section}-${i}`} className="tbd" title={l.tip ?? b('preparing')}>{l.label}</span>
            ))}
          </div>
          <div className="home-ftend">
          <div className="home-sns">
            {SNS.map(([name, pic, key]) => {
              const url = snsUrl(settings[key]);
              return url ? (
                <a key={name} className="home-snsi on" href={url} target="_blank" rel="noopener noreferrer" aria-label={b('snsOpen', { name: b(`sns.${name}`) })} title={b('snsTitle', { name: b(`sns.${name}`) })} data-sns={key}>
                  <Pic name={pic} h={30} />
                </a>
              ) : (
                <span key={name} className="home-snsi" role="img" aria-label={b('snsSoonLabel', { name: b(`sns.${name}`) })} title={b('snsSoonTitle', { name: b(`sns.${name}`) })} data-sns={key}>
                  <Pic name={pic} h={30} />
                </span>
              );
            })}
          </div>
          <span className="home-copy">© {b('copyright', { year })}</span>
          </div>
        </div>

        <nav className="home-quick" aria-label={b('quickLabel')}>
          {QUICK.filter(([, , k]) => k === 0 || (k === 1 && loggedIn) || (k === 2 && ops))
            .map(([k, href]) => (href.startsWith('/go/') ? <a key={href} href={href}>{t(`quick.${k}`)}</a> : <Link key={href} href={href}>{t(`quick.${k}`)}</Link>))}
        </nav>

        {/* 법정 표시 — 공통 푸터(components/Footer.tsx)와 같은 값 · 같은 규칙입니다 */}
        <div className="home-legal">
          <p>
            {settings['footer.ceo_name'] && <>{b('ceo')} {settings['footer.ceo_name']} · </>}
            {settings['footer.biz_reg_no']
              ? <>{b('bizRegNo')} {settings['footer.biz_reg_no']}</>
              : <span className="tbd" title={b('tipNeeded')}>{b('bizRegNo')} —</span>}
            {' · '}
            {settings['footer.mail_order_no']
              ? <>{b('mailOrder')} {settings['footer.mail_order_no']}</>
              : <span className="tbd" title={b('tipMailOrder')}>{b('mailOrderNo')} —</span>}
            {/* v10.31 (합침 · w6 D080) — 직업정보제공사업 신고번호(footer.job_info_no) */}
            {settings['footer.job_info_no'] && <>{' · '}{b('jobInfoNo')} {settings['footer.job_info_no']}</>}
          </p>
          {settings['legal.intermediary_notice'] && (
            <p className="home-notice">{(() => {
              const n = settings['legal.intermediary_notice']!;
              const m = n.match(/^(.+?[.。])\s*(.*)$/);
              return m ? <><b>{m[1]}</b>{m[2] ? ' ' + m[2] : ''}</> : <b>{n}</b>;
            })()}</p>
          )}
          <p className="home-artnote">{sample ? t('artnoteSample') : t('artnoteLive')}</p>
        </div>
      </div>
    </footer>
  );
}

/* v10.31 — 시안 demoBar 「AI 시연」 10칸 중 실제 웹에 화면이 있는 것. 운영 화면 두 칸은 운영 역할에게만(→ /go/admin).
 *   시안의 「서버 연동 (v10.2)」 칸은 시안 안의 시험 화면이라 넣지 않습니다(결정 기록). */
/* v10.95 — 글자는 사전 키(home.demo.<키>.t · .s) */
const DEMO: [string, string, 'classify' | 'match' | 'profile' | 'ads' | 'risk' | 'prompt' | 'ansimPartner' | 'affSales', boolean][] = [
  ['/ai/classify', '🧭', 'classify', false],
  ['/ai/match', '🎯', 'match', false],
  ['/ai/profile', '🧩', 'profile', false],
  ['/go/admin', '📣', 'ads', true],
  ['/go/admin', '🛡', 'risk', true],
  ['/search#prompt', '🔎', 'prompt', false],
  ['/partner', '🤝', 'ansimPartner', false],
  ['/partners', '📋', 'affSales', false],
];
export function DemoBar({ ops }: { ops: boolean }) {
  const t = useTranslations('home');
  return (
    <section className="home-demo" aria-labelledby="home-demo-h">
      <div className="home-in">
        <div className="home-demob">
          <div className="dbh"><b id="home-demo-h">{t('demoTitle')}</b><span>{t('demoSub')}</span></div>
          <div className="dbg">
            {DEMO.filter((d) => !d[3] || ops).map(([href, em, k]) => (
              href.startsWith('/go/')
                ? <a key={k} className="dbc" href={href}><span className="dbe" aria-hidden="true">{em}</span><b>{t(`demo.${k}.t`)}</b><span className="dbs">{t(`demo.${k}.s`)}</span></a>
                : <Link key={k} className="dbc" href={href}><span className="dbe" aria-hidden="true">{em}</span><b>{t(`demo.${k}.t`)}</b><span className="dbs">{t(`demo.${k}.s`)}</span></Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
