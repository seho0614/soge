#!/usr/bin/env node
/**
 * 실제 같은 시드 데이터.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────
 * 지금 시험 데이터는 등록 2건 · 요청 1건입니다. 이 정도로는
 * **목록이 비어 보이고, 정렬·필터·페이지가 도는지 알 수 없습니다.**
 * 인피드 광고는 8건마다 끼는데 목록이 2건이면 영원히 안 나옵니다.
 *
 * ── 무엇을 흉내내나 ─────────────────────────────────────────────────
 * 숫자를 채우는 것이 목적이 아닙니다. **실제로 올라올 법한 글**이라야
 * 분류·검수·신고가 제대로 도는지 알 수 있습니다.
 *
 *   · 제목은 사람이 쓰는 대로 — "급매", "권리금 없음", "직거래 환영"
 *   · 금액은 업종별 실제 범위 — 상가 권리금과 식자재 납품가는 자릿수가 다릅니다
 *   · 지역은 실제 시군구 — 지역 필터가 도는지 봐야 합니다
 *   · 일부는 **일부러 부실하게** — 체크리스트가 걸러내는지 봐야 합니다
 *
 * ── 그림은 넣지 않습니다 ────────────────────────────────────────────
 * 이미지는 용량만 키우고 아무것도 검증하지 못합니다.
 * image_key 에 경로 문자열만 넣습니다.
 *
 * ── 안전 ────────────────────────────────────────────────────────────
 * 시드 계정은 전부 `@seed.local` 이고, 지울 때 그 도메인만 지웁니다.
 * 실데이터가 섞인 DB 에서도 안전합니다.
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

/* 시드 계정도 로그인이 돼야 화면을 눌러 볼 수 있습니다.
   비밀번호는 개발 계정과 같습니다. */
const PW = 'sgb-dev-1234';

const SEED_DOMAIN = '@seed.local';

// ── 지역 — 실제 시군구. 지역 필터가 도는지 보려면 흩어져 있어야 합니다.
const REGIONS = [
  ['서울특별시', '강남구'], ['서울특별시', '송파구'], ['서울특별시', '마포구'],
  ['서울특별시', '영등포구'], ['경기도', '성남시 분당구'], ['경기도', '화성시'],
  ['경기도', '고양시 일산동구'], ['인천광역시', '남동구'], ['부산광역시', '해운대구'],
  ['대구광역시', '수성구'], ['충청남도', '천안시 서북구'], ['경상남도', '창원시 성산구'],
];

