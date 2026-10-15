/**
 * v10.29 — 관 화면(소개장터 · 안심소개 매물 · 소개창업) 시안 반영 — 관마다 다른 글 · 색 · 사진 규칙.
 *
 * 글은 시안(proto_lite.html 의 GLAND · CFG · tabnote · FEATS · QM)과 같습니다.
 * 숫자 · 목록(매물 · 분류 · 건수)은 여기 두지 않습니다 — 전부 API 응답으로 채웁니다.
 */
export type GwanCode = 'MNY' | 'MAL' | 'BIZ';

export interface GwanMeta {
  code: GwanCode;
  path: string;
  /** 시안 .gwl 의 관 색 클래스(소개장터는 없음 = 파랑) */
  cls: '' | 'mal' | 'biz';
  name: string;
  /** 「지금 인기 있는 ○○」 · 「총 N개의 ○○」 */
  sect: string;
  find: string;
  allcat: string;
  mine: string;
  /** 소개하기 탭 아래 안내 글 */
  tabnote: string;
}

export const GW: Record<GwanCode, GwanMeta> = {
  MNY: { code: 'MNY', path: 'money', cls: '', name: '소개장터', sect: '상품/서비스', find: '소개상품 찾기',
    allcat: '전체 상품 · 서비스', mine: '내가 등록한 상품/서비스', tabnote: '다양한 상품과 서비스를 소개하고 수익을 만들어보세요!' },
  MAL: { code: 'MAL', path: 'mall', cls: 'mal', name: '안심소개', sect: '매물/장비', find: '소개매물 찾기',
    allcat: '전체 매물 · 장비', mine: '내가 등록한 매물/장비', tabnote: '' },
  BIZ: { code: 'BIZ', path: 'biz', cls: 'biz', name: '소개창업', sect: '창업 아이템', find: '창업 아이템 찾기',
    allcat: '전체 창업 아이템', mine: '내가 등록한 창업 아이템', tabnote: '' },
};

export const isGwan = (c: string | undefined): c is GwanCode => c === 'MNY' || c === 'MAL' || c === 'BIZ';

/** v10.31 — 지역 설정 칸은 서버의 시 · 도(GET /market/regions)로 목록을 실제로 거릅니다(?region=시도코드). 이 표는 서버를 못 읽었을 때의 「전국」만 */
export const REGION_ALL = { code: '', name: '전국' };

/** 시안 FEATS — 아래 안내 6칸 */
export const FEATS: [string, string][] = [
  ['간편한 소개 등록', '누구나 쉽고 빠르게 상품, 서비스, 창업 아이템 등록'],
  ['소개 수익 지급', '거래 성사 시 소개자에게 수익 지급'],
  ['안전한 거래 지원', '계약서 양식 제공 및 분쟁 예방 가이드'],
  ['실시간 문의', '거래 상대와 실시간 채팅으로 빠른 상담 가능'],
  ['신뢰도 시스템', '후기와 평점으로 신뢰할 수 있는 거래'],
  ['전문가 매칭', '필요한 전문가와 1:1 매칭 지원'],
];

/** 시안 QM — 퀵메뉴 5칸. 실제 웹 주소는 소개장터 아래 퀵메뉴 화면입니다. */
export const QM: { key: string; em: string; label: string; href: string }[] = [
  { key: 'new', em: '🏆', label: '성공현황', href: '/money/new' },
  { key: 'best', em: '🎖', label: '베스트매칭', href: '/money/best' },
  { key: 'urgent', em: '🚨', label: '급구 · 급매', href: '/money/urgent' },
  { key: 'verified', em: '🛡', label: '사고예방', href: '/money/verified' },
  { key: 'event', em: '🎁', label: '이벤트존', href: '/money/event' },
];

/** 상품 분류 등급 — categories.gradeCode → 시안 골든 · 실버 · 브론즈(가칭) */
export const GRADES: { code: string; k: string; em: string; nm: string; sub: string }[] = [
  { code: 'G1', k: 'g1', em: '🏆', nm: '골든', sub: '높은 소개비' },
  { code: 'G2', k: 'g2', em: '🥈', nm: '실버', sub: '중간 소개비' },
  { code: 'G3', k: 'g3', em: '🥉', nm: '브론즈', sub: '부업 수준' },
];

