/**
 * SB-HOM-MAIN-010 · 011 — 새 메인(「hero 페이지」 디자인 · v10.13)의 그림.
 *
 * 사장님 결정(2026-10-02): 「사용된 png 변경하지 않고 이미지 적용」 —
 *   사진 · 아이콘 · 로고는 **주신 그림에서 그대로 잘라** 씁니다(public/home/d/*.png · qa/crop_design.py). 새로 그리지 않습니다.
 *   원본 그림은 spec/design/hero_page_20261002.png (838×1877) 입니다. 원본 파일을 받으면 같은 이름으로 바꿔 넣으면 됩니다.
 *
 * 선으로 된 작은 기호(화살표 · 돋보기 · 위치 핀 테두리)만 여기서 그립니다 — 글자와 같은 화면 요소입니다.
 */

/** 잘라 낸 그림의 원래 크기(px). 화면에는 h 높이에 맞춰 같은 비율로 넣습니다 */
export const PIC: Record<string, [number, number]> = {
  logo: [134, 37], 'promo-art': [107, 160], banner: [451, 206],
  'sec-today': [27, 27], 'sec-need': [27, 27], 'sec-pick': [25, 26], 'sec-poll': [29, 29], 'sec-town': [32, 34], 'town-pin': [22, 29],
  'sec-trust': [35, 33], 'sec-startup': [32, 32], 'sec-forme': [27, 27], 'sec-core': [25, 25],
  'need-1': [33, 36], 'need-2': [33, 36], 'need-3': [37, 34], 'need-4': [34, 34], 'need-5': [29, 35],
  'rank-1': [67, 53], 'rank-2': [45, 48], 'rank-3': [41, 43], 'rank-user': [18, 22],
  'trust-1': [50, 48], 'trust-2': [52, 47], 'trust-3': [51, 46], 'trust-4': [55, 46],
  'core-1': [21, 21], 'core-2': [28, 29], 'core-3': [29, 30], 'core-4': [29, 30],
  flame: [18, 22], star: [13, 15], 'spark-s': [16, 19], spark: [25, 25],
  'sns-1': [20, 21], 'sns-2': [21, 21], 'sns-3': [21, 21], 'sns-4': [21, 20],
};

/** 그림 속 아이콘 — 높이 h(px)로 넣습니다. 장식이라 대체 글은 비웁니다(옆에 글자가 있습니다) */
export function Pic({ name, h, alt = '', cls }: { name: string; h: number; alt?: string; cls?: string }) {
  const [w0, h0] = PIC[name] ?? [1, 1];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`home-pic${cls ? ' ' + cls : ''}`} src={`/home/d/${name}.png`} width={Math.round((w0 * h) / h0)} height={h}
      alt={alt} aria-hidden={alt ? undefined : true} />
  );
}

/** 선으로 그린 작은 기호(24×24) — 글자색을 따릅니다 */
export const LINE: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  pin: '<path d="M12 21s7-5.7 7-11a7 7 0 0 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};

export function Line({ name, size = 20, w = 2 }: { name: string; size?: number; w?: number }) {
  return (
    <svg className="home-ln" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: LINE[name] ?? '' }} />
  );
}
