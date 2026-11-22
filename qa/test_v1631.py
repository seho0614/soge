"""v10.631 (docs/775 · D307) 권한 COMPARE 「다름」 하루 요약 PERM_COMPARE_DIFF
  ① (코드) perm-compare-daily.ts · sec2_tick 한 단계 · fn_perm_compare_daily(p_now) · 문서 775 · 판
  ② (DB) 지난 날짜(2001-03-0x)로: ROLE → 건너뜀(-1) · COMPARE 08시 전 → 건너뜀 · 다름 3줄(주소 2곳) → WARN 1 · 같은 날 두 번째 → 건너뜀 ·
     다름 없는 날 → INFO 1 · perm.mode 는 원래 값으로 되돌림
  (시험 날짜의 perm_shadow_log · ops_alerts 줄만 지움 — 두 번 돌아도 통과)
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

PD = rd('src/modules/admin/perm-compare-daily.ts')
SJ = rd('src/modules/sec2/jobs.ts')
MIG = rd('prisma/migrations/D307_job_fail_streak_perm_compare_daily/migration.sql')

# ── ① 코드 ─────────────────────────────────────────────
ok('① perm-compare-daily.ts — fn_perm_compare_daily() 를 부름 · sec2_tick 한 단계(permCompare)',
   'SELECT fn_perm_compare_daily() AS n' in PD and "await step('permCompare', () => permCompareDaily(db));" in SJ
   and "import { permCompareDaily } from '../admin/perm-compare-daily';" in SJ)
ok('① D307 — fn_perm_compare_daily(p_now) · COMPARE 일 때만 · 08시 · 어제 · 하루 한 번 · WARN / INFO · 많은 주소 5',
   'CREATE OR REPLACE FUNCTION public.fn_perm_compare_daily(p_now timestamptz DEFAULT now())' in MIG and "<> 'COMPARE' THEN RETURN -1" in MIG
   and "time '08:00'" in MIG and "detail->>'day' = d::text" in MIG and "CASE WHEN total > 0 THEN 'WARN' ELSE 'INFO' END" in MIG and 'LIMIT 5' in MIG)
d775 = doc('775_')
ok('① 문서 775 — PERM_COMPARE_DIFF · 08시 · WARN · INFO · 판정 방식', all(w in d775 for w in ('PERM_COMPARE_DIFF', '08시', 'WARN', 'INFO', '판정 방식')), str(len(d775)))
ok('① VERSION v10.631 이상', VT >= (10, 631), VER)

# ── ② DB ─────────────────────────────────────────────
alive = bool(DB) and psql('SELECT 1') == '1'
if alive and psql("SELECT to_regprocedure('public.fn_perm_compare_daily(timestamptz)') IS NOT NULL") == 't':
    orig = psql("SELECT value FROM site_settings WHERE key = 'perm.mode'")
    DAYS = ('2001-03-01', '2001-03-02')

    def clean():
        # perm_shadow_log 은 트리거가 지우기를 막음 — 시험 날짜 줄만 replica 로
        psql("BEGIN; SET LOCAL session_replication_role = replica; "
             "DELETE FROM ops_alerts WHERE alert_code = 'PERM_COMPARE_DIFF' AND detail->>'day' IN ('2001-03-01', '2001-03-02'); "
             "DELETE FROM perm_shadow_log WHERE created_at >= '2001-03-01 00:00+09' AND created_at < '2001-03-03 00:00+09'; COMMIT;")

    def mode(m):
        return psql(f"UPDATE site_settings SET value = '{m}' WHERE key = 'perm.mode'")

    def run(now):
        return psql(f"SELECT fn_perm_compare_daily('{now}'::timestamptz)")

    def al(day):
        return psql(f"SELECT count(*) || '|' || coalesce(max(severity), '') || '|' || coalesce(max((detail->>'total')), '') || '|' || coalesce(max((detail->>'routes')), '') || '|' || coalesce(max(jsonb_array_length(detail->'top'))::text, '') FROM ops_alerts WHERE alert_code = 'PERM_COMPARE_DIFF' AND detail->>'day' = '{day}'")

    try:
        clean()
        ins = psql("INSERT INTO perm_shadow_log (method, pattern, task_keys, level, mode, diff, created_at) VALUES "
                   "('GET', '/admin/t1631/a', '{}', 'READ', 'COMPARE', 'ROLE_ONLY', '2001-03-01 10:00+09'), "
                   "('GET', '/admin/t1631/a', '{}', 'READ', 'COMPARE', 'ROLE_ONLY', '2001-03-01 11:00+09'), "
                   "('POST', '/admin/t1631/b', '{}', 'WRITE', 'COMPARE', 'GROUP_ONLY', '2001-03-01 23:30+09'), "
                   "('GET', '/admin/t1631/c', '{}', 'READ', 'COMPARE', NULL, '2001-03-01 12:00+09'), "
                   "('GET', '/admin/t1631/d', '{}', 'READ', 'COMPARE', 'ROLE_ONLY', '2001-03-02 00:30+09')")
        mode('ROLE')
        r_role = run('2001-03-02 09:00+09')
        mode('COMPARE')
        r_early = run('2001-03-02 07:59+09')
        r1 = run('2001-03-02 09:00+09'); a1 = al('2001-03-01')
        r2 = run('2001-03-02 10:00+09'); a2 = al('2001-03-01')
        ok('② ROLE → 건너뜀 · COMPARE 08시 전 → 건너뜀 · 어제 다름 3(주소 2곳 · 다른 날 · diff 없는 줄 뺌) → WARN 1 · 같은 날 두 번째 → 건너뜀',
           r_role == '-1' and r_early == '-1' and r1 == '3' and a1 == '1|WARN|3|2|2' and r2 == '-1' and a2 == a1,
           f'{ins[:40]} {r_role} {r_early} {r1} {a1} {r2}')
        r3 = run('2001-03-03 08:05+09'); a3 = al('2001-03-02')
        ok('② 그다음 날(다름 1 · 00:30 줄) → WARN · 다름 없는 날이면 INFO', r3 == '1' and a3.startswith('1|WARN|1|1|'), f'{r3} {a3}')
        psql("BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'PERM_COMPARE_DIFF' AND detail->>'day' = '2001-03-02'; "
             "DELETE FROM perm_shadow_log WHERE created_at >= '2001-03-02 00:00+09' AND created_at < '2001-03-03 00:00+09'; COMMIT;")
        r4 = run('2001-03-03 08:05+09'); a4 = al('2001-03-02')
        ok('② 다름 0 인 날 → INFO 1(GROUPS 조건 하루치)', r4 == '0' and a4.startswith('1|INFO|0|0|0'), f'{r4} {a4}')
    finally:
        mode(orig or 'ROLE')
        clean()
else:
    print('  (DB 없음 또는 D307 전 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
