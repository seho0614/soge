#!/usr/bin/env node
/**
 * 부하 시험용 대량 시드.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────
 * 30건으로는 **목록이 느려지는지 알 수 없습니다.** 인덱스가 빠져
 * 있어도 30건은 전부 훑어도 1밀리초입니다. 1만 건이 되어야
 * "어디가 느린가" 가 보입니다.
 *
 * ── 실데이터와 다른 점 ──────────────────────────────────────────────
 * 문장은 조합으로 만듭니다. 1만 개를 손으로 쓸 수는 없고, 부하
 * 시험에는 **글자 수와 분포**가 실제와 비슷하면 충분합니다.
 *
 * 다만 **치우침은 실제처럼** 둡니다 — 조회수는 소수가 대부분을
 * 가져가고, 지역도 수도권에 몰립니다. 고르게 만들면 정렬과
 * 인덱스가 실제보다 잘 도는 것처럼 보입니다.
 *
 * ── 지우기 ──────────────────────────────────────────────────────────
 * 계정 이메일이 전부 `@load.local` 입니다. 그 도메인만 지웁니다.
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DOMAIN = '@load.local';
const N_ACCOUNTS = Number(process.env.N_ACCOUNTS || 500);
const N_LISTINGS = Number(process.env.N_LISTINGS || 10000);
const N_REQUESTS = Number(process.env.N_REQUESTS || 1500);

const REGIONS = [
  ['서울특별시', '강남구', 22], ['서울특별시', '송파구', 10],
  ['서울특별시', '마포구', 8], ['서울특별시', '영등포구', 7],
  ['경기도', '성남시 분당구', 10], ['경기도', '화성시', 6],
  ['경기도', '고양시 일산동구', 6], ['인천광역시', '남동구', 5],
  ['부산광역시', '해운대구', 8], ['대구광역시', '수성구', 5],
  ['충청남도', '천안시 서북구', 4], ['경상남도', '창원시 성산구', 4],
  ['광주광역시', '서구', 3], ['대전광역시', '유성구', 2],
];

/* 제목 조각. 관마다 쓰는 말이 다릅니다 — 섞으면 분류·검색 시험이
   의미를 잃습니다. */
const PARTS = {
  MAL: {
    what: ['1층 상가', '2층 사무실', '지식산업센터', '공장 부지', '창고',
           '근린상가', '오피스텔', '단독주택', '상가주택', '물류센터'],
    size: ['15평', '28평', '33평', '45평', '60평', '80평', '120평', '200평', '450평'],
    deal: ['매매', '임대', '전대', '급매', '분양'],
    note: ['권리금 없음', '즉시 입주', '역세권', '주차 가능', '코너 자리',
           '리모델링 완료', '대로변', '엘리베이터 있음'],
  },
  BIZ: {
    what: ['한식당', '카페', '고깃집', '치킨집', '분식집', '편의점', '세탁소',
           '미용실', 'PC방', '스터디카페', '무인점포', '베이커리'],
    size: ['10평', '20평', '35평', '50평', '70평'],
    deal: ['양도', '양수 희망', '가맹 모집', '지점 출점', '인수 희망'],
    note: ['월매출 공개', '인허가 승계', '직원 인수 가능', '단골 확보',
           '권리금 협의', '즉시 영업', '시설 포함'],
  },
  MNY: {
    what: ['식자재', '포장재', '주방설비', '사무용 가구', '노트북', '냉동탑차',
           'CNC 선반', '지게차', '인테리어 시공', '물류 대행', '홈페이지 제작',
           '단체복', '간판 제작', '전기 공사'],
    size: ['월 500만원', '월 1,500만원', '월 3,000만원', '연 1억', '건당'],
    deal: ['납품', '업체 소개 요청', '견적 비교', '매각', '구매 희망'],
    note: ['장기 거래 희망', '샘플 먼저', '세금계산서 발행', '수도권 우선',
           '당일 출고', '월 마감 결제'],
  },
  HLT: {
    what: ['홍삼 농축액', '도라지청', '비타민', '유산균', '단백질 보충제',
           '손소독제', '마스크', '실내 자전거', '안마기', '혈압계'],
    size: ['100박스', '500개', '1,000개', '월 200세트'],
    deal: ['도매', 'OEM 생산처 찾습니다', '납품', '재고 정리'],
    note: ['인정번호 있음', '유통기한 24개월', '무첨가', '국산 원료',
           '식약처 신고 완료'],
  },
};

const BODY_TAIL = [
  '자세한 조건은 연락 주시면 알려 드리겠습니다.',
  '조건 협의 가능하며 빠른 진행을 원합니다.',
  '실물 확인 후 결정하셔도 됩니다.',
  '중개 수수료 별도이며 소개비는 협의합니다.',
  '거래 이력이 있는 곳을 우선합니다.',
];

const COMPANY_A = ['대한', '한빛', '성일', '태양', '현장', '우리', '정도', '바른',
                   '미래', '한결', '신성', '다온', '세종', '유진', '삼보'];
