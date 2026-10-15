#!/usr/bin/env node
/* 시안을 실제로 띄워 봅니다.
 *
 * ★ `node --check` 는 **문법만** 봅니다. 없는 이름을 불러도 통과하고
 *   그 화면을 열 때만 터집니다 — 실제로 `esc is not defined` 와
 *   `gwanHosts is not defined` 가 그렇게 나왔습니다.
 *
 *   시안은 M_config · M_render · M_render2 … 12개 모듈로 나뉘어 있어,
 *   **한쪽 도우미를 다른 쪽에서 그냥 부르면 안 됩니다.**
 *   M_render2 는 esc 가 아니라 e, header 가 아니라 H 를 씁니다.
 *
 * 쓰는 법:  node scripts/check-proto-render.js <시안.html>
 */
const fs = require('fs'), vm = require('vm');
const file = process.argv[2];
if (!file) { console.error('시안 파일 경로가 필요합니다'); process.exit(1); }

const h = fs.readFileSync(file, 'utf8');
const js = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

const el = () => ({ innerHTML:'', textContent:'', addEventListener(){}, closest:()=>null,
  getAttribute:()=>null, setAttribute(){},
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  style:{}, dataset:{}, querySelector:()=>el(), querySelectorAll:()=>[],
  focus(){}, scrollIntoView(){}, appendChild(){}, children:[] });
const store = {};
const ctx = vm.createContext({ console: { log(){}, warn(){}, error(){} },
  document:{ getElementById:(i)=>(store[i]=store[i]||el()), addEventListener(){},
    querySelector:()=>el(), querySelectorAll:()=>[], createElement:()=>el(),
    body:Object.assign(el(),{dataset:{}}), documentElement:Object.assign(el(),{dataset:{}}),
    readyState:'complete', title:'' },
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval(){},
  navigator:{userAgent:'Chrome'}, fetch:()=>Promise.reject(new Error('x')) });
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
ctx.location = { hostname:'localhost', hash:'', pathname:'/', search:'', protocol:'file:' };
ctx.history = { replaceState(){}, pushState(){} };
ctx.matchMedia = () => ({ matches:false, addEventListener(){} });
ctx.addEventListener = () => {}; ctx.scrollTo = () => {}; ctx.innerWidth = 1440;
ctx.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
ctx.alert = () => {}; ctx.confirm = () => true;

try {
  vm.runInContext(js, ctx);
} catch (e) {
  console.log(`  ✗ 시안이 뜨지 않습니다 — ${e.message}`);
  console.log('     문법은 맞습니다. 없는 이름을 불렀거나 모듈 경계를 넘었습니다.');
  console.log('     M_render2 는 esc 가 아니라 e, header 가 아니라 H 를 씁니다.');
  process.exit(1);
}
console.log('  ok  시안이 오류 없이 뜹니다');
