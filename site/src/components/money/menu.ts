/**
 * 소개장터 메인의 분야 14칸 · 왼쪽 분류 목록 — 2026-10-09 제시 디자인의 이름 그대로. v10.30
 *
 * ★ 이 분류는 **서버에 없습니다**(서버의 소개장터 업종은 이름이 다릅니다 — GET /categories?gwanCode=MNY).
 *   10/9 답 ① 「시안 + 실제 웹 모양 · DB 변경 없음」이라, 칸을 누르면 **그 이름의 첫 낱말이 제목 · 본문에 들어간 매물**로
 *   이 화면 아래의 목록(#mny-list)을 거릅니다(/money?keyword=… → GET /listings?gwanCode=MNY&keyword=…). 「전체」 · 「기타 …」는 거르지 않은 목록입니다.
 *   서버의 진짜 분류(골든 · 실버 · 브론즈)로 고르는 길은 그 목록 위의 「소개상품 찾기」에 그대로 있습니다.
 *   서버에 이 분류가 생기면 여기의 낱말을 분류 코드로 바꾸면 됩니다.
 */
import type { MnyPicName } from './pics';

/** 누르면 가는 곳 — 낱말이 없으면 거르지 않은 목록 */
export const listHref = (kw: string) => (kw ? `/money?keyword=${encodeURIComponent(kw)}#mny-list` : '/money#mny-list');

/** 분야 14칸 — [그림, 이름(사전 money.tiles.* 키), 찾는 낱말] · v10.97 이름은 사전에서(낱말은 검색값이라 그대로) */
export const TILES = [
  ['cat_all', 'all', ''], ['cat_furn', 'furn', '가구'], ['cat_clean', 'clean', '청소'], ['cat_move', 'move', '이사'],
  ['cat_used', 'used', '중고'], ['cat_office', 'office', '사무'], ['cat_make', 'make', '제조'], ['cat_build', 'build', '공사'],
  ['cat_design', 'design', '디자인'], ['cat_it', 'it', '개발'], ['cat_tax', 'tax', '세무'], ['cat_edu', 'edu', '교육'],
  ['cat_event', 'event', '행사'], ['cat_etc', 'etc', ''],
] as const satisfies readonly (readonly [MnyPicName, string, string])[];

/** 왼쪽 분류 목록 — 펼치는 묶음 2개(그림에서 「서비스」 줄이 고른 모양입니다 — 그 아이콘에 옅은 주황 바탕이 같이 들어 있어 그대로 둡니다)
 *  v10.97 — 이름은 사전 money.side.* 키(묶음 = side.group.<key> · 줄 = side.items.<이름 키>) · 찾는 낱말은 그대로 */
export const SIDE_GROUPS = [
  { key: 'goods', pic: 'side_goods', on: false,
    items: [['furn', '가구'], ['office', '사무용품'], ['used', '중고'], ['equip', '장비'], ['etcGoods', '']] },
  { key: 'service', pic: 'side_service', on: true,
    items: [['clean', '청소'], ['interior', '인테리어'], ['move', '이사'], ['install', '설치'], ['ad', '광고'], ['etcService', '']] },
] as const satisfies readonly { key: string; pic: MnyPicName; on?: boolean; items: readonly (readonly [string, string])[] }[];
/** 펼치지 않는 줄 3개 — [그림, 이름(사전 money.side.plain.* 키), 가는 곳, 찾는 낱말(없으면 다른 화면)] */
export const SIDE_PLAIN = [
  ['side_expert', 'expert', listHref('전문가'), '전문가'], ['side_company', 'company', listHref('업체'), '업체'], ['side_want', 'want', '/request', ''],
] as const satisfies readonly (readonly [MnyPicName, string, string, string])[];
