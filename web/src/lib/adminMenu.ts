/**
 * 운영 화면 메뉴 (v10.29).
 *
 * 시안(운영 화면 admNav)은 어두운 상단바에 **묶음 메뉴 20개**를 둡니다. 개발은 탭 44개를 흰 바에 3줄로
 * 늘어놓았습니다(높이 188). 탭은 그대로 두고(키 · 글자 · 권한 · 화면 모두 같음) 시안의 묶음 아래로 모읍니다.
 *   · 상단바(.bo-head nav) = 묶음. 누르면 그 묶음에서 볼 수 있는 첫 탭으로 갑니다.
 *   · 본문 위 줄(.ad-snb) = 그 묶음의 탭(시안 .tabs2 모양). 탭이 하나뿐인 묶음은 줄을 그리지 않습니다.
 *   · 탭 안의 하위 탭(.subtabs)은 그대로입니다.
 * 시안 묶음에 없는 탭은 가장 가까운 묶음에 두었습니다(diffs/admin.json 「개발에만있음」).
 * 시안의 「관 분리」 · 「서버 연동」은 개발에 맞는 탭이 없어 두지 않습니다(빈 메뉴를 만들지 않음 — diffs 기록).
 */

export const TABS = [
  ['home', '대시보드'],
  ['reports', '경영 지표'],
  ['report-queue', '신고 처리'],
  ['events', '이벤트'],
  ['ai-ops', 'AI 운영'],
  ['ad-billing', '광고 과금'],
  ['collect', '수집 관리'],
  ['queue', '검수 큐'],
  ['badges', '배지 신청'],
  ['audit', '표본 감사'],
  ['rules', '자동검수 규칙'],
  ['disputes', '분쟁'],
  ['category', '업종 승인'],
  ['members', '회원'],
  ['users', '사업자 인증'],
  ['community', '글 검수'],
  ['polls', '이건 어때? 투표'],
  ['ownership', '소유 확인'],
  ['deals', '거래 모니터링'],
  ['settlement', '정산'],
  ['payouts', '지급'],
  ['hlt-settle', '소개몰 정산'],
  ['hlt-products', '소개몰 상품'],
  ['hlt-orders', '소개몰 주문'],
  ['hlt-reviews', '소개몰 리뷰 · 문의'],
  ['billing', '청구'],
  ['checklist', '오픈 체크리스트'],
  ['policy', '정책'],
  ['siteinfo', '법정 고지'],
  ['i18n', '번역'],   /* v10.93 다국어 1단계(D115 · docs/150) */
  ['integrations', '외부 연동'],
  ['mainops', '메인 운영'],
  ['gwans', '관 관리'],
  ['hub', '통합 허브'],
  ['partners', '파트너'],
  ['partner-axes', '안심소개 입점 심사'],
  ['directory', '법률·세무 정액 노출'],
  ['affiliates', '제휴'],
  ['quals', '자격 심사'],
  ['risk', '위험감지'],
  ['ads', '광고'],
  ['roles', '권한 관리'],
  ['gov-audit', '감사'],
  ['invariants', '불변식'],
  ['codes', '코드 라벨'],
  /* v10.31 (10/10 시안 기준) — 시안에 있는데 개발에 화면이 없던 4화면 */
  ['integ', '통합 현황'],
  ['adx', '외부 송출'],
  ['adx-payout', '퍼블리셔 지급'],
  ['gwan-ux', '관 UI/UX'],
] as const;

export type Tab = (typeof TABS)[number][0];
export const tabLabel = (t: Tab) => TABS.find(([k]) => k === t)?.[1] ?? t;

