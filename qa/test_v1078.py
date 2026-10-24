"""v10.78 시험 — 감사 징후 「운영자 몰아치기」에서 사람 없는 기록 제외(D109 · docs/132)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1078.py

  ① 마이그레이션 — 몰아치기 뷰에 actor_account_id IS NOT NULL · 열 그대로 · D004(밤)와 같은 조건 · 마지막 마이그레이션
  ③ (DB 가 있으면) 거래 안에서 시험하고 되돌림 — SYSTEM 기록 60건 → 징후 0 · 운영 계정 기록 60건 → 징후 1
"""
import glob, os, re, subprocess

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D109_audit_burst_actor/migration.sql')
B = rd('prisma/migrations/B080_views/migration.sql')
old = B[B.find('CREATE VIEW public.v_audit_admin_burst AS'):]; old = old[:old.find(';') + 1]
new = M[M.find('CREATE OR REPLACE VIEW public.v_audit_admin_burst AS'):]; new = new[:new.find(';') + 1]
cols = lambda v: re.findall(r'(?:AS (\w+)|l\.(actor_account_id|actor_role)|a\.(name))\s*,?\s*\n', v[:v.find('FROM (audit')])
ok('① D109 — 몰아치기 뷰에 「사람 기록만」', 'AND l.actor_account_id IS NOT NULL' in new, '')
ok('① 열 · 순서 그대로(CREATE OR REPLACE 가 받아들임)', old and new and old[old.find(' SELECT l.actor_account_id'):old.find('FROM (audit')] == new[new.find(' SELECT l.actor_account_id'):new.find('FROM (audit')], '')
ok('① 나머지 조건 그대로 — 시험용(TEST) 제외 · 창 · 문턱', "(l.action !~~ '%TEST%'::text)" in new and "audit_thresholds.code = 'ADMIN_BURST'::text" in new and 'HAVING (count(*) >' in new, '')
ok('① D004(밤)와 같은 조건', 'l.actor_account_id IS NOT NULL' in rd('prisma/migrations/D004_audit_night_actor/migration.sql'), '')
ok('① 자료를 지우지 않음', not re.search(r'\b(DELETE|TRUNCATE|DROP TABLE)\b', M), '')
last = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('① 마이그레이션 147개 · 마지막 D109(v10.80 부터 D110 · 148 — test_v1080)', (len(last), last[-1] if last else '') in ((147, 'D109_audit_burst_actor'), (148, 'D110_comment_report'), (149, 'D111_search_synonym_expand'), (150, 'D112_search_synonym_seed'), (151, 'D113_job_stale_weekly'), (152, 'D114_seed_ad_ends_extend'), (153, 'D115_i18n_base'), (154, 'D116_agent_base')), f'{len(last)} · {last[-1] if last else ""}')

if DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    A = psql("SELECT id FROM accounts a WHERE EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role IN ('ADMIN','SUPER')) ORDER BY created_at LIMIT 1")[1]
    # 창 안의 기존 기록에 기대지 않게 — 문턱을 거래 안에서만 기존 최대치 + 50 으로 올린 뒤 60건을 넣어 봄
    base = ("BEGIN; UPDATE audit_thresholds SET threshold = 50 + coalesce((SELECT max(c) FROM (SELECT count(*) c FROM audit.audit_logs "
            "WHERE occurred_at > now() - interval '24 hours' GROUP BY actor_account_id, actor_role) x), 0) WHERE code = 'ADMIN_BURST'; ")
    look = "SELECT count(*) FROM v_audit_admin_burst WHERE actor_account_id IS NULL; SELECT count(*) FROM v_audit_admin_burst WHERE actor_account_id = '%s'; " % A
    sys_rows = ("INSERT INTO audit.audit_logs (actor_role, action, target_type) SELECT 'SYSTEM', 'REVIEW_AUTO_APPROVED', 'LISTING' "
                "FROM generate_series(1, 60 + (SELECT threshold FROM audit_thresholds WHERE code = 'ADMIN_BURST')); ")
    hum_rows = ("INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type) SELECT '%s', 'ADMIN', 'POST_HIDE', 'POST' "
                "FROM generate_series(1, 60 + (SELECT threshold FROM audit_thresholds WHERE code = 'ADMIN_BURST')); ") % A
    rc, out, err = psql(base + sys_rows + look + hum_rows + look + "ROLLBACK;")
    L = out.split('\n')
    ok('③ 자동 기록(SYSTEM) 문턱 넘게 → 몰아치기 징후 0', rc == 0 and A and len(L) >= 2 and L[0] == '0', (out or err)[:160])
    ok('③ 운영 계정 기록 문턱 넘게 → 징후 1(사람은 그대로 잡힘)', rc == 0 and len(L) >= 4 and L[3] == '1', (out or err)[:160])
else:
    print('     (DB 없음 — ③ 건너뜀 · DB=postgresql://sgb:sgb@localhost:15432/sgb 로 점검판에서)')

ok('VERSION v10.78 이상', re.match(r'v10\.(7[8-9]|[89]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
