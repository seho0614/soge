#!/usr/bin/env node
/**
 * Flow 설계서 생성.
 * 거래 7단계를 화면 → API → 서비스 → 테이블 → 불변식으로 관통해 그립니다.
 * 손으로 쓰면 API 하나 추가할 때마다 어긋납니다.
 */
const fs = require('fs');
const S = JSON.parse(fs.readFileSync('spec/screens.json','utf8'));
const D = JSON.parse(fs.readFileSync('docs/06_openapi.json','utf8'));
const N = JSON.parse(fs.readFileSync('spec/notifications.json','utf8'));
const smap = Object.fromEntries(S.screens.map(s=>[s.id,s]));

const FLOWS = [
  { id:'F0', name:'가입 · 인증', trigger:'소개코드 링크 유입 또는 직접 방문',
    steps:[
      { screen:'SB-HOM-MAIN-011', act:'유입', api:null,
        data:'attribution_events INSERT (사이트 미들웨어가 ?ref= 를 보고 POST /attribution/touch — 24시간 중복 차단)', inv:'INV-2 기록',
        note:'비로그인이어도 visitor_key 로 기록합니다' },
      { screen:'SB-HOM-AUT-020', act:'가입', api:'POST /auth/signup',
        data:'accounts(INDIVIDUAL) · account_roles · visitor_identities', inv:'INV-10',
        note:'★ visitorKey 를 함께 보내야 비로그인 유입이 연결됩니다' },
      { screen:'SB-HOM-AUT-030', act:'사업자 신청', api:'POST /businesses',
        data:'businesses · review_items(BUSINESS)', inv:null,
        note:'전건 수동 검수. 법적 판단이 섞여 자동화 대상이 아닙니다' },
      { screen:'SB-ADM-USR-010', act:'승인', api:'PATCH /admin/businesses/{id}/verify',
        data:'businesses.verified_at · accounts.account_type=BUSINESS · BIZ_OWNER 부여',
        inv:'INV-10 기준일', note:'승격이지 재가입이 아닙니다 — 귀속 기록이 끊기면 안 됩니다' },
    ]},
  { id:'F1', name:'등록 · 검수', trigger:'사업자가 매물 등록',
    steps:[
      { screen:'SB-HOM-REG-010', act:'등록', api:'POST /listings',
        data:'listings(IN_REVIEW) · listing_versions · review_items', inv:'INV-6 · 슬롯 한도',
        note:'제한업종·금칙어·슬롯은 DB가 판정 → 422' },
      { screen:null, act:'자동검수 판정', api:null,
        data:'fn_auto_review_reasons() → review_items.manual_reasons', inv:null,
        note:'빈 배열이면 자동 승인 → 즉시 PUBLISHED · 5% 표본 감사' },
      { screen:'SB-ADM-REV-010', act:'수동 검수', api:'GET /admin/reviews',
        data:'SLA 마감 순 정렬 (부분 인덱스)', inv:'SLA 24h',
        note:'개입 사유를 카드에 표시 — 왜 보고 있는지 알아야 어디를 봅니다' },
      { screen:'SB-ADM-REV-020', act:'승인 · 반려', api:'PATCH /admin/reviews/{id}',
        data:'review_items · review_events · listings.status · audit_logs', inv:null,
        note:'반려는 사유 코드 필수. 같은 트랜잭션에서 대상 상태 전이' },
    ]},
  { id:'F2', name:'탐색 · 문의', trigger:'구매자가 매물 탐색',
    steps:[
      { screen:'SB-MNY-LST-010', act:'목록', api:'GET /listings',
        data:'promoted / organic 분리 반환', inv:'INV-11 · 전상법',
        note:'섞으면 프런트가 라벨을 빠뜨려 표시 의무 위반이 발생합니다' },
      { screen:'SB-MNY-DTL-010', act:'상세', api:'GET /listings/{id}',
        data:'canInquire · inquireBlockReason 서버 판정', inv:'INV-7',
        note:'★ CTA 배치 — 문의하기 주 동선, 전화하기 보조' },
      { screen:'SB-HOM-MCH-010', act:'문의', api:'POST /conversations',
        data:'conversations · messages', inv:'INV-7 게이트',
        note:'본인인증 + 사업자 인증 필요' },
    ]},
  { id:'F3', name:'거래 · 성사', trigger:'조건 합의 후 계약',
    steps:[
      { screen:'SB-HOM-MCH-010', act:'소개비 제안', api:'POST /deals/{id}/fee',
        data:'fee_agreements(PROPOSED) append-only', inv:'D-03',
        note:'2차 제안부터 사유 코드 필수' },
      { screen:'SB-HOM-DEL-010', act:'계약서 발급', api:'POST /deals/{id}/contract',
        data:'deal_contracts · fee_agreements → LOCKED · deals.agreed_fee', inv:'D-1',
        note:'금액이 계약서에 인쇄되는 순간이 잠금점입니다' },
      { screen:'SB-HOM-DEL-020', act:'대금 지급 신고', api:'POST /deals/{id}/payment-report',
        data:'deal_payment_records (금액·계좌 컬럼 없음)', inv:'INV-11',
        note:'플랫폼이 자금을 만질 방법이 스키마에 없습니다' },
      { screen:'SB-HOM-DEL-010', act:'양측 서명', api:'POST /deals/{id}/contract/sign',
        data:'deal_confirmations×2(CONTRACT) · deals CONFIRMED · attribution 스냅샷 · settlements',
        inv:'INV-2 · INV-3 · INV-4 · INV-9 · INV-10',
        note:'★ 두 번째 서명이 성사 확정과 정산 신청을 자동으로 일으킵니다 (A-15)' },
    ]},
  { id:'F4', name:'정산', trigger:'성사 확정 (자동)',
    steps:[
      { screen:'SB-MYP-STL-010', act:'정산 확인', api:'GET /me/settlements',
        data:'settlements(REQUESTED)', inv:'INV-9 amount = agreed_fee',
        note:'신청 행위가 없습니다 — 자동 생성됩니다' },
      { screen:'SB-ADM-STL-010', act:'승인', api:'PATCH /admin/settlements/{id}',
        data:'settlements APPROVED', inv:null, note:null },
      { screen:null, act:'배치 이체', api:'POST /admin/jobs (settlement_batch)',
        data:'settlement_batches · settlements PAID', inv:'전건 재대조',
        note:'★ 이체 직전 fn_verify_invariants() — 위반 있으면 중단' },
      { screen:'SB-HOM-ETC-010', act:'분쟁 (예외)', api:'POST /disputes',
        data:'disputes · settlements → HELD (자동)', inv:'B-11', note:null },
    ]},
];

