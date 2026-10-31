import { useEffect, useState } from 'react';
import { loadCodes } from './lib/codes';
import { api, hasToken, onAuthChange, setToken, tokenRoles } from './lib/api';
import { Login } from './components/Login';
import { Dashboard } from './app/admin/Dashboard';
import { ReviewQueue } from './app/admin/ReviewQueue';
import { ReviewDecide } from './app/admin/ReviewDecide';
import { AutoReviewRules } from './app/admin/AutoReviewRules';
import { Badges } from './app/admin/Badges';
import { Disputes } from './app/admin/Disputes';
import { AuditSamples } from './app/admin/AuditSamples';
import { CodeLabels } from './app/admin/CodeLabels';
import { Policies } from './app/admin/Policies';
import { Integrations } from './app/admin/Integrations';
import { Categories } from './app/admin/Categories';
import { Users } from './app/admin/Users';
import { Deals } from './app/admin/Deals';
import { Settlements } from './app/admin/Settlements';
import { Billing } from './app/admin/Billing';
import { OpenChecklist } from './app/admin/OpenChecklist';
import { SiteInfo } from './app/admin/SiteInfo';
import { TermsPanel } from './app/admin/TermsPanel';
import { Partners } from './app/admin/Partners';
import { PartnerAxes } from './app/admin/PartnerAxes';
import { DirectoryAdmin } from './app/admin/DirectoryAdmin';
import { RiskAlerts } from './app/admin/RiskAlerts';
import { Ads } from './app/admin/Ads';
import { Gwans } from './app/admin/Gwans';
import { MainOps } from './app/admin/MainOps';
import { Qualifications } from './app/admin/Qualifications';
import { Hub } from './app/admin/Hub';
import { Reports } from './app/admin/Reports';
import { ReportQueue } from './app/admin/ReportQueue';
import { Events } from './app/admin/Events';
import { AiOps } from './app/admin/AiOps';
import { AdBilling } from './app/admin/AdBilling';
import { Collect } from './app/admin/Collect';
import { RoleAdmin } from './app/admin/RoleAdmin';
import { Payouts } from './app/admin/Payouts';
import { Members } from './app/admin/Members';
import { Community } from './app/admin/Community';
import { Polls } from './app/admin/Polls';
import { Ownership } from './app/admin/Ownership';
import { HealthSettle } from './app/admin/HealthSettle';
import { HealthProducts } from './app/admin/HealthProducts';
import { Translations } from './app/admin/Translations';
import { HealthOrders } from './app/admin/HealthOrders';
import { HealthReviews } from './app/admin/HealthReviews';
import { Affiliates } from './app/admin/Affiliates';
import { Audit } from './app/admin/Audit';
import { Invariants } from './app/admin/Invariants';
import { Integ } from './app/admin/Integ';
import { GwanUx } from './app/admin/GwanUx';
import { Adx } from './app/admin/Adx';
import { Footer, type FooterLink } from './components/Footer';
import { TABS, GROUPS, PAGE, SUB_PAGE, SUB_GROUP, groupOf, type Tab } from './lib/adminMenu';
import { hashSub } from './lib/hashSub';
import { siteUrl } from './lib/siteUrl';

/* v10.29 — 탭 목록 · 시안 묶음 · 제목 줄은 lib/adminMenu.ts 로 옮겼습니다(키 · 글자는 그대로) */

/* ── 탭별 역할 (20260930) ─────────────────────────────────────────────
 * 서버가 막는 탭을 보여 주면 눌러도 403 만 납니다(실측 — 검수자 계정으로 30탭 중 26탭).
 * 값은 각 탭이 부르는 API 의 @Roles 를 역할별 계정으로 실제로 눌러 확인한 결과입니다.
 * 적히지 않은 탭은 ADMIN · SUPER. 서버 권한이 바뀌면 여기도 바꾸십시오. */
