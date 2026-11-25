"""v10.798 (docs/913) 회귀 4차 — 실패한 시험만 끝에 혼자 한 번 더 · 다시 통과는 「일시 실패」로 따로
  KIT=<kit> python3 test_v1798.py
  ① (코드) run_regression 다시 돌림 단계(ONLY · RETRY_FAILS=0 · 6개 넘으면 안 함 · 혼자) · full_check summary · 문법
  ② (집계) reg_tally --retry-ok — 다시 통과는 실패에서 빠지고 이름이 보임 · 남은 실패는 끝 코드 1 · 「다시 」 줄은 시험 수에 안 셈 · 문서 913
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


import tempfile
RR = open(os.path.join(HERE, 'run_regression.sh'), encoding='utf-8').read()
FC = open(os.path.join(HERE, 'full_check.sh'), encoding='utf-8').read()
syn = subprocess.run(['bash', '-n', os.path.join(HERE, 'run_regression.sh')], capture_output=True, text=True)
ok('① 다시 돌림 — ONLY 아님 · RETRY_FAILS · RETRY_MAX 6 · HOST 는 서버에서 · retry.log · _retry_ok · 집계에 넘김 · summary · 문법',
   '[ -z "$ONLY_FILES" ] && [ "${RETRY_FAILS:-1}" != 0 ]' in RR and '"${RETRY_MAX:-6}"' in RR and '.retry.log' in RR and '--retry-ok "$RETRY_OK"' in RR
   and '일시 실패' in FC and syn.returncode == 0, syn.stderr[:100])
d = tempfile.mkdtemp(prefix='t1798-')
open(os.path.join(d, 'r.log'), 'w', encoding='utf-8').write('test_a.py | 결과: 3 / 4\ntest_b.py | 결과: 5 / 5\ntest_c.py | 결과: 1 / 2\n다시 test_a.py | 결과: 4 / 4\n다시 test_c.py | 결과: 1 / 2\n')
open(os.path.join(d, 'ok.txt'), 'w').write('test_a.py\n')
r = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'reg_tally.py'), os.path.join(d, 'r.log'), '--expect', '3', '--retry-ok', os.path.join(d, 'ok.txt')], capture_output=True, text=True)
open(os.path.join(d, 'ok.txt'), 'w').write('test_a.py\ntest_c.py\n')
r2 = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'reg_tally.py'), os.path.join(d, 'r.log'), '--retry-ok', os.path.join(d, 'ok.txt')], capture_output=True, text=True)
r3 = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'reg_tally.py'), os.path.join(d, 'r.log')], capture_output=True, text=True)
ok('② 집계 — 다시 통과 a 는 「일시 실패」 · c 는 실패 · 끝 코드 1 · 둘 다 다시 통과면 0 · 옛 방식(--retry-ok 없음)은 실패 2 · 시험 수 3 · 문서 913',
   r.returncode == 1 and '일시 실패(혼자 다시 돌려 통과)  test_a.py' in r.stdout and '실패  test_c.py' in r.stdout and '시험 3개 (기대 3)' in r.stdout
   and r2.returncode == 0 and '실패 0 · 일시 실패(다시 통과) 2' in r2.stdout and r3.returncode == 1 and '실패 2' in r3.stdout
   and 'SOLO' in doc('913_') and VT >= (10, 798), f'{r.returncode}/{r2.returncode}/{r3.returncode} · {VER}')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
