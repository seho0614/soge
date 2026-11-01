/**
 * v10.175 (docs/270) — 검색 결과용 구조화 정보(schema.org · JSON-LD).
 *   본문에 손님이 쓴 글(제목 · 설명)이 들어가므로 `<` 를 < 로 바꿔 스크립트 칸을 닫지 못하게 합니다.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return <script type="application/ld+json" data-jsonld="" dangerouslySetInnerHTML={{ __html: json }} />;
}

/** 이동 경로(홈 → … → 이 화면). 주소는 사이트 첫머리(origin)를 붙인 전체 주소 */
export function breadcrumbLd(origin: string, items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${origin}${it.path}` })),
  };
}