/**
 * 매물 사진 — 시안 PHOTO_MAP 그대로(분류 이름에 든 말 → 그림). 첫 번째로 맞는 것을 씁니다. 없으면 shop.
 * 그림은 시안에 심어진 원본(proto_img/SGB_IMG)을 다시 압축하지 않고 public/proto-img/gwan/ 에 복사한 것입니다.
 */
const PHOTO_MAP: [string, string][] = [
  ['자동차', 'car'], ['중고차', 'car'], ['오토바이', 'car'], ['상용차', 'truck'], ['화물', 'truck'], ['물류', 'truck'],
  ['가전', 'mac'], ['디지털', 'mac'], ['장비', 'cnc'], ['부품', 'cnc'], ['기계', 'cnc'], ['설비', 'fridge'],
  ['인테리어', 'int'], ['사무실', 'int'], ['가구', 'int'], ['리모델링', 'int'], ['오피스', 'int'], ['임대', 'int'],
  ['아파트', 'apt'], ['주택', 'apt'], ['부동산', 'apt'], ['건물', 'shop'], ['상가', 'shop'], ['점포', 'shop'],
  ['매장', 'shop'], ['양수도', 'shop'], ['토지', 'land'], ['공장', 'land'], ['출점', 'land'], ['총판', 'land'],
  ['카페', 'cafe'], ['무인', 'cafe'], ['프랜차이즈', 'cafe'], ['창업', 'cafe'], ['가맹', 'cafe'],
  ['고깃집', 'bunsik'], ['외식', 'bunsik'], ['분식', 'bunsik'], ['배달', 'bunsik'],
  ['식자재', 'fruit'], ['농수', 'fruit'], ['식품', 'fruit'], ['청과', 'fruit'],
  ['의류', 'cloth'], ['패션', 'cloth'], ['잡화', 'cloth'],
  ['태양광', 'solar'], ['에너지', 'solar'],
  ['인수', 'mac'], ['합병', 'mac'], ['세무', 'mac'], ['법무', 'mac'], ['지분', 'mac'],
];

export function photoKey(categoryName: string | null | undefined): string {
  const t = String(categoryName ?? '');
  for (const [w, k] of PHOTO_MAP) if (t.includes(w)) return k;
  return 'shop';
}

/** 사진 주소 — 매물에 올린 사진(주소 꼴)이 있으면 그것을, 없으면 분류 그림 */
export function photoSrc(categoryName: string | null | undefined, media?: string[] | null): string {
  const m = (media ?? []).find((x) => /^(https?:)?\/\//.test(x) || x.startsWith('/'));
  return m ?? `/proto-img/gwan/${photoKey(categoryName)}.jpg`;
}

/** 정렬 — 시안 「소개비순 · 마감임박 · 소개비율 · 최신」(v10.31 — 서버 정렬 DEADLINE · FEE_RATIO 신설) + 개발에 있던 인기순(남김) */
export const SORTS: [string, string][] = [['FEE_DESC', '소개비순'], ['DEADLINE', '마감임박'], ['FEE_RATIO', '소개비율'], ['RECENT', '최신'], ['POPULAR', '인기']];

/** 소개 신뢰도 띠의 색 — 시안 trustBadge(70 이상 hi · 50 이상 mid · 그 밖 low) */
export const trustCls = (s: number) => (s >= 70 ? 'gw-hi' : s >= 50 ? 'gw-mid' : 'gw-low');

/** 카드의 「경기 수원시」 */
export const regionText = (r?: { sido: string; sigungu: string | null } | null) => (r ? `${r.sido}${r.sigungu ? ` ${r.sigungu}` : ''}` : '');

/** 빈 값은 빼고 주소를 만듭니다 — 정렬 · 필터를 주소에 남겨 그대로 공유할 수 있게 합니다. */
export function qhref(base: string, p: Record<string, string | undefined | null>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `${base}${s ? `?${s}` : ''}`;
}

/** 금액을 시안처럼 「180만원」 · 「1억 2,000만원」으로 — 만원 단위로 떨어질 때만. 아니면 원 단위 그대로 */
export function manwon(n: number | null | undefined): string {
  if (n == null) return '협의';
  if (n % 10000 !== 0 || n < 10000) return n.toLocaleString('ko-KR') + '원';
  const man = n / 10000;
  const eok = Math.floor(man / 10000);
  const rest = man % 10000;
  if (!eok) return `${rest.toLocaleString('ko-KR')}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
}
