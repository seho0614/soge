#!/usr/bin/env node
/**
 * SQL ↔ 스키마 대조 — 코드에 적힌 SQL 을 실제 DB 에 PREPARE 해 봅니다.
 *
 *   DATABASE_URL=... node scripts/check-sql.js
 *
 * ── 왜 필요한가 (20260930) ─────────────────────────────────────────
 * 마이그레이션으로 열·표를 바꾸면, 그 열을 읽는 코드는 **그 API 를 부를 때까지**
 * 아무 말이 없습니다. 이번 점검에서 이렇게 숨어 있던 500 이 6건 나왔습니다.
 *   notices.starts_at · subscription_plans.monthly_fee · referral_codes.account_id
 *   referral_codes.listing_id · ledger_entries(표 없음) ×2
 * PREPARE 는 실행하지 않고 **구문과 이름만** 확인하므로 데이터에 영향이 없습니다.
 *
 * ── 한계 ─────────────────────────────────────────────────────────
 * `${...}` 로 조립하는 SQL 은 조각을 알 수 없어 건너뜁니다(건수를 보고합니다).
 * 매개변수 형을 추론하지 못하는 경우($1 IS NULL 등)는 이름 오류가 아니므로 통과로 봅니다.
 */
require('./load-env');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'generated') walk(p); }
    else if (f.endsWith('.ts')) files.push(p);
  }
})(path.join(ROOT, 'src'));

const SQL_HEAD = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const items = [];
let dynamic = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/`([^`]*)`/g)) {
    const sql = m[1];
    if (!SQL_HEAD.test(sql)) continue;
    if (sql.includes('${')) { dynamic++; continue; }
    const line = s.slice(0, m.index).split('\n').length;
    items.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), line, sql });
  }
}

/* 이름 오류만 셉니다 — 형 추론 실패 · 권한 · 트리거성 오류는 실행 시점 문제입니다 */
const NAME_ERR = /does not exist|column reference .* is ambiguous|syntax error/;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  let ok = 0; const bad = [];
  for (const [i, it] of items.entries()) {
    try {
      await c.query('BEGIN');
      await c.query(`PREPARE _chk${i} AS ${it.sql}`);
      ok++;
    } catch (e) {
      if (NAME_ERR.test(e.message)) bad.push({ ...it, err: e.message });
      else ok++;
    } finally {
      await c.query('ROLLBACK').catch(() => {});
    }
  }
  await c.end();
  for (const b of bad) {
    console.log(`  FAIL ${b.file}:${b.line}  ${b.err}`);
  }
  console.log(`SQL 대조: 확인 ${items.length} · 통과 ${ok} · 이름 오류 ${bad.length} · 동적 SQL 건너뜀 ${dynamic}`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