/* 2026-10-02 — 'gwans' 를 뺐습니다. 관 관리 목록 · 순서 · 랜딩(SB-ADM-GWN-010)은 서버가 ADMIN 에게도
 * 열려 있습니다. 안의 새 관 · 설정 · 공유 경계는 SUPER 에게만 보입니다(Gwans.tsx).
 * 'mainops' · 'integrations' 는 레지스트리가 ADMIN · SUPER 이지만 서버가 SUPER 만 받아 그대로 둡니다. */
/* v10.31 (10/10 결함) — 「자동검수 규칙」(REV-030) · 「메인 운영」(MAIN-010)은 matrix 대로 ADMIN|SUPER.
 *   서버도 같이 열었습니다(정책 읽기 · 자동검수 값 · 금칙어 · 배너 · 공지). 메인 운영 안의 관 노출 · 화면 구성 · 콘텐츠(MAIN-020~040)는 SUPER 만(MainOps.tsx). */
const SUPER_ONLY = ['checklist', 'policy', 'integrations', 'hub', 'codes', 'integ', 'terms'];   /* v10.161 terms — 약관 API 는 SUPER 만 */
const TAB_ROLES: Partial<Record<Tab, string[]>> = {
  home: ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT'],
  /* 2026-10-01 결정 Q1 — 지급 담당의 작업 화면. 확정은 운영, 지급은 지급 담당 */
  payouts: ['ADMIN', 'SUPER', 'PAYOUT'],
  /* v10.31 — 퍼블리셔 지급: 신청 · 승인은 운영, 집행은 지급 담당 */
  'adx-payout': ['ADMIN', 'SUPER', 'PAYOUT'],
  queue: ['ADMIN', 'SUPER', 'REVIEWER'],
  badges: ['ADMIN', 'SUPER', 'REVIEWER'],
  audit: ['ADMIN', 'SUPER', 'REVIEWER'],
  ...Object.fromEntries(SUPER_ONLY.map((t) => [t, ['SUPER']])),
};
/* 2026-10-21 결정 — SUPER 는 모든 탭(서버 AuthGuard 와 같은 규칙: SUPER 는 권한 검사를 항상 통과) */
const canSee = (t: Tab, roles: string[]) =>
  roles.includes('SUPER') || (TAB_ROLES[t] ?? ['ADMIN']).some((r) => roles.includes(r));

/**
 * 운영 BO.
 *
 * 자동 처리가 기본이므로, 여기 화면들은 "사람이 봐야 하는 것"만 다룹니다.
 * 검수 큐에 자동 승인 건이 안 보이는 것도 같은 이유입니다.
 */
export function App() {
  /* 20260930 — 로그인 전에는 로그인 화면만. 전에는 로그인 없이 전 화면이 403 이었습니다. */
  const [authed, setAuthed] = useState(hasToken());
  useEffect(() => onAuthChange(setAuthed), []);
  if (!authed) return <Login />;
  return <Console />;
}

/* v10.29 — 지금 보는 탭을 주소(#/탭키)에 남깁니다. 새로 고침 · 뒤로 가기에도 같은 탭이 열리고,
 * 시험이 탭으로 바로 들어갈 수 있습니다(예: http://127.0.0.1:5173/#/hlt-orders). */
const tabFromHash = (): Tab | null => {
  const k = decodeURIComponent(location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] ?? '');
  return (TABS.some(([t]) => t === k) ? k : null) as Tab | null;
};

/* v10.32 — 제목 위 「← 운영 홈」을 그리는 탭(시안 shell() 을 쓰는 화면) */
const BACK_HOME: Tab[] = ['integ', 'adx', 'adx-payout'];

const ROLE_NAME: Record<string, string> = { SUPER: '최고 관리자', ADMIN: '운영', REVIEWER: '검수 담당', PAYOUT: '지급 담당' };

