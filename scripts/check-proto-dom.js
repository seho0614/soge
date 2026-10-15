#!/usr/bin/env node
/* 없는 요소에 이벤트를 거는 곳을 찾습니다.
 *
 * ★ `getElementById("x").addEventListener(...)` 는 x 가 없으면
 *   **"Cannot read properties of null" 로 그 자리에서 멈춥니다.**
 *   문법은 맞아 node --check 는 통과하고, 화면은 그려지는데
 *   그 뒤 코드가 안 돕니다.
 *
 *   실제로 초록 띠를 빼면서 닫기 버튼만 사라지고 잡는 줄이
 *   남아 메인이 멈췄습니다.
 *
 * 쓰는 법:  node scripts/check-proto-dom.js <시안.html>
 */
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('시안 파일 경로가 필요합니다'); process.exit(1); }
const h = fs.readFileSync(file, 'utf8');

/* HTML 에 실재하는 id */
const ids = new Set([...h.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
/* 코드가 만들어 붙이는 id (innerHTML 안의 id=) */
for (const m of h.matchAll(/id=\\?["']([\w-]+)\\?["']/g)) ids.add(m[1]);

let bad = [];
/* .getElementById("x") 뒤에 곧바로 . 이 오면 null 검사가 없습니다 */
for (const m of h.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)\s*\.(\w+)/g)) {
  const [, id, prop] = m;
  if (ids.has(id)) continue;
  if (prop === 'innerHTML' || prop === 'textContent') continue; /* 쓰기는 덜 위험 */
  bad.push(`${id}.${prop}`);
}
bad = [...new Set(bad)];
console.log(`id ${ids.size}개 확인` + (bad.length
  ? `  ✗ 없는 요소 ${bad.length}건 — ${bad.join(' · ')}`
  : '  ok  없는 요소에 거는 곳 없음'));
if (bad.length) {
  console.log('     요소를 지우셨으면 **잡는 줄도 함께** 지우십시오.');
  process.exit(1);
}
