"""v10.426 (D253 · docs/563) 운영 화면 상단바 정리 — 그룹을 상위 묶음 이름표로(단추 · data-group · data-tabs 그대로)
  ① (코드) NAV_SECTIONS · navSectionsOf · 상단바 그리기 · 그룹 단추 속성 그대로 · 이름표는 단추 아님 · 모든 그룹이 한 묶음에 · 문서 563
  ② (화면) 상단바 이름표 6 · 그룹 단추 수 = 보이는 그룹 · flow_lib 방식(data-tabs) 으로 회계 › 은행 맞추기 들어감
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

ok('① 코드 — D250 report_sends · report.send off · send_kinds · sendSnapshot(텔레그램 · 슬랙 · 메일) · sendAfterJob · API · 감사 · 화면 · 문서 552 · 판 v10.415',
   'CREATE TABLE IF NOT EXISTS public.report_sends' in M50 and "('report.send', 'off'" in M50 and "'report.send_kinds'" in M50
   and 'export async function sendSnapshot' in RS and 'export async function sendAfterJob' in RS and 'telegram.send' in RS and 'slack.send' in RS and 'mail.send' in RS
   and "@Audit('REPORT_SEND', 'SETTING')" in RC and "@Audit('REPORT_SETTING', 'SETTING')" in RC and 'data-rpt-settings=' in UI and 'data-rpt-send=' in UI
   and '보내기' in doc('552_') and VT >= (10, 415), VER)

M53 = migr('D253_')

MN, APP, CSS = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx') + rd('web/src/app/admin/AdminTree.tsx'), rd('web/src/styles/app.css')   # v10.457 그룹 단추는 왼쪽 트리
keys = re.findall(r"\{ key: '([a-z]+)',", MN)
secs = re.search(r"export const NAV_SECTIONS: NavSection\[\] = \[(.*?)\];", MN, re.S)
placed = re.findall(r"'([a-z]+)'", secs.group(1)) if secs else []
ok('① 코드 — 상위 묶음 6 · 모든 그룹이 한 번씩 · navSectionsOf · 단추 data-group · data-tabs 그대로 · 이름표 em · 문서 563 · 판 v10.426',
   bool(secs) and sorted(placed) == sorted(keys) and len(placed) == len(set(placed)) and 'export function navSectionsOf' in MN
   and 'navSectionsOf(groups).map' in APP and 'data-group={g.key}' in APP and "data-tabs={`|${g.tabs.map(label).join('|')}|`}" in APP and ('className="ad-gsec-l"' in APP or 'data-nav-section={s.label}' in APP)
   and '.ad-gsec' in CSS and '.ad-gnb button.on { background: var(--ahd-on); color: var(--sgb-navy); }' in CSS and '상단바' in doc('563_') and VT >= (10, 426),
   f"{len(keys)} 그룹 · 묶음에 {len(placed)} · 빠짐 {sorted(set(keys) - set(placed))} · {VER}")

if API and DB and ADMIN_WEB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    def chk(pg, seen):
        # v10.457 — 상위 묶음 이름표 · 그룹 단추는 왼쪽 메뉴 트리로 옮김(data-nav-section · data-group · data-tabs 그대로)
        pg.wait_for_selector('.ad-tree button[data-group]', timeout=30000)
        seen['labels'] = pg.locator('.ad-tree [data-nav-section]').count()
        seen['btn'] = pg.locator('.ad-tree button[data-group]').count()
        seen['emInBtn'] = pg.locator('.ad-tree button[data-group] em').count()
        g = pg.locator('.ad-tree button[data-group][data-tabs*="|은행 맞추기|"]')
        seen['grp'] = g.count()
        if g.count():
            g.first.click(); pg.wait_for_timeout(800)
            b = pg.locator('.ad-tree .ad-tr-g.on button[data-tab="acct-bank"]')
            if b.count(): b.first.click(); pg.wait_for_timeout(800)
            seen['tab'] = pg.locator('.bo-main').get_attribute('data-tab')
    res = admin_page('/#/home', chk)
    if res is None: print('  (playwright 없음 — ② 건너뜀)')
    else:
        seen, perr = res
        ok('② 화면 — 상위 묶음 이름표 6(v10.457 왼쪽 트리) · 그룹 단추 20개 넘게 그대로 · 단추 안에 이름표 없음 · data-tabs 로 회계 › 은행 맞추기 들어감 · 화면 오류 없음',
           seen.get('labels') == 6 and seen.get('btn', 0) >= 20 and seen.get('emInBtn') == 0 and seen.get('grp') == 1 and seen.get('tab') == 'acct-bank' and not perr, f"{seen} {perr[:2]}")
else:
    print('  (화면 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
