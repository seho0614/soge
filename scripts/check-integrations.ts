/**
 * 외부 연동 목록 대조 (v10.44 · 2026-10-15 · 외부 연동 틀 통일)
 *
 *   src/common/integration/registry.ts  ↔  DB integrations 표 · site_settings assume.*  ↔  deploy/aws/env.production.example  ↔  코드
 *
 * 확인하는 것
 *   ① DB integrations 의 코드와 목록표의 코드(dbRow)가 같음 — 한쪽에만 있으면 실패
 *   ② integrations.secret_key_name = 목록표 secretEnv (D026 처럼 이름이 어긋나면 운영 화면이 엉뚱한 키를 「등록됨」으로 보임)
 *   ③ 목록표의 키 이름이 운영 .env 예시에 있음 — 사람이 운영 서버에 넣을 때 빠뜨리지 않게
 *   ④ 목록표의 간주 스위치가 DB 에 있고, DB 의 assume.* 는 모두 목록표에 있음
 *   ⑤ 구현 파일이 있음 · 어댑터가 있다고 적은 연동(REAL · STUB)은 코드가 그 키를 읽음
 *
 * 실행:  DATABASE_URL=… npx ts-node -P tsconfig.scripts.json scripts/check-integrations.ts
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { INTEGRATIONS } from '../src/common/integration/registry';

const ROOT = path.join(__dirname, '..');
const URL = process.env.DATABASE_URL;
if (!URL) { console.error('DATABASE_URL 이 필요합니다'); process.exit(1); }
const q = (sql: string) => execFileSync('psql', [URL, '-tAq', '-F', '|', '-c', sql], { encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|'));

let fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (!cond) fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? `  — ${detail}` : ''));
};

/* ① ② */
const db = new Map(q(`SELECT code, coalesce(secret_key_name, '') FROM integrations ORDER BY code`).map(([c, k]) => [c, k]));
const reg = INTEGRATIONS.filter((i) => i.dbRow);
const onlyDb = [...db.keys()].filter((c) => !reg.some((i) => i.code === c));
const onlyReg = reg.filter((i) => !db.has(i.code)).map((i) => i.code);
ok('① DB integrations 코드 = 목록표', !onlyDb.length && !onlyReg.length, `DB 에만 ${onlyDb.join(',') || '-'} · 목록표에만 ${onlyReg.join(',') || '-'}`);
const keyDiff = reg.filter((i) => db.has(i.code) && db.get(i.code) !== i.secretEnv).map((i) => `${i.code}: DB ${db.get(i.code)} ≠ ${i.secretEnv}`);
ok('② 키 이름 DB = 목록표', !keyDiff.length, keyDiff.join(' · '));

/* ③ */
const envEx = fs.readFileSync(path.join(ROOT, 'deploy/aws/env.production.example'), 'utf8');
const missEnv = INTEGRATIONS.filter((i) => !new RegExp(`\\b${i.secretEnv}=`).test(envEx)).map((i) => i.secretEnv);
ok('③ 키 이름이 운영 .env 예시에 있음', !missEnv.length, missEnv.join(' · '));

/* ④ */
const assumeDb = q(`SELECT substr(key, 8) FROM site_settings WHERE key LIKE 'assume.%' ORDER BY key`).map(([k]) => k);
const assumeReg = INTEGRATIONS.map((i) => i.assume).filter((a): a is NonNullable<typeof a> => !!a);
const aOnlyDb = assumeDb.filter((a) => !assumeReg.includes(a as any));
const aOnlyReg = assumeReg.filter((a) => !assumeDb.includes(a));
ok('④ 간주 스위치 DB = 목록표', !aOnlyDb.length && !aOnlyReg.length, `DB 에만 ${aOnlyDb.join(',') || '-'} · 목록표에만 ${aOnlyReg.join(',') || '-'}`);

/* ⑤ */
const missFile = INTEGRATIONS.flatMap((i) => i.files).filter((f) => !fs.existsSync(path.join(ROOT, f)));
ok('⑤ 구현 파일이 있음', !missFile.length, missFile.join(' · '));
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (['node_modules', '.next', 'generated'].includes(e.name) ? [] : walk(path.join(d, e.name)))
    : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
const code = ['src', 'site/src', 'web/src'].filter((d) => fs.existsSync(path.join(ROOT, d)))
  .flatMap((d) => walk(path.join(ROOT, d))).filter((f) => !f.endsWith('registry.ts'))
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const unread = INTEGRATIONS.filter((i) => i.adapter !== 'NONE' && !code.includes(i.secretEnv)).map((i) => `${i.code}(${i.secretEnv})`);
ok('⑤ 어댑터가 있는 연동은 코드가 키를 읽음', !unread.length, unread.join(' · '));

console.log(fail ? `외부 연동 목록 대조 — 실패 ${fail}` : '외부 연동 목록 대조 — 전체 통과');
process.exit(fail ? 1 : 0);
