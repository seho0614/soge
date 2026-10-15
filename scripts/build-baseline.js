#!/usr/bin/env node
/**
 * 기준선(baseline) 생성기.
 *
 * ── 왜 만드는가 ─────────────────────────────────────────────────────
 * 마이그레이션이 51개까지 늘었고, 그중 일부는 출처가 불분명합니다.
 * 이력이 길어질수록 "지금 스키마가 왜 이런가"를 읽어내기 어렵고,
 * 새로 합류하는 사람은 51개를 순서대로 따라가야 현재 모습을 압니다.
 *
 * 검증된 현재 상태를 하나의 기준선으로 다시 씁니다.
 * 오픈 전이므로 이력을 접을 수 있는 마지막 시점입니다.
 *
 * ── 무엇을 보장하는가 ───────────────────────────────────────────────
 * 이 스크립트는 스키마를 "다시 설계"하지 않습니다.
 * 이미 194건(불변식 135 · 공격 37 · 문서 22)을 통과한 상태를
 * 그대로 옮겨 담고, 재구축 결과가 원본과 같은지 차분으로 증명합니다.
 *
 * 손으로 다시 쓰면 171개 함수 어딘가가 미묘하게 달라집니다.
 * 그 차이는 검정을 통과하면서도 운영에서 드러납니다.
 * 옮겨 담고 증명하는 편이 안전합니다.
 *
 * 사용:
 *   node scripts/build-baseline.js          # prisma/baseline/ 생성
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const URL = process.env.DATABASE_URL;
if (!URL) { console.error('DATABASE_URL 필요'); process.exit(1); }

const OUT = path.join(__dirname, '..', 'prisma', 'baseline');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const pg = (args) => execFileSync('pg_dump', [URL, ...args], { encoding: 'utf8', maxBuffer: 64e6 });

/* ── 1. 스키마 덤프 ─────────────────────────────────────────────── */
const schema = pg(['--schema-only', '--no-owner', '--no-privileges']);

/* 덤프를 문장 단위로 쪼갭니다. $$ 로 감싼 함수 본문 안의 세미콜론에
 * 걸리면 안 되므로 달러 인용을 추적합니다. */
