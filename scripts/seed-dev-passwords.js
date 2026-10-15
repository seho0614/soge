#!/usr/bin/env node
/**
 * 개발 계정 비밀번호 설정.
 *
 * fixture.sql 은 password_hash 를 'h' 로 둡니다. 평문도 bcrypt 해시도 아닌
 * 자리표시자라, 이걸 돌리지 않으면 **로그인이 되지 않습니다.**
 * 픽스처만 넣고 로그인이 안 된다며 시간을 쓰기 쉬운 자리입니다.
 *
 *   node scripts/seed-dev-passwords.js
 *
 * 운영에서는 절대 실행하지 마십시오. NODE_ENV=production 이면 거부합니다.
 */
require('./load-env');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const PW = process.env.DEV_PASSWORD || 'sgb-dev-1234';

if (process.env.NODE_ENV === 'production') {
  console.error('운영 환경에서는 실행할 수 없습니다.');
  process.exit(1);
}

(async () => {
  const c = new Client(process.env.DATABASE_URL);
  await c.connect();

  // 이미 bcrypt 해시가 들어 있는 계정은 건드리지 않습니다.
  // bcrypt 해시는 항상 $2 로 시작합니다.
  const { rows } = await c.query(
    `SELECT id, email FROM accounts WHERE password_hash NOT LIKE '$2%'`);

  if (rows.length === 0) {
    console.log('설정할 계정이 없습니다 (이미 전부 해시됨).');
    await c.end();
    return;
  }

  const hash = await bcrypt.hash(PW, 12);
  for (const r of rows) {
    await c.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [hash, r.id]);
    console.log(`  ${r.email}  →  ${PW}`);
  }
  console.log(`개발 계정 ${rows.length}건 설정 완료`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