/* ── 등록 — 업종마다 실제로 쓰는 말과 금액대가 다릅니다 ──────────── */
const LISTINGS = [
  // 안심소개(MAL) — 부동산. 금액이 크고 평수·보증금이 핵심입니다.
  ['MAL','MAL_SHOP','강남 테헤란로 1층 상가 33평 급매',
   '역세권 1층 코너 상가입니다. 권리금 없이 넘깁니다. 현재 카페 운영 중이고 집기 그대로 인수 가능합니다. 임대료 월 450만원, 보증금 1억입니다.', 850000000],
  ['MAL','MAL_SHOP','홍대입구 먹자골목 2층 60평 임대',
   '유동인구 많은 자리입니다. 주방 설비 완비되어 있어 바로 영업 가능합니다. 보증금 5000만원 월세 300만원입니다.', 50000000],
  ['MAL','MAL_OFFICE','판교 테크노밸리 사무실 120평 임대',
   '10인 이상 사무공간입니다. 주차 4대 포함, 회의실 2개 별도입니다. 보증금 2억 월 900만원.', 200000000],
  ['MAL','MAL_FACTORY','화성 향남 공장 500평 매매',
   '제조업 허가 완료된 부지입니다. 전기 100kW 인입 완료, 크레인 5톤 설치되어 있습니다. 진입로 대형차 가능합니다.', 1800000000],
  ['MAL','MAL_LAND','천안 서북구 창고 부지 800평',
   '물류창고 용도로 적합합니다. 고속도로 IC 5분 거리이고 지목은 잡종지입니다.', 1200000000],
  ['MAL','MAL_APT','분당 정자동 아파트 34평 급매',
   '학군 좋은 단지입니다. 로열층이고 남향입니다. 즉시 입주 가능합니다.', 1350000000],
  ['MAL','MAL_SHOP','수성구 들안길 식당 자리 45평',
   '주차 10대 가능한 자리입니다. 기존 한식당이었고 주방 설비 포함입니다.', 120000000],

  // 소개창업(BIZ) — 권리금·인허가 승계가 핵심입니다.
  ['BIZ','BIZ_TRANSFER','해운대 고깃집 양도 · 월매출 4천',
   '7년 운영한 자리입니다. 단골 확보되어 있고 인허가 승계 가능합니다. 권리금 1억 2천이고 직원 3명 인수 희망합니다.', 120000000],
  ['BIZ','BIZ_FRANCHISE','무인 카페 가맹 · 초기비용 5천만원',
   '24시간 무인 운영입니다. 인건비 없이 돌아가고 본사 물류 주 2회 지원됩니다. 인허가 대행 포함입니다.', 50000000],
  ['BIZ','BIZ_UNMANNED','무인 아이스크림 매장 창업 문의',
   '10평 내외 자리 찾고 있습니다. 상권 분석 지원되며 권리금 없는 자리 선호합니다.', 35000000],
  ['BIZ','BIZ_NEWSTORE','프랜차이즈 분식 2호점 출점 부지',
   '역세권 1층 15평 이상 찾습니다. 인허가 승계 가능한 자리면 더 좋습니다.', 80000000],
  ['BIZ','BIZ_EQUIPMENT','중고 주방설비 일괄 · 폐업 정리',
   '업소용 냉장고 3대, 가스레인지, 튀김기 포함입니다. 3년 사용했고 상태 양호합니다.', 8000000],
  ['BIZ','BIZ_MA','소규모 제조업체 인수 희망',
   '연매출 10억 내외 업체를 찾습니다. 인허가와 거래처 승계가 조건입니다.', 2000000000],
  ['BIZ','BIZ_SPACE','일산 공유주방 자리 임대',
   '배달 전문 창업에 적합합니다. 후드와 배수 설비 완비, 보증금 1000만원입니다.', 10000000],

  // 소개머니(MNY) — 납품·용역. 금액이 작고 물량·주기가 핵심입니다.
  ['MNY','MNY_FOOD','식자재 납품처 찾습니다 · 월 3천만원',
   '프랜차이즈 20개 지점 공급입니다. 냉장 배송 가능한 업체를 찾습니다. 주 3회 납품이고 결제는 월 마감입니다.', 30000000],
  ['MNY','MNY_INTERIOR','상가 인테리어 시공 업체 소개 요청',
   '45평 카페 인테리어입니다. 도면 있고 3주 안에 완공 희망합니다. 견적 3곳 비교하려 합니다.', 60000000],
  ['MNY','MNY_LOGI','3PL 물류 업체 · 월 3천박스',
   '보관과 피킹, 배송까지 맡길 곳을 찾습니다. 수도권 당일 출고 가능해야 합니다.', 15000000],
  ['MNY','MNY_MACHINE','CNC 선반 중고 2대 판매',
   '2019년식이고 가동 시간 짧습니다. 정밀도 점검 완료했고 이전 설치 지원합니다.', 45000000],
  ['MNY','MNY_ENERGY','공장 지붕 태양광 설치 업체 소개',
   '지붕 면적 1200평입니다. 임대 방식과 자가 설치 둘 다 검토 중입니다.', 400000000],
  ['MNY','MNY_CAR','1톤 냉동탑차 3대 일괄',
   '2021년식입니다. 주행 8만km 내외이고 냉동기 점검 완료했습니다.', 75000000],
  ['MNY','MNY_DIGITAL','사무용 노트북 30대 납품',
   '신규 사무실 세팅용입니다. 견적과 납기 알려주시면 검토하겠습니다.', 36000000],
  ['MNY','MNY_CLOTH','단체복 제작 업체 찾습니다',
   '직원 120명 유니폼입니다. 자수 로고 포함이고 샘플 먼저 받아보고 싶습니다.', 9000000],

  // 건강상품(HLT) — 인증번호·유통기한이 핵심입니다.
  ['HLT','HLT_FUNC','홍삼 농축액 스틱 도매 · 건강기능식품 인정번호 제2019-15호',
   '개별인정형 원료입니다. 면역력 증진에 도움을 줄 수 있습니다. 유통기한 제조일로부터 24개월입니다.', 12000000],
  ['HLT','HLT_FOOD','국산 도라지청 납품 · 품목제조신고 제2024-8821호',
   '무첨가 제품입니다. 소비기한 18개월이고 OEM 생산 가능합니다.', 8000000],
  ['HLT','HLT_FITNESS','재활용 실내 자전거 20대 도매',
   '요양원 납품용입니다. 저강도 설계이고 안전 인증 완료했습니다.', 14000000],
  ['HLT','HLT_HYGIENE','손소독제 대용량 납품 · 의약외품 신고 완료',
   '500ml 펌프형입니다. 유통기한 36개월이고 월 1000개 이상 공급 가능합니다.', 5000000],

  /* ★ 일부러 부실하게 — 체크리스트가 걸러내는지 보려면 필요합니다.
     전부 완벽하면 검수 흐름이 도는지 알 수 없습니다. */
  ['MAL','MAL_SHOP','상가 팝니다',
   '연락주세요', 100000000],
  ['MNY','MNY_FOOD','납품',
   '식자재 납품합니다 연락바랍니다', 1000000],
];

