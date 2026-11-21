"""v10.570 (docs/712) 10차 운영 기반 ② 운영 반영 전 화면 비교 자동 — qa/screen_diff.py(개발 점검판 · 운영 서버 아님)
  ① (코드) 도구 · 화면 20곳(운영 12 · 사용자 웹 8) · 결과 html 모양(차이 큰 순 · 칠함 · 처음 · 오류 · 어두운 화면) · Pillow 가 있으면 차이 % 셈 · 문서 712 · 판
  ② (점검판) 화면 두 곳을 두 번 찍어 두 번째가 앞 결과와 차이 %(숫자)를 냄 · 그림 · html · result.json
  (두 번 돌아도 통과 — 결과는 임시 폴더에 두고 지움 · DB · 설정을 바꾸지 않음)
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


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''

"""시험 몸통"""
SD_PATH = os.path.join(HERE, 'screen_diff.py')
SD = open(SD_PATH, encoding='utf-8').read() if os.path.exists(SD_PATH) else ''
import importlib, tempfile
sys.path.insert(0, HERE)
try:
    SDM = importlib.import_module('screen_diff')
except Exception as ex:
    SDM = None; print('  가져오기 실패', ex)
pages = getattr(SDM, 'PAGES', [])
ids = [p[0] for p in pages]
ok('① 코드 — 화면 비교 도구 qa/screen_diff.py · 주요 화면 20곳(운영 12 · 사용자 웹 8 · id 겹침 없음) · 점검판 주소(15173 · 15174) · 운영 서버 아님 · 문서 712 · 판 v10.570',
   len(pages) == 20 and len(set(ids)) == 20 and sum(1 for p in pages if p[2] == 'admin') == 12 and sum(1 for p in pages if p[2] in ('member', 'guest')) == 8
   and 'localhost:15173' in SD and 'localhost:15174' in SD and '운영 서버에서 돌리는 도구가 아님' in SD and doc('712_') != '' and VT >= (10, 570), f"{len(pages)} {VER}")

html_ok, pil_pct = False, None
if SDM:
    with tempfile.TemporaryDirectory() as td:
        rows = [{'id': 'a', 'name': '가', 'url': '/', 'pct': None, 'note': '', 'shot': 'shots/a.png', 'base': None, 'diff': None},
                {'id': 'b', 'name': '나', 'url': '/b', 'pct': 3.5, 'note': '', 'shot': 'shots/b.png', 'base': 'base/b.png', 'diff': 'diff/b.png'},
                {'id': 'c', 'name': '다', 'url': '/c', 'pct': None, 'error': '찍지 못함: 시험', 'shot': None, 'base': None, 'diff': None}]
        SDM.write_html(os.path.join(td, 'index.html'), {'label': 'v-시험', 'at': 'now', 'threshold': 1.0, 'engine': '시험', 'baseLabel': 'v-앞'}, rows)
        h = open(os.path.join(td, 'index.html'), encoding='utf-8').read()
        html_ok = ('화면 비교 — v-시험' in h and 'class="bad" data-id="b"' in h and '3.500%' in h and '처음' in h and '오류' in h
                   and 'prefers-color-scheme: dark' in h and h.index('data-id="b"') < h.index('data-id="a"'))
        try:
            from PIL import Image
            Image.new('RGB', (10, 10), (255, 255, 255)).save(os.path.join(td, 'x.png'))
            im = Image.new('RGB', (10, 10), (255, 255, 255)); im.putpixel((0, 0), (0, 0, 0)); im.save(os.path.join(td, 'y.png'))
            pil_pct = SDM.diff_pil(os.path.join(td, 'x.png'), os.path.join(td, 'y.png'), os.path.join(td, 'd.png'))[0]
        except ImportError:
            pil_pct = 'no-pil'
ok('① 결과 html 한 장 — 차이 큰 화면부터 · 기준 넘으면 칠함 · 처음 · 오류 표시 · 어두운 화면 · (Pillow 가 있으면) 점 하나 바뀐 10×10 = 1%',
   html_ok and pil_pct in (1.0, 'no-pil'), f"{html_ok} {pil_pct}")

if ADMIN_WEB and SITE:
    out = tempfile.mkdtemp(prefix='sd1570_')
    try:
        r1 = subprocess.run([sys.executable, SD_PATH, '--out', out, '--only', 'adm-home,site-home', '--label', 'v1570a'], capture_output=True, text=True, timeout=900,
                            env={**os.environ, 'ADMIN_WEB': ADMIN_WEB, 'SITE': SITE})
        r2 = subprocess.run([sys.executable, SD_PATH, '--out', out, '--only', 'adm-home,site-home', '--label', 'v1570b'], capture_output=True, text=True, timeout=900,
                            env={**os.environ, 'ADMIN_WEB': ADMIN_WEB, 'SITE': SITE})
        dirs = sorted(d for d in os.listdir(out) if os.path.exists(os.path.join(out, d, 'result.json')))
        j2 = json.load(open(os.path.join(out, dirs[-1], 'result.json'), encoding='utf-8')) if dirs else {}
        rows2 = j2.get('rows', [])
        ok('② 점검판에서 두 번 찍기 — 첫 번은 「처음」 · 두 번째는 앞 결과와 차이 %(숫자) · 그림 · html · result.json 남음 · 끝 코드 0',
           r1.returncode == 0 and r2.returncode == 0 and len(dirs) == 2 and j2.get('baseLabel') == 'v1570a' and len(rows2) == 2
           and all(isinstance(x.get('pct'), (int, float)) and os.path.exists(os.path.join(out, dirs[-1], x['shot'])) for x in rows2)
           and os.path.exists(os.path.join(out, dirs[-1], 'index.html')),
           f"{r1.returncode} {r2.returncode} {dirs} {[(x['id'], x.get('pct'), x.get('error')) for x in rows2]} {r2.stdout[-200:]} {r2.stderr[-200:]}")
    finally:
        subprocess.run(['rm', '-rf', out])
else:
    print('  (ADMIN_WEB · SITE 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
