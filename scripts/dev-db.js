#!/usr/bin/env node
/**
 * Docker 도 PostgreSQL 도 없는 개발 PC 용 임베디드 PostgreSQL 16.
 *
 *   npm i -D embedded-postgres@16.14.0-beta.17     (최초 1회 · 약 100MB · 저장소에 넣지 않습니다)
 *   npm run db:embedded                            (포트 54329 · 데이터는 .dev-db/)
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:54329/sgb
 *
 * 마이그레이션은 psql 없이 `npm run db:migrate` (scripts/migrate.js) 로 적용합니다.
 * verify-invariants.sh 처럼 psql 을 쓰는 스크립트는 Docker 나 실제 PostgreSQL 에서 돌리십시오.
 */
const path = require('path');
let EmbeddedPostgres;
try { const m = require('embedded-postgres'); EmbeddedPostgres = m.default ?? m; }
catch { console.error('embedded-postgres 가 없습니다:  npm i -D embedded-postgres@16.14.0-beta.17'); process.exit(1); }

const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
(async () => {
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(__dirname, '..', '.dev-db'),
    user: 'postgres', password: 'postgres', port: PORT, persistent: true,
    // 루트로 실행하면 PostgreSQL 이 뜨지 않습니다.
    // 컨테이너·CI 에서는 대개 루트라 이 옵션이 없으면 그냥 죽습니다.
    createPostgresUser: process.getuid ? process.getuid() === 0 : false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  try { await pg.initialise(); } catch { /* 이미 초기화됨 */ }
  await pg.start();
  await pg.createDatabase('sgb').catch(() => {});
  console.log(`\nDATABASE_URL=postgresql://postgres:postgres@localhost:${PORT}/sgb\n(Ctrl+C 로 종료)`);
  const stop = async () => { try { await pg.stop(); } catch {} process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
})().catch((e) => { console.error(e); process.exit(1); });
