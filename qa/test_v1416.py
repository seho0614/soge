"""v10.416 (D251 · docs/553) 회계 메뉴 정리 — 탭 줄 하위 묶음(장부 · 자금 · 매입 · 경비 · 세무 · 인사 · 설정 · 보고) · 월 결산 바로가기
  ① (코드) GROUP_SECTIONS · sectionsOf · 탭 줄 이름표 · 바로가기 · 옛 그룹 tabs 글자 그대로 · 문서
  ② (화면) 회계 › 은행 맞추기 — 이름표 6 · 탭 단추 26 그대로 · 월 결산 바로가기
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


import glob
def mig(prefix):
    fs = sorted(glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(fs[0], encoding='utf-8').read() if fs else ''


M48 = mig('D248')

M51 = mig('D251')
MN, AP, UI, CSS = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/styles/app.css')
ok('① 코드 — 하위 묶음 6(장부 · 자금 · 매입 · 경비 · 세무 · 인사 · 설정 · 보고) · sectionsOf · 탭 줄 이름표(data-section) · 단추 data-tab 그대로 · 월 결산 바로가기 · 옛 회계 그룹 글자 그대로 · 문서 553 · 판 v10.416',
   'export const GROUP_SECTIONS' in MN and 'export function sectionsOf' in MN and all(f"label: '{x}'" in MN for x in ('장부', '자금', '매입 · 경비', '세무', '인사', '설정 · 보고'))
   and "tabs: ['acct-month', 'acct-journal', 'acct-bank'" in MN and "'acct-accounts'] }" in MN
   and 'sectionsOf(cur.key, curTabs)' in AP and 'data-section=' in AP and 'data-tab={t}' in AP and '<AcctMonth onGo=' in AP
   and 'function AcctShortcuts' in UI and 'data-acct-shortcuts=' in UI and '.ad-sec-l' in CSS and '하위 묶음' in doc('553_') and VT >= (10, 416), VER)

if ADMIN_WEB:
    def chk(pg, seen):
        pg.wait_for_selector('.ad-snb [data-section]', timeout=30000)
        seen['secs'] = pg.locator('.ad-snb [data-section]').count()
        seen['tabs'] = pg.locator('.ad-snb button[data-tab^="acct-"]').count()
        seen['bank'] = pg.locator('.ad-snb button[data-tab="acct-bank"].on').count()
        pg.locator('.ad-snb button[data-tab="acct-month"]').click(); pg.wait_for_timeout(2500)
        seen['short'] = pg.locator('[data-acct-shortcuts]').count()
        seen['shortbtn'] = pg.locator('[data-acct-shortcut]').count()
    res = admin_page('/#/acct-bank', chk)
    if res is None: print('  (playwright 없음 — ② 건너뜀)')
    else:
        seen, perr = res
        ok('② 화면 — 회계 탭 줄 이름표 6 · 단추 26 그대로 · 은행 맞추기 켜짐 · 월 결산 바로가기(25) · 화면 오류 없음',
           seen.get('secs') == 6 and seen.get('tabs', 0) >= 26 and seen.get('bank') == 1 and seen.get('short') == 1 and seen.get('shortbtn', 0) >= 25 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (화면 주소 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
