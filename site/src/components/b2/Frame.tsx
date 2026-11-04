/**
 * 두 관(소개광장 · 소개몰) 전용 머리줄 · 바닥줄 — 2026-10-07 제시 디자인(남색 #00245A + 주황 #F5A008) · v10.23.
 *
 * 사장님 결정(2026-10-07): 새 머리줄 · 바닥줄은 **두 관에서만** 씁니다. 다른 화면의 머리 · 바닥(app/layout.tsx)은 그대로입니다.
 * 메뉴 이름은 관 이름 그대로입니다 — v10.25 에서 관 이름이 그림대로 「소개몰」이 됐습니다(10/7 결정 · 마이그레이션 D024. v10.23 때는 「소개뱅크몰」 유지였습니다).
 *
 * 로고 · 사회관계망 아이콘은 주신 그림(docs/design/plaza_design_20261007.png)에서 **그 자리만 그대로 잘라 낸 PNG** 입니다
 * (public/b2 · qa/cut_b2.py · qa/b2_assets.json). 크기를 줄이거나 다른 형식으로 바꾸지 않았습니다 — 그래서 <img> 로 그대로 씁니다
 * (next/image 는 webp 로 바꿔 내주므로 쓰지 않습니다).
 *
 * 그림과 다르게 넣은 것:
 *   ① 사업자 정보 · 통신판매중개자 고지 — 첫 화면에서 빠지면 안 되는 법정 표시입니다(공통 바닥줄과 같은 값 · 같은 규칙).
 *   ② 바로가기 줄(소개받기 · 파트너센터 · 나의공간 · 알림) — 새 머리줄에서 빠진 곳을 이 관에서도 갈 수 있게 합니다.
 *   ③ 지금 화면 표시(밑줄)는 그 화면의 메뉴에 — 그림은 소개광장 화면인데 「소개몰」에 밑줄이 있었습니다.
 *   ④ 「KR」 은 누르면 열리지만 한국어뿐입니다 — 실제 웹에는 아직 다른 언어가 없어 그렇게 적었습니다.
 *   ⑤ 바닥줄의 약관 링크는 서버가 내려주는 목록 그대로입니다(v10.31 — 「운영정책」이 목록에 들어와 이용안내로 이어짐 · 순서 서버대로).
 *   ⑦ v10.31 — F-9: 화면 폭 1280 ~ 1326px · 901 ~ 1124px 에서 머리줄이 가로로 넘치던 것을 단계별 줄임 규칙으로 고쳤습니다(styles/b2.css).
 *   ⑥ 로그인한 사람에게는 「로그인 · 무료 회원가입」 대신 「나의공간 · 로그아웃」 — 그림에는 로그인한 모습이 없습니다(시안과 같게 · 10/7 확인).
 *
 * v10.29 (2026-10-09) — 소개장터 메인(/money)도 이 머리줄 · 바닥줄을 씁니다. 그 화면에서는
 *   · 로고 · 사회관계망 아이콘을 그 디자인(docs/design/money_main_20261009.webp)에서 자른 것으로 바꿔 넣고(TonePic · public/money),
 *   · 장바구니 자리에 알림 종을 놓습니다(AuthArea) — 그림의 종에는 숫자 「1」이 같이 그려져 있어, 실제 웹은 선으로 그린 종에 **읽지 않은 알림 수**를 붙입니다.
 *   · 글꼴 · 치수 · 주황은 styles/money.css 의 [data-b2-tone=money] 가 그림대로 바꿉니다. 소개광장 · 소개몰의 머리줄은 그대로입니다.
 */
import Link from 'next/link';
import type { FooterLink } from '@/lib/types';
import { B2Notice } from './Notice';
import { TonePic } from './TonePic';
import { MnyPic } from '@/components/money/pics';
import { footerHref } from '@/components/common/links';
import { useTranslations } from 'next-intl';

/** 잘라 낸 그림 — [파일, 원래 가로, 원래 세로]. 화면에는 h 높이에 맞춰 같은 비율로 넣습니다. */
const PIC = {
  logo: ['/b2/logo.png', 866, 210],
  'logo-ft': ['/b2/logo-ft.png', 802, 200],
  'sns-1': ['/b2/sns-1.png', 120, 120],
  'sns-2': ['/b2/sns-2.png', 120, 120],
  'sns-3': ['/b2/sns-3.png', 121, 120],
} as const;

function Pic({ name, h, alt = '' }: { name: keyof typeof PIC; h: number; alt?: string }) {
  const [src, w0, h0] = PIC[name];
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={Math.round((w0 * h) / h0)} height={h} alt={alt} aria-hidden={alt ? undefined : true} />;
}

/* v10.189 — 두 관 · 소개장터 메인 머리줄(B2Header · B2Lang · AuthArea)은 지웠습니다 — v10.188 부터 공통 머리줄(components/common/UniHeader.tsx). 바닥줄은 그대로 씁니다. */

