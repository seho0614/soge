"""v10.444 (D258 · docs/581) 화면 반영 — 내 업무 권한 · 탭 감춤 · 보기만 안내
  ① (코드) /admin/perm/me · permVisible · permCan · PermReadonlyBar · App 탭 보이기 = 역할 + 업무 권한 · 문서 581
  ② (API) 지급 담당 내 권한(회계 전표 보기 · 표에 있는 업무 목록 · SUPER 아님) · SUPER(모두) · 회원 403
  ③ (화면) 사무 › 권한 관리 — 모드 줄 · 권한그룹 표 · 화면 오류 없음
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

UI, APP = rd('web/src/app/admin/Perm.tsx'), rd('web/src/App.tsx')
AC_, OF_ = rd('web/src/app/admin/Acct.tsx'), rd('web/src/app/admin/Office.tsx')
ok('① 감싸기 — App.tsx 한 곳에서 <PermScope> 로 모든 탭 내용 · 고치기 · 승인 · 내려받기 단추 판정 · 결재 단추 data-perm="approve"(결재함 · 경비 · 수동 전표 · 품의) · 막은 단추 모양',
   APP.count('<PermScope tab={tab}>') == 1 and APP.count('</PermScope>') == 1 and 'export function PermScope' in UI and 'export function permButtonAllowed' in UI
   and 'MutationObserver' in UI and "data-perm-off" in rd('web/src/styles/app.css')
   and OF_.count('data-perm="approve"') >= 2 and AC_.count('data-perm="approve"') >= 6)
ok('① 코드 — 내 권한 API · permVisible · permCan · 보기만 안내 · 탭 보이기에 업무 권한 · 문서 581 · 판 v10.444',
   'export const permVisible' in UI and 'export const permCan' in UI and 'export function PermReadonlyBar' in UI and 'loadPerm' in APP
   and 'canSee(t, roles) && permVisible(t)' in APP and '<PermReadonlyBar tab={tab} />' in APP and '보기' in doc('581_') and VT >= (10, 444), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1444', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    try:
        mp = call('GET', '/admin/perm/me', None, TP)
        ms = call('GET', '/admin/perm/me', None, TS)
        mb = call('GET', '/admin/perm/me', None, TB)
        ok('② 내 권한 — 지급 담당(회계 전표 보기 · 업무 목록 · SUPER 아님 · 검사 모드) · SUPER · 회원 403',
           'VIEW' in ((mp.get('tasks') or {}).get('acct-journal') or []) and 'acct-journal' in (mp.get('known') or []) and mp.get('super') is False
           and mp.get('mode') in ('OFF', 'SHADOW', 'ON') and ms.get('super') is True and mb.get('_err') == 403,
           f"{(mp.get('tasks') or {}).get('acct-journal')} {len(mp.get('known') or [])} {mp.get('super')} {mp.get('mode')} · {ms.get('super')} · {mb.get('_err')}")
    finally:
        rm_role(pid, '1444')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-perm-admin]', timeout=30000)
            seen['sec'] = pg.locator('[data-perm-admin]').count(); seen['mode'] = pg.locator('p[data-perm-mode]').count(); seen['groups'] = pg.locator('[data-perm-groups]').count()
            seen['scope'] = pg.locator('[data-perm-scope="perm-admin"]').count(); seen['lvl'] = pg.locator('[data-perm-scope]').first.get_attribute('data-perm-level') if seen['scope'] else None
            seen['widen'] = pg.locator('[data-perm-widen]').count(); seen['off'] = pg.locator('button[data-perm-off]').count()
        res = admin_page('/#/perm-admin', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 사무 › 권한 관리 · 모드 줄 · 권한그룹 표 · 화면 오류 없음',
               seen.get('sec') == 1 and seen.get('mode') == 1 and seen.get('groups') == 1 and not perr, f"{seen} {perr[:2]}")
            ok('③ 감싸기 — 탭 내용이 PermScope 안 · SUPER 는 막는 단추 없음(level all) · 권한 넓히기 스위치(처음 꺼짐)',
               seen.get('scope') == 1 and seen.get('lvl') == 'all' and seen.get('off') == 0 and seen.get('widen') == 1, f"{seen}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
