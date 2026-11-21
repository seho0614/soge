"""v10.561 (D291 · docs/703) 직원 · 권한 그룹 · 운영자 목록 — 회원 · 직원 권한 분리 A안(대표 11/21)
  ① (코드) 그룹 이름 「직원 · 권한」(키 acl) · 새 탭 staff-list · perm-admin · role-review 를 이 그룹으로 · 이름 업무별 권한 · 권한 점검 · 역할 주기 · App 그리기 · API · 화면 목록 STF-010 · 문서 703
  ② (API · DB) GET /admin/staff — SUPER: 운영자만 · 직원 연결 없음 표시 · 메일 원문 / ADMIN: 200 · 메일 가림 / 회원 403
  ③ (화면) 왼쪽 메뉴 「직원 · 권한」 · 업무별 권한 · 권한 점검 · 운영자 목록 표
  (두 번 돌아도 통과 — 시험 운영자는 끝에 역할을 뺌)
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


MN, AP, SC, SV = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/modules/admin/staff.controller.ts'), rd('src/modules/admin/staff.ts')
ok('① 코드 — 그룹 이름 · 새 탭 · 옮김 · 이름 정리 · 그리기 · 역할 표 · API(@Roles ADMIN · @ApiOkResponse) · 화면 목록 · 문서 703 · 판 v10.561',
   "{ key: 'acl',     label: '직원 · 권한'" in MN and "['staff-list', '운영자 목록']" in MN
   and "'perm-admin': '업무별 권한', 'role-review': '권한 점검', roles: '역할 주기'" in MN and "const ACL_ORDER: Tab[] = ['staff-list'" in MN
   and "g.tabs.filter((t) => t !== 'perm-admin' && t !== 'role-review')" in MN and "{tab === 'staff-list' && <StaffList />}" in AP
   and "'staff-list': ['ADMIN', 'SUPER']" in AP and 'TAB_RENAME[t] ?? TABS.find' in AP
   and "@Controller('api/v1/admin/staff')" in SC and "@Roles('ADMIN')" in SC and '@ApiOkResponse' in SC and 'noEmployee: !r.employeeId' in SV
   and '"SB-ADM-STF-010"' in SJ and '운영자 목록' in doc('703_') and VT >= (10, 561), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    ea, aa = mk_staff(f'1561a{stamp % 97}', 'ADMIN')
    try:
        consent_ok.agree(ea, PW)
        TA = login(ea)
        s1 = call('GET', '/admin/staff', None, TS)
        me = next((x for x in (s1.get('items') or []) if x.get('id') == aa), {})
        sup = next((x for x in (s1.get('items') or []) if 'SUPER' in (x.get('roles') or [])), {})
        mem = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
        s2 = call('GET', '/admin/staff', None, TA)
        me2 = next((x for x in (s2.get('items') or []) if x.get('id') == aa), {})
        s3 = call('GET', '/admin/staff', None, TB)
        ok('② 운영자 목록 — SUPER: 시험 ADMIN 줄(역할 ADMIN · 직원 연결 없음 · 메일 원문) · SUPER 줄 · 회원 계정 없음 · freeEmployees 칸 / ADMIN: 200 · 메일 가림 · freeEmployees 빈 / 회원 403',
           me.get('roles') == ['ADMIN'] and me.get('noEmployee') is True and me.get('email') == ea and bool(sup)
           and not any(x.get('id') == mem for x in (s1.get('items') or [])) and isinstance(s1.get('freeEmployees'), list)
           and bool(me2) and '*' in str(me2.get('email') or '') and s2.get('freeEmployees') == [] and s3.get('_err') == 403,
           f"{me.get('roles')} {me.get('noEmployee')} {me.get('email')} · SUPER {bool(sup)} · {str(me2.get('email'))} {s2.get('freeEmployees')} · {s3.get('_err')}")
    finally:
        rm_role(aa, '1561')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        pg.wait_for_selector('[data-staff-list]', timeout=30000)
        tree = pg.locator('.ad-tree').first.inner_text() if pg.locator('.ad-tree').count() else ''
        seen['tree'] = all(x in tree for x in ('직원 · 권한', '운영자 목록', '업무별 권한', '권한 점검', '역할 주기')) and '권한 계층' not in tree
        seen['rows'] = pg.locator('[data-staff-row]').count()
    r = admin_page('/#/staff-list', chk)
    if r is None:
        print('  (playwright 없음 — ③ 건너뜀)')
    else:
        seen, perr = r
        ok('③ 화면 — 왼쪽 메뉴 「직원 · 권한」 › 운영자 목록 · 업무별 권한 · 권한 점검 · 역할 주기(「권한 계층」 없음) · 운영자 줄 · 화면 오류 없음',
           seen.get('tree') is True and (seen.get('rows') or 0) >= 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (ADMIN_WEB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
sys.exit(0 if passed == len(RES) else 1)
