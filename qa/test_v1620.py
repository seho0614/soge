"""v10.620 (docs/763) 배치 실행기가 이 판에 없는 작업을 「성공 · 0건」으로 적지 않음 — UNKNOWN_JOB 실패로
  ① (코드) scheduler.service.ts run() switch 에 default → throw UNKNOWN_JOB · tick 의 catch 가 ok=false 로 적음(그대로) ·
     마이그레이션의 job_schedules 작업 이름이 모두 switch case 에 있음(운영에서 새 실패가 생기지 않음) · 문서 763 · 판
  ② (DB 가 있을 때) 점검판 job_schedules 의 작업 이름이 모두 switch case 에 있음
  (읽기만 — 두 번 돌아도 통과)
"""
import glob, os, re, subprocess, sys

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


S = rd('src/worker/scheduler.service.ts')
i = S.find('async run(job: JobName)')
body = S[i:S.find('\n  }\n', i)] if i >= 0 else ''
ok('① run() — default 갈래가 UNKNOWN_JOB 을 던짐 · tick catch 가 ok=false', "default:" in body and "throw new Error(`UNKNOWN_JOB" in body
   and 'ok = false;' in S and 'UPDATE job_runs SET ended_at = now(), ok = $2' in S, str(len(body)))
cases = set(re.findall(r"case '([a-z0-9_]+)'", body))
sched = set()
for f in sorted(glob.glob(os.path.join(K, 'prisma', 'migrations', '*', 'migration.sql'))):
    t = open(f, encoding='utf-8').read()
    for m in re.finditer(r"INSERT\s+INTO\s+(?:public\.)?job_schedules\b(.*?);", t, re.S | re.I):
        sched |= set(re.findall(r"\(\s*'([a-z0-9_]+)'\s*,", m.group(1)))
miss = sorted(sched - cases)
ok('① 마이그레이션의 정기 작업 이름이 모두 switch 에 있음', len(sched) >= 100 and not miss, f'작업 {len(sched)} · case {len(cases)} · 빠짐 {miss[:6]}')
D = doc('763_')
ok('① 문서 763 — UNKNOWN_JOB · 되돌리기 · v10.620 이상', all(w in D for w in ('UNKNOWN_JOB', '되돌', 'v10.620')), str(len(D)))
VER = rd('VERSION').strip()
ok('① VERSION v10.620 이상', tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 620), VER)

if DB:
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', 'SELECT job FROM job_schedules ORDER BY 1'], capture_output=True, text=True)
    if r.returncode == 0:
        db_jobs = set(x for x in r.stdout.split() if x)
        m2 = sorted(db_jobs - cases)
        ok('② 점검판 job_schedules 작업 이름이 모두 switch 에 있음', db_jobs and not m2, f'{len(db_jobs)} · 빠짐 {m2[:6]}')
    else:
        print('  (DB 읽기 실패 — ② 건너뜀)')
else:
    print('  (DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
