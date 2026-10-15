#!/usr/bin/env node
/**
 * spec/*.json 에서 설계 문서 6종을 생성합니다.
 * 문서를 손으로 쓰면 화면·API·권한이 서로 어긋납니다.
 * 하나의 레지스트리에서 뽑으면 어긋날 자리가 없습니다.
 */
const fs = require('fs');
const path = require('path');
const S = JSON.parse(fs.readFileSync('spec/screens.json', 'utf8'));
const N = JSON.parse(fs.readFileSync('spec/notifications.json', 'utf8'));
const out = (f, s) => fs.writeFileSync(path.join('docs', f), s);
const ROLES = ['GUEST','MEMBER','BIZ_OWNER','BIZ_STAFF','REVIEWER','ADMIN','SUPER'];

// 역할 상속: 상위 역할은 하위 화면에 접근 가능
const INHERIT = {
  MEMBER:['GUEST'], BIZ_OWNER:['GUEST','MEMBER'], BIZ_STAFF:['GUEST','MEMBER'],
  REVIEWER:['GUEST','MEMBER'], ADMIN:['GUEST','MEMBER'], SUPER:['GUEST','MEMBER','ADMIN','REVIEWER'],
};
const can = (role, screen) =>
  screen.roles.includes(role) || (INHERIT[role]||[]).some(r => screen.roles.includes(r));

// ── 1. 화면정의서 ────────────────────────────────────────────
{
  const L = [];
  L.push('# 소개뱅크 — 화면정의서 v1');
  L.push('');
  L.push(`**자동 생성** \`node scripts/gen-docs.js\` · 원본 \`spec/screens.json\``);
  L.push(`**기준** ${S.meta.scope}`);
  L.push(`**활성 ${S.screens.length}화면 · 이연 ${S.deferred.length}화면**`);
  L.push('');
  const byP = p => S.screens.filter(s => s.p === p);
  L.push('| 우선 | 화면 |');
  L.push('|---|---:|');
  for (const p of ['P0','P1','P2']) L.push(`| ${p} | ${byP(p).length} |`);
  L.push('');
  const groups = [...new Set(S.screens.map(s => s.group))];
  const gname = {HOM:'공통',MNY:'소개장터',MAL:'안심소개',BIZ:'소개창업',MYP:'마이페이지',ADM:'백오피스'};
  for (const g of groups) {
    L.push(`## ${g} · ${gname[g] ?? g}`);
    L.push('');
    for (const s of S.screens.filter(x => x.group === g)) {
      L.push(`### \`${s.id}\` ${s.name}`);
      L.push('');
      L.push('| | |');
      L.push('|---|---|');
      L.push(`| URL | \`${s.url}\` |`);
      L.push(`| 우선순위 | ${s.p} |`);
      L.push(`| 접근 역할 | ${s.roles.join(' · ')} |`);
      L.push(`| 게이트 | ${s.gates.length ? s.gates.join(' · ') : '없음'} |`);
      L.push(`| 상위 화면 | ${s.nav} |`);
      if (s.state) L.push(`| 상태 도메인 | \`${s.state}\` |`);
      if (s.apis.length) L.push(`| API | ${s.apis.map(a=>`\`${a}\``).join('<br>')} |`);
      if (s.new) L.push(`| 비고 | **1차 검증 신규** |`);
      if (s.renamed) L.push(`| 변경 | ${s.renamed} |`);
      if (s.absorbed) L.push(`| 흡수 | ${s.absorbed} |`);
      if (s.note) L.push(`| 주의 | ${s.note} |`);
      if (s.blocked) L.push(`| 차단 | ${s.blocked} |`);
      L.push('');
    }
  }
  L.push('## 이연 화면');
  L.push('');
  L.push('| 화면 ID | 사유 |');
  L.push('|---|---|');
  for (const d of S.deferred) L.push(`| \`${d.id}\` | ${d.reason} |`);
  out('01_화면정의서.md', L.join('\n') + '\n');
}

