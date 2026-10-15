/**
 * v10.31 (w1 · 공통 틀) — 머리줄 · 꼬리줄이 같이 쓰는 주소 규칙.
 *   꼬리줄 링크(서버 /footer-links): TERM → /terms/{코드} · SCREEN → 화면 ID 로(이용안내 · 운영정책 = /guide · 고객센터 · 분쟁조정 안내 = /support/new) · URL → 그 주소.
 *   운영 역할(ADMIN · SUPER · REVIEWER · PAYOUT)이면 머리줄에 시안의 「관리자 페이지」 단추 — /go/admin 이 운영 화면(BO) 주소로 보냅니다. 권한 검사는 BO · 서버가 합니다.
 */
export interface LinkLike { label: string; targetType: string; targetRef: string | null }

const SCREEN_HREF: Record<string, string> = {
  'SB-HOM-ETC-010': '/guide',
  'SB-HOM-CSB-010': '/support/new',
  'SB-HOM-ETC-030': '/support/new',
};

export function footerHref(l: LinkLike): string {
  if (l.targetType === 'TERM' && l.targetRef) return `/terms/${l.targetRef}`;
  if (l.targetType === 'URL' && l.targetRef && /^(https?:\/\/|\/)/.test(l.targetRef) && !l.targetRef.startsWith('//')) return l.targetRef;
  if (l.targetType === 'SCREEN' && l.targetRef) return SCREEN_HREF[l.targetRef] ?? '/support/new';
  return '/support/new';
}

export const ADMIN_ROLES = ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT'];
export const isOps = (roles?: string[] | null) => !!roles?.some((r) => ADMIN_ROLES.includes(r));
