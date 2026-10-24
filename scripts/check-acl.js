#!/usr/bin/env node
/* 라우트별 권한 등록 상태를 봅니다 (ACL 검정).
 *
 * ★ 이 kit 은 `auth_route_acl` 같은 표가 아니라 **코드의 데코레이터**로
 *   권한을 정합니다. 그래서 "미등록 라우트" 는 **@Roles 도 @RequireGate 도
 *   없는 라우트**를 뜻합니다.
 *
 * ── 왜 중요한가 ──────────────────────────────────────────────────
 * `/me/**` 는 **본인 것만 보여야 하는 자리**입니다. 아무 표시가 없으면
 * 토큰 없이도 200 이 나가고, 나중에 그 안에 개인정보를 담는 순간
 * 조용히 새어 나갑니다.
 *
 * 실제로 me/persona · me/reports 가 그랬습니다 — 지금은 빈 값이라
 * 새는 것이 없지만, **막는 표시가 없다는 것이 문제**입니다.
 *
 * 쓰는 법:  node scripts/check-acl.js
 */
const fs = require('fs');
const path = require('path');

/* 로그인 없이 열려도 되는 구역 — 목록·약관 등 공개 정보 */
const PUBLIC_OK = new Set([
  'auth', 'terms', 'gwans', 'listings', 'requests', 'health', 'ads',
  'categories', 'search', 'report-reasons', 'events', 'faq', 'ai',
  'site', 'site-settings', 'ui-messages', 'notices', 'codes',
  'footer-links', 'signup', 'restrictions', 'subscription-plans',
  'features', 'inquiries', 'invites',
  /* ★ 표준계약서 양식은 **서명 전에 무엇에 동의하는지** 볼 수 있어야
     합니다. 로그인해야 보인다면 가입 전에 조건을 알 수 없습니다. */
  'contract-templates',
  /* ★ 소개광장 목록·상세는 **로그인 없이 보입니다.** 글을 보려고
     가입해야 하면 아무도 안 들어옵니다 — 쓰는 것만 로그인입니다.
     분류 추천은 글 쓰기 전에 쓰는 것이라 함께 엽니다. */
  'community',
  /* ★ 제휴 링크 공유 주소 /r/{code} (D001) — 파트너가 뿌린 링크를 **아무나 누릅니다.**
     클릭을 세고 착지 주소만 돌려줍니다(개인정보 없음). */
  'r',
  /* ★ PG 웹훅 /webhooks/toss (D006) — 토스가 **로그인 없이** 보냅니다. 본문을 믿지 않고
     PG 에 결제를 다시 조회해 반영하므로 열려 있어도 상태를 위조할 수 없습니다. */
  'webhooks',
  /* ★ 소개코드 유입 기록 POST /attribution/touch (D010) — 공유 링크(?ref=)를 **비로그인 방문자가** 엽니다.
     기록만 하고 아무것도 돌려주지 않습니다(recorded 여부뿐). 없는 코드·본인·24시간 중복·로봇은 기록하지 않고,
     같은 방문자 중복은 DB 트리거(trg_attr_dedupe_24h)가 막습니다. 로그인 상태면 토큰 계정도 함께 남습니다. */
  'attribution',
  /* ★ 언어 목록 GET /i18n/langs (v10.95 · 다국어 2-1) — 머리줄 언어 고르기가 **로그인 전에도** 씁니다.
     켠 언어의 코드·이름만 돌려줍니다(개인정보 없음). 내 언어 저장 PUT /me/lang 은 로그인 필요. */
  'i18n',
  /* ★ 안심소개 상담 신청 (D018) — 소비자는 회원이 아니라 정보주체입니다(A-00R2).
     로그인 없이 신청하고, 휴대폰 확인을 마쳐야 리드가 생깁니다(INV-12).
     업종 목록 · 정액 노출 목록(법률 · 세무 광고)도 누구나 봅니다. */
  'consult',
  /* ★ v10.31 (w2 · 10/10 시안 기준) — 관 화면(소개장터 · 안심소개 · 소개창업)의 공개 읽기 구역.
     지역 · 요청 목록 · 성공 사례(두 당사자 동의분만 · 이름 가림) · 공급자 · 피해 사례(연락처 가림) · 안전거래 안내 · 창업 축 목록 · 빠른 매칭은
     **로그인 없이 보입니다**(목록을 보려고 가입해야 하면 아무도 안 들어옵니다). 요청 사진은 그 요청의 공개 범위를 서비스가 봅니다.
     쓰기(POST · PATCH · DELETE)는 모두 @Roles 가 붙어 있습니다 — 이 목록은 표시 없는 라우트만 통과시킵니다. */
  'market', 'safety', 'biz',
  /* ★ v10.49 (D103) 메인 「오늘의 날씨」 GET /weather/today — 기상청 공개 자료(지역 날씨)만 돌려줍니다. 키 · 개인정보 없음.
     기상청은 발표 × 지역마다 한 번만 부르므로 이 주소를 많이 불러도 기상청 호출이 늘지 않습니다. 운영 키 API(/admin/weather)는 SUPER 입니다. */
  'weather',
]);

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const rows = [];
for (const f of walk('src/modules')) {
  const s = fs.readFileSync(f, 'utf8');
  const blocks = s.split(/(?=@Controller\(')/);
  for (const blk of blocks) {
    const base = blk.match(/@Controller\('([^']+)'\)/);
    if (!base) continue;
    /* 클래스 전체에 걸린 @Roles 는 그 아래 모든 메서드에 적용됩니다 */
    /* ★ @Controller 와 @Roles 사이에 주석이 낄 수 있습니다 —
       그것까지 건너뛰지 않으면 클래스 권한을 못 읽습니다. */
    const clsRoles = /@Controller\('[^']+'\)[\s\S]{0,800}?@Roles\(/.test(blk)
      && !/@Controller\('[^']+'\)[\s\S]{0,800}?@(Get|Post|Patch|Put|Delete)\(/.test(
           blk.slice(0, blk.search(/@Roles\(/)));
    const re = /@(Get|Post|Patch|Put|Delete)\('?([^')]*)'?\)([\s\S]{0,1200}?)\n  (?:async )?(\w+)\s*\(/g;
    let m;
    while ((m = re.exec(blk))) {
      const [, meth, sub, deco] = m;
      const roles = deco.match(/@Roles\(([^)]*)\)/);
      /* ★ @UseGuards 로 막는 자리도 있습니다 — 내부 API 키처럼
         사람 토큰이 없는 곳은 역할이 아니라 가드로 막습니다. */
      const clsGuard = /@Controller\('[^']+'\)[\s\S]{0,800}?@UseGuards\(/.test(blk);
      const gates = [...deco.matchAll(/@RequireGate\('([A-Z_]+)'/g)].map((x) => x[1]);
      rows.push({
        route: `${meth.toUpperCase()} /${base[1]}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, ''),
        guarded: !!(roles || clsRoles || gates.length || clsGuard),
      });
    }
  }
}

const open = rows.filter((r) => !r.guarded);
const risky = open.filter((r) => {
  const seg = r.route.split(' ')[1].split('/')[3] || '';
  return !PUBLIC_OK.has(seg);
});

console.log(`라우트 ${rows.length}건 · 보호 ${rows.length - open.length} · 무표시 ${open.length}`);
if (risky.length) {
  console.log(`  ▲ 검토 필요 ${risky.length}건 — 공개 구역이 아닌데 표시가 없습니다`);
  risky.slice(0, 20).forEach((r) => console.log(`     ${r.route}`));
  console.log('     @Roles 또는 @RequireGate 를 붙이거나,');
  console.log('     공개가 맞으면 이 파일의 PUBLIC_OK 에 구역을 더하십시오.');
  process.exit(1);
}
console.log('  ok  공개 구역 외에는 전부 표시가 있습니다');