// ── 2. 권한 매트릭스 ─────────────────────────────────────────
{
  const L = [];
  L.push('# 소개뱅크 — 권한 매트릭스 v1');
  L.push('');
  L.push('**자동 생성** · 원본 `spec/screens.json`');
  L.push('');
  L.push('## 역할 상속');
  L.push('');
  L.push('| 역할 | 상속 |');
  L.push('|---|---|');
  for (const r of ROLES) L.push(`| ${r} | ${(INHERIT[r]||[]).join(' · ') || '—'} |`);
  L.push('');
  L.push('## 게이트');
  L.push('');
  L.push('| 게이트 | 막는 것 | 근거 |');
  L.push('|---|---|---|');
  L.push('| `IDENTITY_VERIFIED` | 본인인증 전 거래 진입 | INV-7 |');
  L.push('| `BUSINESS_VERIFIED` | 거래 만들기 · 소개비 제시 · 계약서 발급 (소개비 수령은 본인인증 — v10.28 INV-10R) | INV-10 |');
  L.push('| `ACTIVE_SUBSCRIPTION` | 구독 없는 코드 발급 | INV-8 |');
  L.push('');
  L.push('## 화면 × 역할');
  L.push('');
  L.push('| 화면 | ' + ROLES.join(' | ') + ' | 게이트 |');
  L.push('|---|' + ROLES.map(()=>':-:').join('|') + '|---|');
  for (const s of S.screens) {
    const cells = ROLES.map(r => can(r, s) ? '●' : '');
    L.push(`| \`${s.id}\` ${s.name} | ${cells.join(' | ')} | ${s.gates.join(' ')||''} |`);
  }
  L.push('');
  L.push('## 역할별 접근 화면 수');
  L.push('');
  L.push('| 역할 | 화면 수 |');
  L.push('|---|---:|');
  for (const r of ROLES) L.push(`| ${r} | ${S.screens.filter(s=>can(r,s)).length} |`);
  out('02_권한매트릭스.md', L.join('\n') + '\n');
}

// ── 3. 네비게이션 정의서 ─────────────────────────────────────
{
  const L = [];
  L.push('# 소개뱅크 — 네비게이션 정의서 v1');
  L.push('');
  L.push('**자동 생성** · **반응형 단일 코드베이스 기준 (C-04 확정)**');
  L.push('');
  L.push('`m.` 서브도메인과 `-M10`·`-M30` 화면 ID 는 폐기됐습니다. 뷰포트 분기는 CSS 로만 합니다.');
  L.push('');
  const children = {};
  for (const s of S.screens) (children[s.nav] ??= []).push(s);
  const roots = Object.keys(children).filter(k => !S.screens.some(s => s.id === k));
  L.push('## 진입점');
  L.push('');
  for (const r of roots.sort()) {
    L.push(`### ${r}`);
    L.push('');
    for (const c of children[r]) L.push(`- \`${c.id}\` ${c.name} — \`${c.url}\``);
    L.push('');
  }
  L.push('## 화면 트리');
  L.push('');
  L.push('```');
  const walk = (id, d) => {
    for (const c of (children[id] ?? [])) {
      L.push('  '.repeat(d) + `${c.id}  ${c.name}`);
      walk(c.id, d + 1);
    }
  };
  for (const r of roots.sort()) { L.push(r); walk(r, 1); L.push(''); }
  L.push('```');
  L.push('');
  L.push('## 도착지가 없는 화면');
  L.push('');
  const orphans = S.screens.filter(s => !S.screens.some(x => x.nav === s.id) );
  L.push(`말단 화면 ${orphans.length}건 — 정상입니다. 아래는 참고용입니다.`);
  L.push('');
  L.push(orphans.map(s=>`\`${s.id}\``).join(' · '));
  L.push('');
  L.push('## UI 규칙');
  L.push('');
  for (const r of (S.meta.ui_rules ?? [])) L.push(`- ${r}`);
  L.push('');
  L.push('## 푸터 링크');
  L.push('');
  L.push('| 구분 | 내용 |');
  L.push('|---|---|');
  L.push('| LEGAL | 이용약관 · 개인정보처리방침 · 위치기반 · 제3자 제공 · 환불 정책 |');
  L.push('| SUPPORT | 고객센터 · 분쟁조정 안내 (둘 다 `SB-HOM-CSB-010` 으로) |');
  L.push('');
  L.push('`GET /footer-links` 가 `available` 과 `tip` 을 함께 내려줍니다.');
  L.push('**목적지 없는 링크는 숨기지 않습니다** — 점선 + tip 으로 그립니다.');
  L.push('약관 5종은 B-12 법무 대기라 현재 `available=false` 입니다.');
  L.push('');
  L.push('## ★ 상세 화면 CTA 배치 규칙');
  L.push('');
  L.push('```');
  L.push('[문의하기]   주 동선 · 시각적 우위 · 귀속 안 (INV-2)');
  L.push('[전화하기]   보조 · 하단 · 낮은 대비 · 귀속 밖');
  L.push('```');
  L.push('');
  L.push('반응형이라 배치가 CSS 한 줄로 뒤집힙니다. 050 안심번호(B-19)가 붙기 전까지');
  L.push('이 배치가 통화 유실을 막는 유일한 수단입니다.');
  out('03_네비게이션정의서.md', L.join('\n') + '\n');
}

