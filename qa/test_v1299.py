"""v10.299 (docs/419) — 운영 절차서 도구 2단계: 마이그레이션 리허설(tools/mig-rehearsal.sh) · 초안 도구 검사 더함

  KIT=<kit> python3 -I test_v1299.py        (서버에서 — 회귀 실행기 HOST 목록 · 도커(sgb-dev-checks · postgres:16) 씀)

  ① (코드) mig-rehearsal.sh · 실행 권한 · 끝나면 지움(trap) · 포트 안 엶 · RDS 안 씀 · 초안 도구 --rehearsal · 지우는 문장 · NOTICE · 정기 작업 ·
     migrate.js NOTICE 출력 · apply.sh 가 NOTICE 줄을 보임 · README · docs/419 · 회귀 HOST · 판 v10.299
  ② (가짜 킷 · 도커 없음) 초안 — 함수 본문 DELETE 는 안 셈 · DO 블록 NOTICE 표(함수 안 NOTICE 뺌) · 새 정기 작업 「매일 04:40」 · 회귀 수 ·
     맨 위 DELETE · DROP COLUMN 은 ⚠ 지우는 문장
  ③ (가짜 킷 · 버리는 DB) 리허설 통과 — 적용 2 · NOTICE 가 화면에 · 두 번째 0 · 다시 돌림 2/2 · 숫자 차이 · 컨테이너 · 임시 폴더 지움 →
     초안 --rehearsal: [11] 같음 · 바뀜 · NOTICE 「나옴」 · 재실행 안전 · 리허설 줄
  ④ 리허설 실패(다시 돌리면 오류) → 종료 1 · result 실패 → 초안 ⛔ · 종료 2 / 다른 킷의 리허설 파일 → 멈춤 / 쓰는 법 · zip 밖 경로 → 종료 2
  가짜 킷 · 결과 파일은 임시 폴더에 만들고 지움(서비스 DB · API 안 씀 · 두 번 돌아도 같음).
"""
import os, re, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
TOOLS = os.path.normpath(os.path.join(HERE, '..', 'tools'))
DRAFT, REH = os.path.join(TOOLS, 'ops-doc-draft.py'), os.path.join(TOOLS, 'mig-rehearsal.sh')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd(os.path.join(K, 'VERSION')).strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D419 = next((rd(os.path.join(K, 'docs', x)) for x in docs if x.startswith('419_')), '')
SRC, SH = rd(DRAFT), rd(REH)
MIGJS, APPLY = rd(os.path.join(K, 'scripts', 'migrate.js')), rd(os.path.join(K, 'deploy', 'aws', 'apply.sh'))
README = rd(os.path.join(TOOLS, 'README.md'))
host = re.search(r'^HOST="([^"]*)"', rd(os.path.join(HERE, 'run_regression.sh')), re.M)

# ① 코드
ok('① mig-rehearsal.sh — 실행 권한 · trap 으로 컨테이너 · 네트워크 · 임시 폴더 지움 · postgres:16 · 자기 네트워크 · 포트 안 엶 · RDS · 운영 주소 없음 · zip 밖 경로 막음 · state_lines 를 새 킷 lib.sh 에서',
   bool(SH) and os.access(REH, os.X_OK) and 'trap cleanup EXIT INT TERM' in SH and 'docker rm -f "$DB"' in SH and 'docker network rm "$NET"' in SH
   and 'rm -rf -- "${TMP:?}"' in SH and 'postgres:16' in SH and '--network "$NET"' in SH and not re.search(r'docker run[^\n]*\s(-p|--publish)\s', SH)
   and not re.search(r'rds\.amazonaws|3\.37\.95\.217|sgb-db\b|15432|5432:', SH) and "grep -qE '(^/|(^|/)\\.\\.(/|$))'" in SH
   and 'deploy/aws/lib.sh' in SH and 'node scripts/migrate.js' in SH, REH)
ok('① 초안 도구 — --rehearsal · 지우는 문장(DO 블록 · 맨 위 · 함수 본문 뺌) · DO 블록 NOTICE · job_schedules · 회귀 수 · 리허설 실패면 ⛔ 종료 2 · 읽기만 그대로',
   "'--rehearsal'" in SRC and 'def sql_parts' in SRC and 'def sql_scan' in SRC and 'DELETE\\s+FROM' in SRC and 'RAISE\\s+NOTICE' in SRC
   and 'job_schedules' in SRC and '회귀' in SRC and '**리허설 실패**' in SRC and 'if reh_fail and not bad:' in SRC
   and not re.search(r'\b(import (socket|requests|urllib|http)|psycopg|subprocess|ssh |os\.remove|os\.unlink)\b', SRC)
   and SRC.count('shutil.rmtree(') == 1, '')
