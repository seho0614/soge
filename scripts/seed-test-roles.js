#!/usr/bin/env node
/* 권한 시험용 계정 6종.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────
 * 코드는 역할 7종을 쓰는데 **DB 에는 ADMIN·SUPER 둘만** 부여돼
 * 있었습니다. BIZ_OWNER 가 36곳, MEMBER 가 22곳에 걸려 있는데
 * 그 역할을 가진 사람이 없어 **시험할 수가 없었습니다.**
 *
 * ── 비밀번호는 전부 같습니다 ────────────────────────────────────
 * 시험용이라 외우기 쉬운 편이 낫습니다. 운영에는 올라가지 않습니다 —
 * 이메일이 @t.local 이라 check-secrets 가 잡습니다.
 *
 * 쓰는 법:  node scripts/seed-test-roles.js
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const URL = process.env.DATABASE_URL;
if (!URL) { console.error('DATABASE_URL 이 필요합니다'); process.exit(1); }

const PW = 'sgb-test-1234';

const ACCOUNTS = [
  { email: 'member@t.local',   name: '시험 일반회원', roles: ['MEMBER'],
    note: '가입만 한 상태. 소개 요청·문의는 되고 등록은 막힙니다' },
  { email: 'bizowner@t.local', name: '시험 사업자대표', roles: ['MEMBER', 'BIZ_OWNER'],
    note: '리스팅 등록·정산 신청 가능. 사업자 인증 완료 상태' },
  { email: 'bizstaff@t.local', name: '시험 사업자직원', roles: ['MEMBER', 'BIZ_STAFF'],
    note: '대표가 아닌 직원. 등록은 되나 정산 계좌는 못 만집니다' },
  { email: 'reviewer@t.local', name: '시험 검수자',   roles: ['REVIEWER'],
    note: '검수 큐만 봅니다. 회원정보·정산은 못 봅니다' },
  { email: 'ops@t.local',      name: '시험 운영',     roles: ['ADMIN'],
    note: '이상 감시 · 정산 승인 · 원장 열람. **지급 실행은 못 합니다**' },
  { email: 'payout@t.local',   name: '시험 지급전담', roles: ['PAYOUT'],
    note: '원장 열람 · 지급 실행. **정산 승인은 못 합니다**' },
];

(async () => {
  const c = new Client({ connectionString: URL });
  await c.connect();

  /* 이미 있으면 지우고 다시 만듭니다 — 역할이 바뀌었을 수 있습니다 */
  await c.query(`SET session_replication_role = replica`);
  await c.query(`DELETE FROM accounts WHERE email LIKE '%@t.local'`);
  await c.query(`SET session_replication_role = origin`);

  const hash = await bcrypt.hash(PW, 10);
  const grantor = (await c.query(
    `SELECT id FROM accounts WHERE email = 'admin@x.com' LIMIT 1`)).rows[0]?.id ?? null;

  for (const a of ACCOUNTS) {
    const { rows } = await c.query(
      `INSERT INTO accounts (email, password_hash, name, account_type, status,
                             identity_verified_at)
       VALUES ($1,$2,$3,'PERSONAL','ACTIVE', now())
       RETURNING id`,
      [a.email, hash, a.name]);
    const id = rows[0].id;

    for (const r of a.roles) {
      /* ★ granted_by 가 없으면 넣을 수 없습니다 — 누가 준 권한인지
         모르면 나중에 회수할 근거가 없습니다. */
      await c.query(
        `INSERT INTO account_roles (account_id, role, granted_by)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, r, grantor]);
    }

    /* 사업자 역할에는 사업자 인증을 붙입니다 — 없으면 게이트에 막혀
       무엇이 역할 때문이고 무엇이 인증 때문인지 구분이 안 됩니다. */
    if (a.roles.includes('BIZ_OWNER') || a.roles.includes('BIZ_STAFF')) {
      const biz = (await c.query(
        `SELECT id FROM businesses LIMIT 1`)).rows[0]?.id;
      if (biz) {
        await c.query(
          `INSERT INTO business_members (business_id, account_id, role)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [biz, id, a.roles.includes('BIZ_OWNER') ? 'OWNER' : 'STAFF']).catch(() => {});
      }
    }
  }

  const { rows: made } = await c.query(
    `SELECT a.email, a.name,
            coalesce((SELECT string_agg(r.role,'·' ORDER BY r.role)
                        FROM account_roles r WHERE r.account_id = a.id), '—') AS roles
       FROM accounts a WHERE a.email LIKE '%@t.local' ORDER BY a.email`);

  console.log(`  시험 계정 ${made.length}종 · 비밀번호 ${PW}`);
  for (const m of made) {
    const note = ACCOUNTS.find((x) => x.email === m.email)?.note ?? '';
    console.log(`    ${m.email.padEnd(20)} ${m.roles.padEnd(18)} ${note}`);
  }

  const { rows: conflict } = await c.query(`SELECT * FROM v_duty_conflict`);
  console.log(conflict.length
    ? `  ▲ 직무 겸임 ${conflict.length}건 — ${conflict.map((x) => x.email).join(', ')}`
    : '  ok  승인과 지급을 겸한 사람 없음');

  await c.end();
})().catch((e) => { console.error('★', e.message); process.exit(1); });
