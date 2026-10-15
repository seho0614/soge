'use client';
/**
 * v10.29 — 안심소개 파트너센터 전용 상단바 (시안 pcNav → header.phd) · 공통 틀
 *
 * 시안: 어두운 초록 띠 · 「● 소개뱅크 안심소개 파트너센터」 · 메뉴 12개 · 오른쪽에 「업체명 · 업종」 + 「사용자 화면으로」.
 * 메뉴 순서 · 이름 · 주소 모두 시안 D.partner.nav 그대로입니다(v10.31 — 10/10 시안 기준: /partner/cash · /partner/tracks).
 *   옛 주소(/partner/fees · /repair-inbox · /partner/rejects)는 새 주소로 보냅니다.
 * 메뉴에 없는 화면(지역 · 성과 · 이력 · 반려 · 신뢰지표)은 그 화면이 속한 메뉴를 켭니다.
 *
 * 일반 머리줄은 공통 묶음의 Chrome.tsx(OWN_HEADER_PATHS) · <OwnChrome /> 로 숨깁니다.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const PTC_NAV: Array<[string, string]> = [
  ['/partner', '홈'],
  ['/partner/apply', '입점 신청'],
  ['/partner/listings', '내 매물'],
  ['/partner/leads', '상담 신청'],
  ['/partner/services', '내 서비스'],
  ['/partner/pricing', '단가 · 소개비'],
  ['/partner/tracks', '전용 트랙'],
  ['/partner/cash', '리드 이용료'],
  ['/partner/settlement', '정산'],
  ['/partner/stats', '실적'],
  ['/partner/business', '회사 · 계정'],
  ['/partner/notices', '공지 · 알림'],
];

/** 메뉴에 없는 화면 → 켤 메뉴 */
const BELONGS: Array<[string, string]> = [
  ['/partner/regions', '/partner/services'],
  ['/partner/performance', '/partner/services'],
  ['/partner/reviews', '/partner/services'],
  ['/partner/rejects', '/partner/leads'],
  ['/partner/leads-rejects', '/partner/leads'],
  ['/partner/fees', '/partner/cash'],
  ['/partner/trust', '/partner/stats'],
];

function activeOf(path: string): string {
  for (const [p, to] of BELONGS) if (path === p || path.startsWith(p + '/')) return to;
  let best = '/partner';
  for (const [href] of PTC_NAV) {
    if (href !== '/partner' && (path === href || path.startsWith(href + '/')) && href.length > best.length) best = href;
  }
  return best;
}

export function PartnerTopBar({ corp }: { corp?: string | null }) {
  const path = usePathname() ?? '/partner';
  const act = activeOf(path);
  return (
    <header className="pt-hd" data-ptc-top="">
      <div className="pt-in">
        <Link className="pt-plg" href="/partner"><span className="d" />소개뱅크 <b>안심소개 파트너센터</b></Link>
        <nav className="pt-gnb" aria-label="파트너센터 메뉴">
          {PTC_NAV.map(([href, label]) => (
            <Link key={href} href={href} className={href === act ? 'on' : undefined}
                  aria-current={href === act ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        <div className="pt-phr">
          {corp ? <span className="pt-ls">{corp}</span> : null}
          <Link className="pt-bo sm" href="/">사용자 화면으로</Link>
        </div>
      </div>
    </header>
  );
}