/* ── 요청 — 찾는 쪽입니다. 조건이 구체적일수록 소개가 붙습니다 ──── */
const REQUESTS = [
  ['MAL','MAL_SHOP','강남·서초 1층 상가 30평 이상 찾습니다',
   '카페 창업 예정입니다. 권리금 1억 이하, 월세 400만원 이하 조건입니다. 즉시 입주 가능한 곳 우선합니다.'],
  ['BIZ','BIZ_TRANSFER','수도권 고깃집 양수 희망 · 월매출 3천 이상',
   '인허가 승계 가능한 곳을 찾습니다. 권리금 1억 5천까지 검토합니다.'],
  ['MNY','MNY_FOOD','축산물 납품 업체 소개 부탁드립니다',
   '고깃집 3개 지점 공급입니다. 등급 검증 가능한 곳이면 좋겠습니다. 월 3회 납품 예상합니다.'],
  ['MNY','MNY_INTERIOR','사무실 인테리어 견적 3곳 비교하고 싶습니다',
   '80평 규모이고 2개월 안에 완공 희망합니다. 도면은 있습니다.'],
  ['HLT','HLT_FUNC','건강기능식품 OEM 생산처 찾습니다',
   '자사 브랜드 출시 예정입니다. 개별인정형 원료 취급 가능한 곳이면 좋겠습니다.'],
  ['MAL','MAL_FACTORY','경기 남부 공장 300평 이상 임대',
   '제조업 허가 가능한 곳입니다. 전기 용량 50kW 이상 필요합니다.'],
  ['BIZ','BIZ_FRANCHISE','무인 매장 창업 상담 원합니다',
   '초기비용 5천만원 이내로 검토 중입니다. 상권 분석 지원되는 곳이 좋습니다.'],
  ['MNY','MNY_LOGI','풀필먼트 업체 소개 요청',
   '월 2천건 출고 예상합니다. 반품 처리까지 맡길 수 있는 곳을 찾습니다.'],
];

const NAMES = ['김도현','이서연','박지훈','최민서','정예준','강하윤','조시우','윤서아',
               '장準호','임수빈','한지안','오태현'];
