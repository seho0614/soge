#!/usr/bin/env node
/**
 * 마이그레이션 러너 (Node 판). scripts/migrate.sh 와 같은 규칙이며 psql 이 없어도 돕니다.
 *
 *   node scripts/migrate.js            적용
 *   node scripts/migrate.js --status   현황만
 *
 * - 이력은 schema_migrations 에 남깁니다 (migrate.sh 와 같은 테이블 · 같은 체크섬 규칙)
 * - 이미 적용된 파일은 건너뛰고, 변경된 파일은 거부합니다
 * - 파일 하나가 한 트랜잭션입니다. 중간 실패 시 그 파일만 되돌아가고 여기서 멈춥니다
 */
require('./load-env');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const MODE = process.argv[2] ?? 'apply';
const sum = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 필요'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(), duration_ms int)`);

  let applied = 0, skipped = 0, drifted = 0, pending = 0;
  const dirs = fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'migration.sql'))).sort();
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
