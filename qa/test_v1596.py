"""v10.596 (docs/738) ⑫ API 바뀐 점 자동 기록 — scripts/api-diff.js(openapi 두 판 비교 · 마크다운 · JSON)
  ① (코드) 더함 · 없어짐 · 바뀜 · 주의 · 화면 · json · 바깥 호출 · 새 패키지 없음 · 문서 738 · 판
  ② (node) 작은 두 판 → 더함 1 · 없어짐 1 · 바뀜 2 · 주의 4 · 없는 파일 종료 2
  (데이터를 남기지 않음 — 임시 폴더)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

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

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


"""시험 몸통 — 15차 보안 · 기반 공통 도우미"""
def migs_all():
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return ''
    return '\n'.join(open(os.path.join(d, x, 'migration.sql'), encoding='utf-8').read() for x in sorted(os.listdir(d)) if os.path.exists(os.path.join(d, x, 'migration.sql')))


MIG = migs_all()
SJ = rd('spec/screens.json')
STAMP = int(time.time()) % 1000000


def sec2_set(tok, body, tag):
    """설정은 API 로(서버 30초 메모리를 그 자리에서 지움)"""
    return call('PUT', '/admin/sec2/settings', {**body, 'reason': f'시험 {tag}'}, tok)


def mk_member(tag):
    em, aid = mk_staff(tag, None)
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'MEMBER') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid


def rm_accounts(like):
    """시험 계정과 딸린 보안 줄을 지움(replica — 쌓기만 표 · 외래 키 트리거를 건너뜀)"""
    ids = f"(SELECT id FROM accounts WHERE email LIKE '{like}')"
    return psql("SET session_replication_role = replica; "
                f"DELETE FROM sec2_login_alerts WHERE account_id IN {ids}; DELETE FROM sec2_mfa_tickets WHERE account_id IN {ids}; "
                f"DELETE FROM sec2_staff_anomalies WHERE account_id IN {ids}; DELETE FROM account_mfa WHERE account_id IN {ids}; "
                f"DELETE FROM login_sessions WHERE account_id IN {ids}; DELETE FROM login_history WHERE account_id IN {ids}; "
                f"DELETE FROM notifications WHERE account_id IN {ids}; DELETE FROM term_agreements WHERE account_id IN {ids}; "
                f"DELETE FROM account_roles WHERE account_id IN {ids}; DELETE FROM accounts WHERE email LIKE '{like}';")


AD = rd('scripts/api-diff.js')
ok('① 도구 — scripts/api-diff.js · 더함 · 없어짐 · 바뀜 · 주의 · 화면(--screens) · json · 바깥 호출 · 새 패키지 없음 · 문서 738 · 판 v10.596',
   bool(AD) and '## 주의' in AD and '--screens' in AD and '--json' in AD and "require('fs')" in AD and not re.search(r"require\('(?!fs')", AD)
   and 'fetch(' not in AD and 'http' not in AD.split('*/', 1)[1] and 'api-diff.js' in doc('738_') and VT >= (10, 596), VER)
import shutil, tempfile
NODE = shutil.which('node')
if NODE and AD:
    tmp = tempfile.mkdtemp(prefix='apidiff1596_')
    A_ = {'paths': {'/api/v1/x': {'get': {'summary': 'x', 'parameters': [{'in': 'query', 'name': 'q', 'required': False}],
                                          'responses': {'200': {'content': {'application/json': {'schema': {'$ref': '#/components/schemas/X'}}}}}}},
                    '/api/v1/old': {'post': {'summary': 'old', 'responses': {'200': {}}}},
                    '/api/v1/y': {'post': {'summary': 'y', 'requestBody': {'content': {'application/json': {'schema': {'$ref': '#/components/schemas/Y'}}}}, 'responses': {'200': {}, '422': {}}}}},
          'components': {'schemas': {'X': {'properties': {'a': {}, 'b': {}}}, 'Y': {'properties': {'n': {}}}}}}
    B_ = json.loads(json.dumps(A_))
    B_['paths']['/api/v1/x']['get']['parameters'][0]['required'] = True
    del B_['paths']['/api/v1/old']
    B_['paths']['/api/v1/new'] = {'get': {'summary': 'new', 'responses': {'200': {}}}}
    B_['paths']['/api/v1/y']['post']['responses'] = {'200': {}, '409': {}}
    B_['components']['schemas']['X'] = {'properties': {'a': {}}}
    B_['components']['schemas']['Y'] = {'properties': {'n': {}, 'm': {}}, 'required': ['m']}
    json.dump(A_, open(os.path.join(tmp, 'a.json'), 'w')); json.dump(B_, open(os.path.join(tmp, 'b.json'), 'w'))
    r = subprocess.run([NODE, os.path.join(K, 'scripts', 'api-diff.js'), 'a.json', 'b.json', '--out', 'o.md', '--json', 'o.json', '--title', '시험1596'],
                       cwd=tmp, capture_output=True, text=True, timeout=60)
    j = json.load(open(os.path.join(tmp, 'o.json'))) if os.path.exists(os.path.join(tmp, 'o.json')) else {}
    md = open(os.path.join(tmp, 'o.md'), encoding='utf-8').read() if os.path.exists(os.path.join(tmp, 'o.md')) else ''
    bad = subprocess.run([NODE, os.path.join(K, 'scripts', 'api-diff.js'), 'a.json', 'none.json'], cwd=tmp, capture_output=True, text=True, timeout=60)
    ok('② 두 판 비교 — 더함 1 · 없어짐 1 · 바뀜 2 · 주의 4(없어짐 · 필수 매개변수 · 없어진 응답 칸 · 필수 요청 칸) · 마크다운 · 없는 파일 종료 2',
       r.returncode == 0 and j.get('added') == ['GET /api/v1/new'] and j.get('removed') == ['POST /api/v1/old'] and len(j.get('changed') or []) == 2
       and len(j.get('warn') or []) == 4 and '## 주의' in md and '`GET /new`' in md and bad.returncode == 2, (r.stdout + r.stderr)[-200:] + f" {j.get('warn')}")
    shutil.rmtree(tmp, ignore_errors=True)
else:
    print('  (node 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
