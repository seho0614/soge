#!/usr/bin/env node
/**
 * 오픈 필수 API 리스트와 개발 절차를 생성합니다.
 *
 * "필수"의 정의: 없으면 거래 7단계 중 한 곳이 끊겨 오픈할 수 없는 것.
 * P0 화면이 쓰는 API 를 기준으로 하되, 흐름 완주에 필요한 것을 추가합니다.
 */
const fs = require('fs');
const D = JSON.parse(fs.readFileSync('docs/06_openapi.json','utf8'));
const S = JSON.parse(fs.readFileSync('spec/screens.json','utf8'));
const smap = Object.fromEntries(S.screens.map(s=>[s.id,s]));

const rows = [];
for (const [p, ops] of Object.entries(D.paths))
  for (const [m, o] of Object.entries(ops)) {
    const sc = o['x-screens'] ?? [];
    const ps = sc.map(x => smap[x]?.p).filter(Boolean).sort();
    rows.push({
      m: m.toUpperCase(), p: p.replace('/api/v1',''), sum: o.summary ?? '',
      st: o['x-status'], screens: sc, roles: o['x-roles'] ?? [],
      gates: o['x-gates'] ?? [], prio: ps[0] ?? 'P2',
    });
  }

// 거래 7단계. 긴 경로를 먼저 검사해야 하위 경로가 상위에 먹히지 않습니다.
const FLOW = [
  ['05 계약·성사', ['/deals/{id}/contract','/deals/{id}/payment-report','/deals/{id}/confirm','/deals/{id}/reviews']],
  ['06 정산·분쟁', ['/settlements','/me/settlements','/disputes','/me/disputes','/admin/settlements','/admin/disputes']],
  ['04 문의·Deal', ['/conversations','/deals','/me/deals','/admin/deals','/listings/{id}/questions']],
  ['00 구독·코드', ['/me/subscription','/referral-codes','/subscription-plans','/subscriptions']],
  ['01 등록',      ['/listings','/requests','/categories','/me/listings']],
  ['02 검수',      ['/admin/reviews','/admin/badges','/admin/auto-review','/admin/categories','/admin/businesses']],
  ['03 탐색',      ['/search','/gwans']],
  ['가입·인증',    ['/auth','/businesses','/verifications','/terms','/me/summary']],
  ['운영 콘솔',    ['/admin/']],
  ['부가',         ['/']],
];
const flowOf = r => (FLOW.find(([,px]) => px.some(x => r.p.startsWith(x))) ?? ['부가'])[0];
for (const r of rows) r.flow = flowOf(r);

// 오픈 필수 판정
const MUST_FLOWS = new Set(['00 구독·코드','01 등록','02 검수','03 탐색','04 문의·Deal','05 계약·성사','06 정산·분쟁','가입·인증']);
const OPEN_BLOCKER_ADMIN = ['/admin/site-settings','/admin/open-blockers','/admin/policies','/admin/accounts','/admin/summary'];
for (const r of rows) {
  r.must = (MUST_FLOWS.has(r.flow) && r.prio !== 'P2')
        || OPEN_BLOCKER_ADMIN.some(x => r.p.startsWith(x));
}

// 개발 트랙 (의존 순서)
const TRACKS = [
  ['T1','B1a 인증 코어','W2~W3',['/auth','/me/summary','/terms']],
  ['T2','B2 카테고리·정책','W4~W6',['/categories','/gwans','/admin/categories','/admin/policies','/admin/code-labels']],
  ['T3','B3 검수 BO ★','W4~W7',['/admin/reviews','/admin/auto-review','/admin/badges']],
  ['T4','B1b 사업자·계정','W4~W7',['/businesses','/verifications','/admin/accounts','/admin/businesses']],
  ['T5','B4 리스팅·요청','W6~W9',['/listings','/requests','/me/listings','/me/favorites','/search']],
  ['T6','B5 문의·Deal·귀속','W7~W10',['/conversations','/deals','/me/deals','/admin/deals']],
  ['T7','B6 구독·원장·PG','W8~W11',['/subscription','/referral-codes','/me/subscription']],
  ['T8','B7 정산·분쟁','W12~W15',['/settlements','/me/settlements','/disputes','/me/disputes','/admin/settlements','/admin/disputes']],
  ['T9','운영·부가','W12~W15',['/']],
];
const seen = new Set();
for (const [id,,,px] of TRACKS)
  for (const r of rows)
    if (!seen.has(r.m+r.p) && px.some(x => r.p.startsWith(x))) { r.track = id; seen.add(r.m+r.p); }

const must = rows.filter(r => r.must);
const L = [];
L.push('# 소개뱅크 — 오픈 필수 API 리스트 · 개발 절차');
L.push('');
L.push('**자동 생성** `node scripts/gen-mvp-plan.js` · 원본 `docs/06_openapi.json` · `spec/screens.json`');
L.push('');
L.push(`전체 ${rows.length} 오퍼레이션 중 **오픈 필수 ${must.length}건**. 나머지 ${rows.length-must.length}건은 오픈 후로 미룰 수 있습니다.`);
L.push('');
L.push('**필수의 정의** — 없으면 거래 7단계 중 한 곳이 끊겨 오픈할 수 없는 것. 여기에 오픈 게이트(푸터 법정고지·정책 관리)를 더했습니다.');
L.push('');

