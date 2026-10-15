/**
 * 소개장터 메인의 그림 — 2026-10-09 제시 디자인(docs/design/money_main_20261009.webp)에서 **그 자리만 자른 PNG** (public/money). v10.29
 *
 * · 색 · 크기를 바꾸지 않았습니다(qa/cut_money.py --check 가 원본의 그 자리와 점 하나까지 같은지 봅니다 · 자리는 qa/money_assets.json).
 * · 원본이 화면 1500px 의 2배라 화면에는 절반 크기로 놓습니다 — 아래 숫자가 그 크기(css px)입니다. 고해상도 화면에서 또렷합니다.
 * · <img> 로 그대로 씁니다(next/image 는 webp 로 바꿔 내주므로 쓰지 않습니다 — components/b2 와 같은 규칙).
 * · 이 표는 qa/money_assets.json 의 site = true 인 것과 같아야 합니다(qa/site_mny.py 가 견줍니다).
 * · v10.31 (w2) — 서버 자료로 그리게 된 구역의 기호 6개(flame · side_region · badge_s · star · pin · pin_s)를 시안 MNY_ART 원본 바이트 그대로 더했습니다.
 *   견본 사진(svc_* · ai_* · req_* · case_* · band_ad · hero_ad)은 넣지 않습니다 — 그 자리는 실제 매물 사진(없으면 분류 그림) · 실제 광고 소재입니다.
 */
export const MNY_PIC = {
  logo: [216, 52],
  spark: [26, 27.5],
  flame: [14.5, 18],          // v10.31 — 많이 찾는 키워드
  side_region: [26, 26.5],    // v10.31 — 지역으로 찾기
  badge_s: [26.5, 26.5],      // v10.31 — 최근 실제 연결 사례
  star: [21, 20],             // v10.31 — 업체 카드 별점
  pin: [15.5, 19],            // v10.31 — 업체 카드 · 연결 사례 지역
  pin_s: [15, 18],            // v10.31 — 요청 줄 지역
  quick_send: [73.5, 61.5],
  quick_want: [76.5, 61.5],
  quick_recv: [53, 63.5],
  cat_all: [32, 43.5],
  cat_furn: [42, 38.5],
  cat_clean: [33, 39.5],
  cat_move: [36, 38.5],
  cat_used: [36.5, 38.5],
  cat_office: [37.5, 38.5],
  cat_make: [37.5, 39.5],
  cat_build: [36.5, 38.5],
  cat_design: [40.5, 38.5],
  cat_it: [41.5, 38.5],
  cat_tax: [35.5, 39],
  cat_edu: [40, 39.5],
  cat_event: [35.5, 39],
  cat_etc: [33, 38.5],
  side_goods: [24.5, 26],
  side_service: [25, 26],
  side_expert: [23, 25],
  side_company: [27, 24.5],
  side_want: [26.5, 26.5],
  badge: [33, 33],
  logo_foot: [203, 52],
  sns_fb: [32, 32],
  sns_ig: [32, 32],
  sns_yt: [32.5, 32],
} as const;
export type MnyPicName = keyof typeof MNY_PIC;

export function MnyPic({ name, alt = '' }: { name: MnyPicName; alt?: string }) {
  const [w, h] = MNY_PIC[name];
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/money/${name}.png`} width={w} height={h} alt={alt} aria-hidden={alt ? undefined : true} />;
}
