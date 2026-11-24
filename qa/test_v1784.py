"""v10.784 (docs/893) 미리 검사 강화 — 시험 로그인 계정 대조 · 새 시험 점검판 먼저 · 회귀 잠금 연쇄 알림
  ① login_accounts_check.py — 시드에 없는 계정(super@x.com) 로그인을 잡음 · 시드 계정 · 시험이 스스로 만드는 계정은 통과 · main 과 같은 시험은 안 봄
  ② pre_check.sh ⑤ · ⑥ — 로그인 계정 단계 · 새 시험 목록 · BOARD_RUN=1 일 때만 점검판(13000) · bash 문법
  ③ reg_tally.py — 실패 3개 이상 UNAUTHENTICATED 면 잠금 연쇄 알림 · _times.tsv 순서 첫 시험 · 2개면 알림 없음
  ④ 문서 893 · 판
  (파일만 읽음 · 임시 폴더는 스스로 지움 — 두 번 돌아도 통과)
"""
import os, re, sys, subprocess, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def wr(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(s)


VER = rd(os.path.join(K, 'VERSION')).strip()
LG = 'log' + 'in'   # 가짜 시험 글자를 만들 때만 — 이 파일 자체가 ⑤ 검사에 걸리지 않게
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
LAC = os.path.join(HERE, 'login_accounts_check.py')
PC = rd(os.path.join(HERE, 'pre_check.sh'))

tmp = tempfile.mkdtemp(prefix='t1784_')
try:
    core, qa, mqa = (os.path.join(tmp, x) for x in ('core', 'qa', 'mqa'))
    wr(os.path.join(core, 'scripts/local-setup.sh'), "admin@x.com buyer@x.com seller@x.com\n")
    wr(os.path.join(core, 'scripts/seed-test-roles.js'), "'ops@t.local'\n")
    wr(os.path.join(core, 'scripts/other.sql'), "'notseed@x.com'\n")
    same = f"t = {LG}('nobody@x.com')\n"
    wr(os.path.join(mqa, 'test_v9000.py'), same)
    wr(os.path.join(qa, 'test_v9000.py'), same)   # main 과 같음 — 안 봄
    wr(os.path.join(qa, 'test_v9001.py'), f"a = {LG}('admin@x.com')\nb = {LG}('ops@t.local')\nconsent_ok.agree('buyer@x.com', PW)\n")
    wr(os.path.join(qa, 'test_v9002.py'), f"sql(\"INSERT INTO accounts(email) VALUES ('mine@x.com')\")\nt = {LG}('mine@x.com')\n")
    r = subprocess.run([sys.executable, LAC, core, qa, mqa], capture_output=True, text=True, timeout=60)
    ok('① 시드 계정 · 스스로 만드는 계정 · main 과 같은 시험 → 모름 0 · rc 0', r.returncode == 0 and '모르는 계정 0' in r.stdout and '새 시험 2개' in r.stdout, r.stdout[:200])
    wr(os.path.join(qa, 'test_v9003.py'), f"t = {LG}('super@x.com')\nconsent_ok." + "agree('notseed@x.com', PW)\n")
    r = subprocess.run([sys.executable, LAC, core, qa, mqa], capture_output=True, text=True, timeout=60)
    ok('① 시드에 없는 super@x.com · 시드 밖 파일에만 있는 주소 → 줄 번호와 함께 잡힘 · rc 1',
       r.returncode == 1 and 'test_v9003.py:1  super@x.com' in r.stdout and 'test_v9003.py:2  notseed@x.com' in r.stdout and '모르는 계정 2' in r.stdout, r.stdout[:300])
    ok('① 안내에 SUPER 시험 계정 admin@x.com', 'admin@x.com' in r.stdout, '')

    # ③ reg_tally 잠금 알림
    log = os.path.join(tmp, 'reg', 'regression.log')
    d = log + '.d'
    names = ['test_v8001.py', 'test_v8002.py', 'test_v8003.py', 'test_v8004.py']
    wr(log, ''.join(f'{n} | 결과: 1 / 3\n' for n in names) + 'test_v8005.py | 결과: 2 / 2\n')
    wr(os.path.join(d, '_times.tsv'), 'test_v8005.py\tbox\t1\ntest_v8003.py\tbox\t1\ntest_v8001.py\tbox\t1\ntest_v8002.py\tbox\t1\ntest_v8004.py\tbox\t1\n')
    for n in names[:3]:
        wr(os.path.join(d, n + '.log'), 'FAIL x — 401 {"code":"UNAUTHENTICATED"}\n')
    wr(os.path.join(d, 'test_v8004.py.log'), 'FAIL y — 다른 까닭\n')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'reg_tally.py'), log], capture_output=True, text=True, timeout=60)
    ok('③ 실패 4개 중 3개 UNAUTHENTICATED → 잠금 연쇄 알림 · _times.tsv 순서 첫 시험 test_v8003 · 끝 코드 1',
       r.returncode == 1 and '로그인 잠금 연쇄 의심' in r.stdout and '가장 먼저 실패한 것: test_v8003.py' in r.stdout and '4개 중 3개' in r.stdout.replace('실패 4개 중 3개', '4개 중 3개'), r.stdout[-260:])
    wr(os.path.join(d, 'test_v8003.py.log'), 'FAIL z\n')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'reg_tally.py'), log], capture_output=True, text=True, timeout=60)
    ok('③ UNAUTHENTICATED 2개면 알림 없음', '잠금 연쇄' not in r.stdout and r.returncode == 1, r.stdout[-120:])
finally:
    shutil.rmtree(tmp, ignore_errors=True)

s5 = PC[PC.find('== ⑤'):]
NB = rd(os.path.join(HERE, 'new_tests_on_board.sh'))
ok('② pre_check.sh ⑤ 로그인 계정 단계(login_accounts_check.py · main qa 와 견줌)', 'login_accounts_check.py" "$C" "$I/qa" "$MAIN_QA"' in s5, str(len(s5)))
ok('② ⑥ 새 시험 목록 · 점검판 실행은 new_tests_on_board.sh 로 안내 · pre_check 는 점검판 주소를 쓰지 않음',
   '[ -f "$MAIN_QA/$f" ] || echo' in s5 and 'qa/new_tests_on_board.sh' in s5 and not re.search(r'13000|15432', PC), '')
ok('② new_tests_on_board.sh — 점검판 health 먼저 · 새 시험만 · 점검판 주소만(확인판 3000 · 5174 · RDS 없음) · 통과 아님 수로 끝 코드',
   'curl -sf "$API/health"' in NB and '[ -f "$MAIN_QA/$f" ] || echo' in NB and 'localhost:15432' in NB
   and not re.search(r':3000\b|:5174\b|rds\.amazonaws', NB) and '[ $BAD = 0 ]' in NB and os.access(os.path.join(HERE, 'new_tests_on_board.sh'), os.X_OK), '')
sr = subprocess.run(['bash', '-n', os.path.join(HERE, 'pre_check.sh')], capture_output=True, text=True)
ok('② pre_check.sh bash 문법', sr.returncode == 0, sr.stderr[:100])

d = os.path.join(K, 'docs')
d893 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('893_')), '')
ok('④ 문서 893 — 로그인 계정 · 점검판 · 잠금 연쇄', all(w in d893 for w in ('로그인 계정', '점검판', '잠금 연쇄', 'super@x.com')), str(len(d893)))
ok('④ VERSION v10.784 이상', VT >= (10, 784), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