// ── 4. 상태 전이 명세 ────────────────────────────────────────
{
  const T = {
    'listing.status': {
      title:'매물', table:'listings',
      edges:[['DRAFT','IN_REVIEW','제출'],['IN_REVIEW','PUBLISHED','승인 (자동 또는 수동)'],
             ['IN_REVIEW','REJECTED','반려 — 사유 코드 필수'],['REJECTED','IN_REVIEW','재제출'],
             ['PUBLISHED','IN_REVIEW','수정 (version+1, 배지 회수)'],
             ['PUBLISHED','SUSPENDED','노출 중단 · 제한업종 지정 · 슬롯 초과'],
             ['SUSPENDED','PUBLISHED','재개'],['SUSPENDED','ARCHIVED','보관']],
      guards:['INV-6 제한업종은 PUBLISHED 전이 시 차단','슬롯 초과 시 PUBLISHED 불가 (B-13R2)']
    },
    'deal.status': {
      title:'거래', table:'deals',
      edges:[['INQUIRY','NEGOTIATING','조건 협의 시작'],['NEGOTIATING','CONTRACTED','계약서 발급 (합의 LOCKED)'],
             ['CONTRACTED','PAYMENT_REPORTED','대금 지급 신고'],
             ['PAYMENT_REPORTED','CONFIRMED','양측 서명 → 자동 확정 (A-15)'],
             ['PAYMENT_REPORTED','CONFIRMED','7일 무응답 자동 확정 (B-01)'],
             ['CONFIRMED','SETTLED','정산 지급 완료'],['CONFIRMED','DISPUTED','분쟁 접수'],
             ['INQUIRY','CANCELLED','취소'],['NEGOTIATING','CANCELLED','취소'],['CONTRACTED','CANCELLED','취소']],
      guards:['INV-4 CONFIRMED 는 deal_confirmations 2행 필수','INV-2 CONFIRMED 시 귀속 스냅샷 확정',
              'INV-1 tier=1 고정','CONFIRMED 이후 CANCELLED 불가']
    },
    'settlement.status': {
      title:'정산', table:'settlements',
      edges:[['—','REQUESTED','성사 확정 시 자동 신청'],['REQUESTED','APPROVED','관리자 승인'],
             ['APPROVED','PAID','주 1회 수요일 배치'],['REQUESTED','HELD','분쟁 접수 (B-11 자동)'],
             ['APPROVED','HELD','분쟁 접수'],['HELD','APPROVED','분쟁 해소'],
             ['REQUESTED','REJECTED','반려']],
      guards:['INV-3 CONFIRMED 이후에만 생성','INV-9 amount = agreed_fee','INV-10 사업자로 받으면 인증된 사업자 · INV-10R 개인으로 받으면 본인인증 + 확인된 받을 계좌']
    },
    'review.status': {
      title:'검수', table:'review_items',
      edges:[['—','QUEUED','개입 사유 있음'],['—','APPROVED','개입 사유 없음 → 자동 승인'],
             ['QUEUED','IN_PROGRESS','담당 배정'],['IN_PROGRESS','APPROVED','승인'],
             ['IN_PROGRESS','REJECTED','반려 — 사유 코드 필수'],['QUEUED','APPROVED','승인'],
             ['QUEUED','REJECTED','반려']],
      guards:['SLA 24시간','반려 시 reject_reason_code NOT NULL','자동 승인 건은 5% 표본 감사']
    },
    'badge.status': {
      title:'매물 배지', table:'listing_badges',
      edges:[['—','REQUESTED','신청'],['REQUESTED','IN_REVIEW','검수 큐 적재 (전건 수동)'],
             ['IN_REVIEW','GRANTED','승인 → 노출 반영'],['IN_REVIEW','REJECTED','반려'],
             ['GRANTED','EXPIRED','급구 기한 경과'],['GRANTED','REVOKED','매물 수정']],
      guards:['본인 매물만','급구 최대 14일 · 동시 3건','매물 version 변경 시 REVOKED']
    },
    'subscription.status': {
      title:'구독', table:'subscriptions',
      edges:[['—','ACTIVE','가입'],['ACTIVE','PAST_DUE','결제 실패'],['PAST_DUE','ACTIVE','결제 성공'],
             ['ACTIVE','CANCELLED','해지 → 미성사 코드 실효'],['PAST_DUE','EXPIRED','기간 만료'],
             ['ACTIVE','EXPIRED','기간 만료']],
      guards:['INV-8 ACTIVE/PAST_DUE 에서만 코드 발급','B-21 프로모션은 STANDARD 고정','계정당 활성 1건']
    },
    'dispute.status': {
      title:'분쟁', table:'disputes',
      edges:[['—','OPEN','접수 → 정산 자동 HELD'],['OPEN','IN_REVIEW','검토 시작'],
             ['IN_REVIEW','RESOLVED','처리 완료'],['IN_REVIEW','REJECTED','기각']],
      guards:['B-11 접수 즉시 정산 보류']
    },
  };
  const L = [];
  L.push('# 소개뱅크 — 상태 전이 명세 v1');
  L.push('');
  L.push('**자동 생성** · 전이는 **도메인 서비스 한 곳에서만** 일어납니다. 컨트롤러에서 `status = ...` 를 쓰지 않습니다.');
  L.push('');
  for (const [dom, t] of Object.entries(T)) {
    L.push(`## \`${dom}\` — ${t.title}`);
    L.push('');
    L.push(`테이블 \`${t.table}\``);
    L.push('');
    L.push('| From | To | 조건 |');
    L.push('|---|---|---|');
    for (const [f, to, c] of t.edges) L.push(`| ${f} | **${to}** | ${c} |`);
    L.push('');
    L.push('**불변 조건**');
    L.push('');
    for (const g of t.guards) L.push(`- ${g}`);
    L.push('');
  }
  out('04_상태전이명세.md', L.join('\n') + '\n');
}

