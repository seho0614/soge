import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import type { FooterLink, Gwan } from '@/lib/types';
import { GLOBAL_NS, pick } from '@/i18n/messages';
import { Footer } from '@/components/Footer';
import { NoticeBar } from '@/components/NoticeBar';
import { MaintenancePage, MaintenanceSoon, maintenanceState } from '@/components/Maintenance';   // v10.371 (D239) 점검 중 화면
import { UpcomingTermsBar } from '@/components/UpcomingTerms';
import { UniHeader } from '@/components/common/UniHeader';
import { SiteHeader } from '@/components/common/SiteHeader';
import { LangPick } from '@/i18n/LangPick';
import { AnyHeader, BaseFooter, MainWrap, OldHeader, OnlySkin } from '@/components/Chrome';
import { B2Footer } from '@/components/b2/Frame';
import { AiChat } from '@/components/common/AiChat';
import { UsageBeacon } from '@/components/common/UsageBeacon';   // v10.508 (D274) 회원 화면 사용 통계(site.usage_stats on 일 때만 · 화면 주소만)
import { WebVitalsBeacon } from '@/components/common/WebVitalsBeacon';   // v10.588 (docs/730) 화면 속도(ops2.web_vitals on 일 때만 · 화면 주소 · 지표 · 값만)
import { IncidentBar } from '@/components/upt/IncidentBar';   // v10.497 (D272) 장애 공지 띠
import { A11yBoot } from '@/components/upt/A11yBoot';   // v10.500 (D272) 보기 설정 — 그리기 전에 붙임
import { A11yTools } from '@/components/upt/A11yTools';   // v10.500 (D272) 보기 설정 단추
import { PwaRegister } from '@/components/upt/PwaRegister';   // v10.499 (D272) 서비스 워커(site.pwa)
import { pwaOn } from '@/components/upt/flags';
import '@/styles/noto-sans-kr.css';   /* v10.31 (w1 · 공유) — F-11 */
import '@/styles/tokens.css';
import '@/styles/site.css';
import '@/styles/health.css';
import '@/styles/partners.css';
import '@/styles/b2.css';
import '@/styles/shop.css';
import '@/styles/hlt26.css';
/* 20261009 (v10.29) — 소개장터 메인. 디자인 시트의 토큰(--sgb-…)은 이름이 달라 기존 화면에 닿지 않습니다. 글꼴 파일은 그 글꼴을 쓰는 화면(/money)에서만 내려받습니다. */
import '@/styles/sgb-tokens.css';
import '@/styles/sgb-buttons.css';   // v10.62 단추 3종(docs/118)
import '@/styles/money-fonts.css';
import '@/styles/money.css';
/* v10.29 — 시안 디자인 반영: 공통 틀 · 관 화면 · 나의공간 · 파트너센터/제휴 */
import '@/styles/proto-common.css';
import '@/styles/proto-gwan.css';
import '@/styles/proto-my.css';
import '@/styles/proto-partner.css';
import '@/styles/site-head.css';   // v10.188 공통 머리줄(docs/294)
import '@/styles/ai-chat.css';   // v10.110 사이트 공통 AI 상담(docs/171)
import '@/styles/upt-tokens.css';   // v10.497 ~ 500 (D272) 사이트 전용 새 토큰(sgb-tokens.css 는 디자인 시트 사본 그대로)
import '@/styles/upt.css';   // v10.497 ~ 500 (D272) 장애 공지 띠 · 서비스 상태 · 간편 로그인 단추 · 보기 설정(토큰만)

