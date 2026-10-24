import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import type { FooterLink, Gwan } from '@/lib/types';
import { Footer } from '@/components/Footer';
import { SiteHeader } from '@/components/common/SiteHeader';
import { B2Tone, BaseFooter, BaseHeader, MainWrap, OnlySkin } from '@/components/Chrome';
import { B2Footer, B2Header } from '@/components/b2/Frame';
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

/* v10.95 — 제목 · 설명도 사전에서(한국어는 전과 같음) */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    /* 2026-10-21 — B2B → P2P(10/13 결정 · 개인 회원도 모든 업무) */
    description: t('description'),
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

  return (
    <html lang={locale}>
      {/* v10.31 (w1 · F-11) — 시안 글꼴 Noto Sans KR 은 킷 안의 파일(styles/noto-sans-kr.css · public/fonts/noto-sans-kr)로. 구글 글꼴 서버로 요청하지 않습니다 */}
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
        {/* v10.31 — 시안 .skip 「본문으로 건너뛰기」(키보드 · 화면 읽기) */}
        <a className="skip-main" href="#main">{t('skipToMain')}</a>
        {/* 20261002 (v10.13) — 메인(/)은 제 머리 · 바닥을 따로 그립니다(components/home). 다른 화면은 아래 그대로 */}
        {/* v10.29 — 시안 일반 머리줄(components/common/SiteHeader). 메인(/) · 소개광장 · 소개몰은 제 머리줄을 그립니다. /partner/** 는 전용 상단바(Chrome.tsx OWN_HEADER_PATHS) */}
        <BaseHeader><SiteHeader gwans={gwans} /></BaseHeader>
        {/* 20261007 (v10.23) — 소개광장은 제시 디자인의 머리줄 · 바닥줄을 씁니다(components/b2). 소개몰(쇼핑몰)은 v10.25 에서 들어왔습니다 — 같은 머리줄에 「무료 회원가입」만 초록(B2Tone)
            20261009 (v10.29) — 소개장터 메인(/money)도 이 머리줄 · 바닥줄을 씁니다(색조 money — 글꼴 · 치수 · 그림을 그 디자인대로) */}
        <OnlySkin skin="b2"><B2Tone><B2Header gwans={gwans} /></B2Tone></OnlySkin>

        <MainWrap>{children}</MainWrap>
        <BaseFooter><Footer links={links} settings={settings} /></BaseFooter>
        <OnlySkin skin="b2"><B2Footer links={links} settings={settings} year={new Date().getFullYear()} /></OnlySkin>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
