#!/usr/bin/env node
/**
 * API 스키마 리스트 생성. merge-openapi.js 이후에 실행해야
 * x-status(스키마 정의 여부)가 반영됩니다.
 */
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('docs/06_openapi.json','utf8'));
const S=JSON.parse(fs.readFileSync('spec/screens.json','utf8'));
const smap=Object.fromEntries(S.screens.map(s=>[s.id,s]));
const G={HOM:'공통',MNY:'소개장터',MAL:'안심소개',BIZ:'소개창업',MYP:'마이페이지',ADM:'백오피스'};
const ORD={P0:0,P1:1,P2:2};

const rows=[];
for(const [p,ops] of Object.entries(d.paths))
  for(const [m,o] of Object.entries(ops)){
    const screens=o['x-screens']??[];
    const ps=screens.map(s=>smap[s]?.p).filter(Boolean);
    rows.push({m:m.toUpperCase(),p,sum:o.summary??'',tag:(o.tags??['-'])[0],
      st:o['x-status'],screens,roles:o['x-roles']??[],gates:o['x-gates']??[],
      prio:ps.length?ps.sort()[0]:'P2'});
  }

const TRACKS=[
 ['B3 검수 (W4~W7)',['/admin/reviews','/admin/badges','/admin/auto-review']],
 ['B2 카테고리·정책 (W4~W6)',['/admin/categories','/admin/policies','/admin/code-labels','/categories','/gwans']],
 ['B1b 인증·계정 (W4~W7)',['/auth','/verifications','/businesses','/terms','/admin/accounts','/admin/businesses']],
 ['B4 리스팅·요청 (W6~W9)',['/listings','/requests','/search','/me/listings','/me/favorites']],
 ['B5 문의·Deal (W7~W10)',['/conversations','/deals','/me/deals','/admin/deals']],
 ['B6 구독·원장 (W8~W11)',['/subscription','/referral-codes','/me/subscription']],
 ['B7 정산·분쟁 (W12~W15)',['/settlements','/me/settlements','/disputes','/me/disputes','/admin/settlements','/admin/disputes']],
 ['기타 (W12~W15)',['/']],
];

const L=[];
const impl=rows.filter(r=>r.st==='IMPLEMENTED').length;
L.push('# 소개뱅크 — API 스키마 리스트 v1','',
 '**자동 생성** `node scripts/gen-api-list.js` · 원본 `docs/06_openapi.json`',
 `**${rows.length} 오퍼레이션** · 스키마 정의 ${impl} / 미정의 ${rows.length-impl}`,'',
 '`✔` 스키마 정의됨 · `·` 미정의 — 컨트롤러에 `@nestjs/swagger` 데코레이터를 부착하면 자동으로 바뀝니다','',
 '## 요약','','| 그룹 | API | P0 | 스키마 정의 |','|---|---:|---:|---:|');
for(const g of Object.keys(G)){
  const s=rows.filter(r=>r.tag===g); if(!s.length) continue;
  L.push(`| ${g} · ${G[g]} | ${s.length} | ${s.filter(r=>r.prio==='P0').length} | ${s.filter(r=>r.st==='IMPLEMENTED').length} |`);
}
L.push(`| **합계** | **${rows.length}** | **${rows.filter(r=>r.prio==='P0').length}** | **${impl}** |`,'');

for(const g of Object.keys(G)){
  const s=rows.filter(r=>r.tag===g).sort((a,b)=>ORD[a.prio]-ORD[b.prio]||a.p.localeCompare(b.p)||a.m.localeCompare(b.m));
  if(!s.length) continue;
  L.push(`## ${g} · ${G[g]}`,'','| | 우선 | Method | 경로 | 용도 | 화면 | 역할 | 게이트 |','|:-:|:-:|---|---|---|---|---|---|');
  for(const r of s){
    const sc=r.screens.slice(0,2).map(x=>`\`${x}\``).join(' ')+(r.screens.length>2?'…':'');
    L.push(`| ${r.st==='IMPLEMENTED'?'✔':'·'} | ${r.prio} | \`${r.m}\` | \`${r.p.replace('/api/v1','')}\` | ${r.sum} | ${sc} | ${r.roles.slice(0,3).map(x=>x.replace('BIZ_','B_')).join('/')} | ${r.gates.map(x=>x.replace('_VERIFIED','').replace('ACTIVE_','')).join(' ')} |`);
  }
  L.push('');
}

L.push('## 스키마 정의 순서','','개발 트랙에 맞춰 붙입니다. 이 표의 우측이 0에서 채워지는 것이 API 개발 진척도입니다.','',
  '| 트랙 | API | 스키마 정의 |','|---|---:|---:|');
const seen=new Set();
for(const [name,px] of TRACKS){
  const s=rows.filter(r=>!seen.has(r.m+r.p) && px.some(x=>r.p.replace('/api/v1','').startsWith(x)));
  s.forEach(r=>seen.add(r.m+r.p));
  L.push(`| ${name} | ${s.length} | ${s.filter(r=>r.st==='IMPLEMENTED').length} |`);
}
L.push('');
L.push('## 공통 규약','','| 항목 | 규칙 |','|---|---|',
 '| 인증 | `Authorization: Bearer` · access 15분 · refresh 쿠키 14일 |',
 '| 오류 | `{ code, message, field?, details? }` — `code` 는 분기용 상수 |',
 '| 400 | 형식 오류 |','| 403 | 권한 없음 · 게이트 미충족 |',
 '| **409** | 상태 충돌 — **재시도해도 같은 결과** |',
 '| **422** | 정책 위반 — 형식은 맞으나 규칙이 막음 |',
 '| 목록 | 커서 페이지네이션 `?cursor=&limit=` · offset 금지 |',
 '| 멱등성 | 결제·정산·코드 발급은 `Idempotency-Key` 헤더 필수 |',
 '| 귀속 | 모든 요청에 `X-Ref-Code` 전달 가능 · 서버가 즉시 기록 |','',
 '## 게이트','','| 게이트 | 막는 것 | 근거 |','|---|---|---|',
 '| `IDENTITY` | 본인인증 전 거래 진입 | INV-7 |',
 '| `BUSINESS` | 거래 만들기 · 소개비 제시 · 계약서 발급 (소개비 수령은 본인인증 — v10.28 INV-10R) | INV-10 |',
 '| `SUBSCRIPTION` | 구독 없는 코드 발급 | INV-8 |');

fs.writeFileSync('docs/07_API스키마리스트.md', L.join('\n')+'\n');
console.log(`API 리스트: ${rows.length} 오퍼레이션 · 정의 ${impl}`);
