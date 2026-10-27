/**
 * v10.29 — 관 화면 시안 부품(서버 컴포넌트). 시안 proto_lite.html 의 같은 이름 함수를 옮겼습니다.
 *   SearchRow(search(true, promo)) · RoleTabs(roleTab) · QuickMenu(quickMenu) · QuickHead(퀵메뉴 화면 머리 .qrow)
 *   GwSide(왼쪽: 지역 설정 · gradeSide · 내 목록 · 등록) · Features(features) · Pager(pgBar) · CatEmpty(catEmpty)
 * 클래스는 모두 gw- 접두어(styles/proto-gwan.css).
 */
import { Fragment } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SearchBox } from '@/components/search/SearchBox';
import { FEATS, GRADES, GW, QM, qhref, type GwanCode } from './gw';
import { RegionPanel } from './GwClient';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export interface GwCategory { id: string; name: string; gradeCode: string | null; gwanCode?: string }

/** 시안 farmAside() — 검색줄 오른쪽 띠 광고(스마트팜). 그림은 시안 원본(EMBEDDED_IMG/promo-farm.png). */
export function FarmPromo() {
  const t = useTranslations('gwan.promo');
  return (
    <aside className="gw-spromo gw-farm gw-img">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/proto-img/gwan/promo-farm.png" width={384} height={100} alt={t('farmAlt')} />
    </aside>
  );
}

/** 시안 search(true, true) 의 오른쪽 칸 — 상세 · 목록 화면의 「소개로 수익을 만드는 사람들!」 */
export function EarnPromo() {
  const t = useTranslations('gwan.promo');
  return (
    <aside className="gw-spromo">
      <div className="gw-ptx"><div className="gw-pt2">{t.rich('earnTitle', { br: () => <br /> })}</div><div className="gw-pd">{t.rich('earnDesc', { br: () => <br /> })}</div></div>
      <svg className="gw-pi" viewBox="0 0 120 66" aria-hidden="true">
        <path d="M6 58 L34 34 L54 46 L84 18 L110 30" stroke="#34D399" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M100 16 L112 14 L112 26" stroke="#34D399" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {([[18, 60], [46, 52], [74, 44]] as [number, number][]).map(([x, y]) => (
          <g key={x}><ellipse cx={x} cy={y} rx="9" ry="3" fill="#FBBF24" /><ellipse cx={x} cy={y - 4} rx="9" ry="3" fill="#FCD34D" /><ellipse cx={x} cy={y - 8} rx="9" ry="3" fill="#FDE68A" /></g>
        ))}
        <circle cx="98" cy="46" r="8" fill="#93C5FD" /><path d="M90 62c1-6 4-9 8-9s7 3 8 9Z" fill="#3B82F6" />
      </svg>
    </aside>
  );
}

/** 시안 사고예방 화면의 오른쪽 칸 — 「안전한 거래가 신뢰를 만들고 …」 */
export function SafePromo() {
  const t = useTranslations('gwan.promo');
  return (
    <aside className="gw-spromo gw-safe">
      <div className="gw-ptx">
        <div className="gw-sft">{t.rich('safeTitle', { br: () => <br /> })}</div>
        <div className="gw-sfd">{t('safeDesc')}</div>
        <Link className="gw-sfb" href="/safety/guide">{t('safeMore')}</Link>
      </div>
      <div className="gw-sfi">
        <svg viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="120" height="150" fill="#DDE7FA" /><path d="M60 26 L92 38 v34c0 24-14 38-32 46-18-8-32-22-32-46V38Z" fill="#1E3A8A" />
          <rect x="48" y="66" width="24" height="20" rx="3" fill="#EEF3FE" /><path d="M53 66v-6a7 7 0 0 1 14 0v6" stroke="#EEF3FE" strokeWidth="3" fill="none" />
          <circle cx="60" cy="76" r="3" fill="#1E3A8A" /><circle cx="22" cy="122" r="8" fill="#93B4E8" /><circle cx="98" cy="122" r="8" fill="#93B4E8" />
          <path d="M10 142c0-8 5-12 12-12s12 4 12 12Z" fill="#5A85CE" /><path d="M86 142c0-8 5-12 12-12s12 4 12 12Z" fill="#5A85CE" />
        </svg>
      </div>
    </aside>
  );
}

/** 검색줄 — 공통 부품(SearchBox · 묶음 common)에 관 코드와 오른쪽 칸만 넘깁니다(시안 search(blue, promo)). */
export function SearchRow({ code, aside }: { code: GwanCode; aside?: React.ReactNode }) {
  return (
    <div className="gw-topcol">
      <SearchBox variant="gwan" gwanCode={code} blue aside={aside ?? <FarmPromo />} />
    </div>
  );
}