const COMPANY = ['대한푸드','한빛유통','성일산업','태양에너지','현장인테리어','우리물류',
                 '정도상사','바른식품','미래설비','한결무역','신성기계','다온유통'];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);

  // ── 정리 — 시드 도메인만 지웁니다 ──────────────────────────────
  await c.query(`SET session_replication_role = replica`);
  await c.query(`DELETE FROM accounts WHERE email LIKE $1`, ['%' + SEED_DOMAIN]);
  await c.query(`SET session_replication_role = origin`);

  // ── 계정·사업자 ────────────────────────────────────────────────
  const hash = await bcrypt.hash(PW, 12);
  const accs = [];
  for (let i = 0; i < 12; i++) {
    const [a] = await q(
      `INSERT INTO accounts (email, password_hash, name, phone,
                             account_type, status, identity_verified_at)
       VALUES ($1,$2,$3,$4,'BUSINESS','ACTIVE', now()) RETURNING id`,
      [`seed${i + 1}${SEED_DOMAIN}`, hash, NAMES[i], `010-${4000 + i}-${1000 + i * 7}`]);
    const [r] = REGIONS[i % REGIONS.length] ? [REGIONS[i % REGIONS.length]] : [REGIONS[0]];
    const [b] = await q(
      `INSERT INTO businesses (account_id, biz_reg_no, company_name, ceo_name,
                               biz_type, biz_item, sido, sigungu, nts_status, verified_at)
       VALUES ($1,$2,$3,$4,'도소매','종합',$5,$6,'VALID', now()) RETURNING id`,
      [a.id, `${700 + i}-86-${50000 + i * 311}`, COMPANY[i], NAMES[i], r[0], r[1]]);
    accs.push({ account: a.id, business: b.id, sido: r[0], sigungu: r[1] });
  }

  /* ── 중개사 인증 ────────────────────────────────────────────────
   *
   * 부동산(MAL)을 올리려면 중개사 인증이 있어야 합니다(INV-BR1).
   * 게이트가 실제로 막았고, 그게 맞습니다 — 시드도 예외가 아닙니다.
   *
   * 앞 4명만 중개사로 둡니다. 전원이 중개사면 **인증 없는 사람이
   * 부동산을 못 올리는지** 확인할 수 없습니다. */
  const admin = accs[0].account;
  for (let i = 0; i < 4; i++) {
    await c.query(
      `INSERT INTO broker_verifications
         (business_id, license_no, office_name, ceo_name, state,
          lookup_result, lookup_at, decided_by, decided_at, recheck_due)
       VALUES ($1,$2,$3,$4,'VERIFIED','MATCH', now(), $5, now(), current_date + 180)`,
      [accs[i].business, `1111${i}-2026-0000${i + 1}`,
       `${COMPANY[i]}공인중개사사무소`, NAMES[i], admin]);
  }

  // ── 등록 ───────────────────────────────────────────────────────
  const cats = await q(`SELECT id, code, gwan_code FROM categories WHERE status='APPROVED'`);
  const catOf = (code) => cats.find((x) => x.code === code);

  let nList = 0;
  for (let i = 0; i < LISTINGS.length; i++) {
    const [gwan, catCode, title, body, fee] = LISTINGS[i];
    const cat = catOf(catCode);
    if (!cat) continue;
    /* 부동산은 중개사 인증이 있는 앞 4명만 올릴 수 있습니다. */
    const owner = gwan === 'MAL'
      ? accs[i % 4]
      : accs[i % accs.length];
    /* 등록 시점을 흩어 놓습니다 — 전부 같은 시각이면 "최신순" 이
       도는지 알 수 없고, 목록이 한 덩어리로 보입니다. */
    const daysAgo = (i * 3) % 45;
    await c.query(
      /* 지역은 등록이 아니라 사업자에 붙어 있습니다 —
         같은 사람이 여러 지역 물건을 올리는 일은 드물기 때문입니다. */
      `INSERT INTO listings (gwan_code, category_id, owner_account_id, title, body,
                             desired_fee, fee_bearer, status,
                             view_count, like_count, published_at, created_at)
       VALUES ($1,$2,$3,$4,$5,
               /* v10.34 — 안심소개 부동산은 소개비가 아니라 노출료(A-07 · D056 RE_EXPOSURE_FEE) — 희망 소개비를 비웁니다.
                  전에는 이 줄에서 시드가 멈춰, v10.31 뒤 새로 설치한 DB 에 실제 같은 시드가 하나도 들어가지 않았습니다 */
               CASE WHEN fn_is_realty_category($2) THEN NULL ELSE $6::numeric END,
               'SELLER','PUBLISHED',$7,$8,
               now() - ($9||' days')::interval, now() - ($9||' days')::interval)`,
      [gwan, cat.id, owner.account, title, body, Math.round(fee * 0.03),
       Math.floor(Math.random() * 400) + 20, Math.floor(Math.random() * 30),
       daysAgo]);
    nList++;
  }

  // ── 요청 ───────────────────────────────────────────────────────
  let nReq = 0;
  for (let i = 0; i < REQUESTS.length; i++) {
    const [gwan, catCode, title, body] = REQUESTS[i];
    const cat = catOf(catCode);
    if (!cat) continue;
    const asker = accs[(i + 5) % accs.length];
    await c.query(
      /* v10.34 — 요청은 등록 + 30일에 자동 마감(D044 · 시안 D-n). 시드도 마감일을 채웁니다 — 전에는 비어 있어 새 설치 DB 의 요청 카드에 D-n 이 없었습니다 */
      `INSERT INTO requests (gwan_code, category_id, owner_account_id, title, body,
                             status, created_at, closes_at)
       VALUES ($1,$2,$3,$4,$5,'PUBLISHED', now() - ($6||' days')::interval, now() - ($6||' days')::interval + interval '30 days')`,
      [gwan, cat.id, asker.account, title, body, (i * 2) % 20]);
    nReq++;
  }

  const [n] = await q(
    `SELECT (SELECT count(*) FROM accounts WHERE email LIKE '%${SEED_DOMAIN}') AS accounts,
            (SELECT count(*) FROM listings) AS listings,
            (SELECT count(*) FROM requests) AS requests`);
  /* ── 건강몰 (직판) ────────────────────────────────────────────────
   *
   * ★ 시드가 없으면 **화면을 열어도 빈 목록만 보입니다.**
   *   "만들었는데 안 보인다" 는 말이 여기서 나옵니다 — 코드는 도는데
   *   보여 줄 것이 없기 때문입니다.
   *
   *   의료기기는 심의필 번호를 넣습니다. 없으면 트리거가 막습니다. */
  {
    const hfood = (await c.query(
      `SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_FOOD'`)).rows[0];
    const hfunc = (await c.query(
      `SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_FUNC'`)).rows[0];
    const hdev = (await c.query(
      `SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_MEDDEV'`)).rows[0];
    const hfit = (await c.query(
      `SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_FITNESS'`)).rows[0];

    const prods = [
      ['RED-30',  '홍삼 농축액 스틱 30포',      hfood?.id, 45000, 20, null, 'FOOD_SEALED'],
      ['BELL-30', '도라지 배즙 100ml×30',       hfood?.id, 28000,  8, null, 'FOOD_SEALED'],
      ['LACT-30', '유산균 1000억 30포',         hfunc?.id, 39000,  0, null, 'FOOD_SEALED'],
      ['VITD-90', '비타민 D 1000IU 90정',       hfunc?.id, 18000, 45, null, 'FOOD_SEALED'],
      ['OMG-60',  '오메가-3 알티지 60캡슐',      hfunc?.id, 32000, 12, null, 'FOOD_SEALED'],
      /* 의료기기는 심의필 번호가 있어야 팝니다(의료기기법 24조). */
      ['BP-01',   '가정용 혈압계 자동 전자식',    hdev?.id,  52000,  7, '심의필 제2026-0451호', 'DEVICE'],
      ['THM-01',  '비접촉 체온계',              hdev?.id,  29000, 15, '심의필 제2026-0288호', 'DEVICE'],
      ['BIKE-01', '실내 자전거 접이식',          hfit?.id, 129000,  4, null, 'GENERAL'],
    ];
    /* ★ 판매자를 정해야 합니다(C710) — 없으면 주문 때 막힙니다. */
    const seller = (await c.query(
      `SELECT id FROM hlt_sellers WHERE code='SGB-DIRECT'`)).rows[0];

    /* ★ 20261008 (v10.25 · D025) — 잠금 · 미판매 갈래(건강기능식품 · 의료기기)의 상품은 「판매 중지」로 넣습니다.
     *   사장님 결정 「시안 값으로」: 의료기기는 판매하지 않음 · 건강기능식품은 2단계에 엶.
     *   「판매 중」으로 넣으면 상품 규칙(fn_hlt_product_guard)이 막습니다. 갈래를 열면 운영에서 판매 중으로 바꿉니다. */
    const closed = new Set((await c.query(
      `SELECT c.id FROM categories c
         JOIN hlt_sale_categories s ON s.category_code = c.code AND s.state IN ('LOCKED','NOT_SOLD')`)).rows.map((r) => r.id));
    for (const [code, name, cat, price, stock, review, wd] of prods) {
      if (!cat) continue;
      await c.query(
        `INSERT INTO hlt_products (code, name, category_id, price, stock,
                                   review_no, withdrawal_code, status, seller_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$9,$8)
         ON CONFLICT (code) DO NOTHING`,
        [code, name, cat, price, stock, review, wd, seller?.id ?? null, closed.has(cat) ? 'STOPPED' : 'ON_SALE']);
    }
    /* ★ 20261008 (v10.26 · D027) — 상품의 값 · 재고는 옵션에서 계산합니다. 옵션이 없는 상품에 「단품」 옵션 하나(값 · 재고 그대로).
     *   새로 설치하면 마이그레이션(D027 의 옮기기)이 이 시드보다 먼저 돌아 여기서 넣어야 합니다. */
    await c.query(
      `INSERT INTO hlt_product_options (product_id, months, price, stock, sort)
       SELECT p.id, NULL, p.price, p.stock, 0 FROM hlt_products p
        WHERE NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id)`);

    /* 성분 마스터. 부형제는 따로 표시해 목록에서 빼 줍니다.
     * ★ 20261008 (v10.26 · D027) — 시안의 성분 코드로 합쳤습니다(VIT-D → VITD · LACTO → PROBIO · GINSENG → REDGIN · CA → CALC).
     *   옛 코드로 넣으면 새로 설치한 DB 에 「비타민 D」가 두 줄 생깁니다. 성분 26줄 · 군 · 고민 14종은 D027 이 넣습니다(여기는 이름 · 다른 이름만 맞춤). */
    const ings = [
      ['VITD',    '비타민D',       ['비타민 D','콜레칼시페롤','비타민D3'], false],
      ['PROBIO',  '유산균',        ['락토바실러스'],             false],
      ['REDGIN',  '홍삼',          ['홍삼 농축액','인삼농축액'],  false],
      ['OMEGA3',  '오메가3',       ['EPA','DHA','어유','오메가-3'], false],
      ['VIT-B',   '비타민 B군',     ['B1','B2','B6','B12'],     false],
      ['CALC',    '칼슘',          ['탄산칼슘'],                false],
      ['WATER',   '정제수',        [],                          true],
      ['MGST',    '스테아린산마그네슘', [],                       true],
    ];
    for (const [code, name, aliases, exc] of ings) {
      await c.query(
        `INSERT INTO ingredients (code, name, aliases, is_excipient)
         VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO UPDATE SET aliases = EXCLUDED.aliases
           WHERE ingredients.aliases IS NULL OR ingredients.aliases = '{}'::text[]`,
        [code, name, aliases, exc]);
    }

    /* ★ 20261002 (v10.13) — 고민–성분 · 상품–성분 연결.
     *   D002 마이그레이션이 한 번 넣어 주지만, 새로 설치하면 마이그레이션이 **시드보다 먼저** 돌아
     *   그때는 성분 · 상품이 없어 0건으로 끝납니다 — 「고민별 · 성분별」 화면이 비어 보였습니다(실측).
     *   D002 와 같은 규칙으로 여기서 한 번 더 넣습니다. 여러 번 돌려도 같습니다(ON CONFLICT). */
    await c.query(
      `INSERT INTO hlt_concern_ingredients (concern_code, ingredient_code, sort)
       SELECT v.c, v.i, v.s
         FROM (VALUES ('IMMUNE','PROBIO',1), ('IMMUNE','VITD',3),
                      ('EYE','OMEGA3',2),
                      ('BONE','CALC',1), ('BONE','VITD',2),
                      ('GLUCOSE','PROBIO',2),
                      ('FATIGUE','REDGIN',2),
                      ('BRAIN','OMEGA3',2),
                      ('CIRC','OMEGA3',1), ('CIRC','REDGIN',2)) AS v(c, i, s)
        WHERE EXISTS (SELECT 1 FROM ingredients g WHERE g.code = v.i)
          AND EXISTS (SELECT 1 FROM hlt_concerns k WHERE k.code = v.c)
       ON CONFLICT DO NOTHING`);
    await c.query(
      `INSERT INTO hlt_product_ingredients (product_id, ingredient_code)
       SELECT DISTINCT p.id, g.code
         FROM hlt_products p
         CROSS JOIN ingredients g
         CROSS JOIN LATERAL unnest(array_prepend(g.name, coalesce(g.aliases, '{}'::text[]))) AS k(key)
        WHERE NOT g.is_excipient AND NOT g.is_group
          /* v10.26 — 이미 성분이 이어진 상품(견본 등)은 건드리지 않습니다(이름에 다른 성분 이름이 섞여 있어도) */
          AND NOT EXISTS (SELECT 1 FROM hlt_product_ingredients x WHERE x.product_id = p.id)
          AND char_length(lower(regexp_replace(k.key, '[\\s\\-·_]', '', 'g'))) >= 2
          AND strpos(lower(regexp_replace(p.name, '[\\s\\-·_]', '', 'g')),
                     lower(regexp_replace(k.key, '[\\s\\-·_]', '', 'g'))) > 0
       ON CONFLICT DO NOTHING`);
    /* v10.26 (D027) — 표제 성분(카드의 「성분 | 함량」)이 없는 상품은 첫 성분을 표제로 */
    await c.query(
      `UPDATE hlt_product_ingredients pi SET is_main = true
         FROM (SELECT DISTINCT ON (product_id) product_id, ingredient_code FROM hlt_product_ingredients
                ORDER BY product_id, sort, ingredient_code) f
        WHERE pi.product_id = f.product_id AND pi.ingredient_code = f.ingredient_code
          AND NOT EXISTS (SELECT 1 FROM hlt_product_ingredients m WHERE m.product_id = pi.product_id AND m.is_main)`);
  }

  /* ★ 20261002 (v10.14 · D021) — 소개광장 「이건 어때?」 투표 3건(메인 그림의 세 장).
   *   없으면 메인 카드가 「준비 중」으로만 보입니다. 표 수는 0 에서 시작합니다(실제 표 수만 보여 줍니다). */
  await c.query(require('fs').readFileSync(require('path').join(__dirname, 'seed-polls.sql'), 'utf8'));

  console.log(`  시드  계정 ${n.accounts} · 등록 ${nList} · 요청 ${nReq}`);
  console.log(`        전체 등록 ${n.listings} · 요청 ${n.requests}`);
  console.log(`        로그인  seed1${SEED_DOMAIN} / ${PW}`);
  await c.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