/** 시안 admNav 의 묶음 — 순서 · 글자는 시안 그대로. key 는 시안 화면 키(data-group 으로 남김) */
export interface MenuGroup { key: string; label: string; tabs: Tab[] }
export const GROUPS: MenuGroup[] = [
  { key: 'adm',     label: '대시보드',  tabs: ['home'] },
  { key: 'admrev',  label: '검수',      tabs: ['queue', 'rules', 'audit', 'badges', 'hlt-reviews'] },
  { key: 'admptn',  label: '파트너사',  tabs: ['partners', 'partner-axes', 'directory'] },
  { key: 'admstl',  label: '정산',      tabs: ['settlement', 'payouts', 'hlt-settle', 'billing'] },
  { key: 'admdel',  label: '거래',      tabs: ['deals', 'disputes', 'hlt-orders'] },
  { key: 'admusr',  label: '회원',      tabs: ['members', 'users'] },
  { key: 'admcat',  label: '업종',      tabs: ['category'] },
  { key: 'admdsp',  label: '노출',      tabs: ['mainops'] },
  { key: 'admpol',  label: '정책',      tabs: ['policy', 'codes'] },
  { key: 'admsit',  label: '관 관리',   tabs: ['gwans', 'gwan-ux', 'hub', 'checklist', 'siteinfo', 'i18n', 'hlt-products'] },
  { key: 'admad',   label: '광고',      tabs: ['ads', 'ad-billing', 'adx', 'adx-payout'] },
  { key: 'admrsk',  label: '위험감지',  tabs: ['risk', 'report-queue', 'ai-ops', 'gov-audit'] },
  { key: 'admbrk',  label: '인증 심사', tabs: ['quals', 'ownership'] },
  { key: 'admcmu',  label: '소개광장',  tabs: ['community', 'polls', 'events'] },
  { key: 'affapl',  label: '제휴',      tabs: ['affiliates'] },
  { key: 'integ',   label: '통합 현황', tabs: ['integ', 'integrations', 'reports', 'collect'] },
  { key: 'acl',     label: '권한 계층', tabs: ['roles'] },
  { key: 'invreg',  label: '불변식',    tabs: ['invariants'] },
];

export const groupOf = (t: Tab): MenuGroup => GROUPS.find((g) => g.tabs.includes(t)) ?? GROUPS[0]!;

/**
 * v10.32 — 하위 화면이 시안에서 다른 묶음에 속하는 경우 상단바에서 켜 둘 묶음(키 = '탭/하위', 값 = 묶음 key).
 * 주소(#/quals/medical)와 본문 위 탭 줄(.ad-snb — 그 탭이 든 묶음)은 그대로 두고, 상단바의 켜진 묶음만 시안대로 바꿉니다.
 * 시안은 의료 심의(admptnm) · 카테고리 마스터(admptnc)를 파트너사 화면(ptnShell)에 둡니다.
 */
export const SUB_GROUP: Record<string, string> = {
  'quals/medical': 'admptn',
  'quals/cats':    'admptn',
};

/* 탭이 묶음에서 빠지면 그 화면으로 갈 길이 없어집니다 — 개발 중에 바로 알립니다 */
if (import.meta.env.DEV) {
  const placed = GROUPS.flatMap((g) => g.tabs);
  const missing = TABS.map(([k]) => k).filter((k) => !placed.includes(k));
  const dup = placed.filter((k, i) => placed.indexOf(k) !== i);
  if (missing.length || dup.length) console.warn('[adminMenu] 묶음에 없는 탭', missing, '두 번 든 탭', dup);
}

/**
 * 탭마다 본문 위 제목 · 설명 줄 (시안 page(title, sub) — .pgh).
 * 시안 글을 그대로 쓰되, 서버 자료로 확인할 수 없는 건수(「규칙 7종」 「감시 뷰 43개」 등)와
 * 개발과 정책이 다른 문장은 빼거나 개발 문장으로 두었습니다(diffs 「정책문구차이」).
 */
