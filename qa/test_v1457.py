"""v10.457 (docs/595) 운영 화면 왼쪽 메뉴 트리 — 대표 11/20 「관리자 화면 왼쪽 메뉴 트리 생성」
  ① (코드) AdminTree(상위 묶음 → 그룹 → 하위 묶음 → 화면) · 표식 data-group · data-tabs · data-tab · data-nav-section · data-section 그대로 · 상단바 그룹 단추 · 탭 줄 없앰 · 찾기 · 즐겨찾기 · 최근 · 접기 · 서랍 · 문서 595
  ② (화면) 트리 그룹 22개 안팎 · 회계 하위 묶음 · 화면 단추로 이동 · 메뉴 찾기 「전표」 · 즐겨찾기 별표 · 접기 · 펴기 · 좁은 화면 서랍 · 화면 오류 없음
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')
UI, AP, MN, SC, WK, AM = rd('web/src/app/admin/Report.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')

MN, APP, TR, CSS = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/AdminTree.tsx'), rd('web/src/styles/app.css')
ok('① 코드 — AdminTree · 표식 그대로(data-group · data-tabs · data-tab · data-nav-section · data-section) · 상단바 그룹 단추 · 탭 줄 없앰 · 찾기 · 즐겨찾기 · 최근 · 접기 · 서랍 · 문서 595 · 판 v10.457',
   'export function AdminTree' in TR and 'navSectionsOf(groups).map' in TR and 'sectionsOf(g.key, g.tabs)' in TR
   and 'data-group={g.key}' in TR and "data-tabs={`|${g.tabs.map(label).join('|')}|`}" in TR and 'data-tab={t}' in TR and 'data-nav-section={s.label}' in TR and 'data-section=' in TR
   and 'data-tree-search' in TR and 'data-fav={t}' in TR and 'data-tree-recent' in TR and 'data-tree-fold' in TR and 'data-tab-link={t}' in TR
   and '<AdminTree ' in APP and 'className="ad-gnb"' not in APP and 'className="ad-snb"' not in APP and 'data-tree-open' in APP
   and '.ad-tree' in CSS and '@media (max-width: 1240px)' in CSS and '왼쪽 메뉴 트리' in doc('595_') and VT >= (10, 457), VER)

if API and DB and ADMIN_WEB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    def chk(pg, seen):
        pg.wait_for_selector('.ad-tree button[data-group]', timeout=30000)
        seen['grp'] = pg.locator('.ad-tree button[data-group]').count()
        seen['secs'] = pg.locator('.ad-tree [data-nav-section]').count()
        seen['headNav'] = pg.locator('.bo-head nav button').count()
        seen['snb'] = pg.locator('.ad-snb').count()
        pg.locator('.ad-tree button[data-group="admacc"]').click(); pg.wait_for_timeout(800)
        seen['accSubs'] = pg.locator('.ad-tree .ad-tr-g.on [data-section]').count()
        pg.locator('.ad-tree .ad-tr-g.on button[data-tab="acct-journal"]').click(); pg.wait_for_timeout(1200)
        seen['tab'] = pg.locator('.bo-main').get_attribute('data-tab')
        seen['hash'] = pg.evaluate('location.hash')
        pg.fill('[data-tree-search]', '전표'); pg.wait_for_timeout(400)
        seen['hits'] = int(pg.get_attribute('[data-tree-hits]', 'data-tree-hits') or 0)
        pg.fill('[data-tree-search]', ''); pg.wait_for_timeout(300)
        pg.locator('.ad-tree button[data-tab="acct-bank"]').hover(); pg.locator('.ad-tree button[data-fav="acct-bank"]').click(); pg.wait_for_timeout(300)
        seen['fav'] = pg.locator('[data-tree-favs] button[data-tab-link="acct-bank"]').count()
        pg.locator('.ad-tree button[data-fav="acct-bank"]').click(); pg.wait_for_timeout(300)   # 되돌림(공유 데이터 아님 · 이 브라우저만)
        seen['favOff'] = pg.locator('[data-tree-favs]').count()
        pg.click('[data-tree-fold]'); pg.wait_for_timeout(400)
        seen['folded'] = pg.locator('.ad-tree.folded').count()
        pg.click('[data-tree-open]'); pg.wait_for_timeout(400)
        seen['unfolded'] = pg.locator('.ad-tree.folded').count()
        pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(500)
        pg.click('[data-tree-open]'); pg.wait_for_timeout(500)
        seen['drawer'] = pg.locator('.ad-tree.open').count()
        pg.locator('.ad-tree button[data-group="adm"]').click(); pg.wait_for_timeout(500)
        if pg.locator('.ad-tree.open [data-tab="home"]').count(): pg.locator('.ad-tree.open [data-tab="home"]').click()   # v10.571 대시보드에 「대표 한눈에」 — 묶음이 여러 탭이면 탭을 골라야 닫힘
        pg.wait_for_timeout(800)
        seen['drawerClosed'] = pg.locator('.ad-tree.open').count()
    res = admin_page('/#/home', chk)
    if res is None: print('  (playwright 없음 — ② 건너뜀)')
    else:
        seen, perr = res
        ok('② 화면 — 트리 그룹 20개 넘음 · 이름표 6 · 상단바 그룹 단추 · 탭 줄 없음 · 회계 하위 묶음 6 · 전표로 이동 · 찾기 2 이상 · 즐겨찾기 · 접기 · 펴기 · 좁은 화면 서랍 열고 고르면 닫힘 · 화면 오류 없음',
           seen.get('grp', 0) >= 20 and seen.get('secs') == 6 and seen.get('headNav') == 0 and seen.get('snb') == 0 and seen.get('accSubs') == 6
           and seen.get('tab') == 'acct-journal' and seen.get('hash') == '#/acct-journal' and seen.get('hits', 0) >= 2 and seen.get('fav') == 1 and seen.get('favOff') == 0
           and seen.get('folded') == 1 and seen.get('unfolded') == 0 and seen.get('drawer') == 1 and seen.get('drawerClosed') == 0 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (화면 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
