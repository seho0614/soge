#!/usr/bin/env node
/* 브라우저처럼 띄워 **콘솔 오류**가 나는지 봅니다.
 *
 * ★ getElementById 가 없는 id 에 null 을 주는 것까지 흉내 냅니다 —
 *   실제 브라우저와 같습니다. render 검사는 통과하는데 콘솔에만
 *   오류가 뜨는 것을 잡습니다.
 */
const fs=require('fs'), vm=require('vm');
const h=fs.readFileSync(process.argv[2],'utf8');
const js=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const errs=[];
const mk=()=>({innerHTML:'',textContent:'',addEventListener(){},closest:()=>null,
  getAttribute:()=>null,setAttribute(){},classList:{add(){},remove(){},toggle(){},contains:()=>false},
  style:{},dataset:{},querySelector:()=>mk(),querySelectorAll:()=>[],focus(){},
  appendChild(){},children:[],onclick:null,hidden:false});
const els={};
/* HTML 에 있는 id 만 진짜로 있는 것처럼 — 없으면 null */
const realIds=new Set([...h.matchAll(/\bid="([\w-]+)"/g)].map(m=>m[1]));
for(const m of h.matchAll(/id=\\?["']([\w-]+)\\?["']/g)) realIds.add(m[1]);
const ctx=vm.createContext({
  console:{log(){},warn(){},error(...a){errs.push(String(a[0]).slice(0,90));}},
  document:{getElementById:(i)=>realIds.has(i)?(els[i]=els[i]||mk()):null,
    addEventListener(){},querySelector:()=>mk(),querySelectorAll:()=>[],
    createElement:()=>mk(),body:mk(),documentElement:Object.assign(mk(),{style:{}}),
    readyState:'complete',title:''},
  setTimeout:(f)=>{try{f();}catch(e){errs.push('setTimeout: '+e.message.slice(0,70));}},
  clearTimeout,setInterval:()=>0,clearInterval(){},
  navigator:{userAgent:'Chrome'},fetch:()=>Promise.reject(new Error('x'))});
ctx.globalThis=ctx; ctx.self=ctx; ctx.window=ctx;
ctx.location={hostname:'localhost',hash:'#/',pathname:'/',search:'',protocol:'file:'};
ctx.history={replaceState(){},pushState(){}};
ctx.matchMedia=()=>({matches:false,addEventListener(){}});
ctx.addEventListener=()=>{}; ctx.scrollTo=()=>{}; ctx.innerWidth=1440;
ctx.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
ctx.alert=()=>{}; ctx.confirm=()=>true;
try{ vm.runInContext(js, ctx); }catch(e){ errs.push('로드: '+e.message.slice(0,80)); }
console.log(errs.length ? '★ 오류 '+errs.length+'건' : '  ok  콘솔 오류 없음');
errs.slice(0,5).forEach(e=>console.log('     '+e));