/**
 * 시안 roleTab — 소개하기 · 소개받고 싶어요 · 소개받기 (소개장터만 · 10/2 결정으로 안심소개 · 소개창업은 뺌).
 *   소개하기 → /register(소개 등록) · 소개받고 싶어요 → /request/new(필요한 것 올리기) · 소개받기 → /request(요청 목록).
 *   ※ 시안은 「소개받고 싶어요」가 사업 기회 등록(regb)으로 가 있어 실제 웹 뜻에 맞게 요청 등록으로 보냅니다(diffs 시안결함).
 */
export function RoleTabs({ on = 'give', note }: { on?: 'give' | 'want' | 'get'; note?: string }) {
  const t = useTranslations('gwan.role');
  return (
    <div>
      <div className="gw-tabs">
        <Link className={`gw-tab${on === 'give' ? ' gw-on' : ''}`} href="/register">{t('give')}</Link>
        <Link className={`gw-tab${on === 'want' ? ' gw-on' : ''}`} href="/request/new">{t('want')}</Link>
        <Link className={`gw-tab${on === 'get' ? ' gw-on' : ''}`} href="/request">{t('get')}</Link>
      </div>
      <div className="gw-tabnote">{note ?? t('note')}</div>
    </div>
  );
}

/** 시안 quickMenu — 퀵메뉴 5칸(소개장터) */
export function QuickMenu({ active }: { active?: string }) {
  const t = useTranslations('gwan.qm');
  return (
    <nav className="gw-qmenu" aria-label={t('aria')}>
      {QM.map((q) => (
        <Link key={q.key} href={q.href} className={active === q.key ? 'gw-on' : undefined}
              aria-current={active === q.key ? 'page' : undefined} data-qm={q.key}>
          <span className="gw-qe">{q.em}</span>{t(q.key)}
        </Link>
      ))}
    </nav>
  );
}

/** 퀵메뉴 화면의 머리(시안 .rrow.qrow.noq — 큰 제목 · 설명 + 퀵메뉴) */
export function QuickHead({ title, sub, active }: { title: string; sub: string; active: string }) {
  return (
    <div className="gw-rrow gw-qrow gw-noq">
      <div className="gw-qmain">
        <div className="gw-whd"><h2>{title}</h2><span className="gw-sub">{sub}</span></div>
        <QuickMenu active={active} />
      </div>
    </div>
  );
}

/**
 * 왼쪽 칸 — 지역 설정 · 상품 분류(골든 · 실버 · 브론즈 — categories.gradeCode) · 내 목록 · 등록.
 * 분류를 누르면 그 관 첫 화면이 그 분류로 걸러집니다(?cat=). 다시 누르면 풉니다(시안 data-cat 토글).
 */
export function GwSide({ code, cats, cat, extra, register, regions, region }: {
  code: GwanCode; cats: GwCategory[]; cat?: string; extra?: React.ReactNode;
  register?: { href: string; label: string; role?: string }[];
  /** v10.31 — 지역 설정 칸의 시 · 도(GET /market/regions)와 지금 고른 지역 */
  regions?: { code: string; name: string }[]; region?: string;
}) {
  const g = GW[code];
  const t = useTranslations('gwan');
  const groups = GRADES.map((gr) => ({ gr, items: cats.filter((c) => c.gradeCode === gr.code) }));
  const etc = cats.filter((c) => !GRADES.some((gr) => gr.code === c.gradeCode));
  const link = (c: GwCategory) => (
    <Link key={c.id} className={`gw-gi${cat === c.id ? ' gw-on' : ''}`} href={qhref(`/${g.path}`, { cat: cat === c.id ? undefined : c.id })} data-cat={c.id}>
      {c.name}<span className="gw-cx">›</span>
    </Link>
  );
  const reg = register ?? [{ href: code === 'BIZ' ? '/biz/register' : '/register', label: code === 'BIZ' ? t('side.registerBiz') : t('side.registerGive') }];
  return (
    <aside className="gw-side">
      <RegionPanel regions={regions} current={region} />
      {extra ?? (
        <div>
          <div className="gw-cathd">{t('side.catHead')}</div>
          <nav className="gw-catl" aria-label={t('side.catAria')}>
            {/* v10.32 — 시안처럼 골든 · 실버 · 브론즈 세 묶음을 늘 보입니다. 묶음은 서버 분류 자료(categories.gradeCode — 운영 화면 「분류」에서 정함) 그대로이고,
                그 등급에 든 분류가 없으면 빈 줄로 알립니다(지어서 채우지 않음) */}
            {cats.length > 0 && groups.map(({ gr, items }) => (
              <Fragment key={gr.code}>
                <div className={`gw-gd gw-${gr.k}`} data-grade={gr.code}><span className="gw-em2">{gr.em}</span>{t(`grade.${gr.code}.nm`)}<span className="gw-gsub">({t(`grade.${gr.code}.sub`)})</span></div>
                {items.length ? items.map(link) : <div className="gw-gi gw-gempty" data-grade-empty={gr.code}>{t('side.gradeEmpty')}</div>}
              </Fragment>
            ))}
            {etc.length > 0 && (
              <>
                <div className="gw-gd gw-g4"><span className="gw-em2">⋯</span>{t('side.etc')}</div>
                {etc.map(link)}
              </>
            )}
            {cats.length === 0 && <div className="gw-etcnote">{t('side.catFail')}</div>}
            <div className="gw-etcnote">{withCodes(t.rich('side.gradeNote', { b: (c) => <b>{c}</b> }))}</div>
          </nav>
        </div>
      )}
      <Link className="gw-mylist" href="/my/listings">{t('side.mine', { mine: t(`meta.${code}.mine`) })}</Link>
      {reg.map((r) => <Link key={r.href + r.label} className="gw-mylist" href={r.href} data-role={r.role}>{r.label}</Link>)}
    </aside>
  );
}

