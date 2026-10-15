#!/usr/bin/env node
/* 트리거가 던지는 접두어가 오류 필터에 등록돼 있는가.
 *
 * ★ 등록되지 않으면 **"처리 중 오류가 발생했습니다" 만 보입니다.**
 *   트리거는 정확히 막는데 왜 안 되는지 이용자가 모릅니다 —
 *   그러면 같은 시도를 반복하고 결국 고객센터로 옵니다.
 *
 *   실제로 HLTC(재고 부족)가 그랬습니다. 막기는 막는데 이유가
 *   안 갔습니다.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const URL = process.env.DATABASE_URL;
if (!URL) { console.error('DATABASE_URL 이 필요합니다'); process.exit(1); }

const q = (sql) =>
  execFileSync('psql', [URL, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

/* 함수 본문에서 RAISE EXCEPTION 'XXX: ...' 의 XXX 를 모읍니다 */
const src = q(`SELECT string_agg(prosrc, E'\\n') FROM pg_proc p
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname LIKE 'fn\\_%'`);
const used = new Set(
  [...src.matchAll(/RAISE EXCEPTION\s+'([A-Z][A-Z0-9_-]{1,60}):/g)].map((m) => m[1]));

const filter = fs.readFileSync('src/common/db-error.filter.ts', 'utf8');

/* 포괄 규칙: 대문자 접두어를 통째로 받는 규칙이 있는가.
 * ★ 20261002 — 포괄 규칙의 **길이 상한**까지 봅니다. 상한보다 긴 접두어는 포괄 규칙을
 *   빠져나가 500 이 됩니다(실제로 15자 상한에 7종이 걸렸습니다). */
const catchAll = filter.match(/\[A-Z\]\[A-Z0-9_-\]\{1,(\d+)\}/);
const hasCatchAll = !!catchAll;
const maxLen = catchAll ? Number(catchAll[1]) + 1 : 0;

let miss = [];
for (const code of [...used].sort()) {
  /* 정규식 안에 그 접두어가 있는지 — 문자 집합([HLTPCOR] 등)도 봅니다 */
  /* 포괄 규칙이 있으면 전부 전달됩니다 — 하나씩 등록할 필요가 없습니다. */
  if (hasCatchAll && code.length <= maxLen) continue;
  if (hasCatchAll) { miss.push(code + `(${code.length}자 > 상한 ${maxLen}자)`); continue; }
  const direct = filter.includes(code + ':') || filter.includes(code + '\\\\s');
  const cls = new RegExp(code.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '\\[[A-Z]*' + code.slice(-1) + '[A-Z]*\\]').test(filter);
  if (!direct && !cls) miss.push(code);
}

console.log(`접두어 ${used.size}종 · 등록 ${used.size - miss.length}종`);
if (miss.length) {
  console.log(`  ▲ 등록 안 됨 ${miss.length}종 — ${miss.join(' ')}`);
  console.log('     src/common/db-error.filter.ts 에 규칙을 더하십시오.');
  console.log('     안 하면 "처리 중 오류가 발생했습니다" 만 보입니다.');
  process.exit(1);
}
console.log('  ok  트리거 오류가 모두 이용자에게 전달됩니다');
