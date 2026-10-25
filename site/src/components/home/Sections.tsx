/**
 * SB-HOM-MAIN-010 · 011 — 새 메인(「hero 페이지」 디자인 · v10.13)의 구역들. HomeView(클라이언트) 아래에서 그립니다 — 조회 · 쿠키 같은 서버 전용 기능은 쓰지 않습니다(조회는 page.tsx 가 한 번에).
 *
 * 구역 순서 · 배치 · 색 · 그림은 사장님이 주신 그림(spec/design/hero_page_20261002.png)을 따릅니다.
 *   히어로 → 오늘의 소개뱅크 → 지금, 어떤 소개가 필요하세요? → 오늘의 PICK → 이건 어때? → 띠배너 →
 *   지금 우리동네 → 믿고 연결받는 안심소개 → 최근 뜨는 창업 → 나를 위한 소개 → 소개뱅크 핵심
 *
 * 사진 · 아이콘은 그림에서 그대로 잘라 낸 것입니다(/home/d/*.png). 글자 · 버튼은 화면 요소입니다.
 * 무엇을 넣을지는 content.ts 가 정합니다 — 그림 내용 그대로(sample · 지금 값) / 서버 데이터(live).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
import type { HomeContent, PickCard, RankCard } from './content';
import type { MeSummary } from './types';
import { Line, Pic } from './Icons';
import { PickRail } from './PickRail';
import { PollCards } from './PollCards';
import type { Poll as PollData } from '../community/poll';

/* ── 공용 ─────────────────────────────────────────────────────────── */

/* eslint-disable-next-line @next/next/no-img-element */
const Img = ({ src, alt = '' }: { src: string; alt?: string }) => <img src={`/home/${src}`} alt={alt} loading="lazy" />;
function More({ href }: { href: string }) {
  const t = useTranslations('main');
  return <Link className="home-more" href={href}>{t('sec.more')} <Line name="chev" size={14} w={2.4} /></Link>;
}
/** 그림 속 사진의 꼬리표 자리에 같은 폭으로 글자를 덮습니다(bw). 없으면 글자 길이만큼 */
const Badge = ({ t, tone, bw }: { t: string; tone: string; bw?: number }) =>
  <span className={`home-bdg ${tone}${bw ? ' fit' : ''}`} style={bw ? { width: `${bw}%` } : undefined}>{t}</span>;

/* ── 오늘의 소개뱅크 ─────────────────────────────────────────────────── */

function Rank({ c }: { c: RankCard }) {
  return (
    <article className="home-rk" data-rank={c.k}>
      <div className="home-rkh">
        <span className={`home-bdg ${c.tone}`}>{c.badge}</span>
        <h3>{c.user && <Pic name="rank-user" h={22} />}{c.title}</h3>
      </div>
      <span className="home-rka" aria-hidden="true"><Img src={c.art} /></span>
      {c.rows.length ? (
        <ol className="home-rkl">
          {c.rows.slice(0, 3).map((r, i) => (
            <li key={r.href + i}><Link href={r.href}><i>{i + 1}</i><span>{r.t}</span></Link></li>
          ))}
        </ol>
      ) : (
        <p className="home-rkl none"><Link href={c.empty.href}>{c.empty.t} ›</Link></p>
      )}
    </article>
  );
}

export function Today({ c }: { c: HomeContent }) {
  const t = useTranslations('main');
  return (
    <section className="home-band today" aria-labelledby="home-today-h">
      <div className="home-in">
        <div className="home-sh">
          <Pic name="sec-today" h={36} />
          <h2 id="home-today-h">{t('sec.today.h')}</h2>
          <span className="home-sd">{c.todaySub}</span>
          <More href={c.todayMore} />
        </div>
        <div className="home-today">
          {/* 큰 배너 — 그림의 배너를 그대로 깔고, 글자 자리에 같은 글을 화면 요소로 덮습니다(선명하게 · 누를 수 있게) */}
          <div className="home-bn">
            <Img src="d/banner.png" />
            <div className="home-bnc">
              <span className="home-hot"><Pic name="flame" h={22} /> {t('sec.today.hot')}</span>
              <h3>{c.banner.title[0]}<br />{c.banner.title[1]}</h3>
              <p>{c.banner.desc[0]}<br />{c.banner.desc[1]}</p>
              <Link className="home-dark" href={c.banner.href}>{t('sec.today.go')} <Line name="arrow" size={18} w={2.4} /></Link>
            </div>
          </div>
          <div className="home-rks3">{c.ranks.map((r) => <Rank key={r.k} c={r} />)}</div>
        </div>
      </div>
    </section>
  );
}

