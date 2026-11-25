"""v10.796 (docs/911) DB 복원 연습 정기화 — 전체 점검(qa/full_check.sh)에 ①-2 복원 리허설
  KIT=<kit> python3 test_v1796.py
  ① (코드) full_check.sh 에 restore-drill-rehearse.sh(새 킷 zip · -o 결과) · 줄인 점검 · RESTORE_REH=0 건너뜀 · 실패해도 계속 · 문법 · 문서 911
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


FC = open(os.path.join(HERE, 'full_check.sh'), encoding='utf-8').read() if os.path.exists(os.path.join(HERE, 'full_check.sh')) else ''
syn = subprocess.run(['bash', '-n', os.path.join(HERE, 'full_check.sh')], capture_output=True, text=True)
ok('① full_check ①-2 — 복원 리허설(새 킷 zip · 결과 파일) · ONLY 면 건너뜀 · RESTORE_REH=0 · 실패해도 계속(exit 없음) · 문법',
   'restore-drill-rehearse.sh" "$KZ" -o "$OUT/restore-drill.txt"' in FC and '[ -z "$ONLY" ] && [ "${RESTORE_REH:-1}" != 0 ]' in FC
   and 'RDRC=$?' in FC and FC.index('①-2 복원 리허설') < FC.index('say "② 기능 점검 rc') and syn.returncode == 0, syn.stderr[:100])
ok('① 도구 있음 · 문서 911(운영 30일 알림 · 개발 전체 점검마다) · 판', (os.path.exists(os.path.join(HERE, '..', 'tools', 'restore-drill-rehearse.sh')) or not os.path.isdir(os.path.join(HERE, '..', 'tools')))
   and 'RESTORE_DRILL_DUE' in doc('911_') and VT >= (10, 796), VER)
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
