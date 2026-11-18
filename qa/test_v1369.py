"""v10.369 (docs/504) 운영자 비밀번호 — 운영 화면에서
  ① (코드) API · 탭 · 화면 목록 · 띠 링크
  ② (API) 회원 역할 없는 ADMIN 이 바꿈 · 422 · 옛 증표 무효 · 403
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


OC, AM, MN, AP, SS = rd('src/modules/admin/ops-staff.controller.ts'), rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/StaffSession.tsx')
ok('① 코드 — PATCH /admin/me/password(운영 역할 모두 · 같은 서비스) · 권한 계층 › 「내 비밀번호」 탭 · 화면 목록 SB-ADM-PWD-010 · 90일 띠 링크 · 문서 504 · 판 v10.369',
   "@Patch('me/password')" in OC and 'return this.sec.change(dto.currentPassword, dto.newPassword);' in OC and 'OpsStaffController' in AM
   and "['my-password', '내 비밀번호']" in MN and "tabs: ['roles', 'my-mfa', 'my-password', 'staff-access']" in MN and "{tab === 'my-password' && <MyPassword />}" in AP
   and 'href="#/my-password"' in SS and '"SB-ADM-PWD-010"' in SJ and '"PATCH /admin/me/password"' in SJ and '내 비밀번호' in doc('504_') and VT >= (10, 369), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('buyer@x.com', PW)
    TB = login('buyer@x.com')
    em, aid = mk_staff('1369')
    try:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1369 회원 역할 뺌', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role = 'MEMBER'; COMMIT;")
        roles = psql(f"SELECT string_agg(role, ',' ORDER BY role) FROM account_roles WHERE account_id = '{aid}'")
        consent_ok.agree(em, PW); T0 = login(em)
        NEW = 'Sgb-1369-new-pass!'
        old_site = call('PATCH', '/me/password', {'currentPassword': PW, 'newPassword': NEW}, T0)
        short = call('PATCH', '/admin/me/password', {'currentPassword': PW, 'newPassword': 'Abc-12345!x'}, T0)
        wrong = call('PATCH', '/admin/me/password', {'currentPassword': 'wrong-pass-1369', 'newPassword': NEW}, T0)
        r = call('PATCH', '/admin/me/password', {'currentPassword': PW, 'newPassword': NEW}, T0)
        stale = call('GET', '/auth/staff-session', None, T0)
        fresh = call('GET', '/auth/staff-session', None, r.get('accessToken'))
        l2 = call('POST', '/auth/login', {'email': em, 'password': NEW})
        fb = call('PATCH', '/admin/me/password', {'currentPassword': PW, 'newPassword': NEW}, TB)
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'PASSWORD_CHANGE' AND occurred_at > now() - interval '10 minutes'")
        ok('② API — 회원 역할 없는 ADMIN: 사용자 웹 길은 403 · 운영 화면 길로 바꿈 · 11자 422 · 지금 비밀번호 틀림 422 · 옛 증표 무효 · 새 증표 · 새 비밀번호 로그인 · 감사 · 회원 403',
           roles == 'ADMIN' and old_site.get('_err') == 403 and short.get('_err') in (400, 422) and wrong.get('code') == 'CURRENT_PASSWORD_WRONG' and r.get('ok') is True
           and stale.get('_err') in (401, 403) and not fresh.get('_err') and bool(l2.get('accessToken')) and fb.get('_err') == 403 and int(aud or 0) >= 1,
           f"{roles} · {old_site.get('_err')} · {short.get('_err')} {short.get('code')} · {wrong.get('code')} · {r.get('ok')} · {stale.get('_err')} {fresh.get('_err')} · {bool(l2.get('accessToken'))} · {fb.get('_err')}")
    finally:
        rm_role(aid, '1369')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