/* ── 지금, 어떤 소개가 필요하세요? — 관 5곳 ───────────────────────────── */

/* 글(t · d1 · d2)은 사전 main.sec.needs.cards.<gwan> */
const NEEDS: { gwan: 'HLT' | 'MNY' | 'MAL' | 'BIZ' | 'CMU'; ic: string; href: string }[] = [
  { gwan: 'HLT', ic: 'need-1', href: '/health' },
  { gwan: 'MNY', ic: 'need-2', href: '/money' },
  { gwan: 'MAL', ic: 'need-3', href: '/mall' },
  { gwan: 'BIZ', ic: 'need-4', href: '/biz' },
  { gwan: 'CMU', ic: 'need-5', href: '/community' },
];

/** 중지된 관은 뺍니다(20260930 규칙). 소개광장은 관이 아니라 늘 둡니다. */
export function Needs({ live }: { live: string[] }) {
  const t = useTranslations('main');
  const cards = NEEDS.filter((c) => c.gwan === 'CMU' || live.includes(c.gwan));
  return (
    <section className="home-band needs" aria-labelledby="home-needs-h">
      <div className="home-in">
        <div className="home-sh">
          <Pic name="sec-need" h={36} />
          <h2 id="home-needs-h">{t('sec.needs.h')}</h2>
          <span className="home-sd">{t('sec.needs.sub')}</span>
        </div>
        <nav className="home-needs" aria-label={t('sec.needs.aria')} style={{ ['--n' as string]: cards.length }}>
          {cards.map((c) => (
            <Link key={c.gwan} className="home-nd" href={c.href} data-gwan={c.gwan}>
              <Pic name={c.ic} h={50} />
              <b>{t(`sec.needs.cards.${c.gwan}.t`)}</b>
              <span>{t(`sec.needs.cards.${c.gwan}.d1`)}{' '}<br />{t(`sec.needs.cards.${c.gwan}.d2`)}</span>
              <i aria-hidden="true"><Line name="chev" size={18} w={2.4} /></i>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}

/* ── 오늘의 PICK ─────────────────────────────────────────────────────── */

function PickItem({ c }: { c: PickCard }) {
  return (
    <Link className="home-pk" href={c.href} role="listitem" data-kind={c.kind}>
      <span className="home-pki"><Img src={c.img} /><Badge t={c.badge} tone={c.tone} bw={c.bw} /></span>
      <span className="home-pkb">
        <span className={`home-kind ${c.tone}`}>{c.kind}</span>
        <b>{c.title}</b>
        {c.strong && <strong>{c.strong}{c.off && <em className="home-off">{c.off}</em>}</strong>}
        {c.sub && <span className="home-pks">{c.sub}</span>}
        {c.rate && <span className="home-pkm home-rate"><Pic name="star" h={15} /> {c.rate}</span>}
        {c.meta && <span className="home-pkm">{c.meta}</span>}
      </span>
    </Link>
  );
}

export function Picks({ c }: { c: HomeContent }) {
  const t = useTranslations('main');
  if (!c.picks.length) return null;
  return (
    <section className="home-band picks" aria-labelledby="home-picks-h">
      <div className="home-in">
        <div className="home-sh">
          <Pic name="sec-pick" h={36} />
          <h2 id="home-picks-h">{t('sec.picks.h')}</h2>
          <span className="home-sd">{c.picksSub}</span>
          <More href={c.picksMore} />
        </div>
        <PickRail label={t('sec.picks.h')} more={c.picksMore}>
          {c.picks.map((p) => <PickItem key={p.kind + p.key} c={p} />)}
        </PickRail>
      </div>
    </section>
  );
}

/* ── 이건 어때? ─────────────────────────────────────────────────────── */

/**
 * 세 장은 PollCards 가 그립니다 — 실제 투표(D021). 그 종류의 투표가 없으면 그림의 문구로 「준비 중」.
 * 참여 수는 서버의 실제 표 수만 씁니다.
 */
export function Poll({ polls }: { polls: PollData[] }) {
  const t = useTranslations('main');
  return (
    <section className="home-band poll" aria-labelledby="home-poll-h">
      <div className="home-in">
        <div className="home-sh">
          <Pic name="sec-poll" h={36} />
          <h2 id="home-poll-h">{t('sec.poll.h')}</h2>
          <span className="home-sd">{t('sec.poll.sub')}</span>
          {polls.length === 0 && <span className="home-ex">{t('sec.soon')}</span>}
          <More href="/community/polls" />
        </div>
        <PollCards polls={polls} />
      </div>
    </section>
  );
}

/* ── 띠배너 ─────────────────────────────────────────────────────────── */

export function Strip({ c }: { c: HomeContent }) {
  const t = useTranslations('main');
  return (
    <div className="home-band strip">
      <div className="home-in">
        <Link className="home-strip" href="/community">
          <span className="home-stl" aria-hidden="true"><Img src="d/strip-left.png" /></span>
          <span className="home-stc">
            <span className="home-sttag">{t('sec.strip.tag')}</span>
            <b>{t.rich('sec.strip.title', { em: (x) => <em>{x}</em> })}</b>
            <span>{c.stripSub}</span>
          </span>
          <span className="home-stleaf" aria-hidden="true"><Img src="d/leaf-1.png" /><Img src="d/leaf-2.png" /></span>
          <span className="home-stb">{t('sec.strip.go')} <Line name="arrow" size={18} w={2.4} /></span>
          <span className="home-str" aria-hidden="true"><Img src="d/strip-right.png" /></span>
        </Link>
      </div>
    </div>
  );
}

/* ── 지금 우리동네 ───────────────────────────────────────────────────── */

export function Town({ c }: { c: HomeContent }) {
  const tr = useTranslations('main');
  return (
    <section className="home-band town" aria-labelledby="home-town-h">
      <div className="home-in">
        <div className="home-sh">
          <Pic name="sec-town" h={36} />
          <h2 id="home-town-h">{tr('sec.town.h')}</h2>
          <span className="home-sd pin"><Pic name="town-pin" h={24} /> {tr('sec.town.sub')}</span>
          {!c.townReady && <span className="home-ex">{tr('sec.soon')}</span>}
          <More href="/community" />
        </div>
        <div className="home-towns">
          {c.towns.map((t) => (
            <Link key={t.tag} className="home-tw" href={t.href}>
              <span className="home-twi" aria-hidden="true"><Img src={t.img} /></span>
              <span className="home-twb">
                <span className="home-bdg sky">{t.tag}</span>
                <b>{t.t}</b>
                <span>{t.d[0]}<br />{t.d[1]}</span>
              </span>
              <span className="home-twl"><Line name="pin" size={15} /> {t.loc ?? tr('sec.town.noLoc')} <Line name="chev" size={15} w={2.4} /></span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 믿고 연결받는 안심소개 ───────────────────────────────────────────── */

export function Trust({ c }: { c: HomeContent }) {
  const tr = useTranslations('main');
  return (
    <section className="home-band trust" aria-labelledby="home-trust-h">
      <div className="home-in">
        <div className="home-sh">
          <Pic name="sec-trust" h={36} />
          <h2 id="home-trust-h">{tr('sec.trust.h')}</h2>
          <span className="home-sd">{tr('sec.trust.sub')}</span>
          <More href="/mall" />
        </div>
        <div className="home-trusts">
          {c.trusts.map((t) => (
            <Link key={t.t} className="home-tr" href={t.href}>
              <span className="home-tri"><Pic name={t.img} h={72} /></span>
              <span className="home-trb">
                <b>{t.t}</b>
                <span>{t.d[0]}{t.d[1] && <><br />{t.d[1]}</>}</span>
                <em>{tr('sec.trust.go')} <Line name="arrow" size={16} w={2.4} /></em>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 최근 뜨는 창업 ──────────────────────────────────────────────────── */

export function Startup({ c }: { c: HomeContent }) {
  const t = useTranslations('main');
  return (
    <section className="home-band startup" aria-labelledby="home-startup-h">
      <div className="home-in">
        <div className="home-sh">
          <Pic name="sec-startup" h={36} />
          <h2 id="home-startup-h">{t('sec.startup.h')}</h2>
          <span className="home-sd">{t('sec.startup.sub')}</span>
          <More href="/biz" />
        </div>
        {c.starts.length ? (
          <div className="home-starts">
            {c.starts.map((x) => (
              <Link key={x.key} className="home-st" href={x.href}>
                <span className="home-sti"><Img src={x.img} /><Badge t={x.badge} tone={x.tone} bw={x.bw} /></span>
                <b>{x.title}</b>
                <span>{x.sub}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="home-none">{t('sec.startup.none')} <Link href="/biz">{t('sec.startup.go')}</Link></p>
        )}
      </div>
    </section>
  );
}

/* ── 나를 위한 소개 ───────────────────────────────────────────────── */

export function ForMe({ loggedIn, summary }: { loggedIn: boolean; summary: MeSummary | null }) {
  const t = useTranslations('main');
  const f = useFmt();
  return (
    <section className="home-band forme" aria-labelledby="home-forme-h">
      <div className="home-in">
        <div className="home-forme">
          <Pic name="sec-forme" h={38} />
          <h2 id="home-forme-h">{t('sec.forme.h')}</h2>
          <span className="home-sd">{loggedIn ? t('sec.forme.subIn') : t('sec.forme.subOut')}</span>
          {loggedIn && summary && (
            <span className="home-fmi">
              <Link href="/my/notifications">{t('sec.forme.notif')} <em>{f.num(summary.unreadNotifications)}</em></Link>
              <Link href="/my/listings">{t('sec.forme.listings')} <em>{f.num(summary.publishedListings)}</em></Link>
              <Link href="/my/deals">{t('sec.forme.deals')} <em>{f.num(summary.openDeals)}</em></Link>
            </span>
          )}
          <span className="home-fma">
            {loggedIn ? (
              <Link className="home-pill p" href="/ai/profile" data-forme="profile">{t('sec.forme.profile')}</Link>
            ) : (
              <>
                <Link className="home-pill" href="/login" data-forme="login">{t('sec.forme.login')}</Link>
                <Link className="home-pill p" href="/signup" data-forme="signup">{t('sec.forme.signup')}</Link>
              </>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── 소개뱅크 핵심 ────────────────────────────────────────────────── */

/* [그림, 사전 키(main.sec.core.items.<키>.t · .d), 주소] */
const CORE: [string, 'c1' | 'c2' | 'c3' | 'c4', string][] = [
  ['core-1', 'c1', '#home-q'],
  ['core-2', 'c2', '/ai/match'],
  ['core-3', 'c3', '/mall'],
  ['core-4', 'c4', '/request'],
];

export function Core() {
  const tr = useTranslations('main');
  return (
    <section className="home-band core" aria-labelledby="home-core-h">
      <div className="home-in">
        <div className="home-cores">
          <div className="home-coreh"><Pic name="sec-core" h={36} /><h2 id="home-core-h">{tr('sec.core.h')}</h2></div>
          {CORE.map(([ic, k, href]) => {
            const t = tr(`sec.core.items.${k}.t`), d = tr(`sec.core.items.${k}.d`);
            const body = <><Pic name={ic} h={40} /><span><b>{t}</b><span>{d}</span></span></>;
            return href.startsWith('#')
              ? <a key={t} className="home-core" href={href}>{body}</a>
              : <Link key={t} className="home-core" href={href}>{body}</Link>;
          })}
        </div>
      </div>
    </section>
  );
}
