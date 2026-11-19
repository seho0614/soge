"""v10.441 (D258 · docs/578) 업무별 권한 표 · 처음 변환
  ① (코드) D258 표 9 · 시드(업무 · 업무그룹 · 권한그룹 R_역할 · 주소) · 관리자 그룹 가드 · fn_perm_effective · 역할 → 그룹 저절로 · 문서 578
  ② (DB) 업무 100개 이상 · 지급 담당 그룹에 회계 전표 보기 · 역할 있는 사람마다 R_역할 그룹 · 새 역할 → 그룹 저절로 · 관리자 그룹은 MANAGER 만 · 지금 권한 함수
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

M58 = migr('D258_')
ok('① 코드 — D258 표 · 시드 · 가드 · 지금 권한 함수 · 역할 → 그룹 저절로 · 문서 578 · 판 v10.441',
   all(f'CREATE TABLE IF NOT EXISTS public.{t}' in M58 for t in ('perm_task_groups', 'perm_tasks', 'perm_role_groups', 'perm_role_group_items', 'perm_account_groups', 'perm_account_overrides', 'perm_account_kind', 'perm_route_map', 'perm_changes', 'perm_shadow_log'))
   and "'R_PAYOUT'" in M58 and "'R_ADMIN'" in M58 and 'fn_perm_effective' in M58 and 'trg_perm_role_attach' in M58 and 'PERM_KIND' in M58 and "('perm.enforce', 'SHADOW'" in M58
   and '업무' in doc('578_') and VT >= (10, 441), VER)

if API and DB:
    nt = psql("SELECT count(*) FROM perm_tasks")
    pj = psql("SELECT count(*) FROM perm_role_group_items WHERE group_key = 'R_PAYOUT' AND task_key = 'acct-journal' AND level = 'VIEW'")
    miss = psql("SELECT count(*) FROM account_roles r WHERE r.role IN ('ADMIN','PAYOUT','REVIEWER','PARTNER_MAL','PARTNER_AFF') AND NOT EXISTS (SELECT 1 FROM perm_account_groups g WHERE g.account_id = r.account_id AND g.group_key = 'R_' || r.role)")
    pe, pid = mk_staff('1441', 'PAYOUT')
    try:
        att = psql(f"SELECT count(*) FROM perm_account_groups WHERE account_id = '{pid}' AND group_key = 'R_PAYOUT'")
        kind = psql(f"SELECT kind FROM perm_account_kind WHERE account_id = '{pid}'")
        mgr = psql(f"INSERT INTO perm_account_groups (account_id, group_key) VALUES ('{pid}', 'R_ADMIN')")
        eff = psql(f"SELECT count(*) FROM fn_perm_effective('{pid}') WHERE task_key = 'acct-journal' AND level = 'VIEW'")
        none = psql(f"SELECT count(*) FROM fn_perm_effective('{pid}') WHERE task_key = 'queue'")
        ok('② DB — 업무 100개 이상 · 지급 담당 그룹에 회계 전표 보기 · 역할마다 그룹 · 새 지급 담당 → R_PAYOUT 저절로 · 업무용 · 관리자 그룹은 막음 · 지금 권한(전표 보기 있음 · 검수 없음)',
           int(nt or 0) >= 100 and pj == '1' and miss == '0' and att == '1' and kind == 'STAFF' and 'PERM_KIND' in mgr and eff == '1' and none == '0',
           f"{nt} {pj} 빠짐 {miss} · {att} {kind} · {mgr[-40:]} · {eff} {none}")
    finally:
        rm_role(pid, '1441')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
