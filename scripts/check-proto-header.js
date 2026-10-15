/* 헤더 메뉴의 링크가 진짜 주소인지 봅니다.
 *
 * ★ 왜 필요한가
 *   소개뱅크몰(HLT)은 관 라우트(/g/…)가 아니라 오버레이 앱(#/health)
 *   입니다. gwanHref 에 넘기면 GWAN 에 HLT 가 없어 "/" 를 돌려주고,
 *   헤더에서 누르면 **메인으로만 갔습니다.**
 *
 *   관 카드는 같은 이유로 이미 #/health 를 쓰고 있었는데 헤더만
 *   빠져 있었습니다. 주소 122개 검사로는 못 잡습니다 — 그 검사는
 *   주소를 직접 넣어 보는 것이지, 화면에 걸린 링크를 보지 않습니다.
 *
 *   사용법: node scripts/check-proto-header.js spec/proto.html
 */
const fs = require('fs'), vm = require('vm');
const h = fs.readFileSync(process.argv[2], 'utf8');
const js = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const mk = () => ({ innerHTML:'', textContent:'', addEventListener(){}, closest:()=>null,
  getAttribute:()=>null, setAttribute(){}, classList:{add(){},remove(){},toggle(){},contains:()=>false},
  style:{}, dataset:{}, querySelector:()=>mk(), querySelectorAll:()=>[], focus(){},
  scrollIntoView(){}, appendChild(){}, children:[] });
const screen = mk(), hltapp = mk();
const ctx = vm.createContext({ console,
  document:{ getElementById:(i)=>(i==='screen'?screen:(i==='hltapp'?hltapp:mk())), addEventListener(){},
    querySelector:()=>mk(), querySelectorAll:()=>[], createElement:()=>mk(),
    body:Object.assign(mk(),{dataset:{}}), documentElement:Object.assign(mk(),{dataset:{}}),
    readyState:'complete', title:'' },
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval(){},
  navigator:{userAgent:'Chrome'}, fetch:()=>Promise.reject(new Error('x')) });
ctx.globalThis=ctx; ctx.self=ctx; ctx.window=ctx;
ctx.location={hostname:'localhost',hash:'#/',pathname:'/',search:'',protocol:'file:'};
ctx.history={replaceState(){},pushState(){}};
ctx.matchMedia=()=>({matches:false,addEventListener(){}});
ctx.addEventListener=()=>{}; ctx.scrollTo=()=>{}; ctx.innerWidth=1440;
ctx.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
ctx.alert=()=>{}; ctx.confirm=()=>true;
vm.runInContext(js, ctx);

const out = String(screen.innerHTML || '');
const nav = out.match(/<nav class="gnb">([\s\S]*?)<\/nav>/);
if (!nav) { console.log('  ★   헤더(gnb)를 찾을 수 없습니다'); process.exit(1); }

const links = [...nav[1].matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
  .map(m => ({ href: m[1], text: m[2].trim() }));

/* 목적지가 아직 안 정해진 메뉴입니다 — href="#" 가 **맞습니다.**
 * 관(關)만 진짜 주소를 가져야 합니다. */
const PENDING = ['이용안내', '소개광장'];

let bad = 0;
for (const l of links) {
  if (PENDING.includes(l.text)) {
    console.log('  --  ' + l.text.padEnd(12) + '목적지 미정 (의도된 것)');
    continue;
  }
  /* "/" 나 "#" 만 있으면 아무 데도 안 갑니다 */
  const dead = l.href === '/' || l.href === '#' || l.href === '';
  console.log('  ' + (dead ? '★  ' : 'ok ') + l.text.padEnd(12) + l.href);
  if (dead) bad++;
}
console.log(bad === 0
  ? `  ok  헤더 관 링크 ${links.length - PENDING.length}개 전부 살아 있습니다`
  : `  ★   ${bad}개가 아무 데도 안 갑니다`);
process.exit(bad === 0 ? 0 : 1);
