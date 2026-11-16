"""v10.321 (docs/448) 공지 화면 한 곳 — 고객센터 › 공지사항 → 소개광장 › 공지
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1321.py
  ① (코드) /support/notices 는 redirect('/community?board=NOTICE') · 고객센터 첫 화면 「공지사항」 링크 소개광장 · 화면 목록 메모 · 문서 448 · 판 v10.321
  ② (사용자 웹) /support/notices 를 열면 /community?board=NOTICE 로 가고 운영 공지 칸이 보임
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
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

SN, SNW = rd('site/src/app/support/notices/page.tsx'), rd('site/src/app/support/new/page.tsx')
SC = rd('spec/screens.json')
ok('① 코드 — 고객센터 › 공지사항은 소개광장 › 공지로 넘김 · 고객센터 첫 화면 링크 · 화면 목록 메모 · 문서 448 · 판 v10.321',
   "redirect('/community?board=NOTICE')" in SN and 'apiGetPersonal' not in SN and '<Link href="/community?board=NOTICE" data-support-notices-link>' in SNW
   and 'v10.321 (docs/448) 소개광장 › 공지(/community?board=NOTICE)로 넘김' in SC and '소개광장' in doc('448_') and VT >= (10, 321), VER)
if SITE:
    fin, html = '', ''
    for _ in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(SITE + '/support/notices', headers={'Accept-Language': 'ko'}), timeout=120)
            fin, html = r.geturl(), r.read().decode('utf-8', 'replace'); break
        except Exception as e:
            fin = f'!{e}'; time.sleep(3)
    ok('② 사용자 웹 — /support/notices → /community?board=NOTICE · 운영 공지 칸(data-plaza-notices)',
       fin.endswith('/community?board=NOTICE') and 'data-plaza-notices=' in html, fin)
else:
    print('  (SITE 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