ok('① migrate.js NOTICE 출력 · apply.sh 3단계가 NOTICE 줄도 보임 · README 2줄 · docs/419 · 회귀 HOST test_v1299 · 판 v10.299 이상',
   "c.on('notice', (m) => { if (/ at RAISE\\b/.test(m.where ?? '')) console.log(`   NOTICE ${m.message}`); });" in MIGJS and "grep -E '^(ok|!!) |^   NOTICE '" in APPLY
   and '`mig-rehearsal.sh`' in README and 'docs/419' in README and bool(D419) and 'mig-rehearsal.sh' in D419 and '--rehearsal' in D419
   and bool(host) and 'test_v1299.py' in host.group(1).split()
   and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 299), VER)

tmp = tempfile.mkdtemp(prefix='v1299_')
LIB = '''#!/usr/bin/env bash
state_lines() {
  qn "select k || '=' || coalesce(v, '없음') from (values
    (1,  '표 t',               (select count(*)::text from t)),
    (2,  '마이그레이션 적용',   (select count(*)::text from schema_migrations))
  ) t(n, k, v) order by n"
}
'''


def kit(name, ver, migs, docs=None, fixture='INSERT INTO t VALUES (100) ON CONFLICT DO NOTHING;\n'):
    root = os.path.join(tmp, 'src', name)
    shutil.rmtree(root, ignore_errors=True)
    w = lambda rel, s: (os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True), open(os.path.join(root, rel), 'w', encoding='utf-8').write(s))
    w('KIT_COMMITS.txt', 'core aaa1111 infra bbb2222 adx ccc3333 made 1115-0000\n')
    w('sgb/VERSION', ver + '\n')
    w('sgb/deploy/aws/apply.sh', 'echo apply\n')
    w('sgb/deploy/aws/lib.sh', LIB)
    w('sgb/scripts/migrate.js', MIGJS)
    w('sgb/scripts/load-env.js', rd(os.path.join(K, 'scripts', 'load-env.js')))
    w('sgb/scripts/fixture.sql', fixture)
    for m, body in migs.items():
        w(f'sgb/prisma/migrations/{m}/migration.sql', body)
    for f, body in (docs or {}).items():
        w(f'sgb/docs/{f}', body)
    z = os.path.join(tmp, name + '.zip')
    with zipfile.ZipFile(z, 'w') as zf:
        for dp, _, fs in os.walk(root):
            for f in fs:
                p = os.path.join(dp, f)
                zf.write(p, os.path.join(name, os.path.relpath(p, root)))
    return z


def draft(*args):
    p = subprocess.run([sys.executable, '-I', DRAFT, *args], capture_output=True, text=True, timeout=120)
    return p.returncode, p.stdout, p.stderr


def rehearse(old, new, out):
    p = subprocess.run(['bash', REH, old, new, '-o', out], capture_output=True, text=True, timeout=600)
    return p.returncode, rd(out), p.stderr


def leftovers():
    ps = subprocess.run(['docker', 'ps', '-a', '--format', '{{.Names}}'], capture_output=True, text=True).stdout.split()
    nets = subprocess.run(['docker', 'network', 'ls', '--format', '{{.Name}}'], capture_output=True, text=True).stdout.split()
    tmps = [x for x in os.listdir(tempfile.gettempdir()) if x.startswith('migreh_')]
    return [x for x in ps + nets if x.startswith('sgb-mreh-')] + tmps