function statements(sql) {
  const out = [];
  let buf = '';
  let tag = null;                      // 열려 있는 $tag$ 구간
  for (const line of sql.split('\n')) {
    if (/^\s*--/.test(line) && !buf.trim()) continue;   // 덤프 주석 제거
    buf += line + '\n';
    const marks = line.match(/\$[A-Za-z_]*\$/g) || [];
    for (const m of marks) {
      if (tag === null) tag = m;
      else if (tag === m) tag = null;
    }
    if (tag === null && /;\s*$/.test(line)) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const stmts = statements(schema)
  .filter((s) => !/^\\/.test(s))                     // \restrict 등 psql 메타명령
  .filter((s) => !/^SET /i.test(s))
  .filter((s) => !/^SELECT pg_catalog\.set_config/i.test(s))
  .filter((s) => !/^COMMENT ON EXTENSION/i.test(s))
  /* schema_migrations 는 러너가 스스로 만드는 표입니다.
   * 덤프에 섞여 들어오면 기준선이 그것을 다시 만들려다 충돌합니다. */
  .filter((s) => !/schema_migrations/i.test(s))
  /* 기준선은 몇 번을 돌려도 같은 결과여야 합니다.
   * pg_dump 는 CREATE SCHEMA / CREATE EXTENSION 을 조건 없이 씁니다.
   * 이미 있으면 거기서 멈추므로 IF NOT EXISTS 를 붙입니다. */
  .map((s) => s
    .replace(/^CREATE SCHEMA (?!IF NOT EXISTS)/i, 'CREATE SCHEMA IF NOT EXISTS ')
    .replace(/^CREATE EXTENSION (?!IF NOT EXISTS)/i, 'CREATE EXTENSION IF NOT EXISTS '));

/* ── 2. 단계별 분류 ─────────────────────────────────────────────── */
/* 도메인(회원·거래·정산...)으로 나누고 싶지만 그러면 순서가 깨집니다.
 *
 * pg_dump 는 의존 순서대로 씁니다 — 확장 → 함수 → 테이블 → 시퀀스
 * → 기본값 → 제약 → 인덱스 → 트리거 → 뷰 → 외래키.
 * 이 순서를 도메인으로 재배열하면 "시퀀스가 아직 없다" 같은 오류가 납니다.
 * 실제로 term_agreements_id_seq 에서 그렇게 깨졌습니다.
 *
 * 그래서 순서를 그대로 두고 단계로만 자릅니다.
 * 읽기에는 도메인별이 낫지만, 돌지 않는 기준선은 쓸모가 없습니다.
 */
const PHASE = [
  ['B010_extension_schema', '확장과 스키마. 다른 모든 것의 전제입니다.',
    (s) => /^CREATE (EXTENSION|SCHEMA)/i.test(s)],
  ['B030_types', '열거형과 도메인 타입.',
    (s) => /^CREATE (TYPE|DOMAIN)/i.test(s)],
  ['B040_tables', '테이블 70개와 시퀀스. 컬럼에 없는 것이 곧 설계입니다 — 공제·계좌 컬럼이 없습니다(INV-9R · INV-11).',
    (s) => /^CREATE (TABLE|SEQUENCE)/i.test(s) || /^ALTER SEQUENCE/i.test(s)],
  ['B050_defaults', '기본값 바인딩.',
    (s) => /^ALTER TABLE .* ALTER COLUMN .* SET DEFAULT/i.test(s)],
  ['B060_constraints', '기본키 · 유일제약 · CHECK 82개. CHECK 는 INSERT 와 UPDATE 양쪽에 걸리므로 트리거보다 안전합니다.',
    (s) => /^ALTER TABLE .* ADD CONSTRAINT/i.test(s) && !/FOREIGN KEY/i.test(s)],
  ['B070_indexes', '인덱스 127개.',
    (s) => /^CREATE (UNIQUE )?INDEX/i.test(s)],
  ['B075_functions',
    'SQL 함수 171개. 업무 규칙의 집행체입니다.\n-- 테이블 뒤에 둡니다 — LANGUAGE sql 함수는 생성 시점에 참조 테이블을 검사하므로\n-- 앞에 두면 "relation does not exist" 로 깨집니다(plpgsql 은 늦게 검사해 안 깨집니다).',
    (s) => /^CREATE (OR REPLACE )?(FUNCTION|PROCEDURE)/i.test(s)],
  ['B080_views', '뷰 34개. 조회 경로와 회귀 감시(INV-9 · INV-11 · 미아 참조 · 문구 충돌)를 포함합니다.',
    (s) => /^CREATE (OR REPLACE )?(VIEW|MATERIALIZED VIEW)/i.test(s)],
  ['B090_triggers', '트리거 50개. 불변식이 실제로 집행되는 자리입니다.',
    (s) => /^CREATE TRIGGER/i.test(s)],
  ['B100_foreign_keys', '외래키. 참조 대상이 모두 만들어진 뒤에 겁니다.',
    (s) => /^ALTER TABLE .* ADD CONSTRAINT .* FOREIGN KEY/i.test(s)],
  ['B110_comments', '주석. 스키마를 읽는 사람에게 남기는 설명입니다.',
    (s) => /^COMMENT ON/i.test(s)],
];

const bucket = new Map(PHASE.map(([n]) => [n, []]));
bucket.set('B120_rest', []);

for (const st of stmts) {
  // ALTER TABLE ONLY public.x\n    ADD CONSTRAINT ... 처럼 문장이 여러 줄로
  // 나뉘어 있습니다. 줄 단위 정규식으로는 못 잡으므로 공백을 눌러 판정합니다.
  const flat = st.replace(/\s+/g, ' ').trim();
  const hit = PHASE.find(([, , test]) => test(flat));
  bucket.get(hit ? hit[0] : 'B120_rest').push(st);   // 순서 보존
}

/* ── 3. 파일로 씁니다 ───────────────────────────────────────────── */
const HEAD = (title, note) =>
`-- =====================================================================
-- ${title}
--
-- ${note}
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

`;

let n = 0;
const write = (name, note, list) => {
  if (!list.length) return;
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'migration.sql'), HEAD(name, note) + list.join('\n\n') + '\n');
  n += list.length;
  console.log(`  ${name.padEnd(24)} ${String(list.length).padStart(4)} 문장`);
};

/* 함수끼리 의존 순서를 맞춥니다.
 *
 * pg_dump 는 이름순으로 뽑아, **쓰는 함수가 정의보다 앞에 놓일 수**
 * 있습니다. 개발 DB 에는 이미 있어 안 보이고, 받은 사람이 빈 DB 로
 * 처음 세울 때만 "function does not exist" 로 멈춥니다.
 *
 * 실제로 두 번 겪었습니다(fn_match_scores). 여기서 한 번 정렬하면
 * 다시 겪지 않습니다. */