export const PAGE: Record<Tab, { title: string; sub?: string; screen?: string }> = {
  home:          { title: '운영 대시보드', sub: '오늘 처리해야 할 것과 처리할 수 있는 양을 같이 봅니다.', screen: 'SB-ADM-DSH-010' },
  reports:       { title: '경영 지표', sub: '어긋남 신호 · 결정 대기 · 매출 · 최근 30일을 한 화면에서 봅니다.' },
  queue:         { title: '리스팅 검수', sub: 'SLA 24시간 기준입니다. 잔여 4시간 미만은 임박, 초과 건은 행이 강조됩니다.', screen: 'SB-ADM-REV-010' },
  rules:         { title: '자동검수 규칙', sub: '금칙어와 제한업종입니다. 배포 없이 바뀌지만, 잘못 넣으면 정상 등록이 반려됩니다.', screen: 'SB-ADM-REV-030' },
  audit:         { title: '표본 감사', sub: '자동 승인된 건을 표본으로 다시 봅니다. 자동검수가 놓치는 것이 있는지 확인하는 자리입니다.', screen: 'SB-ADM-REV-040' },
  badges:        { title: '배지 검수', sub: '신뢰 배지 신청을 봅니다. 배지는 목록 노출에 영향을 주므로 근거 없이 주면 안 됩니다.', screen: 'SB-ADM-BDG-010' },
  'hlt-reviews': { title: '소개몰 리뷰 · 문의', sub: '리뷰는 바로 보이고, 효능 · 효과를 단정하는 표현에 걸린 것만 여기서 확인합니다. 상품 문의는 운영자가 답합니다.', screen: 'SB-ADM-HRV-010' },
  partners:      { title: '파트너사', sub: '파트너센터(파트너사가 쓰는 별도 사이트)에서 올라오는 것을 본사가 처리하는 자리입니다.', screen: 'SB-ADM-PTN-010' },
  'partner-axes':{ title: '안심소개 입점 심사', sub: '안심소개 입점 신청을 축별로 심사합니다.' },
  directory:     { title: '법률 · 세무 정액 노출', sub: '법률 · 세무 전문가의 정액 노출을 관리합니다.' },
  settlement:    { title: '정산 승인', sub: '신청 → 승인 → 지급 실행. 소개비에서 떼는 금액은 없습니다 (INV-9). 지급은 당사자가 직접 합니다 (INV-11).', screen: 'SB-ADM-STL-010' },
  payouts:       { title: '지급 데스크', sub: '확정된 지급을 보내고 기록합니다. 확정은 운영, 지급 기록은 지급 담당이 합니다.', screen: 'SB-ADM-PAY-010' },
  'hlt-settle':  { title: '소개몰 정산', sub: '주 단위로 마감합니다. 배송 완료 후 7일(청약철회 기간)이 지난 건만 집계합니다.', screen: 'SB-ADM-HST-010' },
  billing:       { title: '청구 현황', sub: '구독료가 매출의 전부입니다. 이 화면이 곧 매출 감시입니다. 유예 일수와 재시도 횟수는 코드가 아니라 설정에 있어 여기서 바꾸면 즉시 반영됩니다.', screen: 'SB-ADM-BIL-010' },
  deals:         { title: '거래 감독', sub: '진행 중인 거래와 분쟁 건을 봅니다. 7일간 양측 확인이 안 된 건은 여기로 자동 승격됩니다. 관리자도 임의로 성사를 확정할 수 없습니다 (INV-4).', screen: 'SB-ADM-DEL-010' },
  disputes:      { title: '분쟁 처리', sub: '접수된 분쟁을 처리합니다. 분쟁이 걸린 거래는 정산이 보류됩니다.', screen: 'SB-ADM-DSP-010' },
  'hlt-orders':  { title: '소개몰 주문', sub: '결제 완료 주문의 발송을 처리합니다 — 택배사 · 송장번호를 넣으면 배송중, 「배송 완료로」를 누르면 배송 완료.', screen: 'SB-ADM-HOR-010' },
  members:       { title: '회원 목록', sub: '이름 · 이메일 · 연락처로 찾습니다.', screen: 'SB-ADM-MBR-010' },
  users:         { title: '회원 관리', sub: '사업자 신청을 승인 · 반려하고 회원을 정지합니다. 승인 시각이 소개비 수령 자격의 기준일입니다 (INV-10).', screen: 'SB-ADM-USR-010' },
  category:      { title: '업종 관리', sub: '업종은 열린 집합입니다 — 신청 → 승인 → 노출 (A-02).', screen: 'SB-ADM-CAT-010' },
  mainops:       { title: '메인 운영', sub: '메인에 무엇을 띄울지 정합니다. 광고는 추천 순위에 섞이지 않고 별도 슬롯에만 나갑니다. 배포 없이 즉시 반영됩니다.', screen: 'SB-ADM-MAIN-010' },
  policy:        { title: '정책', sub: '화면이 따르는 규칙의 원본입니다. 여기 값이 바뀌면 화면 문구와 계산이 함께 바뀝니다.', screen: 'SB-ADM-POL-010' },
  codes:         { title: '코드 라벨', sub: '화면에 보이는 상태 문구입니다. 코드는 고정이고 라벨만 바뀝니다.', screen: 'SB-ADM-COD-010' },
  gwans:         { title: '사이트 · 관 관리', sub: '관은 코드가 아니라 데이터입니다. 여기서 만든 관이 그대로 하나의 사이트가 됩니다.', screen: 'SB-ADM-SIT-010' },
  hub:           { title: '통합 메인 관리', sub: '통합 메인은 관이 아닙니다 — 관으로 보내는 허브입니다.', screen: 'SB-ADM-SIT-050' },
  checklist:     { title: '오픈 체크리스트', sub: '하나라도 미충족이면 오픈 버튼이 열리지 않습니다. 무엇이 막고 있는지 여기서 봅니다.', screen: 'SB-ADM-SIT-040' },
  siteinfo:      { title: '사이트 기본 정보 · 법정 고지', sub: '푸터 법정 고지의 원본입니다.', screen: 'SB-ADM-SIT-070' },
  i18n:          { title: '번역', sub: '다국어 — 번역을 넣고 승인합니다. 승인한 번역만, 다국어를 켠 뒤 손님 화면에 나갑니다.', screen: 'SB-ADM-TRN-010' },
  'hlt-products':{ title: '소개몰 상품', sub: '상품 · 옵션(묶음 개수) · 재고 · 그림 · 고시를 넣고 고칩니다.', screen: 'SB-ADM-HPR-010' },
  ads:           { title: '광고 관리', sub: '메인 광고 자리에 어떤 소재를 누구에게 내보낼지 정합니다. 소재 · 슬롯 · 세그먼트 세 가지가 전부입니다.', screen: 'SB-ADM-ADS-010' },
  'ad-billing':  { title: '광고 과금 · 정산', sub: '광고주 · 청구 · 입금 · 미수금. 광고비는 우리가 받는 돈이라 소개비와 따로 답니다.', screen: 'SB-ADM-ADB-010' },
  risk:          { title: 'AI 위험감지', sub: '규칙을 로그에 걸어 경보를 만듭니다. 경보마다 근거 · 규칙 원문 · 오탐 가능성을 함께 봅니다. 규칙은 숨기지 않습니다.', screen: 'SB-ADM-RSK-010' },
  'report-queue':{ title: '신고 처리', sub: '오래된 것이 위로 옵니다 — 신고해 놓고 답이 없으면 다음부터 신고를 안 합니다.', screen: 'SB-ADM-RPT-010' },
  'ai-ops':      { title: 'AI 운영', sub: '분류 · 검색 · 성향 · 위험감지의 품질을 보고 학습을 고칩니다.', screen: 'SB-ADM-AIS-010' },
  'gov-audit':   { title: '감사', sub: '징후를 보고 판단을 남깁니다.', screen: 'SB-ADM-AUD-010' },
  quals:         { title: '인증 · 자격 심사', sub: '자동 대조를 통과한 신청만 사람이 봅니다. 자격이 승인돼야 그 업종의 서비스 등록이 열립니다.', screen: 'SB-ADM-BRK-010' },
  ownership:     { title: '소유 확인 대기', sub: '등기사항증명서를 직접 보고 판단하십시오.', screen: 'SB-ADM-OWN-010' },
  community:     { title: '소개광장 검수', sub: '첫 글 · 신고된 글을 보고, 모든 글과 댓글을 찾아 감추거나 되살립니다.', screen: 'SB-ADM-CMU-010' },
  polls:         { title: '투표 관리', sub: '소개광장 「이건 어때?」와 메인의 세 장에 나오는 투표를 만들고 엽니다. 참여 수는 실제 표 수입니다.', screen: 'SB-ADM-CMU-020' },
  events:        { title: '이벤트 관리', sub: '지급 대기를 먼저 보여 줍니다 — 이벤트를 여는 것보다 약속한 것을 주는 일이 중요합니다.', screen: 'SB-ADM-EVT-010' },
  affiliates:    { title: '제휴 파트너스', sub: '관리자가 승인해야 링크를 발급할 수 있습니다. 입점 심사 · 제휴상품 · 목표 · 자료 · 정산을 여기서 처리합니다.', screen: 'SB-AFF-APL-010' },
  integrations:  { title: '외부 연동', sub: '연동 상태와 다음에 할 일입니다. 오픈을 막는 것이 무엇인지 여기서 봅니다.', screen: 'SB-ADM-SIT-080' },
  collect:       { title: '수집 관리', sub: '식약처 성분 데이터를 받아 우리 마스터와 대조합니다. 게이트를 모두 통과해야 돕니다.', screen: 'SB-ADM-COL-010' },
  roles:         { title: '권한 계층', sub: '역할과 가진 사람, 바뀐 이력을 봅니다.', screen: 'SB-ADM-ACL-010' },
  integ:         { title: '통합 현황', sub: '지금 어떤 상태인지 한 장으로 봅니다. 숫자는 실제 DB 조회값과 서버에 등록된 라우트입니다.', screen: 'SB-ADM-ITG-010' },
  adx:           { title: '광고 플랫폼 (외부 송출)', sub: '소개뱅크 지면뿐 아니라 외부 사이트에도 광고를 싣고, 클릭당 과금해 퍼블리셔와 나눕니다.', screen: 'SB-ADS-PLT-010' },
  'adx-payout':  { title: '퍼블리셔 지급', sub: '월 마감 → 명세서 → 신청 → 승인 → 집행. 각 단계에 사람이 다르고, 각 단계에 막는 장치가 있습니다.', screen: 'SB-ADS-PAY-010' },
  'gwan-ux':     { title: '관 UI/UX 관리', sub: '관마다 성격이 다르면 화면도 달라야 합니다. 축을 켜고 끄고, 축의 UI 유형을 여기서 정합니다.', screen: 'SB-ADM-GWN-010' },
  invariants:    { title: '불변식 현황', sub: '감시 뷰를 한 번에 훑습니다.', screen: 'SB-ADM-INV-010' },
};