try:
    A = {'D001_t': 'CREATE TABLE IF NOT EXISTS t (id int PRIMARY KEY);\n',
         'D002_f': 'CREATE OR REPLACE FUNCTION f_purge() RETURNS void AS $$ DELETE FROM t WHERE id < 0; $$ LANGUAGE sql;\n'}
    D003 = ("-- D003 — DELETE FROM t 는 주석이라 안 셈\n"
            "DO $$ BEGIN\n  RAISE NOTICE 'D003 넣음 %', 1;\n  IF false THEN RAISE NOTICE 'D003 건너뜀 — ''그대로'''; END IF;\nEND $$;\n"
            "INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING;\n"
            "DROP TRIGGER IF EXISTS trg_x ON t;\n"
            "CREATE TABLE IF NOT EXISTS job_schedules (job text PRIMARY KEY, every_min int, at_hour int, at_minute int, at_dow int, is_active boolean, description text);\n"
            "INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)\n"
            "VALUES ('t_job', 1440, 4, 40, NULL, true, '시험 작업, 쉼표 있음') ON CONFLICT (job) DO NOTHING;\n")
    D004 = "CREATE OR REPLACE FUNCTION g() RETURNS void AS $fn$ BEGIN DELETE FROM t; RAISE NOTICE 'g 안'; END $fn$ LANGUAGE plpgsql;\n"
    DOC = {'600_가_v10.101-102_20261115.md': '# 600. 가\n\n## 1. 바뀐 것\n\n| 판 | 곳 | 내용 |\n|---|---|---|\n| v10.101 | 가 | ㄱ |\n\n## 4. 시험\n\n| 시험 | 내용 |\n|---|---|\n| 회귀 | 12개(11 + 1) |\n'}
    oA = kit('SGB_R_v10_100', 'v10.100', A)
    nB = kit('SGB_R_v10_102', 'v10.102', {**A, 'D003_n': D003, 'D004_fn': D004}, docs=DOC)

    # ② 초안만(도커 없음)
    rc, d, se = draft(oA, nB, '--doc', '901')
    ok('② 깨끗한 마이그레이션 — 종료 0 · 지우는 문장 없음(함수 본문 · 주석 DELETE 안 셈 · DROP TRIGGER 통과) · 재실행은 〔채울 것 · --rehearsal〕 · 새 정기 작업 매일 04:40 · 회귀 12개',
       rc == 0 and '. 지우는 문장 없음(기계 검사' in d and '⚠ **지우는 문장**' not in d and '〔채울 것: 재실행 안전 — tools/mig-rehearsal.sh 결과를 --rehearsal 로〕' in d
       and '새 정기 작업 `t_job`(매일 04:40 · D003)은 마이그레이션이 작업 표에 넣어' in d and '판 문서 기준 회귀 12개' in d
       and '지우는 문장 0 · NOTICE 2 · 새 정기 작업 1 · 리허설 없음' in se, f'rc {rc} · {se.strip()[-220:]}')
    ok('② NOTICE 표 — DO 블록 2줄(% → … · \'\' → \') · 함수 안 NOTICE(g 안) 뺌 · migrate.js 가 화면에 냄 · apply 줄 · 3-3 안내 · D004 는 NOTICE 없음',
       '### 마이그레이션 NOTICE' in d and '| `D003_n` | `D003 넣음 …` | (리허설 없음) |' in d and "| `D003_n` | `D003 건너뜀 — '그대로'` |" in d
       and 'g 안' not in d and 'apply 화면에 `NOTICE …` 줄로 나옵니다' in d and '→ `NOTICE …` 줄(1절 「마이그레이션 NOTICE」 표) → `적용 2 · 기존 2 · 변경감지 0`' in d
       and '- `NOTICE …` 줄이 나오면 1절 「마이그레이션 NOTICE」 표를 봅니다(오류 아님).' in d and 'D004 은 NOTICE 를 내지 않습니다.' in d, '')
    nC = kit('SGB_R_v10_103', 'v10.103', {**A, 'D003_d': 'DELETE FROM t WHERE id = 1;\nALTER TABLE t DROP COLUMN IF EXISTS z;\nDO $$ BEGIN TRUNCATE t; END $$;\n'})
    rc, d, se = draft(oA, nC)
    ok('② 맨 위 DELETE · DROP COLUMN · DO 블록 TRUNCATE → ⚠ 지우는 문장 + 〔채울 것〕 · 종료 0(멈추지는 않음)',
       rc == 0 and '⚠ **지우는 문장** — `D003_d`: `DELETE FROM t`, `DROP COLUMN z`, `TRUNCATE t`' in d
       and '〔채울 것: 왜 지우는지 · 되돌릴 수 있는지〕' in d and '지우는 문장 3' in se, se.strip()[-200:])

    # ③ 리허설(버리는 DB) 통과
    r1 = os.path.join(tmp, 'reh1.txt')
    rc, t, se = rehearse(oA, nB, r1)
    ok('③ 리허설 통과 — 종료 0 · 적용 2 · 기존 2 · NOTICE 가 화면에(D003 넣음 1) · 두 번째 적용 0 · 다시 돌림 2/2 · 숫자(표 t 1 → 2 · 마이그레이션 2 → 4) · result 통과',
       rc == 0 and 'old=v10.100' in t and 'new=v10.102' in t and 'new_kit=SGB_R_v10_102' in t and 'old_applied=2' in t
       and 'first=적용 2 · 기존 2 · 변경감지 0' in t and 'first_ok=D003_n,D004_fn' in t and 'first_notice=D003 넣음 1' in t
       and 'second=적용 0 · 기존 4 · 변경감지 0' in t and 'rerun=2/2' in t and 'state=표 t|1|2' in t and 'state=마이그레이션 적용|2|4' in t
       and t.rstrip().endswith('result=통과') and '통과' in se, f'rc {rc} · {se.strip()[-240:]}')
    ok('③ 끝나면 지움 — 버리는 DB 컨테이너 · 네트워크 · 임시 폴더(migreh_) 없음', not leftovers(), str(leftovers()))
    rc, d, se = draft(oA, nB, '--doc', '901', '--rehearsal', r1)
    ok('③ 초안 --rehearsal — [11] 같음 0 · 바뀜 2(표 t +1 · 마이그레이션 2 → 4) · NOTICE 「나옴」/「—」 · 재실행 안전 · 리허설 줄 · 리허설 통과 · 종료 0',
       rc == 0 and '[11] **같음 0개 · 바뀜 2개** — `표 t` +1 · `마이그레이션 적용 2 → 4`' in d and '| `D003_n` | `D003 넣음 …` | 나옴 |' in d
       and "`D003 건너뜀 — '그대로'` | — |" in d and '재실행 안전(버리는 DB 리허설 — 두 번째 「적용 0 · 기존 4 · 변경감지 0」 · SQL 2/2' in d
       and '**버리는 DB 리허설(' in d and '· 숫자 2개 중 바뀜 2**' in d and '리허설 통과' in se and '⛔' not in d, f'rc {rc} · {se.strip()[-200:]}')

    # ④ 실패 · 멈춤
    nD = kit('SGB_R_v10_104', 'v10.104', {**A, 'D003_bad': 'CREATE TABLE t2 (id int);\n'})
    r2 = os.path.join(tmp, 'reh2.txt')
    rc2, t2, se2 = rehearse(oA, nD, r2)
    rcd, d2, _ = draft(oA, nD, '--rehearsal', r2)
    rcx, _, sex = draft(oA, nC, '--rehearsal', r1)
    rcu = subprocess.run(['bash', REH, oA], capture_output=True, text=True).returncode
    bz = os.path.join(tmp, 'bad.zip')
    with zipfile.ZipFile(bz, 'w') as zf:
        zf.writestr('SGB_X/sgb/VERSION', 'v10.200\n'); zf.writestr('../evil.txt', 'x')
    rcb = subprocess.run(['bash', REH, oA, bz], capture_output=True, text=True).returncode
    ok('④ 다시 돌리면 오류 → 리허설 종료 1 · result 실패 · rerun 0/1 → 초안 ⛔ 리허설 실패 · 종료 2 / 다른 킷의 리허설 파일 → 멈춤 / 쓰는 법 · zip 밖 경로 → 종료 2 · 남은 컨테이너 없음',
       rc2 == 1 and 'rerun=0/1' in t2 and 'rerun_fail=D003_bad:' in t2 and 'result=실패 — 다시 돌리면 오류 1 개' in t2
       and rcd == 2 and '| ⛔ 멈출 것 | **리허설 실패** — 실패 — 다시 돌리면 오류 1 개' in d2 and '재실행 안전(' not in d2
       and rcx != 0 and '이 킷 두 개 것이 아님' in sex and rcu == 2 and rcb == 2 and not os.path.exists(os.path.join(tmp, 'evil.txt'))
       and not leftovers(), f'{rc2} · {rcd} · {rcx} · {rcu} · {rcb} · {se2.strip()[-120:]}')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