const COMPANY_B = ['유통', '산업', '상사', '테크', '물류', '푸드', '이엔지',
                   '트레이딩', '설비', '컴퍼니'];
const SURNAME = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오'];
const GIVEN = ['도현', '서연', '지훈', '민서', '예준', '하윤', '시우', '서아',
               '준호', '수빈', '지안', '태현', '유진', '성민'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const int = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* 조회수는 소수가 대부분을 가져갑니다 — 고르게 만들면 정렬이
   실제보다 잘 도는 것처럼 보입니다. */
function skewed(max) {
  const r = Math.random();
  return Math.floor(max * r * r * r) + int(0, 5);
}

function weightedRegion() {
  const total = REGIONS.reduce((s, r) => s + r[2], 0);
  let n = Math.random() * total;
  for (const r of REGIONS) { n -= r[2]; if (n <= 0) return r; }
  return REGIONS[0];
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  const t0 = Date.now();

  await c.query('SET session_replication_role = replica');
  await c.query(`DELETE FROM accounts WHERE email LIKE $1`, ['%' + DOMAIN]);
  await c.query('SET session_replication_role = origin');

  // ── 계정 · 사업자 ──────────────────────────────────────────────
  const hash = await bcrypt.hash('sgb-dev-1234', 4);   // 부하용이라 라운드를 낮춥니다
  const accs = [];
  for (let i = 0; i < N_ACCOUNTS; i++) {
    const [r] = REGIONS.length ? [weightedRegion()] : [REGIONS[0]];
    const name = pick(SURNAME) + pick(GIVEN);
    const [a] = await q(
      `INSERT INTO accounts (email, password_hash, name, phone,
                             account_type, status, identity_verified_at)
       VALUES ($1,$2,$3,$4,'BUSINESS','ACTIVE', now()) RETURNING id`,
      [`load${i}${DOMAIN}`, hash, name,
       `010-${String(3000 + (i % 6000)).padStart(4, '0')}-${String(1000 + i).slice(-4)}`]);
    const [b] = await q(
      `INSERT INTO businesses (account_id, biz_reg_no, company_name, ceo_name,
                               biz_type, biz_item, sido, sigungu, nts_status, verified_at)
       VALUES ($1,$2,$3,$4,'도소매','종합',$5,$6,'VALID', now()) RETURNING id`,
      /* 사업자번호는 i 로 **직접** 만듭니다 — 나눗셈·나머지를 섞으면
         계정이 늘었을 때 겹칩니다. 실제로 두 번 겪었습니다. */
      [a.id, `L${String(i).padStart(6, '0')}`,
       pick(COMPANY_A) + pick(COMPANY_B), name, r[0], r[1]]);
    accs.push({ account: a.id, business: b.id });
  }

  /* 부동산은 중개사만 올릴 수 있습니다(INV-BR1).
     앞 60명을 중개사로 둡니다 — 전원이면 게이트가 도는지 알 수 없습니다. */
  const admin = accs[0].account;
  for (let i = 0; i < Math.min(60, accs.length); i++) {
    await c.query(
      `INSERT INTO broker_verifications
         (business_id, license_no, office_name, ceo_name, state,
          lookup_result, lookup_at, decided_by, decided_at, recheck_due)
       VALUES ($1,$2,$3,'대표','VERIFIED','MATCH', now(), $4, now(), current_date + 180)
       ON CONFLICT DO NOTHING`,
      [accs[i].business, `${11110 + i}-2026-${String(10000 + i).slice(-5)}`,
       `부동산중개사무소${i}`, admin]);
  }

  // ── 등록 — COPY 로 넣습니다 ────────────────────────────────────
  const cats = await q(
    /* ★ 제한업종은 빼고 뽑습니다.
   　 안 빼면 도박 · 의약품 같은 것이 섞여 트리거가 막고,
   　 부하 시드가 **중간에 멈춥니다.** 방어는 정당합니다 —
   　 시드가 고를 것을 고르지 않은 것이 문제였습니다. */
    `SELECT c.id, c.gwan_code FROM categories c
      WHERE c.status='APPROVED'
        AND NOT EXISTS (
          SELECT 1 FROM restricted_industries r
           WHERE r.code = c.restricted_code AND r.is_active
             AND r.mode IN ('BLOCK','AD_ONLY','GATED'))`);
  const byGwan = {};
  for (const x of cats) (byGwan[x.gwan_code] ??= []).push(x.id);

  const GWANS = Object.keys(PARTS).filter((g) => byGwan[g]?.length);
  const brokers = accs.slice(0, 60);

  console.log(`  계정 ${accs.length} · 업종 ${cats.length} · 관 ${GWANS.join(',')}`);

  /* ── 대량은 COPY 로 ──────────────────────────────────────────────
   *
   * INSERT 를 500개씩 묶어도 100만 건이면 2000번 왕복합니다.
   * COPY 는 한 번에 밀어 넣어 **열 배 넘게 빠릅니다.**
   *
   * 다만 COPY 는 **트리거를 거칩니다** — 중개사 게이트가 그대로
   * 도므로, 부동산은 인증된 계정으로만 만들어야 합니다. */
  const useCopy = N_LISTINGS >= 50000;
  let made = 0;
  const BATCH = 500;

  if (useCopy) {
    const copyFrom = require('pg-copy-streams').from;
    const { pipeline } = require('stream/promises');
    const { Readable } = require('stream');

    const gen = function* () {
      for (let i = 0; i < N_LISTINGS; i++) {
        const g = GWANS[i % GWANS.length];
        const p = PARTS[g];
        const owner = g === 'MAL' ? pick(brokers) : pick(accs);
        const title = `${weightedRegion()[1]} ${pick(p.what)} ${pick(p.size)} ${pick(p.deal)}`;
        const body = `${pick(p.note)}. ${pick(p.note)}. ${pick(BODY_TAIL)}`;
        const days = int(0, 365);
        const at = new Date(Date.now() - days * 86400000).toISOString();
        yield [g, pick(byGwan[g]), owner.account, title, body,
               int(30, 3000) * 10000, 'SELLER', 'PUBLISHED',
               skewed(3000), skewed(120), at, at].join('\t') + '\n';
        if ((i + 1) % 200000 === 0) process.stdout.write(`  등록 ${i + 1}…\n`);
      }
    };

    await pipeline(
      Readable.from(gen()),
      c.query(copyFrom(
        `COPY listings (gwan_code, category_id, owner_account_id, title, body,
                        desired_fee, fee_bearer, status, view_count, like_count,
                        published_at, created_at) FROM STDIN`)));
    made = N_LISTINGS;
  } else
  for (let s = 0; s < N_LISTINGS; s += BATCH) {
    const vals = [];
    const args = [];
    let n = 0;
    for (let i = s; i < Math.min(s + BATCH, N_LISTINGS); i++) {
      const g = GWANS[i % GWANS.length];
      const p = PARTS[g];
      /* 부동산은 중개사 계정으로만 */
      const owner = g === 'MAL' ? pick(brokers) : pick(accs);
      const title = `${weightedRegion()[1]} ${pick(p.what)} ${pick(p.size)} ${pick(p.deal)}`;
      const body = `${pick(p.note)}. ${pick(p.note)}. ${pick(BODY_TAIL)}`;
      const fee = int(30, 3000) * 10000;
      const days = int(0, 180);
      vals.push(`($${++n},$${++n},$${++n},$${++n},$${++n},$${++n},'SELLER','PUBLISHED',$${++n},$${++n}, now() - ($${++n}||' days')::interval, now() - ($${++n}||' days')::interval)`);
      args.push(g, pick(byGwan[g]), owner.account, title, body, fee,
                skewed(3000), skewed(120), days, days);
    }
    await c.query(
      `INSERT INTO listings (gwan_code, category_id, owner_account_id, title, body,
                             desired_fee, fee_bearer, status, view_count, like_count,
                             published_at, created_at)
       VALUES ${vals.join(',')}`, args);
    made += Math.min(BATCH, N_LISTINGS - s);
    if (made % 2000 === 0) process.stdout.write(`  등록 ${made}…\n`);
  }

  // ── 요청 ───────────────────────────────────────────────────────
  let reqs = 0;
  for (let s = 0; s < N_REQUESTS; s += BATCH) {
    const vals = []; const args = []; let n = 0;
    for (let i = s; i < Math.min(s + BATCH, N_REQUESTS); i++) {
      const g = GWANS[i % GWANS.length];
      const p = PARTS[g];
      const asker = pick(accs);
      const title = `${weightedRegion()[1]} ${pick(p.what)} ${pick(p.deal)} 찾습니다`;
      const body = `${pick(p.note)}. ${pick(BODY_TAIL)}`;
      const days = int(0, 60);
      vals.push(`($${++n},$${++n},$${++n},$${++n},$${++n},'PUBLISHED', now() - ($${++n}||' days')::interval)`);
      args.push(g, pick(byGwan[g]), asker.account, title, body, days);
    }
    await c.query(
      `INSERT INTO requests (gwan_code, category_id, owner_account_id, title, body,
                             status, created_at)
       VALUES ${vals.join(',')}`, args);
    reqs += Math.min(BATCH, N_REQUESTS - s);
  }

  const [n] = await q(
    `SELECT (SELECT count(*) FROM listings) AS l,
            (SELECT count(*) FROM requests) AS r,
            (SELECT count(*) FROM accounts WHERE email LIKE '%${DOMAIN}') AS a`);
  console.log(`  완료  등록 ${n.l} · 요청 ${n.r} · 계정 ${n.a} · ${((Date.now()-t0)/1000).toFixed(1)}초`);
  await c.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