// ── 5. 알림 설계서 ───────────────────────────────────────────
{
  const L = [];
  L.push('# 소개뱅크 — 알림 설계서 v1 (G-03)');
  L.push('');
  L.push('**자동 생성** · 원본 `spec/notifications.json`');
  L.push(`**사용자 이벤트 ${N.events.length} · 운영 경보 ${N.admin_alerts.length}**`);
  L.push('');
  L.push('## 발송 규칙');
  L.push('');
  L.push('| 규칙 | 내용 |');
  L.push('|---|---|');
  for (const [k, v] of Object.entries(N.rules)) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('## 사용자 이벤트');
  L.push('');
  L.push('| 이벤트 코드 | 이름 | 수신자 | 채널 | 수신거부 | 도착 화면 |');
  L.push('|---|---|---|---|:-:|---|');
  for (const e of N.events)
    L.push(`| \`${e.code}\` | ${e.name} | ${e.actor} | ${e.channels.join(' ')} | ${e.optout?'가능':'**불가**'} | \`${e.screen}\` |`);
  L.push('');
  L.push(`**수신거부 불가 ${N.events.filter(e=>!e.optout).length}건** — ${N.rules.optout_false_reason}`);
  L.push('');
  L.push('## 트리거');
  L.push('');
  L.push('| 이벤트 | 발생 지점 |');
  L.push('|---|---|');
  for (const e of N.events) L.push(`| \`${e.code}\` | ${e.trigger} |`);
  L.push('');
  L.push('## 운영 경보');
  L.push('');
  L.push('| 코드 | 이름 | 등급 | 채널 |');
  L.push('|---|---|---|---|');
  for (const a of N.admin_alerts) L.push(`| \`${a.code}\` | ${a.name} | ${a.severity} | ${a.channels.join(' ')} |`);
  out('05_알림설계서.md', L.join('\n') + '\n');
}

