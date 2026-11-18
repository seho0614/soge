"""v10.357 (D236 · docs/491) 운영 화면 자동 로그아웃 · 운영 역할 로그인 유지
  ① (코드) D236 설정 · 증표 · API · 화면 · 문서 491 · 판 v10.357 · 마이그레이션 274
  ② (API) 증표 기간 운영 1일 · 회원 14일 · staff-session
  ③ (화면) 시계 앞당김 → 띠 → 로그아웃
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

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
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


ST, AS, SS, APP = rd('src/modules/identity/staff-policy.ts'), rd('src/modules/identity/auth.service.ts'), rd('web/src/app/admin/StaffSession.tsx'), rd('web/src/App.tsx')
M36 = rd('prisma/migrations/D236_staff_session_oncall_password/migration.sql')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D236 설정 ops.admin_idle_min · ops.staff_refresh_days · 운영 역할만 증표 기간 · staff-session API · 화면(1분 전 띠 · 로그아웃 · 탭 공유) · 문서 491 · 판 v10.357 · 마이그레이션 274',
   "('ops.admin_idle_min', '30', 'ADMIN'" in M36 and "('ops.staff_refresh_days', '1', 'ADMIN'" in M36 and not re.search(r'\b(DROP|DELETE FROM|TRUNCATE)\b', M36)
   and 'isStaff(principal.roles) ? (await staffSession(this.db)).refreshDays : REFRESH_TTL_DAYS' in AS and "@Get('auth/staff-session')" in rd('src/modules/identity/account-security.controller.ts')
   and 'data-idle-warn' in SS and 'setToken(null, null)' in SS and "localStorage.setItem(KEY" in SS and '<StaffSession />' in APP
   and '자동 로그아웃' in doc('491_') and VT >= (10, 357) and len(mig) >= 274 and 'D236_staff_session_oncall_password' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    la, lb = login_full('admin@x.com'), login_full('buyer@x.com')
    TS, TB = la.get('accessToken'), lb.get('accessToken')
    s = call('GET', '/auth/staff-session', None, TS)
    fb = call('GET', '/auth/staff-session', None, TB)
    ok('② API — 운영 역할(SUPER) 다시 받기 증표 1일 · 회원 14일 · staff-session(자동 로그아웃 30분 · 유지 1일 · 비밀번호 나이) · 회원 403',
       jwt_life(la.get('refreshToken')) == 86400 and jwt_life(lb.get('refreshToken')) == 14 * 86400 and s.get('idleMin') == 30 and s.get('refreshDays') == 1
       and isinstance((s.get('password') or {}).get('days'), int) and fb.get('_err') == 403,
       f"{jwt_life(la.get('refreshToken'))} {jwt_life(lb.get('refreshToken'))} · {s} · {fb.get('_err')}")
    if ADMIN_WEB:
        def run(b, seen, perr):
            pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            try:
                pg.clock.install()
            except Exception as ex:
                seen['clock'] = str(ex)[:60]; return
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            pg.goto(ADMIN_WEB + '/#/home', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
            seen['before'] = pg.locator('[data-idle-warn]').count()
            pg.clock.fast_forward('29:30'); pg.wait_for_timeout(1500)
            seen['warn'] = pg.locator('[data-idle-warn]').count()
            pg.clock.fast_forward('01:00'); pg.wait_for_timeout(2500)
            seen['login'] = pg.locator('input[name=email]').count()
        r = ui(run)
        if r is None:
            print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = r
            ok('③ 화면 — 로그인 뒤 띠 없음 · 29분 30초 지나면 「n초 뒤 자동 로그아웃」 띠 · 30분 넘으면 로그인 화면 · 화면 오류 없음',
               seen.get('before') == 0 and seen.get('warn') == 1 and seen.get('login', 0) >= 1 and not perr, f'{seen} · {perr[:2]}')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
