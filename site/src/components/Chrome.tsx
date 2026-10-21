'use client';
/**
 * 화면 묶음마다 머리 · 바닥 · 본문 틀이 다릅니다.
 *
 *   home   메인(/)                — 20261002 v10.13 「hero 페이지」 디자인. 메인이 제 머리 · 바닥을 그립니다(components/home).
 *   b2     소개광장(/community…)  — 20261007 v10.23 제시 디자인(남색 + 주황). 두 관 전용 머리 · 바닥(components/b2).
 *            소개몰(/health… · /my/health…) — 20261007 v10.25 제시 디자인(남색 + 초록). 같은 머리 · 바닥을 쓰고 「무료 회원가입」만 그림대로 초록입니다.
 *            소개장터 메인(/money)       — 20261009 v10.29 제시 디자인(남색 + 주황 #FFA03E). 같은 머리 · 바닥을 쓰고 글꼴 · 치수 · 그림만 그 디자인대로(styles/money.css).
 *                                           **메인 한 화면만**입니다 — /money/list · /money/{번호} 같은 아래 화면은 지금 그대로(base).
 *   base   그 밖의 모든 화면       — 지금 그대로.
 *
 * 사장님 결정: 새 머리줄 · 바닥줄은 **그 묶음에서만**. 다른 화면은 지금 그대로입니다(10/2 메인 · 10/7 두 관 · 10/9 소개장터 메인).
 * 레이아웃(서버 컴포넌트)은 화면을 옮겨 다닐 때 다시 그려지지 않으므로, 주소를 보고 고르는 일만 여기서 합니다.
 * 어느 쪽이든 서버에서 그린 것을 받아 그대로 내보냅니다 — 조회는 하지 않습니다.
 */
import { usePathname } from 'next/navigation';

export type Skin = 'home' | 'b2' | 'base';

/** 새 머리줄 · 바닥줄을 쓰는 주소의 앞부분 */
const B2_PATHS = ['/community', '/health', '/my/health'];
/** 소개몰(쇼핑몰)의 주소 — 메인(/health)은 화면 폭 전체, 그 밖의 쪽은 본문 폭 1200px 로 그립니다 */
const SHOP_PATHS = ['/health', '/my/health'];
export const isShop = (p: string | null) => !!p && SHOP_PATHS.some((b) => p === b || p.startsWith(b + '/'));

/** 소개장터 메인 — 주소가 정확히 /money 일 때만(정렬 · 배지 · 쪽 넘김은 주소 뒤 ?… 라 그대로 이 화면입니다) */
export const isMoneyMain = (p: string | null) => p === '/money';

export function skinOf(p: string | null): Skin {
  if (p === '/') return 'home';
  if (isMoneyMain(p)) return 'b2';
  if (p && B2_PATHS.some((b) => p === b || p.startsWith(b + '/'))) return 'b2';
  return 'base';
}

/** 그 묶음의 화면에서만 children 을 그립니다. */
export function OnlySkin({ skin, children }: { skin: Skin; children: React.ReactNode }) {
  return skinOf(usePathname()) === skin ? <>{children}</> : null;
}

/** 공통 머리 · 바닥 — 메인과 두 관에서는 그리지 않습니다(그쪽이 제 것을 그립니다). 이름은 v10.13 그대로 둡니다. */
export function ExceptHome({ children }: { children: React.ReactNode }) {
  return <OnlySkin skin="base">{children}</OnlySkin>;
}

/**
 * v10.29 — 일반 머리줄을 그리지 않는 주소(전용 상단바를 쓰는 화면).
 *   /partner/**  안심소개 파트너센터(시안 ptn — 초록 전용 상단바). 꼬리줄은 시안처럼 그대로 둡니다.
 *   ※ /partners(제휴 파트너센터)는 해당 없음 — '/partner' 와 정확히 같거나 '/partner/' 로 시작할 때만.
 * 꼬리줄까지 숨길 주소는 OWN_FOOTER_PATHS 에.
 */
export const OWN_HEADER_PATHS = ['/partner'];
export const OWN_FOOTER_PATHS: string[] = [];
const under = (p: string | null, list: string[]) => !!p && list.some((b) => p === b || p.startsWith(b + '/'));

/** 일반 머리줄 — base 화면 중 OWN_HEADER_PATHS 를 뺀 곳에서만 */
export function BaseHeader({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  return skinOf(p) === 'base' && !under(p, OWN_HEADER_PATHS) ? <>{children}</> : null;
}

/** 일반 꼬리줄 — base 화면 중 OWN_FOOTER_PATHS 를 뺀 곳에서만 */
export function BaseFooter({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  return skinOf(p) === 'base' && !under(p, OWN_FOOTER_PATHS) ? <>{children}</> : null;
}

/** 본문 틀 — 메인 · 두 관은 화면 폭 전체를 씁니다(사진 띠 · 구역 바탕). 다른 화면은 1200px 그대로 */
/** 2026-10-21 디자인 통일 1단계(docs/105) — 주소 → 디자인 시트의 관(data-sgb-gwan). 관 색(--sgb-point …)이 이 표시를 따라 바뀝니다.
 *  /mall · /mal 은 안심소개(MAL), /health 는 소개몰입니다(lib/format.ts PATH_GWAN). 그 밖의 주소는 표시 없음 = 남색 */
const SGB_GWAN: [string, string][] = [
  ['/money', 'money'], ['/mall', 'mall'], ['/mal', 'mall'], ['/biz', 'biz'], ['/health', 'shop'], ['/community', 'plaza'],
];
export const sgbGwanOf = (p: string | null): string | undefined =>
  p ? SGB_GWAN.find(([b]) => p === b || p.startsWith(b + '/'))?.[1] : undefined;

export function MainWrap({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  const s = skinOf(p);
  /* v10.31 — 「본문으로 건너뛰기」(layout) 가 가리키는 곳: id="main" */
  /* 2026-10-21 2단계 B(docs/107) — 소개광장 · 소개몰 · 소개장터 메인에도 관 표시. 메인(/)만 빼 둡니다(proto-common.css 가 묶어 둠 · 10/2 「그림 그대로」) */
  const g = s === 'home' ? undefined : sgbGwanOf(p);
  if (s === 'b2' && isShop(p) && p !== '/health') return <main id="main" tabIndex={-1} className="main main-b2" data-sgb-gwan="shop"><div className="shop-sub">{children}</div></main>;
  if (isMoneyMain(p)) return <main id="main" tabIndex={-1} className="main main-b2 main-mny" data-sgb-gwan={g}>{children}</main>;
  return <main id="main" tabIndex={-1} className={s === 'home' ? 'main main-home' : s === 'b2' ? 'main main-b2' : 'main'}
    data-sgb-gwan={g}>{children}</main>;
}

/** 두 관 전용 머리줄 · 바닥줄의 색조 — 소개몰에서는 그림대로 「무료 회원가입」이 초록, 소개광장은 주황 그대로(styles/shop.css 의 [data-b2-tone=shop])
 *  소개장터 메인은 money — 글꼴 · 치수 · 주황(#FFA03E)을 그 디자인대로(styles/money.css 의 [data-b2-tone=money]) */
export function B2Tone({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  /* 2026-10-21 2단계 B — 머리줄은 <main> 밖이라 여기에도 관 표시(소개몰 「무료 회원가입」 초록 = 시트 소개몰 글자색) */
  const t = isMoneyMain(p) ? 'money' : isShop(p) ? 'shop' : 'plaza';
  return <div data-b2-tone={t} data-sgb-gwan={t}>{children}</div>;
}
