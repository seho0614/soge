/* 모듈 경계를 넘는 호출이 실제로 연결돼 있는가.
 *
 * ★ 시안은 IIFE 로 나뉘어 있어 **한쪽에서 정의한 함수를 다른 쪽에서
 *   그냥 부르면 "is not defined" 가 납니다.** JS 문법 검사는 통과하고
 *   그 화면을 열 때만 터집니다.
 */
const fs=require('fs');
const h=fs.readFileSync(process.argv[2] || 'spec/proto.html','utf8')  /* 20261002 — 고정 경로였습니다 */;
const js=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');

// M_xxx 모듈별로 나눕니다
const mods=[...js.matchAll(/(?:var|const)\s+(M_\w+)\s*=\s*\(function/g)].map(m=>m[1]);
let bad=[];
for(const mod of mods){
  const i=js.indexOf(mod+' = (function');
  const j=js.indexOf('\n})(', i);
  if(j<0) continue;
  const body=js.slice(i,j);
  // 이 모듈이 부르는 M_config.xxx
  const imported=new Set([...body.matchAll(/M_config\.(\w+)/g)].map(m=>m[1]));
  // 이 모듈 안에서 정의된 것
  const defined=new Set([...body.matchAll(/function\s+(\w+)\s*\(/g)].map(m=>m[1]));
  [...body.matchAll(/\bvar\s+(\w+)\s*=/g)].forEach(m=>defined.add(m[1]));
  // config 함수를 정의도 import 도 없이 부르는가
  for(const fn of ['gwanHosts','gwanHref','currentGwan','readPath','writePath','homeHref']){
    /* AUTH.gwanHref 처럼 객체를 거쳐 부르는 것은 정상입니다 */
    const bare=new RegExp('(^|[^.\\w])'+fn+'\\(');
    if(bare.test(body) && !defined.has(fn) && !imported.has(fn))
      bad.push(mod+' → '+fn);
  }
}
console.log('모듈 '+mods.length+'개'+(bad.length?('  ★ 미연결 '+bad.join(' · ')):'  경계 연결 정상'));
