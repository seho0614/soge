"""v10.795 (docs/910) 의존 패키지 보안 — 운영 화면 vite 8.2.6 · source-map-js 1.2.2(overrides)
  KIT=<kit> python3 test_v1795.py
  ① (코드) package.json vite ^8.2.6 · overrides source-map-js 1.2.2 · 잠금 파일 vite 8.2.6 · source-map-js 1.2.2 만(1.2.1 없음) · 문서 910
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


PJ = json.loads(rd('web/package.json') or '{}')
LK = json.loads(rd('web/package-lock.json') or '{}').get('packages', {})
vite = LK.get('node_modules/vite', {}).get('version')
smj = sorted({v.get('version') for k, v in LK.items() if k.endswith('node_modules/source-map-js')})
ok('① vite ^8.2.6 · 잠금 8.2.6 · overrides source-map-js 1.2.2 · 잠금 source-map-js 1.2.2 만',
   PJ.get('devDependencies', {}).get('vite') == '^8.2.6' and vite == '8.2.6' and PJ.get('overrides', {}).get('source-map-js') == '1.2.2' and smj == ['1.2.2'], f'{vite} · {smj}')
ok('① 문서 910 · 판', 'vite 8.2.6' in doc('910_') and VT >= (10, 795), VER)
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