/* v10.95 — 제목 · 설명도 사전에서(한국어는 전과 같음) */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale, st] = await Promise.all([getTranslations('meta'), getLocale(),
    apiGet<Record<string, string | null>>('/site-settings/public', 300).catch(() => ({} as Record<string, string | null>))]);
  /* v10.175 (D164 · docs/270) — 검색 사이트 소유 확인(HTML 태그 방식) · 운영 화면 설정 seo.verify_google · seo.verify_naver · 빈 값이면 태그 없음 */
  const vg = st['seo.verify_google'] || undefined, vn = st['seo.verify_naver'] || undefined;
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    /* 2026-10-21 — B2B → P2P(10/13 결정 · 개인 회원도 모든 업무) */
    description: t('description'),
    /* v10.174 (docs/268) — 공유 미리보기(카카오톡 · 문자 · 사회관계망). 그림은 app/opengraph-image.tsx · 주소의 앞부분은 SITE_ORIGIN(없으면 운영 도메인) */
    metadataBase: new URL(process.env.SITE_ORIGIN || 'https://sogaebank.com'),
    openGraph: { type: 'website', siteName: t('title'), title: t('title'), description: t('description'), locale: locale === 'ko' ? 'ko_KR' : 'en_US' },
    twitter: { card: 'summary_large_image', title: t('title'), description: t('description') },
    verification: { google: vg, other: vn ? { 'naver-site-verification': vn } : undefined },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 푸터·관 목록은 레이아웃에서 한 번. 페이지마다 조회하지 않습니다
  const [gwans, links, settings] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    apiGet<FooterLink[]>('/footer-links', 300).catch(() => [] as FooterLink[]),
    apiGet<Record<string, string | null>>('/site-settings/public', 300).catch(() => ({})),
  ]);
  const [locale, messages, t] = await Promise.all([getLocale(), getMessages(), getTranslations('common')]);   // v10.95 다국어
  const maint = maintenanceState(settings);   // v10.371 (D239 · docs/506) — 점검 시각 안이면 모든 화면 대신 점검 안내
  if (maint === 'on') {
    return (
      <html lang={locale}>
        <body><A11yBoot /><IncidentBar locale={locale} /><MaintenancePage settings={settings} locale={locale} /></body>
      </html>
    );
  }

  return (
    <html lang={locale}>
      {/* v10.31 (w1 · F-11) — 시안 글꼴 Noto Sans KR 은 킷 안의 파일(styles/noto-sans-kr.css · public/fonts/noto-sans-kr)로. 구글 글꼴 서버로 요청하지 않습니다 */}
      <body>
        <NextIntlClientProvider locale={locale} messages={pick(messages, GLOBAL_NS)} /* v10.97 — 화면 전용 묶음은 그 화면의 <Msgs> 가 */>
        {/* v10.31 — 시안 .skip 「본문으로 건너뛰기」(키보드 · 화면 읽기) */}
        <A11yBoot />
        <a className="skip-main" href="#main">{t('skipToMain')}</a>
        {/* v10.173 (D162) — 운영이 켠 안내 한 줄(site.notice_bar · 비면 그리지 않음) */}
        <NoticeBar settings={settings} locale={locale} />
        {/* v10.497 (D272 · docs/635) — 운영이 쓴 장애 공지(띠 켠 것 · 끝나지 않은 것) · 공개 상태 주소 60초 */}
        <IncidentBar locale={locale} />
        {/* v10.371 (D239) — 점검 24시간 전부터 안내 띠 */}
        {maint === 'soon' && <MaintenanceSoon settings={settings} />}
        {/* v10.188 (docs/294 · 대표 「머리줄 통일」) — 메인 · 관 · 일반 화면이 같은 머리줄(UniHeader · 메인 머리줄 모양).
            전: 메인(home/Frame) · 소개광장 · 소개몰 · 소개장터 메인(b2/Frame) · 그 밖(common/SiteHeader) 세 가지. /partner/** 는 전용 상단바(Chrome.tsx OWN_HEADER_PATHS) */}
        <AnyHeader><UniHeader gwans={gwans} lang={<LangPick />} /></AnyHeader>
        {/* v10.188 — 제휴 파트너센터(/partners)는 대표 「변경하지 않는다」 — 전 일반 머리줄 그대로 */}
        <OldHeader><SiteHeader gwans={gwans} /></OldHeader>
        <MainWrap>{children}</MainWrap>
        {/* v10.161 (D151) — 시행 예정 약관이 있으면 바닥줄 위 한 줄(없으면 그리지 않음) */}
        <BaseFooter><UpcomingTermsBar /><Footer links={links} settings={settings} /></BaseFooter>
        <OnlySkin skin="b2"><B2Footer links={links} settings={settings} year={new Date().getFullYear()} /></OnlySkin>
        {/* v10.110 (docs/171) — AI 상담 단추 · 창. 서버가 꺼짐이면 아무것도 그리지 않음 · 파트너센터 제외 */}
        <AiChat />
        {/* v10.508 (D274 · docs/646) — 화면이 바뀔 때 화면 주소만 한 번 보냄(계정 · 쿠키 없음 · DNT · GPC 존중 · 꺼져 있으면 아무것도 안 함) */}
        <UsageBeacon settings={settings} />
        {/* v10.588 (docs/730) — 화면 속도(LCP · INP · CLS · FCP · TTFB) 값 하나씩(계정 · 쿠키 · 방문자 키 없음 · DNT · GPC 존중 · 꺼져 있으면 아무것도 안 함) */}
        <WebVitalsBeacon settings={settings} />
        {/* v10.500 (D272 · docs/638) 보기 설정(글자 크게 · 고대비 · 이 브라우저) · v10.499 서비스 워커(site.pwa on · 운영 빌드만 · off 면 지움) */}
        <A11yTools />
        <PwaRegister on={pwaOn(settings)} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