function sortFunctions(list) {
  const name = (s) => (s.match(/CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?(\w+)/i) || [])[1];
  const defined = new Set(list.map(name).filter(Boolean));
  const out = [], placed = new Set();

  const put = (st, depth) => {
    const n = name(st);
    if (!n || placed.has(n)) return;
    placed.add(n);                       // 순환 방지 — 먼저 표시합니다
    if (depth < 12) {
      /* 이 함수가 부르는 다른 함수를 먼저 놓습니다. */
      for (const m of st.matchAll(/\b(fn_\w+)\s*\(/g)) {
        if (m[1] !== n && defined.has(m[1]) && !placed.has(m[1])) {
          const dep = list.find((x) => name(x) === m[1]);
          if (dep) put(dep, depth + 1);
        }
      }
    }
    out.push(st);
  };

  for (const st of list) put(st, 0);
  for (const st of list) if (!out.includes(st)) out.push(st);   // 누락 방지
  return out;
}

for (const [name, note] of PHASE) {
  const list = bucket.get(name);
  write(name, note, name === 'B075_functions' ? sortFunctions(list) : list);
}
write('B120_rest', '위 단계에 들지 않은 나머지 문장.', bucket.get('B120_rest'));

/* ── 4. 기준 데이터 ─────────────────────────────────────────────── */
/* 기준 데이터를 담는 표 목록.
 *
 * ★ 표를 새로 만들면서 여기에 추가하지 않으면, 다음에 기준선을 접을 때
 *   그 데이터가 통째로 사라집니다. 스키마는 남고 값만 없어지므로
 *   마이그레이션은 성공하고 화면만 비어 보입니다 — 원인을 찾기 어렵습니다.
 *
 * 새 표를 만들었다면 그 자리에서 이 목록에 넣으십시오. */
const REF = [
  // 관 · 분류 · 정책
  'gwans','categories','subscription_plans','attribution_policies','auto_review_policies',
  'banned_words','restricted_industries','review_reason_codes','code_labels','site_settings',
  'setting_placeholders','footer_links','integrations','notification_templates',
  'notification_event_policies','faqs','ui_messages','gwan_form_copy',
  // ★ terms 는 담지 않습니다.
  //
  //   본문은 gen-terms-draft.js 가 만들고, 상태·시행일은 publish-terms.sh 가
  //   정합니다. 기준선이 담으면 재구축 때 **옛 초안이 생성물을 덮고
  //   발행 상태까지 지웁니다.**
  //
  //   실제로 두 번 겪었습니다 — 이용약관이 2,964자에서 11자
  //   ("이용약관 본문입니다.")로 돌아갔고, 10월 1일 발행이 사라졌습니다.
  //
  //   빈 행은 C010_terms_rows 가 만듭니다. 행이 있어야 생성기가 UPDATE 할
  //   대상이 생기기 때문입니다.
  //
  //   그래서 기준선은 **뼈대(code·version·title·is_required)만** 담고,
  //   본문과 발행 상태는 gen-terms-draft.js 와 publish-terms.sh 가 정합니다.
  // 광고 · 성향 (C010 · C020)
  'ad_segments','ad_slots','ad_placements','ad_creative_segments',
  'profile_questions','profile_options',
  // AI (C030 · C040)
  'classify_categories','classify_vocab', 'restrict_vocab','recommend_weights','risk_rules',
  // 감사 이상 판정 기준 (C540)
  //
  // ★ 기준이 없으면 **이상한지 아닌지 판단할 수가 없습니다.**
  //   담지 않으면 재구축 때 사라져 감시가 통째로 꺼집니다.
  'audit_thresholds',
  /* ★ 표준계약서 양식. 담지 않으면 재구축 때 사라지고, FK 가 걸린
     기존 계약 검정 10건이 깨집니다(2026-09-18 실제 발생). */
  'contract_templates',
  /* 건강몰 판매자 · 수수료율 — 기본값이 있어야 주문이 돕니다 */
  'hlt_sellers','hlt_commission_rates','withdrawal_rules',
  // 구조 개편 · 소개자 (C050 · C100)
  //
  // ★ 여기에 넣을 것과 넣지 말 것을 구분하십시오.
  //   넣을 것   서비스가 동작하려면 반드시 있어야 하는 값 (품목·포인트 규칙)
  //   넣지 말 것 픽스처가 만든 시험 데이터 (accounts · deals · listings …)
  //
  // 시험 계정이 기준선에 박히면 운영에 그대로 따라갑니다.
  // 목록이 허용 방식이라 실수로 섞이지는 않지만, 추가할 때 한 번 더 보십시오.
  'item_types','point_rules',
  // 자격 기준 · 메인 구성 (C010_qualifications · C010_main_sections)
  //
  // ★ 새 표를 만들면 여기 넣어야 합니다. 안 넣으면 재구축 때
  //   데이터가 통째로 사라지는데 **오류는 나지 않습니다.**
  //   이번에도 자격 기준 5건 · 메인 구역 5건 · 문구 3건이 없어졌습니다.
  'qualification_rules','main_sections','main_copy',
  // 결정 대기 항목 — 착수하면 안 되는 것을 알려 주는 기준 데이터입니다.
  // 사라지면 다음 사람이 C3 종속을 모르고 카테고리 등급표를 만듭니다.
  'pending_decisions',
  // 광고 정가표 — 기준 데이터입니다. A-07 부동산 노출료도 여기 들어갑니다.
  // ad_bookings 는 운영 기록이라 넣지 않습니다.
  'ad_products',
  // 리드 등급 비율표 — 기준 데이터입니다. 사라지면 단가표가 전개되지 않습니다.
  // broker_verifications 는 운영 기록이라 넣지 않습니다.
  'lead_grade_rates',
  // 신고 사유 · 신뢰도 가중치 · 등록 체크리스트 — 전부 기준 데이터입니다.
  // 사라지면 신고가 접수되지 않고, 신뢰도가 0이 되고, 자동 노출이 멈춥니다.
  // reports 는 운영 기록이라 넣지 않습니다.
  'report_reasons','trust_weights','listing_checklist',
  // 가입 유형과 순서 — 사라지면 가입 화면이 빕니다.
  'signup_types',
  // 배치 주기 (C010_job_schedule)
  //
  // ★ 이것이 빠지면 배치가 하나도 안 돕니다.
  //   tick 은 job_schedules 를 보고 무엇을 돌릴지 정하는데,
  //   표가 비면 "돌 것이 없다"고 판단하고 조용히 끝납니다.
  //   오류도 나지 않습니다 — 실제로 이번에 11건이 통째로 사라졌습니다.
  'job_schedules',
];

/* 줄 단위로 INSERT 만 골라내면 안 됩니다.
 * 알림 문구처럼 본문에 줄바꿈이 든 값은 INSERT 가 여러 줄에 걸치고,
 * 그러면 문자열 한가운데가 잘려 문법 오류가 납니다.
 * 문장 단위로 자릅니다. */
const rawData = pg(['--data-only','--no-owner','--column-inserts',
                    ...REF.flatMap(t => ['-t', `public.${t}`])]);
/* 약관은 뼈대만 담습니다.
 *
 * 본문까지 담으면 재구축 때 **옛 초안이 생성물을 덮습니다** —
 * 실제로 이용약관이 2,964자에서 11자로 되돌아갔고,
 * 발행 상태도 함께 지워졌습니다.
 *
 * 본문은 gen-terms-draft.js 가, 발행은 publish-terms.sh 가 정합니다.
 * 기준선은 "어떤 약관이 있어야 하는가"만 압니다. */
const data = statements(rawData)
  .filter(st => /^INSERT INTO/i.test(st))
  /* ★ terms 행은 기준선에 담지 않습니다.
   *
   *   본문은 gen-terms-draft.js 가, 발행 상태와 시행일은
   *   publish-terms.sh 가 정합니다. 기준선이 이것을 담으면
   *   재구축할 때마다 **발행이 취소되고 본문이 초안으로 되돌아갑니다.**
   *
   *   실제로 두 번 겪었습니다 — 이용약관이 2,964자에서 11자로 돌아갔고,
   *   2026-11-11 시행으로 발행한 것이 LEGAL_REVIEW 로 되돌아갔습니다.
   *   그 상태로 오픈하면 이용자가 무엇에 동의했는지 증명할 수 없습니다.
   *
   *   빈 표로 시작하면 gen-terms-draft.js 가 6종을 만들어 넣습니다. */
  .filter(st => !/INSERT INTO public\.terms\b/i.test(st))
  .join('\n');

const dir = path.join(OUT, 'B900_reference_data');
fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'migration.sql'),
  HEAD('B900_reference_data',
       '기준 데이터. 관 · 요금제 · 금칙어 · 코드 라벨 · 약관 · 알림 문구 등\n-- 서비스가 동작하려면 반드시 있어야 하는 값들입니다.') +
  '-- 트리거가 이 적재를 막지 않도록 잠시 내립니다.\n' +
  "SET session_replication_role = 'replica';\n\n" +
  data + '\n\n' +
  "SET session_replication_role = 'origin';\n");

