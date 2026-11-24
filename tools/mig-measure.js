#!/usr/bin/env node
/**
 * v10.787 (docs/896) 큰 운영 반영 리허설 측정 — 마이그레이션마다 걸린 시간 · 잡은 표 잠금 · 되돌리기 위험
 *
 *   tools/mig-measure.sh 가 버리는 DB 안에서 부름(직접 쓰지 않음):
 *     DATABASE_URL=… node mig-measure.js <새 킷 prisma/migrations 폴더> <결과.tsv>
 *
 *   적용은 scripts/migrate.js 와 같은 규칙(파일 하나 = 한 트랜잭션 · 같은 체크섬 · schema_migrations 에 같은 줄)이라 끝난 DB 상태가 같습니다.
 *   다른 점은 COMMIT 바로 앞에서 이 연결이 쥔 잠금(pg_locks)을 읽는 것 하나 — 트랜잭션 안 잠금은 COMMIT 까지 쥐므로
 *   「운영에서 이 파일이 도는 동안 다른 요청이 그 표를 못 읽는 / 못 쓰는 시간」을 그대로 보여 줍니다.
 *     AccessExclusiveLock = 읽기도 막음(ALTER TABLE · DROP · 트리거 다시 만들기 등) · ShareLock 류 = 쓰기만 막음(CREATE INDEX 등)
 *   이 파일에서 새로 만든 표는 빼고(처음부터 아무도 안 씀) 전부터 있던 public 표만 셉니다.
 *
 *   결과 tsv 한 줄: 이름 · ms · 잠금 「표:모드:줄 수」 쉼표 묶음 · 되돌리기 위험 글자(지우기 · 이름 바꾸기 · NOT NULL 더함 · 형 바꿈)
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.argv[2];
const OUT = process.argv[3];
const sum = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const STRONG = ['AccessExclusiveLock', 'ExclusiveLock', 'ShareRowExclusiveLock', 'ShareLock'];

/* 옛 코드가 새 DB 로 돌 때 깨질 수 있는 글자 — 킷만 되돌리고 DB 는 그대로 두는 되돌리기(rollback.sh)가 안전한지 */
const RISK = [
  ['DROP COLUMN', /ALTER\s+TABLE[^;]*\bDROP\s+COLUMN\b/i],
  ['DROP TABLE', /\bDROP\s+TABLE\b(?!\s+IF\s+EXISTS\s+(?:public\.)?_)/i],
  ['RENAME', /ALTER\s+TABLE[^;]*\bRENAME\b/i],
  ['NOT NULL 더함', /ALTER\s+COLUMN\s+\w+\s+SET\s+NOT\s+NULL/i],
  ['형 바꿈', /ALTER\s+COLUMN\s+\w+\s+(SET\s+DATA\s+)?TYPE\b/i],
];
const strip = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), duration_ms int)`);
  const dirs = fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'migration.sql'))).sort();
  const lines = [];
  let applied = 0;
  for (const name of dirs) {
    const buf = fs.readFileSync(path.join(DIR, name, 'migration.sql'));
    const s = sum(buf);
    const { rows } = await c.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
    if (rows[0]) continue;
    const before = new Set((await c.query(`SELECT oid::text AS o FROM pg_class WHERE relkind IN ('r','p') AND relnamespace = 'public'::regnamespace`)).rows.map((r) => r.o));
    const t0 = Date.now();
    try {
      await c.query('BEGIN');
      await c.query(buf.toString('utf8'));
      const ms = Date.now() - t0;
      const lk = (await c.query(
        `SELECT c.oid::text AS o, c.relname AS t, l.mode, greatest(c.reltuples, 0)::bigint AS n
           FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
          WHERE l.pid = pg_backend_pid() AND l.granted AND c.relkind IN ('r','p') AND c.relnamespace = 'public'::regnamespace
            AND l.mode = ANY($1) AND c.relname <> 'schema_migrations'
          ORDER BY c.relname, l.mode`, [STRONG])).rows.filter((r) => before.has(r.o));
      const top = new Map();
      for (const r of lk) {   // 표마다 가장 센 잠금 하나
        const p = top.get(r.t);
        if (!p || STRONG.indexOf(r.mode) < STRONG.indexOf(p.mode)) top.set(r.t, r);
      }
      await c.query('INSERT INTO schema_migrations(name,checksum,duration_ms) VALUES ($1,$2,$3)', [name, s, ms]);
      await c.query('COMMIT');
      const sql = strip(buf.toString('utf8'));
      const risk = RISK.filter(([, re]) => re.test(sql)).map(([k]) => k);
      lines.push([name, ms, [...top.values()].map((r) => `${r.t}:${r.mode.replace('Lock', '')}:${r.n}`).join(',') || '-', risk.join(',') || '-'].join('\t'));
      applied++;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      lines.push([name, -1, 'ERROR', String(e.message).slice(0, 120)].join('\t'));
      fs.writeFileSync(OUT, lines.join('\n') + '\n');
      console.log(`!! ${name} ${String(e.message).slice(0, 80)}`);
      await c.end(); process.exit(1);
    }
  }
  fs.writeFileSync(OUT, lines.join('\n') + (lines.length ? '\n' : ''));
  await c.end();
  console.log(`측정 적용 ${applied}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
