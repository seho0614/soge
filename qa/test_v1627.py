"""v10.627 (docs/771 · D307) 정기 작업 연속 실패 알림 JOB_FAILING
  ① (코드) job-fail-watch.ts · tick() 이 기록 뒤 부름(catch) · D307 설정 ops.job_fail_streak(처음 3 · 0 · 2 ~ 10) · fn_job_fail_watch · 문서 771 · 판
  ② (DB) 시험 작업 이름(zz_t1627_<시각>)으로 끝난 실패 줄 2개 → 알림 없음 · 3개 → CRITICAL 1 · 4번째 실패도 1 · 성공 → 풀림
     · UNKNOWN_JOB 실패 3개 → WARN · 설정 0 이면 알림 없음(설정은 원래 값으로 되돌림)
  (시험 작업 이름의 job_runs · ops_alerts 줄만 지움 — 두 번 돌아도 통과)
"""
import json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
DB = os.environ.get('DB') or ''
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
JW = rd('src/worker/job-fail-watch.ts')
SC = rd('src/worker/scheduler.service.ts')
MIG = rd('prisma/migrations/D307_job_fail_streak_perm_compare_daily/migration.sql')

# ── ① 코드 ─────────────────────────────────────────────
ok('① job-fail-watch.ts — fn_job_fail_watch($1, $2) 를 부름',
   'export async function jobFailWatch' in JW and 'SELECT fn_job_fail_watch($1, $2)' in JW, str(len(JW)))
ok('① tick() — job_runs 기록 바로 뒤 jobFailWatch(this.db, d.job, ok) · 실패해도 catch',
   bool(re.search(r"UPDATE job_runs SET ended_at = now\(\), ok = \$2[^;]*;\s*\n\s*/\*[^\n]*\*/\s*\n\s*await jobFailWatch\(this\.db, d\.job, ok\)\.catch\(", SC))
   and "import { jobFailWatch } from './job-fail-watch';" in SC)
ok('① D307 — ops.job_fail_streak 처음 3 · 값 모양 0 · 2 ~ 10 · ON CONFLICT DO NOTHING · fn_job_fail_watch · UNKNOWN_JOB WARN · 지우는 문장 없음(설명서 한도 검사 바꾸기 DROP CONSTRAINT 하나만 · v10.634)',
   "('ops.job_fail_streak', '3', 'ADMIN'" in MIG and "'^(0|[2-9]|10)$'" in MIG and 'ON CONFLICT (key) DO NOTHING' in MIG
   and 'CREATE OR REPLACE FUNCTION public.fn_job_fail_watch(p_job text, p_ok boolean)' in MIG and "LIKE 'UNKNOWN_JOB%'" in MIG
   and not re.search(r'\bDELETE\s+FROM\b', MIG, re.I) and re.findall(r'\bDROP\s+\w+(?:\s+\w+)?', MIG, re.I) == ['DROP CONSTRAINT help_docs_body_len'] and '/*' not in MIG)
d771 = doc('771_')
ok('① 문서 771 — JOB_FAILING · ops.job_fail_streak · CRITICAL · WARN', all(w in d771 for w in ('JOB_FAILING', 'ops.job_fail_streak', 'CRITICAL', 'WARN')), str(len(d771)))
ok('① VERSION v10.627 이상', VT >= (10, 627), VER)

# ── ② DB ─────────────────────────────────────────────
alive = bool(DB) and psql('SELECT 1') == '1'
if alive and psql("SELECT to_regprocedure('public.fn_job_fail_watch(text, boolean)') IS NOT NULL") == 't':
    stamp = int(time.time() * 1000) % 100000000
    J, U = f'zz_t1627_{stamp}', f'zz_t1627u_{stamp}'
    orig = psql("SELECT value FROM site_settings WHERE key = 'ops.job_fail_streak'")

    def clean():
        # job_runs 는 트리거가 지우기를 막음 — 시험 이름 줄만 replica 로
        psql("BEGIN; SET LOCAL session_replication_role = replica; "
             "DELETE FROM ops_alerts WHERE alert_code = 'JOB_FAILING' AND detail->>'job' LIKE 'zz_t1627%'; "
             "DELETE FROM job_runs WHERE job LIKE 'zz_t1627%'; COMMIT;")

    def run(job, ok_, detail, i):
        # 시각을 다르게(앞선 차례가 먼저) · 끝난 줄만 셈
        return psql(f"INSERT INTO job_runs (job, slot, started_at, ended_at, ok, affected, detail) "
                    f"VALUES ('{job}', now() - interval '{100 - i} minutes', now() - interval '{100 - i} minutes', now() - interval '{99 - i} minutes', {ok_}, 0, '{detail}')")

    def w(job, ok_):
        return psql(f"SELECT fn_job_fail_watch('{job}', {ok_})")

    def alerts(job):
        return psql(f"SELECT count(*) FILTER (WHERE resolved_at IS NULL) || '|' || count(*) || '|' || coalesce(max(severity), '') FROM ops_alerts WHERE alert_code = 'JOB_FAILING' AND detail->>'job' = '{job}'")

    try:
        clean()
        s3 = psql("UPDATE site_settings SET value = '3' WHERE key = 'ops.job_fail_streak'")
        r1 = run(J, 'false', '시험 실패 1', 1); r2 = run(J, 'false', '시험 실패 2', 2)
        a2 = (w(J, 'false'), alerts(J))
        run(J, 'false', '시험 실패 3', 3)
        a3 = (w(J, 'false'), alerts(J))
        run(J, 'false', '시험 실패 4', 4)
        a4 = (w(J, 'false'), alerts(J))
        run(J, 'true', '{}', 5)
        a5 = (w(J, 'true'), alerts(J))
        ok('② 실패 2 → 없음 · 3 → CRITICAL 1 · 4번째도 1 · 성공 → 풀림',
           a2 == ('0', '0|0|') and a3 == ('1', '1|1|CRITICAL') and a4 == ('0', '1|1|CRITICAL') and a5 == ('-1', '0|1|CRITICAL'),
           f'{r1} {r2} {a2} {a3} {a4} {a5}')
        for i in range(3):
            run(U, 'false', 'UNKNOWN_JOB zz — 이 판에는 없는 작업입니다', 10 + i)
        au = (w(U, 'false'), alerts(U))
        ok('② UNKNOWN_JOB 3번 → WARN(깨우지 않음)', au == ('1', '1|1|WARN'), str(au))
        clean()
        psql("UPDATE site_settings SET value = '0' WHERE key = 'ops.job_fail_streak'")
        for i in range(3):
            run(J, 'false', '시험 실패', 20 + i)
        a0 = (w(J, 'false'), alerts(J))
        ok('② 설정 0 → 알림 없음(끔)', a0 == ('0', '0|0|'), str(a0))
    finally:
        psql(f"UPDATE site_settings SET value = '{orig or '3'}' WHERE key = 'ops.job_fail_streak'")
        clean()
else:
    print('  (DB 없음 또는 D307 전 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