/** 시안 features() — 아래 안내 6칸 */
export function Features() {
  const tr = useTranslations('gwan.feats');
  return (
    <div className="gw-feat">
      {FEATS.map((k) => (
        <div key={k} className="gw-fi">
          <span className="gw-ic">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              <path d="m8.5 12 2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div><div className="gw-t">{tr(`${k}.t`)}</div><div className="gw-d">{tr(`${k}.d`)}</div></div>
        </div>
      ))}
    </div>
  );
}

/**
 * 시안 pgBar — 왼쪽 건수 · 가운데 쪽 단추 · 오른쪽 정렬.
 * v10.31 — 서버가 건수(total)를 주면(page 모드) 시안처럼 쪽 번호 「‹ 1 2 3 … ›」을 다 그립니다(주소 ?p=).
 *   건수를 모르면(커서 모드 · 옛 주소 ?cursor=) 전처럼 ‹ 첫 쪽 · 지금 쪽 · 다음 쪽 › 입니다.
 */
export function Pager({ left, base, keep, page, next, right, pageCount, hash = '' }: {
  left?: React.ReactNode; base: string; keep: Record<string, string | undefined>;
  page: number; next: string | null; right?: React.ReactNode; pageCount?: number; hash?: string;
}) {
  const t = useTranslations('gwan.pager');
  const first = qhref(base, { ...keep, cursor: undefined, p: undefined }) + hash;
  if (pageCount != null) {
    const at = (n: number) => qhref(base, { ...keep, cursor: undefined, p: n > 1 ? String(n) : undefined }) + hash;
    const from = Math.max(1, Math.min(page - 4, pageCount - 9)), to = Math.min(pageCount, from + 9);
    const nums: number[] = []; for (let i = from; i <= to; i++) nums.push(i);
    return (
      <div className="gw-pgw">
        {left ?? <span />}
        <div className="gw-pager" data-pages={pageCount}>
          {page > 1 ? <Link href={at(page - 1)} title={t('prev')}>‹</Link> : <button type="button" className="gw-off" disabled title={t('atFirst')}>‹</button>}
          {nums.map((n) => n === page
            ? <span key={n} className="gw-on" aria-current="page">{n}</span>
            : <Link key={n} href={at(n)}>{n}</Link>)}
          {page < pageCount ? <Link href={at(page + 1)} title={t('next')}>›</Link> : <button type="button" className="gw-off" disabled title={t('atLast')}>›</button>}
        </div>
        {right}
      </div>
    );
  }
  return (
    <div className="gw-pgw">
      {left ?? <span />}
      <div className="gw-pager">
        {page > 1 ? <Link href={first} title={t('first')}>‹</Link> : <button type="button" className="gw-off" disabled title={t('atFirst')}>‹</button>}
        <span className="gw-on" aria-current="page">{page}</span>
        {next ? <Link href={qhref(base, { ...keep, cursor: next, p: String(page + 1) }) + hash} title={t('next')}>›</Link>
              : <button type="button" className="gw-off" disabled title={t('atLast')}>›</button>}
      </div>
      {right}
    </div>
  );
}

/** 시안 catEmpty — 고른 조건에 건이 없을 때 */
export function CatEmpty({ what, clearHref }: { what: string; clearHref: string }) {
  const t = useTranslations('gwan.empty');
  return (
    <div className="gw-catnone">
      <div className="gw-cnt2">🗂</div>
      <div className="gw-cnh">{t.rich('head', { what, b: (c) => <b>{c}</b> })}</div>
      <div className="gw-cnb">{t('body')}</div>
      <Link className="gw-cnb2" href={clearHref}>{t('back')}</Link>
    </div>
  );
}

/** 바깥 틀 — .gw(시안 변수 · 글꼴) + .gw-gwl(관 색) */
export function GwFrame({ code, children }: { code?: GwanCode; children: React.ReactNode }) {
  const cls = code ? GW[code].cls : '';
  return (
    <div className="gw" data-gw={code ?? ''}>
      <div className={`gw-gwl${cls ? ` gw-${cls}` : ''}`}>{children}</div>
    </div>
  );
}