const apiOf = a => {
  if (!a) return null;
  const [m, p] = a.split(' ');
  const full = '/api/v1' + p.split('?')[0];
  const op = D.paths[full]?.[m.toLowerCase()];
  return op ? { impl: op['x-status']==='IMPLEMENTED', roles: op['x-roles']??[], gates: op['x-gates']??[] } : null;
};

const L = [];
L.push('# 소개뱅크 — Flow 설계서 v1','');
L.push('**자동 생성** `node scripts/gen-flow-doc.js` · 원본 `spec/screens.json` + `docs/06_openapi.json`','');
L.push('거래 5개 흐름을 **화면 → API → 데이터 → 불변식**으로 관통해 그립니다.');
L.push('한 줄이 끊기면 그 단계가 실제로 완주하지 않습니다.','');
L.push('`✔` API 스키마 정의됨 · `·` 미정의','');

L.push('## 흐름 개요','');
L.push('```');
L.push('F0 가입·인증 ─→ F1 등록·검수 ─→ F2 탐색·문의 ─→ F3 거래·성사 ─→ F4 정산');
L.push('     │                                                  ↑');
L.push('     └────── 귀속 기록은 F0 유입 시점부터 F3 확정까지 ──┘');
L.push('```','');
L.push('| 흐름 | 단계 | 계기 |');
L.push('|---|---:|---|');
for (const f of FLOWS) L.push(`| **${f.id}** ${f.name} | ${f.steps.length} | ${f.trigger} |`);
L.push('');

for (const f of FLOWS) {
  L.push(`## ${f.id}. ${f.name}`,'');
  L.push(`**계기** ${f.trigger}`,'');
  L.push('```');
  L.push(f.steps.map((s,i)=>`${i+1}. ${s.act}`).join('  →  '));
  L.push('```','');
  for (const [i,s] of f.steps.entries()) {
    const a = apiOf(s.api);
    L.push(`### ${f.id}-${i+1} ${s.act}`);
    L.push('');
    L.push('| | |');
    L.push('|---|---|');
    L.push(`| 화면 | ${s.screen ? `\`${s.screen}\` ${smap[s.screen]?.name ?? ''}` : '— (서버 처리)'} |`);
    if (s.api) L.push(`| API | ${a?.impl?'✔':'·'} \`${s.api}\`${a?.gates?.length?` · 게이트 ${a.gates.join(' ')}`:''} |`);
    L.push(`| 데이터 | ${s.data} |`);
    if (s.inv) L.push(`| 불변식 | **${s.inv}** |`);
    if (s.note) L.push(`| 주의 | ${s.note} |`);
    L.push('');
  }
  const evs = N.events.filter(e => f.steps.some(s => s.screen && e.screen === s.screen));
  if (evs.length) {
    L.push('**이 흐름에서 나가는 알림**','');
    L.push('| 이벤트 | 수신자 | 채널 | 수신거부 |');
    L.push('|---|---|---|:-:|');
    for (const e of evs) L.push(`| \`${e.code}\` | ${e.actor} | ${e.channels.join(' ')} | ${e.optout?'가능':'**불가**'} |`);
    L.push('');
  }
}

L.push('## 흐름이 끊기는 지점','');
L.push('| 지점 | 증상 | 관측 |');
L.push('|---|---|---|');
L.push('| F0 `visitorKey` 미전달 | 비로그인 유입이 유실 | `v_attribution_health` 급락 |');
L.push('| F1 자동검수 과다 개입 | 검수 큐 적체 | `v_manual_reasons` 분포 |');
L.push('| F2 전화하기 우선 배치 | 통화가 귀속 밖 | 문의 대비 통화 비율 |');
L.push('| F3 시스템 밖 계약 | 성사 미포착 | `v_contract_conversion` 낮음 |');
L.push('| F4 원장 불일치 | 배치 중단 | `ops_alerts` CRITICAL |');
L.push('');
L.push('**F3 이 가장 위험합니다.** 계약서를 시스템 밖에서 쓰면 성사가 기록되지 않고,');
L.push('그러면 정산도 구독 유지 유인도 사라집니다. 계약서 발급을 주 동선으로 두는 것이 전제입니다.');

fs.writeFileSync('docs/14_Flow설계서.md', L.join('\n')+'\n');
console.log(`Flow 설계서: ${FLOWS.length} 흐름 · ${FLOWS.reduce((n,f)=>n+f.steps.length,0)} 단계`);
