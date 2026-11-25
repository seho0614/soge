#!/usr/bin/env node
/**
 * ERP 마이그레이션 러너 (e1.1 · docs/001) — 소개뱅크 scripts/migrate.js 와 같은 규칙.
 *
 *   node scripts/migrate.js            적용
 *   node scripts/migrate.js --status   현황만
 *
 * - DB 는 ERP 데이터베이스(sgb_erp) — 연결 문자열 DATABASE_URL(ERP 서버 .env · 소개뱅크 DB 와 다름)
 * - 이력은 schema_migrations(같은 체크섬 규칙 · sha256 앞 16자) · 파일 이름은 E001_… 부터
 * - 이미 적용된 파일은 건너뛰고, 변경된 파일은 거부 · 파일 하나가 한 트랜잭션 · 실패하면 그 파일만 되돌리고 멈춤
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.ERP_MIGRATIONS_DIR || path.join(__dirname, '..', '..', 'prisma', 'migrations');
const MODE = process.argv[2] ?? 'apply';
const sum = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 필요'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const [{ db }] = (await c.query('SELECT current_database() AS db')).rows;
  if (db === 'sgb' && process.env.ERP_ALLOW_SGB_DB !== '1') {
    console.error('!! 소개뱅크 데이터베이스(sgb)에는 ERP 마이그레이션을 넣지 않습니다 — sgb_erp 로 연결하십시오');
    await c.end(); process.exit(1);
  }
  c.on('notice', (m) => { if (/ at RAISE\b/.test(m.where ?? '')) console.log(`   NOTICE ${m.message}`); });
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(), duration_ms int)`);

  let applied = 0, skipped = 0, drifted = 0, pending = 0;
  const dirs = fs.readdirSync(DIR).filter((d) => /^E\d{3}_/.test(d) && fs.existsSync(path.join(DIR, d, 'migration.sql'))).sort();
  for (const name of dirs) {
    const buf = fs.readFileSync(path.join(DIR, name, 'migration.sql'));
    const s = sum(buf);
    const { rows } = await c.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
    if (rows[0]) {
      if (rows[0].checksum !== s) {
        console.log(`!! ${name.padEnd(28)} 이미 적용된 파일이 변경됨 (${rows[0].checksum} → ${s})`);
        console.log('   적용된 마이그레이션은 수정하지 않습니다. 새 파일을 추가하십시오.');
        drifted++;
      } else { console.log(`.. ${name.padEnd(28)} 적용됨`); skipped++; }
      continue;
    }
    if (MODE === '--status' || MODE === '--dry-run') { console.log(`→  ${name.padEnd(28)} 적용 예정`); pending++; continue; }
    const t0 = Date.now();
    try {
      await c.query('BEGIN');
      await c.query(buf.toString('utf8'));
      const ms = Date.now() - t0;
      await c.query('INSERT INTO schema_migrations(name,checksum,duration_ms) VALUES ($1,$2,$3)', [name, s, ms]);
      await c.query('COMMIT');
      console.log(`ok ${name.padEnd(28)} ${ms}ms`);
      applied++;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.log(`!! ${name.padEnd(28)} ${String(e.message).slice(0, 80)}`);
      console.log('   중단합니다. 원인을 고친 뒤 다시 실행하면 여기서 이어집니다.');
      await c.end(); process.exit(1);
    }
  }
  await c.end();
  console.log('---');
  console.log(`적용 ${applied} · 기존 ${skipped} · 변경감지 ${drifted}${pending ? ` · 적용 예정 ${pending}` : ''}`);
  process.exit(drifted > 0 ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