/**
 * v10.32 — 하위 화면의 제목 줄(시안은 하위 화면마다 자기 제목을 씁니다). 키 = '탭/하위'(주소 #/탭/하위).
 * 여기 있으면 위 공통 제목 줄이 PAGE[탭] 대신 이 제목을 그립니다. 하위 탭 줄 · 묶음 줄은 그대로입니다.
 */
export const SUB_PAGE: Record<string, { title: string; sub?: string; screen?: string }> = {
  'ai-ops/agent': { title: 'AI 에이전트', sub: '스위치 · 월 상한 · 사용량 · AI 검수 일치율. 상한이 0 이면 아무것도 부르지 않습니다.', screen: 'SB-ADM-AGT-010' },
  'ai-ops/segments-preview': { title: '옮길 대상 미리보기', sub: '학습을 실행하면 옮겨질 회원입니다. 실행 전에 확인합니다.', screen: 'SB-ADM-SEG-020' },
  'gov-audit/logs':          { title: '감사 기록', sub: '운영 · 회원 행위 기록입니다. 고치거나 지울 수 없습니다.', screen: 'SB-ADM-AUD-020' },
  'partners/detail':         { title: '파트너사 상세', sub: '입점 파트너사 한 곳의 계약 · 서비스 · 리드 · 이용료를 한 화면에서 봅니다.', screen: 'SB-ADM-PTN-011' },
  'partners/rejects':        { title: '리드 반려 · 인정 / 기각', sub: '인정하면 이용료가 무효가 되고 리드가 없던 것이 됩니다. 기각하면 사유가 파트너에게 갑니다 (T-04).', screen: 'SB-ADM-PTN-050' },
  'quals/medical':           { title: '의료 심의 · 본사 확인', sub: '심의필을 확인해야 광고 가능(AD_READY)으로 넘어가 광고가 시작됩니다 — 의료법 제27조 (T-03).', screen: 'SB-ADM-PTN-040' },
  'quals/detail':            { title: '인증 심사 상세', sub: '승인은 심사 대기이고 국토부 대조가 일치할 때만 됩니다. 반려에는 사유가 반드시 있어야 합니다.', screen: 'SB-ADM-BRK-011' },
  'quals/cats':              { title: '카테고리 마스터', sub: '카테고리가 등록 폼과 단가 입력 방식을 정합니다 (T-05 · T-06).', screen: 'SB-ADM-PTN-060' },
  'gwans/new':               { title: '새 관 만들기', sub: '순서가 중요합니다 — 무엇을 소개하는 관인지 먼저 정해야 나머지가 정해집니다.', screen: 'SB-ADM-SIT-020' },
};
