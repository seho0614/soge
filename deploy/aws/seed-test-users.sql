-- =====================================================================
-- 운영 서버 시험 계정 6개 (v10.36 · 2026-10-12) — 오픈 전 시험 단계에서만 씁니다.
--
--   bash ~/sgb/deploy/aws/psql.sh -v pw='비밀번호' -f ~/sgb/deploy/aws/seed-test-users.sql
--
--   · 비밀번호는 실행할 때 정합니다(-v pw=…). 6개 모두 같은 비밀번호입니다. 작은따옴표(')는 넣지 마십시오.
--   · 다시 돌려도 됩니다 — 이미 있는 계정은 비밀번호를 새 값으로 바꾸고 정지(SUSPENDED)를 풉니다.
--   · 개발용 seed-test-roles.js 와 같은 이메일 · 역할입니다(@t.local). 대표님 SUPER 계정은 만들지 않습니다(직접 가입 → 권한 부여).
--   · 오픈 직전에는 정지합니다(오픈 직전 체크리스트):
--       bash ~/sgb/deploy/aws/psql.sh -c "UPDATE accounts SET status = 'SUSPENDED' WHERE email LIKE '%@t.local';"
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;
WITH t(email, name, roles) AS (VALUES
  ('member@t.local',   '시험 일반회원',   '{MEMBER}'::text[]),
  ('bizowner@t.local', '시험 사업자대표', '{MEMBER,BIZ_OWNER}'),
  ('bizstaff@t.local', '시험 사업자직원', '{MEMBER,BIZ_STAFF}'),
  ('reviewer@t.local', '시험 검수자',     '{REVIEWER}'),
  ('ops@t.local',      '시험 운영',       '{ADMIN}'),
  ('payout@t.local',   '시험 지급전담',   '{PAYOUT}')
), ins AS (
  INSERT INTO accounts (email, password_hash, name, account_type, status, identity_verified_at)
  SELECT email, crypt(:'pw', gen_salt('bf', 12)), name, 'PERSONAL', 'ACTIVE', now() FROM t
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'
  RETURNING id, email
)
INSERT INTO account_roles (account_id, role, granted_by)
SELECT ins.id, r, (SELECT account_id FROM account_roles WHERE role = 'SUPER' LIMIT 1)
  FROM ins JOIN t USING (email), unnest(t.roles) AS r
ON CONFLICT DO NOTHING;
COMMIT;
SELECT a.email, a.status, string_agg(r.role, '·' ORDER BY r.role) AS roles
  FROM accounts a LEFT JOIN account_roles r ON r.account_id = a.id
 WHERE a.email LIKE '%@t.local' GROUP BY a.email, a.status ORDER BY a.email;