L.push('## 1. 거래 흐름별');
L.push('');
L.push('| 단계 | 필수 | 전체 | 스키마 정의 |');
L.push('|---|---:|---:|---:|');
const order = ['가입·인증','00 구독·코드','01 등록','02 검수','03 탐색','04 문의·Deal','05 계약·성사','06 정산·분쟁','운영 콘솔','부가'];
for (const f of order) {
  const s = rows.filter(r => r.flow === f); if (!s.length) continue;
  L.push(`| ${f} | **${s.filter(r=>r.must).length}** | ${s.length} | ${s.filter(r=>r.st==='IMPLEMENTED').length} |`);
}
L.push('');
L.push('> **05 계약·성사가 4건뿐입니다.** 성사 확정과 정산 신청이 DB 트리거로 자동 처리되기 때문입니다(A-15). 계약서 발급·서명 두 개만 만들면 나머지가 따라옵니다.');
L.push('');

L.push('## 2. 오픈 필수 API');
L.push('');
for (const f of order) {
  const s = rows.filter(r => r.flow === f && r.must)
                .sort((a,b)=> a.prio.localeCompare(b.prio) || a.p.localeCompare(b.p));
  if (!s.length) continue;
  L.push(`### ${f}`);
  L.push('');
  L.push('| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |');
  L.push('|:-:|:-:|---|---|---|---|---|');
  for (const r of s)
    L.push(`| ${r.st==='IMPLEMENTED'?'✔':'·'} | ${r.track??'-'} | \`${r.m}\` | \`${r.p}\` | ${r.sum} | ${r.roles.slice(0,2).map(x=>x.replace('BIZ_','B_')).join('/')} | ${r.gates.map(x=>x.replace('_VERIFIED','').replace('ACTIVE_','')).join(' ')} |`);
  L.push('');
}

L.push('## 3. 개발 절차 — 트랙 순서');
L.push('');
L.push('의존 순서입니다. **앞 트랙이 없으면 뒤 트랙을 실데이터로 검증할 수 없습니다.**');
L.push('');
L.push('| 트랙 | 이름 | 주차 | 필수 API | 전체 | 선행 |');
L.push('|---|---|---|---:|---:|---|');
const PREV = {T1:'—',T2:'T1',T3:'T2',T4:'T1',T5:'T2 T3',T6:'T4 T5',T7:'T1',T8:'T6 T7',T9:'—'};
for (const [id,name,wk] of TRACKS) {
  const s = rows.filter(r=>r.track===id);
  L.push(`| **${id}** | ${name} | ${wk} | **${s.filter(r=>r.must).length}** | ${s.length} | ${PREV[id]} |`);
}
L.push('');
L.push('```');
L.push('T1 인증 코어');
L.push(' ├─ T2 카테고리·정책 ─┬─ T3 검수 BO ★');
L.push(' │                    └─ T5 리스팅·요청 ─┐');
L.push(' ├─ T4 사업자·계정 ──────────────────────┼─ T6 문의·Deal ─┐');
L.push(' └─ T7 구독·원장 ────────────────────────────────────────┴─ T8 정산·분쟁');
L.push('```');
L.push('');
L.push('**T3 이 임계 경로입니다.** 검수가 없으면 등록해도 노출이 안 되고, 노출이 없으면 T5 이후를 실데이터로 볼 수 없습니다.');
L.push('');

L.push('## 4. 트랙별 착수 절차');
L.push('');
L.push('각 트랙에서 같은 순서를 반복합니다.');
L.push('');
L.push('| 순서 | 작업 | 산출 |');
L.push('|---|---|---|');
L.push('| 1 | DTO 작성 (`@ApiProperty` 포함) | 요청·응답 스키마 |');
L.push('| 2 | 리포지토리 — 쿼리만. 트랜잭션은 서비스가 연다 | |');
L.push('| 3 | 서비스 — 상태 전이는 여기서만 | |');
L.push('| 4 | 컨트롤러 — `@Roles` `@RequireGate` `@Audit` 부착 | |');
L.push('| 5 | `npm run docs` | OpenAPI `x-status: IMPLEMENTED` 로 전환 |');
L.push('| 6 | 불변식 시험 추가 → `npm run verify` | 검증 건수 증가 |');
L.push('');
L.push('**5번을 빠뜨리면 프런트가 스키마를 못 받습니다.** 커밋 전에 돌리십시오 — CI 가 `git diff --exit-code` 로 막습니다.');
L.push('');

L.push('## 5. 오픈까지 남은 API');
L.push('');
const remain = must.filter(r=>r.st!=='IMPLEMENTED');
L.push(`필수 ${must.length}건 중 **${remain.length}건**이 스키마 미정의입니다.`);
L.push('');
L.push('| 트랙 | 남은 필수 API |');
L.push('|---|---:|');
for (const [id,name] of TRACKS) {
  const n = remain.filter(r=>r.track===id).length;
  if (n) L.push(`| ${id} ${name} | ${n} |`);
}
L.push('');
L.push('## 6. 오픈 후로 미룰 수 있는 것');
L.push('');
const later = rows.filter(r=>!r.must);
L.push(`${later.length}건. 대부분 운영 편의 기능입니다.`);
L.push('');
const byFlow = {};
for (const r of later) (byFlow[r.flow] ??= []).push(r);
L.push('| 영역 | 건수 | 예 |');
L.push('|---|---:|---|');
for (const [f,s] of Object.entries(byFlow))
  L.push(`| ${f} | ${s.length} | ${s.slice(0,3).map(r=>`\`${r.p}\``).join(' ')} |`);

fs.writeFileSync('docs/08_필수API_개발절차.md', L.join('\n')+'\n');
console.log(`필수 ${must.length} / 전체 ${rows.length} · 미정의 ${remain.length}`);
