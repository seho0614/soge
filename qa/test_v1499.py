"""v10.499 (D272 · docs/637) 앱처럼 설치(PWA) — 대표 11/20 「㊷ ③」
  ① (코드) 웹 앱 정보 · 아이콘 · 서비스 워커(오프라인 안내만 · 캐시 없음) · 운영 빌드 + site.pwa 일 때만 등록 · off 면 지움 · /sw.js 머리글 · 오프라인 한 장 · 설정 · 문서
  ② (API) 공개 설정 site.pwa
  ③ (사용자 웹 · SITE) 웹 앱 정보 · 아이콘 · 서비스 워커 머리글 · 오프라인 한 장 · manifest 링크
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로) — 빈 값은 NULL 로(무늬 트리거가 '' 를 막는 키가 있음)"""
    v = 'NULL' if value is None or value == '' else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def callh(m_, p, b=None, t=None, headers=None):
    """머리글을 더 붙여 부름(감시 토큰 등)"""
    hd = {'content-type': 'application/json', **(headers or {})}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def http_get(url):
    """사용자 웹 정적 파일 · 화면(상태 · 머리글 · 본문 앞 2만 자)"""
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0 qa'}), timeout=60)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(200000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, {}, ''
    except Exception as e:
        return 0, {}, str(e)[:120]


STAMP = int(time.time()) % 1000000


M72 = migr('D272_')
MF, IC, AI, SW, OF = rd('site/src/app/manifest.ts'), rd('site/src/app/pwa-icon/[size]/route.tsx'), rd('site/src/app/apple-icon.tsx'), rd('site/public/sw.js'), rd('site/public/offline.html')
PR, FL, LY, NC = rd('site/src/components/upt/PwaRegister.tsx'), rd('site/src/components/upt/flags.ts'), rd('site/src/app/layout.tsx'), rd('site/next.config.js')
ok('① 코드 — 웹 앱 정보(standalone · 아이콘 3 · maskable) · 아이콘 그림 · 아이폰 아이콘 · 서비스 워커는 화면 이동만 · 실패 때 오프라인 한 장 · cache.put 없음 · 옛 캐시 지움 · 등록은 운영 빌드 + site.pwa · off 면 지움 · /sw.js no-cache 머리글 · 오프라인 한 장(SB-HOM-UPT-030) · 설정 site.pwa 처음 off(GLOBAL) · 화면 목록 · 문서 637 · 판 v10.499',
   "display: 'standalone'" in MF and "purpose: 'maskable'" in MF and "'/pwa-icon/512'" in MF and 'ImageResponse' in IC and "size === 'maskable'" in IC and 'export default function AppleIcon' in AI
   and "req.mode !== 'navigate'" in SW and 'caches.match(OFFLINE)' in SW and 'cache.put' not in SW and '.put(' not in SW and 'caches.delete(k)' in SW
   and "process.env.NODE_ENV === 'production'" in PR and "register('/sw.js'" in PR and 'unregister()' in PR and "s['site.pwa']" in FL and '<PwaRegister on={pwaOn(settings)} />' in LY
   and "source: '/sw.js'" in NC and 'no-store' in NC and 'SB-HOM-UPT-030' in OF and '<script' not in OF
   and "('site.pwa', 'off', 'GLOBAL'" in M72 and '"SB-HOM-UPT-030"' in SJ and '서비스 워커' in doc('637_') and VT >= (10, 499), VER)

if API and DB:
    pub = call('GET', '/site-settings/public')
    ok('② 공개 설정에 site.pwa(사용자 웹 layout 이 읽음 · 처음 off)', pub.get('site.pwa') in ('on', 'off'), str(pub.get('site.pwa')))
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if SITE:
    c1, _, b1 = http_get(SITE + '/manifest.webmanifest')
    try:
        mj = json.loads(b1)
    except Exception:
        mj = {}
    c2, h2, _ = http_get(SITE + '/pwa-icon/192')
    c3, h3, b3 = http_get(SITE + '/sw.js')
    c4, _, b4 = http_get(SITE + '/offline.html')
    c5, _, b5 = http_get(SITE + '/')
    hasm = 'rel="manifest"' in b5
    ok('③ 사용자 웹 — 웹 앱 정보(소개뱅크 · 아이콘 3) · 아이콘 그림 · 서비스 워커(no-store) · 오프라인 한 장 · 메인에 manifest 링크',
       c1 == 200 and mj.get('name') == '소개뱅크' and len(mj.get('icons') or []) == 3 and c2 == 200 and 'image/png' in h2.get('content-type', '')
       and c3 == 200 and 'no-store' in h3.get('cache-control', '') and "mode !== 'navigate'" in b3 and c4 == 200 and 'SB-HOM-UPT-030' in b4
       and c5 == 200 and hasm,
       f"{c1} {mj.get('name')} {c2} {h2.get('content-type')} {c3} {h3.get('cache-control')} {c4} {c5} {hasm}")

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
