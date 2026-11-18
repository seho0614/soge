"""v10.365 (docs/500) 회원 활동 한 줄 기록
  ① (코드) API · 개인정보 접속기록 · 회원 상세 「활동 기록」 · 문서 500 · 판 v10.365
  ② (API) 가입 · 로그인 · 메모 · 권한 → 종류 · 순서 · 거르기 · 접속기록 · 404 · 403
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


OSC, MA, MB = rd('src/modules/admin/ops-safety.controller.ts'), rd('src/modules/admin/member-activity.ts'), rd('web/src/app/admin/Members.tsx')
BX, AM = rd('web/src/app/admin/OpsSafetyBoxes.tsx'), rd('src/app.module.ts')
ok('① 코드 — API(ADMIN · SUPER) · 개인정보 접속기록 · 표 10종 읽기만 · 회원 상세 「활동 기록」(펼칠 때만) · 화면 연결 · 문서 500 · 판 v10.365',
   "@Get('accounts/:id/activity')" in OSC and "@PiiAccess('ACCOUNT', '회원 활동 기록')" in OSC and 'export async function memberActivity' in MA
   and 'FROM login_history WHERE account_id = $1 ORDER BY at DESC LIMIT 40' in MA and 'OpsSafetyController' in AM and '<MemberActivityBox accountId={id} />' in MB
   and '{open && <ActivityList accountId={accountId} />}' in BX and '"GET /admin/accounts/{id}/activity"' in SJ and '활동 기록' in doc('500_') and VT >= (10, 365), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    em, tgt = mk_staff('1365', None)
    consent_ok.agree(em, PW)
    login(em); call('POST', '/auth/login', {'email': em, 'password': 'wrong-pass-1365'})
    call('POST', f'/admin/accounts/{tgt}/notes', {'body': '시험 1365 활동 기록 메모'}, TS)
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1365', true); INSERT INTO account_roles (account_id, role) VALUES ('{tgt}', 'REVIEWER') ON CONFLICT DO NOTHING; COMMIT;")
    rm_role(tgt, '1365')
    p0 = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE target_account_id = '{tgt}' AND reason LIKE '회원 활동 기록%'")
    g = call('GET', f'/admin/accounts/{tgt}/activity', None, TS)
    gl = call('GET', f'/admin/accounts/{tgt}/activity?kind=LOGIN', None, TS)
    time.sleep(1)
    p1 = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE target_account_id = '{tgt}' AND reason LIKE '회원 활동 기록%'")
    nf = call('GET', '/admin/accounts/00000000-0000-4000-8000-000000000000/activity', None, TS)
    fb = call('GET', f'/admin/accounts/{tgt}/activity', None, TB)
    rows = g.get('rows') or []
    kinds = {r.get('kind') for r in rows}
    ats = [r.get('at') for r in rows]
    lr = gl.get('rows') or []
    ok('② API — 가입 · 로그인(성공 · 틀림) · 메모 · 권한(주기 · 거두기) → 종류 4 이상 · 최근 순 · kind=LOGIN 만 2줄 이상 · 개인정보 접속기록 +2 · 없는 회원 404 · 회원 403',
       {'SIGNUP', 'LOGIN', 'NOTE', 'ROLE'} <= kinds and ats == sorted(ats, reverse=True) and rows[-1].get('kind') == 'SIGNUP'
       and len(lr) >= 2 and all(r.get('kind') == 'LOGIN' for r in lr) and any('틀림' in (r.get('text') or '') for r in lr) and gl.get('kind') == 'LOGIN'
       and int(p1 or 0) - int(p0 or 0) >= 2 and (g.get('counts') or {}).get('ROLE', 0) >= 2 and nf.get('_err') == 404 and fb.get('_err') == 403,
       f"{sorted(k for k in kinds if k)} · {len(lr)} · pii {p0}→{p1} · {(g.get('counts') or {})} · {nf.get('_err')} {fb.get('_err')}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
