"""v10.89 시험 — 멈춘 배치 점검(v_job_stale)이 요일 배치(at_dow)를 7일 주기로 봄(D113 · docs/143)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1089.py

  ① 마이그레이션 — 열 · 순서 그대로 · 바뀐 곳은 GROUP BY 의 at_dow 와 HAVING 의 주기뿐 · 지우는 문장 없음 · 마지막 마이그레이션
  ③ (DB 가 있으면) 거래 안에서 시험하고 되돌림 — 시험용 작업 3개(요일 4일 전 · 매일 4일 전 · 요일 22일 전 실행 기록)
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


M = rd('prisma/migrations/D113_job_stale_weekly/migration.sql')
B = rd('prisma/migrations/B080_views/migration.sql')
old = B[B.find('CREATE VIEW public.v_job_stale AS'):]; old = old[:old.find(';') + 1]
new = M[M.find('CREATE OR REPLACE VIEW public.v_job_stale AS'):]; new = new[:new.find(';') + 1]
head = lambda v: v[v.find(' SELECT'):v.find('  GROUP BY')]
ok('① 열 · 순서 · FROM · WHERE 가 B080 과 같음', old and new and head(old) == head(new), '')
ok('① GROUP BY 에 at_dow 만 더함', '  GROUP BY s.job, s.description, s.every_min, s.at_dow\n' in new, '')
ok('① 요일 배치는 10080분(7일) · 그 밖은 every_min · 3배', 'CASE WHEN s.at_dow IS NOT NULL THEN 10080 ELSE s.every_min END) * 3' in new, '')
ok('① 지우는 문장 없음 · job_schedules 그대로', not re.search(r'\b(DELETE|UPDATE|TRUNCATE|DROP|INSERT)\b', M), '')
ok('① 뷰 설명에 D113', "COMMENT ON VIEW public.v_job_stale IS" in M and 'D113' in M[M.find('COMMENT ON VIEW'):], '')
ok('① settlement_audit 는 요일 배치(at_dow 4)', re.search(r"\('settlement_audit', 1440, 10, 0, 4, true", rd('prisma/migrations/B900_reference_data/migration.sql')), '')
mig = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('① 마이그레이션 151 · 마지막 D113', (len(mig), mig[-1] if mig else '') == (151, 'D113_job_stale_weekly'), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① postcheck 는 뷰를 그대로 씀', 'from v_job_stale where not never_ran' in rd('deploy/aws/postcheck.sh'), '')

if DB:
    sql = """
BEGIN;
INSERT INTO job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('zz_t1089_weekly', 1440, 10, 0, 4, true, 't1089'), ('zz_t1089_daily', 1440, 3, 0, NULL, true, 't1089');
INSERT INTO job_runs (job, slot, started_at, ended_at, ok) VALUES
  ('zz_t1089_weekly', 'a', now() - interval '4 days', now() - interval '4 days', true),
  ('zz_t1089_daily',  'a', now() - interval '4 days', now() - interval '4 days', true);
SELECT 'A:' || coalesce(string_agg(job, ',' ORDER BY job), '') FROM v_job_stale WHERE job LIKE 'zz_t1089%';
INSERT INTO job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('zz_t1089_weekold', 1440, 10, 0, 4, true, 't1089');
INSERT INTO job_runs (job, slot, started_at, ended_at, ok) VALUES ('zz_t1089_weekold', 'a', now() - interval '22 days', now() - interval '22 days', true);
SELECT 'B:' || coalesce(string_agg(job, ',' ORDER BY job), '') FROM v_job_stale WHERE job LIKE 'zz_t1089%';
ROLLBACK;
"""
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    out = r.stdout.split('\n')
    a = next((l for l in out if l.startswith('A:')), None); b = next((l for l in out if l.startswith('B:')), None)
    ok('③ 4일 전 — 요일 배치는 정상 · 매일 배치는 멈춤', a == 'A:zz_t1089_daily', a or r.stderr.strip()[:200])
    ok('③ 22일 전 — 요일 배치도 멈춤', b == 'B:zz_t1089_daily,zz_t1089_weekold', b or r.stderr.strip()[:200])
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', "SELECT count(*) FROM job_schedules WHERE job LIKE 'zz_t1089%'"], capture_output=True, text=True)
    ok('③ 되돌림 — 시험 작업 남지 않음', r.stdout.strip() == '0', r.stdout.strip() or r.stderr.strip())

bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
