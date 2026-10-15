#!/usr/bin/env node
/**
 * DB 의 code_labels 에서 TypeScript 상수를 생성합니다.
 *
 * 라벨을 프런트에 하드코딩하지 않는 이유:
 *   "노출 중" 을 "게시 중" 으로 바꾸려고 배포하는 일이 생깁니다.
 * 대신 코드 목록과 타입은 컴파일 타임에 고정해 오타를 막습니다.
 *
 * 사용: DATABASE_URL=... node scripts/gen-codes.js > src/generated/codes.ts
 */
const { Client } = require('pg');
require('./load-env');

const toPascal = (s) => s.split(/[._]/).map(w => w[0].toUpperCase() + w.slice(1)).join('');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `SELECT domain, code, label, short_label, ui_tone, audience, sort_order
       FROM code_labels WHERE is_active ORDER BY domain, sort_order`);
  await c.end();

  const byDomain = {};
  for (const r of rows) (byDomain[r.domain] ??= []).push(r);

  const out = [];
  out.push('// 자동 생성 파일 — 직접 수정하지 마십시오.');
  out.push('// 생성: node scripts/gen-codes.js > src/generated/codes.ts');
  out.push('// 원본: code_labels 테이블 (마이그레이션 220_code_registry)');
  out.push('');

  /* 코드에 하이픈이나 점이 있으면 그대로는 식별자가 되지 않습니다.
   * RSK-07 같은 코드가 들어오자 생성 파일이 통째로 깨졌습니다.
   * 유효한 식별자가 아니면 따옴표로 감쌉니다. */
  const key = (c) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(c) ? c : `'${c}'`);

  for (const [domain, list] of Object.entries(byDomain)) {
    const name = toPascal(domain);
    out.push(`/** ${domain} */`);
    out.push(`export const ${name} = {`);
    for (const r of list) out.push(`  ${key(r.code)}: '${r.code}',`);
    out.push(`} as const;`);
    out.push(`export type ${name} = (typeof ${name})[keyof typeof ${name}];`);
    out.push(`export const ${name}Order: readonly ${name}[] = [${list.map(r => `'${r.code}'`).join(', ')}];`);
    out.push('');
  }

  out.push('/** 화면 표시용 메타. 라벨은 DB 가 정본이며 이 값은 폴백입니다. */');
  out.push('export const CodeMeta: Record<string, Record<string, {');
  out.push('  label: string; shortLabel?: string; tone?: string; audience: string;');
  out.push('}>> = {');
  for (const [domain, list] of Object.entries(byDomain)) {
    out.push(`  '${domain}': {`);
    for (const r of list) {
      const parts = [`label: ${JSON.stringify(r.label)}`];
      if (r.short_label) parts.push(`shortLabel: ${JSON.stringify(r.short_label)}`);
      if (r.ui_tone) parts.push(`tone: '${r.ui_tone}'`);
      parts.push(`audience: '${r.audience}'`);
      out.push(`    ${key(r.code)}: { ${parts.join(', ')} },`);
    }
    out.push('  },');
  }
  out.push('};');
  out.push('');
  out.push('export function codeLabel(domain: string, code: string): string {');
  out.push('  return CodeMeta[domain]?.[code]?.label ?? code;');
  out.push('}');

  process.stdout.write(out.join('\n') + '\n');
})().catch(e => { console.error(e.message); process.exit(1); });