function Console() {
  const roles = tokenRoles();
  const visible = (t: Tab) => canSee(t, roles);
  const [tab, setTab] = useState<Tab>(() => { const h = tabFromHash(); return h && visible(h) ? h : 'home'; });
  const [open, setOpen] = useState<string | null>(null);
  const [links, setLinks] = useState<FooterLink[]>([]);
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadCodes('ADMIN'),
      api<FooterLink[]>('/footer-links').catch(() => [] as FooterLink[]),
      api<Record<string, string | null>>('/site-settings/public').catch(() => ({})),
    ])
      .then(([, l, s]) => { setLinks(l); setSettings(s); setReady(true); })
      .catch((e: Error) => setErr(e.message));
  }, []);

  /* v10.32 — 지금 하위 화면(#/탭/하위). SUB_PAGE 에 있으면 제목 줄을 그 화면 제목으로 */
  const [sub, setSub] = useState<string | null>(() => hashSub());
  /* 뒤로 가기 · 주소창에서 바꾼 탭을 따라갑니다 */
  useEffect(() => {
    const on = () => { const h = tabFromHash(); if (h && visible(h)) { setTab(h); setOpen(null); } setSub(hashSub()); };
    const onSub = () => setSub(hashSub());
    window.addEventListener('hashchange', on); window.addEventListener('popstate', on); window.addEventListener('bo-sub', onSub);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); window.removeEventListener('bo-sub', onSub); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* v10.31 — 'mainops/gwan' 처럼 하위 탭까지 받습니다(하위 탭은 화면이 주소에서 읽음 · lib/hashSub) */
  function go(t: string) {
    const base = t.split('/')[0]!;
    setTab(base as Tab); setOpen(null);
    if (location.hash !== `#/${t}`) history.pushState(null, '', `#/${t}`);
    window.dispatchEvent(new Event('bo-sub'));
    window.scrollTo(0, 0);
  }

  if (err) return <div className="boot-error">코드 라벨을 불러오지 못했습니다 — {err}</div>;
  if (!ready) return <div className="boot">불러오는 중…</div>;

  const cur = groupOf(tab);
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter(visible) })).filter((g) => g.tabs.length);
  const curTabs = groups.find((g) => g.key === cur.key)?.tabs ?? [];
  /* v10.32 — 상단바에서 켜 둘 묶음(하위 화면이 시안에서 다른 묶음이면 그 묶음 · SUB_GROUP). 탭 줄은 cur 그대로 */
  const navKey = (sub && SUB_GROUP[`${tab}/${sub}`]) || cur.key;
  const label = (t: Tab) => TABS.find(([k]) => k === t)?.[1] ?? t;
  const page = (sub && SUB_PAGE[`${tab}/${sub}`]) || PAGE[tab];
  const roleText = roles.filter((r) => ROLE_NAME[r]).map((r) => ROLE_NAME[r]).join(' · ');

  return (
    <div className="bo">
      {/* v10.29 — 시안 admNav: 어두운 상단바 · 묶음 메뉴 · 오른쪽 「사용자 화면으로」 */}
      <header className="bo-head">
        <div className="ad-in">
          <a className="ad-lg" href="#/home" onClick={(e) => { e.preventDefault(); go('home'); }}>
            <span className="d" />소개뱅크 <b>운영</b>
          </a>
          <nav className="ad-gnb" aria-label="운영 메뉴">
            {groups.map((g) => {
              const on = g.key === navKey;
              return (
                <button key={g.key} className={on ? 'on' : ''} data-group={g.key}
                        data-tabs={`|${g.tabs.map(label).join('|')}|`}
                        aria-current={on ? 'page' : undefined}
                        title={g.tabs.map(label).join(' · ')}
                        onClick={() => go(on && g.tabs.includes(tab) ? tab : g.tabs[0]!)}>{g.label}</button>
              );
            })}
          </nav>
          <div className="ad-hr">
            {roleText && <span className="ad-role">{roleText}</span>}
            <a className="ad-btn" href={siteUrl()} target="_blank" rel="noreferrer">사용자 화면으로</a>
            <button className="ad-btn bo-logout" onClick={() => setToken(null, null)}>로그아웃</button>
          </div>
        </div>
      </header>

      <main className="bo-main" data-tab={tab}>
        {page && (
          <div className="ad-pgh">
            {/* v10.32 — 시안 shell()(통합 현황 · 광고 플랫폼 · 퍼블리셔 지급)은 제목 위에 「← 운영 홈」을 둡니다 */}
            {BACK_HOME.includes(tab) && (
              <a className="ad-bk" href="#/home" data-back-home onClick={(e) => { e.preventDefault(); go('home'); }}>← 운영 홈</a>
            )}
            <h1>{page.title}</h1>
            {(page.sub || page.screen) && (
              <p>{page.sub}{page.screen && <span className="ad-sid"> {page.screen}</span>}</p>
            )}
          </div>
        )}
        {/* v10.29 — 같은 묶음의 탭(시안 .tabs2). 탭이 하나면 그리지 않습니다 */}
        {curTabs.length > 1 && (
          <div className="ad-snb" role="tablist" aria-label={`${cur.label} 화면`}>
            {curTabs.map((t) => (
              <button key={t} role="tab" className={t === tab ? 'on' : ''} data-tab={t}
                      aria-selected={t === tab} onClick={() => go(t)}>{label(t)}</button>
            ))}
          </div>
        )}
        {tab === 'home' && <Dashboard onGo={go} canGo={(t) => visible(t as Tab)} />}
        {tab === 'reports' && <Reports />}
        {tab === 'report-queue' && <ReportQueue />}
        {tab === 'events' && <Events />}
        {tab === 'ai-ops' && <AiOps />}
        {tab === 'members' && <Members />}
        {tab === 'community' && <Community />}
        {tab === 'polls' && <Polls />}
        {tab === 'ownership' && <Ownership />}
        {tab === 'hlt-settle' && <HealthSettle onGo={go} />}
        {tab === 'hlt-products' && <HealthProducts />}
        {tab === 'i18n' && <Translations />}
        {tab === 'hlt-orders' && <HealthOrders onGo={go} />}
        {tab === 'hlt-reviews' && <HealthReviews onGo={go} />}
        {tab === 'affiliates' && <Affiliates onGo={go} />}
        {tab === 'gov-audit' && <Audit />}
        {tab === 'invariants' && <Invariants />}
        {tab === 'ad-billing' && <AdBilling />}
        {tab === 'collect' && <Collect />}
      {tab === 'roles' && <RoleAdmin />}
      {tab === 'queue' && (open
          ? <ReviewDecide id={open} onDone={() => setOpen(null)} />
          : <ReviewQueue onOpen={setOpen} />)}
        {tab === 'badges' && <Badges />}
        {tab === 'audit' && <AuditSamples />}
        {tab === 'rules' && <AutoReviewRules onGo={visible('policy') ? go : undefined} />}
        {tab === 'disputes' && <Disputes />}
        {tab === 'category' && <Categories />}
        {tab === 'users' && <Users onGo={go} />}
        {tab === 'deals' && <Deals onGo={go} />}
        {tab === 'settlement' && <Settlements />}
        {tab === 'payouts' && <Payouts />}
        {tab === 'billing' && <Billing />}
        {tab === 'checklist' && <OpenChecklist onGo={go} />}
        {tab === 'policy' && <Policies />}
        {tab === 'siteinfo' && <SiteInfo onGo={visible('checklist') ? go : undefined} />}
        {tab === 'terms' && <TermsPanel />}
        {tab === 'integrations' && <Integrations />}
        {tab === 'mainops' && <MainOps onGo={go} />}
      {tab === 'gwans' && <Gwans onGo={go} />}
      {tab === 'hub' && <Hub onGo={go} />}
      {tab === 'partners' && <Partners onGo={go} />}
      {tab === 'partner-axes' && <PartnerAxes />}
      {tab === 'directory' && <DirectoryAdmin />}
      {tab === 'quals' && <Qualifications onGo={go} />}
      {tab === 'risk' && <RiskAlerts />}
      {tab === 'ads' && <Ads />}
      {tab === 'codes' && <CodeLabels />}
      {tab === 'integ' && <Integ />}
      {tab === 'gwan-ux' && <GwanUx onGo={go} />}
      {tab === 'adx' && <Adx view="platform" onGo={go} />}
      {tab === 'adx-payout' && <Adx view="payout" onGo={go} />}
      </main>

      <Footer links={links} settings={settings} variant="slim" className="bo-foot" />
    </div>
  );
}