// ── 6. OpenAPI ───────────────────────────────────────────────
{
  const paths = {};
  const seen = new Set();
  for (const s of S.screens) {
    for (const a of s.apis) {
      const [method, rawPath] = a.split(' ');
      const p = '/api/v1' + rawPath.split('?')[0];
      const key = `${method} ${p}`;
      if (seen.has(key)) { paths[p][method.toLowerCase()]['x-screens'].push(s.id); continue; }
      seen.add(key);
      paths[p] ??= {};
      const params = [...rawPath.matchAll(/\{(\w+)\}/g)].map(m => ({
        name: m[1], in: 'path', required: true, schema: { type: 'string' },
      }));
      const sec = s.roles.includes('GUEST') && !s.gates.length ? [] : [{ bearerAuth: [] }];
      const responses = {
        '200': { description: '성공' },
        '400': { $ref: '#/components/responses/BadRequest' },
      };
      if (sec.length) responses['403'] = { $ref: '#/components/responses/Forbidden' };
      if (['POST','PATCH','PUT'].includes(method)) {
        responses['409'] = { $ref: '#/components/responses/Conflict' };
        responses['422'] = { $ref: '#/components/responses/PolicyViolation' };
      }
      paths[p][method.toLowerCase()] = {
        summary: s.name,
        tags: [s.group],
        parameters: params,
        security: sec,
        'x-screens': [s.id],
        'x-gates': s.gates,
        'x-roles': s.roles,
        responses,
      };
    }
  }
  const doc = {
    openapi: '3.1.0',
    info: {
      title: '소개뱅크 API',
      version: '1.0.0',
      description: '자동 생성 — spec/screens.json 기준. 스키마 상세는 NestJS DTO 에서 보강됩니다.',
    },
    servers: [{ url: 'https://api.sogaebaenk.co.kr', description: '운영' }],
    tags: [
      {name:'HOM',description:'공통'},{name:'MNY',description:'소개장터'},
      {name:'MAL',description:'안심소개'},{name:'BIZ',description:'소개창업'},
      {name:'MYP',description:'마이페이지'},{name:'ADM',description:'백오피스'},
    ],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type:'http', scheme:'bearer', bearerFormat:'JWT' } },
      schemas: {
        Error: {
          type:'object', required:['code','message'],
          properties:{ code:{type:'string'}, message:{type:'string'},
                       field:{type:'string'}, details:{} },
        },
      },
      responses: {
        BadRequest:{description:'형식 오류',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        Forbidden:{description:'권한 없음 · 게이트 미충족',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        Conflict:{description:'상태 충돌 — 재시도해도 같은 결과',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
        PolicyViolation:{description:'정책 위반 — 형식은 맞으나 규칙이 막음',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}},
      },
    },
  };
  fs.writeFileSync('docs/06_openapi.json', JSON.stringify(doc, null, 2) + '\n');
  console.log(`OpenAPI: ${Object.keys(paths).length} paths · ${seen.size} operations`);
}

console.log('생성 완료: docs/01~06');