/* ★ terms 빈 행을 항상 뒤에 붙입니다.
 *
 * terms 는 REF 에 없습니다 — 본문을 담으면 재구축 때 옛 초안이
 * 생성물을 덮고 발행 상태까지 지우기 때문입니다.
 *
 * 그런데 행마저 없으면 생성기가 UPDATE 할 대상이 사라져
 * **약관이 통째로 없어집니다.** 이번 작업에서 두 번 겪었습니다.
 *
 * 행만 만들고 내용은 gen-terms-draft.js 와 publish-terms.sh 에 맡깁니다. */
fs.appendFileSync(path.join(dir, 'migration.sql'), `
-- ── 약관 행 (본문·상태 제외) ────────────────────────────────────────
/* ── 감사 이상 판정 기준 ────────────────────────────────────────────
 *
 * ★ 표가 비어 있을 때 기준선을 만들면 **담기지 않습니다.**
 *   담기지 않으면 재구축 때 감시가 통째로 꺼지고, 그러면
 *   새벽에 개인정보 50건을 열어도 아무 일이 안 일어납니다.
 *
 *   그래서 terms 처럼 **씨앗을 직접 심습니다.** */
INSERT INTO public.audit_thresholds (code, label, threshold, window_hrs, note) VALUES
 ('PII_BURST',   '개인정보 다량 열람',    20, 24, '한 사람이 하루에 이만큼 넘게 열면 확인하십시오.'),
 ('PII_NIGHT',   '업무 시간 밖 열람',      5, 24, '밤 10시~아침 7시 열람. 이유가 남아야 합니다.'),
 ('ADMIN_BURST', '운영 행위 몰림',        50, 24, '자동화 도구를 쓰고 있을 수 있습니다.'),
 ('ADMIN_NIGHT', '밤에 운영 행위',        10, 24, '계정이 털렸을 수 있습니다.'),
 ('SAME_TARGET', '같은 사람을 반복 열람',  5, 24, '가장 흔한 유출 형태입니다 — 아는 사람을 들여다봅니다.')
ON CONFLICT (code) DO NOTHING;

/* ★ terms 는 gwans 보다 **뒤에** 와야 합니다 — gwan_code 가 관을
 *   가리키는 FK 라, 관이 없으면 넣을 수 없습니다(건강몰 직판 약관). */
INSERT INTO public.terms (code, version, title, body, status, is_required, effective_from, display_order, gwan_code)
VALUES
 ('SERVICE',    '1.0', '이용약관',               '', 'DRAFT', true,  'infinity', 1, NULL),
 ('PRIVACY',    '1.0', '개인정보처리방침',       '', 'DRAFT', true,  'infinity', 2, NULL),
 ('REFUND',     '1.0', '구독 환불 정책',         '', 'DRAFT', true,  'infinity', 3, NULL),
 /* ★ 회원 간 전달은 **필수 동의**입니다 — 위탁이 아닙니다(2026-09-16).
  *   거래 상대방은 저희 지시를 받지 않고 자기 사업 목적으로 씁니다. */
 ('THIRDPARTY', '1.0', '제3자 제공 동의 (회원 간)', '', 'DRAFT', true,  'infinity', 4, NULL),
 ('OUTSOURCE',  '1.0', '개인정보 처리업무 위탁',    '', 'DRAFT', false, 'infinity', 5, NULL),
 /* ★ 위치기반은 **폐기**했습니다(2026-09-16) — 단말기 위치를 수집하지
  *   않고 주소를 직접 입력받을 뿐이라 해당하지 않습니다.
  *   없는 서비스의 약관을 두면 신고 의무가 따라붙습니다. */
 ('LOCATION',   '1.0', '위치기반서비스 이용약관','(폐기 — 위치정보를 수집하지 않습니다)', 'ARCHIVED', false, 'infinity', 9, NULL),
 ('MARKETING',  '1.0', '마케팅 수신 동의',       '', 'DRAFT', false, 'infinity', 6, NULL),
 ('ADPERSONAL', '1.0', '맞춤형 광고 동의',       '', 'DRAFT', false, 'infinity', 7, NULL),
 /* ★ 건강상품관은 **직판**이라 약관이 따로입니다(C580).
  *   다른 관은 통신판매중개업자지만 여기는 통신판매업자입니다 —
  *   반품·환불 책임이 우리에게 있습니다. */
 ('HLT_SALE',   '1.0', '건강상품 판매 약관 (직판)', '', 'DRAFT', true, 'infinity', 8, 'HLT')
ON CONFLICT (code, version) DO NOTHING;


`);

console.log(`  B900_reference_data      ${data.split('\n').length} 행`);
console.log(`\n총 ${n} 문장 · ${OUT}`);