/* 사회관계망 — [이름, 그림, 설정 키]. 주소는 운영 화면 「사이트 기본 정보」에서 넣습니다(D021 · 설정 sns.*) — 메인 바닥줄과 같은 규칙입니다.
 * 주소가 있으면 새 창으로 그 계정에, 비어 있으면 「준비 중」(누를 수 없음)입니다. https 주소만 받습니다. 그림에는 세 개(엑스 없음)입니다. */
/* v10.95 — 이름은 사전 키(b2.sns.*) */
const SNS: ['facebook' | 'instagram' | 'youtube', 'sns-1' | 'sns-2' | 'sns-3', string, 'sns_fb' | 'sns_ig' | 'sns_yt'][] = [['facebook', 'sns-1', 'sns.facebook', 'sns_fb'], ['instagram', 'sns-2', 'sns.instagram', 'sns_ig'], ['youtube', 'sns-3', 'sns.youtube', 'sns_yt']];
const snsUrl = (v: string | null | undefined) => (v && /^https:\/\/[^\s]{4,200}$/.test(v) ? v : null);

/* v10.95 — 글자는 사전 키(b2.quick.*) */
const QUICK: ['request' | 'affPartners' | 'ansimPartner' | 'my' | 'alerts', string][] = [
  ['request', '/request'], ['affPartners', '/partners'], ['ansimPartner', '/partner'], ['my', '/my'], ['alerts', '/my/notifications'],
];

export function B2Footer({ links, settings, year }: { links: FooterLink[]; settings: Record<string, string | null>; year: number }) {
  const t = useTranslations('b2');
  const h = useTranslations('header');
  const all = links;   /* v10.31 — 서버 순서 그대로(시안 다섯 · 개발에만 있는 것 순) */
  return (
    <footer className="b2-ft">
      <div className="b2-in">
        <div className="b2-ftr">
          <Link href="/" className="b2-logo" aria-label={h('logoHome')}><TonePic base={<Pic name="logo-ft" h={50} alt={t('logoSlogan')} />} money={<MnyPic name="logo_foot" alt={t('logoSlogan')} />} /></Link>
          <div className="b2-ftl">
            <Link href="/">{t('about')}</Link>
            {all.map((l, i) => l.available ? (
              <Link key={`${l.section}-${i}`} href={footerHref(l)}>{l.label}</Link>
            ) : (
              <span key={`${l.section}-${i}`} className="tbd" title={l.tip ?? t('preparing')}>{l.label}</span>
            ))}
          </div>
          <div className="b2-ftend">
            <div className="b2-sns">
              {SNS.map(([name, pic, key, mpic]) => {
                const url = snsUrl(settings[key]);
                const img = <TonePic base={<Pic name={pic} h={30} />} money={<MnyPic name={mpic} />} />;
                return url ? (
                  <a key={name} className="on" href={url} target="_blank" rel="noopener noreferrer" aria-label={t('snsOpen', { name: t(`sns.${name}`) })} title={t('snsTitle', { name: t(`sns.${name}`) })} data-sns={key}>{img}</a>
                ) : (
                  <span key={name} role="img" aria-label={t('snsSoonLabel', { name: t(`sns.${name}`) })} title={t('snsSoonTitle', { name: t(`sns.${name}`) })} data-sns={key}>{img}</span>
                );
              })}
            </div>
            <span className="b2-copy">{t('copyright', { year })}</span>
          </div>
        </div>

        <nav className="b2-quick" aria-label={t('quickLabel')}>
          {QUICK.map(([k, href]) => <Link key={href} href={href}>{t(`quick.${k}`)}</Link>)}
        </nav>

        {/* 법정 표시 — 공통 바닥줄(components/Footer.tsx)과 같은 값 · 같은 규칙입니다 */}
        <div className="b2-legal">
          <p>
            {settings['footer.ceo_name'] && <>{t('ceo')} {settings['footer.ceo_name']} · </>}
            {settings['footer.biz_reg_no']
              ? <>{t('bizRegNo')} {settings['footer.biz_reg_no']}</>
              : <span className="tbd" title={t('tipNeeded')}>{t('bizRegNo')} —</span>}
            {' · '}
            {settings['footer.mail_order_no']
              ? <>{t('mailOrder')} {settings['footer.mail_order_no']}</>
              : <span className="tbd" title={t('tipMailOrder')}>{t('mailOrderNo')} —</span>}
            {/* v10.31 (합침 · w6 D080) — 직업정보제공사업 신고번호(footer.job_info_no) */}
            {settings['footer.job_info_no'] && <>{' · '}{t('jobInfoNo')} {settings['footer.job_info_no']}</>}
          </p>
          {/* 소개몰에서는 직판 고지를 같이 — 화면에 따라 달라 브라우저에서 고릅니다(B2Notice) */}
          <B2Notice inter={settings['legal.intermediary_notice']} direct={settings['legal.direct_notice']} />
        </div>
      </div>
    </footer>
  );
}
