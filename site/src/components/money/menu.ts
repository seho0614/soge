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

/** 분야 14칸 — [그림, 이름, 찾는 낱말] */
export const TILES: [MnyPicName, string, string][] = [
  ['cat_all', '전체', ''], ['cat_furn', '가구, 인테리어', '가구'], ['cat_clean', '청소, 방역', '청소'], ['cat_move', '이사, 운송', '이사'],
  ['cat_used', '중고 거래', '중고'], ['cat_office', '사무 용품', '사무'], ['cat_make', '제조, 유통', '제조'], ['cat_build', '공사, 시공', '공사'],
  ['cat_design', '디자인, 마케팅', '디자인'], ['cat_it', 'IT, 개발', '개발'], ['cat_tax', '세무, 노무', '세무'], ['cat_edu', '교육, 컨설팅', '교육'],
  ['cat_event', '행사, 모임', '행사'], ['cat_etc', '기타', ''],
];

/** 왼쪽 분류 목록 — 펼치는 묶음 2개(그림에서 「서비스」 줄이 고른 모양입니다 — 그 아이콘에 옅은 주황 바탕이 같이 들어 있어 그대로 둡니다) */
export const SIDE_GROUPS: { key: string; name: string; pic: MnyPicName; on?: boolean; items: [string, string][] }[] = [
  { key: 'goods', name: '상품', pic: 'side_goods',
    items: [['가구, 인테리어', '가구'], ['사무용품,전자기기', '사무용품'], ['중고 물품', '중고'], ['산업 장비', '장비'], ['기타 상품', '']] },
  { key: 'service', name: '서비스', pic: 'side_service', on: true,
    items: [['청소, 방역', '청소'], ['인테리어', '인테리어'], ['이사, 운송', '이사'], ['설치, 수리', '설치'], ['광고, 마케팅', '광고'], ['기타 서비스', '']] },
];
/** 펼치지 않는 줄 3개 — [그림, 이름, 가는 곳, 찾는 낱말(없으면 다른 화면)] */
export const SIDE_PLAIN: [MnyPicName, string, string, string][] = [
  ['side_expert', '전문가', listHref('전문가'), '전문가'], ['side_company', '업체', listHref('업체'), '업체'], ['side_want', '구해요 / 의뢰', '/request', ''],
];
