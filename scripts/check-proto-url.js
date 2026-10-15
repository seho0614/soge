#!/usr/bin/env node
/* 시안의 특정 주소를 실제로 열어 무엇이 그려지는지 봅니다.
 *
 * ★ `check-proto-render.js` 는 **로드만** 봅니다. 주소가 404 로
 *   떨어지는 것은 못 잡습니다 — `/g/hlt` 가 실제로 그랬습니다.
 *
 * ★ 그리는 곳은 `#app` 이 아니라 **`#screen`** 입니다.
 *   잘못 보면 "아무것도 안 그려짐" 으로 나옵니다.
 *
 * 쓰는 법:  node scripts/check-proto-url.js <시안.html> '#/g/hlt'
 */
const fs=require('fs'), vm=require('vm');
const h=fs.readFileSync(process.argv[2],'utf8');
const js=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const hltapp={innerHTML:'',addEventListener(){},classList:{add(){},remove(){},toggle(){},contains:()=>false},style:{},dataset:{},querySelector:()=>null,querySelectorAll:()=>[],appendChild(){},children:[]};
const screen={innerHTML:'',addEventListener(){},classList:{add(){},remove(){},toggle(){},contains:()=>false},
  style:{},dataset:{},querySelector:()=>null,querySelectorAll:()=>[],appendChild(){},children:[]};
const el=()=>({innerHTML:'',textContent:'',addEventListener(){},closest:()=>null,
  getAttribute:()=>null,setAttribute(){},classList:{add(){},remove(){},toggle(){},contains:()=>false},
  style:{},dataset:{},querySelector:()=>el(),querySelectorAll:()=>[],focus(){},
  scrollIntoView(){},appendChild(){},children:[]});
const ctx=vm.createContext({console,
  document:{getElementById:(i)=>(i==='screen'?screen:(i==='hltapp'?hltapp:el())),addEventListener(){},
    querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),
    body:Object.assign(el(),{dataset:{}}),documentElement:Object.assign(el(),{dataset:{}}),
    readyState:'complete',title:''},
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},
  navigator:{userAgent:'Chrome'},fetch:()=>Promise.reject(new Error('x'))});
ctx.globalThis=ctx; ctx.self=ctx; ctx.window=ctx;
ctx.location={hostname:'localhost',hash:process.argv[3]||'#/',
  pathname:'/',search:'',protocol:'file:'};
ctx.history={replaceState(){},pushState(){}};
ctx.matchMedia=()=>({matches:false,addEventListener(){}});
ctx.addEventListener=()=>{}; ctx.scrollTo=()=>{}; ctx.innerWidth=1440;
ctx.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
ctx.alert=()=>{}; ctx.confirm=()=>true;
try{ vm.runInContext(js, ctx); }
catch(e){ console.log('★ 로드 오류:', e.message.slice(0,90)); process.exit(1); }
/* ★ 건강몰은 별도 앱이라 #hltapp 에 그립니다 — #screen 만 보면 404 로 보입니다. */
const out=String(screen.innerHTML||'')+String(hltapp.innerHTML||'');
const V=ctx.__VIEW;
if(V) console.log('  화면 '+Object.keys(V.screens||{}).length+'개 등록');
const url=process.argv[3]||'#/';
if(!out){ console.log(`  ${url}  ★ 아무것도 안 그려짐`); process.exit(1); }
/* 건강몰이 그렸으면 그쪽이 앞에 덮입니다 — 본체 404 는 가려집니다. */
const hlt=String(hltapp.innerHTML||'').length>500;
const H=String(hltapp.innerHTML||'');
if(H) { console.log('     헤더: '
  + (H.includes('hlt-gnb')?'★ 건강몰 자체':'')
  + (H.includes('관리자 페이지')||H.includes('나의공간')?'본체 헤더':'')
  + (H.includes('hlt-cartlink')?' · 장바구니 있음':'')); }
const is404=!hlt && out.includes('페이지를 찾을 수 없습니다');
/* ★ 법정 고지는 화면 성격마다 **문장이 달라야 맞습니다.**
 *
 *   목록 · 장바구니  직판과 중개가 섞임
 *                    → "일부 상품은 … 통신판매중개자로서 거래의 당사자가 아닙니다"
 *   직판 상품 상세    → "… 가 직접 판매하는 상품입니다"
 *   중개 상품 상세    → "… 는 통신판매중개자로서 거래의 당사자가 아닙니다"
 *   이용 안내         → "직접 판매합니다. 당사가 통신판매업자입니다"
 *
 *   예전에는 모든 화면에서 "직접 판매합니다" 하나만 찾았습니다.
 *   목록에는 그 문장이 없는 것이 **맞는데도** 빠진 것으로 보고했고,
 *   반대로 고지가 진짜 없어졌을 때도 알아채지 못했습니다.
 *
 *   그래서 "둘 중 하나라도 있으면 ok, 둘 다 없으면 ★" 로 봅니다.
 *   어느 쪽이 나왔는지도 함께 적어 화면이 뒤바뀌면 눈에 띄게 합니다. */
const DIRECT = '직접 판매';
const BROKER = '통신판매중개자';
const hasD = out.includes(DIRECT), hasB = out.includes(BROKER);
const legal = (hasD || hasB)
  ? 'ok  법정 고지 (' + [hasD?'직판':null, hasB?'중개':null].filter(Boolean).join(' · ') + ')'
  : '★   법정 고지 — 직판·중개 문구가 **둘 다 없습니다**';

const marks=[['건강몰 제목','건강몰'],
  ['상품 카드','hlt-card'],['성분|함량','hlt-ingline'],['한 달 단가','hlt-unit']];
console.log(`  ${url}  ${out.length}자  ${is404?'★ 404':'ok'}`);
console.log('     ' + legal);
for(const [nm,k] of marks) console.log(`     ${out.includes(k)?'ok ':'★  '} ${nm}`);
