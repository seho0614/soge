#!/usr/bin/env node
/**
 * 설계 문서 정합성 검증.
 * 문서끼리 어긋나면 개발자가 어느 쪽을 믿을지 판단할 수 없습니다.
 */
const fs = require('fs');
const { Client } = require('pg');
require('./load-env');
const S = JSON.parse(fs.readFileSync('spec/screens.json','utf8'));
const N = JSON.parse(fs.readFileSync('spec/notifications.json','utf8'));
const API = JSON.parse(fs.readFileSync('docs/06_openapi.json','utf8'));

let pass=0, fail=0;
const ok=(c,m,detail)=>{ if(c){console.log('  ok   '+m);pass++;} else {console.log('  FAIL '+m+(detail?` → ${detail}`:''));fail++;} };

(async () => {
const ids = S.screens.map(s=>s.id);
const idSet = new Set(ids);

console.log('== 화면 레지스트리 ==');
ok(new Set(ids).size===ids.length,'화면 ID 중복 없음');
ok(S.screens.every(s=>/^SB-[A-Z]{3}-[A-Z0-9]{3,4}-\d{3}$/.test(s.id)),'ID 형식 일관',
   S.screens.filter(s=>!/^SB-[A-Z]{3}-[A-Z0-9]{3,4}-\d{3}$/.test(s.id)).map(s=>s.id).join(','));
ok(S.screens.every(s=>s.roles.length>0),'접근 역할이 없는 화면 없음',
   S.screens.filter(s=>!s.roles.length).map(s=>s.id).join(','));
const dupUrl = Object.entries(S.screens.reduce((a,s)=>((a[s.url]??=[]).push(s.id),a),{}))
  .filter(([,v])=>v.length>1);
ok(dupUrl.length===0 || dupUrl.every(([u])=>u==='/'),'URL 충돌 없음 (메인 제외)',
   dupUrl.filter(([u])=>u!=='/').map(([u,v])=>`${u}=${v}`).join(' '));

const S_API = JSON.parse(fs.readFileSync('docs/06_openapi.json','utf8'));
/* 문서 생성기가 AppModule 과 같은 컨트롤러를 보는지 확인합니다.
 *
 * 갈리면 새 API 가 문서에서 통째로 빠지고, x-status 가 NOT_IMPLEMENTED 로
 * 남습니다. **구현했는데 안 한 것처럼 보입니다.**
 * 이번 세션에 두 번 발생했습니다 — 손으로 목록을 복사하기 때문입니다.
 */
{
  const app = fs.readFileSync('src/app.module.ts', 'utf8');
  const sw  = fs.readFileSync('scripts/dump-swagger.ts', 'utf8');
  /* 20260930 — 생성기가 AppModule 을 직접 읽으면 목록이 갈릴 수 없습니다 */
  if (/NestFactory\.create\(AppModule/.test(sw)) {
    ok(true, '문서 생성기가 모든 컨트롤러를 포함 (AppModule 직접 사용)');
  } else {
  const list = (src) => new Set(
    src.split('controllers: [')[1].split(']')[0]
       .split(',').map(x => x.trim()).filter(x => /^\w+$/.test(x)));
  const a = list(app), b = list(sw);
  const miss = [...a].filter(x => !b.has(x));
  ok(miss.length === 0, '문서 생성기가 모든 컨트롤러를 포함', miss.join(' '));
  }
}

/* 20260930 — DTO 이름이 겹치면 Swagger 가 하나로 덮어써 **다른 API 의 스키마가 문서에 나갑니다.**
 * (ClassifyDto · CreateInquiryDto · PayoutAccountDto · MyListingDto · ProposeFeeDto 5쌍이 그랬습니다) */
{
  const seen = {};
  const walkTs = (d) => fs.readdirSync(d).forEach((f) => {
    const p = require('path').join(d, f);
    if (fs.statSync(p).isDirectory()) return walkTs(p);
    if (!p.endsWith('.ts')) return;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/export class (\w+Dto)\b/g)) (seen[m[1]] ??= []).push(p);
  });
  walkTs('src');
  const dup = Object.entries(seen).filter(([, v]) => v.length > 1).map(([k]) => k);
  ok(dup.length === 0, 'DTO 클래스 이름이 겹치지 않음 (Swagger 스키마 덮어쓰기 방지)', dup.join(' '));
}

console.log('== 미구현 표시 ==');
{
  const ni = [];
  for (const [p, v] of Object.entries(S_API?.paths ?? {})) {
    for (const [m, o] of Object.entries(v)) {
      if (['get','post','put','patch','delete'].includes(m) && o['x-status'] === 'NOT_IMPLEMENTED') {
        ni.push(`${m.toUpperCase()} ${p}`);
      }
    }
  }
  // 레지스트리에만 있고 코드에 없는 API 입니다.
  // 화면 정의가 이것을 참조하면 그 화면은 만들 수 없습니다.
  ok(ni.length === 0, '레지스트리와 코드가 일치', ni.slice(0, 5).join(' '));
}

// 우선순위는 문자열이어야 합니다.
//
// ★ 숫자로 넣으면 `gen-mvp-plan.js` 가 localeCompare 에서 죽습니다.
//   검정은 통과하는데 **문서 생성이 조용히 실패**하고, 그러면
//   패키징이 "x-status 누락" 으로 거부합니다 — 원인과 증상이 멉니다.
const badP = S.screens.filter(s => typeof s.p !== 'string');
ok(badP.length === 0, '화면 우선순위가 문자열',
   badP.slice(0, 5).map(s => `${s.id}=${s.p}`).join(' '));

console.log('== 네비게이션 ==');
const roots=['root','global','admin-root','listing-detail'];
const badNav = S.screens.filter(s=>!idSet.has(s.nav) && !roots.includes(s.nav));
ok(badNav.length===0,'상위 화면이 실재함',badNav.map(s=>`${s.id}→${s.nav}`).join(' '));
// 순환 탐지
let cyc=[];
for(const s of S.screens){ let cur=s, seen=new Set([s.id]), d=0;
  while(idSet.has(cur.nav) && d++<20){ if(seen.has(cur.nav)){cyc.push(s.id);break;} seen.add(cur.nav); cur=S.screens.find(x=>x.id===cur.nav); }
}
ok(cyc.length===0,'네비게이션 순환 없음',cyc.join(','));

console.log('== 권한 ==');
const gates=['IDENTITY_VERIFIED','BUSINESS_VERIFIED','ACTIVE_SUBSCRIPTION'];
ok(S.screens.every(s=>s.gates.every(g=>gates.includes(g))),'게이트 값이 정의된 3종뿐');
const guestWithGate=S.screens.filter(s=>s.roles.includes('GUEST')&&s.gates.length);
ok(guestWithGate.length===0,'GUEST 화면에 게이트 없음',guestWithGate.map(s=>s.id).join(','));
/* 20260930 — 관리자 전용 화면(역할이 운영자뿐)은 id 접두사와 무관하게 제외합니다.
   SB-AFF-* 는 관리자 화면인데 SB-ADM 이 아니라 잘못 걸렸습니다.
   제휴(/partner/affiliate) 정산은 개인 제휴자도 받으므로 INV-10(사업자 정산) 대상이 아닙니다 —
   대신 본인인증 게이트가 없다는 점을 결정 대기로 올렸습니다(D-AFC-01). */
const OPS=['ADMIN','SUPER','REVIEWER','PAYOUT'];
const settle=S.screens.filter(s=>s.apis.some(a=>a.includes('settlement')&&!a.includes('/partner/affiliate/'))
  &&!s.roles.every(r=>OPS.includes(r)));
/* v10.28 (지시서 5절 · D040) — 소개비 정산은 본인인증 회원(개인 · 사업자)이 받습니다. 사업자는 사업자로(INV-10), 개인은 확인된 받을 계좌로(INV-10R) — DB 규칙이 막습니다. */
ok(settle.every(s=>s.gates.includes('IDENTITY_VERIFIED')||s.gates.includes('BUSINESS_VERIFIED')),'정산 화면은 본인인증(IDENTITY_VERIFIED) 이상 필수 (INV-10 · INV-10R)',
   settle.filter(s=>!s.gates.includes('IDENTITY_VERIFIED')&&!s.gates.includes('BUSINESS_VERIFIED')).map(s=>s.id).join(','));

console.log('== OpenAPI ==');
const specApis=new Set(S.screens.flatMap(s=>s.apis.map(a=>{const[m,p]=a.split(' ');return `${m} /api/v1${p.split('?')[0]}`;})));
const docApis=new Set(Object.entries(API.paths).flatMap(([p,ops])=>Object.keys(ops).map(m=>`${m.toUpperCase()} ${p}`)));
ok([...specApis].every(a=>docApis.has(a)),'화면의 모든 API 가 OpenAPI 에 있음',
   [...specApis].filter(a=>!docApis.has(a)).join(' '));
const noScreen=Object.entries(API.paths).flatMap(([p,ops])=>Object.entries(ops)
  .filter(([,o])=>!o['x-screens']?.length).map(([m])=>`${m} ${p}`));
ok(noScreen.length===0,'화면 없는 API 없음',noScreen.join(' '));
const mutations=Object.values(API.paths).flatMap(ops=>Object.entries(ops)
  .filter(([m])=>['post','patch','put'].includes(m)).map(([,o])=>o));
ok(mutations.every(o=>o.responses['422']&&o.responses['409']),'변경 API 는 409·422 정의');

console.log('== OpenAPI 스키마 ==');
const allOps=Object.entries(API.paths).flatMap(([p,ops])=>Object.entries(ops).map(([m,o])=>({p,m,o})));
ok(allOps.every(x=>x.o['x-status']),'모든 오퍼레이션에 x-status');
const impl=allOps.filter(x=>x.o['x-status']==='IMPLEMENTED');
// 경로 파라미터만으로 동작하는 POST(관심 등록 등)는 본문이 없습니다.
const bodied=impl.filter(x=>['post','patch','put'].includes(x.m) && !x.o['x-no-body']);
ok(bodied.every(x=>x.o.requestBody),'구현된 변경 API 에 requestBody 스키마',
   bodied.filter(x=>!x.o.requestBody).map(x=>`${x.m} ${x.p}`).join(' '));
ok(impl.every(x=>Object.values(x.o.responses).some(r=>r.content)),'구현된 API 에 응답 스키마',
   impl.filter(x=>!Object.values(x.o.responses).some(r=>r.content)).map(x=>`${x.m} ${x.p}`).join(' '));
ok(!!API.components.schemas.ErrorDto,'ErrorDto 스키마 등록');
console.log(`     · 구현 ${impl.length} / 전체 ${allOps.length} (미구현은 개발 진행에 따라 감소)`);

console.log('== 알림 ==');
const evScreens=N.events.map(e=>e.screen);
ok(evScreens.every(s=>idSet.has(s)),'알림 도착 화면이 실재함',
   evScreens.filter(s=>!idSet.has(s)).join(','));
const chans=['INAPP','EMAIL','SMS','ALIMTALK','PUSH'];
ok(N.events.every(e=>e.channels.every(c=>chans.includes(c))),'채널 값이 정의된 5종뿐');
const money=['SETTLEMENT_PAID','SETTLEMENT_HELD','SUBSCRIPTION_PAYMENT_FAILED','PROMO_ENDING','DEAL_CONFIRMED'];
ok(money.every(c=>N.events.find(e=>e.code===c)?.optout===false),'금전·법정 고지는 수신거부 불가');

console.log('== DB 대조 ==');
const c=new Client({connectionString:process.env.DATABASE_URL});
await c.connect();
const {rows:doms}=await c.query(`SELECT DISTINCT domain FROM code_labels`);
const domSet=new Set(doms.map(r=>r.domain));
const usedStates=[...new Set(S.screens.filter(s=>s.state).map(s=>s.state))];
const missing=usedStates.filter(d=>!domSet.has(d));
ok(missing.length===0,'화면이 쓰는 상태 도메인에 라벨이 있음',missing.join(','));
const {rows:[rc]}=await c.query(`SELECT count(*)::int n FROM review_reason_codes WHERE is_active`);
ok(rc.n>=20,`반려 사유 코드 ${rc.n}종`);
const {rows:[ml]}=await c.query(`SELECT count(*)::int n FROM v_code_missing_labels`);
ok(ml.n===0,'코드 라벨 누락 0건');
await c.end();

console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail?1:0);
})().catch(e=>{console.error('오류:',e.message);process.exit(1)});
